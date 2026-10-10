Set-StrictMode -Version Latest

$script:ProjectRoot = Split-Path -Parent $PSScriptRoot
$script:RuntimeRoot = Join-Path $script:ProjectRoot ".runtime"
$script:RuntimeStatePath = Join-Path $script:RuntimeRoot "processes.json"
$script:HardwareProfileMetadataPath = Join-Path $script:RuntimeRoot "hardware-profile.json"
$script:NullInputPath = Join-Path $script:RuntimeRoot "empty.stdin"
$script:LogRoot = Join-Path $script:ProjectRoot "logs"

function Get-ProjectRoot {
  return $script:ProjectRoot
}

function Get-RuntimeRoot {
  return $script:RuntimeRoot
}

function Get-LogRoot {
  return $script:LogRoot
}

function Get-NullInputPath {
  Ensure-ProjectDirectories
  return $script:NullInputPath
}

function Ensure-ProjectDirectories {
  foreach ($path in @($script:RuntimeRoot, $script:LogRoot)) {
    if (-not (Test-Path -LiteralPath $path)) {
      New-Item -ItemType Directory -Path $path -Force | Out-Null
    }
  }
  if (-not (Test-Path -LiteralPath $script:NullInputPath)) {
    [IO.File]::WriteAllText($script:NullInputPath, "", [Text.UTF8Encoding]::new($false))
  }
}

function Write-Info([string]$Message) {
  Write-Host "[INFO] $Message"
}

function Write-Warn([string]$Message) {
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorMessage([string]$Message) {
  Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Read-EnvFile([string]$Path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $values
  }

  foreach ($rawLine in Get-Content -LiteralPath $Path) {
    $line = $rawLine.Trim()
    if (-not $line -or $line.StartsWith("#") -or $line.StartsWith("export ")) {
      continue
    }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
      continue
    }
    $key = $Matches[1]
    $value = $Matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $values[$key] = $value
  }
  return $values
}

function Get-EnvValue([hashtable]$Values, [string]$Name, [string]$Default = $null) {
  if ($Values.ContainsKey($Name) -and -not [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
    return [string]$Values[$Name]
  }
  return $Default
}

function Test-PlaceholderValue([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $true
  }
  return $Value -match '(?i)^(your_|change_me|replace_me|example_|password_here|username_here)' -or $Value -match '(?i)(your_mysql|your_password|replace_me)'
}

function Get-CommandVersion([string]$CommandName, [string]$Argument = "--version") {
  $command = Get-Command $CommandName -ErrorAction SilentlyContinue
  if (-not $command) {
    return $null
  }
  try {
    $output = & $command.Source $Argument 2>&1 | Select-Object -First 1
    return [string]$output
  } catch {
    return "available"
  }
}

function Test-HttpEndpoint([string]$Url, [int]$TimeoutSec = 3) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec $TimeoutSec -ErrorAction Stop
    return [pscustomobject]@{
      Ready = ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300)
      StatusCode = [int]$response.StatusCode
      Body = [string]$response.Content
      Error = $null
    }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch { $statusCode = $null }
    }
    return [pscustomobject]@{
      Ready = $false
      StatusCode = $statusCode
      Body = $null
      Error = $_.Exception.Message
    }
  }
}

function Wait-HttpEndpoint([string]$Url, [int]$TimeoutSec = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $result = Test-HttpEndpoint -Url $Url -TimeoutSec 2
    if ($result.Ready) {
      return $result
    }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $deadline)
  return (Test-HttpEndpoint -Url $Url -TimeoutSec 2)
}

function Get-PortOwner([int]$Port) {
  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Select-Object -First 1
    if ($connection) {
      return [int]$connection.OwningProcess
    }
  } catch {
    $line = netstat -ano -p TCP 2>$null | Select-String -Pattern (":$Port\s+.*LISTENING\s+(\d+)$") | Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) {
      return [int]$line.Matches[0].Groups[1].Value
    }
  }
  return $null
}

function Wait-PortOwner([int]$Port, [int]$TimeoutSec = 5) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    $owner = Get-PortOwner -Port $Port
    if ($owner) { return $owner }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)
  return (Get-PortOwner -Port $Port)
}

function Get-ProcessCommandLine([int]$ProcessId) {
  try {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop
    return [string]$process.CommandLine
  } catch {
    return ""
  }
}

function Get-ProcessIdentity([int]$ProcessId) {
  try {
    $process = Get-Process -Id $ProcessId -ErrorAction Stop
    $path = $null
    try { $path = $process.Path } catch { $path = $null }
    $startTime = $null
    try { $startTime = $process.StartTime.ToString("o") } catch { $startTime = $null }
    return [pscustomobject]@{
      Pid = $ProcessId
      ProcessName = [string]$process.ProcessName
      Path = $path
      CommandLine = Get-ProcessCommandLine -ProcessId $ProcessId
      StartTime = $startTime
    }
  } catch {
    return $null
  }
}

function Read-ProjectRuntimeState {
  Ensure-ProjectDirectories
  if (-not (Test-Path -LiteralPath $script:RuntimeStatePath)) {
    return [pscustomobject]@{ version = 1; projectRoot = $script:ProjectRoot; updatedAt = (Get-Date).ToString("o"); services = @() }
  }
  try {
    $state = Get-Content -Raw -LiteralPath $script:RuntimeStatePath | ConvertFrom-Json
    if (-not $state.services) { $state | Add-Member -NotePropertyName services -NotePropertyValue @() -Force }
    return $state
  } catch {
    Write-Warn "Runtime metadata is invalid; starting with an empty ownership registry."
    return [pscustomobject]@{ version = 1; projectRoot = $script:ProjectRoot; updatedAt = (Get-Date).ToString("o"); services = @() }
  }
}

function Write-ProjectRuntimeState($State) {
  Ensure-ProjectDirectories
  $State.updatedAt = (Get-Date).ToString("o")
  $json = $State | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($script:RuntimeStatePath, $json, [Text.UTF8Encoding]::new($false))
}

function Read-HardwareProfileMetadata {
  if (-not (Test-Path -LiteralPath $script:HardwareProfileMetadataPath)) { return $null }
  try { return Get-Content -Raw -LiteralPath $script:HardwareProfileMetadataPath | ConvertFrom-Json } catch { return $null }
}

function Write-HardwareProfileMetadata($Metadata) {
  Ensure-ProjectDirectories
  $json = $Metadata | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($script:HardwareProfileMetadataPath, $json, [Text.UTF8Encoding]::new($false))
}

function Remove-HardwareProfileMetadata {
  if (Test-Path -LiteralPath $script:HardwareProfileMetadataPath) {
    Remove-Item -LiteralPath $script:HardwareProfileMetadataPath -Force
  }
}

function Get-OwnedServiceRecord($State, [string]$Service) {
  return @($State.services | Where-Object { $_.service -eq $Service }) | Select-Object -First 1
}

function Register-OwnedService($State, [string]$Service, [int]$ProcessId, [string]$ExpectedCommand, [string]$Endpoint = $null) {
  $identity = Get-ProcessIdentity -ProcessId $ProcessId
  if (-not $identity) { throw "Unable to inspect process $ProcessId for $Service." }
  $remaining = @($State.services | Where-Object { $_.service -ne $Service })
  $record = [pscustomobject]@{
    service = $Service
    pid = $ProcessId
    processName = $identity.ProcessName
    executablePath = $identity.Path
    commandLine = $identity.CommandLine
    processStartTime = $identity.StartTime
    expectedCommand = $ExpectedCommand
    endpoint = $Endpoint
    startedAt = (Get-Date).ToString("o")
    startedByProject = $true
  }
  $State.services = @($remaining + $record)
  Write-ProjectRuntimeState -State $State
  return $record
}

function Remove-OwnedServiceRecord($State, [string]$Service) {
  $State.services = @($State.services | Where-Object { $_.service -ne $Service })
  Write-ProjectRuntimeState -State $State
}

function Test-OwnedProcess($Record) {
  if (-not $Record -or -not $Record.pid) { return $false }
  $identity = Get-ProcessIdentity -ProcessId ([int]$Record.pid)
  if (-not $identity) { return $false }
  if ($Record.processName -and $identity.ProcessName -ne $Record.processName) { return $false }
  if (($Record.PSObject.Properties.Name -contains "executablePath") -and $Record.executablePath -and $identity.Path -and $identity.Path -ne $Record.executablePath) { return $false }
  if (($Record.PSObject.Properties.Name -contains "processStartTime") -and $Record.processStartTime -and $identity.StartTime -and $identity.StartTime -ne $Record.processStartTime) { return $false }
  if ($Record.expectedCommand -and $identity.CommandLine -and $identity.CommandLine -notlike "*$($Record.expectedCommand)*") { return $false }
  return $true
}

function Stop-OwnedService($State, [string]$Service) {
  $record = Get-OwnedServiceRecord -State $State -Service $Service
  if (-not $record) {
    return "not-owned"
  }
  if (-not (Get-ProcessIdentity -ProcessId ([int]$record.pid))) {
    Remove-OwnedServiceRecord -State $State -Service $Service
    return "stale"
  }
  if (-not (Test-OwnedProcess -Record $record)) {
    Write-Warn "$Service PID $($record.pid) no longer matches its recorded identity; it was not stopped."
    Remove-OwnedServiceRecord -State $State -Service $Service
    return "identity-mismatch"
  }
  try {
    Stop-Process -Id ([int]$record.pid) -ErrorAction Stop
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline -and (Get-ProcessIdentity -ProcessId ([int]$record.pid))) { Start-Sleep -Milliseconds 250 }
    if (Get-ProcessIdentity -ProcessId ([int]$record.pid)) {
      if (Test-OwnedProcess -Record $record) {
        Stop-Process -Id ([int]$record.pid) -Force -ErrorAction Stop
      } else {
        Write-Warn "$Service did not stop gracefully and identity changed; force stop skipped."
      }
    }
    Remove-OwnedServiceRecord -State $State -Service $Service
    return "stopped"
  } catch {
    if (Test-OwnedProcess -Record $record) {
      $previousErrorAction = $ErrorActionPreference
      $ErrorActionPreference = "Continue"
      & taskkill.exe /PID ([int]$record.pid) /T /F 2>$null | Out-Null
      $taskKillExitCode = $LASTEXITCODE
      $ErrorActionPreference = $previousErrorAction
      if ($taskKillExitCode -eq 0) {
        Start-Sleep -Milliseconds 500
        if (-not (Get-ProcessIdentity -ProcessId ([int]$record.pid))) {
          Remove-OwnedServiceRecord -State $State -Service $Service
          return "stopped"
        }
      }
    }
    Write-Warn "Could not stop owned $Service PID $($record.pid): $($_.Exception.Message)"
    return "failed"
  }
}
