# PulseReel

PulseReel is a local-first AI movie creator prototype. It takes a short creator video or selfie, a simple story prompt, and turns it into a 60-second cinematic vertical movie using a stable local rendering path today, with a heavier open-model backend path prepared for ComfyUI and future video models.

## What works now

- Record or upload a short creator clip.
- Enter one simple movie idea.
- Generate a 60-second vertical movie with cinematic pacing, shot variation, captions, poster framing, audio bed, and source-motion inserts.
- Use Heavy Worker Beta to queue a separate backend job while keeping the create/watch/status flow stable.
- Fall back automatically to the local Python/FFmpeg runner when a real ComfyUI checkpoint is not ready.
- Switch the heavy provider toward Replicate or MiniMax without changing the create/watch flow.

## Where it is going

The current local runner creates a convincing cinematic illusion from still plates, source-motion inserts, and generated shot structure. The next leap toward real-world movies is connecting a real local model stack:

- ComfyUI checkpoint for image generation.
- Optional IPAdapter and CLIP Vision models for stronger identity preservation.
- Replicate-hosted video models for low-cost real-model experiments through the remote worker.
- MiniMax/Hailuo subject-reference generation for the identity-first target path.
- Future video or animation nodes for true generated motion.
- A hosted GPU worker for production deployments such as Vercel.
- Durable cloud storage for finished movies and public playback at scale.

PulseReel already writes shot-level payloads for this path, including scene intent, identity references, world activity, camera hints, and continuity metadata.

## Run locally

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment

Copy `.env.example` to `.env.local` and fill only the values available on your machine.

The app works without ComfyUI configured. In that case, Heavy Worker Beta uses the local Python/FFmpeg bridge.

Useful variables:

```text
PULSEREEL_PYTHON_EXECUTABLE=
PULSEREEL_HEAVY_PROVIDER=open-model-adapter
PULSEREEL_COMFYUI_URL=
PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE=
PULSEREEL_COMFYUI_CHECKPOINT=
PULSEREEL_COMFYUI_IPADAPTER_MODEL=
PULSEREEL_COMFYUI_CLIP_VISION_MODEL=
PULSEREEL_REMOTE_MODEL_BACKEND_URL=
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=
PULSEREEL_REPLICATE_API_TOKEN=
PULSEREEL_REPLICATE_MODEL=
PULSEREEL_REPLICATE_INPUT_TEMPLATE=
PULSEREEL_MINIMAX_API_KEY=
PULSEREEL_MINIMAX_MODEL=
```

Heavy provider choices:

```text
PULSEREEL_HEAVY_PROVIDER=open-model-adapter
PULSEREEL_HEAVY_PROVIDER=replicate-video-adapter
PULSEREEL_HEAVY_PROVIDER=minimax-subject-adapter
PULSEREEL_HEAVY_PROVIDER=local-heavy-v1
```

The Replicate adapter now prepares provider-specific request bundles, forwards the token privately from Vercel to the remote worker, and lets the worker call Replicate, download the returned MP4, and publish it through the normal watch page. Set `PULSEREEL_REPLICATE_MODEL` to an `owner/model` slug or `version:<id>`. The first recommended PulseReel experiment is `minimax/video-01` because it is a MiniMax/Hailuo video model with prompt/image support. If your chosen model uses custom input names, set `PULSEREEL_REPLICATE_INPUT_TEMPLATE` as JSON with placeholders like `{{PROMPT}}`, `{{SOURCE_IMAGE_URL}}`, `{{SOURCE_VIDEO_URL}}`, `{{WIDTH}}`, `{{HEIGHT}}`, and `{{DURATION_SECONDS}}`.

MiniMax currently remains a prepared adapter path for the next identity/subject-reference integration.

## Production GPU worker

For Vercel, the realistic production path is:

- Vercel hosts the web app and user flow.
- A remote GPU worker receives the PulseReel job package.
- The worker can run ComfyUI today, and later Wan, CogVideoX, Stable Video Diffusion, or another real model stack.
- The worker returns a hosted MP4 URL.

Set:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-worker.example.com/pulsereel/render
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=optional-secret-token
```

See `data/remote-worker-contract.md` for the exact multipart request and JSON response format.
There is also a starter worker in `workers/pulsereel-gpu-worker` that can already return hosted `processedVideoUrl` values, optionally switch into ComfyUI-backed shot generation on the GPU machine, and upload final movies to S3-compatible storage for durable production playback.
When PulseReel is running on Vercel and `PULSEREEL_REMOTE_MODEL_BACKEND_URL` is set, all movie requests automatically route through the heavy worker path, even if the UI mode is Fast Trailer or Prompt Movie Beta.
If you are blocked on the Vercel setup message, use `docs/vercel-remote-worker-quickstart.md` for the shortest path from that error to a live worker.

## Vercel runtime storage

Vercel deploys application files as read-only. PulseReel therefore writes runtime data to `/tmp/pulsereel` when it detects Vercel, and serves those files through `/api/assets/uploads/...` and `/api/assets/generated/...`.

That fixes read-only filesystem crashes, but `/tmp` is still temporary serverless storage. For a public app with durable movies and many users, the remote GPU worker should upload final MP4s to durable storage and return a hosted `processedVideoUrl`.

If `PULSEREEL_REMOTE_MODEL_BACKEND_URL` is not set on Vercel, the create endpoint returns a JSON setup error instead of attempting the local FFmpeg/Python/ComfyUI render path. Local generation still works on your PC.

## ComfyUI path

PulseReel includes workflow templates in `data/comfyui`.

- `portrait-img2img-workflow.json` is the simple starting workflow.
- `ipadapter-portrait-workflow.json` separates scene composition from identity likeness.

The IPAdapter workflow uses:

- `{{SCENE_IMAGE}}` for the PulseReel shot plate.
- `{{IDENTITY_IMAGE}}` for the uploaded selfie or extracted video frame.

Place a real checkpoint file in:

```text
tools/ComfyUI/models/checkpoints
```

The local `tools/ComfyUI` folder is intentionally ignored by Git because it is machine-specific and can become very large.

## Important ignored data

These are not committed:

- `.env.local`
- generated movies and uploads in `public/`
- local project database files
- local heavy job payloads
- cloned ComfyUI app and model files

That keeps GitHub focused on source code and avoids uploading private videos, secrets, and large model assets.

## Verification

Useful checks:

```powershell
node_modules\.bin\tsc.cmd --noEmit
python -m py_compile scripts\python-motion-bridge.py scripts\comfyui-model-backend.py
npm run build
```

On this Windows machine, `npm run build` has been compiling successfully but sometimes ends with a local `spawn EPERM` after TypeScript. The focused TypeScript and Python checks are the reliable signal for code correctness in the current local setup.
