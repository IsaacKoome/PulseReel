$ErrorActionPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$comfyRoot = Join-Path $projectRoot "tools\ComfyUI"
$pythonPath = Join-Path $comfyRoot ".venv\Scripts\python.exe"
$checkpointDir = Join-Path $comfyRoot "models\checkpoints"
$hasCheckpoint = $false

if (Test-Path $checkpointDir) {
  $hasCheckpoint = @(Get-ChildItem $checkpointDir -File | Where-Object {
      $_.Name -notmatch "put_checkpoints_here" -and $_.Extension -match "\.(safetensors|ckpt|pt)$"
    }).Count -gt 0
}

$serverUp = $false
try {
  $serverUp = [bool](Test-NetConnection -ComputerName 127.0.0.1 -Port 8188 -InformationLevel Quiet)
} catch {
  $serverUp = $false
}

[pscustomobject]@{
  comfyUiInstalled = Test-Path (Join-Path $comfyRoot "main.py")
  comfyUiVenvReady = Test-Path $pythonPath
  comfyUiServerUp = $serverUp
  comfyUiCheckpointReady = $hasCheckpoint
  pythonPath = if (Test-Path $pythonPath) { $pythonPath } else { $null }
  checkpointDir = $checkpointDir
} | ConvertTo-Json -Depth 3
