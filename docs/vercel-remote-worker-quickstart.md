# Vercel Remote Worker Quickstart

If your public site shows:

`The public Vercel app needs PULSEREEL_REMOTE_MODEL_BACKEND_URL before it can render movies`

that means the web app is working, but Vercel still does not know where the real movie backend lives.

## Fastest Path

1. On the machine that will run the worker, open:
   `workers\pulsereel-gpu-worker`
2. Copy `.env.example` to `.env`
3. Start the worker:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-worker.ps1
```

4. Confirm this opens:

```text
http://127.0.0.1:8000/health
```

You should see JSON like:

```json
{
  "ok": true,
  "worker": "pulsereel-gpu-worker"
}
```

5. Expose that worker publicly using your preferred tunnel or server:
   - Cloudflare Tunnel
   - ngrok
   - a VPS
   - RunPod / GPU VM
   - Docker on a public server

6. In Vercel, set:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://your-public-worker-domain/pulsereel/render
```

7. If you set a worker token, also set:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_TOKEN=your-secret-token
```

8. Redeploy Vercel.

## Important

- `http://127.0.0.1:8000/pulsereel/render` only works on the same machine, not from Vercel.
- Vercel must receive a public HTTPS URL.
- If you want final videos to stay online after worker restarts, configure S3-compatible storage in the worker `.env`.

## After That

Once `PULSEREEL_REMOTE_MODEL_BACKEND_URL` is set, the public app automatically routes movie generation through the remote worker path.
