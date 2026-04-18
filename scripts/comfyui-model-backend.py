import json
import mimetypes
import os
import sys
import time
import uuid
from datetime import datetime, UTC
from pathlib import Path
from urllib import parse, request
import subprocess

CHECKPOINT_PLACEHOLDER = "PUT_YOUR_MODEL_HERE.safetensors"
IPADAPTER_PLACEHOLDER = "PUT_YOUR_IPADAPTER_MODEL_HERE.bin"
CLIP_VISION_PLACEHOLDER = "PUT_YOUR_CLIP_VISION_MODEL_HERE.safetensors"

def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def update_status(status_path: Path, payload: dict, stage: str, progress: int, status: str = "running", error: str | None = None) -> None:
    status_path.write_text(
        json.dumps(
            {
                "jobId": payload.get("jobId", "unknown"),
                "provider": "open-model-adapter",
                "status": status,
                "stage": stage,
                "progress": progress,
                "error": error,
                "updatedAt": now_iso(),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def read_json(path_value: Path) -> dict:
    return json.loads(path_value.read_text(encoding="utf-8"))


def write_result(result_path: Path, payload: dict, processed_video_url: str) -> None:
    result_path.write_text(
        json.dumps(
            {
                "jobId": payload["jobId"],
                "provider": "open-model-adapter",
                "status": "completed",
                "completedAt": now_iso(),
                "processedVideoUrl": processed_video_url,
                "shotPlan": payload.get("shots", []),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def http_json(method: str, url: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with request.urlopen(req, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


def detect_checkpoint_name() -> str:
    configured = os.environ.get("PULSEREEL_COMFYUI_CHECKPOINT", "").strip()
    checkpoint_dir = Path.cwd() / "tools" / "ComfyUI" / "models" / "checkpoints"

    if configured:
        configured_path = Path(configured)
        if configured_path.exists():
            return configured_path.name
        sibling_path = checkpoint_dir / configured
        if sibling_path.exists():
            return sibling_path.name
        raise RuntimeError(f"Configured ComfyUI checkpoint was not found: {configured}")

    if not checkpoint_dir.exists():
        raise RuntimeError(f"ComfyUI checkpoint directory was not found: {checkpoint_dir}")

    candidates = sorted(
        [
            entry.name
            for entry in checkpoint_dir.iterdir()
            if entry.is_file()
            and entry.suffix.lower() in {".safetensors", ".ckpt", ".pt"}
            and "put_checkpoints_here" not in entry.name.lower()
        ]
    )
    if not candidates:
        raise RuntimeError(
            f"No ComfyUI checkpoint model was found in {checkpoint_dir}. Add a .safetensors, .ckpt, or .pt file first."
        )
    return candidates[0]


def detect_optional_model_name(env_var: str, placeholder: str, subdir: str, allowed_suffixes: set[str]) -> str:
    configured = os.environ.get(env_var, "").strip()
    model_dir = Path.cwd() / "tools" / "ComfyUI" / "models" / subdir

    if configured:
        configured_path = Path(configured)
        if configured_path.exists():
            return configured_path.name
        sibling_path = model_dir / configured
        if sibling_path.exists():
            return sibling_path.name
        raise RuntimeError(f"Configured ComfyUI model for {env_var} was not found: {configured}")

    if not model_dir.exists():
        return placeholder

    candidates = sorted(
        [
            entry.name
            for entry in model_dir.iterdir()
            if entry.is_file()
            and entry.suffix.lower() in allowed_suffixes
            and "put_" not in entry.name.lower()
        ]
    )
    return candidates[0] if candidates else placeholder


def upload_image(base_url: str, image_path: Path, subfolder: str = "") -> str:
    boundary = f"----PulseReel{uuid.uuid4().hex}"
    mime_type = mimetypes.guess_type(image_path.name)[0] or "application/octet-stream"
    parts = []
    fields = {
        "type": "input",
        "overwrite": "true",
    }
    if subfolder:
        fields["subfolder"] = subfolder
    for key, value in fields.items():
        parts.append(f"--{boundary}\r\n".encode("utf-8"))
        parts.append(f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode("utf-8"))
    parts.append(f"--{boundary}\r\n".encode("utf-8"))
    parts.append(
        (
            f'Content-Disposition: form-data; name="image"; filename="{image_path.name}"\r\n'
            f"Content-Type: {mime_type}\r\n\r\n"
        ).encode("utf-8")
    )
    parts.append(image_path.read_bytes())
    parts.append(f"\r\n--{boundary}--\r\n".encode("utf-8"))
    body = b"".join(parts)

    req = request.Request(
        f"{base_url.rstrip('/')}/upload/image",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with request.urlopen(req, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return payload.get("name", image_path.name)


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


def queue_prompt(base_url: str, prompt_payload: dict, client_id: str) -> str:
    response = http_json("POST", f"{base_url.rstrip('/')}/prompt", {"prompt": prompt_payload, "client_id": client_id})
    prompt_id = response.get("prompt_id")
    if not prompt_id:
        raise RuntimeError("ComfyUI did not return a prompt_id.")
    return prompt_id


def inject_model_names(workflow_template: dict, checkpoint_name: str, ipadapter_name: str, clip_vision_name: str):
    workflow = apply_placeholders(
        workflow_template,
        {
            "CKPT_NAME": checkpoint_name,
            "IPADAPTER_MODEL": ipadapter_name,
            "CLIP_VISION_MODEL": clip_vision_name,
        },
    )
    for node in workflow.values():
        inputs = node.get("inputs", {})
        if not isinstance(inputs, dict):
            continue
        if inputs.get("ckpt_name") == CHECKPOINT_PLACEHOLDER:
            inputs["ckpt_name"] = checkpoint_name
        if inputs.get("ipadapter_file") == IPADAPTER_PLACEHOLDER and ipadapter_name != IPADAPTER_PLACEHOLDER:
            inputs["ipadapter_file"] = ipadapter_name
        if inputs.get("clip_vision") == CLIP_VISION_PLACEHOLDER and clip_vision_name != CLIP_VISION_PLACEHOLDER:
            inputs["clip_vision"] = clip_vision_name
    return workflow


def wait_for_prompt(base_url: str, prompt_id: str, timeout_seconds: int = 900) -> dict:
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


def download_output_image(base_url: str, image_info: dict, destination: Path) -> None:
    query = parse.urlencode(
        {
            "filename": image_info.get("filename", ""),
            "subfolder": image_info.get("subfolder", ""),
            "type": image_info.get("type", "output"),
        }
    )
    with request.urlopen(f"{base_url.rstrip('/')}/view?{query}", timeout=120) as response:
        destination.write_bytes(response.read())


def extract_identity_frame(source_video_path: str, destination: Path) -> None:
    run_ffmpeg(
        [
            "-y",
            "-ss",
            "0.8",
            "-i",
            source_video_path,
            "-frames:v",
            "1",
            str(destination),
        ]
    )


def resolve_identity_image(payload: dict, job_root: Path) -> Path:
    source_image_path = payload.get("assets", {}).get("sourceImagePath")
    if source_image_path and Path(source_image_path).exists():
        return Path(source_image_path)

    source_video_path = payload.get("assets", {}).get("sourceVideoPath")
    if not source_video_path or not Path(source_video_path).exists():
        raise RuntimeError("No source image or source video was available for identity conditioning.")

    identity_path = job_root / "identity-frame.png"
    if not identity_path.exists():
        extract_identity_frame(source_video_path, identity_path)
    return identity_path


def resolve_ffmpeg() -> str:
    candidates = [
        os.environ.get("PULSEREEL_FFMPEG"),
        str(Path.cwd() / "node_modules" / "ffmpeg-static" / "ffmpeg.exe"),
        str(Path.cwd() / "node_modules" / "ffmpeg-static" / "ffmpeg"),
        "ffmpeg",
    ]
    for candidate in candidates:
        if candidate and (candidate == "ffmpeg" or Path(candidate).exists()):
            return candidate
    return "ffmpeg"


def is_vercel_runtime() -> bool:
    return os.environ.get("VERCEL") == "1" or bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def runtime_asset_dir(folder: str) -> Path:
    if is_vercel_runtime():
        return Path("/tmp") / "pulsereel" / "public" / folder
    return Path.cwd() / "public" / folder


def runtime_asset_url(folder: str, filename: str) -> str:
    return f"/api/assets/{folder}/{filename}"


def run_ffmpeg(args: list[str]) -> None:
    command = [resolve_ffmpeg(), *args]
    process = subprocess.run(command, capture_output=True, text=True)
    if process.returncode != 0:
        raise RuntimeError(f"ffmpeg exited with code {process.returncode}: {process.stderr.strip()}")


def color_filter_for_shot(shot: dict) -> str:
    color_grade = shot.get("colorGrade")
    if color_grade == "warm":
        return "eq=saturation=1.18:contrast=1.05:brightness=0.03:gamma_r=1.04:gamma_b=0.96"
    if color_grade == "cool":
        return "eq=saturation=1.08:contrast=1.04:brightness=0.01:gamma_r=0.96:gamma_b=1.06"
    if color_grade == "teal-orange":
        return "eq=saturation=1.22:contrast=1.08:brightness=0.02"
    return "eq=saturation=1.06:contrast=1.03:brightness=0.00"


def additional_look_filters_for_shot(shot: dict) -> list[str]:
    parts: list[str] = []
    recurring = shot.get("recurringElements", [])
    supporting = shot.get("supportingCast", [])

    if any("haze" in element.lower() or "mist" in element.lower() or "salt-air" in element.lower() for element in recurring):
        parts.append("gblur=sigma=0.5")

    if supporting:
        parts.append("eq=contrast=1.06")

    if any("lantern" in element.lower() or "market" in element.lower() for element in recurring):
        parts.append("curves=preset=strong_contrast")

    return parts


def shot_focus_x_expression(shot: dict) -> str:
    subject_framing = shot.get("subjectFraming")
    if subject_framing == "world-first":
        return "iw/2-(iw/zoom/2)+sin(on/8)*36"
    if subject_framing == "shared-frame":
        return "iw/2-(iw/zoom/2)+sin(on/10)*18"
    if subject_framing == "hero-in-world":
        return "iw/2-(iw/zoom/2)+sin(on/12)*12"
    return "iw/2-(iw/zoom/2)"


def shot_focus_y_expression(shot: dict) -> str:
    subject_framing = shot.get("subjectFraming")
    if subject_framing == "world-first":
        return "ih/2-(ih/zoom/2)-18+cos(on/12)*14"
    if subject_framing == "shared-frame":
        return "ih/2-(ih/zoom/2)+cos(on/11)*12"
    return "ih/2-(ih/zoom/2)+cos(on/14)*8"


def zoom_expression_for_shot(shot: dict) -> str:
    subject_framing = shot.get("subjectFraming")
    motion_energy = shot.get("motionEnergy")
    if subject_framing == "world-first":
        return "1.04+0.0002*on" if motion_energy == "steady" else "1.06"
    if subject_framing == "shared-frame":
        return "1.07+0.0003*sin(on/10)"
    move = shot.get("cameraMove")
    if move == "push-out":
        return "1.14-0.0008*on"
    if move in {"pan-left", "pan-right"}:
        return "1.08"
    if move == "float":
        return "1.06+0.0002*sin(on/9)"
    return "1+0.0008*on"


def x_expression_for_shot(shot: dict) -> str:
    if shot.get("subjectFraming") in {"world-first", "shared-frame"}:
        return shot_focus_x_expression(shot)
    move = shot.get("cameraMove")
    if move == "pan-left":
        return "iw/2-(iw/zoom/2)-sin(on/9)*28"
    if move == "pan-right":
        return "iw/2-(iw/zoom/2)+sin(on/9)*28"
    if move == "float":
        return "iw/2-(iw/zoom/2)+sin(on/11)*10"
    return "iw/2-(iw/zoom/2)"


def y_expression_for_shot(shot: dict) -> str:
    if shot.get("subjectFraming") in {"world-first", "shared-frame"}:
        return shot_focus_y_expression(shot)
    stage = shot.get("stage")
    if stage == "finale":
        return "ih/2-(ih/zoom/2)-cos(on/13)*8"
    if stage == "battle":
        return "ih/2-(ih/zoom/2)+cos(on/10)*18"
    return "ih/2-(ih/zoom/2)+cos(on/16)*10"


def fade_in_duration(shot: dict) -> float:
    if shot.get("motionEnergy") == "gentle":
        return max(0.42, 0.62 if shot.get("transitionStyle") == "drift" else 0.42)
    style = shot.get("transitionStyle")
    if style == "flash":
        return 0.18
    if style == "drift":
        return 0.55
    return 0.35


def fade_out_duration(shot: dict) -> float:
    if shot.get("motionEnergy") == "gentle":
        return max(0.50, 0.72 if shot.get("transitionStyle") == "drift" else 0.50)
    style = shot.get("transitionStyle")
    if style == "flash":
        return 0.22
    if style == "drift":
        return 0.65
    return 0.42


def should_add_motion_insert(shot: dict, index: int, total: int) -> bool:
    if index >= total - 1:
        return False

    return (
        shot.get("continuityGroup") == "conflict"
        or shot.get("worldActivity") == "high"
        or shot.get("shotKind") == "interaction"
        or shot.get("shotKind") == "observer"
        or (shot.get("subjectFraming") == "world-first" and index % 2 == 1)
        or index % 4 == 2
    )


def motion_insert_duration_for_shot(shot: dict) -> float:
    base_duration = float(shot.get("durationSeconds", 5))
    if shot.get("shotKind") == "interaction":
        insert_duration = 2.2
    elif shot.get("shotKind") == "observer" or shot.get("worldActivity") == "high":
        insert_duration = 1.8
    elif shot.get("motionEnergy") == "kinetic":
        insert_duration = 1.6
    else:
        insert_duration = 1.25

    return min(max(1.0, insert_duration), max(1.0, base_duration - 1.4))


def status_phrase_for_shot(shot: dict) -> str:
    if shot.get("shotKind") == "observer" or shot.get("subjectFraming") == "world-first":
        return "world-life beat"
    if shot.get("shotKind") == "interaction" or shot.get("subjectFraming") == "shared-frame":
        return "interaction beat"
    if shot.get("shotKind") == "reaction":
        return "reaction beat"
    return "cinematic beat"


def build_model_prompt(payload: dict, shot: dict) -> str:
    world = payload.get("worldSpec", {})
    extras = ", ".join(world.get("extras", []))
    recurring = ", ".join(shot.get("recurringElements", []))
    cast = ", ".join(shot.get("supportingCast", []))
    return (
        f"{shot.get('prompt', '')}. "
        f"Vertical cinematic movie frame, {shot.get('subjectFraming', 'hero')} composition, "
        f"{shot.get('shotKind', 'establishing')} beat, {shot.get('worldActivity', 'medium')} world activity. "
        f"Setting: {world.get('setting', '')}; landmark: {world.get('landmark', '')}; atmosphere: {world.get('atmosphere', '')}. "
        f"Visible world life: {extras}. Supporting cast: {cast}. Recurring visual motifs: {recurring}. "
        f"Keep the creator identity consistent with the reference image, natural face, realistic lighting, cinematic depth."
    )


def render_still_shot(reference_png_path: str, output_path: str, shot: dict, output_spec: dict) -> None:
    fps = int(output_spec.get("fps", 25))
    duration_seconds = float(shot.get("durationSeconds", 5))
    width = int(output_spec.get("width", 720))
    height = int(output_spec.get("height", 1280))
    fade_in = fade_in_duration(shot)
    fade_out = fade_out_duration(shot)
    vf = ",".join(
        [
            f"scale={width}:{height}:force_original_aspect_ratio=increase",
            f"crop={width}:{height}",
            f"zoompan=z='{zoom_expression_for_shot(shot)}':x='{x_expression_for_shot(shot)}':y='{y_expression_for_shot(shot)}':d={int(duration_seconds * fps)}:s={width}x{height}:fps={fps}",
            color_filter_for_shot(shot),
            *additional_look_filters_for_shot(shot),
            "unsharp=5:5:0.5:5:5:0.0",
            "format=yuv420p",
            f"fade=t=in:st=0:d={fade_in}",
            f"fade=t=out:st={max(0.6, duration_seconds - fade_out)}:d={fade_out}",
        ]
    )
    run_ffmpeg(
        [
            "-y",
            "-loop",
            "1",
            "-i",
            reference_png_path,
            "-vf",
            vf,
            "-t",
            str(duration_seconds),
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            "-an",
            output_path,
        ]
    )


def render_source_motion(
    source_video_path: str,
    output_path: str,
    shot: dict,
    output_spec: dict,
    duration_override: float | None = None,
) -> None:
    fps = int(output_spec.get("fps", 25))
    duration_seconds = float(duration_override or shot.get("durationSeconds", 5))
    width = int(output_spec.get("width", 720))
    height = int(output_spec.get("height", 1280))
    offset_seconds = float(shot.get("sourceClipOffsetSeconds", 0))
    fade_in = min(0.22, fade_in_duration(shot))
    fade_out = min(0.30, fade_out_duration(shot))
    subject_framing = shot.get("subjectFraming")
    crop_x = (
        "x=(in_w-out_w)/2+sin(t*0.9)*52"
        if subject_framing == "world-first"
        else "x=(in_w-out_w)/2+sin(t*0.7)*24"
        if subject_framing == "shared-frame"
        else "x=(in_w-out_w)/2"
    )
    crop_y = (
        "y=(in_h-out_h)/2-26+cos(t*0.7)*18"
        if subject_framing == "world-first"
        else "y=(in_h-out_h)/2-10"
        if shot.get("shotKind") == "reaction"
        else "y=(in_h-out_h)/2"
    )
    motion_texture = (
        "tblend=all_mode=average:all_opacity=0.16"
        if shot.get("shotKind") == "observer" or shot.get("worldActivity") == "high"
        else "tblend=all_mode=average:all_opacity=0.12"
        if shot.get("motionEnergy") == "kinetic"
        else "tblend=all_mode=average:all_opacity=0.07"
    )
    vf = ",".join(
        [
            f"scale={width}:{height}:force_original_aspect_ratio=increase",
            f"crop={width}:{height}:{crop_x}:{crop_y}",
            color_filter_for_shot(shot),
            *additional_look_filters_for_shot(shot),
            "eq=saturation=1.14:contrast=1.05:brightness=0.01",
            "unsharp=5:5:0.6:5:5:0.0",
            motion_texture,
            f"fade=t=in:st=0:d={fade_in}",
            f"fade=t=out:st={max(0.4, duration_seconds - fade_out)}:d={fade_out}",
            "format=yuv420p",
        ]
    )
    run_ffmpeg(
        [
            "-y",
            "-ss",
            str(offset_seconds),
            "-i",
            source_video_path,
            "-t",
            str(duration_seconds),
            "-vf",
            vf,
            "-an",
            "-r",
            str(fps),
            "-pix_fmt",
            "yuv420p",
            output_path,
        ]
    )


def concat_segments(segment_paths: list[str], concat_list_path: Path, output_path: str, output_spec: dict) -> None:
    fps = int(output_spec.get("fps", 25))
    total_duration_seconds = float(output_spec.get("totalDurationSeconds", 60))
    concat_entries = [f"file '{segment_path.replace(chr(39), chr(39) + chr(39))}'" for segment_path in segment_paths]
    concat_list_path.write_text(
        "\n".join(concat_entries),
        encoding="utf-8",
    )
    run_ffmpeg(
        [
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_list_path),
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-r",
            str(fps),
            "-t",
            str(total_duration_seconds),
            "-an",
            output_path,
        ]
    )


def main() -> int:
    if len(sys.argv) != 4:
        raise RuntimeError("Usage: python scripts/comfyui-model-backend.py <payloadPath> <resultPath> <statusPath>")

    payload_path = Path(sys.argv[1])
    result_path = Path(sys.argv[2])
    status_path = Path(sys.argv[3])
    payload = read_json(payload_path)

    base_url = os.environ.get("PULSEREEL_COMFYUI_URL", "").strip() or "http://127.0.0.1:8188"
    workflow_path_value = os.environ.get("PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE", "").strip()
    if not workflow_path_value:
        raise RuntimeError("PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE is required for ComfyUI backend.")
    workflow_path = Path(workflow_path_value)
    if not workflow_path.exists():
        raise RuntimeError(f"ComfyUI workflow template not found: {workflow_path}")
    workflow_template = read_json(workflow_path)
    checkpoint_name = detect_checkpoint_name()
    ipadapter_name = detect_optional_model_name(
        "PULSEREEL_COMFYUI_IPADAPTER_MODEL",
        IPADAPTER_PLACEHOLDER,
        "ipadapter",
        {".bin", ".safetensors"},
    )
    clip_vision_name = detect_optional_model_name(
        "PULSEREEL_COMFYUI_CLIP_VISION_MODEL",
        CLIP_VISION_PLACEHOLDER,
        "clip_vision",
        {".safetensors", ".bin", ".pt"},
    )
    workflow_template = inject_model_names(workflow_template, checkpoint_name, ipadapter_name, clip_vision_name)

    job_root = Path(payload.get("jobRoot", payload_path.parent))
    generated_frames_dir = job_root / "comfyui-frames"
    generated_frames_dir.mkdir(parents=True, exist_ok=True)
    renders_dir = job_root / "comfyui-renders"
    renders_dir.mkdir(parents=True, exist_ok=True)
    identity_image_path = resolve_identity_image(payload, job_root)
    identity_upload_name = upload_image(base_url, identity_image_path, "identity")
    client_id = os.environ.get("PULSEREEL_COMFYUI_CLIENT_ID", str(uuid.uuid4()))
    negative_prompt = os.environ.get("PULSEREEL_COMFYUI_NEGATIVE_PROMPT", "blurry, distorted, low quality, malformed anatomy")

    shot_frame_paths: list[tuple[dict, Path]] = []
    total_shots = max(1, len(payload.get("shotReferences", [])))

    for index, shot in enumerate(payload.get("shotReferences", []), start=1):
        update_status(
            status_path,
            payload,
            f"ComfyUI generating {status_phrase_for_shot(shot)} {index} of {total_shots}",
            min(50, 10 + int((index / total_shots) * 38)),
        )
        uploaded_name = upload_image(base_url, Path(shot["referencePngPath"]))
        replacements = {
            "PROMPT": build_model_prompt(payload, shot),
            "NEGATIVE_PROMPT": negative_prompt,
            "REFERENCE_IMAGE": uploaded_name,
            "SCENE_IMAGE": uploaded_name,
            "IDENTITY_IMAGE": identity_upload_name,
            "OUTPUT_PREFIX": f"{payload['jobId']}-{shot['shotId']}",
            "WIDTH": payload.get("outputSpec", {}).get("width", 720),
            "HEIGHT": payload.get("outputSpec", {}).get("height", 1280),
            "SEED": int(time.time() * 1000) % 2147483647,
            "CKPT_NAME": checkpoint_name,
            "IPADAPTER_MODEL": ipadapter_name,
            "CLIP_VISION_MODEL": clip_vision_name,
        }
        prompt_payload = apply_placeholders(workflow_template, replacements)
        prompt_id = queue_prompt(base_url, prompt_payload, client_id)
        history_entry = wait_for_prompt(base_url, prompt_id)
        image_info = first_output_image(history_entry)
        if not image_info:
            raise RuntimeError(f"ComfyUI returned no image output for shot {shot['shotId']}.")
        frame_path = generated_frames_dir / f"{index:02d}-{shot['shotId']}.png"
        download_output_image(base_url, image_info, frame_path)
        shot_frame_paths.append((shot, frame_path))

    segment_paths: list[str] = []
    for index, (shot, frame_path) in enumerate(shot_frame_paths, start=1):
        shot_output = renders_dir / f"{index:02d}-{shot['shotId']}.mp4"
        zero_index = index - 1
        should_add_motion = should_add_motion_insert(shot, zero_index, len(shot_frame_paths))
        motion_duration = (
            motion_insert_duration_for_shot(shot)
            if should_add_motion and payload.get("assets", {}).get("sourceVideoPath")
            else 0
        )
        still_shot = {
            **shot,
            "durationSeconds": max(1.0, float(shot.get("durationSeconds", 5)) - motion_duration),
        }

        render_still_shot(str(frame_path), str(shot_output), still_shot, payload.get("outputSpec", {}))
        segment_paths.append(str(shot_output))

        if should_add_motion and payload.get("assets", {}).get("sourceVideoPath"):
            motion_output = renders_dir / f"{index:02d}-{shot['shotId']}-motion.mp4"
            render_source_motion(
                payload["assets"]["sourceVideoPath"],
                str(motion_output),
                shot,
                payload.get("outputSpec", {}),
                motion_duration,
            )
            segment_paths.append(str(motion_output))

    update_status(status_path, payload, "ComfyUI backend joining rendered shots", 84)
    generated_dir = runtime_asset_dir("generated")
    generated_dir.mkdir(parents=True, exist_ok=True)
    output_filename = f"{payload['jobId']}-comfyui-open-model.mp4"
    output_path = generated_dir / output_filename
    concat_list_path = renders_dir / "concat.txt"
    concat_segments(segment_paths, concat_list_path, str(output_path), payload.get("outputSpec", {}))

    write_result(result_path, payload, runtime_asset_url("generated", output_filename))
    update_status(status_path, payload, "ComfyUI backend finished the movie", 100, status="completed")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        if len(sys.argv) >= 4:
            try:
                payload = read_json(Path(sys.argv[1]))
                update_status(Path(sys.argv[3]), payload, "ComfyUI backend failed", 0, status="failed", error=str(error))
            except Exception:
                pass
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
