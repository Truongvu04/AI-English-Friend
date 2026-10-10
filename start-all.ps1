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
Ensure-ProjectDirectories
$nullInputPath = Get-NullInputPath

$state = Read-ProjectRuntimeState
$serverEnv = Read-EnvFile -Path (Join-Path $projectRoot "server/.env")
$sttEnv = Read-EnvFile -Path (Join-Path $projectRoot "stt-service/.env")
$ttsEnv = Read-EnvFile -Path (Join-Path $projectRoot "tts-service/.env")
$ollamaUrl = (Get-EnvValue -Values $serverEnv -Name "OLLAMA_URL" -Default "http://127.0.0.1:11434").TrimEnd("/")
$backendPort = [int](Get-EnvValue -Values $serverEnv -Name "PORT" -Default "3001")
$sttHost = Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_HOST" -Default "127.0.0.1"
$sttPort = [int](Get-EnvValue -Values $sttEnv -Name "FASTER_WHISPER_PORT" -Default "8765")
$ttsHost = Get-EnvValue -Values $ttsEnv -Name "KOKORO_HOST" -Default "127.0.0.1"
$ttsPort = [int](Get-EnvValue -Values $ttsEnv -Name "KOKORO_PORT" -Default "8766")
$frontendPort = 5173
$results = [ordered]@{}
$criticalFailure = $false
$startedThisRun = @{}

try {
  $profileContext = Get-HardwareProfileContext -RequestedProfile $HardwareProfile -ServerEnv $serverEnv -SttEnv $sttEnv -TtsEnv $ttsEnv
  $modelConfig = Get-EffectiveModelConfig
  $resolvedModelConfig = Resolve-ModelConfigForProfile -ProfileName $profileContext.ResolvedProfile -ServerEnv $serverEnv -SttEnv $sttEnv -TtsEnv $ttsEnv -Config $modelConfig
  $missingAssets = @(Test-ModelConfigAssetPaths -Resolved $resolvedModelConfig)
  if ($missingAssets.Count -gt 0) { throw "Kokoro asset file(s) are missing: $($missingAssets -join ', ')" }
} catch {
  Write-ErrorMessage $_.Exception.Message
  exit 2
}

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

function Get-ServiceOwnershipDetail([string]$Service) {
  $record = Get-OwnedServiceRecord -State $state -Service $Service
  if ($record -and (Test-OwnedProcess -Record $record)) { return "PROJECT-OWNED / PRE-EXISTING" }
  if ($record) { Remove-OwnedServiceRecord -State $state -Service $Service }
  return "EXTERNAL / PRE-EXISTING"
}

function Test-ExistingOrExternal([string]$Service, [string]$Endpoint) {
  $health = Test-HttpEndpoint -Url $Endpoint -TimeoutSec 3
  if (-not $health.Ready) { return $false }
  $record = Get-OwnedServiceRecord -State $state -Service $Service
  if ($record -and -not (Test-OwnedProcess -Record $record)) { Remove-OwnedServiceRecord -State $state -Service $Service }
  return $true
}

function ConvertTo-PowerShellLiteral([string]$Value) {
  return "'" + ([string]$Value -replace "'", "''") + "'"
}

function ConvertTo-PowerShellCommand([string]$FilePath, [string[]]$Arguments, [hashtable]$EnvironmentOverrides) {
  $parts = @()
  foreach ($key in @($EnvironmentOverrides.Keys | Sort-Object)) {
    $parts += "`$env:$key = $(ConvertTo-PowerShellLiteral ([string]$EnvironmentOverrides[$key]))"
  }
  $command = "& $(ConvertTo-PowerShellLiteral $FilePath)"
  foreach ($argument in @($Arguments)) { $command += " $(ConvertTo-PowerShellLiteral ([string]$argument))" }
  $parts += $command
  return ($parts -join "; ")
}

function Start-DetachedCommand([string]$Service, [string]$CommandText, [string]$WorkingDirectory) {
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($CommandText))
  $arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -EncodedCommand $encodedCommand"
  return Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -WorkingDirectory $WorkingDirectory -RedirectStandardInput $nullInputPath -RedirectStandardOutput (Join-Path $script:LogRoot "$($Service.ToLower()).out.log") -RedirectStandardError (Join-Path $script:LogRoot "$($Service.ToLower()).err.log") -WindowStyle Hidden -PassThru
}

function Start-Ollama {
  $endpoint = "$ollamaUrl/api/tags"
  if (Test-ExistingOrExternal -Service "Ollama" -Endpoint $endpoint) {
    Set-Result "Ollama" "READY" (Get-ServiceOwnershipDetail -Service "Ollama")
    return
  }
  $command = Get-Command ollama -ErrorAction SilentlyContinue
  if (-not $command) {
    Set-Result "Ollama" "UNAVAILABLE" "ollama executable was not found."
    $script:criticalFailure = $true
    return
  }
  try { $ollamaPort = ([Uri]$ollamaUrl).Port } catch { $ollamaPort = 11434 }
  if (Get-PortOwner -Port $ollamaPort) {
    Set-Result "Ollama" "UNAVAILABLE" (Get-ProcessConflictMessage -Port $ollamaPort)
    $script:criticalFailure = $true
    return
  }
  $commandText = ConvertTo-PowerShellCommand -FilePath $command.Source -Arguments @("serve") -EnvironmentOverrides @{}
  Start-DetachedCommand -Service "Ollama" -CommandText $commandText -WorkingDirectory $projectRoot | Out-Null
  $health = Wait-HttpEndpoint -Url $endpoint -TimeoutSec 30
  if (-not $health.Ready) {
    Set-Result "Ollama" "UNAVAILABLE" "ollama serve did not become ready."
    $script:criticalFailure = $true
    return
  }
  $ownerPid = Wait-PortOwner -Port $ollamaPort -TimeoutSec 5
  if (-not $ownerPid) {
    Set-Result "Ollama" "UNAVAILABLE" "Ollama became healthy but process ownership could not be recorded."
    $script:criticalFailure = $true
    return
  }
  Register-OwnedService -State $state -Service "Ollama" -ProcessId $ownerPid -ExpectedCommand "ollama serve" -Endpoint $endpoint | Out-Null
  $script:startedThisRun["Ollama"] = $true
  Set-Result "Ollama" "READY" "STARTED BY PROJECT"
}

function Get-OllamaModels {
  try {
    $tags = Invoke-RestMethod -UseBasicParsing -Uri "$ollamaUrl/api/tags" -TimeoutSec 5
    return @($tags.models | ForEach-Object { [string]$_.name })
  } catch { return @() }
}

function Test-RequiredModels {
  $available = Get-OllamaModels
  $required = @($resolvedModelConfig.chat.model, $resolvedModelConfig.translation.model) | Select-Object -Unique
  $missing = @($required | Where-Object { $available -notcontains $_ })
  if ($missing.Count -eq 0) { return $true }
  Write-ErrorMessage "Required model for profile '$($profileContext.ResolvedProfile)' is not installed:"
  foreach ($model in $missing) { Write-ErrorMessage $model }
  Write-ErrorMessage "Run .\setup-all.cmd -Profile $($profileContext.RequestedProfile) -PullModels or ollama pull <model>."
  $script:criticalFailure = $true
  return $false
}

function Start-PythonService([string]$Service, [string]$Directory, [string]$ScriptName, [string]$Endpoint, [int]$Port, [string]$ExpectedCommand, [hashtable]$EnvironmentOverrides) {
  if (Test-ExistingOrExternal -Service $Service -Endpoint $Endpoint) {
    Set-Result $Service "READY" (Get-ServiceOwnershipDetail -Service $Service)
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
  $commandText = ConvertTo-PowerShellCommand -FilePath $scriptPath -Arguments @() -EnvironmentOverrides $EnvironmentOverrides
  Start-DetachedCommand -Service $Service -CommandText $commandText -WorkingDirectory (Join-Path $projectRoot $Directory) | Out-Null
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
  $script:startedThisRun[$Service] = $true
  Set-Result $Service "READY" "STARTED BY PROJECT"
}

function Start-NpmService([string]$Service, [string[]]$Arguments, [string]$Endpoint, [int]$Port, [string]$ExpectedCommand, [hashtable]$EnvironmentOverrides, [int]$TimeoutSec = 35) {
  if (Test-ExistingOrExternal -Service $Service -Endpoint $Endpoint) {
    Set-Result $Service "READY" (Get-ServiceOwnershipDetail -Service $Service)
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
  $commandText = ConvertTo-PowerShellCommand -FilePath $npm.Source -Arguments $Arguments -EnvironmentOverrides $EnvironmentOverrides
  Start-DetachedCommand -Service $Service -CommandText $commandText -WorkingDirectory $projectRoot | Out-Null
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
  $script:startedThisRun[$Service] = $true
  Set-Result $Service "READY" "STARTED BY PROJECT"
}

function Get-OwnedServiceNames {
  return @($state.services | Where-Object { $_.startedByProject -and (Test-OwnedProcess -Record $_) } | ForEach-Object { $_.service })
}

function Test-ActiveProfileCompatibility {
  $ownedServices = @(Get-OwnedServiceNames)
  $metadata = Read-HardwareProfileMetadata
  if ($ownedServices.Count -eq 0) {
    if ($metadata) { Remove-HardwareProfileMetadata }
    return $true
  }
  if (-not $metadata) {
    Write-ErrorMessage "Project-owned services are already running without active Hardware Profile metadata. Run .\stop-all.cmd before selecting a profile."
    return $false
  }
  $metadataFingerprint = if ($metadata.PSObject.Properties.Name -contains "modelConfigFingerprint") { [string]$metadata.modelConfigFingerprint } else { "" }
  if ([string]$metadata.resolvedProfile -ne [string]$profileContext.ProfileIdentity -or [string]::IsNullOrWhiteSpace($metadataFingerprint) -or $metadataFingerprint -ne [string]$resolvedModelConfig.fingerprint) {
    Write-ErrorMessage "The active Hardware Profile or Model Configuration differs from the requested configuration."
    Write-ErrorMessage "No services were changed. Run .\stop-all.cmd before switching profiles or models."
    return $false
  }
  return $true
}

function New-ActiveProfileMetadata {
  return [ordered]@{
    status = "active"
    requestedProfile = $profileContext.RequestedProfile
    resolvedProfile = $profileContext.ResolvedProfile
    detectedRamGb = $profileContext.DetectedRamGb
    detectedLogicalProcessors = $profileContext.LogicalProcessors
    modelConfigFingerprint = $resolvedModelConfig.fingerprint
    chatModel = $resolvedModelConfig.chat.model
    translationModel = $resolvedModelConfig.translation.model
    sttModel = $resolvedModelConfig.stt.model
    sttPreload = $profileContext.SttPreload
    ttsModel = [IO.Path]::GetFileName($resolvedModelConfig.tts.modelPath)
    ttsVoices = [IO.Path]::GetFileName($resolvedModelConfig.tts.voicesPath)
    ttsPreload = $profileContext.TtsPreload
    resourcePolicy = $profileContext.ResourcePolicy
    resourceMode = $profileContext.ResourceMode
    startedAt = (Get-Date).ToString("o")
  }
}

function Cleanup-StartedServices {
  foreach ($service in @("Frontend", "Backend", "TTS", "STT", "Ollama")) {
    if ($script:startedThisRun.ContainsKey($service)) { [void](Stop-OwnedService -State $state -Service $service) }
  }
  Remove-HardwareProfileMetadata
}

if (-not (Test-ActiveProfileCompatibility)) { exit 2 }

Write-Host "AI English Friend"
Write-Host "================="
Write-Host ""
Write-HardwareProfileSummary -Context $profileContext
Write-Host "Model configuration fingerprint: $($resolvedModelConfig.fingerprint)"
Write-Host "Chat model: $($resolvedModelConfig.chat.model)"
Write-Host "Translation model: $($resolvedModelConfig.translation.model)"
Write-Host "STT model: $($resolvedModelConfig.stt.model)"
Write-Host "TTS model: $([IO.Path]::GetFileName($resolvedModelConfig.tts.modelPath))"
Write-Host "TTS voices: $([IO.Path]::GetFileName($resolvedModelConfig.tts.voicesPath))"

$dbResult = & node (Join-Path $projectRoot "scripts/check-database.js") --json 2>$null
if ($LASTEXITCODE -eq 0) {
  Set-Result "MySQL" "READY" "Configured database is reachable."
} else {
  Set-Result "MySQL" "UNAVAILABLE" "Configured database is not reachable; MySQL is external infrastructure."
  $criticalFailure = $true
}

if (-not $criticalFailure) {
  Start-Ollama
  if (-not $criticalFailure) { [void](Test-RequiredModels) }
}
if ($criticalFailure) {
  Cleanup-StartedServices
  Write-ErrorMessage "Startup stopped before a partial or mismatched profile could run."
  exit 1
}

Start-PythonService -Service "STT" -Directory "stt-service" -ScriptName "start.ps1" -Endpoint "http://${sttHost}:$sttPort/health" -Port $sttPort -ExpectedCommand "uvicorn app:app" -EnvironmentOverrides $resolvedModelConfig.runtimeOverrides.stt
$ttsOverrides = [ordered]@{}
foreach ($key in @($resolvedModelConfig.runtimeOverrides.tts.Keys)) { $ttsOverrides[$key] = $resolvedModelConfig.runtimeOverrides.tts[$key] }
Start-PythonService -Service "TTS" -Directory "tts-service" -ScriptName "start.ps1" -Endpoint "http://${ttsHost}:$ttsPort/health" -Port $ttsPort -ExpectedCommand "uvicorn app:app" -EnvironmentOverrides $ttsOverrides
$backendOverrides = [ordered]@{}
foreach ($key in @($profileContext.BackendOverrides.Keys)) { $backendOverrides[$key] = $profileContext.BackendOverrides[$key] }
foreach ($key in @($resolvedModelConfig.runtimeOverrides.backend.Keys)) { $backendOverrides[$key] = $resolvedModelConfig.runtimeOverrides.backend[$key] }
$backendOverrides.AI_MODEL_CONFIG_FINGERPRINT = $resolvedModelConfig.fingerprint
if ($profileContext.ResolvedProfile -ne "custom") {
  $backendOverrides.AI_RESOURCE_MODE = $profileContext.ResourceMode
  $backendOverrides.STT_IDLE_UNLOAD_MS = [string]$profileContext.Definition.SttIdleUnloadMs
  $backendOverrides.TTS_IDLE_UNLOAD_MS = [string]$profileContext.Definition.TtsIdleUnloadMs
}
Start-NpmService -Service "Backend" -Arguments @("run", "dev:server") -Endpoint "http://127.0.0.1:$backendPort/health" -Port $backendPort -ExpectedCommand "src/index.js" -EnvironmentOverrides $backendOverrides
Start-NpmService -Service "Frontend" -Arguments @("run", "dev:frontend", "--", "--host", "127.0.0.1", "--port", "$frontendPort", "--strictPort") -Endpoint "http://127.0.0.1:$frontendPort/" -Port $frontendPort -ExpectedCommand "vite" -EnvironmentOverrides @{}

Write-Host ""
Write-Host "Services"
Write-Host "--------"
foreach ($service in @("MySQL", "Ollama", "STT", "TTS", "Backend", "Frontend")) {
  $result = $results[$service]
  if ($result) { Write-Host ("{0,-11} {1,-11} {2}" -f $service, $result.Status, $result.Detail) }
}
Write-Host ""
Write-Host "Frontend: http://127.0.0.1:$frontendPort"
Write-Host "Backend:  http://127.0.0.1:$backendPort"

if ($criticalFailure) {
  Cleanup-StartedServices
  Write-ErrorMessage "Startup completed with a critical service unavailable. Run .\status.ps1 for details."
  exit 1
}

Write-HardwareProfileMetadata -Metadata (New-ActiveProfileMetadata)
exit 0
