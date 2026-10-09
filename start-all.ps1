[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot "scripts/project-common.ps1")
Set-Location $projectRoot
Ensure-ProjectDirectories
$nullInputPath = Get-NullInputPath

$state = Read-ProjectRuntimeState
$serverEnv = Read-EnvFile -Path (Join-Path $projectRoot "server/.env")
$sttEnv = Read-EnvFile -Path (Join-Path $projectRoot "stt-service/.env")
$ttsEnv = Read-EnvFile -Path (Join-Path $projectRoot "tts-service/.env")
$ollamaUrl = (Get-EnvValue -Values $serverEnv -Name "OLLAMA_URL" -Default "http://127.0.0.1:11434").TrimEnd("/")
$chatModel = Get-EnvValue -Values $serverEnv -Name "OLLAMA_CHAT_MODEL" -Default "qwen3:4b"
$backendPort = [int](Get-EnvValue -Values $serverEnv -Name "PORT" -Default "3001")
$sttHost = Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_HOST" -Default "127.0.0.1"
$sttPort = [int](Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_PORT" -Default "8765")
$ttsHost = Get-EnvValue -Values $ttsEnv -Name "KOKORO_HOST" -Default "127.0.0.1"
$ttsPort = [int](Get-EnvValue -Values $ttsEnv -Name "KOKORO_PORT" -Default "8766")
$frontendPort = 5173

$results = [ordered]@{}
$criticalFailure = $false

function Set-Result([string]$Name, [string]$Status, [string]$Detail) {
  $script:results[$Name] = [pscustomobject]@{ Status = $Status; Detail = $Detail }
}

function Get-ProcessConflictMessage([int]$Port) {
  $owner = Get-PortOwner -Port $Port
  if (-not $owner) { return "PORT CONFLICT on $Port" }
  $identity = Get-ProcessIdentity -ProcessId $owner
  if ($identity) { return "PORT CONFLICT on $Port (PID $owner, $($identity.ProcessName))" }
  return "PORT CONFLICT on $Port (PID $owner)"
}

function Test-ExistingOrExternal([string]$Service, [string]$Endpoint) {
  $health = Test-HttpEndpoint -Url $Endpoint -TimeoutSec 3
  if (-not $health.Ready) { return $false }
  $record = Get-OwnedServiceRecord -State $state -Service $Service
  if ($record -and -not (Test-OwnedProcess -Record $record)) {
    Remove-OwnedServiceRecord -State $state -Service $Service
  }
  return $true
}

function Start-Ollama {
  $endpoint = "$ollamaUrl/api/tags"
  if (Test-ExistingOrExternal -Service "ollama" -Endpoint $endpoint) {
    Set-Result "Ollama" "READY" "EXTERNAL / PRE-EXISTING"
    return
  }
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $command) {
    Set-Result "Ollama" "UNAVAILABLE" "ollama executable was not found."
    $script:criticalFailure = $true
    return
  }
  if (Get-PortOwner -Port 11434) {
    Set-Result "Ollama" "UNAVAILABLE" (Get-ProcessConflictMessage -Port 11434)
    $script:criticalFailure = $true
    return
  }
  $process = Start-Process -FilePath $command.Source -ArgumentList @("serve") -WorkingDirectory $projectRoot -RedirectStandardInput $nullInputPath -RedirectStandardOutput (Join-Path $script:LogRoot "ollama.out.log") -RedirectStandardError (Join-Path $script:LogRoot "ollama.err.log") -WindowStyle Hidden -PassThru
  $health = Wait-HttpEndpoint -Url $endpoint -TimeoutSec 30
  if (-not $health.Ready) {
    Set-Result "Ollama" "UNAVAILABLE" "ollama serve did not become ready."
    $script:criticalFailure = $true
    return
  }
  Register-OwnedService -State $state -Service "ollama" -ProcessId $process.Id -ExpectedCommand "ollama serve" -Endpoint $endpoint | Out-Null
  Set-Result "Ollama" "READY" "STARTED BY PROJECT"
}

function Start-PythonService([string]$Service, [string]$Directory, [string]$ScriptName, [string]$Endpoint, [int]$Port, [string]$ExpectedCommand) {
  if (Test-ExistingOrExternal -Service $Service -Endpoint $Endpoint) {
    Set-Result $Service "READY" "EXTERNAL / PRE-EXISTING"
    return
  }
  if (Get-PortOwner -Port $Port) {
    Set-Result $Service "UNAVAILABLE" (Get-ProcessConflictMessage -Port $Port)
    return
  }
  $scriptPath = Join-Path $projectRoot (Join-Path $Directory $ScriptName)
  $venv = Join-Path $projectRoot (Join-Path $Directory ".venv/Scripts/python.exe")
  if (-not (Test-Path -LiteralPath $venv)) {
    Set-Result $Service "DEGRADED" "Environment missing; run .\$Directory\setup.ps1."
    return
  }
  $launcherArguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
  $launcher = Start-Process -FilePath "powershell.exe" -ArgumentList $launcherArguments -WorkingDirectory (Join-Path $projectRoot $Directory) -RedirectStandardInput $nullInputPath -RedirectStandardOutput (Join-Path $script:LogRoot "$($Service.ToLower()).out.log") -RedirectStandardError (Join-Path $script:LogRoot "$($Service.ToLower()).err.log") -WindowStyle Hidden -PassThru
  $health = Wait-HttpEndpoint -Url $Endpoint -TimeoutSec 45
  if (-not $health.Ready) {
    Set-Result $Service "DEGRADED" "Service did not become ready; browser fallback may remain available."
    return
  }
  $ownerPid = Wait-PortOwner -Port $Port -TimeoutSec 5
  if (-not $ownerPid) {
    Set-Result $Service "DEGRADED" "Health endpoint responded but process ownership could not be recorded."
    return
  }
  Register-OwnedService -State $state -Service $Service -ProcessId $ownerPid -ExpectedCommand $ExpectedCommand -Endpoint $Endpoint | Out-Null
  Set-Result $Service "READY" "STARTED BY PROJECT"
}

function Start-NpmService([string]$Service, [string[]]$Arguments, [string]$Endpoint, [int]$Port, [string]$ExpectedCommand, [int]$TimeoutSec = 35) {
  if (Test-ExistingOrExternal -Service $Service -Endpoint $Endpoint) {
    Set-Result $Service "READY" "EXTERNAL / PRE-EXISTING"
    return
  }
  if (Get-PortOwner -Port $Port) {
    Set-Result $Service "UNAVAILABLE" (Get-ProcessConflictMessage -Port $Port)
    $script:criticalFailure = $true
    return
  }
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) {
    Set-Result $Service "UNAVAILABLE" "npm was not found."
    $script:criticalFailure = $true
    return
  }
  $launcher = Start-Process -FilePath $npm.Source -ArgumentList $Arguments -WorkingDirectory $projectRoot -RedirectStandardInput $nullInputPath -RedirectStandardOutput (Join-Path $script:LogRoot "$($Service.ToLower()).out.log") -RedirectStandardError (Join-Path $script:LogRoot "$($Service.ToLower()).err.log") -WindowStyle Hidden -PassThru
  $health = Wait-HttpEndpoint -Url $Endpoint -TimeoutSec $TimeoutSec
  if (-not $health.Ready) {
    Set-Result $Service "UNAVAILABLE" "Process started but readiness endpoint did not respond. See logs/$($Service.ToLower()).err.log."
    $script:criticalFailure = $true
    return
  }
  $ownerPid = Wait-PortOwner -Port $Port -TimeoutSec 5
  if (-not $ownerPid) {
    Set-Result $Service "UNAVAILABLE" "Readiness endpoint responded but process ownership could not be recorded."
    $script:criticalFailure = $true
    return
  }
  Register-OwnedService -State $state -Service $Service -ProcessId $ownerPid -ExpectedCommand $ExpectedCommand -Endpoint $Endpoint | Out-Null
  Set-Result $Service "READY" "STARTED BY PROJECT"
}

Write-Host "AI English Friend"
Write-Host "================="

$dbResult = & node (Join-Path $projectRoot "scripts/check-database.js") --json 2>$null
if ($LASTEXITCODE -eq 0) {
  Set-Result "MySQL" "READY" "Configured database is reachable."
} else {
  Set-Result "MySQL" "UNAVAILABLE" "Configured database is not reachable; MySQL is external infrastructure."
  $criticalFailure = $true
}

Start-Ollama
Start-PythonService -Service "STT" -Directory "stt-service" -ScriptName "start.ps1" -Endpoint "http://${sttHost}:$sttPort/health" -Port $sttPort -ExpectedCommand "uvicorn app:app"
Start-PythonService -Service "TTS" -Directory "tts-service" -ScriptName "start.ps1" -Endpoint "http://${ttsHost}:$ttsPort/health" -Port $ttsPort -ExpectedCommand "uvicorn app:app"
Start-NpmService -Service "Backend" -Arguments @("run", "dev:server") -Endpoint "http://127.0.0.1:$backendPort/health" -Port $backendPort -ExpectedCommand "src/index.js"
Start-NpmService -Service "Frontend" -Arguments @("run", "dev:frontend", "--", "--host", "127.0.0.1", "--port", "$frontendPort", "--strictPort") -Endpoint "http://127.0.0.1:$frontendPort/" -Port $frontendPort -ExpectedCommand "vite"

Write-Host ""
Write-Host "MySQL       $($results.MySQL.Status) - $($results.MySQL.Detail)"
Write-Host "Ollama      $($results.Ollama.Status) - $($results.Ollama.Detail)"
Write-Host "STT         $($results.STT.Status) - $($results.STT.Detail)"
Write-Host "TTS         $($results.TTS.Status) - $($results.TTS.Detail)"
Write-Host "Backend     $($results.Backend.Status) - $($results.Backend.Detail)"
Write-Host "Frontend    $($results.Frontend.Status) - $($results.Frontend.Detail)"
Write-Host ""
Write-Host "Frontend: http://127.0.0.1:$frontendPort"
Write-Host "Backend:  http://127.0.0.1:$backendPort"
Write-Host "Chat model: $chatModel"
Write-Host "Resource mode: $(Get-EnvValue -Values $serverEnv -Name 'AI_RESOURCE_MODE' -Default 'auto')"
Write-Host "Demo mode: $(Get-EnvValue -Values $serverEnv -Name 'AI_DEMO_MODE' -Default 'false')"

if ($criticalFailure) {
  Write-ErrorMessage "Startup completed with one or more critical services unavailable. Run .\status.ps1 for details."
  exit 1
}
exit 0
