param(
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$workerRoot = Join-Path $projectRoot "workers\pulsereel-gpu-worker"
$pythonExe = Join-Path $workerRoot ".venv\Scripts\python.exe"
$logDir = Join-Path $workerRoot "logs"
$stdoutLog = Join-Path $logDir "startup-worker.out.log"
$stderrLog = Join-Path $logDir "startup-worker.err.log"
$runtimeStdoutLog = Join-Path $logDir "runtime-worker.out.log"
$runtimeStderrLog = Join-Path $logDir "runtime-worker.err.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$isHealthy = $false
try {
  $health = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
  $isHealthy = $health.StatusCode -eq 200
} catch {
  $isHealthy = $false
}

if ($isHealthy -and $Restart) {
  $listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction Stop | Select-Object -First 1
  $existingProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
  $isPulseReelWorker =
    $existingProcess.CommandLine -match "(?i)uvicorn\s+worker:app" -and
    $existingProcess.CommandLine -match "(?i)--port\s+8000"

  if (!$isPulseReelWorker) {
    throw "Refusing to stop PID $($listener.OwningProcess): port 8000 is not serving the PulseReel uvicorn worker."
  }

  "PulseReel worker restart requested for PID $($listener.OwningProcess) at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
  Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop

  for ($attempt = 1; $attempt -le 20; $attempt++) {
    Start-Sleep -Milliseconds 250
    try {
      Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 1 | Out-Null
    } catch {
      $isHealthy = $false
      break
    }
  }

  if ($isHealthy) {
    throw "The previous PulseReel worker did not release port 8000 after it was stopped."
  }
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

$workerProcess = Start-Process `
  -FilePath $pythonExe `
  -ArgumentList @("-m", "uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8000") `
  -WorkingDirectory $workerRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $runtimeStdoutLog `
  -RedirectStandardError $runtimeStderrLog `
  -PassThru

for ($attempt = 1; $attempt -le 30; $attempt++) {
  Start-Sleep -Seconds 1

  if ($workerProcess.HasExited) {
    "PulseReel worker exited during startup with code $($workerProcess.ExitCode) at $(Get-Date -Format o)" | Add-Content -Path $stderrLog
    if (Test-Path $runtimeStderrLog) {
      Get-Content -Path $runtimeStderrLog -Tail 40 | Add-Content -Path $stderrLog
    }
    exit 1
  }

  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 3
    if ($health.StatusCode -eq 200) {
      "PulseReel worker healthy with PID $($workerProcess.Id) at $(Get-Date -Format o)" | Add-Content -Path $stdoutLog
      exit 0
    }
  } catch {
    # The worker can take a few seconds to import its media dependencies.
  }
}

"PulseReel worker did not become healthy within 30 seconds at $(Get-Date -Format o)" | Add-Content -Path $stderrLog
Stop-Process -Id $workerProcess.Id -Force -ErrorAction SilentlyContinue
exit 1
