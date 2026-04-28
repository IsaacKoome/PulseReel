$ErrorActionPreference = "Stop"

$workerRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $workerRoot

$venvPython = Join-Path $workerRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  python -m venv .venv
}

& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements.txt

$envFile = Join-Path $workerRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) {
      return
    }

    $parts = $line.Split("=", 2)
    if ($parts.Length -eq 2) {
      [System.Environment]::SetEnvironmentVariable($parts[0], $parts[1], "Process")
    }
  }
}

if (-not $env:PULSEREEL_WORKER_PUBLIC_BASE_URL) {
  $env:PULSEREEL_WORKER_PUBLIC_BASE_URL = "http://127.0.0.1:8000"
}

Write-Host ""
Write-Host "PulseReel GPU Worker starting..." -ForegroundColor Cyan
Write-Host "Worker root: $workerRoot"
Write-Host "Health URL: http://127.0.0.1:8000/health"
Write-Host "Render URL: http://127.0.0.1:8000/pulsereel/render"
Write-Host ""

& $venvPython -m uvicorn worker:app --host 0.0.0.0 --port 8000
