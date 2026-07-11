[CmdletBinding()]
param(
    [string]$OutputPath = "C:\Users\nolan\Documents\Constellation-PreRetirement-Backup-2026-07-11.json",
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExpectedSourceExtensionId = "hkakifedpohjilmjiiobcmmgemgighli",
    [int]$ExpectedWorkspaceCount = 10,
    [int]$ExpectedJournalCount = 6,
    [int]$ExpectedTimelineCount = 239
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Normalize-Path {
    param([Parameter(Mandatory = $true)][string]$Path)
    return [System.IO.Path]::GetFullPath($Path)
}

function Get-OptionalPropertyValue {
    param(
        [Parameter(Mandatory = $true)][object]$InputObject,
        [Parameter(Mandatory = $true)][string]$PropertyName
    )

    $property = $InputObject.PSObject.Properties[$PropertyName]
    if ($null -eq $property) {
        return $null
    }

    return $property.Value
}

$output = Normalize-Path $OutputPath
$sidecar = "$output.sha256"
$outputParent = Split-Path -Parent $output

if (-not (Test-Path -LiteralPath $outputParent -PathType Container)) {
    New-Item -ItemType Directory -Path $outputParent -Force | Out-Null
}

if (Test-Path -LiteralPath $output) {
    throw "Refusing to overwrite an existing backup: $output"
}

if (Test-Path -LiteralPath $sidecar) {
    throw "Refusing to overwrite an existing SHA-256 sidecar: $sidecar"
}

$raw = Get-Clipboard -Raw
if ([string]::IsNullOrWhiteSpace($raw)) {
    throw "Clipboard is empty. Copy the migration package from the Constellation side panel first."
}

$trimmed = $raw.TrimStart()
if (-not $trimmed.StartsWith("{")) {
    $previewLength = [Math]::Min(120, $trimmed.Length)
    $preview = $trimmed.Substring(0, $previewLength)
    throw "Clipboard does not begin with a JSON object. Clipboard preview: $preview"
}

try {
    $package = $raw | ConvertFrom-Json -ErrorAction Stop
}
catch {
    throw "Clipboard JSON could not be parsed: $($_.Exception.Message)"
}

if ($package.schema -ne "constellation-data-migration-package-v0.1") {
    throw "Unexpected package schema: $($package.schema)"
}

if ($package.sourceExtensionId -ne $ExpectedSourceExtensionId) {
    throw "Wrong source extension identity. Expected '$ExpectedSourceExtensionId' but found '$($package.sourceExtensionId)'."
}

if ($package.validation.valid -ne $true) {
    throw "The migration package reports validation.valid != true."
}

$payloadDigest = [string]$package.integrity.payloadDigest
if ([string]::IsNullOrWhiteSpace($payloadDigest)) {
    throw "The migration package payload digest is missing."
}

$expectedDigestValue = Get-OptionalPropertyValue -InputObject $package.validation -PropertyName "expectedDigest"
$actualDigestValue = Get-OptionalPropertyValue -InputObject $package.validation -PropertyName "actualDigest"
$hasExpectedDigest = $null -ne $expectedDigestValue
$hasActualDigest = $null -ne $actualDigestValue
$digestEvidenceMode = "validated_package_payload_digest"

if ($hasExpectedDigest -xor $hasActualDigest) {
    throw "The package exposes only one of validation.expectedDigest or validation.actualDigest."
}

if ($hasExpectedDigest -and $hasActualDigest) {
    $expectedDigest = [string]$expectedDigestValue
    $actualDigest = [string]$actualDigestValue

    if ([string]::IsNullOrWhiteSpace($expectedDigest) -or [string]::IsNullOrWhiteSpace($actualDigest)) {
        throw "The package exposes empty validation digest fields."
    }

    if ($payloadDigest -ne $expectedDigest -or $payloadDigest -ne $actualDigest) {
        throw "The package digest fields are not equivalent."
    }

    $digestEvidenceMode = "explicit_expected_actual_match"
}

$workspaceCount = [int]$package.inventory.indexedDb.workspaceRecordCount
$journalCount = [int]$package.inventory.indexedDb.journalEntryCount
$timelineCount = [int]$package.inventory.indexedDb.timelineEventCount

if ($workspaceCount -ne $ExpectedWorkspaceCount) {
    throw "Unexpected workspace count. Expected $ExpectedWorkspaceCount but found $workspaceCount."
}

if ($journalCount -ne $ExpectedJournalCount) {
    throw "Unexpected journal-entry count. Expected $ExpectedJournalCount but found $journalCount."
}

if ($timelineCount -ne $ExpectedTimelineCount) {
    throw "Unexpected timeline-event count. Expected $ExpectedTimelineCount but found $timelineCount."
}

$tempSuffix = [Guid]::NewGuid().ToString("N")
$tempOutput = "$output.tmp-$tempSuffix"
$tempSidecar = "$sidecar.tmp-$tempSuffix"
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)

try {
    [System.IO.File]::WriteAllText($tempOutput, $raw, $utf8NoBom)

    $savedRaw = [System.IO.File]::ReadAllText($tempOutput)
    $savedPackage = $savedRaw | ConvertFrom-Json -ErrorAction Stop

    if ($savedPackage.schema -ne "constellation-data-migration-package-v0.1") {
        throw "Saved-file readback schema does not match."
    }

    if ($savedPackage.sourceExtensionId -ne $ExpectedSourceExtensionId) {
        throw "Saved-file readback source extension identity does not match."
    }

    if ($savedPackage.validation.valid -ne $true) {
        throw "Saved-file readback package is not valid."
    }

    if ([string]$savedPackage.integrity.payloadDigest -ne $payloadDigest) {
        throw "Saved-file readback payload digest does not match."
    }

    if ([int]$savedPackage.inventory.indexedDb.workspaceRecordCount -ne $ExpectedWorkspaceCount) {
        throw "Saved-file readback workspace count does not match."
    }

    if ([int]$savedPackage.inventory.indexedDb.journalEntryCount -ne $ExpectedJournalCount) {
        throw "Saved-file readback journal-entry count does not match."
    }

    if ([int]$savedPackage.inventory.indexedDb.timelineEventCount -ne $ExpectedTimelineCount) {
        throw "Saved-file readback timeline-event count does not match."
    }

    $fileHash = (Get-FileHash -LiteralPath $tempOutput -Algorithm SHA256).Hash.ToUpperInvariant()
    $sidecarLine = "$fileHash  $([System.IO.Path]::GetFileName($output))"
    [System.IO.File]::WriteAllText($tempSidecar, $sidecarLine + [Environment]::NewLine, [System.Text.Encoding]::ASCII)

    Move-Item -LiteralPath $tempOutput -Destination $output
    Move-Item -LiteralPath $tempSidecar -Destination $sidecar

    $expectedFileHash = ((Get-Content -Raw -LiteralPath $sidecar).Trim() -split '\s+')[0].ToUpperInvariant()
    $actualFileHash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToUpperInvariant()

    if ($actualFileHash -ne $expectedFileHash) {
        throw "Final whole-file SHA-256 does not match the sidecar."
    }

    [PSCustomObject]@{
        Status = "saved_and_verified"
        BackupPath = $output
        SidecarPath = $sidecar
        FileHash = $actualFileHash
        HashMatches = $true
        Schema = $savedPackage.schema
        SourceExtension = $savedPackage.sourceExtensionId
        PayloadDigest = $savedPackage.integrity.payloadDigest
        DigestEvidenceMode = $digestEvidenceMode
        Valid = $savedPackage.validation.valid
        WorkspaceCount = $savedPackage.inventory.indexedDb.workspaceRecordCount
        JournalCount = $savedPackage.inventory.indexedDb.journalEntryCount
        TimelineCount = $savedPackage.inventory.indexedDb.timelineEventCount
        PhysicalDatabase = $savedPackage.sourcePhysicalDatabaseName
        LogicalDatabase = $savedPackage.sourceLogicalDatabaseName
    }
}
finally {
    if (Test-Path -LiteralPath $tempOutput) {
        Remove-Item -LiteralPath $tempOutput -Force
    }
    if (Test-Path -LiteralPath $tempSidecar) {
        Remove-Item -LiteralPath $tempSidecar -Force
    }
}
