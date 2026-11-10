param([string]$OutputDirectory,[switch]$RequireSigned)
$ErrorActionPreference = 'Stop'
$hostRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $hostRoot
$tauriRoot = Join-Path $hostRoot 'src-tauri'
$config = Get-Content (Join-Path $tauriRoot 'tauri.conf.json') -Raw | ConvertFrom-Json
$version = $config.version
if ($version -notmatch '^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$') { throw 'Invalid release version' }
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $repoRoot "release\v$version" }
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$binary = Join-Path $tauriRoot 'target\release\wallpaper-box.exe'
$installers = @(Get-ChildItem (Join-Path $tauriRoot 'target\release\bundle\nsis') -Filter "*_${version}_x64-setup.exe")
if ($installers.Count -ne 1) { throw "Expected one NSIS x64 installer for $version" }
$binaryInfo = (Get-Item -LiteralPath $binary).VersionInfo
if ($binaryInfo.ProductName -ne '壁纸盒子' -or $binaryInfo.ProductVersion -notlike "$version*") { throw 'Binary metadata does not match release' }
$hasSigningKey = -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -or -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH)
if ($RequireSigned -and -not $hasSigningKey) { throw 'A release tag requires TAURI_SIGNING_PRIVATE_KEY; refusing unsigned publication' }
$installerName = "wallpaper-box_${version}_x64-setup.exe"
$expectedNames = @($installerName,'release-manifest.json','SHA256SUMS.txt')
if ($hasSigningKey) { $expectedNames += @("$installerName.sig",'latest.json') }
foreach ($existing in Get-ChildItem -LiteralPath $outputRoot -Force) {
    if ($existing.PSIsContainer -or $existing.Name -notin $expectedNames) { throw "Use a clean installer release directory; unexpected path: $($existing.Name)" }
}
Copy-Item -LiteralPath $installers[0].FullName -Destination (Join-Path $outputRoot $installerName) -Force

# Describe exactly the configured resources and the base EXE. No portable archive
# or portable.flag is produced. The installer verifier normalizes only Tauri's
# UNK/NSS three-byte bundle marker before comparing the EXE hash.
$files = [Collections.Generic.List[object]]::new()
function Add-PayloadFile([string]$Source,[string]$Destination) {
    $hash = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash.ToLowerInvariant()
    $file = [ordered]@{ path=$Destination.Replace('\','/'); bytes=(Get-Item -LiteralPath $Source).Length; sha256=$hash }
    if ($Destination -eq 'wallpaper-box.exe') {
        $file.sha256 = & node (Join-Path $PSScriptRoot 'installer-payload.mjs') $Source
        if ($LASTEXITCODE -ne 0) { throw 'Could not normalize the Tauri executable hash' }
        $file.normalization = 'tauri-bundle-type'
    }
    $files.Add($file)
}
Add-PayloadFile $binary 'wallpaper-box.exe'
foreach ($resource in $config.bundle.resources.psobject.Properties) {
    $source = [IO.Path]::GetFullPath((Join-Path $tauriRoot $resource.Name))
    if ((Get-Item -LiteralPath $source).PSIsContainer) {
        foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse -Force) {
            Add-PayloadFile $file.FullName ($resource.Value.TrimEnd('/','\') + '/' + [IO.Path]::GetRelativePath($source,$file.FullName))
        }
    } else {
        Add-PayloadFile $source $resource.Value
    }
}
$manifest = [ordered]@{ schemaVersion=3; product='壁纸盒子'; version=$version; platform='windows-x64'; commit=$env:GITHUB_SHA; updater=@{signed=[bool]$hasSigningKey}; installerFiles=@($files | Sort-Object { $_.path }) }
[IO.File]::WriteAllText((Join-Path $outputRoot 'release-manifest.json'),($manifest | ConvertTo-Json -Depth 6)+"`n",[Text.UTF8Encoding]::new($false))
if ($hasSigningKey) {
    & node (Join-Path $PSScriptRoot 'sign-update.mjs') $outputRoot
    if ($LASTEXITCODE -ne 0) { throw 'Updater signing failed' }
    & node (Join-Path $PSScriptRoot 'create-update-manifest.mjs') $outputRoot
    if ($LASTEXITCODE -ne 0) { throw 'Updater manifest generation failed' }
} else {
    Write-Output 'No signing key: generating a build-only installer; it cannot be published as an updater release.'
}
$hashNames = @($installerName,'release-manifest.json')
if ($hasSigningKey) { $hashNames += @("$installerName.sig",'latest.json') }
$hashLines = $hashNames | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $outputRoot $_) -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_ }
[IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256SUMS.txt'),($hashLines -join "`n")+"`n",[Text.UTF8Encoding]::new($false))
& (Join-Path $PSScriptRoot 'verify-release.ps1') -Directory $outputRoot -RequireSigned:$RequireSigned
Write-Output "Installer release files: $outputRoot"
