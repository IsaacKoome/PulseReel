$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $projectRoot "workers\pulsereel-gpu-worker"
$pythonExe = Join-Path $workerRoot ".venv\Scripts\python.exe"
$logDir = Join-Path $workerRoot "logs"
$stdoutLog = Join-Path $logDir "startup-worker.out.log"
$stderrLog = Join-Path $logDir "startup-worker.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  "PulseReel worker already listening on port 8000 at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
  exit 0
}

if (!(Test-Path $pythonExe)) {
  "Missing worker Python environment: $pythonExe" | Add-Content -Path $stderrLog
  exit 1
}

Start-Process `
  -FilePath $pythonExe `
  -ArgumentList @("-m", "uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000") `
  -WorkingDirectory $workerRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog

"PulseReel worker start requested at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
