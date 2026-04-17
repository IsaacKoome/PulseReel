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
```

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
