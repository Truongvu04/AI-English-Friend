[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot "scripts/project-common.ps1")
Set-Location $projectRoot

$state = Read-ProjectRuntimeState
$serverEnv = Read-EnvFile -Path (Join-Path $projectRoot "server/.env")
$sttEnv = Read-EnvFile -Path (Join-Path $projectRoot "stt-service/.env")
$ttsEnv = Read-EnvFile -Path (Join-Path $projectRoot "tts-service/.env")
$ollamaUrl = (Get-EnvValue -Values $serverEnv -Name "OLLAMA_URL" -Default "http://127.0.0.1:11434").TrimEnd("/")
$chatModel = Get-EnvValue -Values $serverEnv -Name "OLLAMA_CHAT_MODEL" -Default "qwen3:4b"
$translationModel = Get-EnvValue -Values $serverEnv -Name "OLLAMA_TRANSLATION_MODEL" -Default $chatModel
$backendPort = [int](Get-EnvValue -Values $serverEnv -Name "PORT" -Default "3001")
$sttHost = Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_HOST" -Default "127.0.0.1"
$sttPort = [int](Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_PORT" -Default "8765")
$ttsHost = Get-EnvValue -Values $ttsEnv -Name "KOKORO_HOST" -Default "127.0.0.1"
$ttsPort = [int](Get-EnvValue -Values $ttsEnv -Name "KOKORO_PORT" -Default "8766")
$frontendPort = 5173
$hasUnavailable = $false

function Show-Status([string]$Name, [string]$Status, [string]$Detail) {
  $color = if ($Status -eq "READY") { "Green" } elseif ($Status -eq "DEGRADED") { "Yellow" } else { "Red" }
  Write-Host ("{0,-11} {1,-11} {2}" -f $Name, $Status, $Detail) -ForegroundColor $color
}

function Ownership-Label([string]$Service) {
  $record = Get-OwnedServiceRecord -State $state -Service $Service
  if ($record -and (Test-OwnedProcess -Record $record)) { return "PROJECT-OWNED PID $($record.pid)" }
  if ($record) { Remove-OwnedServiceRecord -State $state -Service $Service }
  return "EXTERNAL / PRE-EXISTING"
}

Write-Host "AI English Friend status"
Write-Host "======================="

$dbRaw = & node (Join-Path $projectRoot "scripts/check-database.js") --json 2>$null
if ($LASTEXITCODE -eq 0 -and $dbRaw) {
  try {
    $db = $dbRaw | ConvertFrom-Json
    Show-Status "MySQL" "READY" "$($db.message) tables=$($db.tableCount)"
  } catch {
    Show-Status "MySQL" "UNAVAILABLE" "Database check returned invalid status."
    $hasUnavailable = $true
  }
} else {
  Show-Status "MySQL" "UNAVAILABLE" "Configured database is not reachable or is incomplete."
  $hasUnavailable = $true
}

$ollama = Test-HttpEndpoint -Url "$ollamaUrl/api/tags" -TimeoutSec 3
if ($ollama.Ready) {
  $models = @()
  try { $models = @(Invoke-RestMethod -UseBasicParsing -Uri "$ollamaUrl/api/tags" -TimeoutSec 4).models | ForEach-Object { [string]$_.name } } catch { $models = @() }
  $missing = @(@($chatModel, $translationModel) | Select-Object -Unique | Where-Object { $models -notcontains $_ })
  if ($missing.Count -eq 0) { Show-Status "Ollama" "READY" "$(Ownership-Label 'ollama'); model=$chatModel" }
  else { Show-Status "Ollama" "DEGRADED" "$(Ownership-Label 'ollama'); missing model(s): $($missing -join ', ')" }
} else {
  Show-Status "Ollama" "UNAVAILABLE" "API $ollamaUrl is not reachable."
  $hasUnavailable = $true
}

$stt = Test-HttpEndpoint -Url "http://${sttHost}:$sttPort/health" -TimeoutSec 3
if ($stt.Ready) {
  Show-Status "STT" "READY" "$(Ownership-Label 'STT'); http://${sttHost}:$sttPort"
} elseif ((Get-EnvValue -Values $serverEnv -Name "STT_BROWSER_FALLBACK" -Default "true") -eq "true") {
  Show-Status "STT" "DEGRADED" "Unavailable; browser SpeechRecognition fallback is enabled."
} else {
  Show-Status "STT" "UNAVAILABLE" "Unavailable and browser fallback is disabled."
  $hasUnavailable = $true
}

$tts = Test-HttpEndpoint -Url "http://${ttsHost}:$ttsPort/health" -TimeoutSec 3
if ($tts.Ready) {
  Show-Status "TTS" "READY" "$(Ownership-Label 'TTS'); http://${ttsHost}:$ttsPort"
} elseif ((Get-EnvValue -Values $serverEnv -Name "TTS_BROWSER_FALLBACK" -Default "true") -eq "true") {
  Show-Status "TTS" "DEGRADED" "Unavailable; browser Web Speech fallback is enabled."
} else {
  Show-Status "TTS" "UNAVAILABLE" "Unavailable and browser fallback is disabled."
  $hasUnavailable = $true
}

$backend = Test-HttpEndpoint -Url "http://127.0.0.1:$backendPort/health" -TimeoutSec 3
if ($backend.Ready) {
  Show-Status "Backend" "READY" "$(Ownership-Label 'Backend'); http://127.0.0.1:$backendPort"
} else {
  Show-Status "Backend" "UNAVAILABLE" "http://127.0.0.1:$backendPort/health is not reachable."
  $hasUnavailable = $true
}

$frontend = Test-HttpEndpoint -Url "http://127.0.0.1:$frontendPort/" -TimeoutSec 3
if ($frontend.Ready) {
  Show-Status "Frontend" "READY" "$(Ownership-Label 'Frontend'); http://127.0.0.1:$frontendPort"
} else {
  Show-Status "Frontend" "UNAVAILABLE" "http://127.0.0.1:$frontendPort is not reachable."
  $hasUnavailable = $true
}

Write-Host ""
Write-Host "Chat model: $chatModel"
Write-Host "Translation model: $translationModel"
Write-Host "Resource mode: $(Get-EnvValue -Values $serverEnv -Name 'AI_RESOURCE_MODE' -Default 'auto')"
Write-Host "Demo mode: $(Get-EnvValue -Values $serverEnv -Name 'AI_DEMO_MODE' -Default 'false')"
Write-Host "Frontend: http://127.0.0.1:$frontendPort"
Write-Host "Backend:  http://127.0.0.1:$backendPort"

if ($hasUnavailable) { exit 1 }
exit 0
