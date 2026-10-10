[CmdletBinding()]
param(
    [switch]$AllowDirtyForValidation
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$outputDirectory = Join-Path $projectRoot '.packages'
$developmentOnlyFiles = @(
    'package-source.ps1'
    'package-source.cmd'
)
$stageRoot = $null
$extractRoot = $null

function Invoke-GitText {
    param([string[]]$Arguments)

    $output = @(& git -C $projectRoot @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')"
    }
    return @($output | ForEach-Object { [string]$_ })
}

function Get-RelativePathReason {
    param([string]$RelativePath)

    $normalized = $RelativePath.Replace('\', '/').TrimStart('/')
    $leaf = ($normalized -split '/')[-1]

    if ($normalized -match '(^|/)\.git(/|$)') { return 'Git metadata' }
    if ($normalized -match '(^|/)(\.runtime|\.packages|node_modules|\.venv|__pycache__|logs)(/|$)') { return 'local runtime or environment data' }
    if ($normalized -match '(^|/)(dist|dist-ssr|coverage)(/|$)') { return 'generated build output' }
    if ($leaf -match '^\.env($|\.)' -and $leaf -notmatch '\.example$') { return 'real environment configuration' }
    if ($normalized -match '(^|/)config/model-config\.local\.json$') { return 'local model configuration' }
    if ($normalized -match '(^|/)database/backups(/|$)') { return 'database backup' }
    if ($leaf -match '(?i)(^|[._-])(dump|backup)([._-]|$)') { return 'database dump or backup' }
    if ($leaf -match '(?i)\.(sql\.gz|bak|backup|dump|sqlite|sqlite3|db)$') { return 'database dump or generated database' }
    if ($leaf -match '(?i)\.(onnx|gguf|safetensors|pt|pth|ckpt|bin)$') { return 'model binary' }
    if ($leaf -match '(?i)\.(pyc|pyo)$') { return 'Python cache' }
    return $null
}

function Get-StageRelativePath {
    param([string]$BasePath, [string]$ChildPath)

    return $ChildPath.Substring($BasePath.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
}

try {
    $branch = (Invoke-GitText @('branch', '--show-current') | Select-Object -First 1).Trim()
    $commit = (Invoke-GitText @('rev-parse', 'HEAD') | Select-Object -First 1).Trim()
    $shortCommit = (Invoke-GitText @('rev-parse', '--short=12', 'HEAD') | Select-Object -First 1).Trim()
    $statusLines = @(Invoke-GitText @('status', '--porcelain=v1', '--untracked-files=all') | Where-Object { $_ -and $_.Trim() })

    if ($statusLines.Count -gt 0 -and -not $AllowDirtyForValidation) {
        [Console]::Error.WriteLine('Source package requires a clean Git working tree.')
        exit 2
    }

    if ($AllowDirtyForValidation) {
        Write-Warning 'DEVELOPMENT VALIDATION ONLY: packaging the current dirty worktree with conservative source selection.'
    }

    $trackedPaths = @(Invoke-GitText @('ls-files') | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
    if ($trackedPaths.Count -eq 0) {
        throw 'Unable to determine tracked files.'
    }

    $sourcePaths = @()
    foreach ($relativePath in $trackedPaths) {
        $reason = Get-RelativePathReason -RelativePath $relativePath
        if ($reason) {
            throw "Forbidden tracked file detected: $relativePath ($reason)."
        }

        $sourcePath = Join-Path $projectRoot $relativePath
        if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
            $sourcePaths += $relativePath.Replace('\', '/')
        }
    }

    foreach ($relativePath in $developmentOnlyFiles) {
        $sourcePath = Join-Path $projectRoot $relativePath
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
            throw "Required packaging implementation file is missing: $relativePath"
        }
        if ($sourcePaths -notcontains $relativePath) {
            $sourcePaths += $relativePath
        }
    }
    $sourcePaths = @($sourcePaths | Sort-Object -Unique)

    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    $zipName = "AI-English-Friend-source-$shortCommit.zip"
    $zipPath = Join-Path $outputDirectory $zipName
    $checksumPath = "$zipPath.sha256"
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    if (Test-Path -LiteralPath $checksumPath) { Remove-Item -LiteralPath $checksumPath -Force }

    $stageRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-English-Friend-source-stage-" + [guid]::NewGuid().ToString('N'))
    $packageRoot = Join-Path $stageRoot 'AI-English-Friend'
    New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

    foreach ($relativePath in $sourcePaths) {
        $sourcePath = Join-Path $projectRoot $relativePath
        $destinationPath = Join-Path $packageRoot $relativePath
        $destinationDirectory = Split-Path -Parent $destinationPath
        New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null
        Copy-Item -LiteralPath $sourcePath -Destination $destinationPath -Force
    }

    $manifest = [ordered]@{
        schemaVersion = 1
        project = 'AI English Friend'
        packageType = 'source'
        commit = $commit
        branch = $branch
        sourceFileCount = $sourcePaths.Count
        files = $sourcePaths
    }
    $manifestPath = Join-Path $packageRoot 'SOURCE-PACKAGE-MANIFEST.json'
    $manifestJson = $manifest | ConvertTo-Json -Depth 5
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, [System.Text.UTF8Encoding]::new($false))

    Compress-Archive -Path $packageRoot -DestinationPath $zipPath -CompressionLevel Optimal -Force
    if (-not (Test-Path -LiteralPath $zipPath -PathType Leaf)) {
        throw 'Failed to create ZIP.'
    }

    $hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    [System.IO.File]::WriteAllText($checksumPath, "$hash  $zipName`r`n", [System.Text.UTF8Encoding]::new($false))

    $extractRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("AI-English-Friend-source-extract-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractRoot -Force

    $topLevel = @(Get-ChildItem -LiteralPath $extractRoot -Force)
    if ($topLevel.Count -ne 1 -or $topLevel[0].Name -ne 'AI-English-Friend' -or -not $topLevel[0].PSIsContainer) {
        throw 'Package validation failed: ZIP must contain one top-level AI-English-Friend directory.'
    }

    $extractedFiles = @(Get-ChildItem -LiteralPath $extractRoot -Recurse -File -Force)
    foreach ($file in $extractedFiles) {
        $relativePath = Get-StageRelativePath -BasePath $extractRoot -ChildPath $file.FullName
        $reason = Get-RelativePathReason -RelativePath $relativePath
        if ($reason) {
            throw "Package validation failed: forbidden file detected: $relativePath ($reason)."
        }
        if ($relativePath -notmatch '^AI-English-Friend/') {
            throw "Package validation failed: unexpected archive path: $relativePath"
        }
    }

    $extractedManifestPath = Join-Path $extractRoot 'AI-English-Friend/SOURCE-PACKAGE-MANIFEST.json'
    if (-not (Test-Path -LiteralPath $extractedManifestPath -PathType Leaf)) {
        throw 'Package validation failed: manifest is missing.'
    }
    $extractedManifestText = Get-Content -LiteralPath $extractedManifestPath -Raw
    if ($extractedManifestText -match '(?i)([A-Z]:[\\/]|\\\\|C:/Users/|C:\\Users\\)') {
        throw 'Package validation failed: manifest contains an absolute or user-specific path.'
    }
    $extractedManifest = $extractedManifestText | ConvertFrom-Json
    $manifestFiles = @($extractedManifest.files | ForEach-Object { [string]$_ })
    $expectedFiles = @($sourcePaths | Sort-Object)
    $actualFiles = @($manifestFiles | Sort-Object)
    $differences = Compare-Object -ReferenceObject $expectedFiles -DifferenceObject $actualFiles
    if ($differences) {
        throw 'Package validation failed: manifest file list does not match the staged source.'
    }

    $expectedHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash
    if ($expectedHash -ne $hash) {
        throw 'Package validation failed: checksum changed after archive creation.'
    }

    $zipSize = (Get-Item -LiteralPath $zipPath).Length
    Write-Output '[PACKAGE] PASS'
    Write-Output "[PACKAGE] ZIP: $zipName"
    Write-Output "[PACKAGE] SizeBytes: $zipSize"
    Write-Output "[PACKAGE] SHA256: $hash"
    Write-Output '[PACKAGE] Manifest: AI-English-Friend/SOURCE-PACKAGE-MANIFEST.json'
    Write-Output "[PACKAGE] SourceFiles: $($sourcePaths.Count)"
    Write-Output '[PACKAGE] Extracted validation: PASS'
    Write-Output '[PACKAGE] Forbidden-file scan: PASS'
    exit 0
}
catch {
    Write-Error "[PACKAGE] $($_.Exception.Message)"
    exit 1
}
finally {
    if ($stageRoot -and (Test-Path -LiteralPath $stageRoot)) {
        Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($extractRoot -and (Test-Path -LiteralPath $extractRoot)) {
        Remove-Item -LiteralPath $extractRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
