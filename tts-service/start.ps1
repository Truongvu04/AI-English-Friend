$ErrorActionPreference = "Stop"
$serviceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $serviceRoot

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

$venvPython = Join-Path $serviceRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) { throw "Virtual environment is missing. Run .\setup.ps1 first." }
$hostValue = if ($env:KOKORO_HOST) { $env:KOKORO_HOST } else { "127.0.0.1" }
$portValue = if ($env:KOKORO_PORT) { $env:KOKORO_PORT } else { "8766" }
Write-Host "Kokoro host: $hostValue"
Write-Host "Kokoro port: $portValue"
Write-Host "Kokoro model: $($env:KOKORO_MODEL_PATH)"
& $venvPython -m uvicorn app:app --host $hostValue --port ([int]$portValue)
