[CmdletBinding()]
param(
    [string]$SourcePath = (Get-Location).Path,
    [string]$DestinationPath = "C:\Users\nolan\AIProjects\constellation",
    [string]$BackupPath = "C:\Users\nolan\Documents\Constellation-Migration-Backup-2026-07-10.json",
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$CurrentExtensionId,
    [string]$CurrentLoadedPath = "",
    [string]$ExpectedBranch = "layer2-validation-surface-debug-gating",
    [string]$EvidencePath = "C:\Users\nolan\Documents\Constellation-Layer2.2E-Preflight.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Invoke-Git {
    param(
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = & git -C $WorkingDirectory @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }
    return ($output -join [Environment]::NewLine).Trim()
}

function Normalize-Path {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is not available on PATH."
}

$source = Normalize-Path $SourcePath
$destination = Normalize-Path $DestinationPath
$backup = Normalize-Path $BackupPath
$hashSidecar = "$backup.sha256"
$evidence = Normalize-Path $EvidencePath
$loadedPath = if ([string]::IsNullOrWhiteSpace($CurrentLoadedPath)) { $source } else { Normalize-Path $CurrentLoadedPath }

if (-not (Test-Path -LiteralPath (Join-Path $source "manifest.json") -PathType Leaf)) {
    throw "manifest.json was not found in the source repository."
}
if ($loadedPath -ne $source) {
    throw "Chrome loaded path does not match the source repository path."
}
if (Test-Path -LiteralPath $destination) {
    throw "Destination already exists. No files were changed: $destination"
}
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
    throw "Migration package was not found: $backup"
}
if (-not (Test-Path -LiteralPath $hashSidecar -PathType Leaf)) {
    throw "SHA-256 sidecar was not found: $hashSidecar"
}

$branch = Invoke-Git $source @("branch", "--show-current")
if ($branch -ne $ExpectedBranch) {
    throw "Expected branch '$ExpectedBranch' but found '$branch'."
}

$trackedChanges = Invoke-Git $source @("status", "--porcelain=v1", "--untracked-files=no")
if (-not [string]::IsNullOrWhiteSpace($trackedChanges)) {
    throw "Tracked working-tree changes are present.`n$trackedChanges"
}

Invoke-Git $source @("fetch", "origin") | Out-Null
$sourceHead = Invoke-Git $source @("rev-parse", "HEAD")
$remoteHead = Invoke-Git $source @("rev-parse", "origin/$ExpectedBranch")
if ($sourceHead -ne $remoteHead) {
    throw "Local HEAD does not equal origin/$ExpectedBranch. Pull or push deliberately before continuing."
}

$remoteUrl = Invoke-Git $source @("remote", "get-url", "origin")
$manifest = Get-Content -Raw -LiteralPath (Join-Path $source "manifest.json") | ConvertFrom-Json
if ($manifest.name -ne "Constellation") {
    throw "Manifest product name is not Constellation."
}

$expectedFileHash = ((Get-Content -Raw -LiteralPath $hashSidecar).Trim() -split '\s+')[0].ToUpperInvariant()
$actualFileHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToUpperInvariant()
if ($expectedFileHash -ne $actualFileHash) {
    throw "Migration package whole-file SHA-256 does not match its sidecar."
}

$dataPackage = Get-Content -Raw -LiteralPath $backup | ConvertFrom-Json
if ($dataPackage.schema -ne "constellation-data-migration-package-v0.1") {
    throw "Unsupported migration package schema: $($dataPackage.schema)"
}
if ($dataPackage.validation.valid -ne $true) {
    throw "Migration package reports validation.valid != true."
}
if ($dataPackage.sourceExtensionId -ne $CurrentExtensionId) {
    throw "Migration package sourceExtensionId does not match the current extension ID."
}
if ([string]::IsNullOrWhiteSpace([string]$dataPackage.integrity.payloadDigest)) {
    throw "Migration package internal payload digest is missing."
}

$destinationParent = Split-Path -Parent $destination
New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null

Write-Host "Cloning exact branch state into the canonical Constellation path..."
& git clone --branch $ExpectedBranch --single-branch $remoteUrl $destination
if ($LASTEXITCODE -ne 0) {
    throw "Git clone failed. The original repository and extension were not modified."
}

$destinationHead = Invoke-Git $destination @("rev-parse", "HEAD")
$destinationBranch = Invoke-Git $destination @("branch", "--show-current")
$destinationStatus = Invoke-Git $destination @("status", "--porcelain=v1")
$destinationManifest = Get-Content -Raw -LiteralPath (Join-Path $destination "manifest.json") | ConvertFrom-Json

if ($destinationHead -ne $sourceHead) { throw "Destination commit does not match source commit." }
if ($destinationBranch -ne $ExpectedBranch) { throw "Destination branch does not match the expected branch." }
if (-not [string]::IsNullOrWhiteSpace($destinationStatus)) { throw "Destination clone is not clean." }
if ($destinationManifest.name -ne "Constellation") { throw "Destination manifest product name is not Constellation." }

$record = [ordered]@{
    schema = "constellation-layer2-2e-preflight-v0.1"
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    status = "prepared_not_loaded"
    source = [ordered]@{
        repositoryPath = $source
        chromeLoadedPath = $loadedPath
        extensionId = $CurrentExtensionId
        branch = $branch
        commit = $sourceHead
        remote = $remoteUrl
        manifestName = $manifest.name
        manifestVersion = $manifest.version
    }
    destination = [ordered]@{
        repositoryPath = $destination
        branch = $destinationBranch
        commit = $destinationHead
        manifestName = $destinationManifest.name
        manifestVersion = $destinationManifest.version
        extensionLoaded = $false
        extensionId = ""
    }
    backup = [ordered]@{
        path = $backup
        sidecarPath = $hashSidecar
        wholeFileSha256 = $actualFileHash
        schema = $dataPackage.schema
        sourceExtensionId = $dataPackage.sourceExtensionId
        createdAt = $dataPackage.createdAt
        payloadDigest = $dataPackage.integrity.payloadDigest
        packageValidationValid = $dataPackage.validation.valid
    }
    checks = [ordered]@{
        sourceAndLoadedPathMatch = $loadedPath -eq $source
        sourceBranchExpected = $branch -eq $ExpectedBranch
        sourceMatchesRemote = $sourceHead -eq $remoteHead
        destinationMatchesSourceCommit = $destinationHead -eq $sourceHead
        destinationCloneClean = [string]::IsNullOrWhiteSpace($destinationStatus)
        backupWholeFileHashMatches = $actualFileHash -eq $expectedFileHash
        backupSourceExtensionMatches = $dataPackage.sourceExtensionId -eq $CurrentExtensionId
        originalRepositoryModified = $false
        originalExtensionModified = $false
        destinationExtensionLoaded = $false
        importExecuted = $false
    }
    nextGate = "Load the destination path as a second unpacked extension, verify distinct extension IDs and paths, then inspect the package without executing import."
}

$evidenceParent = Split-Path -Parent $evidence
New-Item -ItemType Directory -Path $evidenceParent -Force | Out-Null
$record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidence -Encoding utf8

Write-Host ""
Write-Host "Layer 2.2E preflight prepared successfully." -ForegroundColor Green
Write-Host "Source commit:      $sourceHead"
Write-Host "Destination path:   $destination"
Write-Host "Current extension:  $CurrentExtensionId"
Write-Host "Backup SHA-256:     $actualFileHash"
Write-Host "Evidence record:    $evidence"
Write-Host ""
Write-Host "STOP POINT: Do not execute an import yet." -ForegroundColor Yellow
