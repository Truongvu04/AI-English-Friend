$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot

$venvPython = Join-Path $serviceRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Virtual environment is missing. Run .\setup.ps1 first."
}

$envFile = Join-Path $serviceRoot ".env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
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

$hostValue = if ($env:FASTER_WHISPER_HOST) { $env:FASTER_WHISPER_HOST } else { "127.0.0.1" }
$portValue = if ($env:FASTER_WHISPER_PORT) { $env:FASTER_WHISPER_PORT } else { "8765" }
$modelValue = if ($env:FASTER_WHISPER_MODEL) { $env:FASTER_WHISPER_MODEL } else { "base.en" }
Write-Host "STT model: $modelValue"
Write-Host "STT host: $hostValue"
Write-Host "STT port: $portValue"

& $venvPython -m uvicorn app:app --host $hostValue --port ([int]$portValue)
