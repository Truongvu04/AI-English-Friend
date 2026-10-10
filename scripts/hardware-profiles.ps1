Set-StrictMode -Version Latest

function Get-HardwareProfileDefinitions {
  return [ordered]@{
    "low-memory" = [pscustomobject]@{
      Name = "low-memory"
      MinimumRamGb = 0
      SttPreload = $false
      TtsPreload = $false
      ResourceMode = "low-memory"
      ResourcePolicy = "memory-conservative"
      SttIdleUnloadMs = 20000
      TtsIdleUnloadMs = 15000
      ControlsModels = $true
      ControlsResources = $true
      Description = "Aggressive memory conservation with demand-driven AI resources."
    }
    standard = [pscustomobject]@{
      Name = "standard"
      MinimumRamGb = 6
      SttPreload = $false
      TtsPreload = $false
      ResourceMode = "standard"
      ResourcePolicy = "balanced-warm"
      SttIdleUnloadMs = 60000
      TtsIdleUnloadMs = 60000
      ControlsModels = $true
      ControlsResources = $true
      Description = "Balanced local AI resource retention without model upgrades."
    }
    "high-performance" = [pscustomobject]@{
      Name = "high-performance"
      MinimumRamGb = 16
      SttPreload = $false
      TtsPreload = $false
      ResourceMode = "standard"
      ResourcePolicy = "performance-warm"
      SttIdleUnloadMs = 120000
      TtsIdleUnloadMs = 120000
      ControlsModels = $true
      ControlsResources = $true
      Description = "Responsiveness-oriented warm retention with existing lease safety."
    }
    custom = [pscustomobject]@{
      Name = "custom"
      MinimumRamGb = 0
      SttPreload = $null
      TtsPreload = $null
      ResourceMode = $null
      ResourcePolicy = "user-managed"
      SttIdleUnloadMs = $null
      TtsIdleUnloadMs = $null
      ControlsModels = $false
      ControlsResources = $false
      Description = "Preserves existing environment configuration for advanced users."
    }
  }
}

function ConvertTo-ProfileBoolean([string]$Value, [bool]$Default = $false) {
  if ([string]::IsNullOrWhiteSpace($Value)) { return $Default }
  return $Value.Trim().ToLowerInvariant() -eq "true"
}

function Get-SystemHardwareInfo {
  try {
    $computer = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
    $totalBytes = [double]$computer.TotalPhysicalMemory
    if ($totalBytes -le 0) { throw "Win32_ComputerSystem returned no usable TotalPhysicalMemory." }
    $processor = Get-CimInstance Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $totalRamGb = $totalBytes / (1024 * 1024 * 1024)
    return [pscustomobject]@{
      TotalRamGb = $totalRamGb
      DetectedRamGb = [math]::Round($totalRamGb, 2)
      LogicalProcessors = if ($processor) { [int]$processor.NumberOfLogicalProcessors } else { $null }
      ProcessorName = if ($processor) { [string]$processor.Name } else { $null }
      DetectionFailed = $false
      DetectionWarning = $null
    }
  } catch {
    $warning = "Hardware detection failed ($($_.Exception.Message)); using the safest low-memory profile."
    Write-Warn $warning
    return [pscustomobject]@{
      TotalRamGb = 0.0
      DetectedRamGb = $null
      LogicalProcessors = $null
      ProcessorName = $null
      DetectionFailed = $true
      DetectionWarning = $warning
    }
  }
}

function Resolve-ProfileFromMemory([double]$TotalRamGb) {
  if ($TotalRamGb -lt 6) { return "low-memory" }
  if ($TotalRamGb -lt 16) { return "standard" }
  return "high-performance"
}

function Assert-HardwareProfileDefinition([object]$Definition) {
  $required = @("Name", "MinimumRamGb", "ResourcePolicy", "ControlsModels", "ControlsResources")
  foreach ($field in $required) {
    if (-not ($Definition.PSObject.Properties.Name -contains $field)) {
      throw "Hardware profile definition is missing required field '$field'."
    }
  }
  if ([string]::IsNullOrWhiteSpace($Definition.Name)) { throw "Hardware profile definition has an empty name." }
  if ([double]$Definition.MinimumRamGb -lt 0) { throw "Hardware profile '$($Definition.Name)' has an invalid minimum RAM." }
  if ($Definition.ControlsModels) {
    foreach ($field in @("SttPreload", "TtsPreload", "ResourceMode")) {
      if (-not ($Definition.PSObject.Properties.Name -contains $field) -or $null -eq $Definition.$field) {
        throw "Hardware profile '$($Definition.Name)' is missing controlled field '$field'."
      }
    }
  }
  return $true
}

function Get-HardwareProfileDefinition([string]$Name) {
  $definitions = Get-HardwareProfileDefinitions
  foreach ($definition in $definitions.Values) { Assert-HardwareProfileDefinition -Definition $definition | Out-Null }
  if (-not $definitions.Contains($Name)) {
    throw "Unknown hardware profile '$Name'. Supported profiles: $($definitions.Keys -join ', ')."
  }
  return $definitions[$Name]
}

function Get-HardwareProfileContext(
  [string]$RequestedProfile = "auto",
  [hashtable]$ServerEnv = @{},
  [hashtable]$SttEnv = @{},
  [hashtable]$TtsEnv = @{},
  [object]$HardwareInfo = $null
) {
  $requested = if ([string]::IsNullOrWhiteSpace($RequestedProfile)) { "auto" } else { $RequestedProfile.Trim().ToLowerInvariant() }
  $definitions = Get-HardwareProfileDefinitions
  if ($requested -ne "auto" -and -not $definitions.Contains($requested)) {
    throw "Unknown hardware profile '$RequestedProfile'. Supported profiles: auto, $($definitions.Keys -join ', ')."
  }
  if (-not $HardwareInfo) { $HardwareInfo = Get-SystemHardwareInfo }
  $resolved = if ($requested -eq "auto") { Resolve-ProfileFromMemory -TotalRamGb ([double]$HardwareInfo.TotalRamGb) } else { $requested }
  $definition = Get-HardwareProfileDefinition -Name $resolved
  if ($requested -in @("standard", "high-performance") -and [double]$HardwareInfo.TotalRamGb -lt [double]$definition.MinimumRamGb) {
    throw "Profile '$requested' requires at least $($definition.MinimumRamGb) GB RAM. Detected: $([math]::Round([double]$HardwareInfo.TotalRamGb, 2)) GB. Use -Profile low-memory or -Profile custom."
  }

  $sttPreload = if ($resolved -eq "custom") { ConvertTo-ProfileBoolean -Value (Get-EnvValue -Values $SttEnv -Name "FASTER_WHISPER_PRELOAD" -Default "false") } else { [bool]$definition.SttPreload }
  $ttsPreload = if ($resolved -eq "custom") { ConvertTo-ProfileBoolean -Value (Get-EnvValue -Values $TtsEnv -Name "KOKORO_PRELOAD" -Default "false") } else { [bool]$definition.TtsPreload }
  $resourceMode = if ($resolved -eq "custom") { Get-EnvValue -Values $ServerEnv -Name "AI_RESOURCE_MODE" -Default "auto" } else { $definition.ResourceMode }
  $resourcePolicy = $definition.ResourcePolicy

  return [pscustomobject]@{
    RequestedProfile = $requested
    ResolvedProfile = $resolved
    ProfileIdentity = $resolved
    DetectedRamGb = $HardwareInfo.DetectedRamGb
    TotalRamGb = [double]$HardwareInfo.TotalRamGb
    LogicalProcessors = $HardwareInfo.LogicalProcessors
    ProcessorName = $HardwareInfo.ProcessorName
    DetectionFailed = [bool]$HardwareInfo.DetectionFailed
    DetectionWarning = $HardwareInfo.DetectionWarning
    Definition = $definition
    SttPreload = $sttPreload
    TtsPreload = $ttsPreload
    ResourceMode = $resourceMode
    ResourcePolicy = $resourcePolicy
    BackendOverrides = @{}
    SttOverrides = @{}
    TtsOverrides = @{}
  }
}

function Write-HardwareProfileSummary($Context, [string]$Prefix = "") {
  $ram = if ($null -eq $Context.DetectedRamGb) { "unknown (safe fallback)" } else { "{0:N2} GB" -f $Context.DetectedRamGb }
  Write-Host "$Prefix Hardware profile"
  Write-Host "$Prefix ================="
  Write-Host "$Prefix Requested profile: $($Context.RequestedProfile)"
  Write-Host "$Prefix Detected RAM: $ram"
  Write-Host "$Prefix Resolved profile: $($Context.ResolvedProfile)"
  Write-Host "$Prefix STT preload: $($Context.SttPreload.ToString().ToLowerInvariant())"
  Write-Host "$Prefix TTS preload: $($Context.TtsPreload.ToString().ToLowerInvariant())"
  Write-Host "$Prefix Resource policy: $($Context.ResourcePolicy)"
}
