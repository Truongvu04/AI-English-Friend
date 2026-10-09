[CmdletBinding()]
param(
  [switch]$CheckOnly,
  [switch]$InitDatabase,
  [switch]$PullModels,
  [switch]$ReinstallNodeDependencies
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($CheckOnly -and ($InitDatabase -or $PullModels -or $ReinstallNodeDependencies)) {
  Write-Error "-CheckOnly cannot be combined with -InitDatabase, -PullModels, or -ReinstallNodeDependencies."
  exit 2
}

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $projectRoot "scripts/project-common.ps1")
Set-Location $projectRoot

$failed = $false

function Fail-Setup([string]$Message) {
  Write-ErrorMessage $Message
  $script:failed = $true
}

function Ensure-EnvFile([string]$ServiceName, [string]$Directory) {
  $envPath = Join-Path $projectRoot (Join-Path $Directory ".env")
  $examplePath = Join-Path $projectRoot (Join-Path $Directory ".env.example")
  if (Test-Path -LiteralPath $envPath) {
    Write-Info "$ServiceName/.env exists; preserving it."
    return
  }
  if (-not (Test-Path -LiteralPath $examplePath)) {
    Fail-Setup "$ServiceName/.env is missing and no .env.example exists."
    return
  }
  Copy-Item -LiteralPath $examplePath -Destination $envPath
  Write-Host "Created $ServiceName/.env from .env.example. Review its values before starting."
}

function Test-RequiredCommands {
  foreach ($item in @(
    @{ Name = "node"; Install = "Install Node.js 20+ and run setup-all.ps1 again." },
    @{ Name = "npm"; Install = "Install npm with Node.js and run setup-all.ps1 again." },
    @{ Name = "python"; Install = "Install Python 3.10+ and run setup-all.ps1 again." },
    @{ Name = "ollama"; Install = "Install Ollama and run setup-all.ps1 again." }
  )) {
    $command = Get-Command $item.Name -ErrorAction SilentlyContinue
    if (-not $command) {
      Fail-Setup "$($item.Name) was not found. $($item.Install)"
      continue
    }
    Write-Info "$($item.Name): $(Get-CommandVersion -CommandName $item.Name)"
  }
}

function Test-NodeWorkspace {
  $nodeModules = Join-Path $projectRoot "node_modules"
  if (-not (Test-Path -LiteralPath $nodeModules)) {
    if ($CheckOnly) {
      Fail-Setup "node_modules is missing. Run setup-all.ps1 to install the locked workspace dependencies."
      return
    }
    Write-Info "node_modules is missing; running npm ci from the workspace root."
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { Fail-Setup "npm ci failed."; return }
  } elseif ($ReinstallNodeDependencies) {
    Write-Info "Reinstalling the locked workspace dependencies because -ReinstallNodeDependencies was supplied."
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { Fail-Setup "npm ci failed."; return }
  } else {
    Write-Info "Existing node_modules found; preserving it and validating the workspace."
  }

  & npm.cmd ls --depth=0 --silent
  if ($LASTEXITCODE -ne 0) {
    Fail-Setup "The existing Node workspace is incomplete. Run setup-all.ps1 -ReinstallNodeDependencies if a rebuild is intended."
  } else {
    Write-Info "Node workspace dependencies: valid."
  }
}

function Invoke-ServiceSetupIfNeeded([string]$ServiceName, [string]$Directory, [string]$SetupScript, [string]$VenvPython) {
  $venvPath = Join-Path $projectRoot $VenvPython
  if (Test-Path -LiteralPath $venvPath) {
    & $venvPath -m pip check
    if ($LASTEXITCODE -ne 0) {
      Fail-Setup "$ServiceName Python environment failed pip check. Review $Directory/setup.ps1; it was not recreated automatically."
    } else {
      Write-Info "$ServiceName Python environment exists and passes pip check."
    }
    return
  }
  if ($CheckOnly) {
    Fail-Setup "$ServiceName environment is missing. Run .\$SetupScript."
    return
  }
  Write-Info "$ServiceName environment is missing; reusing $SetupScript."
  & (Join-Path $projectRoot $SetupScript)
  if ($LASTEXITCODE -ne 0) { Fail-Setup "$ServiceName setup failed." }
}

function Test-OllamaAndModels([hashtable]$ServerEnv) {
  $ollamaUrl = (Get-EnvValue -Values $ServerEnv -Name "OLLAMA_URL" -Default "http://127.0.0.1:11434").TrimEnd("/")
  $chatModel = Get-EnvValue -Values $ServerEnv -Name "OLLAMA_CHAT_MODEL" -Default "qwen3:4b"
  $translationModel = Get-EnvValue -Values $ServerEnv -Name "OLLAMA_TRANSLATION_MODEL" -Default $chatModel
  $health = Test-HttpEndpoint -Url "$ollamaUrl/api/tags" -TimeoutSec 4
  if (-not $health.Ready) {
    Fail-Setup "Ollama API is unavailable at $ollamaUrl. Start Ollama, then run setup-all.ps1 again."
    return
  }

  try {
    $tags = Invoke-RestMethod -UseBasicParsing -Uri "$ollamaUrl/api/tags" -TimeoutSec 5
    $available = @($tags.models | ForEach-Object { [string]$_.name })
    $requiredModels = @($chatModel, $translationModel) | Select-Object -Unique
    foreach ($model in $requiredModels) {
      if ($available -contains $model) {
        Write-Info "Ollama model ${model}: available."
      } elseif ($PullModels) {
        Write-Info "Pulling explicitly requested Ollama model $model."
        & ollama pull $model
        if ($LASTEXITCODE -ne 0) { Fail-Setup "ollama pull $model failed." }
      } else {
        Fail-Setup "Ollama model $model is missing. Run: ollama pull $model, or rerun setup-all.ps1 -PullModels."
      }
    }
  } catch {
    Fail-Setup "Ollama model availability could not be checked."
  }
}

Write-Host "AI English Friend setup"
Write-Host "======================="
if ($CheckOnly) { Write-Info "CheckOnly mode: no files, dependencies, services, or database will be modified." }

if (-not $CheckOnly) {
  Ensure-EnvFile -ServiceName "server" -Directory "server"
  Ensure-EnvFile -ServiceName "frontend" -Directory "frontend"
  Ensure-EnvFile -ServiceName "stt-service" -Directory "stt-service"
  Ensure-EnvFile -ServiceName "tts-service" -Directory "tts-service"
} else {
  foreach ($directory in @("server", "frontend", "stt-service", "tts-service")) {
    if (-not (Test-Path -LiteralPath (Join-Path $projectRoot (Join-Path $directory ".env")))) {
      Write-Warn "$directory/.env is missing; CheckOnly did not create it."
    }
  }
}

Test-RequiredCommands
Test-NodeWorkspace
Invoke-ServiceSetupIfNeeded -ServiceName "STT" -Directory "stt-service" -SetupScript "stt-service/setup.ps1" -VenvPython "stt-service/.venv/Scripts/python.exe"
Invoke-ServiceSetupIfNeeded -ServiceName "TTS" -Directory "tts-service" -SetupScript "tts-service/setup.ps1" -VenvPython "tts-service/.venv/Scripts/python.exe"

$serverEnv = Read-EnvFile -Path (Join-Path $projectRoot "server/.env")
if (-not $serverEnv.ContainsKey("DB_HOST") -or -not $serverEnv.ContainsKey("DB_NAME")) {
  Fail-Setup "server/.env does not contain the database configuration used by the current server."
} else {
  Test-OllamaAndModels -ServerEnv $serverEnv
  if (Test-Path -LiteralPath (Join-Path $projectRoot "scripts/check-database.js")) {
    $dbJson = & node (Join-Path $projectRoot "scripts/check-database.js") --json
    $dbExit = $LASTEXITCODE
    if ($dbJson) { Write-Host "[DB] $dbJson" }
    if ($InitDatabase) {
      Write-Info "-InitDatabase supplied; initializing only if the target database is missing or empty."
      & node (Join-Path $projectRoot "scripts/init-database.js")
      if ($LASTEXITCODE -ne 0) { Fail-Setup "Database initialization was refused or failed." }
    } elseif ($dbExit -eq 2) {
      Fail-Setup "Database configuration is incomplete. Review server/.env; no database connection was attempted with placeholders."
    } elseif ($dbExit -eq 4) {
      Fail-Setup "MySQL is unavailable. Start MySQL or review server/.env."
    } elseif ($dbExit -eq 3) {
      Write-Warn "The configured database does not exist. Run setup-all.ps1 -InitDatabase only for a confirmed fresh/empty target."
    }
  }
}

if ($failed) {
  Write-ErrorMessage "Setup checks failed. No automatic system software installation or destructive database operation was performed."
  exit 1
}

Write-Host "Setup validation complete."
if (-not $InitDatabase) { Write-Host "The existing database was not initialized or modified." }
exit 0
