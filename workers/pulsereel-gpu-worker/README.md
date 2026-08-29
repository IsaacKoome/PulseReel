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
powershell -ExecutionPolicy Bypass -File .\start-worker.ps1
```

You can also copy `.env.example` to `.env` first, then the PowerShell starter will load it automatically.

Set your app env:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=http://127.0.0.1:8000/pulsereel/render
```

For a public Vercel deployment, this must be a public HTTPS worker URL, not `127.0.0.1`.

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
- Adds an AAC ambient audio bed by default so generated movies are not silent.
- Returns a real hosted `processedVideoUrl`.

To disable the generated audio bed, set:

```text
PULSEREEL_WORKER_ENABLE_AUDIO_BED=0
```

If these are set on the worker machine:

```text
PULSEREEL_WORKER_COMFYUI_URL=http://127.0.0.1:8188
PULSEREEL_WORKER_COMFYUI_WORKFLOW=/absolute/path/to/ipadapter-portrait-workflow.json
PULSEREEL_WORKER_COMFYUI_NEGATIVE_PROMPT=optional negative prompt
```

the worker will use ComfyUI to generate shot frames first, then assemble the hosted movie from those generated frames plus motion inserts from the source clip.

The worker now also consumes richer continuity metadata from PulseReel:

- character identity anchors and wardrobe anchors
- shot emotional beats and camera goals
- continuity anchors plus previous/next shot summaries
- world activity and supporting-cast context

This helps the model backend keep the hero, world, and sequence flow more consistent instead of treating each shot like a disconnected poster.

## Replicate Hosted Video

For the low-cost hosted-video experiment, set these on Vercel:

```text
PULSEREEL_HEAVY_PROVIDER=replicate-video-adapter
PULSEREEL_REPLICATE_API_TOKEN=your-replicate-token
PULSEREEL_REPLICATE_MODEL=minimax/video-01
```

Keep your normal worker URL configured:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-worker-domain/pulsereel/render
```

Vercel forwards the Replicate token and selected model privately to this worker for Replicate jobs. Before it spends provider credits, the worker extracts the clearest usable frame from the creator's uploaded clip. MiniMax receives the creator as `subject_reference`; Seedance receives the real clip frame as its starting `image`; and Kling receives the creator in `reference_images`. Prompt-only hosted generation is rejected so an unrelated scene image cannot silently replace the creator.

The studio also exposes an experimental **Replicate Pro · Kling** profile. It reuses the same Replicate token and defaults to `kwaivgi/kling-v3-omni-video`, requesting a 15-second 9:16 multi-shot movie with identity reference images and native audio. MiniMax remains the recommended default until Kling identity consistency and per-run cost have been evaluated. Optional worker overrides are:

```text
PULSEREEL_KLING_MODE=standard
PULSEREEL_KLING_DURATION_SECONDS=15
```

If a chosen Replicate model uses different input field names, set `PULSEREEL_REPLICATE_INPUT_TEMPLATE` on the worker machine or service:

```text
PULSEREEL_REPLICATE_INPUT_TEMPLATE={"prompt":"{{PROMPT}}","subject_reference":"{{IDENTITY_IMAGE}}","prompt_optimizer":true}
```

Identity-first validation also applies to custom templates. MiniMax templates must provide `subject_reference`, Seedance templates must provide `image`, and Kling templates must provide `reference_images`.

`GET /health` also reports whether ComfyUI and durable storage are configured, which makes it easier to sanity-check a deployment before pointing Vercel at it.

## Where To Add Real Models

Replace or extend `render_movie()` in `worker.py`.

Good next integrations:

- ComfyUI API calls for image-conditioned frames.
- Wan/CogVideoX/Stable Video Diffusion for shot-level motion.
- Face identity modules using the uploaded `sourceImage` or a frame from `sourceVideo`.
- Object storage upload for durable output URLs.

The Vercel app does not need to change when the worker becomes more powerful. It already sends the full story, identity, shot, and world payload.
