param([string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$hostRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $hostRoot
$tauriRoot = Join-Path $hostRoot 'src-tauri'
$config = Get-Content (Join-Path $tauriRoot 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release version' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "release\v$version" }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$binary = Join-Path $tauriRoot 'target\release\wallpaper-box.exe'
$installers = @(Get-ChildItem (Join-Path $tauriRoot 'target\release\bundle\nsis') -Filter "*_${version}_x64-setup.exe")
if ($installers.Count -ne 1) { throw "Expected one NSIS x64 installer for $version" }
$binaryInfo = (Get-Item -LiteralPath $binary).VersionInfo
if ($binaryInfo.ProductName -ne '壁纸盒子' -or $binaryInfo.ProductVersion -notlike "$version*") { throw 'Binary metadata does not match release' }
$installerName = "wallpaper-box_${version}_x64-setup.exe"
$portableName = "wallpaper-box_${version}_windows-x64-portable.zip"
Copy-Item -LiteralPath $installers[0].FullName -Destination (Join-Path $outputRoot $installerName) -Force
$stage = Join-Path $outputRoot ('.stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    Copy-Item -LiteralPath $binary -Destination (Join-Path $stage 'wallpaper-box.exe')
    # Only the portable distribution carries this marker. The installer keeps
    # downloaded/custom wallpapers in LocalAppData instead of its program folder.
    [IO.File]::WriteAllText((Join-Path $stage 'portable.flag'),"wallpaper-box-portable-v1`n",[Text.UTF8Encoding]::new($false))
    foreach ($resource in $config.bundle.resources.psobject.Properties) {
        $source = [IO.Path]::GetFullPath((Join-Path $tauriRoot $resource.Name))
        $destination = Join-Path $stage $resource.Value
        if ((Get-Item -LiteralPath $source).PSIsContainer) {
            New-Item -ItemType Directory -Path $destination -Force | Out-Null
            Get-ChildItem -LiteralPath $source -Force | Copy-Item -Destination $destination -Recurse -Force
        } else {
            New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $destination -Force
        }
    }
    $files = @(Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path=[IO.Path]::GetRelativePath($stage,$_.FullName).Replace('\','/'); bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    # ZipFile preserves dotfiles and UTF-8 paths; avoid Compress-Archive's hidden-file filtering.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zipPath = Join-Path $outputRoot $portableName
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage,$zipPath,[IO.Compression.CompressionLevel]::Optimal,$false)
    $manifest = [ordered]@{ schemaVersion=2; product='壁纸盒子'; version=$version; platform='windows-x64'; commit=$env:GITHUB_SHA; portableOnlyFiles=@('portable.flag'); portableFiles=$files }
    [IO.File]::WriteAllText((Join-Path $outputRoot 'release-manifest.json'),($manifest | ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
    $hashLines = @($installerName,$portableName,'release-manifest.json') | ForEach-Object {
        (Get-FileHash -LiteralPath (Join-Path $outputRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_
    }
    [IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256SUMS.txt'),($hashLines -join "`n")+"`n",[Text.UTF8Encoding]::new($false))
} finally {
    $resolvedStage = [IO.Path]::GetFullPath($stage)
    if (-not $resolvedStage.StartsWith($outputRoot.TrimEnd('\','/')+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedStage) -notlike '.stage-*') { throw 'Refusing to remove an unexpected staging directory' }
    Remove-Item -LiteralPath $resolvedStage -Recurse -Force
}
& (Join-Path $PSScriptRoot 'verify-release.ps1') -Directory $outputRoot
Write-Output "Release files: $outputRoot"
