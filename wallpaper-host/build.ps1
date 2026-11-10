param([int]$Jobs = 8)
$ErrorActionPreference = 'Stop'
Push-Location -LiteralPath $PSScriptRoot
try {
    $env:CARGO_BUILD_JOBS = [string]$Jobs
    cargo build --locked --release --manifest-path src-tauri/Cargo.toml
    if ($LASTEXITCODE -ne 0) { throw 'Rust build failed.' }
    $artifact = Join-Path $PSScriptRoot 'artifacts\wallpaper-box.exe'
    $compatArtifact = Join-Path $PSScriptRoot 'artifacts\screen-garden.exe'
    $running = Get-Process wallpaper-box,screen-garden -ErrorAction SilentlyContinue |
        Where-Object { $_.Path -eq $artifact -or $_.Path -eq $compatArtifact }
    if ($running) { throw '请先从壁纸盒子托盘菜单退出程序，再重新执行构建。' }
    New-Item -ItemType Directory -Path artifacts -Force | Out-Null
    Copy-Item -LiteralPath 'src-tauri\target\release\wallpaper-box.exe' -Destination $artifact -Force
    Copy-Item -LiteralPath $artifact -Destination $compatArtifact -Force
    Write-Output "Built: $artifact"
} finally { Pop-Location }
