# PulseReel GPU Worker Starter

This is the production worker that your Vercel app can call through:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-worker-domain/pulsereel/render
```

It accepts the PulseReel multipart job package, renders a vertical MP4, serves the output from `/outputs/...`, and returns:

```json
{
  "status": "completed",
  "processedVideoUrl": "https://your-worker-domain/outputs/job-id.mp4"
}
```

## Run Locally

```powershell
cd workers\pulsereel-gpu-worker
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn worker:app --host 0.0.0.0 --port 8000
```

Set your app env:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=http://127.0.0.1:8000/pulsereel/render
```

## Docker

```powershell
docker build -t pulsereel-gpu-worker .
docker run --rm -p 8000:8000 pulsereel-gpu-worker
```

For a public worker, set:

```text
PULSEREEL_WORKER_PUBLIC_BASE_URL=https://your-worker-domain
PULSEREEL_WORKER_TOKEN=your-secret-token
```

Then set the same token in the Vercel app:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=your-secret-token
```

For durable hosted outputs, also set an S3-compatible target such as Cloudflare R2, AWS S3, Backblaze B2 S3, or MinIO:

```text
PULSEREEL_WORKER_STORAGE_BUCKET=your-bucket
PULSEREEL_WORKER_STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com
PULSEREEL_WORKER_STORAGE_REGION=auto
PULSEREEL_WORKER_STORAGE_ACCESS_KEY=...
PULSEREEL_WORKER_STORAGE_SECRET_KEY=...
PULSEREEL_WORKER_STORAGE_PUBLIC_BASE_URL=https://cdn.example.com/pulsereel
PULSEREEL_WORKER_STORAGE_PREFIX=jobs
```

If storage is configured, the worker uploads `final.mp4` there and returns that durable URL as `processedVideoUrl`. If storage is not configured, it falls back to serving `/outputs/...` directly from the worker machine.

## What This Worker Does Today

This starter is intentionally deployable before a full GPU model stack is ready:

- Receives the real PulseReel job package.
- Saves the source video, selfie, poster, and shot reference images.
- Builds a hosted 60-second MP4 from the reference plates and motion inserts.
- Returns a real hosted `processedVideoUrl`.

If these are set on the worker machine:

```text
PULSEREEL_WORKER_COMFYUI_URL=http://127.0.0.1:8188
PULSEREEL_WORKER_COMFYUI_WORKFLOW=/absolute/path/to/ipadapter-portrait-workflow.json
PULSEREEL_WORKER_COMFYUI_NEGATIVE_PROMPT=optional negative prompt
```

the worker will use ComfyUI to generate shot frames first, then assemble the hosted movie from those generated frames plus motion inserts from the source clip.

`GET /health` also reports whether ComfyUI and durable storage are configured, which makes it easier to sanity-check a deployment before pointing Vercel at it.

## Where To Add Real Models

Replace or extend `render_movie()` in `worker.py`.

Good next integrations:

- ComfyUI API calls for image-conditioned frames.
- Wan/CogVideoX/Stable Video Diffusion for shot-level motion.
- Face identity modules using the uploaded `sourceImage` or a frame from `sourceVideo`.
- Object storage upload for durable output URLs.

The Vercel app does not need to change when the worker becomes more powerful. It already sends the full story, identity, shot, and world payload.
