# PulseReel Remote Model Worker Contract

Use this contract when PulseReel is deployed on Vercel but the real image/video generation runs somewhere else, such as a GPU VM, RunPod, Modal, Replicate-style wrapper, or your own ComfyUI server.

Set this in Vercel:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-worker.example.com/pulsereel/render
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=optional-secret-token
```

PulseReel sends a `POST` request with `multipart/form-data`.

## Headers

If `PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN` is set:

```text
Authorization: Bearer <token>
```

## Form Fields

- `payload`: JSON file containing the full heavy job package.
- `protocolVersion`: string, currently `pulsereel-heavy-job-v1`.
- `jobId`: string.
- `sourceVideo`: uploaded or recorded creator video.
- `sourceImage`: optional uploaded selfie.
- `poster`: generated poster asset.
- `reference_0`, `reference_1`, ...: per-shot reference plates.

## Important Payload Sections

- `story`: title, premise, persona, scene prompts.
- `worldSpec`: setting, atmosphere, extras, supporting cast, recurring motifs.
- `shotReferences`: shot prompt, duration, camera move, transition, shot kind, subject framing, world activity, source clip offset, reference image paths.
- `outputSpec`: expected width, height, fps, and total duration.

## Successful Response

Prefer returning a hosted video URL:

```json
{
  "status": "completed",
  "processedVideoUrl": "https://cdn.example.com/jobs/job-id/final.mp4"
}
```

For local testing, a worker may return base64 MP4:

```json
{
  "status": "completed",
  "videoBase64": "AAAA..."
}
```

Hosted URLs are better for Vercel because serverless files are temporary.

## Failed Response

```json
{
  "status": "failed",
  "error": "Model backend could not preserve identity in shot 4."
}
```

## Recommended Worker Behavior

1. Parse `payload`.
2. Use `sourceImage` for identity if present; otherwise extract a good frame from `sourceVideo`.
3. For each `shotReferences[]` item, generate or animate a shot using:
   - `prompt`
   - `worldActivity`
   - `subjectFraming`
   - `shotKind`
   - `supportingCast`
   - `recurringElements`
   - uploaded `reference_<index>` image
4. Render a vertical MP4 matching `outputSpec`.
5. Upload the MP4 to durable storage.
6. Return `processedVideoUrl`.
