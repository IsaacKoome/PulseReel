import json
import os
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Annotated
from urllib import parse, request as urlrequest

import boto3
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles


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

JOBS_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="PulseReel GPU Worker", version="0.1.0")
app.mount("/outputs", StaticFiles(directory=str(OUTPUT_DIR)), name="outputs")


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


def should_add_motion(shot: dict, index: int, total: int) -> bool:
    if index >= total - 1:
        return False
    return (
        shot.get("worldActivity") == "high"
        or shot.get("shotKind") in {"observer", "interaction", "action"}
        or index % 4 == 2
    )


def motion_duration(shot: dict) -> float:
    duration = float(shot.get("durationSeconds", 5))
    if shot.get("shotKind") == "interaction":
        insert = 2.2
    elif shot.get("worldActivity") == "high" or shot.get("shotKind") == "observer":
        insert = 1.8
    else:
        insert = 1.3
    return min(max(1.0, insert), max(1.0, duration - 1.4))


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


@app.post("/pulsereel/render")
async def render(
    request: Request,
    payload: Annotated[UploadFile, File()],
    protocolVersion: Annotated[str, Form()],
    jobId: Annotated[str, Form()],
    authorization: Annotated[str | None, Header()] = None,
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
