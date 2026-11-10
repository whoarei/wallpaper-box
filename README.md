# 壁纸盒子 · Wallpaper Box

Windows 动态壁纸程序：支持显示器选择、模块切换、系统托盘和暂停恢复。内置松风镇与静水之间水族箱。

## 使用

安装包发布后在 [GitHub Releases](https://github.com/whoarei/wallpaper-box/releases) 下载 Windows x64 安装版或便携 ZIP。

1. 安装并启动 Docker Desktop，使用 Linux 容器。
2. 安装程序或完整解压便携 ZIP，运行 `wallpaper-box.exe`。
3. 内容服务未连接时，点击“启动内容服务”；首次启动需要下载镜像。
4. 选择显示器和壁纸。左键托盘打开管理界面，右键快速切换或退出。

新增模块放到正在运行的展示服务对应的 `display-service/modules/<模块名>/index.html`，可选 `module.json`。首次使用随包服务时即为安装或解压目录；已运行的 8088 服务会被复用，其原模块目录继续生效。首页和壁纸程序自动发现。退出壁纸程序不会停止 Docker 内容服务。

## 目录

- `wallpaper-host/`：Tauri 2 程序、管理界面与打包脚本。
- `display-service/`：Docker Compose、模块目录、网页首页与目录接口。
- `.github/workflows/windows.yml`：主分支和 PR 构建；版本标签构建后发布 GitHub Release。
- [HTML 技术方案](display-service/public/docs/architecture.html)：离线可读，包含模块规范、桌面层、部署和发布说明。

## 本地构建安装包

需要 Windows x64、PowerShell 7、Rust 1.95.0、Visual Studio C++ Build Tools、Windows SDK 和 Node.js 24。

```powershell
Set-Location wallpaper-host
npm ci --ignore-scripts
npm run check:version
npm run bundle
./scripts/package-release.ps1
```

产物位于 `release/v0.1.0/`：安装程序、便携 ZIP、逐文件清单和 SHA-256 校验文件。只构建开发用 EXE 可执行 `wallpaper-host/build.ps1`。

## GitHub CI 与发布

CI 固定 Tauri CLI 版本、npm/Cargo 锁文件和 GitHub Action 提交。执行模块发现测试、JavaScript 语法检查、Rust 格式检查和测试，再生成 NSIS 安装包与完整便携包，核对每个资源文件。

首次创建公开仓库（本地 Git 提交准备好后）：

```powershell
gh auth login -h github.com
gh repo create whoarei/wallpaper-box --public --source . --remote origin --push
git tag v0.1.0
git push origin v0.1.0
gh run list --repo whoarei/wallpaper-box --workflow windows.yml
```

推送 `vX.Y.Z` 标签会发布；主分支、PR 和手动运行只构建并上传 Actions Artifact。发布阶段创建草稿、上传四个产物、回下载验证 SHA-256，再公开 Release。失败时保留草稿；重跑不会覆盖已发布版本。

后续版本同步修改 `Cargo.toml`、`tauri.conf.json`、`package.json`、`package-lock.json` 与随包 `README.txt`，添加 `.github/release-notes/vX.Y.Z.md`。CI 校验标签与版本一致。

首版仅支持 Windows x64，依赖 Docker Desktop 与 WebView2；未配置 Authenticode 签名、自动更新或开机启动。用户设置保存在 `%APPDATA%/local.screen-garden.wallpaper/`，不包含在公开源码和发布包中。
