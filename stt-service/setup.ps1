$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot

$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) {
  throw "Python was not found. Install Python 3.10+ and run setup.ps1 again."
}

Write-Host "Using $($pythonCommand.Source)"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
  python -m venv .venv
}

$venvPython = Join-Path $serviceRoot ".venv\Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements.txt
& $venvPython -m pip check
if ($LASTEXITCODE -ne 0) {
  throw "Python dependency check failed."
}

foreach ($packageName in @("faster-whisper", "av", "fastapi", "uvicorn")) {
  $packageVersion = & $venvPython -c "import importlib.metadata as metadata; print(metadata.version('$packageName'))"
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to read installed version for $packageName."
  }
  Write-Host "$packageName $packageVersion"
}

if (-not (Test-Path ".env") -and (Test-Path ".env.example")) {
  Copy-Item ".env.example" ".env"
  Write-Host "Created stt-service/.env from .env.example."
}

Write-Host "STT service setup complete."
