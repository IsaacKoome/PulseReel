import base64
import json
import mimetypes
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Annotated
from urllib import parse, request as urlrequest

import boto3
from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse


APP_ROOT = Path(__file__).resolve().parent
JOBS_DIR = Path(os.environ.get("PULSEREEL_WORKER_JOBS_DIR", APP_ROOT / "jobs"))
OUTPUT_DIR = Path(os.environ.get("PULSEREEL_WORKER_OUTPUT_DIR", APP_ROOT / "outputs"))
PUBLIC_BASE_URL = os.environ.get("PULSEREEL_WORKER_PUBLIC_BASE_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("PULSEREEL_WORKER_TOKEN", "").strip()
FFMPEG = os.environ.get("PULSEREEL_WORKER_FFMPEG", "ffmpeg")
COMFYUI_URL = os.environ.get("PULSEREEL_WORKER_COMFYUI_URL", "").strip()
COMFYUI_WORKFLOW = os.environ.get("PULSEREEL_WORKER_COMFYUI_WORKFLOW", "").strip()
COMFYUI_NEGATIVE_PROMPT = os.environ.get(
    "PULSEREEL_WORKER_COMFYUI_NEGATIVE_PROMPT",
    "blurry, distorted, low quality, malformed anatomy, duplicate face",
).strip()
STORAGE_BUCKET = os.environ.get("PULSEREEL_WORKER_STORAGE_BUCKET", "").strip()
STORAGE_ENDPOINT = os.environ.get("PULSEREEL_WORKER_STORAGE_ENDPOINT", "").strip()
STORAGE_REGION = os.environ.get("PULSEREEL_WORKER_STORAGE_REGION", "").strip()
STORAGE_ACCESS_KEY = os.environ.get("PULSEREEL_WORKER_STORAGE_ACCESS_KEY", "").strip()
STORAGE_SECRET_KEY = os.environ.get("PULSEREEL_WORKER_STORAGE_SECRET_KEY", "").strip()
STORAGE_PUBLIC_BASE_URL = os.environ.get("PULSEREEL_WORKER_STORAGE_PUBLIC_BASE_URL", "").rstrip("/")
STORAGE_PREFIX = os.environ.get("PULSEREEL_WORKER_STORAGE_PREFIX", "jobs").strip().strip("/")
ENABLE_AUDIO_BED = os.environ.get("PULSEREEL_WORKER_ENABLE_AUDIO_BED", "1").strip() != "0"
REPLICATE_API_TOKEN = os.environ.get("PULSEREEL_REPLICATE_API_TOKEN", "").strip()
REPLICATE_MODEL = os.environ.get("PULSEREEL_REPLICATE_MODEL", "").strip()
REPLICATE_INPUT_TEMPLATE = os.environ.get("PULSEREEL_REPLICATE_INPUT_TEMPLATE", "").strip()

JOBS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PulseReel GPU Worker", version="0.1.0")


@app.get("/outputs/{filename:path}", name="outputs")
def output_file(filename: str, request: Request):
    output_path = (OUTPUT_DIR / filename).resolve()
    try:
        output_path.relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=404, detail="Output not found.")

    if not output_path.exists() or not output_path.is_file():
        raise HTTPException(status_code=404, detail="Output not found.")

    headers = {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Accept-Ranges": "bytes",
    }
    if request.query_params.get("download") == "1":
        headers["Content-Disposition"] = f'attachment; filename="{output_path.name}"'

    return FileResponse(output_path, media_type="video/mp4", headers=headers)


def run_ffmpeg(args: list[str]) -> None:
    process = subprocess.run([FFMPEG, *args], capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg exited with code {process.returncode}: {process.stderr.strip()}")


def http_json(method: str, url: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urlrequest.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urlrequest.urlopen(req, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def apply_placeholders(value, replacements: dict):
    if isinstance(value, dict):
        return {key: apply_placeholders(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [apply_placeholders(item, replacements) for item in value]
    if isinstance(value, str):
        result = value
        for key, replacement in replacements.items():
            result = result.replace(f"{{{{{key}}}}}", str(replacement))
        return result
    return value


def comfyui_enabled() -> bool:
    return bool(COMFYUI_URL and COMFYUI_WORKFLOW and Path(COMFYUI_WORKFLOW).exists())


def safe_upload_name(upload: UploadFile | None, fallback: str) -> str:
    if not upload or not upload.filename:
        return fallback
    return Path(upload.filename).name.replace("/", "_").replace("\\", "_")


async def save_upload(upload: UploadFile | None, destination: Path) -> Path | None:
    if upload is None:
        return None

    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            output.write(chunk)
    return destination


def upload_image_to_comfyui(base_url: str, image_path: Path, subfolder: str = "") -> str:
    boundary = f"----PulseReel{uuid.uuid4().hex}"
    parts: list[bytes] = []
    fields = {"type": "input", "overwrite": "true"}
    if subfolder:
        fields["subfolder"] = subfolder
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode("utf-8"))
        parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode("utf-8"))
    parts.append(f"--{boundary}\r\n".encode("utf-8"))
    parts.append(
        (
            f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
    )
    parts.append(image_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = urlrequest.Request(
        f"{base_url.rstrip('/')}/upload/image",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urlrequest.urlopen(req, timeout=180) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("name", image_path.name)


def queue_comfyui_prompt(base_url: str, prompt_payload: dict, client_id: str) -> str:
    response = http_json("POST", f"{base_url.rstrip('/')}/prompt", {"prompt": prompt_payload, "client_id": client_id})
    prompt_id = response.get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI did not return a prompt_id.")
    return prompt_id


def wait_for_comfyui_prompt(base_url: str, prompt_id: str, timeout_seconds: int = 900) -> dict:
    started = time.time()
    history_url = f"{base_url.rstrip('/')}/history/{prompt_id}"
    while time.time() - started < timeout_seconds:
        data = http_json("GET", history_url)
        if prompt_id in data and data[prompt_id].get("outputs"):
            return data[prompt_id]
        time.sleep(2)
    raise RuntimeError(f"Timed out waiting for ComfyUI prompt {prompt_id}.")


def first_output_image(history_entry: dict) -> dict | None:
    outputs = history_entry.get("outputs", {})
    for node_output in outputs.values():
        for image in node_output.get("images", []):
            return image
    return None


def download_comfyui_image(base_url: str, image_info: dict, destination: Path) -> None:
    query = parse.urlencode(
        {
            "filename": image_info.get("filename", ""),
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        }
    )
    with urlrequest.urlopen(f"{base_url.rstrip('/')}/view?{query}", timeout=180) as response:
        destination.write_bytes(response.read())


def public_video_url(request: Request, filename: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}/outputs/{filename}"
    return str(request.url_for("outputs", path=filename))


def public_video_url_from_base(base_url: str, filename: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}/outputs/{filename}"
    return f"{base_url.rstrip('/')}/outputs/{filename}"


def storage_enabled() -> bool:
    return bool(STORAGE_BUCKET and STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY)


def storage_client():
    client_kwargs: dict[str, str] = {
        "service_name": "s3",
        "aws_access_key_id": STORAGE_ACCESS_KEY,
        "aws_secret_access_key": STORAGE_SECRET_KEY,
    }
    if STORAGE_REGION:
        client_kwargs["region_name"] = STORAGE_REGION
    if STORAGE_ENDPOINT:
        client_kwargs["endpoint_url"] = STORAGE_ENDPOINT
    return boto3.client(**client_kwargs)


def upload_output_to_storage(local_path: Path, remote_key: str) -> str:
    client = storage_client()
    extra_args = {"ContentType": "video/mp4"}
    if not STORAGE_PUBLIC_BASE_URL:
        extra_args["ACL"] = "public-read"
    client.upload_file(str(local_path), STORAGE_BUCKET, remote_key, ExtraArgs=extra_args)
    if STORAGE_PUBLIC_BASE_URL:
        return f"{STORAGE_PUBLIC_BASE_URL}/{remote_key}"

    if STORAGE_ENDPOINT:
        endpoint = STORAGE_ENDPOINT.rstrip("/")
        return f"{endpoint}/{STORAGE_BUCKET}/{remote_key}"

    region = STORAGE_REGION or "us-east-1"
    return f"https://{STORAGE_BUCKET}.s3.{region}.amazonaws.com/{remote_key}"


def final_video_url(request: Request, output_path: Path, job_id: str) -> str:
    if storage_enabled():
        key_prefix = STORAGE_PREFIX or "jobs"
        remote_key = f"{key_prefix}/{job_id}/final.mp4"
        return upload_output_to_storage(output_path, remote_key)
    return public_video_url(request, output_path.name)


def final_video_url_from_base(base_url: str, output_path: Path, job_id: str) -> str:
    if storage_enabled():
        key_prefix = STORAGE_PREFIX or "jobs"
        remote_key = f"{key_prefix}/{job_id}/final.mp4"
        return upload_output_to_storage(output_path, remote_key)
    return public_video_url_from_base(base_url, output_path.name)


def worker_job_status_url(request: Request, job_id: str) -> str:
    if PUBLIC_BASE_URL:
        return f"{PUBLIC_BASE_URL}/pulsereel/jobs/{job_id}"
    return str(request.url_for("job_status", job_id=job_id))


def verify_authorization(authorization: str | None) -> None:
    if not WORKER_TOKEN:
        return

    expected = f"Bearer {WORKER_TOKEN}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Invalid worker token.")


def extract_identity_frame(source_video_path: Path, destination: Path) -> None:
    run_ffmpeg(
        [
            "-y",
            "-ss",
            "0.8",
            "-i",
            str(source_video_path),
            "-frames:v",
            "1",
            str(destination),
        ]
    )


def build_model_prompt(payload: dict, shot: dict) -> str:
    world = payload.get("worldSpec", {})
    character = payload.get("characterBible", {})
    story = payload.get("story", {})
    style = payload.get("styleBible", {})
    visual_intent = story.get("visualIntent", {})
    extras = ", ".join(world.get("extras", []))
    recurring = ", ".join(shot.get("recurringElements", []))
    cast = ", ".join(shot.get("supportingCast", []))
    physical_features = ", ".join(character.get("physicalFeatures", []))
    previous_summary = shot.get("previousShotSummary", "")
    next_summary = shot.get("nextShotSummary", "")
    return (
        f"{shot.get('prompt', '')}. "
        f"Vertical cinematic movie frame, {shot.get('subjectFraming', 'hero')} composition, "
        f"{shot.get('shotKind', 'establishing')} beat, {shot.get('worldActivity', 'medium')} world activity. "
        f"Setting: {world.get('setting', '')}; landmark: {world.get('landmark', '')}; atmosphere: {world.get('atmosphere', '')}. "
        f"Visible world life: {extras}. Supporting cast: {cast}. Recurring motifs: {recurring}. "
        f"Emotional beat: {shot.get('emotionalBeat', '')}. Camera goal: {shot.get('cameraGoal', '')}. "
        f"Background action: {shot.get('backgroundAction', '')}. Hero action: {shot.get('heroAction', '')}. "
        f"Lens suggestion: {shot.get('lensSuggestion', '')}. Lighting cue: {shot.get('lightingCue', '')}. "
        f"Edit instruction: {shot.get('editInstruction', '')}. Continuity anchor: {shot.get('continuityAnchor', '')}. "
        f"Hero identity anchor: {character.get('identityAnchor', '')}. Wardrobe anchor: {character.get('wardrobeAnchor', '')}. "
        f"Physical consistency: {physical_features}. Screen presence: {character.get('screenPresence', '')}. "
        f"Movement style: {character.get('movementStyle', '')}. Performance energy: {character.get('performanceEnergy', '')}. "
        f"Style tone: {style.get('cinematicTone', '')}. Lens language: {style.get('lensLanguage', '')}. "
        f"Lighting language: {style.get('lightingLanguage', '')}. Edit rhythm: {style.get('editRhythm', '')}. "
        f"Camera behavior: {style.get('cameraBehavior', '')}. Texture goal: {style.get('textureGoal', '')}. "
        f"Score mood: {style.get('scoreMood', '')}. "
        f"Overall visual intent: {visual_intent.get('worldScale', '')}; pacing: {visual_intent.get('pacing', '')}; realism target: {visual_intent.get('realismTarget', '')}. "
        f"Previous shot: {previous_summary} Next shot: {next_summary} "
        "Preserve creator identity from the uploaded identity image, natural face, believable live-action lighting, cinematic depth, and continuity across the sequence."
    )


def build_negative_prompt(shot: dict) -> str:
    shot_negative = shot.get("negativePrompt", "")
    if shot_negative:
        return f"{COMFYUI_NEGATIVE_PROMPT}, {shot_negative}"
    return COMFYUI_NEGATIVE_PROMPT


def continuity_seed(job_id: str, shot: dict) -> int:
    source = f"{job_id}|{shot.get('continuityAnchor', '')}|{shot.get('shotId', '')}|{shot.get('stage', '')}"
    return sum(ord(character) for character in source) % 2147483647 or 1


def render_reference_segment(reference_path: Path, output_path: Path, shot: dict, output_spec: dict) -> None:
    width = int(output_spec.get("width", 720))
    height = int(output_spec.get("height", 1280))
    fps = int(output_spec.get("fps", 25))
    duration = float(shot.get("durationSeconds", 5))
    frame_count = max(1, round(duration * fps))
    shot_kind = shot.get("shotKind", "establishing")
    subject_framing = shot.get("subjectFraming", "hero")

    if subject_framing == "world-first" or shot_kind in {"observer", "landmark"}:
        zoom = "1.04+0.0002*on"
        x_expr = "iw/2-(iw/zoom/2)+sin(on/8)*34"
        y_expr = "ih/2-(ih/zoom/2)-18+cos(on/12)*12"
    elif subject_framing == "shared-frame" or shot_kind == "interaction":
        zoom = "1.07+0.0003*sin(on/10)"
        x_expr = "iw/2-(iw/zoom/2)+sin(on/10)*18"
        y_expr = "ih/2-(ih/zoom/2)+cos(on/11)*10"
    else:
        zoom = "1+0.0007*on"
        x_expr = "iw/2-(iw/zoom/2)"
        y_expr = "ih/2-(ih/zoom/2)+cos(on/16)*8"

    vf = ",".join(
        [
            f"scale={width}:{height}:force_original_aspect_ratio=increase",
            f"crop={width}:{height}",
            f"zoompan=z='{zoom}':x='{x_expr}':y='{y_expr}':d={frame_count}:s={width}x{height}:fps={fps}",
            "eq=saturation=1.10:contrast=1.05:brightness=0.01",
            "unsharp=5:5:0.5:5:5:0.0",
            "format=yuv420p",
            "fade=t=in:st=0:d=0.35",
            f"fade=t=out:st={max(0.5, duration - 0.45)}:d=0.45",
        ]
    )

    run_ffmpeg(
        [
            "-y",
            "-loop",
            "1",
            "-i",
            str(reference_path),
            "-vf",
            vf,
            "-t",
            str(duration),
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(output_path),
        ]
    )


def render_source_clip(source_path: Path, output_path: Path, shot: dict, output_spec: dict, duration: float) -> None:
    width = int(output_spec.get("width", 720))
    height = int(output_spec.get("height", 1280))
    fps = int(output_spec.get("fps", 25))
    offset = float(shot.get("sourceClipOffsetSeconds", 0))
    subject_framing = shot.get("subjectFraming", "hero")
    crop_x = "x=(in_w-out_w)/2+sin(t*0.7)*24" if subject_framing == "shared-frame" else "x=(in_w-out_w)/2"
    crop_y = "y=(in_h-out_h)/2-18+cos(t*0.7)*14" if subject_framing == "world-first" else "y=(in_h-out_h)/2"

    vf = ",".join(
        [
            f"scale={width}:{height}:force_original_aspect_ratio=increase",
            f"crop={width}:{height}:{crop_x}:{crop_y}",
            "eq=saturation=1.12:contrast=1.05:brightness=0.01",
            "unsharp=5:5:0.6:5:5:0.0",
            "tblend=all_mode=average:all_opacity=0.10",
            "format=yuv420p",
        ]
    )

    run_ffmpeg(
        [
            "-y",
            "-ss",
            str(offset),
            "-i",
            str(source_path),
            "-t",
            str(duration),
            "-vf",
            vf,
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(output_path),
        ]
    )


def render_world_composite_clip(
    reference_path: Path,
    source_path: Path,
    output_path: Path,
    shot: dict,
    output_spec: dict,
    duration: float,
) -> None:
    width = int(output_spec.get("width", 720))
    height = int(output_spec.get("height", 1280))
    fps = int(output_spec.get("fps", 25))
    offset = float(shot.get("sourceClipOffsetSeconds", 0))
    shot_kind = shot.get("shotKind", "establishing")
    subject_framing = shot.get("subjectFraming", "hero")
    world_activity = shot.get("worldActivity", "medium")
    frame_count = max(1, round(duration * fps))

    if subject_framing == "world-first" or shot_kind in {"observer", "landmark"}:
        hero_width = round(width * 0.58)
        x_expr = "W-w-38+sin(t*0.7)*16"
        y_expr = "H-h-110+cos(t*0.9)*10"
        alpha = "0.72"
        bg_zoom = "1.04+0.00015*on"
    elif shot_kind == "reaction":
        hero_width = round(width * 0.84)
        x_expr = "(W-w)/2+sin(t*0.6)*10"
        y_expr = "H-h-70+cos(t*0.8)*8"
        alpha = "0.82"
        bg_zoom = "1.08+0.0002*on"
    elif subject_framing == "shared-frame" or shot_kind == "interaction":
        hero_width = round(width * 0.68)
        x_expr = "42+sin(t*0.8)*18"
        y_expr = "H-h-92+cos(t*0.9)*10"
        alpha = "0.78"
        bg_zoom = "1.06+0.00018*on"
    else:
        hero_width = round(width * 0.74)
        x_expr = "(W-w)/2+sin(t*0.9)*14"
        y_expr = "H-h-88+cos(t*0.8)*8"
        alpha = "0.80"
        bg_zoom = "1.06+0.0002*on"

    world_lift = "0.045" if world_activity == "high" else "0.028"
    source_crop_x = "(in_w-out_w)/2+sin(t*0.55)*18"
    source_crop_y = "(in_h-out_h)/2+cos(t*0.55)*10"

    filters = [
        (
            f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},"
            f"zoompan=z='{bg_zoom}':x='iw/2-(iw/zoom/2)+sin(on/10)*22':"
            f"y='ih/2-(ih/zoom/2)+cos(on/13)*14':d={frame_count}:s={width}x{height}:fps={fps},"
            "eq=saturation=1.12:contrast=1.06:brightness=0.01,"
            "format=rgba[world]"
        ),
        (
            f"[1:v]scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height}:{source_crop_x}:{source_crop_y},"
            "eq=saturation=1.05:contrast=1.08:brightness=-0.015,"
            "boxblur=0.4:0.4,"
            f"scale={hero_width}:-2,"
            f"format=rgba,colorchannelmixer=aa={alpha}[hero]"
        ),
        (
            f"color=c=black@0.0:s={width}x{height}:d={duration},format=rgba,"
            f"drawbox=x=0:y=0:w=iw:h=ih:color=white@{world_lift}:t=fill[atmosphere]"
        ),
        "[world][atmosphere]overlay=0:0:shortest=1[world_lit]",
        (
            f"[world_lit][hero]overlay=x='{x_expr}':y='{y_expr}':shortest=1,"
            "drawbox=x=0:y=0:w=iw:h=ih:color=black@0.18:t=42,"
            "vignette=PI/5,"
            f"trim=duration={duration},setpts=PTS-STARTPTS,format=yuv420p[v]"
        ),
    ]

    run_ffmpeg(
        [
            "-y",
            "-loop",
            "1",
            "-i",
            str(reference_path),
            "-ss",
            str(offset),
            "-i",
            str(source_path),
            "-filter_complex",
            ";".join(filters),
            "-map",
            "[v]",
            "-t",
            str(duration),
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(output_path),
        ]
    )


def should_add_motion(shot: dict, index: int, total: int) -> bool:
    if total <= 1:
        return True
    if index >= total - 1:
        return (
            shot.get("shotKind") in {"reaction", "landmark"}
            or shot.get("subjectFraming") in {"hero-in-world", "shared-frame"}
        )
    return (
        shot.get("subjectFraming") in {"hero-in-world", "shared-frame", "world-first"}
        or shot.get("worldActivity") in {"medium", "high"}
        or shot.get("shotKind") in {"observer", "interaction", "action", "reaction", "landmark"}
        or index % 3 == 1
    )


def motion_duration(shot: dict) -> float:
    duration = float(shot.get("durationSeconds", 5))
    if shot.get("shotKind") == "reaction":
        insert = 2.4
    elif shot.get("shotKind") == "interaction":
        insert = 2.6
    elif shot.get("worldActivity") == "high" or shot.get("shotKind") == "observer":
        insert = 2.2
    elif shot.get("subjectFraming") in {"hero-in-world", "shared-frame", "world-first"}:
        insert = 2.0
    else:
        insert = 1.5
    return min(max(1.2, insert), max(1.0, duration - 0.9))


def should_composite_into_world(shot: dict) -> bool:
    return (
        shot.get("subjectFraming") in {"hero-in-world", "shared-frame", "world-first"}
        or shot.get("shotKind") in {"observer", "interaction", "reaction", "landmark"}
        or shot.get("worldActivity") in {"medium", "high"}
    )


def generate_comfyui_frames(
    job_dir: Path,
    payload: dict,
    references: dict[int, Path],
    identity_image: Path | None,
) -> dict[int, Path]:
    if not comfyui_enabled():
        return references

    workflow_template = json.loads(Path(COMFYUI_WORKFLOW).read_text(encoding="utf-8"))
    generated_dir = job_dir / "generated-frames"
    generated_dir.mkdir(parents=True, exist_ok=True)
    client_id = f"pulsereel-worker-{uuid.uuid4().hex}"
    identity_upload_name = upload_image_to_comfyui(COMFYUI_URL, identity_image, "identity") if identity_image else ""
    rendered_frames: dict[int, Path] = {}

    for index, shot in enumerate(payload.get("shotReferences", [])):
        reference_path = references.get(index)
        if reference_path is None:
            continue

        continuity_scene_path = rendered_frames.get(index - 1) if index > 0 and shot.get("continuityGroup") != "setup" else None
        primary_scene_path = continuity_scene_path or reference_path
        scene_upload_name = upload_image_to_comfyui(COMFYUI_URL, primary_scene_path, "scene")
        reference_upload_name = upload_image_to_comfyui(COMFYUI_URL, reference_path, "reference")
        prompt_payload = apply_placeholders(
            workflow_template,
            {
                "PROMPT": build_model_prompt(payload, shot),
                "NEGATIVE_PROMPT": build_negative_prompt(shot),
                "REFERENCE_IMAGE": reference_upload_name,
                "SCENE_IMAGE": scene_upload_name,
                "IDENTITY_IMAGE": identity_upload_name or scene_upload_name,
                "PREVIOUS_IMAGE": scene_upload_name,
                "OUTPUT_PREFIX": f"{payload.get('jobId', uuid.uuid4().hex)}-{shot.get('shotId', index)}",
                "WIDTH": payload.get("outputSpec", {}).get("width", 720),
                "HEIGHT": payload.get("outputSpec", {}).get("height", 1280),
                "SEED": continuity_seed(str(payload.get("jobId", uuid.uuid4().hex)), shot),
            },
        )

        prompt_id = queue_comfyui_prompt(COMFYUI_URL, prompt_payload, client_id)
        history_entry = wait_for_comfyui_prompt(COMFYUI_URL, prompt_id)
        image_info = first_output_image(history_entry)
        if not image_info:
            rendered_frames[index] = reference_path
            continue

        output_path = generated_dir / f"{index + 1:02d}-{shot.get('shotId', uuid.uuid4().hex)}.png"
        download_comfyui_image(COMFYUI_URL, image_info, output_path)
        rendered_frames[index] = output_path

    return rendered_frames


def is_replicate_job(payload: dict) -> bool:
    external_provider = payload.get("modelHints", {}).get("externalProvider", {})
    return external_provider.get("provider") == "replicate"


def replicate_model_for_payload(payload: dict) -> str:
    external_provider = payload.get("modelHints", {}).get("externalProvider", {})
    return str(external_provider.get("model") or REPLICATE_MODEL).strip()


def normalize_replicate_model(model: str) -> str:
    normalized = model.replace("version:", "", 1).strip() if model.startswith("version:") else model.strip()
    return normalized.lower()


def file_to_data_uri(file_path: Path | None) -> str:
    if not file_path or not file_path.exists():
        return ""
    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def first_reference_image(references: dict[int, Path]) -> Path | None:
    if not references:
        return None
    first_key = sorted(references.keys())[0]
    return references[first_key]


def build_replicate_prompt(payload: dict) -> str:
    external_provider = payload.get("modelHints", {}).get("externalProvider", {})
    if external_provider.get("prompt"):
        return str(external_provider["prompt"])
    shots = payload.get("shots", [])
    shot_lines = [str(shot.get("prompt", "")) for shot in shots if shot.get("prompt")]
    return " ".join(shot_lines) or "Create a cinematic vertical short film from the provided identity reference."


def build_replicate_input(
    payload: dict,
    references: dict[int, Path],
    identity_image: Path | None,
    source_video: Path | None,
    input_template: str | None = None,
) -> dict:
    prompt = build_replicate_prompt(payload)
    image_data_uri = file_to_data_uri(identity_image) or file_to_data_uri(first_reference_image(references))
    video_data_uri = file_to_data_uri(source_video)
    output_spec = payload.get("outputSpec", {})
    replacements = {
        "PROMPT": prompt,
        "SOURCE_IMAGE_URL": image_data_uri,
        "SOURCE_VIDEO_URL": video_data_uri,
        "IDENTITY_IMAGE": image_data_uri,
        "SOURCE_VIDEO": video_data_uri,
        "WIDTH": output_spec.get("width", 720),
        "HEIGHT": output_spec.get("height", 1280),
        "DURATION_SECONDS": min(8, int(float(output_spec.get("totalDurationSeconds", 5)))),
        "ASPECT_RATIO": "9:16",
    }

    template_value = (input_template or REPLICATE_INPUT_TEMPLATE).strip()
    if template_value:
        template = json.loads(template_value)
        return apply_placeholders(template, replacements)

    model = normalize_replicate_model(replicate_model_for_payload(payload))
    if model == "minimax/video-01":
        request_input = {
            "prompt": prompt,
            "prompt_optimizer": True,
        }
        if image_data_uri:
            request_input["first_frame_image"] = image_data_uri
        return request_input

    request_input = {"prompt": prompt, "aspect_ratio": "9:16", "duration": replacements["DURATION_SECONDS"]}
    if image_data_uri:
        request_input["image"] = image_data_uri
        request_input["input_image"] = image_data_uri
        request_input["start_image"] = image_data_uri
        request_input["first_frame_image"] = image_data_uri
    return request_input


def replicate_prediction_request(token: str, model: str, request_input: dict) -> dict:
    headers = {
        "Authorization": f"Token {token}",
        "Content-Type": "application/json",
        "Prefer": "wait=60",
    }
    if model.startswith("version:"):
        body = {"version": model.replace("version:", "", 1).strip(), "input": request_input}
        endpoint = "https://api.replicate.com/v1/predictions"
    else:
        if "/" not in model:
            raise RuntimeError("PULSEREEL_REPLICATE_MODEL must be an owner/model slug or version:<id>.")
        endpoint = f"https://api.replicate.com/v1/models/{model}/predictions"
        body = {"input": request_input}

    req = urlrequest.Request(endpoint, data=json.dumps(body).encode("utf-8"), method="POST", headers=headers)
    with urlrequest.urlopen(req, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def poll_replicate_prediction(token: str, prediction: dict, timeout_seconds: int = 900) -> dict:
    status = prediction.get("status")
    get_url = prediction.get("urls", {}).get("get")
    started = time.time()
    while status not in {"succeeded", "failed", "canceled"}:
        if not get_url:
            raise RuntimeError("Replicate did not return a prediction status URL.")
        if time.time() - started > timeout_seconds:
            raise RuntimeError("Timed out waiting for Replicate video generation.")
        time.sleep(4)
        req = urlrequest.Request(get_url, method="GET", headers={"Authorization": f"Token {token}"})
        with urlrequest.urlopen(req, timeout=120) as response:
            prediction = json.loads(response.read().decode("utf-8"))
        status = prediction.get("status")

    if status != "succeeded":
        error = prediction.get("error") or f"Replicate prediction ended with status {status}."
        raise RuntimeError(str(error))
    return prediction


def find_output_url(value) -> str:
    if isinstance(value, str) and value.startswith("http"):
        return value
    if isinstance(value, list):
        for item in value:
            found = find_output_url(item)
            if found:
                return found
    if isinstance(value, dict):
        for item in value.values():
            found = find_output_url(item)
            if found:
                return found
    return ""


def download_replicate_output(output_url: str, destination: Path) -> None:
    with urlrequest.urlopen(output_url, timeout=900) as response:
        destination.write_bytes(response.read())


def render_replicate_movie(
    job_dir: Path,
    payload: dict,
    source_video: Path | None,
    references: dict[int, Path],
    identity_image: Path | None,
    replicate_token: str | None,
    input_template: str | None = None,
) -> Path | None:
    if not is_replicate_job(payload):
        return None

    token = (replicate_token or REPLICATE_API_TOKEN).strip()
    model = replicate_model_for_payload(payload)
    if not token or not model:
        return None

    request_input = build_replicate_input(payload, references, identity_image, source_video, input_template)
    prediction = replicate_prediction_request(token, model, request_input)
    prediction = poll_replicate_prediction(token, prediction)
    output_url = find_output_url(prediction.get("output"))
    if not output_url:
        raise RuntimeError("Replicate finished but did not return a video URL.")

    output_path = OUTPUT_DIR / f"{payload.get('jobId', uuid.uuid4().hex)}-replicate.mp4"
    download_replicate_output(output_url, output_path)
    return output_path


def concat_segments(segment_paths: list[Path], output_path: Path, output_spec: dict) -> None:
    concat_list = output_path.with_suffix(".txt")
    fps = int(output_spec.get("fps", 25))
    total_duration = float(output_spec.get("totalDurationSeconds", 60))
    concat_list.write_text(
        "\n".join([f"file '{str(path).replace(chr(39), chr(39) + chr(39))}'" for path in segment_paths]),
        encoding="utf-8",
    )
    args = [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat_list),
    ]

    if ENABLE_AUDIO_BED:
        audio_source = (
            f"anoisesrc=d={total_duration}:c=pink:r=44100:a=0.035,"
            "highpass=f=90,lowpass=f=1200,"
            "afade=t=in:st=0:d=1.5,"
            f"afade=t=out:st={max(0, total_duration - 4)}:d=4"
        )
        args.extend(
            [
                "-f",
                "lavfi",
                "-i",
                audio_source,
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-shortest",
            ]
        )
    else:
        args.append("-an")

    args.extend(
        [
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-t",
            str(total_duration),
            "-movflags",
            "+faststart",
            str(output_path),
        ]
    )
    run_ffmpeg(args)


def render_movie(
    job_dir: Path,
    payload: dict,
    source_video: Path | None,
    references: dict[int, Path],
    identity_image: Path | None,
) -> Path:
    renders_dir = job_dir / "renders"
    renders_dir.mkdir(parents=True, exist_ok=True)
    output_spec = payload.get("outputSpec", {})
    shot_references = payload.get("shotReferences", [])
    segment_paths: list[Path] = []
    rendered_references = generate_comfyui_frames(job_dir, payload, references, identity_image)

    for index, shot in enumerate(shot_references):
        reference_path = rendered_references.get(index) or references.get(index)
        if reference_path is None:
            continue

        insert_duration = motion_duration(shot) if source_video and should_add_motion(shot, index, len(shot_references)) else 0
        still_shot = {
            **shot,
            "durationSeconds": max(1.0, float(shot.get("durationSeconds", 5)) - insert_duration),
        }

        still_output = renders_dir / f"{index + 1:02d}-{shot.get('shotId', uuid.uuid4().hex)}.mp4"
        render_reference_segment(reference_path, still_output, still_shot, output_spec)
        segment_paths.append(still_output)

        if source_video and insert_duration:
            motion_output = renders_dir / f"{index + 1:02d}-{shot.get('shotId', uuid.uuid4().hex)}-motion.mp4"
            if should_composite_into_world(shot):
                render_world_composite_clip(reference_path, source_video, motion_output, shot, output_spec, insert_duration)
            else:
                render_source_clip(source_video, motion_output, shot, output_spec, insert_duration)
            segment_paths.append(motion_output)

    if not segment_paths and source_video:
        output_path = OUTPUT_DIR / f"{payload.get('jobId', uuid.uuid4().hex)}.mp4"
        total_duration = float(payload.get("outputSpec", {}).get("totalDurationSeconds", 60))
        if ENABLE_AUDIO_BED:
            run_ffmpeg(
                [
                    "-y",
                    "-i",
                    str(source_video),
                    "-f",
                    "lavfi",
                    "-i",
                    f"anoisesrc=d={total_duration}:c=pink:r=44100:a=0.035,highpass=f=90,lowpass=f=1200",
                    "-t",
                    str(total_duration),
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "96k",
                    "-pix_fmt",
                    "yuv420p",
                    "-shortest",
                    str(output_path),
                ]
            )
        else:
            run_ffmpeg(["-y", "-i", str(source_video), "-t", str(total_duration), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", str(output_path)])
        return output_path

    if not segment_paths:
        raise RuntimeError("No reference frames or source video were provided.")

    output_path = OUTPUT_DIR / f"{payload.get('jobId', uuid.uuid4().hex)}.mp4"
    concat_segments(segment_paths, output_path, output_spec)
    return output_path


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "worker": "pulsereel-gpu-worker",
        "mode": os.environ.get("PULSEREEL_WORKER_MODE", "ffmpeg-starter"),
        "comfyuiConfigured": comfyui_enabled(),
        "durableStorageConfigured": storage_enabled(),
    }


def async_status_path(job_id: str) -> Path:
    return JOBS_DIR / job_id / "status.json"


def write_async_status(job_id: str, data: dict) -> None:
    status_path = async_status_path(job_id)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    status_path.write_text(
        json.dumps(
            {
                "jobId": job_id,
                "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                **data,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def read_async_status(job_id: str) -> dict | None:
    status_path = async_status_path(job_id)
    if not status_path.exists():
        return None
    return json.loads(status_path.read_text(encoding="utf-8"))


async def save_job_inputs(
    request: Request,
    job_id: str,
    payload: UploadFile,
    source_video: UploadFile | None,
    source_image: UploadFile | None,
    poster: UploadFile | None,
) -> tuple[dict, Path | None, dict[int, Path], Path | None]:
    job_dir = JOBS_DIR / job_id
    uploads_dir = job_dir / "uploads"
    if job_dir.exists():
        shutil.rmtree(job_dir)
    uploads_dir.mkdir(parents=True, exist_ok=True)

    payload_path = await save_upload(payload, uploads_dir / "payload.json")
    if not payload_path:
        raise HTTPException(status_code=400, detail="Missing payload file.")

    payload_json = json.loads(payload_path.read_text(encoding="utf-8"))
    source_video_path = await save_upload(source_video, uploads_dir / safe_upload_name(source_video, "source-video"))
    source_image_path = await save_upload(source_image, uploads_dir / safe_upload_name(source_image, "source-image"))
    await save_upload(poster, uploads_dir / safe_upload_name(poster, "poster"))

    form = await request.form()
    reference_paths: dict[int, Path] = {}
    for key, value in form.multi_items():
      if not key.startswith("reference_") or not hasattr(value, "read"):
          continue
      try:
          index = int(key.replace("reference_", ""))
      except ValueError:
          continue
      filename = safe_upload_name(value, f"{key}.png")
      saved = await save_upload(value, uploads_dir / f"{key}-{filename}")
      if saved:
          reference_paths[index] = saved

    identity_image = source_image_path
    if identity_image is None and source_video_path is not None:
        identity_image = uploads_dir / "identity-frame.png"
        extract_identity_frame(source_video_path, identity_image)

    return payload_json, source_video_path, reference_paths, identity_image


def render_queued_job(
    job_id: str,
    public_base_url: str,
    replicate_token: str | None = None,
    replicate_input_template: str | None = None,
) -> None:
    job_dir = JOBS_DIR / job_id
    uploads_dir = job_dir / "uploads"
    payload_path = uploads_dir / "payload.json"
    try:
        write_async_status(job_id, {"status": "running", "progress": 18, "stage": "Preparing movie render"})
        payload_json = json.loads(payload_path.read_text(encoding="utf-8"))
        source_video_candidates = [
            item for item in uploads_dir.iterdir()
            if item.is_file() and item.name != "payload.json" and item.name.startswith("source-video")
        ]
        source_video_path = source_video_candidates[0] if source_video_candidates else None
        source_image_candidates = [
            item for item in uploads_dir.iterdir()
            if item.is_file() and item.name.startswith("source-image")
        ]
        identity_image = source_image_candidates[0] if source_image_candidates else None
        if identity_image is None and source_video_path is not None:
            identity_image = uploads_dir / "identity-frame.png"
            if not identity_image.exists():
                extract_identity_frame(source_video_path, identity_image)

        reference_paths: dict[int, Path] = {}
        for item in uploads_dir.iterdir():
            if not item.is_file() or not item.name.startswith("reference_"):
                continue
            try:
                index = int(item.name.split("-", 1)[0].replace("reference_", ""))
            except ValueError:
                continue
            reference_paths[index] = item

        if is_replicate_job(payload_json) and (replicate_token or REPLICATE_API_TOKEN) and replicate_model_for_payload(payload_json):
            write_async_status(job_id, {"status": "running", "progress": 36, "stage": "Sending scene to Replicate"})
            output_path = render_replicate_movie(
                job_dir,
                payload_json,
                source_video_path,
                reference_paths,
                identity_image,
                replicate_token,
                replicate_input_template,
            )
        else:
            write_async_status(job_id, {"status": "running", "progress": 42, "stage": "Rendering movie segments"})
            output_path = render_movie(job_dir, payload_json, source_video_path, reference_paths, identity_image)
        if output_path is None:
            write_async_status(job_id, {"status": "running", "progress": 42, "stage": "Rendering movie segments"})
            output_path = render_movie(job_dir, payload_json, source_video_path, reference_paths, identity_image)
        write_async_status(job_id, {"status": "running", "progress": 88, "stage": "Publishing final movie"})
        video_url = final_video_url_from_base(public_base_url, output_path, job_id)
        write_async_status(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "stage": "Movie ready",
                "processedVideoUrl": video_url,
                "shotPlan": payload_json.get("shots", []),
            },
        )
    except Exception as error:
        write_async_status(
            job_id,
            {
                "status": "failed",
                "progress": 0,
                "stage": "Worker render failed",
                "error": str(error),
            },
        )


@app.post("/pulsereel/jobs")
async def enqueue_job(
    background_tasks: BackgroundTasks,
    request: Request,
    payload: Annotated[UploadFile, File()],
    protocolVersion: Annotated[str, Form()],
    jobId: Annotated[str, Form()],
    authorization: Annotated[str | None, Header()] = None,
    x_pulsereel_replicate_token: Annotated[str | None, Header()] = None,
    x_pulsereel_replicate_input_template: Annotated[str | None, Header()] = None,
    sourceVideo: Annotated[UploadFile | None, File()] = None,
    sourceImage: Annotated[UploadFile | None, File()] = None,
    poster: Annotated[UploadFile | None, File()] = None,
) -> dict:
    verify_authorization(authorization)

    if protocolVersion != "pulsereel-heavy-job-v1":
        raise HTTPException(status_code=400, detail="Unsupported PulseReel protocol version.")

    await save_job_inputs(request, jobId, payload, sourceVideo, sourceImage, poster)
    write_async_status(jobId, {"status": "queued", "progress": 8, "stage": "Queued on PulseReel worker"})
    background_tasks.add_task(
        render_queued_job,
        jobId,
        str(request.base_url).rstrip("/"),
        x_pulsereel_replicate_token,
        x_pulsereel_replicate_input_template,
    )

    return {
        "status": "queued",
        "jobId": jobId,
        "progress": 8,
        "stage": "Queued on PulseReel worker",
        "statusUrl": worker_job_status_url(request, jobId),
    }


@app.get("/pulsereel/jobs/{job_id}", name="job_status")
def job_status(job_id: str, authorization: Annotated[str | None, Header()] = None) -> dict:
    verify_authorization(authorization)
    status = read_async_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail="Worker job not found.")
    return status


@app.post("/pulsereel/render")
async def render(
    request: Request,
    payload: Annotated[UploadFile, File()],
    protocolVersion: Annotated[str, Form()],
    jobId: Annotated[str, Form()],
    authorization: Annotated[str | None, Header()] = None,
    x_pulsereel_replicate_token: Annotated[str | None, Header()] = None,
    x_pulsereel_replicate_input_template: Annotated[str | None, Header()] = None,
    sourceVideo: Annotated[UploadFile | None, File()] = None,
    sourceImage: Annotated[UploadFile | None, File()] = None,
    poster: Annotated[UploadFile | None, File()] = None,
) -> dict:
    verify_authorization(authorization)

    if protocolVersion != "pulsereel-heavy-job-v1":
        raise HTTPException(status_code=400, detail="Unsupported PulseReel protocol version.")

    job_dir = JOBS_DIR / jobId
    uploads_dir = job_dir / "uploads"
    if job_dir.exists():
        shutil.rmtree(job_dir)
    uploads_dir.mkdir(parents=True, exist_ok=True)

    payload_path = await save_upload(payload, uploads_dir / "payload.json")
    if not payload_path:
        raise HTTPException(status_code=400, detail="Missing payload file.")

    payload_json = json.loads(payload_path.read_text(encoding="utf-8"))
    source_video_path = await save_upload(sourceVideo, uploads_dir / safe_upload_name(sourceVideo, "source-video"))
    source_image_path = await save_upload(sourceImage, uploads_dir / safe_upload_name(sourceImage, "source-image"))
    await save_upload(poster, uploads_dir / safe_upload_name(poster, "poster"))

    form = await request.form()
    reference_paths: dict[int, Path] = {}
    for key, value in form.multi_items():
        if not key.startswith("reference_") or not hasattr(value, "read"):
            continue
        try:
            index = int(key.replace("reference_", ""))
        except ValueError:
            continue
        filename = safe_upload_name(value, f"{key}.png")
        saved = await save_upload(value, uploads_dir / f"{key}-{filename}")
        if saved:
            reference_paths[index] = saved

    identity_image = source_image_path
    if identity_image is None and source_video_path is not None:
        identity_image = uploads_dir / "identity-frame.png"
        extract_identity_frame(source_video_path, identity_image)

    try:
        output_path = render_replicate_movie(
            job_dir,
            payload_json,
            source_video_path,
            reference_paths,
            identity_image,
            x_pulsereel_replicate_token,
            x_pulsereel_replicate_input_template,
        )
        if output_path is None:
            output_path = render_movie(job_dir, payload_json, source_video_path, reference_paths, identity_image)
    except Exception as error:
        return {
            "status": "failed",
            "error": str(error),
        }

    video_url = final_video_url(request, output_path, jobId)

    return {
        "status": "completed",
        "processedVideoUrl": video_url,
        "shotPlan": payload_json.get("shots", []),
    }
