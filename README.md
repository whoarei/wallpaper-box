# 壁纸盒子 · Wallpaper Box

Windows 动态壁纸程序，支持显示器选择、壁纸切换、系统托盘和暂停恢复。0.4.0 内置水族箱与松风镇，直接从本地播放，无需 Docker。支持程序在线升级，也可从独立的 [whoarei/wallpapers](https://github.com/whoarei/wallpapers) 壁纸库逐项下载、更新和回退，或导入自己的网页壁纸。

## 使用

从 [GitHub Releases](https://github.com/whoarei/wallpaper-box/releases) 下载 Windows x64 NSIS 安装程序。0.3.1 起仅发布安装版。

1. 安装后运行 `wallpaper-box.exe`。运行依赖 WebView2；安装程序在缺少运行时时下载 Microsoft 运行时。
2. 首次启动在主显示器播放水族箱。从右上角下拉框选择显示器，点击“我的壁纸”的封面即可应用；“预览”在独立窗口播放，不改变当前桌面。
3. 左键托盘图标打开管理窗口，右键快速切换、暂停或退出。关闭管理窗口会收起到托盘。
4. 在“发现”点击“刷新壁纸库”，再选择某张壁纸的“下载 / 更新”。检查只获取清单和封面，ZIP 按选择逐项下载，不会自动下载全库。

管理界面以壁纸列表为主，暂停和投喂集中在底部播放栏。“更多播放操作”提供查看桌面、保存预览、重新加载和关闭当前屏幕壁纸；“导入壁纸”统一提供文件夹和 ZIP 两种选择。自动暂停、壁纸目录、重新扫描和程序更新位于右上角“设置”。新版就绪只显示提示，由用户打开设置并确认重启升级。

水族箱投喂：直接左键单击水族箱所在屏幕的桌面空白水面，鱼食会出现在点击位置。也可选择正在播放水族箱的显示器，点击管理窗口或托盘菜单的“投喂鱼儿”。手动暂停时先点“继续”；遮挡导致的自动暂停允许先投喂，回到桌面后鱼儿继续进食。管理窗口的投喂入口会提示加载中、页面自身暂停或饱食等情况。

壁纸模式保持鼠标穿透，桌面图标照常操作。宿主通过只观察、不拦截输入的鼠标钩子，将确认落在同一块桌面空白区域的短点击转发给网页；图标、任务栏、其他窗口、菜单、拖拽和带 Ctrl / Shift / Alt 的点击不会触发壁纸。松风镇也可通过空白处点击种花。程序不安装键盘钩子，也不注册投喂全局快捷键；`E` 键仍用于浏览器独立页面。

0.3.2 修复双屏壁纸周期性闪烁：窗口层级正常时不再反复重排，仅在异常时修复。已在本机双屏确认不再闪烁。

内置和已下载壁纸均可离线播放，无需 GitHub 登录。壁纸更新验证大小和 SHA-256，保留上一活动版本供回退；更新壁纸不需要重编译主程序。

0.4.0 保留 0.2.1 的投喂修复：在宿主中复用水族箱已有投喂逻辑，无需更新壁纸库。两张内置壁纸版本仍为 `1.0.0`，其 `minAppVersion` 仍为 `0.2.0`。

## 程序在线升级

启动时先恢复并重新验签已缓存的更新包，再延迟 5 秒自动检查一次；持续运行时，每 60 秒观察本地日期，每个新日期再自动检查一次。当天的定时检查失败后不会在后台反复重试，可以手动检查，或等待下一天、下次启动。

发现新版后，程序立即在后台下载安装包，并用内置公钥验证 Ed25519 更新签名及版本绑定。壁纸继续播放；下载或校验失败不影响本地壁纸和当前程序。准备完成后只提示“可升级”，点击“重启并升级”并确认后才退出并安装，取消则继续使用当前版本。升级保留已下载壁纸和每块显示器的选择、暂停设置。

官方更新入口为 [latest.json](https://github.com/whoarei/wallpaper-box/releases/latest/download/latest.json)。它只用于程序安装版更新；[whoarei/wallpapers](https://github.com/whoarei/wallpapers) 的内容更新仍由用户逐张点击，不会自动下载全库。

0.2.x 没有程序升级器，需要先手动安装一次 0.4.0，之后才能使用程序在线升级。后续不再发布便携包，也不提供便携版在线升级。

## 网络代理

在“设置 → 网络代理”选择连接方式，默认“跟随系统”；已有用户的设置也会自动采用此默认值。

- **跟随系统**：优先读取 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 和 `NO_PROXY` 环境变量（也支持小写名称），没有对应环境变量时使用 Windows 系统手动代理。不支持 PAC 自动配置脚本和 WPAD。
- **手动代理**：填写完整地址，例如 `http://127.0.0.1:7890`、`https://proxy.example:443`、`socks5://127.0.0.1:1080` 或 `socks5h://127.0.0.1:1080`。SOCKS5H 通过代理解析目标域名。使用 HTTP 或混合端口时填写 `http://`；当前手动设置不支持带用户名或密码的地址。
- **直连**：忽略系统代理和代理环境变量，直接访问网络。

“测试连接”使用当前填写的配置连接 GitHub，不会保存；点击“保存代理设置”后，从下一次网络请求起生效，无需重启。正在进行的请求继续使用原配置。设置保存在原有 `settings.json` 中，重启后保留。

壁纸库清单、在线封面、壁纸包和程序更新共用此配置。代理失败时会报告错误，不会自动切换为直连；HTTPS 校验、下载来源限制和更新签名校验仍然有效。本地壁纸播放不依赖网络。

## 添加自己的壁纸

点击“导入壁纸”后选择文件夹或 ZIP，也可在“设置”打开壁纸文件夹，在 `local/` 中放入完整模块，再点击“刷新”。最小结构：

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
| 用户壁纸根 | `%LOCALAPPDATA%/WallpaperBox/wallpapers` |
| 自定义壁纸 | 用户根下 `local/` |
| 官方内容、活动版本与回退 | 用户根下 `online/<id>/` |
| 下载与导入暂存 | 用户根下 `.downloads/`、`.imports/` |
| 设置、日志与 WebView 数据 | `%APPDATA%/local.screen-garden.wallpaper/` |
| 程序更新包与检查记录 | 上述 AppData 目录内的 `app-updates/`，与壁纸目录分开 |

安装版保留原应用标识与设置目录，沿用原显示器、壁纸和暂停选择。旧 Docker 网页与新本地协议来源不同，页面内 localStorage（如种花记录）需要针对壁纸独立迁移，不能保证自动沿用。

## 项目目录

- `wallpaper-host/`：Tauri 2 宿主、嵌入式管理界面、原生目录发现、本地协议、在线更新与打包校验。
- `wallpapers/{aquarium,pinewind-town}/`：0.4.0 随包的两张壁纸快照。
- `display-service/`：保留的 Legacy Docker 浏览器开发示例，桌面程序运行和安装包不依赖它。
- `.github/workflows/windows.yml`：主程序 CI 与标签发布。
- [HTML 技术方案](display-service/public/docs/architecture.html)：单文件离线文档，含架构、模块规范、权限、迁移及发布流程，支持 10 套配色和保存 PDF。

安装包资源仅为 `wallpapers/`、`docs/architecture.html` 和 `README.txt` 等必要内容，不含 `portable.flag`。用户壁纸、下载缓存、设置和签名私钥不打包。

## 本地构建与核对

需要 Windows x64、PowerShell 7、Rust 1.95.0、Visual Studio C++ Build Tools、Windows SDK 和 Node.js 24。Tauri CLI 固定为 2.12.4；核对安装包载荷需要 7-Zip。

```powershell
Set-Location wallpaper-host
npm ci --ignore-scripts
npm run check:version
npm run bundle
./scripts/package-release.ps1 -RequireSigned
./scripts/verify-release.ps1 -Directory ../release/v0.4.0 -RequireSigned
node scripts/verify-installer.mjs ../release/v0.4.0
```

产物位于 `release/v0.4.0/`，共五项：`wallpaper-box_0.4.0_x64-setup.exe`、同名 `.exe.sig`、`latest.json`、`release-manifest.json` 与 `SHA256SUMS.txt`。`release-manifest.json` 使用 schema 3 的 `installerFiles` 记录安装载荷；7-Zip 校验读取 NSIS 载荷核对路径、大小和 SHA-256，并确认没有 `portable.flag`、用户数据或私钥。7-Zip 默认路径为 `C:\Program Files\7-Zip\7z.exe`，可作为 Node 校验脚本的第二个参数指定。生成在线更新产物还需要在构建环境提供更新签名密钥。

Rust 行为检查：

```powershell
cargo fmt --check --manifest-path wallpaper-host/src-tauri/Cargo.toml
cargo test --locked --release --features custom-protocol --manifest-path wallpaper-host/src-tauri/Cargo.toml
```

管理界面的按需下载、更新/回退、网络失败和水族箱投喂入口可运行 `npm --prefix wallpaper-host run test:ui`。该测试使用锁定版本的 Playwright Core 和本机 Edge，以模拟 IPC 验证真实界面，不访问在线仓库；可用 `EDGE_PATH` 指定浏览器路径。实际投喂行为另需验证鱼食增加、暂停拒绝与饱食提示；最终执行结果见对应版本验收记录。CI 同样执行管理界面检查。

`npm --prefix wallpaper-host run test:aquarium` 使用真实内置水族箱页面，验证宿主投喂脚本和原投喂规则，不模拟页面资源。

只构建开发用 EXE 可运行 `wallpaper-host/build.ps1`。文档可编辑源为 `display-service/docs/architecture-source.cjs`，生成 spec 后使用 `rtd-html-docs` 的 `render.mjs` 更新 HTML。真实设备验收和云端发布结果应以对应版本的发版记录为准。

## 主程序发布

项目发布 skill：[wallpaper-box-release](.agents/skills/wallpaper-box-release/SKILL.md)。发布前须核对清单、锁文件、随包说明和发布标签，并由用户明确确认本次目标版本；示例中的版本号不能直接作为发布指令。

CI 固定工具链、依赖锁文件和 Action 提交，检查版本、JavaScript、Rust 格式与测试，再生成 NSIS 安装包及更新元数据。main、PR 与手动运行只上传 Actions Artifact；推送 `vX.Y.Z` 标签触发 Release。

版本与验收完成后：

```powershell
git tag v0.4.0
git push origin v0.4.0
gh run list --repo whoarei/wallpaper-box --workflow windows.yml
```

发布任务先创建草稿，上传上述五个产物，回下载校验后公开；失败保留草稿，已发布版本不直接覆盖。更新清单、签名和安装包必须属于同一版本。发版同步 `Cargo.toml`、`tauri.conf.json`、`package.json`、`package-lock.json` 与随包 `README.txt`，并准备 `.github/release-notes/vX.Y.Z.md`。

签名私钥只保存在工作区之外：本地通过 `TAURI_SIGNING_PRIVATE_KEY_PATH` 指向密钥文件，GitHub Actions 通过 `TAURI_SIGNING_PRIVATE_KEY` Secret 注入；当前密钥密码为空，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 使用空值。程序内置公钥，安装包和仓库不包含私钥。签名调用带上 `--app-version`，将版本写入经过签名的可信注释。更新签名采用 minisign / Ed25519，用来验证升级包来源和版本；Windows Authenticode 是另一套代码签名，当前安装包尚未配置，因此 Windows 可能仍显示未知发布者。

当前仅支持 Windows x64，暂不包含开机启动。本次文档描述 0.4.0 的实现和验收范围，不表示新版本 CI 或真实跨版本安装已经成功；实际执行结果以发版记录为准。

## 官方壁纸库发布

[whoarei/wallpapers README](https://github.com/whoarei/wallpapers#readme) 维护内容规范与独立发布流程。稳定清单入口为 [catalog.json](https://github.com/whoarei/wallpapers/releases/latest/download/catalog.json)。

新增 `wallpapers/<id>/` 及元数据，修改内容时提升该壁纸版本，独立提升 `library.json` 的版本，运行 `python scripts/build.py`，检查后提交并推送 `library-vX.Y.Z` 标签。内容 CI 生成单项 ZIP、封面、清单和校验文件；用户检查后按需下载，不需要重发主程序。

主程序内置仍为原来的两张。新增的“通往别处的窗户”在内容仓库独立发布后，用于验证无需重编译即可发现、下载和应用新壁纸。
