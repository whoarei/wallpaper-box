param([Parameter(Mandatory)][string]$Tag,[Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
if ($Tag -notmatch '^v\d+\.\d+\.\d+$') { throw 'Expected a vX.Y.Z release tag' }
if (-not $env:GH_REPO) { throw 'GH_REPO is required' }
$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$verify = Join-Path $repoRoot 'wallpaper-host\scripts\verify-release.ps1'
$releaseRoot = (Resolve-Path -LiteralPath $Directory).Path
& $verify -Directory $releaseRoot
$manifest = Get-Content (Join-Path $releaseRoot 'release-manifest.json') -Raw | ConvertFrom-Json
if ($Tag -ne "v$($manifest.version)") { throw 'Tag and artifact version differ' }
$notes = Join-Path $repoRoot ".github\release-notes\$Tag.md"
if (-not (Test-Path -LiteralPath $notes)) { throw "Missing release notes for $Tag" }
$existingText = & gh release view $Tag --json isDraft,url 2>$null
$exists = $LASTEXITCODE -eq 0
if ($exists -and -not ($existingText | ConvertFrom-Json).isDraft) {
    Write-Output "Release $Tag is already published; leaving its assets unchanged."
    exit 0
}
if (-not $exists) {
    & gh release create $Tag --verify-tag --draft --title "壁纸盒子 $Tag" --notes-file $notes
    if ($LASTEXITCODE -ne 0) { throw 'Could not create GitHub draft release' }
}
$assets = @(Get-ChildItem -LiteralPath $releaseRoot -File | Where-Object { $_.Name -match '(^wallpaper-box_.*\.(exe|zip)$|^SHA256SUMS\.txt$|^release-manifest\.json$)' } | Select-Object -ExpandProperty FullName)
if ($assets.Count -ne 4) { throw 'Expected exactly four release assets' }
& gh release upload $Tag @assets --clobber
if ($LASTEXITCODE -ne 0) { throw 'Release asset upload failed; draft retained' }
$download = Join-Path ([IO.Path]::GetTempPath()) ('wallpaper-box-release-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $download | Out-Null
try {
    & gh release download $Tag --dir $download
    if ($LASTEXITCODE -ne 0) { throw 'Release download verification failed; draft retained' }
    & $verify -Directory $download
    foreach ($asset in $assets) {
        $downloaded = Join-Path $download (Split-Path -Leaf $asset)
        if ((Get-FileHash -LiteralPath $asset).Hash -ne (Get-FileHash -LiteralPath $downloaded).Hash) { throw "Uploaded bytes differ: $asset" }
    }
} finally {
    $resolvedDownload = [IO.Path]::GetFullPath($download)
    $expectedParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\','/')
    if ((Split-Path -Parent $resolvedDownload) -ne $expectedParent -or (Split-Path -Leaf $resolvedDownload) -notlike 'wallpaper-box-release-*') { throw 'Unexpected verification directory' }
    Remove-Item -LiteralPath $resolvedDownload -Recurse -Force
}
& gh release edit $Tag --draft=false --latest
if ($LASTEXITCODE -ne 0) { throw 'Publishing failed; verified draft retained' }
& gh release view $Tag --json url --jq '.url'
