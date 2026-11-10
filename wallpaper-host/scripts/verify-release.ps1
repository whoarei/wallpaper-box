param([Parameter(Mandatory)][string]$Directory,[switch]$RequireSigned)
$ErrorActionPreference = 'Stop'
$releaseRoot = (Resolve-Path -LiteralPath $Directory).Path
$manifest = Get-Content (Join-Path $releaseRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 3 -or $manifest.version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$' -or $manifest.platform -ne 'windows-x64') { throw 'Invalid installer release manifest' }
if ($manifest.updater.signed -isnot [bool]) { throw 'Missing signed updater state' }
$signed = $manifest.updater.signed
if ($RequireSigned -and -not $signed) { throw 'Release publication requires signed updater artifacts' }
$installerName = "wallpaper-box_$($manifest.version)_x64-setup.exe"
$expectedNames = @($installerName,'release-manifest.json')
if ($signed) { $expectedNames += @("$installerName.sig",'latest.json') }
$seenNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($line in Get-Content (Join-Path $releaseRoot 'SHA256SUMS.txt')) {
    if ($line -notmatch '^([a-f0-9]{64})  ([^/\\]+)$') { throw "Invalid checksum line: $line" }
    $expectedHash,$assetName = $Matches[1],$Matches[2]
    if ($assetName -notin $expectedNames -or -not $seenNames.Add($assetName)) { throw "Unexpected or duplicate asset: $assetName" }
    $actualHash = (Get-FileHash -LiteralPath (Join-Path $releaseRoot $assetName) -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) { throw "Checksum mismatch: $assetName" }
}
if ($seenNames.Count -ne $expectedNames.Count) { throw 'Missing release checksums' }
foreach ($file in Get-ChildItem -LiteralPath $releaseRoot -Force) {
    if ($file.PSIsContainer -or ($file.Name -ne 'SHA256SUMS.txt' -and $file.Name -notin $expectedNames)) { throw "Unexpected release path: $($file.Name)" }
}
$installer = [IO.File]::OpenRead((Join-Path $releaseRoot $installerName))
try { if ($installer.ReadByte() -ne 0x4d -or $installer.ReadByte() -ne 0x5a) { throw 'Installer is not a Windows executable' } } finally { $installer.Dispose() }
$required = @('wallpaper-box.exe','README.txt','docs/architecture.html','wallpapers/aquarium/index.html','wallpapers/aquarium/module.json','wallpapers/aquarium/aquarium.js','wallpapers/pinewind-town/index.html','wallpapers/pinewind-town/module.json')
$forbiddenPath = '(^/|\\|:|%|(^|/)\.\.?(/|$)|//)|(^|/)(UserData|portable\.flag|\.downloads|\.imports|\.git|settings\.json|diagnostics\.json|host\.log|node_modules|target|artifacts|display-service)(/|$)|(^|/)\.env($|\.)|\.(pfx|p12|pem|key)$'
$paths = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
if (-not $manifest.installerFiles -or $manifest.installerFiles.Count -gt 4096) { throw 'Invalid installer payload list' }
foreach ($file in $manifest.installerFiles) {
    if ($file.path -isnot [string] -or [string]::IsNullOrWhiteSpace($file.path) -or $file.path -match $forbiddenPath -or -not $paths.Add($file.path)) { throw "Unexpected installer path: $($file.path)" }
    if ($file.path -ne 'wallpaper-box.exe' -and $file.path -match '\.(exe|dll|bat|cmd|ps1)$') { throw "Unexpected executable resource: $($file.path)" }
    if ($file.bytes -lt 0 -or $file.sha256 -notmatch '^[a-f0-9]{64}$') { throw "Invalid installer payload hash: $($file.path)" }
    if (($file.path -eq 'wallpaper-box.exe' -and $file.normalization -ne 'tauri-bundle-type') -or ($file.path -ne 'wallpaper-box.exe' -and $file.normalization)) { throw "Invalid payload normalization: $($file.path)" }
}
foreach ($requiredFile in $required) { if (-not $paths.Contains($requiredFile)) { throw "Installer payload missing: $requiredFile" } }
if ($signed) {
    & node (Join-Path $PSScriptRoot 'verify-update-signatures.mjs') $releaseRoot
    if ($LASTEXITCODE -ne 0) { throw 'Updater signature verification failed' }
}
Write-Output "Verified v$($manifest.version): installer hashes, $($paths.Count) expected payload files; signed updater=$signed."
