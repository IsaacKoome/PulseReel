$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $projectRoot "workers\pulsereel-gpu-worker"
$pythonExe = Join-Path $workerRoot ".venv\Scripts\python.exe"
$logDir = Join-Path $workerRoot "logs"
$stdoutLog = Join-Path $logDir "startup-worker.out.log"
$stderrLog = Join-Path $logDir "startup-worker.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$isHealthy = $false
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
  $isHealthy = $health.StatusCode -eq 200
} catch {
  $isHealthy = $false
}

if ($isHealthy) {
  "PulseReel worker already listening on port 8000 at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
  exit 0
}

if (!(Test-Path $pythonExe)) {
  "Missing worker Python environment: $pythonExe" | Add-Content -Path $stderrLog
  exit 1
}

"PulseReel worker start requested at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
Set-Location $workerRoot
& $pythonExe -m uvicorn worker:app --host 0.0.0.0 --port 8000 >> $stdoutLog 2>> $stderrLog
