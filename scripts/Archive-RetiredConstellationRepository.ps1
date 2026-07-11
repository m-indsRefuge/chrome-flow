[CmdletBinding()]
param(
    [string]$SourcePath = "C:\Users\nolan\AIProjects\chrome-flow",
    [string]$ArchivePath = "C:\Users\nolan\AIProjects\_retired\chrome-flow-retired-2026-07-11",
    [string]$CanonicalPath = "C:\Users\nolan\AIProjects\constellation",
    [string]$BackupPath = "C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json",
    [string]$EvidencePath = "C:\Users\nolan\Documents\Constellation-Layer2.2G-GateG7-Archive-Evidence.json",
    [switch]$AllowReviewedUntrackedArtifacts
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$reviewedUntrackedPaths = @(
    ".editorconfig",
    ".prettierignore",
    ".prettierrc",
    ".vscode/settings.json",
    "AGENTS.md",
    "Apply-V0TabNativeConsolidation.ps1",
    "docs/Apply-V0TabNativeConsolidation_README (1).txt",
    "src/sidepanel/workspace-dedicated-window-threshold-execution.js.bak.20260706-133255"
) | Sort-Object

function Normalize-Path {
    param([Parameter(Mandatory = $true)][string]$Path)
    [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Invoke-GitText {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = @(& git -C $Repository @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Git failed: git $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }

    ($output -join [Environment]::NewLine).Trim()
}

function Invoke-GitLines {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    $output = @(& git -C $Repository @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "Git failed: git $($Arguments -join ' ')`n$($output -join [Environment]::NewLine)"
    }

    @($output | ForEach-Object { [string]$_ } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Test-SameStringSet {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Left,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$Right
    )

    $leftSorted = @($Left | Sort-Object)
    $rightSorted = @($Right | Sort-Object)

    if ($leftSorted.Count -ne $rightSorted.Count) {
        return $false
    }

    for ($index = 0; $index -lt $leftSorted.Count; $index++) {
        if ($leftSorted[$index] -cne $rightSorted[$index]) {
            return $false
        }
    }

    return $true
}

function Get-UntrackedArtifactRecords {
    param(
        [Parameter(Mandatory = $true)][string]$Repository,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][string[]]$RelativePaths
    )

    $records = @()
    foreach ($relativePath in ($RelativePaths | Sort-Object)) {
        $fullPath = Join-Path $Repository $relativePath
        if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            throw "Untracked artifact is missing or is not a file: $relativePath"
        }

        $item = Get-Item -LiteralPath $fullPath
        $records += [PSCustomObject]@{
            relativePath = $relativePath
            sizeBytes = [int64]$item.Length
            sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToUpperInvariant()
        }
    }

    @($records)
}

function Test-SameArtifactRecords {
    param(
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$Before,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][object[]]$After
    )

    $beforeSorted = @($Before | Sort-Object relativePath)
    $afterSorted = @($After | Sort-Object relativePath)

    if ($beforeSorted.Count -ne $afterSorted.Count) {
        return $false
    }

    for ($index = 0; $index -lt $beforeSorted.Count; $index++) {
        $beforeRecord = $beforeSorted[$index]
        $afterRecord = $afterSorted[$index]

        if ([string]$beforeRecord.relativePath -cne [string]$afterRecord.relativePath) {
            return $false
        }
        if ([int64]$beforeRecord.sizeBytes -ne [int64]$afterRecord.sizeBytes) {
            return $false
        }
        if ([string]$beforeRecord.sha256 -cne [string]$afterRecord.sha256) {
            return $false
        }
    }

    return $true
}

function Get-RepositorySnapshot {
    param([Parameter(Mandatory = $true)][string]$Repository)

    $gitPath = Join-Path $Repository ".git"
    $manifestPath = Join-Path $Repository "manifest.json"

    if (-not (Test-Path -LiteralPath $Repository -PathType Container)) {
        throw "Repository path does not exist: $Repository"
    }
    if (-not (Test-Path -LiteralPath $gitPath -PathType Container)) {
        throw ".git directory was not found: $gitPath"
    }
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "manifest.json was not found: $manifestPath"
    }

    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json -ErrorAction Stop
    $trackedStatus = Invoke-GitText $Repository @("status", "--porcelain=v1", "--untracked-files=no")
    $allStatus = Invoke-GitText $Repository @("status", "--porcelain=v1", "--untracked-files=all")
    $untrackedPaths = @(Invoke-GitLines $Repository @("ls-files", "--others", "--exclude-standard") | Sort-Object)
    $artifactRecords = @(Get-UntrackedArtifactRecords -Repository $Repository -RelativePaths $untrackedPaths)

    [PSCustomObject]@{
        path = $Repository
        branch = Invoke-GitText $Repository @("branch", "--show-current")
        head = Invoke-GitText $Repository @("rev-parse", "HEAD")
        remote = Invoke-GitText $Repository @("remote", "get-url", "origin")
        manifestName = [string]$manifest.name
        manifestVersion = [string]$manifest.version
        trackedStatusPorcelain = $trackedStatus
        statusPorcelain = $allStatus
        trackedWorkingTreeClean = [string]::IsNullOrWhiteSpace($trackedStatus)
        fullyClean = [string]::IsNullOrWhiteSpace($allStatus)
        untrackedPaths = $untrackedPaths
        untrackedArtifacts = $artifactRecords
        gitPresent = $true
        manifestPresent = $true
    }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is not available on PATH."
}

$source = Normalize-Path $SourcePath
$archive = Normalize-Path $ArchivePath
$canonical = Normalize-Path $CanonicalPath
$backup = Normalize-Path $BackupPath
$backupSidecar = "$backup.sha256"
$evidence = Normalize-Path $EvidencePath

if ($source -eq $archive -or $source -eq $canonical -or $archive -eq $canonical) {
    throw "Source, archive, and canonical paths must be distinct."
}
if (Test-Path -LiteralPath $archive) {
    throw "Refusing to overwrite an existing archive path: $archive"
}
if (Test-Path -LiteralPath $evidence) {
    throw "Refusing to overwrite an existing evidence record: $evidence"
}
if (-not (Test-Path -LiteralPath $backup -PathType Leaf)) {
    throw "Pre-retirement backup was not found: $backup"
}
if (-not (Test-Path -LiteralPath $backupSidecar -PathType Leaf)) {
    throw "Pre-retirement backup sidecar was not found: $backupSidecar"
}

$expectedBackupHash = ((Get-Content -Raw -LiteralPath $backupSidecar).Trim() -split '\s+')[0].ToUpperInvariant()
$actualBackupHash = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash.ToUpperInvariant()
if ($expectedBackupHash -ne $actualBackupHash) {
    throw "Pre-retirement backup whole-file SHA-256 does not match its sidecar."
}

$backupPackage = Get-Content -Raw -LiteralPath $backup | ConvertFrom-Json -ErrorAction Stop
if ($backupPackage.schema -ne "constellation-data-migration-package-v0.1") {
    throw "Unexpected pre-retirement backup schema: $($backupPackage.schema)"
}
if ($backupPackage.sourceExtensionId -ne "hkakifedpohjilmjiiobcmmgemgighli") {
    throw "Pre-retirement backup does not belong to the accepted primary extension identity."
}
if ($backupPackage.validation.valid -ne $true) {
    throw "Pre-retirement backup reports validation.valid != true."
}

$sourceBefore = Get-RepositorySnapshot $source
$canonicalBefore = Get-RepositorySnapshot $canonical

if (-not $sourceBefore.trackedWorkingTreeClean) {
    throw "Former repository has tracked or staged changes. Archive stopped.`n$($sourceBefore.trackedStatusPorcelain)"
}

$reviewedSetMatches = Test-SameStringSet -Left @($sourceBefore.untrackedPaths) -Right $reviewedUntrackedPaths
if ($sourceBefore.untrackedPaths.Count -gt 0) {
    if (-not $AllowReviewedUntrackedArtifacts) {
        throw "Former repository contains reviewed untracked artifacts. Re-run only with -AllowReviewedUntrackedArtifacts after Operator approval.`n$($sourceBefore.statusPorcelain)"
    }
    if (-not $reviewedSetMatches) {
        throw "Former repository untracked artifacts do not exactly match the reviewed Gate G7 set. Archive stopped.`n$($sourceBefore.statusPorcelain)"
    }
}

if (-not $canonicalBefore.fullyClean) {
    throw "Canonical repository working tree is not clean. Archive stopped.`n$($canonicalBefore.statusPorcelain)"
}
if ($sourceBefore.manifestName -ne "Constellation" -or $canonicalBefore.manifestName -ne "Constellation") {
    throw "Repository manifest identity check failed."
}
if ($sourceBefore.remote -ne $canonicalBefore.remote) {
    throw "Former and canonical repositories do not point to the same origin remote."
}

$archiveParent = Split-Path -Parent $archive
New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null

$moved = $false
$rollbackAttempted = $false
$rollbackSucceeded = $false

try {
    Move-Item -LiteralPath $source -Destination $archive
    $moved = $true

    if (Test-Path -LiteralPath $source) {
        throw "Former repository source path still exists after the move."
    }

    $archiveAfter = Get-RepositorySnapshot $archive
    $canonicalAfter = Get-RepositorySnapshot $canonical

    if ($archiveAfter.head -ne $sourceBefore.head) {
        throw "Archived repository HEAD changed during the move."
    }
    if ($archiveAfter.branch -ne $sourceBefore.branch) {
        throw "Archived repository branch changed during the move."
    }
    if ($archiveAfter.remote -ne $sourceBefore.remote) {
        throw "Archived repository remote changed during the move."
    }
    if (-not $archiveAfter.trackedWorkingTreeClean) {
        throw "Archived repository has tracked or staged changes after the move."
    }
    if (-not (Test-SameStringSet -Left @($archiveAfter.untrackedPaths) -Right @($sourceBefore.untrackedPaths))) {
        throw "Archived untracked artifact path set changed during the move."
    }
    if (-not (Test-SameArtifactRecords -Before @($sourceBefore.untrackedArtifacts) -After @($archiveAfter.untrackedArtifacts))) {
        throw "One or more reviewed untracked artifacts changed during the move."
    }
    if ($archiveAfter.manifestName -ne $sourceBefore.manifestName) {
        throw "Archived manifest identity changed during the move."
    }

    if ($canonicalAfter.head -ne $canonicalBefore.head) {
        throw "Canonical repository HEAD changed during the archive operation."
    }
    if ($canonicalAfter.branch -ne $canonicalBefore.branch) {
        throw "Canonical repository branch changed during the archive operation."
    }
    if ($canonicalAfter.remote -ne $canonicalBefore.remote) {
        throw "Canonical repository remote changed during the archive operation."
    }
    if (-not $canonicalAfter.fullyClean) {
        throw "Canonical repository is not clean after the archive operation."
    }

    $artifactPathsPreserved = Test-SameStringSet -Left @($archiveAfter.untrackedPaths) -Right @($sourceBefore.untrackedPaths)
    $artifactHashesPreserved = Test-SameArtifactRecords -Before @($sourceBefore.untrackedArtifacts) -After @($archiveAfter.untrackedArtifacts)

    $record = [ordered]@{
        schema = "constellation-layer2-2g-gate-g7-archive-evidence-v0.2"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        status = "archived_and_verified"
        formerExtensionId = "kdaionpogabdghghejldbgdfefgdbmbi"
        primaryExtensionId = "hkakifedpohjilmjiiobcmmgemgighli"
        sourceBefore = $sourceBefore
        archiveAfter = $archiveAfter
        canonicalBefore = $canonicalBefore
        canonicalAfter = $canonicalAfter
        reviewedUntrackedArtifactPolicy = [ordered]@{
            operatorAuthorized = [bool]$AllowReviewedUntrackedArtifacts
            exactReviewedSetRequired = $true
            reviewedRelativePaths = $reviewedUntrackedPaths
            preservedRecords = $archiveAfter.untrackedArtifacts
        }
        recoveryAnchor = [ordered]@{
            backupPath = $backup
            sidecarPath = $backupSidecar
            wholeFileSha256 = $actualBackupHash
            payloadDigest = [string]$backupPackage.integrity.payloadDigest
            sourceExtensionId = [string]$backupPackage.sourceExtensionId
            valid = [bool]$backupPackage.validation.valid
        }
        checks = [ordered]@{
            sourceRemovedByMove = -not (Test-Path -LiteralPath $source)
            archivePathPresent = Test-Path -LiteralPath $archive -PathType Container
            archivedGitPresent = Test-Path -LiteralPath (Join-Path $archive ".git") -PathType Container
            archivedManifestPresent = Test-Path -LiteralPath (Join-Path $archive "manifest.json") -PathType Leaf
            archivedHeadPreserved = $archiveAfter.head -eq $sourceBefore.head
            archivedBranchPreserved = $archiveAfter.branch -eq $sourceBefore.branch
            archivedRemotePreserved = $archiveAfter.remote -eq $sourceBefore.remote
            archivedTrackedWorkingTreeClean = $archiveAfter.trackedWorkingTreeClean
            reviewedUntrackedPathSetPreserved = $artifactPathsPreserved
            reviewedUntrackedHashesPreserved = $artifactHashesPreserved
            canonicalHeadPreserved = $canonicalAfter.head -eq $canonicalBefore.head
            canonicalBranchPreserved = $canonicalAfter.branch -eq $canonicalBefore.branch
            canonicalRemotePreserved = $canonicalAfter.remote -eq $canonicalBefore.remote
            canonicalWorkingTreeClean = $canonicalAfter.fullyClean
            backupWholeFileHashMatches = $actualBackupHash -eq $expectedBackupHash
            rollbackRequired = $false
        }
    }

    $evidenceParent = Split-Path -Parent $evidence
    New-Item -ItemType Directory -Path $evidenceParent -Force | Out-Null
    $record | ConvertTo-Json -Depth 14 | Set-Content -LiteralPath $evidence -Encoding utf8

    [PSCustomObject]@{
        Status = "archived_and_verified"
        FormerSourcePath = $source
        ArchivePath = $archive
        FormerBranch = $archiveAfter.branch
        FormerHead = $archiveAfter.head
        FormerRemote = $archiveAfter.remote
        ArchivedTrackedWorkingTreeClean = $archiveAfter.trackedWorkingTreeClean
        ReviewedUntrackedArtifactCount = $archiveAfter.untrackedPaths.Count
        ReviewedUntrackedArtifactsPreserved = $artifactHashesPreserved
        ArchivedGitPresent = Test-Path -LiteralPath (Join-Path $archive ".git") -PathType Container
        ArchivedManifestPresent = Test-Path -LiteralPath (Join-Path $archive "manifest.json") -PathType Leaf
        CanonicalPath = $canonical
        CanonicalBranch = $canonicalAfter.branch
        CanonicalHead = $canonicalAfter.head
        CanonicalWorkingTreeClean = $canonicalAfter.fullyClean
        BackupHash = $actualBackupHash
        EvidencePath = $evidence
        RollbackRequired = $false
    }
}
catch {
    $originalError = $_

    if ($moved -and (Test-Path -LiteralPath $archive) -and -not (Test-Path -LiteralPath $source)) {
        $rollbackAttempted = $true
        try {
            Move-Item -LiteralPath $archive -Destination $source
            $rollbackSucceeded = (Test-Path -LiteralPath $source) -and -not (Test-Path -LiteralPath $archive)
        }
        catch {
            $rollbackSucceeded = $false
        }
    }

    $rollbackMessage = if ($rollbackAttempted) {
        " Rollback attempted: $rollbackAttempted. Rollback succeeded: $rollbackSucceeded."
    }
    else {
        " No move rollback was required."
    }

    throw "Gate G7 archive operation failed: $($originalError.Exception.Message)$rollbackMessage"
}
