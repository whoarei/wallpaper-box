# 壁纸盒子 · Wallpaper Box

Windows 动态壁纸程序，支持显示器选择、壁纸切换、系统托盘和暂停恢复。0.2.0 内置水族箱与松风镇，直接从本地播放，无需 Docker。可从独立的 [whoarei/wallpapers](https://github.com/whoarei/wallpapers) 壁纸库逐项下载、更新和回退，也可导入自己的网页壁纸。

## 使用

从 [GitHub Releases](https://github.com/whoarei/wallpaper-box/releases) 下载 Windows x64 安装程序或便携 ZIP。

1. 安装或完整解压 ZIP，运行 `wallpaper-box.exe`。运行依赖 WebView2；安装版在缺少运行时时下载 Microsoft 运行时。
2. 首次启动在主显示器播放水族箱。选择显示器，再从“我的壁纸”切换场景。
3. 左键托盘图标打开管理窗口，右键快速切换、暂停或退出。关闭管理窗口会收起到托盘。
4. 在“在线壁纸”点击“检查更新”，再选择某张壁纸的“下载 / 更新”。检查只获取清单和封面，ZIP 按选择逐项下载，不会自动下载全库。

内置和已下载壁纸均可离线播放，无需 GitHub 登录。壁纸更新验证大小和 SHA-256，保留上一活动版本供回退；更新壁纸不需要重编译主程序。

## 添加自己的壁纸

点击“导入文件夹”或“导入 ZIP”，也可点击“打开壁纸目录”，在 `local/` 中放入完整模块，再点击“刷新”。最小结构：

```text
local/
  my-scene/
    index.html
    module.json     可选
    cover.jpg       可选
    assets/         可选
```

HTML、脚本、样式与图片使用相对路径。文件夹名使用小写字母、数字和连字符；可选 `module.json` 定义名称、说明、版本、入口、封面和排序，完整规范见 [HTML 技术方案](display-service/public/docs/architecture.html#module-contract)。自定义模块运行 ID 为 `local:<文件夹名>`，不会覆盖内置或官方内容。

| 数据 | 位置 |
| --- | --- |
| 安装版用户壁纸根 | `%LOCALAPPDATA%/WallpaperBox/wallpapers` |
| 便携版用户壁纸根 | EXE 同目录的 `UserData/wallpapers`，由 `portable.flag` 启用 |
| 自定义壁纸 | 用户根下 `local/` |
| 官方内容、活动版本与回退 | 用户根下 `online/<id>/` |
| 下载与导入暂存 | 用户根下 `.downloads/`、`.imports/` |
| 设置、日志与 WebView 数据 | `%APPDATA%/local.screen-garden.wallpaper/` |

安装版和便携版都保留原应用标识与设置目录，沿用原显示器、壁纸和暂停选择。旧 Docker 网页与新本地协议来源不同，页面内 localStorage（如种花记录）需要针对壁纸独立迁移，不能保证自动沿用。

## 项目目录

- `wallpaper-host/`：Tauri 2 宿主、嵌入式管理界面、原生目录发现、本地协议、在线更新与打包校验。
- `wallpapers/{aquarium,pinewind-town}/`：0.2.0 随包的两张壁纸快照。
- `display-service/`：保留的 Legacy Docker 浏览器开发示例，0.2.0 运行和安装包不依赖它。
- `.github/workflows/windows.yml`：主程序 CI 与标签发布。
- [HTML 技术方案](display-service/public/docs/architecture.html)：单文件离线文档，含架构、模块规范、权限、迁移及发布流程，支持 10 套配色和保存 PDF。

安装包资源仅为 `wallpapers/`、`docs/architecture.html` 和 `README.txt` 等必要内容；`portable.flag` 只进入便携 ZIP。用户壁纸、下载缓存、设置和密钥不打包。

## 本地构建与核对

需要 Windows x64、PowerShell 7、Rust 1.95.0、Visual Studio C++ Build Tools、Windows SDK 和 Node.js 24。Tauri CLI 固定为 2.12.4；核对安装包载荷需要 7-Zip。

```powershell
Set-Location wallpaper-host
npm ci --ignore-scripts
npm run check:version
npm run bundle
./scripts/package-release.ps1
./scripts/verify-release.ps1 -Directory ../release/v0.2.0
node scripts/verify-installer.mjs ../release/v0.2.0
```

产物位于 `release/v0.2.0/`：NSIS 安装程序、便携 ZIP、逐文件 `release-manifest.json` 与 `SHA256SUMS.txt`。打包脚本核对必需资源、文件大小和 SHA-256；安装包校验脚本通过 7-Zip 读取载荷并与便携清单逐项对照，同时确认安装包没有 `portable.flag`。7-Zip 默认路径为 `C:\Program Files\7-Zip\7z.exe`，可作为 Node 校验脚本的第二个参数指定。

Rust 行为检查：

```powershell
cargo fmt --check --manifest-path wallpaper-host/src-tauri/Cargo.toml
cargo test --locked --release --features custom-protocol --manifest-path wallpaper-host/src-tauri/Cargo.toml
```

管理界面的按需下载、更新/回退和网络失败流程可运行 `npm --prefix wallpaper-host run test:ui`。该测试使用锁定版本的 Playwright Core 和本机 Edge，以模拟 IPC 验证真实界面，不访问在线仓库；可用 `EDGE_PATH` 指定浏览器路径。CI 同样执行此检查。

只构建开发用 EXE 可运行 `wallpaper-host/build.ps1`。文档可编辑源为 `display-service/docs/architecture-source.cjs`，生成 spec 后使用 `rtd-html-docs` 的 `render.mjs` 更新 HTML。真实设备验收和云端发布结果应以对应版本的发版记录为准。

## 主程序发布

CI 固定工具链、依赖锁文件和 Action 提交，检查版本、JavaScript、Rust 格式与测试，再生成安装包和便携包。main、PR 与手动运行只上传 Actions Artifact；推送 `vX.Y.Z` 标签触发 Release。

版本与验收完成后：

```powershell
git tag v0.2.0
git push origin v0.2.0
gh run list --repo whoarei/wallpaper-box --workflow windows.yml
```

发布任务先创建草稿，上传四个产物，回下载校验 SHA-256 后公开；失败保留草稿，已发布版本不直接覆盖。发版同步 `Cargo.toml`、`tauri.conf.json`、`package.json`、`package-lock.json` 与随包 `README.txt`，并准备 `.github/release-notes/vX.Y.Z.md`。

当前仅支持 Windows x64，未配置 Authenticode 签名、程序自动升级或开机启动。壁纸在线更新只更新内容。

## 官方壁纸库发布

[whoarei/wallpapers README](https://github.com/whoarei/wallpapers#readme) 维护内容规范与独立发布流程。稳定清单入口为 [catalog.json](https://github.com/whoarei/wallpapers/releases/latest/download/catalog.json)。

新增 `wallpapers/<id>/` 及元数据，修改内容时提升该壁纸版本，独立提升 `library.json` 的版本，运行 `python scripts/build.py`，检查后提交并推送 `library-vX.Y.Z` 标签。内容 CI 生成单项 ZIP、封面、清单和校验文件；用户检查后按需下载，不需要重发主程序。

主程序内置仍为原来的两张。新增的“通往别处的窗户”在内容仓库独立发布后，用于验证无需重编译即可发现、下载和应用新壁纸。
