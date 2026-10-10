[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot "scripts/project-common.ps1")
. (Join-Path $projectRoot "scripts/hardware-profiles.ps1")

function Assert-ProfileTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "Hardware profile test failed: $Message" }
}

function New-SyntheticHardwareInfo([double]$RamGb) {
  return [pscustomobject]@{
    TotalRamGb = $RamGb
    DetectedRamGb = [math]::Round($RamGb, 2)
    LogicalProcessors = 8
    ProcessorName = "Synthetic test CPU"
    DetectionFailed = $false
    DetectionWarning = $null
  }
}

$expectedMappings = [ordered]@{
  3.68 = "low-memory"
  4 = "low-memory"
  5.99 = "low-memory"
  6 = "standard"
  8 = "standard"
  15.99 = "standard"
  16 = "high-performance"
  32 = "high-performance"
}

foreach ($entry in $expectedMappings.GetEnumerator()) {
  $resolved = Resolve-ProfileFromMemory -TotalRamGb ([double]$entry.Key)
  Assert-ProfileTest ($resolved -eq $entry.Value) "$($entry.Key) GB resolved to '$resolved', expected '$($entry.Value)'."
}

$definitions = Get-HardwareProfileDefinitions
foreach ($name in @("low-memory", "standard", "high-performance", "custom")) {
  $definition = Get-HardwareProfileDefinition -Name $name
  Assert-ProfileTest ($definition.Name -eq $name) "Profile '$name' was not recognized."
  Assert-ProfileTest (-not [string]::IsNullOrWhiteSpace([string]$definition.ResourcePolicy)) "Profile '$name' has no resource policy."
}

$low = Get-HardwareProfileContext -RequestedProfile "auto" -HardwareInfo (New-SyntheticHardwareInfo 3.68)
Assert-ProfileTest ($low.ResolvedProfile -eq "low-memory") "Auto profile did not select low-memory for 3.68 GB."
Assert-ProfileTest ($low.ChatModel -eq "qwen3:1.7b") "Low-memory chat model is incorrect."
Assert-ProfileTest ($low.TranslationModel -eq "qwen3:1.7b") "Low-memory translation model is incorrect."
Assert-ProfileTest ($low.ResourceMode -eq "low-memory") "Low-memory resource mode is incorrect."
Assert-ProfileTest (-not $low.SttPreload -and -not $low.TtsPreload) "Low-memory preload policy is not conservative."

$standard = Get-HardwareProfileContext -RequestedProfile "standard" -HardwareInfo (New-SyntheticHardwareInfo 8)
Assert-ProfileTest ($standard.ChatModel -eq "qwen3:4b") "Standard chat model is incorrect."
Assert-ProfileTest ($standard.TranslationModel -eq "qwen3:4b") "Standard translation model is incorrect."

$customServerEnv = @{ OLLAMA_CHAT_MODEL = "custom-chat"; OLLAMA_TRANSLATION_MODEL = "custom-translation"; AI_RESOURCE_MODE = "auto" }
$customSttEnv = @{ FASTER_WHISPER_MODEL = "custom-stt"; FASTER_WHISPER_PRELOAD = "true" }
$customTtsEnv = @{ KOKORO_MODEL_PATH = "models/custom.onnx"; KOKORO_PRELOAD = "true" }
$custom = Get-HardwareProfileContext -RequestedProfile "custom" -ServerEnv $customServerEnv -SttEnv $customSttEnv -TtsEnv $customTtsEnv -HardwareInfo (New-SyntheticHardwareInfo 3.68)
Assert-ProfileTest ($custom.ResolvedProfile -eq "custom") "Custom profile was not recognized."
Assert-ProfileTest ($custom.ChatModel -eq "custom-chat" -and $custom.TranslationModel -eq "custom-translation") "Custom Ollama environment was not preserved."
Assert-ProfileTest ($custom.SttModel -eq "custom-stt" -and $custom.TtsModel -eq "custom.onnx") "Custom STT/TTS environment was not preserved."
Assert-ProfileTest ($custom.SttPreload -and $custom.TtsPreload) "Custom preload values were not preserved."
Assert-ProfileTest ($custom.BackendOverrides.Count -eq 0 -and $custom.SttOverrides.Count -eq 0 -and $custom.TtsOverrides.Count -eq 0) "Custom profile unexpectedly generated runtime overrides."

$threw = $false
try { Get-HardwareProfileContext -RequestedProfile "unknown" -HardwareInfo (New-SyntheticHardwareInfo 8) | Out-Null } catch { $threw = $true }
Assert-ProfileTest $threw "Unknown profile was accepted."

$threw = $false
try { Get-HardwareProfileContext -RequestedProfile "standard" -HardwareInfo (New-SyntheticHardwareInfo 4) | Out-Null } catch { $threw = $true }
Assert-ProfileTest $threw "Standard profile was accepted below its RAM minimum."

$threw = $false
try { Get-HardwareProfileContext -RequestedProfile "high-performance" -HardwareInfo (New-SyntheticHardwareInfo 8) | Out-Null } catch { $threw = $true }
Assert-ProfileTest $threw "High-performance profile was accepted below its RAM minimum."

Write-Host "Hardware profile resolver tests passed."
Write-Host "Mappings checked: 3.68, 4, 5.99, 6, 8, 15.99, 16, 32 GB."
exit 0
