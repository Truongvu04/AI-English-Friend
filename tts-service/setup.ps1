$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot

$envPath = Join-Path $serviceRoot ".env"
$envExamplePath = Join-Path $serviceRoot ".env.example"
if (-not (Test-Path $envPath) -and (Test-Path $envExamplePath)) {
  Copy-Item -LiteralPath $envExamplePath -Destination $envPath
  Write-Host "Created tts-service/.env from .env.example. Verify KOKORO_MODEL_PATH and KOKORO_VOICES_PATH before starting the service."
}

function Read-EnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $parts = $line.Split("=", 2)
      $key = $parts[0].Trim()
      if (-not [Environment]::GetEnvironmentVariable($key, "Process")) {
        [Environment]::SetEnvironmentVariable($key, $parts[1].Trim().Trim('"').Trim("'"), "Process")
      }
    }
  }
}

Read-EnvFile $envPath
$pythonCommand = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCommand) { throw "Python was not found. Install Python 3.10+ and run setup.ps1 again." }

Write-Host "Using $($pythonCommand.Source)"
if (-not (Test-Path ".venv\Scripts\python.exe")) { python -m venv .venv }

$venvPython = Join-Path $serviceRoot ".venv\Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r requirements.txt
& $venvPython -m pip check
if ($LASTEXITCODE -ne 0) { throw "Python dependency check failed." }

$modelPath = [Environment]::GetEnvironmentVariable("KOKORO_MODEL_PATH", "Process")
$voicesPath = [Environment]::GetEnvironmentVariable("KOKORO_VOICES_PATH", "Process")
if (-not $modelPath -or -not $voicesPath) { throw "KOKORO_MODEL_PATH and KOKORO_VOICES_PATH are required." }
$modelDirectory = Split-Path -Parent $modelPath
if ($modelDirectory -and -not (Test-Path $modelDirectory)) { New-Item -ItemType Directory -Path $modelDirectory -Force | Out-Null }

$modelUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.int8.onnx"
$voicesUrl = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/voices-v1.0.bin"
function Ensure-Asset([string]$path, [string]$url) {
  if (Test-Path $path) { Write-Host "Using existing asset: $path"; return }
  try {
    Write-Host "Downloading missing asset: $path"
    Invoke-WebRequest -Uri $url -OutFile $path -UseBasicParsing
  } catch {
    Write-Error "Could not download $path."
    Write-Host "Manual command: Invoke-WebRequest -Uri `"$url`" -OutFile `"$path`" -UseBasicParsing"
    throw
  }
}
Ensure-Asset $modelPath $modelUrl
Ensure-Asset $voicesPath $voicesUrl

foreach ($packageName in @("kokoro-onnx", "fastapi", "uvicorn", "numpy")) {
  $packageVersion = & $venvPython -c "import importlib.metadata as metadata; print(metadata.version('$packageName'))"
  if ($LASTEXITCODE -ne 0) { throw "Unable to read installed version for $packageName." }
  Write-Host "$packageName $packageVersion"
}
Write-Host "Kokoro TTS setup complete."
