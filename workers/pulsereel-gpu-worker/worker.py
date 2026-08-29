import base64
import json
import mimetypes
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Annotated
from urllib import parse, request as urlrequest
from urllib.error import HTTPError

import boto3
from fastapi import BackgroundTasks, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse

try:
    import cv2
    import numpy as np
except ImportError:  # The worker keeps its legacy fallback until requirements are installed.
    cv2 = None
    np = None


APP_ROOT = Path(__file__).resolve().parent
JOBS_DIR = Path(os.environ.get("PULSEREEL_WORKER_JOBS_DIR", APP_ROOT / "jobs"))
OUTPUT_DIR = Path(os.environ.get("PULSEREEL_WORKER_OUTPUT_DIR", APP_ROOT / "outputs"))
PUBLIC_BASE_URL = os.environ.get("PULSEREEL_WORKER_PUBLIC_BASE_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("PULSEREEL_WORKER_TOKEN", "").strip()
FFMPEG = os.environ.get("PULSEREEL_WORKER_FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("PULSEREEL_WORKER_FFPROBE", "ffprobe")
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
KLING_V3_OMNI_MODEL = "kwaivgi/kling-v3-omni-video"
IDENTITY_REPORT_FILENAME = "identity-anchor-report.json"
QUALITY_REPORT_FILENAME = "identity-quality-report.json"
PORTRAIT_WIDTH = 720
PORTRAIT_HEIGHT = 1280

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


def probe_media(media_path: Path) -> dict:
    process = subprocess.run(
        [
            FFPROBE,
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels",
            "-of",
            "json",
            str(media_path),
        ],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        raise RuntimeError(f"ffprobe exited with code {process.returncode}: {process.stderr.strip()}")

    payload = json.loads(process.stdout or "{}")
    streams = payload.get("streams", [])
    video_stream = next((stream for stream in streams if stream.get("codec_type") == "video"), {})
    audio_stream = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
    return {
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "durationSeconds": round(float(payload.get("format", {}).get("duration") or 0), 3),
        "videoCodec": video_stream.get("codec_name") or "unknown",
        "hasAudio": audio_stream is not None,
        "audioCodec": audio_stream.get("codec_name") if audio_stream else None,
        "audioChannels": int(audio_stream.get("channels") or 0) if audio_stream else 0,
    }


def sample_offsets_for_duration(duration_seconds: float, count: int = 8) -> list[float]:
    if duration_seconds <= 0:
        return [0.8, 2.4, 4.0, 5.6, 7.2, 8.8]
    if count <= 1:
        return [max(0.0, duration_seconds / 2)]
    start = min(0.35, duration_seconds * 0.08)
    end = max(start, duration_seconds - min(0.2, duration_seconds * 0.05))
    return [round(start + ((end - start) * index / (count - 1)), 3) for index in range(count)]


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


def canonical_upload_name(prefix: str, upload: UploadFile | None, fallback_suffix: str) -> str:
    suffix = Path(upload.filename).suffix.lower() if upload and upload.filename else fallback_suffix
    if not suffix or len(suffix) > 10 or not suffix.replace(".", "").isalnum():
        suffix = fallback_suffix
    return f"{prefix}{suffix}"


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


def identity_frame_rank(blur_score: float, brightness: float) -> float:
    exposure_penalty = 0.0
    if brightness < 55:
        exposure_penalty = (55 - brightness) / 6
    elif brightness > 205:
        exposure_penalty = (brightness - 205) / 6
    else:
        exposure_penalty = abs(brightness - 130) / 500
    return blur_score + exposure_penalty


def identity_frame_quality(frame_path: Path) -> float | None:
    process = subprocess.run(
        [
            FFMPEG,
            "-hide_banner",
            "-i",
            str(frame_path),
            "-vf",
            "blurdetect,signalstats,metadata=print",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        return None

    diagnostic_text = f"{process.stdout}\n{process.stderr}"
    blur_match = re.search(r"blur mean:\s*([0-9.]+)", diagnostic_text)
    brightness_match = re.search(r"lavfi\.signalstats\.YAVG=([0-9.]+)", diagnostic_text)
    if not blur_match or not brightness_match:
        return None
    return identity_frame_rank(float(blur_match.group(1)), float(brightness_match.group(1)))


_CASCADE_CACHE: dict[str, object] = {}


def haar_cascade(filename: str):
    if cv2 is None:
        return None
    cached = _CASCADE_CACHE.get(filename)
    if cached is not None:
        return cached
    cascade = cv2.CascadeClassifier(str(Path(cv2.data.haarcascades) / filename))
    if cascade.empty():
        return None
    _CASCADE_CACHE[filename] = cascade
    return cascade


def face_frame_analysis(frame_path: Path) -> dict:
    if cv2 is None or np is None:
        return {
            "faceAware": False,
            "faceDetected": False,
            "faceCount": 0,
            "eyeCount": 0,
            "faceCoverage": 0.0,
            "centeredness": 0.0,
            "rankPenalty": 0.0,
        }

    image = cv2.imread(str(frame_path))
    face_detector = haar_cascade("haarcascade_frontalface_default.xml")
    eye_detector = haar_cascade("haarcascade_eye_tree_eyeglasses.xml")
    if image is None or face_detector is None:
        return {
            "faceAware": True,
            "faceDetected": False,
            "faceCount": 0,
            "eyeCount": 0,
            "faceCoverage": 0.0,
            "centeredness": 0.0,
            "rankPenalty": 500.0,
        }

    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    equalized = cv2.equalizeHist(gray)
    minimum_face = max(36, round(min(width, height) * 0.12))
    faces = face_detector.detectMultiScale(
        equalized,
        scaleFactor=1.08,
        minNeighbors=5,
        minSize=(minimum_face, minimum_face),
    )
    if len(faces) == 0:
        return {
            "faceAware": True,
            "faceDetected": False,
            "faceCount": 0,
            "eyeCount": 0,
            "faceCoverage": 0.0,
            "centeredness": 0.0,
            "rankPenalty": 500.0,
        }

    x, y, face_width, face_height = max(faces, key=lambda face: int(face[2]) * int(face[3]))
    x, y, face_width, face_height = map(int, (x, y, face_width, face_height))
    face_gray = equalized[y : y + face_height, x : x + face_width]
    upper_face = face_gray[: max(1, round(face_height * 0.68)), :]
    eyes = []
    if eye_detector is not None and upper_face.size:
        detected_eyes = eye_detector.detectMultiScale(
            upper_face,
            scaleFactor=1.08,
            minNeighbors=5,
            minSize=(max(10, face_width // 10), max(8, face_height // 12)),
        )
        eyes = sorted(detected_eyes, key=lambda eye: int(eye[2]) * int(eye[3]), reverse=True)[:2]

    face_center_x = x + face_width / 2
    face_center_y = y + face_height / 2
    center_distance = ((face_center_x - width / 2) ** 2 + (face_center_y - height / 2) ** 2) ** 0.5
    maximum_distance = max(1.0, ((width / 2) ** 2 + (height / 2) ** 2) ** 0.5)
    centeredness = max(0.0, 1.0 - center_distance / maximum_distance)
    face_coverage = (face_width * face_height) / max(1, width * height)
    edge_margin = min(x, y, width - (x + face_width), height - (y + face_height)) / max(1, min(width, height))
    face_sharpness = float(cv2.Laplacian(gray[y : y + face_height, x : x + face_width], cv2.CV_64F).var())

    eye_spacing_ratio = None
    eye_line_tilt = None
    if len(eyes) >= 2:
        eye_centers = sorted(
            [(float(ex + ew / 2), float(ey + eh / 2)) for ex, ey, ew, eh in eyes],
            key=lambda point: point[0],
        )
        eye_spacing_ratio = abs(eye_centers[1][0] - eye_centers[0][0]) / max(1, face_width)
        eye_line_tilt = abs(eye_centers[1][1] - eye_centers[0][1]) / max(1, face_height)

    coverage_penalty = 0.0
    if face_coverage < 0.08:
        coverage_penalty = (0.08 - face_coverage) * 900
    elif face_coverage > 0.62:
        coverage_penalty = (face_coverage - 0.62) * 120
    eye_penalty = 0.0 if len(eyes) >= 2 else 18.0 if len(eyes) == 1 else 42.0
    tilt_penalty = max(0.0, float(eye_line_tilt or 0) - 0.07) * 160
    edge_penalty = max(0.0, 0.025 - edge_margin) * 600
    sharpness_penalty = max(0.0, 85.0 - face_sharpness) / 5
    rank_penalty = (
        coverage_penalty
        + eye_penalty
        + tilt_penalty
        + edge_penalty
        + sharpness_penalty
        + ((1.0 - centeredness) * 16)
        + (max(0, len(faces) - 1) * 10)
    )

    return {
        "faceAware": True,
        "faceDetected": True,
        "faceCount": int(len(faces)),
        "eyeCount": int(len(eyes)),
        "faceCoverage": round(float(face_coverage), 4),
        "centeredness": round(float(centeredness), 4),
        "edgeMargin": round(float(edge_margin), 4),
        "faceSharpness": round(face_sharpness, 2),
        "eyeSpacingRatio": round(float(eye_spacing_ratio), 4) if eye_spacing_ratio is not None else None,
        "eyeLineTilt": round(float(eye_line_tilt), 4) if eye_line_tilt is not None else None,
        "faceBox": [x, y, face_width, face_height],
        "rankPenalty": round(float(rank_penalty), 4),
    }


def identity_frame_assessment(frame_path: Path) -> dict:
    base_rank = identity_frame_quality(frame_path)
    face = face_frame_analysis(frame_path)
    rank = (base_rank if base_rank is not None else 100.0) + float(face.get("rankPenalty") or 0)
    return {
        **face,
        "baseImageRank": round(float(base_rank), 4) if base_rank is not None else None,
        "rank": round(float(rank), 4),
    }


def extract_identity_frame(source_video_path: Path, destination: Path) -> dict:
    candidates_dir = destination.parent / f".{destination.stem}-candidates"
    candidates_dir.mkdir(parents=True, exist_ok=True)
    scored_candidates: list[tuple[float, Path, dict]] = []

    try:
        try:
            duration_seconds = float(probe_media(source_video_path).get("durationSeconds") or 0)
        except Exception:
            duration_seconds = 0.0
        offsets = sample_offsets_for_duration(duration_seconds)
        for index, offset in enumerate(offsets):
            candidate = candidates_dir / f"frame-{index}.png"
            process = subprocess.run(
                [
                    FFMPEG,
                    "-y",
                    "-ss",
                    str(offset),
                    "-i",
                    str(source_video_path),
                    "-frames:v",
                    "1",
                    str(candidate),
                ],
                capture_output=True,
                text=True,
            )
            if process.returncode != 0 or not candidate.exists() or candidate.stat().st_size == 0:
                continue
            assessment = identity_frame_assessment(candidate)
            scored_candidates.append((float(assessment["rank"]), candidate, {**assessment, "offsetSeconds": offset}))

        if scored_candidates:
            _, selected, selected_assessment = min(scored_candidates, key=lambda item: item[0])
            shutil.copyfile(selected, destination)
            return {
                "version": "face-aware-anchor-v2",
                "sampledFrames": len(scored_candidates),
                "selectedOffsetSeconds": selected_assessment["offsetSeconds"],
                "selected": selected_assessment,
            }

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
        fallback_assessment = identity_frame_assessment(destination)
        return {
            "version": "face-aware-anchor-v2",
            "sampledFrames": 1,
            "selectedOffsetSeconds": 0.8,
            "selected": {**fallback_assessment, "offsetSeconds": 0.8},
        }
    finally:
        shutil.rmtree(candidates_dir, ignore_errors=True)


def prepare_source_identity_frame(source_video_path: Path | None, uploads_dir: Path) -> Path | None:
    """Materialize the clearest real frame from the creator's uploaded clip."""
    if source_video_path is None:
        return None

    source_frame_path = uploads_dir / "source-identity-frame.png"
    report_path = uploads_dir / IDENTITY_REPORT_FILENAME
    if source_frame_path.exists() and source_frame_path.stat().st_size > 0:
        if not report_path.exists():
            report_path.write_text(
                json.dumps(
                    {
                        "version": "face-aware-anchor-v2",
                        "sampledFrames": 1,
                        "selectedOffsetSeconds": None,
                        "selected": identity_frame_assessment(source_frame_path),
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        return source_frame_path

    report = extract_identity_frame(source_video_path, source_frame_path)
    if not source_frame_path.exists() or source_frame_path.stat().st_size == 0:
        raise RuntimeError(
            "Identity-first generation stopped before model billing because no usable creator frame "
            "could be extracted from the uploaded video. Record or upload a clear clip with your face visible."
        )
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return source_frame_path


def read_identity_anchor_report(job_dir: Path) -> dict | None:
    report_path = job_dir / "uploads" / IDENTITY_REPORT_FILENAME
    if not report_path.exists():
        return None
    try:
        return json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


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


def selected_render_provider(payload: dict) -> str:
    model_hints = payload.get("modelHints", {})
    external_provider = model_hints.get("externalProvider", {})
    if (
        payload.get("provider") == "replicate-video-adapter"
        or payload.get("provider") == "replicate-seedance-1.5-pro"
        or payload.get("provider") == "replicate-kling-v3-omni"
        or model_hints.get("preferredMotionBackend") == "replicate-hosted-video"
        or external_provider.get("provider") == "replicate"
    ):
        return "replicate"
    return "local-heavy-v1"


def is_replicate_job(payload: dict) -> bool:
    return selected_render_provider(payload) == "replicate"


def replicate_model_for_payload(payload: dict, forwarded_model: str | None = None) -> str:
    external_provider = payload.get("modelHints", {}).get("externalProvider", {})
    return str(external_provider.get("model") or forwarded_model or REPLICATE_MODEL).strip()


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


def camera_direction_for_payload(payload: dict) -> str:
    camera_mode = str(payload.get("story", {}).get("cameraMode", "cinematic")).strip().lower()
    if camera_mode == "selfie":
        return (
            "Use a front-facing handheld selfie viewpoint. Keep the same recognizable person in the foreground "
            "while they naturally reveal the requested environment behind them. Use gentle arm-length camera "
            "motion without showing a phone or selfie stick."
        )
    return (
        "Use a separate cinematic camera in a medium or wide portrait composition. This is not a selfie, vlog, "
        "phone recording, first-person view, or outstretched-arm shot. Keep the person and environment readable."
    )


def kling_duration_seconds() -> int:
    try:
        requested = int(os.environ.get("PULSEREEL_KLING_DURATION_SECONDS", "15"))
    except ValueError:
        requested = 15
    return min(15, max(3, requested))


def kling_mode() -> str:
    requested = os.environ.get("PULSEREEL_KLING_MODE", "standard").strip().lower()
    return requested if requested in {"standard", "pro", "4k"} else "standard"


def distributed_shot_durations(total_duration: int, shot_count: int) -> list[int]:
    if shot_count <= 0:
        return []
    base = total_duration // shot_count
    durations = [base] * shot_count
    for index in range(total_duration - (base * shot_count)):
        durations[index] += 1
    return durations


def selected_story_shots(payload: dict, maximum: int = 3) -> list[dict]:
    shots = [shot for shot in payload.get("shots", []) if shot.get("prompt")]
    if len(shots) <= maximum:
        return shots
    indices = [0, len(shots) // 2, len(shots) - 1]
    return [shots[index] for index in indices]


def build_kling_input(payload: dict, identity_data_uri: str, reference_image_data_uri: str) -> dict:
    duration = kling_duration_seconds()
    reference_data_uri = identity_data_uri or reference_image_data_uri
    identity_phrase = (
        "<<<image_1>>> is the same main character in every shot. Preserve this person's face, skin tone, "
        "body proportions, and recognizable identity."
        if reference_data_uri
        else "Keep the same main character and appearance in every shot."
    )
    story_prompt = str(payload.get("story", {}).get("scenePrompt") or build_replicate_prompt(payload)).strip()
    camera_direction = camera_direction_for_payload(payload)
    score_mood = str(payload.get("styleBible", {}).get("scoreMood", "cinematic atmospheric score")).strip()
    overall_prompt = (
        f"Create a coherent vertical live-action movie. {identity_phrase} Story: {story_prompt} {camera_direction} "
        f"Use photorealistic people, natural skin texture, believable background characters, realistic physics, "
        f"cinematic lighting, synchronized environmental sounds, movement sounds, and {score_mood}. "
        "No captions, logos, distorted faces, duplicate people, or unintelligible dialogue."
    )[:2500]

    selected_shots = selected_story_shots(payload)
    if not selected_shots:
        selected_shots = [{"prompt": story_prompt}]
    shot_durations = distributed_shot_durations(duration, len(selected_shots))
    multi_prompt = []
    for shot, shot_duration in zip(selected_shots, shot_durations):
        shot_prompt = str(shot.get("prompt") or story_prompt).strip()
        multi_prompt.append(
            {
                "prompt": (
                    f"{identity_phrase} {shot_prompt} Photorealistic live action, natural motion and ambient sound, "
                    "cinematic portrait framing."
                )[:900],
                "duration": shot_duration,
            }
        )

    request_input = {
        "mode": kling_mode(),
        "prompt": overall_prompt,
        "duration": duration,
        "aspect_ratio": "9:16",
        "multi_prompt": json.dumps(multi_prompt),
        "generate_audio": True,
    }
    if reference_data_uri:
        request_input["reference_images"] = [reference_data_uri]
    return request_input


def build_seedance_15_input(
    payload: dict,
    identity_data_uri: str,
    reference_image_data_uri: str,
    source_frame_data_uri: str = "",
) -> dict:
    image_data_uri = source_frame_data_uri or identity_data_uri or reference_image_data_uri
    prompt = build_replicate_prompt(payload)
    camera_direction = camera_direction_for_payload(payload)
    request_input = {
        "prompt": (
            "IDENTITY LOCK: The real person in the supplied starting frame is the main character and must remain "
            "clearly recognizable throughout the movie. Keep their exact facial structure, skin tone, hair, age, "
            "body proportions, and distinguishing features; never replace them with a different actor. "
            f"Story: {prompt} {camera_direction} Place that same person naturally inside the requested setting and "
            "make them perform the requested action while their face remains readable. Photorealistic live action, "
            "realistic background people, natural motion, stable anatomy, natural skin texture, and synchronized "
            "ambient sound. Continue as one coherent shot with one readable action. No montage, captions, interface "
            "graphics, invented writing, logos, distorted faces, face morphing, identity drift, or duplicate people."
        )[:2500],
        "duration": 5,
        "resolution": "480p",
        "aspect_ratio": "9:16",
        "generate_audio": True,
        "fps": 24,
        "camera_fixed": False,
    }
    if image_data_uri:
        request_input["image"] = image_data_uri
    return request_input


def build_replicate_input(
    payload: dict,
    references: dict[int, Path],
    identity_image: Path | None,
    source_video: Path | None,
    input_template: str | None = None,
    model: str | None = None,
    source_frame_image: Path | None = None,
) -> dict:
    prompt = build_replicate_prompt(payload)
    identity_data_uri = file_to_data_uri(identity_image)
    source_frame_data_uri = file_to_data_uri(source_frame_image)
    reference_image_data_uri = file_to_data_uri(first_reference_image(references))
    identity_anchor_data_uri = identity_data_uri or source_frame_data_uri
    image_data_uri = source_frame_data_uri or identity_anchor_data_uri or reference_image_data_uri
    video_data_uri = file_to_data_uri(source_video)
    output_spec = payload.get("outputSpec", {})
    replacements = {
        "PROMPT": prompt,
        "SOURCE_IMAGE_URL": image_data_uri,
        "SOURCE_VIDEO_URL": video_data_uri,
        "IDENTITY_IMAGE": identity_anchor_data_uri,
        "SOURCE_VIDEO": video_data_uri,
        "WIDTH": output_spec.get("width", 720),
        "HEIGHT": output_spec.get("height", 1280),
        "DURATION_SECONDS": min(8, int(float(output_spec.get("totalDurationSeconds", 5)))),
        "ASPECT_RATIO": "9:16",
    }

    normalized_model = normalize_replicate_model(model or replicate_model_for_payload(payload))
    if not identity_anchor_data_uri:
        raise RuntimeError(
            "Identity-first generation stopped before model billing because no usable creator frame was available. "
            "Record or upload a clear clip with your face visible."
        )
    template_value = (input_template or REPLICATE_INPUT_TEMPLATE).strip()
    if template_value:
        template = json.loads(template_value)
        request_input = apply_placeholders(template, replacements)
        if normalized_model == "minimax/video-01":
            if request_input.get("subject_reference") and request_input.get("first_frame_image"):
                request_input.pop("first_frame_image")
            if not request_input.get("subject_reference"):
                raise RuntimeError(
                    "Identity-first generation stopped before model billing: the MiniMax input template must send "
                    "{{IDENTITY_IMAGE}} as subject_reference."
                )
        elif normalized_model == "bytedance/seedance-1.5-pro" and not request_input.get("image"):
            raise RuntimeError(
                "Identity-first generation stopped before model billing: the Seedance input template must send "
                "{{SOURCE_IMAGE_URL}} or {{IDENTITY_IMAGE}} as image."
            )
        elif normalized_model == KLING_V3_OMNI_MODEL and not request_input.get("reference_images"):
            raise RuntimeError(
                "Identity-first generation stopped before model billing: the Kling input template must include "
                "the creator in reference_images."
            )
        return request_input

    if normalized_model == KLING_V3_OMNI_MODEL:
        return build_kling_input(payload, identity_anchor_data_uri, reference_image_data_uri)

    if normalized_model == "bytedance/seedance-1.5-pro":
        return build_seedance_15_input(
            payload,
            identity_anchor_data_uri,
            reference_image_data_uri,
            source_frame_data_uri,
        )

    if normalized_model == "minimax/video-01":
        camera_direction = camera_direction_for_payload(payload)
        request_input = {
            "prompt": (
                "Use the supplied subject reference as the non-negotiable main character. Preserve the exact face, "
                "skin tone, hair, age, body proportions, and recognizable identity throughout. Never substitute a "
                "different actor. Keep natural-sized eyes with normal blinking, a relaxed gaze, realistic pupils, "
                "and relaxed closed lips unless the story explicitly requires speaking. Avoid a fixed stare, "
                "wide-eyed surprise, an open frozen mouth, exaggerated teeth, facial warping, or expression drift. "
                f"{camera_direction} Keep the creator clearly visible while performing this story: {prompt}"
            )[:2000],
            "prompt_optimizer": True,
            "subject_reference": identity_anchor_data_uri,
        }
        return request_input

    request_input = {"prompt": prompt, "aspect_ratio": "9:16", "duration": replacements["DURATION_SECONDS"]}
    if image_data_uri:
        request_input["image"] = image_data_uri
        request_input["input_image"] = image_data_uri
        request_input["start_image"] = image_data_uri
        request_input["first_frame_image"] = image_data_uri
    return request_input


def replicate_request_json(req: urlrequest.Request, timeout_seconds: int) -> dict:
    try:
        with urlrequest.urlopen(req, timeout=timeout_seconds) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        response_text = error.read().decode("utf-8", errors="replace")
        try:
            response_payload = json.loads(response_text)
            detail = response_payload.get("detail") or response_payload.get("error") or response_text
        except json.JSONDecodeError:
            detail = response_text
        raise RuntimeError(f"Replicate API returned {error.code}: {detail}") from error


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
    return replicate_request_json(req, 180)


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
        prediction = replicate_request_json(req, 120)
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


def normalization_strategy(width: int, height: int) -> str:
    if width <= 0 or height <= 0:
        return "unavailable"
    aspect_ratio = width / height
    portrait_ratio = PORTRAIT_WIDTH / PORTRAIT_HEIGHT
    return "native-portrait" if abs(aspect_ratio - portrait_ratio) <= 0.015 else "blurred-background"


def normalize_output_to_portrait(source_path: Path, destination: Path) -> dict:
    before = probe_media(source_path)
    strategy = normalization_strategy(int(before["width"]), int(before["height"]))

    if strategy == "native-portrait" and before["width"] == PORTRAIT_WIDTH and before["height"] == PORTRAIT_HEIGHT:
        shutil.move(str(source_path), str(destination))
    else:
        args = ["-y", "-i", str(source_path)]
        if strategy == "native-portrait":
            args.extend(
                [
                    "-vf",
                    f"scale={PORTRAIT_WIDTH}:{PORTRAIT_HEIGHT}:flags=lanczos,format=yuv420p",
                    "-map",
                    "0:v:0",
                ]
            )
        else:
            filter_graph = (
                f"[0:v]split=2[background][foreground];"
                f"[background]scale={PORTRAIT_WIDTH}:{PORTRAIT_HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={PORTRAIT_WIDTH}:{PORTRAIT_HEIGHT},gblur=sigma=28[background_ready];"
                f"[foreground]scale={PORTRAIT_WIDTH}:{PORTRAIT_HEIGHT}:force_original_aspect_ratio=decrease:"
                f"flags=lanczos[foreground_ready];"
                f"[background_ready][foreground_ready]overlay=(W-w)/2:(H-h)/2,format=yuv420p[video]"
            )
            args.extend(["-filter_complex", filter_graph, "-map", "[video]"])

        if before["hasAudio"]:
            args.extend(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "128k"])
        else:
            args.append("-an")
        args.extend(
            [
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-crf",
                "18",
                "-movflags",
                "+faststart",
                str(destination),
            ]
        )
        run_ffmpeg(args)
        source_path.unlink(missing_ok=True)

    after = probe_media(destination)
    return {
        "requestedAspectRatio": "9:16",
        "strategy": strategy,
        "source": before,
        "final": after,
    }


def face_signature(frame_path: Path) -> tuple[dict | None, dict]:
    analysis = face_frame_analysis(frame_path)
    if cv2 is None or np is None or not analysis.get("faceDetected"):
        return None, analysis

    image = cv2.imread(str(frame_path))
    if image is None:
        return None, analysis
    x, y, width, height = map(int, analysis["faceBox"])
    face = image[y : y + height, x : x + width]
    if face.size == 0:
        return None, analysis

    gray = cv2.cvtColor(face, cv2.COLOR_BGR2GRAY)
    normalized = cv2.equalizeHist(cv2.resize(gray, (96, 96), interpolation=cv2.INTER_AREA))
    dct = cv2.dct(normalized.astype(np.float32) / 255.0)[1:17, 1:17].flatten()
    dct = dct / max(float(np.linalg.norm(dct)), 1e-6)
    histogram = cv2.calcHist([normalized], [0], None, [64], [0, 256]).flatten()
    histogram = histogram / max(float(np.linalg.norm(histogram)), 1e-6)
    return {"structure": dct, "histogram": histogram}, analysis


def cosine_similarity(left, right) -> float:
    if np is None:
        return 0.0
    denominator = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denominator <= 1e-8:
        return 0.0
    return max(0.0, min(1.0, (float(np.dot(left, right)) + 1.0) / 2.0))


def signature_similarity(left: dict | None, right: dict | None) -> float | None:
    if not left or not right:
        return None
    structural = cosine_similarity(left["structure"], right["structure"])
    histogram = cosine_similarity(left["histogram"], right["histogram"])
    return round((structural * 0.72) + (histogram * 0.28), 4)


def identity_quality_flags(
    face_detection_rate: float,
    anchor_similarity: float | None,
    temporal_consistency: float | None,
    landmark_stability: float | None,
    eye_readability_rate: float,
) -> list[str]:
    flags: list[str] = []
    if face_detection_rate < 0.65:
        flags.append("The creator's face becomes unreadable in several sampled frames.")
    if anchor_similarity is not None and anchor_similarity < 0.36:
        flags.append("Possible severe identity drift from the selected creator frame.")
    if temporal_consistency is not None and temporal_consistency < 0.46:
        flags.append("The face changes abruptly between nearby frames.")
    if landmark_stability is not None and landmark_stability < 0.5:
        flags.append("Facial proportions appear unstable during motion.")
    if eye_readability_rate < 0.4:
        flags.append("Eyes or upper-face landmarks are not consistently natural and readable.")
    return flags


def analyze_generated_identity(anchor_path: Path | None, video_path: Path, job_dir: Path) -> dict:
    media = probe_media(video_path)
    if cv2 is None or np is None:
        return {
            "status": "review",
            "score": None,
            "sampledFrames": 0,
            "faceDetectionRate": None,
            "anchorSimilarity": None,
            "temporalConsistency": None,
            "landmarkStability": None,
            "eyeReadabilityRate": None,
            "flags": ["Face-aware quality checking is unavailable until worker dependencies are installed."],
        }

    anchor_signature, anchor_analysis = face_signature(anchor_path) if anchor_path else (None, {})
    samples_dir = job_dir / ".identity-quality-samples"
    samples_dir.mkdir(parents=True, exist_ok=True)
    signatures: list[dict] = []
    analyses: list[dict] = []
    anchor_similarities: list[float] = []
    temporal_similarities: list[float] = []

    try:
        offsets = sample_offsets_for_duration(float(media.get("durationSeconds") or 0), count=8)
        previous_signature = None
        for index, offset in enumerate(offsets):
            frame_path = samples_dir / f"frame-{index}.jpg"
            process = subprocess.run(
                [FFMPEG, "-y", "-ss", str(offset), "-i", str(video_path), "-frames:v", "1", str(frame_path)],
                capture_output=True,
                text=True,
            )
            if process.returncode != 0 or not frame_path.exists():
                continue
            signature, analysis = face_signature(frame_path)
            analyses.append(analysis)
            if signature is None:
                continue
            signatures.append(signature)
            similarity = signature_similarity(anchor_signature, signature)
            if similarity is not None:
                anchor_similarities.append(similarity)
            adjacent_similarity = signature_similarity(previous_signature, signature)
            if adjacent_similarity is not None:
                temporal_similarities.append(adjacent_similarity)
            previous_signature = signature
    finally:
        shutil.rmtree(samples_dir, ignore_errors=True)

    sampled_frames = len(analyses)
    detected = [analysis for analysis in analyses if analysis.get("faceDetected")]
    face_detection_rate = len(detected) / max(1, sampled_frames)
    eye_readability_rate = len([analysis for analysis in detected if int(analysis.get("eyeCount") or 0) >= 2]) / max(1, sampled_frames)
    anchor_similarity = sum(anchor_similarities) / len(anchor_similarities) if anchor_similarities else None
    temporal_consistency = sum(temporal_similarities) / len(temporal_similarities) if temporal_similarities else None

    landmark_values = [
        (float(analysis["eyeSpacingRatio"]), float(analysis["eyeLineTilt"]))
        for analysis in detected
        if analysis.get("eyeSpacingRatio") is not None and analysis.get("eyeLineTilt") is not None
    ]
    landmark_stability = None
    if len(landmark_values) >= 2 and np is not None:
        spacing_std = float(np.std([value[0] for value in landmark_values]))
        tilt_std = float(np.std([value[1] for value in landmark_values]))
        landmark_stability = max(0.0, min(1.0, 1.0 - (spacing_std * 4.0) - (tilt_std * 8.0)))

    flags = identity_quality_flags(
        face_detection_rate,
        anchor_similarity,
        temporal_consistency,
        landmark_stability,
        eye_readability_rate,
    )
    weighted_metrics = [
        (face_detection_rate, 0.3),
        (anchor_similarity, 0.32),
        (temporal_consistency, 0.2),
        (landmark_stability, 0.1),
        (eye_readability_rate, 0.08),
    ]
    available_weight = sum(weight for value, weight in weighted_metrics if value is not None)
    score = (
        sum(float(value) * weight for value, weight in weighted_metrics if value is not None) / available_weight
        if available_weight
        else None
    )
    if not anchor_analysis.get("faceDetected"):
        flags.insert(0, "The selected identity anchor did not contain a reliably detected frontal face.")

    return {
        "status": "pass" if not flags else "review",
        "score": round(float(score), 4) if score is not None else None,
        "sampledFrames": sampled_frames,
        "faceDetectionRate": round(float(face_detection_rate), 4),
        "anchorSimilarity": round(float(anchor_similarity), 4) if anchor_similarity is not None else None,
        "temporalConsistency": round(float(temporal_consistency), 4) if temporal_consistency is not None else None,
        "landmarkStability": round(float(landmark_stability), 4) if landmark_stability is not None else None,
        "eyeReadabilityRate": round(float(eye_readability_rate), 4),
        "flags": flags,
    }


def write_quality_report(job_dir: Path, report: dict) -> None:
    (job_dir / QUALITY_REPORT_FILENAME).write_text(json.dumps(report, indent=2), encoding="utf-8")


def read_quality_report(job_dir: Path) -> dict | None:
    report_path = job_dir / QUALITY_REPORT_FILENAME
    if not report_path.exists():
        return None
    try:
        return json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def finalize_generated_movie(
    job_dir: Path,
    output_path: Path,
    payload: dict,
    identity_image: Path | None,
    source_frame_image: Path | None,
    model: str,
    elapsed_seconds: float,
) -> tuple[Path, dict]:
    normalized_model = normalize_replicate_model(model) if model else "local-heavy-v1"
    final_path = OUTPUT_DIR / f"{payload.get('jobId', uuid.uuid4().hex)}-portrait.mp4"
    normalization = normalize_output_to_portrait(output_path, final_path)
    effective_anchor = source_frame_image if normalized_model == "bytedance/seedance-1.5-pro" else identity_image
    identity_report = analyze_generated_identity(effective_anchor, final_path, job_dir)
    report = {
        "version": "identity-quality-v2",
        "provider": payload.get("provider") or selected_render_provider(payload),
        "model": normalized_model,
        "elapsedSeconds": round(elapsed_seconds, 3),
        "anchor": read_identity_anchor_report(job_dir),
        "normalization": normalization,
        "identity": identity_report,
    }
    write_quality_report(job_dir, report)
    return final_path, report


def render_replicate_movie(
    job_dir: Path,
    payload: dict,
    source_video: Path | None,
    references: dict[int, Path],
    identity_image: Path | None,
    replicate_token: str | None,
    input_template: str | None = None,
    replicate_model: str | None = None,
    source_frame_image: Path | None = None,
) -> Path | None:
    if not is_replicate_job(payload):
        return None

    token = (replicate_token or REPLICATE_API_TOKEN).strip()
    model = replicate_model_for_payload(payload, replicate_model)
    if not token:
        raise RuntimeError(
            "Replicate AI was selected, but PULSEREEL_REPLICATE_API_TOKEN was not provided to the worker."
        )
    if not model:
        raise RuntimeError("Replicate AI was selected, but PULSEREEL_REPLICATE_MODEL is not configured.")

    request_input = build_replicate_input(
        payload,
        references,
        identity_image,
        source_video,
        input_template,
        model,
        source_frame_image,
    )
    prediction = replicate_prediction_request(token, model, request_input)
    prediction = poll_replicate_prediction(token, prediction)
    output_url = find_output_url(prediction.get("output"))
    if not output_url:
        raise RuntimeError("Replicate finished but did not return a video URL.")

    output_path = OUTPUT_DIR / f"{payload.get('jobId', uuid.uuid4().hex)}-replicate-raw.mp4"
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
        "identityFrameSelection": "face-aware-anchor-v2",
        "identityQualityCheck": "identity-quality-v2",
        "outputNormalization": "safe-portrait-9:16-v1",
        "replicateProfiles": ["minimax/video-01", "bytedance/seedance-1.5-pro", KLING_V3_OMNI_MODEL],
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
    source_video_path = await save_upload(
        source_video,
        uploads_dir / canonical_upload_name("source-video", source_video, ".webm"),
    )
    source_image_path = await save_upload(
        source_image,
        uploads_dir / canonical_upload_name("source-image", source_image, ".png"),
    )
    await save_upload(poster, uploads_dir / canonical_upload_name("poster", poster, ".svg"))

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

    source_frame_image = prepare_source_identity_frame(source_video_path, uploads_dir)
    identity_image = source_image_path or source_frame_image

    return payload_json, source_video_path, reference_paths, identity_image


def render_queued_job(
    job_id: str,
    public_base_url: str,
    replicate_token: str | None = None,
    replicate_input_template: str | None = None,
    replicate_model: str | None = None,
) -> None:
    job_dir = JOBS_DIR / job_id
    uploads_dir = job_dir / "uploads"
    payload_path = uploads_dir / "payload.json"
    try:
        render_started_at = time.time()
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
        source_frame_image = prepare_source_identity_frame(source_video_path, uploads_dir)
        saved_identity_frame = uploads_dir / "identity-frame.png"
        if identity_image is None and saved_identity_frame.exists():
            identity_image = saved_identity_frame
        identity_image = identity_image or source_frame_image

        reference_paths: dict[int, Path] = {}
        for item in uploads_dir.iterdir():
            if not item.is_file() or not item.name.startswith("reference_"):
                continue
            try:
                index = int(item.name.split("-", 1)[0].replace("reference_", ""))
            except ValueError:
                continue
            reference_paths[index] = item

        if is_replicate_job(payload_json):
            selected_model = replicate_model_for_payload(payload_json, replicate_model)
            write_async_status(job_id, {"status": "running", "progress": 36, "stage": "Sending scene to Replicate"})
            output_path = render_replicate_movie(
                job_dir,
                payload_json,
                source_video_path,
                reference_paths,
                identity_image,
                replicate_token,
                replicate_input_template,
                replicate_model,
                source_frame_image,
            )
        else:
            selected_model = str(payload_json.get("provider") or "local-heavy-v1")
            write_async_status(job_id, {"status": "running", "progress": 42, "stage": "Rendering movie segments"})
            output_path = render_movie(job_dir, payload_json, source_video_path, reference_paths, identity_image)
        if output_path is None:
            raise RuntimeError("Selected renderer did not return a movie.")
        write_async_status(job_id, {"status": "running", "progress": 88, "stage": "Checking identity and portrait framing"})
        output_path, quality_report = finalize_generated_movie(
            job_dir,
            output_path,
            payload_json,
            identity_image,
            source_frame_image,
            selected_model,
            time.time() - render_started_at,
        )
        video_url = final_video_url_from_base(public_base_url, output_path, job_id)
        write_async_status(
            job_id,
            {
                "status": "completed",
                "progress": 100,
                "stage": "Movie ready",
                "processedVideoUrl": video_url,
                "shotPlan": payload_json.get("shots", []),
                "model": normalize_replicate_model(selected_model),
                "qualityReport": quality_report,
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
    x_pulsereel_replicate_model: Annotated[str | None, Header()] = None,
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
        x_pulsereel_replicate_model,
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
    x_pulsereel_replicate_model: Annotated[str | None, Header()] = None,
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
    source_video_path = await save_upload(
        sourceVideo,
        uploads_dir / canonical_upload_name("source-video", sourceVideo, ".webm"),
    )
    source_image_path = await save_upload(
        sourceImage,
        uploads_dir / canonical_upload_name("source-image", sourceImage, ".png"),
    )
    await save_upload(poster, uploads_dir / canonical_upload_name("poster", poster, ".svg"))

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

    source_frame_image = prepare_source_identity_frame(source_video_path, uploads_dir)
    identity_image = source_image_path or source_frame_image

    render_started_at = time.time()
    try:
        if is_replicate_job(payload_json):
            selected_model = replicate_model_for_payload(payload_json, x_pulsereel_replicate_model)
            output_path = render_replicate_movie(
                job_dir,
                payload_json,
                source_video_path,
                reference_paths,
                identity_image,
                x_pulsereel_replicate_token,
                x_pulsereel_replicate_input_template,
                x_pulsereel_replicate_model,
                source_frame_image,
            )
        else:
            selected_model = str(payload_json.get("provider") or "local-heavy-v1")
            output_path = render_movie(job_dir, payload_json, source_video_path, reference_paths, identity_image)
        if output_path is None:
            raise RuntimeError("Selected renderer did not return a movie.")
        output_path, quality_report = finalize_generated_movie(
            job_dir,
            output_path,
            payload_json,
            identity_image,
            source_frame_image,
            selected_model,
            time.time() - render_started_at,
        )
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
        "model": normalize_replicate_model(selected_model),
        "qualityReport": quality_report,
    }
