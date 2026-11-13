# 详细使用与开发说明

功能概览与效果预览见 [项目首页](../README.md)。以下命令和代码路径均以仓库根目录为基准。

## 使用

从 [GitHub Releases](https://github.com/whoarei/wallpaper-box/releases) 下载 Windows x64 NSIS 安装程序。0.3.1 起仅发布安装版。

1. 安装后运行 `wallpaper-box.exe`。运行依赖 WebView2；安装程序在缺少运行时时下载 Microsoft 运行时。
2. 首次启动在主显示器播放水族箱。右上角以各屏当前壁纸封面显示缩略图，点击选择显示器，再点击“我的壁纸”的封面即可应用；“预览”在独立窗口播放，不改变当前桌面。缩略图会高亮所选屏幕，并保留横竖屏比例；未设置壁纸的屏幕显示占位图。
3. 左键托盘图标打开管理窗口；右键菜单可选择显示器，在“壁纸”子菜单中切换壁纸，通过“壁纸 → 壁纸操作”执行互动、暂停当前壁纸或关闭当前屏幕壁纸。全部暂停 / 继续、显示 / 还原桌面与退出保留在一级菜单；自动暂停、程序更新和关于信息归入“设置与帮助”。关闭管理窗口会收起到托盘。
4. 每次点击“发现”都会自动刷新已启用仓库的在线壁纸清单，已有缓存时也会刷新；刷新期间重复点击不会重复发起请求，也可点击“刷新壁纸库”手动刷新。再选择某张壁纸的“下载 / 更新”。检查只获取清单和封面，ZIP 按选择下载，不会自动下载全库。最多同时处理 5 项下载，超出的按加入顺序等待。

管理界面以壁纸列表为主，暂停和投喂集中在底部播放栏。“更多播放操作”提供查看桌面、保存预览、重新加载和关闭当前屏幕壁纸。右上角“设置”按“常规、壁纸仓库、网络代理、程序更新”分类，一次显示一组内容。“常规”包含随系统启动、自动暂停、文件夹 / ZIP 导入、壁纸目录和重新扫描；仓库、代理的保存按钮固定在各自页面底部，详细说明默认收起。切换分类会保留尚未保存的输入。新版就绪提示可直接打开“程序更新”，由用户确认重启升级。

底部播放栏显示当前屏幕壁纸运行进程组的 CPU 和内存占用，每 5 秒采样一次。CPU 按整机总算力计算采样期间的平均比例，内存为专用工作集，不含共享内存和显存；点击读数可查看统计说明。首次采样及壁纸重载后先显示“采样中”，读取失败或进程无法独立统计时显示“暂不可用”。手动或自动暂停后仍显示实际占用，管理窗口收起、最小化后停止采样。

管理窗口采用与导航融合的自绘标题栏。右上角依次为最小化、最大化 / 还原和收起到托盘；可拖动标题栏空白或品牌区域移动窗口，双击切换最大化 / 还原。窗口按钮支持 Tab 聚焦和 Enter / 空格操作，关闭窗口后壁纸继续播放。

程序首次运行后默认启用“随系统启动”，旧设置也采用此默认值。登录 Windows 时在后台恢复各屏壁纸并留在托盘，不弹出管理窗口；手动打开程序或左键点击托盘则显示管理窗口。在“设置 → 常规”可随时关闭，立即生效，重启和升级后保留选择。启动项仅用于当前用户，不需要管理员权限；程序会保留 Windows 任务管理器中禁用启动项的状态，需要重新启用时可打开此开关。设置失败会在开关旁提示，不影响壁纸播放；正常卸载会移除启动项。

“关于壁纸盒子”和退出入口固定在“设置”底部；关于面板也可从托盘右键菜单打开。两个关于入口共用同一面板，展示当前安装版本、作者、项目主页、问题反馈和主要第三方组件许可；外部链接在系统默认浏览器打开。

水族箱投喂：直接左键单击水族箱所在屏幕的桌面空白水面，鱼食会出现在点击位置。适配后的水族箱会在管理窗口和托盘菜单中提供“投喂鱼儿”。手动暂停时先点“继续”；遮挡导致的自动暂停允许先投喂，回到桌面后鱼儿继续进食。管理窗口的投喂入口会提示加载中、页面自身暂停或饱食等情况。

壁纸模式保持鼠标穿透，桌面图标照常操作。宿主通过只观察、不拦截输入的鼠标钩子，将确认落在同一块桌面空白区域的短点击转发给网页；图标、任务栏、其他窗口、菜单、拖拽和带 Ctrl / Shift / Alt 的点击不会触发壁纸。松风镇也可通过空白处点击种花。程序不安装键盘钩子，也不注册投喂全局快捷键；浏览器与预览窗口仍可使用页面快捷键。

v0.10.1 修复部分多屏环境中桌面空白处点击和鼠标移动无效的问题：当全局 UIA 命中返回整个桌面而非实际桌面列表时，改为向命中的桌面列表查询自身的可访问性命中结果，仅转发确认位于空白处的输入。桌面图标和标签仍被排除。若交互异常，可查看 `%APPDATA%/local.screen-garden.wallpaper/diagnostics.json` 的 `desktop_input`：包含监听事件数、队列丢弃数、工作线程阶段、转发计数及最近的拒绝原因；页面实际接收的点击仍记录在 `host.log` 和各屏的 `desktop_clicks` 中。

内置松风镇和水族箱由各自页面决定控制栏、帮助与暂停画面的显示。移动鼠标到桌面空白处可唤回控制栏；控制栏被桌面图标覆盖时，需先移开图标。桌面模式不提供网页全屏或页面快捷键，预览保留原有操作。页面控制栏的暂停与主程序暂停分别保存，主程序继续播放不会清除页面自己的暂停。

底部播放栏和托盘会显示当前壁纸提供的互动操作；多个操作可从展开菜单选择。已经下载但未适配的新接口旧包仍可播放和直接点击，其扩展操作入口需要更新壁纸包后才会显示。开发者接口与兼容要求见 [壁纸适配规范（HTML）](wallpaper-adaptation.html)。主程序从 v0.10.0 起提供 v1；v0.9.0 及更早版本尚不支持这些公开接口。

壁纸窗口按每块显示器的 Windows 可用工作区布局，避开任务栏等系统保留区域，让网页内容在可见区域内完整排版。任务栏位置、大小或显示器布局变化后，宿主会在约 2 秒内调整现有窗口；桌面点击坐标和自动暂停检测也按实际播放区域计算。

0.3.2 修复双屏壁纸周期性闪烁：窗口层级正常时不再反复重排，仅在异常时修复。已在本机双屏确认不再闪烁。

内置和已下载壁纸均可离线播放，公开壁纸仓库无需登录。壁纸更新验证大小和 SHA-256，保留上一活动版本供回退；更新壁纸不需要重编译主程序。

在“发现”点击卡片上的版本号，可展开该仓库正式 Release 中的版本列表；点击某个版本号即开始下载并替换，不需要确认弹窗。版本较多时可继续加载“更早版本”。下载期间显示目标版本，失败或取消会保留原版本，重试仍下载原先选择的版本。校验并安装成功后，正在使用这张壁纸的屏幕会自动刷新；未使用的壁纸仍需手动应用。不兼容当前程序的版本不可下载。

下载进度直接显示在壁纸卡片中，包括百分比、大小和速度。鼠标悬停或键盘聚焦卡片时可取消下载、移出等待项；失败卡片常显“重试”。右上角的任务数量可筛选“发现”中的相关卡片，没有独立下载面板。取消会停止连接并保留已有壁纸；下载、校验和安装完成后才加入“我的壁纸”，新壁纸由用户选择应用。

网络传输直接写入各自的临时文件，安装依次执行；最多 5 项任务占用处理位置，包含等待安装和安装中的任务。仅安装时读取一个完整 ZIP，避免并行下载同时占用多个完整包的内存。任务队列仅保留在本次运行中，关闭程序会停止下载。

v0.9.0 及以前的水族箱专用投喂适配已在 v0.10.0 迁移为通用操作发现与调用，具体投喂规则由壁纸执行。两张随包内置快照更新为 1.0.1，保留面向旧宿主的网页降级，不提高其最低主程序版本。官方在线内容库独立发布；程序升级不会替换用户已经激活的在线内容包，未适配旧包的管理端扩展操作需更新内容包后恢复。

## 程序在线升级

启动时先恢复并重新验签已缓存的更新包，再延迟 5 秒自动检查一次；持续运行时，每 60 秒观察本地日期，每个新日期再自动检查一次。当天的定时检查失败后不会在后台反复重试，可以手动检查，或等待下一天、下次启动。

发现新版后，程序立即在后台下载安装包，并用内置公钥验证 Ed25519 更新签名及版本绑定。壁纸继续播放；下载或校验失败不影响本地壁纸和当前程序。准备完成后只提示“可升级”；用户点击“重启并升级”即退出并启动已验证的安装程序，不再弹出二次确认。未点击则继续使用当前版本。升级保留已下载壁纸和每块显示器的选择、暂停设置。

官方更新入口为 [latest.json](https://github.com/whoarei/wallpaper-box/releases/latest/download/latest.json)。它只用于程序安装版更新；[whoarei/wallpapers](https://github.com/whoarei/wallpapers) 的内容更新仍由用户逐张点击，不会自动下载全库。

0.2.x 没有程序升级器，需要先手动安装一次 0.4.0，之后才能使用程序在线升级。后续不再发布便携包，也不提供便携版在线升级。

## 壁纸仓库

在“设置 → 壁纸仓库”添加、修改或移除公开的 GitHub、Gitee 仓库 HTTPS 地址，支持 `.git` 后缀；每项有独立的启用开关。“上移”可以调整优先顺序，点击页面底部的“保存更改”后生效。

- 默认启用 [Gitee：xishuaiya/wallpapers](https://gitee.com/xishuaiya/wallpapers.git)。
- 默认关闭 [GitHub：whoarei/wallpapers](https://github.com/whoarei/wallpapers)，可按需开启。

旧设置缺少仓库列表时也采用上述默认值。保存后，点击“发现”会自动刷新清单，也可点击“刷新壁纸库”手动刷新，程序只访问启用仓库的最新稳定 Release。清单、ZIP 和封面均从所选仓库的该次 Release 附件中解析；不会因镜像清单中保留原始地址而访问关闭的仓库。

多个仓库的壁纸按 ID 合并，同一 ID 优先采用列表靠前的已启用仓库，并在卡片显示来源。每个仓库单独缓存清单；刷新失败时保留该仓库缓存并显示错误，其他仓库仍可使用。保存关闭或移除的仓库后，其在线结果立即隐藏，已下载的本地壁纸、当前播放和回退版本继续保留。允许关闭所有仓库，此时不会发起壁纸库请求。

自定义仓库须采用相同壁纸规范：最新稳定 Release 使用 `library-vX.Y.Z` 标签，包含 schema 1 的 `catalog.json`、清单声明的单项 `<id>-<version>.zip` 及可选封面。程序验证附件来自所选仓库及同一 Release，并继续验证 ZIP 大小、SHA-256 和包内元数据。当前支持最多 16 个仓库。

这些设置用于壁纸内容；程序安装版更新继续使用原有 GitHub 更新入口。

## 网络代理

在“设置 → 网络代理”选择连接方式，默认“跟随系统”；已有用户的设置也会自动采用此默认值。

- **跟随系统**：优先读取 `HTTPS_PROXY`、`HTTP_PROXY`、`ALL_PROXY` 和 `NO_PROXY` 环境变量（也支持小写名称），没有对应环境变量时使用 Windows 系统手动代理。不支持 PAC 自动配置脚本和 WPAD。
- **手动代理**：填写完整地址，例如 `http://127.0.0.1:7890`、`https://proxy.example:443`、`socks5://127.0.0.1:1080` 或 `socks5h://127.0.0.1:1080`。SOCKS5H 通过代理解析目标域名。使用 HTTP 或混合端口时填写 `http://`；当前手动设置不支持带用户名或密码的地址。
- **直连**：忽略系统代理和代理环境变量，直接访问网络。

“测试连接”使用当前填写的配置连接 GitHub，不会保存；点击页面底部的“保存更改”后，从下一次网络请求起生效，无需重启。正在进行的请求继续使用原配置。设置保存在原有 `settings.json` 中，重启后保留。

壁纸库清单、在线封面、壁纸包和程序更新共用此配置。代理失败时会报告错误，不会自动切换为直连；HTTPS 校验、下载来源限制和更新签名校验仍然有效。本地壁纸播放不依赖网络。

## 添加自己的壁纸

在“设置 → 常规”的“本地壁纸”中选择文件夹或 ZIP 导入，也可打开壁纸文件夹，在 `local/` 中放入完整模块，再点击“重新扫描”。最小结构：

```text
local/
  my-scene/
    index.html
    module.json     可选
    cover.jpg       可选
    assets/         可选
```

HTML、脚本、样式与图片使用相对路径。文件夹名使用小写字母、数字和连字符；可选 `module.json` 定义名称、说明、版本、入口、封面和排序，完整规范见 [HTML 技术方案](../display-service/public/docs/architecture.html#module-contract)。自定义模块运行 ID 为 `local:<文件夹名>`，不会覆盖内置或官方内容。

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
- `wallpapers/{aquarium,pinewind-town}/`：0.10.3 随包的两张壁纸快照（内容版本 1.0.1）。
- `display-service/`：保留的 Legacy Docker 浏览器开发示例，桌面程序运行和安装包不依赖它。
- `.github/workflows/windows.yml`：主程序 CI 与标签发布。
- [HTML 技术方案](../display-service/public/docs/architecture.html)：单文件离线文档，含架构、模块规范、权限、迁移及发布流程，支持 10 套配色和保存 PDF。

安装包资源仅为 `wallpapers/`、`docs/architecture.html` 和 `README.txt` 等必要内容，不含 `portable.flag`。用户壁纸、下载缓存、设置和签名私钥不打包。

## 本地构建与核对

需要 Windows x64、PowerShell 7、Rust 1.95.0、Visual Studio C++ Build Tools、Windows SDK 和 Node.js 24。Tauri CLI 固定为 2.12.4；核对安装包载荷需要 7-Zip。

```powershell
Set-Location wallpaper-host
npm ci --ignore-scripts
npm run check:version
npm run bundle
./scripts/package-release.ps1 -RequireSigned
./scripts/verify-release.ps1 -Directory ../release/v0.10.3 -RequireSigned
node scripts/verify-installer.mjs ../release/v0.10.3
```

产物位于 `release/v0.10.3/`，共五项：`wallpaper-box_0.10.3_x64-setup.exe`、同名 `.exe.sig`、`latest.json`、`release-manifest.json` 与 `SHA256SUMS.txt`。`release-manifest.json` 使用 schema 3 的 `installerFiles` 记录安装载荷；7-Zip 校验读取 NSIS 载荷核对路径、大小和 SHA-256，并确认没有 `portable.flag`、用户数据或私钥。7-Zip 默认路径为 `C:\Program Files\7-Zip\7z.exe`，可作为 Node 校验脚本的第二个参数指定。生成在线更新产物还需要在构建环境提供更新签名密钥。

Rust 行为检查：

```powershell
cargo fmt --check --manifest-path wallpaper-host/src-tauri/Cargo.toml
cargo test --locked --release --features custom-protocol --manifest-path wallpaper-host/src-tauri/Cargo.toml
```

管理界面的按需下载、更新/回退、网络失败和水族箱投喂入口可运行 `npm --prefix wallpaper-host run test:ui`。该测试使用锁定版本的 Playwright Core 和本机 Edge，以模拟 IPC 验证真实界面，不访问在线仓库；可用 `EDGE_PATH` 指定浏览器路径。实际投喂行为另需验证鱼食增加、暂停拒绝与饱食提示；最终执行结果见对应版本验收记录。CI 同样执行管理界面检查。

自绘窗口控件同样纳入 UI 检查，覆盖原生接口调用、外部最大化 / 还原事件、失焦、DPI 事件、延迟状态读取、失败提示、拖拽区域隔离和关闭到托盘。浏览器检查使用窗口接口模拟，不代表 Windows 真机验收；边缘缩放、拖拽贴靠、不同缩放比例的多屏移动及任务栏边界仍需在 Windows 验证。Windows 11 的最大化按钮悬停贴靠菜单尚未接入。

`npm --prefix wallpaper-host run test:aquarium` 使用真实内置水族箱页面，验证真实通用操作调用、投喂规则与鱼群进食，不模拟页面资源。

`npm --prefix wallpaper-host run test:pinewind` 使用真实内置松风镇页面，验证预览与壁纸模式、桌面控制按钮、帮助和鼠标移动唤醒，确认控制操作不会误种花。

`npm --prefix wallpaper-host run test:protocol` 检查只读运行环境、暂停原因、操作校验、未知结果、请求去重、旧内容与实例隔离。`npm --prefix wallpaper-host run test:modules` 使用真实页面验证两张壁纸的桌面、预览、浏览器和旧模式降级；设置 `WALLPAPER_ROOT` 可对内容库目录运行同一套检查。

只构建开发用 EXE 可运行 `wallpaper-host/build.ps1`。文档可编辑源为 `display-service/docs/architecture-source.cjs`，生成 spec 后使用 `rtd-html-docs` 的 `render.mjs` 更新 HTML。真实设备验收和云端发布结果应以对应版本的发版记录为准。

## 主程序发布

项目发布 skill：[wallpaper-box-release](../.agents/skills/wallpaper-box-release/SKILL.md)。先展示修改点，再提供补丁、次版本和主版本三个实际版本选项，推荐项排第一。用户选择后才修改版本文件并执行本次已授权的发布，不再追加文字确认；示例版本、预选推荐项或跳过问题均不构成版本选择。

CI 固定工具链、依赖锁文件和 Action 提交，检查版本、JavaScript、Rust 格式与测试，再生成 NSIS 安装包及更新元数据。main、PR 与手动运行只上传 Actions Artifact；推送 `vX.Y.Z` 标签触发 Release。

版本与验收完成后：

```powershell
git tag v0.10.3
git push origin v0.10.3
gh run list --repo whoarei/wallpaper-box --workflow windows.yml
```

发布任务先创建草稿，上传上述五个产物，回下载校验后公开；失败保留草稿，已发布版本不直接覆盖。更新清单、签名和安装包必须属于同一版本。发版同步 `Cargo.toml`、`tauri.conf.json`、`package.json`、`package-lock.json` 与随包 `README.txt`，并准备 `.github/release-notes/vX.Y.Z.md`。

签名私钥只保存在工作区之外：本地通过 `TAURI_SIGNING_PRIVATE_KEY_PATH` 指向密钥文件，GitHub Actions 通过 `TAURI_SIGNING_PRIVATE_KEY` Secret 注入；当前密钥密码为空，`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 使用空值。程序内置公钥，安装包和仓库不包含私钥。签名调用带上 `--app-version`，将版本写入经过签名的可信注释。更新签名采用 minisign / Ed25519，用来验证升级包来源和版本；Windows Authenticode 是另一套代码签名，当前安装包尚未配置，因此 Windows 可能仍显示未知发布者。

当前仅支持 Windows x64。版本与真实设备验收范围以发版记录为准。

## 官方壁纸库发布

[whoarei/wallpapers README](https://github.com/whoarei/wallpapers#readme) 维护内容规范与独立发布流程。稳定清单入口为 [catalog.json](https://github.com/whoarei/wallpapers/releases/latest/download/catalog.json)。

新增 `wallpapers/<id>/` 及元数据，修改内容时提升该壁纸版本，独立提升 `library.json` 的版本，运行 `python scripts/build.py`，检查后提交并推送 `library-vX.Y.Z` 标签。内容 CI 生成单项 ZIP、封面、清单和校验文件；用户检查后按需下载，不需要重发主程序。

主程序内置仍为原来的两张。新增的“通往别处的窗户”在内容仓库独立发布后，用于验证无需重编译即可发现、下载和应用新壁纸。
