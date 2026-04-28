# PulseReel Public Worker URL

Use this when the laptop restarts or the temporary Cloudflare URL stops working.

## 1. Start the local worker

Open PowerShell in the project folder:

```powershell
cd "C:\Users\Isaac\Documents\New project"
powershell -ExecutionPolicy Bypass -File ".\workers\pulsereel-gpu-worker\start-worker.ps1"
```

Check it:

```powershell
node -e "fetch('http://127.0.0.1:8000/health').then(async r=>console.log(r.status, await r.text()))"
```

You want to see `200`.

## 2. Start a temporary public tunnel

In another PowerShell window:

```powershell
cloudflared tunnel --url http://127.0.0.1:8000
```

Cloudflare will print a URL like:

```text
https://example-random-words.trycloudflare.com
```

Check it:

```powershell
node -e "fetch('https://example-random-words.trycloudflare.com/health').then(async r=>console.log(r.status, await r.text()))"
```

## 3. Update Vercel

In Vercel, set:

```text
PULSEREEL_REMOTE_MODEL_BACKEND_URL=https://example-random-words.trycloudflare.com/pulsereel/render
```

Important: add `/pulsereel/render` at the end.

Then redeploy the Vercel app.

## Notes

- The temporary `trycloudflare.com` URL only works while your PC is awake and the `cloudflared` terminal is running.
- If the PC restarts, repeat these steps and paste the new URL into Vercel.
- A permanent URL needs either a Cloudflare-managed domain or a hosted worker/VPS/GPU service.
