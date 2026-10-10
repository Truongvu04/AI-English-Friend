Set-StrictMode -Version Latest

$script:ModelConfigSchemaVersion = 1
$script:ModelConfigProfiles = @("low-memory", "standard", "high-performance", "custom")
$script:ModelConfigComponents = @("chat", "translation", "stt", "tts")
$script:ModelConfigFields = @{
  chat = @("provider", "model")
  translation = @("provider", "model")
  stt = @("provider", "model")
  tts = @("provider", "modelPath", "voicesPath")
}
$script:ModelConfigProviders = @{
  chat = @("ollama")
  translation = @("ollama")
  stt = @("faster-whisper")
  tts = @("kokoro")
}

function Get-ModelConfigDefaultsPath {
  return Join-Path (Get-ProjectRoot) "config/model-config.defaults.json"
}

function Get-ModelConfigLocalPath {
  return Join-Path (Get-ProjectRoot) "config/model-config.local.json"
}

function Get-ModelConfigProperty([object]$Object, [string]$Name) {
  if ($null -eq $Object) { return $null }
  $property = $Object.PSObject.Properties | Where-Object { $_.Name -eq $Name } | Select-Object -First 1
  if ($property) { return $property.Value }
  return $null
}

function Test-ModelConfigProperty([object]$Object, [string]$Name) {
  if ($null -eq $Object) { return $false }
  return [bool]($Object.PSObject.Properties.Name -contains $Name)
}

function Assert-ModelConfigObject([object]$Object, [string]$Label) {
  if ($null -eq $Object -or $Object -is [string] -or $Object -is [System.Collections.IEnumerable] -and $Object -isnot [pscustomobject]) {
    throw "$Label must be a JSON object."
  }
}

function Assert-ModelConfigKnownKeys([object]$Object, [string[]]$Allowed, [string]$Label) {
  Assert-ModelConfigObject -Object $Object -Label $Label
  foreach ($name in @($Object.PSObject.Properties.Name)) {
    if ($Allowed -notcontains $name) {
      throw "Unknown model configuration key '$name' in $Label."
    }
  }
}

function Assert-ModelName([object]$Value, [string]$Label, [bool]$AllowNull = $false) {
  if ($AllowNull -and $null -eq $Value) { return }
  if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { throw "$Label must be a non-empty string." }
  if ($Value.Length -gt 200 -or $Value -match '\s|[\\\x22<>|;&]' -or $Value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/@-]*$') {
    throw "$Label contains an invalid model identifier '$Value'."
  }
}

function Assert-ModelConfigPath([object]$Value, [string]$Label, [bool]$AllowNull = $true) {
  if ($null -eq $Value -and $AllowNull) { return }
  if ($Value -isnot [string] -or [string]::IsNullOrWhiteSpace($Value)) { throw "$Label must be a non-empty path string or null." }
  if ($Value.Length -gt 1024 -or $Value -match "[\*\?]" -or $Value.IndexOfAny([IO.Path]::GetInvalidPathChars()) -ge 0) {
    throw "$Label contains an invalid path." 
  }
  try { [IO.Path]::GetFullPath($Value) | Out-Null } catch { throw "$Label contains an invalid path." }
}

function Assert-ModelConfigComponent([object]$Component, [string]$ProfileName, [string]$ComponentName, [bool]$AllowNull = $true) {
  $label = "profile '$ProfileName' $ComponentName configuration"
  if ($null -eq $Component) {
    if ($AllowNull) { return }
    throw "$label is required."
  }
  Assert-ModelConfigKnownKeys -Object $Component -Allowed $script:ModelConfigFields[$ComponentName] -Label $label
  $provider = Get-ModelConfigProperty -Object $Component -Name "provider"
  if ($null -ne $provider) {
    if ($provider -isnot [string] -or $script:ModelConfigProviders[$ComponentName] -notcontains $provider) {
      $supported = $script:ModelConfigProviders[$ComponentName] -join ", "
      throw "Provider '$provider' is not supported in the current local release. Supported $ComponentName provider: $supported."
    }
  }
  if ($ComponentName -eq "tts") {
    Assert-ModelConfigPath -Value (Get-ModelConfigProperty $Component "modelPath") -Label "$label modelPath"
    Assert-ModelConfigPath -Value (Get-ModelConfigProperty $Component "voicesPath") -Label "$label voicesPath"
  } else {
    Assert-ModelName -Value (Get-ModelConfigProperty $Component "model") -Label "$label model"
  }
}

function Validate-ModelConfig([object]$Config, [string]$SourceLabel = "model configuration", [bool]$RequireAllProfiles = $false) {
  Assert-ModelConfigKnownKeys -Object $Config -Allowed @("schemaVersion", "profiles") -Label $SourceLabel
  $schemaVersion = Get-ModelConfigProperty -Object $Config -Name "schemaVersion"
  if ($schemaVersion -isnot [int] -and $schemaVersion -isnot [long] -and $schemaVersion -isnot [double]) { throw "Unsupported schemaVersion '$schemaVersion' in $SourceLabel. Supported: $($script:ModelConfigSchemaVersion)." }
  if ([int]$schemaVersion -ne $script:ModelConfigSchemaVersion) { throw "Unsupported schemaVersion '$schemaVersion' in $SourceLabel. Supported: $($script:ModelConfigSchemaVersion)." }
  $profiles = Get-ModelConfigProperty -Object $Config -Name "profiles"
  Assert-ModelConfigObject -Object $profiles -Label "$SourceLabel profiles"
  foreach ($profileName in @($profiles.PSObject.Properties.Name)) {
    if ($script:ModelConfigProfiles -notcontains $profileName) { throw "Unknown model configuration profile '$profileName' in $SourceLabel." }
    $profile = Get-ModelConfigProperty -Object $profiles -Name $profileName
    Assert-ModelConfigKnownKeys -Object $profile -Allowed $script:ModelConfigComponents -Label "$SourceLabel profile '$profileName'"
    foreach ($componentName in $script:ModelConfigComponents) {
      if (Test-ModelConfigProperty -Object $profile -Name $componentName) {
        Assert-ModelConfigComponent -Component (Get-ModelConfigProperty $profile $componentName) -ProfileName $profileName -ComponentName $componentName -AllowNull:$true
      }
    }
    if ($RequireAllProfiles -and $profileName -ne "custom") {
      foreach ($componentName in $script:ModelConfigComponents) {
        $component = Get-ModelConfigProperty $profile $componentName
        if ($null -eq $component) { throw "Default model configuration profile '$profileName' is missing '$componentName'." }
        if (-not (Test-ModelConfigProperty $component "provider")) { throw "Default model configuration profile '$profileName' $componentName is missing provider." }
        if ($componentName -ne "tts" -and -not (Test-ModelConfigProperty $component "model")) { throw "Default model configuration profile '$profileName' $componentName is missing model." }
      }
    }
  }
  if ($RequireAllProfiles) {
    foreach ($profileName in $script:ModelConfigProfiles) {
      if (-not (Test-ModelConfigProperty -Object $profiles -Name $profileName)) { throw "Default model configuration is missing profile '$profileName'." }
    }
  }
  return $true
}

function Read-ModelConfigFile([string]$Path, [bool]$RequireAllProfiles = $false) {
  if (-not (Test-Path -LiteralPath $Path)) { throw "Model configuration file was not found: $Path" }
  try { $config = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json -ErrorAction Stop } catch { throw "Invalid model config JSON: $Path" }
  Validate-ModelConfig -Config $config -SourceLabel $Path -RequireAllProfiles:$RequireAllProfiles | Out-Null
  return $config
}

function Get-ModelConfigDefaults {
  return Read-ModelConfigFile -Path (Get-ModelConfigDefaultsPath) -RequireAllProfiles:$true
}

function Get-ModelConfigLocalOverride {
  $path = Get-ModelConfigLocalPath
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return Read-ModelConfigFile -Path $path -RequireAllProfiles:$false
}

function Merge-ModelComponent([object]$Base, [object]$Override) {
  if ($null -eq $Base -and $null -eq $Override) { return $null }
  $result = [ordered]@{}
  foreach ($field in @("provider", "model", "modelPath", "voicesPath")) {
    $value = $null
    if ($Base -and (Test-ModelConfigProperty $Base $field)) { $value = Get-ModelConfigProperty $Base $field }
    if ($Override -and (Test-ModelConfigProperty $Override $field) -and $null -ne (Get-ModelConfigProperty $Override $field)) { $value = Get-ModelConfigProperty $Override $field }
    if ($null -ne $value) { $result[$field] = $value }
  }
  if ($result.Count -eq 0) { return $null }
  return [pscustomobject]$result
}

function Merge-ModelConfig([object]$Defaults, [object]$LocalOverride) {
  Validate-ModelConfig -Config $Defaults -SourceLabel "tracked model defaults" -RequireAllProfiles:$true | Out-Null
  if ($LocalOverride) { Validate-ModelConfig -Config $LocalOverride -SourceLabel "local model override" -RequireAllProfiles:$false | Out-Null }
  $profiles = [ordered]@{}
  $defaultProfiles = Get-ModelConfigProperty $Defaults "profiles"
  $localProfiles = if ($LocalOverride) { Get-ModelConfigProperty $LocalOverride "profiles" } else { $null }
  foreach ($profileName in $script:ModelConfigProfiles) {
    $defaultProfile = Get-ModelConfigProperty $defaultProfiles $profileName
    $localProfile = if ($localProfiles -and (Test-ModelConfigProperty $localProfiles $profileName)) { Get-ModelConfigProperty $localProfiles $profileName } else { $null }
    $components = [ordered]@{}
    foreach ($componentName in $script:ModelConfigComponents) {
      $defaultComponent = Get-ModelConfigProperty $defaultProfile $componentName
      $localComponent = if ($localProfile -and (Test-ModelConfigProperty $localProfile $componentName)) { Get-ModelConfigProperty $localProfile $componentName } else { $null }
      $components[$componentName] = Merge-ModelComponent -Base $defaultComponent -Override $localComponent
    }
    $profiles[$profileName] = [pscustomobject]$components
  }
  return [pscustomobject]@{ schemaVersion = $script:ModelConfigSchemaVersion; profiles = [pscustomobject]$profiles }
}

function Get-EffectiveModelConfig {
  return Merge-ModelConfig -Defaults (Get-ModelConfigDefaults) -LocalOverride (Get-ModelConfigLocalOverride)
}

function Resolve-ModelConfigPath([string]$Value) {
  if ([IO.Path]::IsPathRooted($Value)) { return $Value }
  return Join-Path (Join-Path (Get-ProjectRoot) "tts-service") $Value
}

function Resolve-ModelConfigForProfile(
  [string]$ProfileName,
  [hashtable]$ServerEnv = @{},
  [hashtable]$SttEnv = @{},
  [hashtable]$TtsEnv = @{},
  [object]$Config = $null
) {
  $profile = if ([string]::IsNullOrWhiteSpace($ProfileName)) { "custom" } else { $ProfileName.Trim().ToLowerInvariant() }
  if ($script:ModelConfigProfiles -notcontains $profile) { throw "Unknown model configuration profile '$ProfileName'. Supported profiles: $($script:ModelConfigProfiles -join ', ')." }
  if (-not $Config) { $Config = Get-EffectiveModelConfig }
  Validate-ModelConfig -Config $Config -SourceLabel "merged model configuration" -RequireAllProfiles:$true | Out-Null

  $defaultChat = Get-EnvValue $ServerEnv "OLLAMA_CHAT_MODEL" (Get-EnvValue $ServerEnv "OLLAMA_MODEL" "qwen3:4b")
  $defaultTranslation = Get-EnvValue $ServerEnv "OLLAMA_TRANSLATION_MODEL" $defaultChat
  $defaultStt = Get-EnvValue $SttEnv "FASTER_WHISPER_MODEL" "base.en"
  $defaultModelPath = Get-EnvValue $TtsEnv "KOKORO_MODEL_PATH" "models/kokoro-v1.0.int8.onnx"
  $defaultVoicesPath = Get-EnvValue $TtsEnv "KOKORO_VOICES_PATH" "models/voices-v1.0.bin"
  $profileObject = Get-ModelConfigProperty (Get-ModelConfigProperty $Config "profiles") $profile
  $chatObject = Get-ModelConfigProperty $profileObject "chat"
  $translationObject = Get-ModelConfigProperty $profileObject "translation"
  $sttObject = Get-ModelConfigProperty $profileObject "stt"
  $ttsObject = Get-ModelConfigProperty $profileObject "tts"
  $isPreset = $profile -ne "custom"

  $chatModel = if ($chatObject -and (Test-ModelConfigProperty $chatObject "model")) { Get-ModelConfigProperty $chatObject "model" } else { $defaultChat }
  $translationModel = if ($translationObject -and (Test-ModelConfigProperty $translationObject "model")) { Get-ModelConfigProperty $translationObject "model" } else { $defaultTranslation }
  $sttModel = if ($sttObject -and (Test-ModelConfigProperty $sttObject "model")) { Get-ModelConfigProperty $sttObject "model" } else { $defaultStt }
  $modelPath = if ($ttsObject -and (Test-ModelConfigProperty $ttsObject "modelPath") -and $null -ne (Get-ModelConfigProperty $ttsObject "modelPath")) { Get-ModelConfigProperty $ttsObject "modelPath" } else { $defaultModelPath }
  $voicesPath = if ($ttsObject -and (Test-ModelConfigProperty $ttsObject "voicesPath") -and $null -ne (Get-ModelConfigProperty $ttsObject "voicesPath")) { Get-ModelConfigProperty $ttsObject "voicesPath" } else { $defaultVoicesPath }
  $resolved = [ordered]@{
    profile = $profile
    preset = $isPreset
    chat = [ordered]@{ provider = "ollama"; model = $chatModel }
    translation = [ordered]@{ provider = "ollama"; model = $translationModel }
    stt = [ordered]@{ provider = "faster-whisper"; model = $sttModel }
    tts = [ordered]@{ provider = "kokoro"; modelPath = $modelPath; voicesPath = $voicesPath }
  }
  $resolvedObject = [pscustomobject]$resolved

  $backend = [ordered]@{}
  $sttOverrides = [ordered]@{}
  $ttsOverrides = [ordered]@{}
  if ($isPreset) {
    $backend.OLLAMA_CHAT_MODEL = $chatModel
    $backend.OLLAMA_TRANSLATION_MODEL = $translationModel
    $sttOverrides.FASTER_WHISPER_MODEL = $sttModel
    $ttsOverrides.KOKORO_MODEL_PATH = $modelPath
    $ttsOverrides.KOKORO_VOICES_PATH = $voicesPath
  } else {
    foreach ($field in @("model")) {
      if ($chatObject -and (Test-ModelConfigProperty $chatObject $field)) { $backend.OLLAMA_CHAT_MODEL = Get-ModelConfigProperty $chatObject $field }
      if ($translationObject -and (Test-ModelConfigProperty $translationObject $field)) { $backend.OLLAMA_TRANSLATION_MODEL = Get-ModelConfigProperty $translationObject $field }
      if ($sttObject -and (Test-ModelConfigProperty $sttObject $field)) { $sttOverrides.FASTER_WHISPER_MODEL = Get-ModelConfigProperty $sttObject $field }
    }
    if ($ttsObject -and (Test-ModelConfigProperty $ttsObject "modelPath")) { $ttsOverrides.KOKORO_MODEL_PATH = Get-ModelConfigProperty $ttsObject "modelPath" }
    if ($ttsObject -and (Test-ModelConfigProperty $ttsObject "voicesPath")) { $ttsOverrides.KOKORO_VOICES_PATH = Get-ModelConfigProperty $ttsObject "voicesPath" }
  }
  $fingerprintPayload = [ordered]@{
    profile = $profile
    chat = [ordered]@{ provider = $resolvedObject.chat.provider; model = $resolvedObject.chat.model }
    translation = [ordered]@{ provider = $resolvedObject.translation.provider; model = $resolvedObject.translation.model }
    stt = [ordered]@{ provider = $resolvedObject.stt.provider; model = $resolvedObject.stt.model }
    tts = [ordered]@{ provider = $resolvedObject.tts.provider; modelPath = $resolvedObject.tts.modelPath; voicesPath = $resolvedObject.tts.voicesPath }
  }
  $fingerprintJson = $fingerprintPayload | ConvertTo-Json -Compress -Depth 6
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $fingerprint = ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($fingerprintJson)))).Replace("-", "").ToLowerInvariant() } finally { $hash.Dispose() }
  return [pscustomobject]@{
    profile = $profile
    preset = $isPreset
    chat = [pscustomobject]$resolvedObject.chat
    translation = [pscustomobject]$resolvedObject.translation
    stt = [pscustomobject]$resolvedObject.stt
    tts = [pscustomobject]$resolvedObject.tts
    fingerprint = $fingerprint
    runtimeOverrides = [pscustomobject]@{ backend = $backend; stt = $sttOverrides; tts = $ttsOverrides }
  }
}

function Get-ModelConfigSummary($Resolved) {
  return [pscustomobject]@{
    profile = $Resolved.profile
    fingerprint = $Resolved.fingerprint
    chat = [pscustomobject]@{ provider = $Resolved.chat.provider; model = $Resolved.chat.model }
    translation = [pscustomobject]@{ provider = $Resolved.translation.provider; model = $Resolved.translation.model }
    stt = [pscustomobject]@{ provider = $Resolved.stt.provider; model = $Resolved.stt.model }
    tts = [pscustomobject]@{ provider = $Resolved.tts.provider; model = [IO.Path]::GetFileName($Resolved.tts.modelPath); voices = [IO.Path]::GetFileName($Resolved.tts.voicesPath) }
  }
}

function Test-ModelConfigAssetPaths($Resolved) {
  $missing = @()
  foreach ($path in @($Resolved.tts.modelPath, $Resolved.tts.voicesPath)) {
    $fullPath = Resolve-ModelConfigPath -Value $path
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) { $missing += $fullPath }
  }
  return $missing
}
