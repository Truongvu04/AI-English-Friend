[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot "scripts/project-common.ps1")
Set-Location $projectRoot

$state = Read-ProjectRuntimeState
$stopOrder = @("Frontend", "Backend", "TTS", "STT", "Ollama")
$hadFailure = $false

Write-Host "AI English Friend stop"
Write-Host "====================="
foreach ($service in $stopOrder) {
  $result = Stop-OwnedService -State $state -Service $service
  switch ($result) {
    "stopped" { Write-Host "$service stopped." }
    "stale" { Write-Host "$service metadata was stale and has been cleaned." }
    "not-owned" { Write-Host "$service is not project-owned; left untouched." }
    "identity-mismatch" { Write-Warn "$service ownership could not be verified; process was left untouched."; $hadFailure = $true }
    "failed" { Write-ErrorMessage "Could not stop project-owned $service."; $hadFailure = $true }
  }
}

Write-Host "MySQL was not managed or stopped."
if ($hadFailure) { exit 1 }
if (@($state.services).Count -eq 0) {
  Remove-HardwareProfileMetadata
  Write-Host "Hardware profile metadata cleared."
}
Write-Host "No unowned processes were terminated."
exit 0
