# PulseReel ComfyUI Templates

These workflow templates are designed for the Python and ComfyUI backend adapters in this repo:

- [sample-workflow.json](/C:/Users/Isaac/Documents/New%20project/data/comfyui/sample-workflow.json)
- [portrait-img2img-workflow.json](/C:/Users/Isaac/Documents/New%20project/data/comfyui/portrait-img2img-workflow.json)
- [ipadapter-portrait-workflow.json](/C:/Users/Isaac/Documents/New%20project/data/comfyui/ipadapter-portrait-workflow.json)

## Recommended starting point

Use `portrait-img2img-workflow.json` first.

Why:
- It uses the uploaded PulseReel shot reference image as `{{REFERENCE_IMAGE}}`
- It starts from that image in latent space instead of pure text-to-image
- That makes it a better fit for creator-identity preservation than the simpler starter file

## Advanced option

Use `ipadapter-portrait-workflow.json` when your ComfyUI install includes the needed IPAdapter and CLIP Vision nodes and models.

Why:
- It uses the PulseReel shot reference as `{{SCENE_IMAGE}}` for composition
- It uses the uploaded selfie, or an extracted source-video frame, as `{{IDENTITY_IMAGE}}` for face likeness
- It pushes harder on identity consistency than plain img2img
- It is a better direction for PulseReel-style "make me the movie character" shots
- It is closer to what you would want before attempting stronger motion or video generation

Requirements for that advanced workflow:
- an IPAdapter-capable ComfyUI setup
- an IPAdapter model file
- a CLIP Vision model file
- either setting the related env vars or placing those models in the matching ComfyUI model folders

## Required placeholders

The ComfyUI backend replaces these tokens before queueing the workflow:

- `{{PROMPT}}`
- `{{NEGATIVE_PROMPT}}`
- `{{REFERENCE_IMAGE}}`
- `{{SCENE_IMAGE}}`
- `{{IDENTITY_IMAGE}}`
- `{{OUTPUT_PREFIX}}`
- `{{WIDTH}}`
- `{{HEIGHT}}`
- `{{SEED}}`
- `{{CKPT_NAME}}`
- `{{IPADAPTER_MODEL}}`
- `{{CLIP_VISION_MODEL}}`

## Important setup notes

- PulseReel now auto-injects the checkpoint filename from:
  - `PULSEREEL_COMFYUI_CHECKPOINT`, or
  - the first valid checkpoint found in `tools/ComfyUI/models/checkpoints`
- For `ipadapter-portrait-workflow.json`, PulseReel can also auto-inject:
  - `PULSEREEL_COMFYUI_IPADAPTER_MODEL`, or the first valid file in `tools/ComfyUI/models/ipadapter`
  - `PULSEREEL_COMFYUI_CLIP_VISION_MODEL`, or the first valid file in `tools/ComfyUI/models/clip_vision`
- If no selfie image is uploaded, the ComfyUI backend extracts an identity frame from the source video and uploads it as `{{IDENTITY_IMAGE}}`.
- The current adapter expects the workflow to produce at least one saved image through a standard `SaveImage` node.
- The backend then downloads that image and turns it into a PulseReel shot segment.

## Activation

1. Copy [`.env.example`](/C:/Users/Isaac/Documents/New%20project/.env.example) to `.env.local`
2. Set `PULSEREEL_PYTHON_EXECUTABLE`
3. Set `PULSEREEL_COMFYUI_URL`
4. Set `PULSEREEL_COMFYUI_WORKFLOW_TEMPLATE` to one of these JSON files
5. Add at least one real checkpoint model to `tools/ComfyUI/models/checkpoints`
6. Restart `npm run dev`

## Next upgrade path

Once basic image-conditioned generation works, the next better ComfyUI workflow would add:

- stronger IPAdapter or ControlNet identity guidance
- a dedicated face or portrait checkpoint
- a higher-quality upscale pass
- optional animation or video-node stack if your ComfyUI setup includes it
