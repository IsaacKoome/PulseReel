$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$comfyRoot = Join-Path $projectRoot "tools\ComfyUI"
$pythonPath = Join-Path $comfyRoot ".venv\Scripts\python.exe"
$logDir = Join-Path $comfyRoot "logs"
$stdoutLog = Join-Path $logDir "comfyui.out.log"
$stderrLog = Join-Path $logDir "comfyui.err.log"

if (-not (Test-Path $pythonPath)) {
  throw "ComfyUI virtual environment is not ready at $pythonPath"
}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Start-Process `
  -FilePath $pythonPath `
  -ArgumentList @("main.py", "--cpu", "--listen", "127.0.0.1", "--port", "8188") `
  -WorkingDirectory $comfyRoot `
  -RedirectStandardOutput $stdoutLog `
  -RedirectStandardError $stderrLog `
  -WindowStyle Hidden

Write-Output "ComfyUI start requested on http://127.0.0.1:8188"
Write-Output "Logs:"
Write-Output "  $stdoutLog"
Write-Output "  $stderrLog"
