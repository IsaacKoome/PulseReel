import json
import os
import subprocess
import sys
from datetime import datetime, UTC
from pathlib import Path
from urllib import request


def update_status(
    status_path: Path,
    payload: dict,
    stage: str,
    progress: int,
    status: str = "running",
    error: str | None = None,
) -> None:
    status_path.write_text(
        json.dumps(
            {
                "jobId": payload.get("jobId", "unknown"),
                "provider": "open-model-adapter",
                "status": status,
                "stage": stage,
                "progress": progress,
                "error": error,
                "updatedAt": datetime.now(UTC).isoformat(),
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
                "completedAt": datetime.now(UTC).isoformat(),
                "processedVideoUrl": processed_video_url,
                "shotPlan": payload.get("shots", []),
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def default_backend_command(payload_path: Path, result_path: Path, status_path: Path) -> list[str] | None:
    comfy_url = os.environ.get("PULSEREEL_COMFYUI_URL", "").strip()
    comfy_workflow = os.environ.get("PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE", "").strip()
    if not comfy_url or not comfy_workflow:
        return None

    if not Path(comfy_workflow).exists():
        return None

    checkpoint_override = os.environ.get("PULSEREEL_COMFYUI_CHECKPOINT", "").strip()
    checkpoint_dir = Path.cwd() / "tools" / "ComfyUI" / "models" / "checkpoints"
    if checkpoint_override:
        if not Path(checkpoint_override).exists() and not (checkpoint_dir / checkpoint_override).exists():
            return None
    elif not checkpoint_dir.exists() or not any(
        entry.is_file()
        and entry.suffix.lower() in {".safetensors", ".ckpt", ".pt"}
        and "put_checkpoints_here" not in entry.name.lower()
        for entry in checkpoint_dir.iterdir()
    ):
        return None

    try:
        with request.urlopen(f"{comfy_url.rstrip('/')}/system_stats", timeout=5) as response:
            if response.status != 200:
                return None
    except Exception:
        return None

    comfy_script = Path(__file__).with_name("comfyui-model-backend.py")
    return [sys.executable, str(comfy_script), str(payload_path), str(result_path), str(status_path)]


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


def render_local_fallback(payload: dict, result_path: Path, status_path: Path) -> None:
    job_root = Path(payload.get("jobRoot", Path(result_path).parent))
    renders_dir = job_root / "python-runner-renders"
    renders_dir.mkdir(parents=True, exist_ok=True)

    update_status(status_path, payload, "Python motion bridge preparing cinematic shot sequence", 24)

    segment_paths: list[str] = []
    shot_references = payload.get("shotReferences", [])
    for index, shot in enumerate(shot_references, start=1):
        shot_output = renders_dir / f"{index:02d}-{shot['shotId']}.mp4"
        zero_index = index - 1
        should_add_motion = should_add_motion_insert(shot, zero_index, len(shot_references))
        motion_duration = (
            motion_insert_duration_for_shot(shot)
            if should_add_motion and payload.get("assets", {}).get("sourceVideoPath")
            else 0
        )
        still_shot = {
            **shot,
            "durationSeconds": max(1.0, float(shot.get("durationSeconds", 5)) - motion_duration),
        }

        render_still_shot(shot["referencePngPath"], str(shot_output), still_shot, payload.get("outputSpec", {}))
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

        update_status(
            status_path,
            payload,
            f"Python motion bridge rendering {status_phrase_for_shot(shot)} {index} of {len(shot_references)}",
            min(80, 28 + int((index / max(1, len(shot_references))) * 48)),
        )

    generated_dir = runtime_asset_dir("generated")
    generated_dir.mkdir(parents=True, exist_ok=True)
    output_filename = f"{payload['jobId']}-python-open-model.mp4"
    output_path = generated_dir / output_filename
    concat_list_path = renders_dir / "concat.txt"

    update_status(status_path, payload, "Python motion bridge joining cinematic shots with smoother continuity", 86)
    concat_segments(segment_paths, concat_list_path, str(output_path), payload.get("outputSpec", {}))
    write_result(result_path, payload, runtime_asset_url("generated", output_filename))
    update_status(status_path, payload, "Python motion bridge finished the cinematic movie", 100, status="completed")


def run_external_backend(payload: dict, payload_path: Path, result_path: Path, status_path: Path) -> bool:
    template = os.environ.get("PULSEREEL_MODEL_BACKEND_COMMAND", "").strip()
    command_list = default_backend_command(payload_path, result_path, status_path)

    if template:
        command_text = (
            template.replace("{payload}", str(payload_path))
            .replace("{result}", str(result_path))
            .replace("{status}", str(status_path))
        )
        update_status(status_path, payload, "Python bridge launching external model backend", 12)
        process = subprocess.run(command_text, shell=True, capture_output=True, text=True)
    elif command_list:
        update_status(status_path, payload, "Python bridge launching ComfyUI backend", 12)
        process = subprocess.run(command_list, capture_output=True, text=True)
    else:
        return False

    if process.returncode != 0:
        update_status(
            status_path,
            payload,
            "External model backend failed, using Python fallback",
            18,
            error=process.stderr.strip() or f"Backend exited with code {process.returncode}",
        )
        return False

    if not result_path.exists():
        update_status(
            status_path,
            payload,
            "External model backend returned no result, using Python fallback",
            18,
        )
        return False

    result = read_json(result_path)
    if result.get("status") == "completed" and result.get("processedVideoUrl"):
        update_status(status_path, payload, "External model backend produced a movie", 100, status="completed")
        return True

    update_status(
        status_path,
        payload,
        "External model backend did not produce a usable movie, using Python fallback",
        18,
        error=result.get("error"),
    )
    return False


def main() -> int:
    if len(sys.argv) != 4:
        raise RuntimeError("Usage: python scripts/python-motion-bridge.py <payloadPath> <resultPath> <statusPath>")

    payload_path = Path(sys.argv[1])
    result_path = Path(sys.argv[2])
    status_path = Path(sys.argv[3])
    payload = read_json(payload_path)

    if run_external_backend(payload, payload_path, result_path, status_path):
        return 0

    render_local_fallback(payload, result_path, status_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        if len(sys.argv) >= 4:
            try:
                payload = read_json(Path(sys.argv[1]))
                update_status(Path(sys.argv[3]), payload, "Python motion bridge failed", 0, status="failed", error=str(error))
            except Exception:
                pass
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
