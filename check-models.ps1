[CmdletBinding()]
param(
  [Alias("Profile")]
  [string]$HardwareProfile = "auto"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot "scripts/project-common.ps1")
. (Join-Path $projectRoot "scripts/hardware-profiles.ps1")
. (Join-Path $projectRoot "scripts/model-config.ps1")
Set-Location $projectRoot

try {
  $serverEnv = Read-EnvFile -Path (Join-Path $projectRoot "server/.env")
  $sttEnv = Read-EnvFile -Path (Join-Path $projectRoot "stt-service/.env")
  $ttsEnv = Read-EnvFile -Path (Join-Path $projectRoot "tts-service/.env")
  $hardware = Get-HardwareProfileContext -RequestedProfile $HardwareProfile -ServerEnv $serverEnv -SttEnv $sttEnv -TtsEnv $ttsEnv
  $resolved = Resolve-ModelConfigForProfile -ProfileName $hardware.ResolvedProfile -ServerEnv $serverEnv -SttEnv $sttEnv -TtsEnv $ttsEnv
  $ollamaUrl = (Get-EnvValue -Values $serverEnv -Name "OLLAMA_URL" -Default "http://127.0.0.1:11434").TrimEnd("/")
  $required = @($resolved.chat.model, $resolved.translation.model) | Select-Object -Unique
  $available = @()
  $ollamaReady = $false
  try {
    $tags = Invoke-RestMethod -UseBasicParsing -Uri "$ollamaUrl/api/tags" -TimeoutSec 5
    $available = @($tags.models | ForEach-Object { [string]$_.name })
    $ollamaReady = $true
  } catch {
    $ollamaReady = $false
  }
  $missingModels = @($required | Where-Object { $available -notcontains $_ })
  $missingAssets = @(Test-ModelConfigAssetPaths -Resolved $resolved)

  Write-Host "AI English Friend model check"
  Write-Host "============================="
  Write-Host "Requested profile: $($hardware.RequestedProfile)"
  Write-Host "Resolved profile: $($hardware.ResolvedProfile)"
  Write-Host "Model config fingerprint: $($resolved.fingerprint)"
  Write-Host "Chat: $($resolved.chat.provider) / $($resolved.chat.model)"
  Write-Host "Translation: $($resolved.translation.provider) / $($resolved.translation.model)"
  Write-Host "STT: $($resolved.stt.provider) / $($resolved.stt.model)"
  Write-Host "TTS model: $([IO.Path]::GetFileName($resolved.tts.modelPath))"
  Write-Host "TTS voices: $([IO.Path]::GetFileName($resolved.tts.voicesPath))"
  if ($ollamaReady) {
    if ($missingModels.Count -eq 0) { Write-Host "Ollama: required model(s) available." } else { Write-ErrorMessage "Required Ollama model(s) are not installed: $($missingModels -join ', ')" }
  } else {
    Write-ErrorMessage "Ollama API is unavailable at $ollamaUrl."
  }
  if ($missingAssets.Count -eq 0) { Write-Host "Kokoro assets: available." } else { Write-ErrorMessage "Kokoro asset file(s) are missing: $($missingAssets -join ', ')" }
  if (-not $ollamaReady -or $missingModels.Count -gt 0 -or $missingAssets.Count -gt 0) {
    Write-ErrorMessage "No models were downloaded. Use .\setup-all.cmd -Profile $HardwareProfile -PullModels for an explicit Ollama pull."
    exit 1
  }
  exit 0
} catch {
  Write-ErrorMessage $_.Exception.Message
  exit 2
}
