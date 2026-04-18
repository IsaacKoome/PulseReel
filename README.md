# PulseReel

PulseReel is a local-first AI movie creator prototype. It takes a short creator video or selfie, a simple story prompt, and turns it into a 60-second cinematic vertical movie using a stable local rendering path today, with a heavier open-model backend path prepared for ComfyUI and future video models.

## What works now

- Record or upload a short creator clip.
- Enter one simple movie idea.
- Generate a 60-second vertical movie with cinematic pacing, shot variation, captions, poster framing, audio bed, and source-motion inserts.
- Use Heavy Worker Beta to queue a separate backend job while keeping the create/watch/status flow stable.
- Fall back automatically to the local Python/FFmpeg runner when a real ComfyUI checkpoint is not ready.

## Where it is going

The current local runner creates a convincing cinematic illusion from still plates, source-motion inserts, and generated shot structure. The next leap toward real-world movies is connecting a real local model stack:

- ComfyUI checkpoint for image generation.
- Optional IPAdapter and CLIP Vision models for stronger identity preservation.
- Future video or animation nodes for true generated motion.
- A hosted GPU worker for production deployments such as Vercel.

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
```

## Production GPU worker

For Vercel, the realistic production path is:

- Vercel hosts the web app and user flow.
- A remote GPU worker receives the PulseReel job package.
- The worker runs ComfyUI, Wan, CogVideoX, Stable Video Diffusion, or another real model stack.
- The worker returns a hosted MP4 URL.

Set:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-worker.example.com/pulsereel/render
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=optional-secret-token
```

See `data/remote-worker-contract.md` for the exact multipart request and JSON response format.

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
