[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $projectRoot "scripts/project-common.ps1")
. (Join-Path $projectRoot "scripts/hardware-profiles.ps1")
. (Join-Path $projectRoot "scripts/model-config.ps1")

function Assert-ModelConfigTest([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw "Model configuration test failed: $Message" }
}

function Synthetic-Hardware([double]$RamGb) {
  return [pscustomobject]@{ TotalRamGb = $RamGb; DetectedRamGb = $RamGb; LogicalProcessors = 8; ProcessorName = "Synthetic"; DetectionFailed = $false; DetectionWarning = $null }
}

$defaults = Get-ModelConfigDefaults
Assert-ModelConfigTest (Validate-ModelConfig -Config $defaults -SourceLabel "defaults" -RequireAllProfiles:$true) "Default configuration did not validate."
$merged = Merge-ModelConfig -Defaults $defaults -LocalOverride $null
$envServer = @{ OLLAMA_CHAT_MODEL = "env-chat"; OLLAMA_TRANSLATION_MODEL = "env-translation" }
$envStt = @{ FASTER_WHISPER_MODEL = "env-stt" }
$envTts = @{ KOKORO_MODEL_PATH = "D:\\AI_Models\\Kokoro\\kokoro-v1.0.int8.onnx"; KOKORO_VOICES_PATH = "D:\\AI_Models\\Kokoro\\voices-v1.0.bin" }

$lowHardware = Get-HardwareProfileContext -RequestedProfile "auto" -HardwareInfo (Synthetic-Hardware 3.68)
$low = Resolve-ModelConfigForProfile -ProfileName $lowHardware.ResolvedProfile -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $merged
Assert-ModelConfigTest ($low.profile -eq "low-memory" -and $low.chat.model -eq "qwen3:1.7b" -and $low.translation.model -eq "qwen3:1.7b") "Low-memory defaults are incorrect."
$standard = Resolve-ModelConfigForProfile -ProfileName "standard" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $merged
Assert-ModelConfigTest ($standard.chat.model -eq "qwen3:4b" -and $standard.translation.model -eq "qwen3:4b") "Standard defaults are incorrect."
$high = Resolve-ModelConfigForProfile -ProfileName "high-performance" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $merged
Assert-ModelConfigTest ($high.chat.model -eq "qwen3:4b" -and $high.translation.model -eq "qwen3:4b") "High-performance defaults are incorrect."

$custom = Resolve-ModelConfigForProfile -ProfileName "custom" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $merged
Assert-ModelConfigTest ($custom.chat.model -eq "env-chat" -and $custom.translation.model -eq "env-translation" -and $custom.stt.model -eq "env-stt") "Custom environment inheritance is incorrect."
Assert-ModelConfigTest ($custom.runtimeOverrides.backend.Count -eq 0 -and $custom.runtimeOverrides.stt.Count -eq 0) "Custom inheritance unexpectedly generated overrides."

$local = '{"schemaVersion":1,"profiles":{"standard":{"chat":{"model":"test-chat-model"},"translation":{"model":"test-translation-model"},"stt":{"model":"test-stt-model"},"tts":{"modelPath":"models/test-kokoro.onnx","voicesPath":"models/test-voices.bin"}},"custom":{"chat":{"model":"local-chat"},"translation":{"model":"local-translation"}}}}' | ConvertFrom-Json
$localMerged = Merge-ModelConfig -Defaults $defaults -LocalOverride $local
$localStandard = Resolve-ModelConfigForProfile -ProfileName "standard" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $localMerged
Assert-ModelConfigTest ($localStandard.chat.model -eq "test-chat-model" -and $localStandard.translation.model -eq "test-translation-model") "Partial local override did not deep-merge."
Assert-ModelConfigTest ($localStandard.runtimeOverrides.backend.OLLAMA_CHAT_MODEL -eq "test-chat-model" -and $localStandard.runtimeOverrides.backend.OLLAMA_TRANSLATION_MODEL -eq "test-translation-model") "Chat/translation runtime mapping collapsed or was omitted."
Assert-ModelConfigTest ($localStandard.stt.model -eq "test-stt-model" -and $localStandard.tts.modelPath -eq "models/test-kokoro.onnx" -and $localStandard.tts.voicesPath -eq "models/test-voices.bin") "STT/TTS local asset overrides did not apply."
$localCustom = Resolve-ModelConfigForProfile -ProfileName "custom" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $localMerged
Assert-ModelConfigTest ($localCustom.chat.model -eq "local-chat" -and $localCustom.translation.model -eq "local-translation") "Custom local override did not apply."

Assert-ModelConfigTest ($localStandard.fingerprint -eq (Resolve-ModelConfigForProfile -ProfileName "standard" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $localMerged).fingerprint) "Fingerprint is not deterministic."
$changedLocal = '{"schemaVersion":1,"profiles":{"standard":{"chat":{"model":"changed-chat"}}}}' | ConvertFrom-Json
$changedMerged = Merge-ModelConfig -Defaults $defaults -LocalOverride $changedLocal
$changed = Resolve-ModelConfigForProfile -ProfileName "standard" -ServerEnv $envServer -SttEnv $envStt -TtsEnv $envTts -Config $changedMerged
Assert-ModelConfigTest ($changed.fingerprint -ne $localStandard.fingerprint) "Fingerprint did not change after a model change."

$invalidCases = @(
  @{ Config = '{"schemaVersion":2,"profiles":{}}' | ConvertFrom-Json; Message = "schema version" },
  @{ Config = '{"schemaVersion":1,"profiles":{"standard":{"chat":{"provider":"openai"}}}}' | ConvertFrom-Json; Message = "provider" },
  @{ Config = '{"schemaVersion":1,"profiles":{"standard":{"chatModle":{"model":"bad"}}}}' | ConvertFrom-Json; Message = "unknown key" },
  @{ Config = '{"schemaVersion":1,"profiles":{"standard":{"tts":{"modelPath":"*bad"}}}}' | ConvertFrom-Json; Message = "path" },
  @{ Config = '{"schemaVersion":1,"profiles":5}' | ConvertFrom-Json; Message = "profiles type" },
  @{ Config = '{"schemaVersion":1,"profiles":{"standard":{"chat":{"model":42}}}}' | ConvertFrom-Json; Message = "model type" }
)
foreach ($case in $invalidCases) {
  $threw = $false
  try { Validate-ModelConfig -Config $case.Config -SourceLabel "test" | Out-Null } catch { $threw = $true }
  Assert-ModelConfigTest $threw "Invalid $($case.Message) configuration was accepted."
}

$invalidJsonPath = Join-Path ([IO.Path]::GetTempPath()) ("ai-english-friend-invalid-model-config-{0}.json" -f $PID)
try {
  [IO.File]::WriteAllText($invalidJsonPath, '{"schemaVersion":1,')
  $threw = $false
  try { Read-ModelConfigFile -Path $invalidJsonPath | Out-Null } catch { $threw = $true }
  Assert-ModelConfigTest $threw "Invalid JSON file was accepted."
} finally {
  if (Test-Path -LiteralPath $invalidJsonPath) { Remove-Item -LiteralPath $invalidJsonPath -Force }
}

Assert-ModelConfigTest ($low.tts.modelPath -eq $envTts.KOKORO_MODEL_PATH -and $low.tts.voicesPath -eq $envTts.KOKORO_VOICES_PATH) "TTS asset inheritance is incorrect."
Assert-ModelConfigTest ((@(Test-ModelConfigAssetPaths -Resolved $low)).Count -eq 0) "Current Kokoro assets were not found."
Write-Host "Model configuration resolver tests passed."
exit 0
