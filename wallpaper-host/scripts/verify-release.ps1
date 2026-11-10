param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath $Directory).Path
$manifest = Get-Content (Join-Path $releaseRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.platform -ne 'windows-x64') { throw 'Invalid release manifest' }
$expectedNames = @("wallpaper-box_$($manifest.version)_x64-setup.exe", "wallpaper-box_$($manifest.version)_windows-x64-portable.zip", 'release-manifest.json')
$seenNames = @()
foreach ($line in Get-Content (Join-Path $releaseRoot 'SHA256SUMS.txt')) {
    if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') { throw "Invalid checksum line: $line" }
    $expectedHash,$assetName = $Matches[1],$Matches[2]
    if ($assetName -notin $expectedNames -or $assetName -in $seenNames) { throw "Unexpected or duplicate asset: $assetName" }
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $releaseRoot $assetName) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) { throw "Checksum mismatch: $assetName" }
    $seenNames += $assetName
}
if ($seenNames.Count -ne $expectedNames.Count) { throw 'Missing release checksums' }
$installer = [IO.File]::OpenRead((Join-Path $releaseRoot $expectedNames[0]))
try { if ($installer.ReadByte() -ne 0x4d -or $installer.ReadByte() -ne 0x5a) { throw 'Installer is not a Windows executable' } } finally { $installer.Dispose() }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead((Join-Path $releaseRoot $expectedNames[1]))
try {
    $required = @('wallpaper-box.exe','README.txt','portable.flag','docs/architecture.html','wallpapers/aquarium/index.html','wallpapers/aquarium/module.json','wallpapers/aquarium/aquarium.js','wallpapers/pinewind-town/index.html','wallpapers/pinewind-town/module.json')
    foreach ($requiredFile in $required) { if (-not $archive.GetEntry($requiredFile)) { throw "Portable file missing: $requiredFile" } }
    $forbiddenPath = '(^/|\\|(^|/)\.\.(/|$))|(^|/)(UserData|\.downloads|\.imports|\.git|settings\.json|diagnostics\.json|host\.log|node_modules|target|artifacts|display-service)(/|$)|(^|/)\.env($|\.)|\.(pfx|p12|pem|key)$'
    $archivePaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($archiveEntry in $archive.Entries) {
        if ($archiveEntry.FullName -match $forbiddenPath -or -not $archivePaths.Add($archiveEntry.FullName)) { throw "Unexpected or duplicate archive path: $($archiveEntry.FullName)" }
    }
    $entries = @($archive.Entries | Where-Object { -not $_.FullName.EndsWith('/') })
    if ($entries.Count -ne $manifest.portableFiles.Count) { throw 'Portable file count differs from manifest' }
    $manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($file in $manifest.portableFiles) {
        if ($file.path -match $forbiddenPath -or -not $manifestPaths.Add($file.path)) { throw "Unexpected portable path: $($file.path)" }
        if ($file.path -ne 'wallpaper-box.exe' -and $file.path -match '\.(exe|dll|bat|cmd|ps1)$') { throw "Unexpected executable resource: $($file.path)" }
        $entry = $archive.GetEntry($file.path)
        if (-not $entry -or $entry.Length -ne $file.bytes) { throw "Portable entry differs: $($file.path)" }
        $stream = $entry.Open()
        $sha = [Security.Cryptography.SHA256]::Create()
        try { $hash = [Convert]::ToHexString($sha.ComputeHash($stream)).ToLowerInvariant() } finally { $stream.Dispose(); $sha.Dispose() }
        if ($hash -ne $file.sha256) { throw "Portable checksum mismatch: $($file.path)" }
    }
    $markerStream = $archive.GetEntry('portable.flag').Open()
    $markerReader = [IO.StreamReader]::new($markerStream,[Text.Encoding]::UTF8)
    try { if ($markerReader.ReadToEnd() -ne "wallpaper-box-portable-v1`n") { throw 'Invalid portable mode marker' } } finally { $markerReader.Dispose() }
} finally { $archive.Dispose() }
Write-Output "Verified v$($manifest.version): installer, portable archive, and $($manifest.portableFiles.Count) payload files."
