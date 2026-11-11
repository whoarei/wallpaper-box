'use strict';
// Editable source for the offline, single-file technical document.
// Keep section IDs and documentId stable so existing links and theme settings survive.
const fs = require('node:fs');
const path = require('node:path');
const escape = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const code = s => '<pre><code>' + escape(s) + '</code></pre>';
const table = (heads, rows) => '<div class="table-wrap"><table><thead><tr>' + heads.map(h => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.map(row => '<tr>' + row.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';

const diagram = `<figure class="architecture-diagram"><div class="diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 485" role="img" aria-labelledby="architecture-title architecture-desc">
<title id="architecture-title">壁纸盒子 0.4.0 本地优先架构</title><desc id="architecture-desc">管理界面和托盘调用 Rust 宿主；宿主合并内置壁纸与用户壁纸，通过 WebView 自定义协议将本地文件提供给桌面壁纸窗口。壁纸更新只在用户选择单张时下载 ZIP；程序升级另行使用主仓库的签名安装包。</desc>
<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8Z" fill="var(--accent, #b7432a)"/></marker></defs>
<g font-family="Microsoft YaHei, sans-serif" text-anchor="middle" fill="var(--ink, #404040)">
<g stroke="var(--diagram-line, #b8c7d3)" fill="var(--surface-raised, #fff)"><rect x="25" y="165" width="190" height="90" rx="10"/><rect x="290" y="25" width="240" height="85" rx="10"/><rect x="600" y="25" width="255" height="85" rx="10"/><rect x="785" y="165" width="190" height="90" rx="10"/><rect x="25" y="365" width="235" height="90" rx="10"/><rect x="365" y="365" width="280" height="90" rx="10"/></g>
<rect x="290" y="165" width="240" height="90" rx="10" fill="var(--accent-soft, #fff1e9)" stroke="var(--accent, #b7432a)"/><rect x="580" y="165" width="155" height="90" rx="10" fill="var(--accent-soft, #fff1e9)" stroke="var(--accent, #b7432a)"/>
<g font-size="17"><text x="120" y="201">管理界面 / 托盘</text><text x="410" y="60">随包 wallpapers/</text><text x="727" y="60">用户壁纸目录</text><text x="410" y="201">Rust / Tauri 宿主</text><text x="657" y="201">本地资源协议</text><text x="880" y="201">WebView2 壁纸</text><text x="142" y="401">GitHub 官方内容库</text><text x="505" y="401">按需下载 / 校验 / 安装</text></g>
<g font-size="13" fill="var(--muted, #607080)"><text x="120" y="229">显示器 · 壁纸 · 暂停</text><text x="410" y="85">水族箱 / 松风镇 · 只读快照</text><text x="727" y="85">local/ · online/ · active.json</text><text x="410" y="229">原生目录发现 · 设置 · 窗口</text><text x="657" y="229">不监听 TCP 端口</text><text x="880" y="229">每屏窗口 · Explorer 桌面层</text><text x="142" y="429">catalog.json · 封面 · 版本 ZIP</text><text x="505" y="429">SHA-256 · 受限解压 · 原子切换</text></g></g>
<g stroke="var(--accent, #b7432a)" fill="none" stroke-width="2" marker-end="url(#arrow)"><path d="M215 210H282"/><path d="M410 110V157"/><path d="M727 110V133H465V157"/><path d="M530 210H572"/><path d="M735 210H777"/><path d="M260 410H357" stroke-dasharray="6 4"/><path d="M645 410H755V133H840V118" stroke-dasharray="6 4"/></g>
<g font-family="Microsoft YaHei, sans-serif" font-size="12" fill="var(--muted, #607080)"><text x="234" y="193">IPC</text><text x="541" y="193">读取</text><text x="741" y="193">响应</text><text x="282" y="389">单个壁纸</text><text x="770" y="340">验证后安装</text></g>
<path d="M330 255V313H142V357" stroke="var(--accent, #b7432a)" fill="none" stroke-width="2" stroke-dasharray="6 4" marker-end="url(#arrow)"/><text x="31" y="303" font-family="Microsoft YaHei, sans-serif" font-size="12" fill="var(--muted, #607080)">检查：仅清单 / 封面；下载：用户逐项选择</text>
</svg></div><figcaption>实线表示本地读取与显示，虚线表示用户触发的联网与安装流程。日常播放无需 Docker、Node、Nginx 或网络。</figcaption></figure>`;

const spec = {
  title: '壁纸盒子 · 模块化技术方案',
  project: 'Wallpaper Box',
  subtitle: '离线动态壁纸、独立内容更新与签名安装版升级',
  documentId: 'screen-garden-architecture',
  updated: '2026-11-11',
  version: '0.4.0',
  eyebrow: 'Windows / Tauri 2 / 本地优先',
  introHtml: '<p class="lead">壁纸盒子将 HTML 动态场景作为独立内容模块，通过 Tauri 与 WebView2 显示在 Windows 桌面层。0.4.0 随包提供水族箱和松风镇，直接从本地文件播放；新增壁纸可放入用户目录，也可从官方 GitHub 内容库逐项下载。</p><div class="callout"><strong>0.4.0：</strong>简化管理界面，新增独立动态预览，并保留 0.3.2 的多屏层级修复。只发布 NSIS 安装版。程序自动检查新版并在后台下载、验签，准备完成后由用户确认安装；壁纸内容仍按单张选择下载，两条更新链路独立。日常播放不依赖 Docker 或本机 HTTP 服务器。</div>',
  sections: [
    {id:'overview', title:'目标与边界', html:
      '<p>运行环境为 Windows x64、Explorer 桌面与 WebView2 Runtime。NSIS 安装版使用当前用户安装；0.3.1 起不再发布便携版，也不提供便携版在线升级。内置壁纸和已下载壁纸均可离线播放。</p>' +
      table(['能力','0.4.0 约定'],[
        ['桌面显示','选择显示器，为每屏切换壁纸；托盘提供切换、暂停、查看桌面和退出操作'],
        ['内置内容','<code>aquarium</code> 水族箱与 <code>pinewind-town</code> 松风镇，内容版本均为 1.0.0，最低程序版本仍为 0.2.0'],
        ['水族箱互动','桌面空白水面左键单击，在原位置投喂；管理窗口和托盘保留“投喂鱼儿”入口'],
        ['新增内容','本地文件夹 / ZIP 导入，或手动放入用户 <code>local/</code>；官方内容逐项下载安装'],
        ['壁纸网络使用','检查更新取清单及封面；点击某张壁纸的下载 / 更新才取该张 ZIP'],
        ['运行进程','Tauri 宿主及 WebView2；不启动 Docker、Node 或 Nginx'],
        ['内容边界','HTML / CSS / JavaScript 与静态资源；带独立后端的应用仍需自行提供后端'],
        ['程序升级','启动及每日自动检查；发现新版后后台下载并验签，确认“重启并升级”后安装']
      ])},
    {id:'architecture', title:'运行架构与请求流程', html: diagram +
      '<h3>本地播放链路</h3><ol><li>Rust 宿主定位随包 <code>wallpapers/</code> 及用户壁纸根目录。</li><li>原生目录发现合并内置快照、官方已安装版本和自定义模块，返回卡片与独立警告。</li><li>用户选择壁纸后，宿主创建或复用相应显示器的 WebView 窗口。</li><li>WebView 请求 <code>http://wallpaper.localhost/&lt;模块 ID&gt;/&lt;相对路径&gt;</code>，由 Tauri 注册的自定义协议处理器直接读取本地文件。</li><li>原生桌面层将程序自有窗口放到桌面图标下方，并维护位置、尺寸、暂停与恢复。</li></ol><p><code>wallpaper.localhost</code> 是 WebView 自定义协议映射的内部来源，不是对外运行的网站，也不占用 8088 或其他 TCP 监听端口。浏览器直接输入该地址不能替代壁纸程序。</p>' +
      '<h3>职责划分</h3>' + table(['文件 / 组件','职责'],[
        ['<code>host.rs</code> / <code>desktop.rs</code>','管理命令、每屏状态、托盘、显示器维护及 Windows 桌面层'],
        ['<code>catalog.rs</code>','原生扫描、元数据校验、来源合并、活动版本与回退'],
        ['<code>protocol.rs</code>','按窗口作用域读取本地资源、MIME、范围请求与路径隔离'],
        ['<code>online.rs</code> / <code>packages.rs</code>','GitHub 清单缓存、单项下载、校验、受限解压与自定义导入'],
        ['<code>app_updates.rs</code>','主仓库更新清单、每日调度、后台安装包下载、Ed25519 验签与确认安装'],
        ['<code>ui/</code>','嵌入程序的管理界面；通过受限 IPC 访问宿主能力']
      ])},
    {id:'wallpaper-host', title:'Tauri 动态壁纸与系统托盘', html:
      '<h3>日常操作</h3><ol><li>运行 <code>wallpaper-box.exe</code>。首次启动默认在主显示器使用水族箱，后续读取已有每屏选择与暂停状态。</li><li>从管理界面的下拉框选择显示器，点击“我的壁纸”的封面即可应用。底部播放栏常驻，集中提供暂停和投喂。每块屏幕使用独立壁纸窗口。</li><li>左键托盘图标打开管理窗口；右键选择显示器、切换壁纸、暂停当前或全部、关闭当前壁纸、查看桌面或退出。</li><li>关闭管理窗口会收起到托盘。使用“退出壁纸盒子”结束程序并恢复原桌面背景。</li></ol>' +
      '<h3>简洁界面与动态预览</h3><p>“导入壁纸”统一提供文件夹与 ZIP 入口；自动暂停、壁纸文件夹、重新扫描和程序更新位于“设置”。查看桌面、保存预览、重新加载和关闭当前屏幕壁纸位于底部“更多播放操作”。更新就绪仅显示提示，不自动打开设置或安装确认框。</p><p>“预览”调用仅管理窗口可用的 <code>preview_wallpaper({moduleId})</code>，在独立的普通 WebView2 窗口运行本地壁纸，不进入桌面分配与运行列表；关闭即停止预览。只保留一个实时预览，协议资源范围限制为该壁纸，拒绝外部导航和新弹窗，预览窗口没有管理 IPC 权限。保留现有内容 CSP，不通过嵌入 iframe 放宽壁纸权限。</p><h3>桌面空白点击与水族箱投喂</h3><p>直接左键单击水族箱所在屏幕的空白水面，宿主将坐标转发给网页，在点击位置投喂。松风镇沿用同一机制处理点击种花。壁纸窗口继续鼠标穿透，HUD 隐藏，不抢焦点、不改变原始 Windows 输入。</p><ol><li><code>desktop_input.rs</code> 在独立消息循环线程观察 <code>WH_MOUSE_LL</code>。钩子只跟踪按下、移动、松开及命中的原生 HWND，用有界队列异步交给识别线程，并始终调用 <code>CallNextHookEx</code>；不执行 UIA 查询或网页代码。</li><li>后台线程检查按下和松开均位于同一块正在运行且未手动暂停的壁纸。只接受 Explorer 所属 Progman / WorkerW 下的桌面容器，结合 UIA 命中排除图标及文字。任务栏、菜单、普通应用窗口、Ctrl / Shift / Alt 点击、长按和超过系统拖拽阈值的移动均不转发。</li><li>物理坐标按当前壁纸矩形转换为归一化坐标，再由 <code>wallpaper-mode.js</code> 换算为网页 CSS 坐标并发送 pointer / mouse / click 事件。支持负坐标显示器和不同 DPI；过期事件、切换壁纸后的旧窗口代次和已改变的矩形会被丢弃。</li><li>宿主记录成功转发的 <code>desktop_clicks</code>，水族箱回执还包含实际新增鱼食数量。没有键盘钩子或投喂全局快捷键；E 键仍只适用于浏览器独立页面。</li></ol><p>管理窗口和托盘保留“投喂鱼儿”入口：选择正在播放 <code>aquarium</code> 的显示器后使用；手动暂停时禁用。遮挡自动暂停时可先投喂，回到桌面后继续进食。按钮路径通过 <code>aquarium-feed.js</code> 调用既有 <code>#feed.click()</code>，检查实际食物增加并提示加载、页面暂停、饱食或未响应等情况。桌面点击和按钮均沿用旧壁纸的食物上限、鱼群吸引与涟漪逻辑，无需修改内容包；内置内容仍为 1.0.0，最低程序版本仍为 0.2.0。</p><div class="callout">桌面点击修复随 0.3.1 安装包提供。鼠标观察只转发确认的桌面空白短点击；图标、选择框与右键菜单继续由 Explorer 处理。</div>' +
      '<h3>桌面层与资源节约</h3><p>经典桌面通过 WorkerW 子窗口承载壁纸；部分较新 Windows 11 使用 Progman 下的透明合成子窗口。宿主只操作自己的 HWND，不移动 Explorer 图标窗口。窗口以物理像素定位，维护循环检测显示器连接、位置和桌面层变化。</p><p>多屏壁纸共享 Progman 父窗口时，只要求所有壁纸位于图标层下方、系统背景层上方。顺序正确时，每 2 秒的检查不调用 SetWindowPos，也不让多张壁纸轮流争占图标后的同一个位置；顺序异常时才执行修复。实际修复次数记录在每屏 diagnostics.json 的 z_order_repairs，并写入 host.log。此项为 0.3.2 的多屏闪烁修复：24 项 Rust 测试通过；本机双屏连续播放 30 秒，实际层级修复次数均为 0，用户确认两块屏幕都不再闪烁。对照结果支持周期性层级重排是本次闪烁原因；0.4.0 继续保留这项修复；本版新增界面和原生预览的 Windows 验收须另行记录。</p><p>壁纸窗口鼠标穿透，原页面说明控件在壁纸模式下隐藏。宿主对 requestAnimationFrame 动画提供暂停包装；单个普通窗口覆盖屏幕达到阈值时可自动暂停，恢复可见后继续。手动暂停优先，多个小窗口合计遮挡不作为当前检测依据。实际 CPU / GPU 占用随分辨率、场景和显示器数量变化。</p>' +
      '<h3>设置与诊断</h3>' + code(String.raw`%APPDATA%/local.screen-garden.wallpaper/
├─ settings.json              每屏选择、选中屏幕与暂停设置
├─ diagnostics.json           当前显示器与窗口状态
├─ host.log                   启动、应用与恢复记录
├─ webview/                   WebView2 用户数据
└─ preview-wallpaper-*.png     用户触发的桌面预览`) +
      '<p>壁纸文件与设置分开保存。0.4.0 保留应用标识和原设置位置，不将本机设置、诊断、截图或 WebView 数据打入发布包。程序不注册 Windows 服务或开机启动。</p>'},
    {id:'app-updates', title:'程序在线升级与确认安装', html:
      '<p>程序更新来自 <a href="https://github.com/whoarei/wallpaper-box">whoarei/wallpaper-box</a>，固定清单入口为 <a href="https://github.com/whoarei/wallpaper-box/releases/latest/download/latest.json">releases/latest/download/latest.json</a>。这是主程序升级入口；壁纸内容继续使用另一仓库的 catalog.json 和独立 ZIP。</p>' +
      '<h3>检查、下载与安装时机</h3><ol><li>每次启动先恢复缓存并重新验签，再延迟 5 秒检查一次。持续运行时每 60 秒观察本地日期，在新日期再检查一次；失败也计入当天已检查，不在当天后台循环重试。同日重新启动仍会执行启动检查。</li><li>发现高于当前版本的正式版本后，立即后台下载该版本 NSIS 安装包并校验签名及版本绑定。壁纸窗口继续播放。</li><li>下载、校验完成进入 <code>ready</code>，管理界面只提示可升级，不退出、不安装。</li><li>用户点击“重启并升级”，再次确认后才启动安装并退出当前程序；取消确认则保留当前运行状态。安装请求必须携带用户确认的目标版本，候选版本变化后须重新确认。</li><li>安装升级保留已下载壁纸、自定义内容、每屏壁纸选择及暂停设置；内置快照随程序资源更新。</li></ol>' +
      table(['情形','处理'],[
        ['自动检查失败','显示失败状态；当天不反复后台重试，可手动检查、下次启动或下一天再试'],
        ['下载或验签失败','不安装未验证文件，当前程序及本地壁纸继续运行'],
        ['已准备好但未确认','保留可升级提示，用户决定安装时机'],
        ['0.2.x 升到本版','旧版没有程序升级器，先从 Release 手动安装一次 0.4.0；后续版本可走在线升级'],
        ['便携版','后续仅发布安装版，不提供便携版升级链路']
      ]) +
      '<h3>管理接口与状态</h3>' + table(['接口 / 字段','约定'],[
        ['<code>check_app_update</code>','检查清单；找到新版后自动下载并验签，无需再点击下载'],
        ['<code>download_app_update</code>','对已发现的候选更新重新下载，供失败重试'],
        ['<code>install_app_update({confirmed:true, version})</code>','仅管理窗口；ready 且目标版本仍与确认时一致才安装，安装前再次验签'],
        ['<code>app_update.phase</code>','idle / checking / downloading / ready / up_to_date / error / installing'],
        ['<code>app_update</code> 其他字段','current_version、version、notes、received、total、error、last_checked_at']
      ]) +
      '<p>检查记录和安装包缓存位于 <code>%APPDATA%/local.screen-garden.wallpaper/app-updates/</code>，与用户壁纸及每屏设置分开。缓存不等同于已获准安装，恢复和安装前都重新验签。</p>' +
      code(String.raw`app-updates/
├─ schedule.json                         last_checked_at + 本地日期 day
├─ pending.json                          候选版本的服务器原始清单
├─ wallpaper-box_<version>_x64-setup.exe   完整验签后的安装包
└─ installer.part                        安装包写入暂存`) +
      '<h3>更新信任与版本绑定</h3><p>安装包使用 Tauri 的 Base64 包装 minisign 格式 Ed25519 更新签名，程序内置公钥。清单版本、固定官方 Release 地址、安装包文件名和可信签名注释中的版本必须一致；签名命令通过 <code>--app-version</code> 绑定版本，运行时启用 <code>requireSignedVersion</code>。未知来源、旧版本或不匹配的签名不得进入可安装状态。清单上限 1 MiB，安装包上限 128 MiB，网络请求只接受 HTTPS 和允许的官方跳转目标；下载与校验失败不修改当前安装。</p><p>私钥仅保存在工作区之外，本地通过 <code>TAURI_SIGNING_PRIVATE_KEY_PATH</code> 指向文件，GitHub Actions 使用 <code>TAURI_SIGNING_PRIVATE_KEY</code> Secret；当前密钥密码为空，<code>TAURI_SIGNING_PRIVATE_KEY_PASSWORD</code> 使用空值。私钥不得提交到仓库、写入日志或放入安装包。程序只携带更新公钥。minisign 更新签名验证程序认可的升级来源；Windows Authenticode 属于另一套代码签名，当前尚未配置，不能把更新已签名表述为 Windows 安装包已获认证。</p><div class="callout">程序更新与壁纸内容更新分别维护仓库、清单、版本和安装逻辑。自动下载只针对新版程序安装包；壁纸仍需用户逐张选择下载，不会自动拉取整个内容库。</div>'},
    {id:'release', title:'Windows 安装包与 GitHub CI 发布', html:
      '<p>程序仓库为 <a href="https://github.com/whoarei/wallpaper-box">whoarei/wallpaper-box</a>，本次程序版本为 <code>0.4.0</code>。Windows x64 NSIS 安装版包含两张壁纸、使用说明和本离线 HTML；不包含旧 Docker 展示服务，也不再生成便携包。</p>' +
      table(['产物','用途'],[
        ['<code>wallpaper-box_0.4.0_x64-setup.exe</code>','当前用户安装；缺少 WebView2 时下载 Microsoft 运行时'],
        ['<code>wallpaper-box_0.4.0_x64-setup.exe.sig</code>','安装包的 minisign / Ed25519 更新签名，绑定本版安装包'],
        ['<code>latest.json</code>','供客户端发现新版本，包含官方安装包地址和更新签名'],
        ['<code>release-manifest.json</code>','schema 3，installerFiles 记录安装载荷的逐文件大小 / SHA-256'],
        ['<code>SHA256SUMS.txt</code>','安装包、签名、更新清单和载荷清单的外层 SHA-256']
      ]) +
      '<h3>本地构建与产物核对</h3><p>需要 Windows x64、PowerShell 7、Rust 1.95.0、Visual Studio C++ Build Tools、Windows SDK、Node.js 24。Tauri CLI 固定为 2.12.4，npm / Cargo 均使用锁文件；核对 NSIS 文件需要 7-Zip。</p>' +
      code(String.raw`Set-Location wallpaper-host
npm ci --ignore-scripts
npm run check:version
npm run bundle
./scripts/package-release.ps1 -RequireSigned
./scripts/verify-release.ps1 -Directory ../release/v0.4.0 -RequireSigned
node scripts/verify-installer.mjs ../release/v0.4.0`) +
      '<p>构建环境另需提供更新签名密钥。<code>package-release.ps1</code> 生成上述五项发布产物；<code>verify-release.ps1</code> 核对版本、官方地址、外层大小和 SHA-256、更新签名与清单。<code>verify-installer.mjs</code> 通过 7-Zip 读取 NSIS 载荷，与 schema 3 的 <code>installerFiles</code> 逐项核对；不再依赖便携 ZIP。校验禁止 portable.flag、用户壁纸、设置、缓存、私钥与编译产物入包。默认 7-Zip 路径为 <code>C:\\Program Files\\7-Zip\\7z.exe</code>，可作为脚本第二个参数覆盖。</p>' +
      '<h3>CI 与程序发布</h3><p><code>.github/workflows/windows.yml</code> 在 main、PR 和手动触发时构建并上传 Actions Artifact；版本标签 <code>vX.Y.Z</code> 进入发布流程。CI 使用固定 Action 提交、工具链与锁文件，执行版本、JavaScript、Rust 格式和测试检查，再构建并签署 NSIS 更新包。发布任务使用 GitHub 自动提供的 GITHUB_TOKEN，先创建草稿、上传五个产物并回下载校验，成功后公开 Release；失败保留草稿，已发布版本不直接覆盖。</p>' +
      code('git tag v0.4.0\ngit push origin v0.4.0\ngh run list --repo whoarei/wallpaper-box --workflow windows.yml') +
      '<p>发布前同步 Cargo.toml、tauri.conf.json、package.json、package-lock.json 与随包 README，并准备 <code>.github/release-notes/v0.4.0.md</code>。签名私钥保存在工作区外，发布环境通过 GitHub Secret 提供，更新公钥随程序内置。发布使用项目内 wallpaper-box-release skill，逐项核对版本文件、锁文件、随包说明和发布标签；推送标签前取得用户对具体目标版本及发布行为的明确确认。标签动作应在本地验证、产物复核和验收记录检查之后执行。主程序升级和壁纸库发布使用不同仓库、标签及版本号。</p><div class="callout amber">当前未配置 Windows Authenticode 签名。本次技术方案描述 0.4.0 的实现及验收范围；本地构建、真实跨版本安装和新版本 GitHub CI 结果须分别记录，未执行的步骤不记为通过。</div>'},
    {id:'layout', title:'目录布局与内容归属', html:
      code(String.raw`desktop/
├─ wallpapers/                       主程序随包快照（两张）
│  ├─ aquarium/                      index.html、module.json、封面
│  └─ pinewind-town/
├─ wallpaper-host/
│  ├─ ui/                            嵌入式管理界面
│  ├─ src-tauri/src/                  本地库、协议、更新、桌面宿主
│  ├─ resources/README.txt            随包使用说明
│  └─ scripts/                       签名更新包、清单 / NSIS 校验
├─ display-service/                  Legacy 浏览器开发示例
│  ├─ docs/architecture-source.cjs    本文可编辑内容源
│  ├─ docs/architecture.spec.json     渲染器输入
│  └─ public/docs/architecture.html   本文单文件输出
└─ .github/workflows/windows.yml      主程序构建与发布`) +
      '<h3>安装与用户数据目录</h3>' + table(['位置','规则'],[
        ['安装目录资源','<code>wallpaper-box.exe</code>、<code>wallpapers/</code>、<code>docs/architecture.html</code>、<code>README.txt</code>'],
        ['用户壁纸根','<code>%LOCALAPPDATA%/WallpaperBox/wallpapers</code>，安装升级保留'],
        ['设置 / WebView 数据','继续保留在 <code>%APPDATA%/local.screen-garden.wallpaper</code>，沿用每屏选择与暂停状态']
      ]) +
      code(String.raw`<用户壁纸根>/
├─ local/<folder-slug>/              手动放置或导入的自定义模块
├─ online/<official-id>/
│  ├─ active.json                    current / previous 活动指针
│  ├─ 1.0.0/                         已安装版本完整文件
│  └─ 1.1.0/
├─ .downloads/                       下载暂存
└─ .imports/                         导入 / 解压暂存`) +
      '<p>内置目录是发布快照，程序更新可替换它。新增内容放在用户目录，避免改动安装目录。不要将已有 UserData、缓存、个人设置或私密文件复制进主程序资源目录和发布包。</p>'},
    {id:'module-contract', title:'模块接入规范', html:
      '<h3>最小自定义模块</h3>' + code('local/\n  my-scene/\n    index.html') +
      '<p>直接将文件夹放入用户 <code>local/</code>，或使用“导入文件夹 / 导入 ZIP”。不提供元数据时，默认入口为 index.html、名称为文件夹名、版本为 1.0.0。所有图片、脚本和样式应使用相对路径，保证离线播放。</p><h3>完整 module.json</h3>' +
      code(JSON.stringify({schemaVersion:1,id:'my-scene',type:'web',name:'我的风景',subtitle:'MY SCENE',description:'一张可离线播放的动态场景。',version:'1.0.0',minAppVersion:'0.2.0',entry:'index.html',cover:'cover.jpg',tags:['风景','动画'],order:30,enabled:true},null,2)) +
      table(['字段','规则'],[
        ['schemaVersion / type','当前为 <code>1</code> / <code>web</code>'],
        ['id / 文件夹名','小写字母、数字、连字符，1～64 字符，首字符为字母或数字；拒绝 Windows 设备保留名'],
        ['name / subtitle / description','名称与副标题最多各 80 字符，描述最多 300 字符'],
        ['version / minAppVersion','语义化版本；当前程序必须满足最低版本要求'],
        ['entry','目录内存在的相对 HTML 路径，默认 index.html'],
        ['cover','可选相对封面路径；未指定时寻找约定的 cover 文件；无封面仍可显示卡片'],
        ['tags / order / enabled','最多 8 个标签、每个 30 字符；order 为整数，默认 100；enabled 默认 true'],
        ['module.json','UTF-8 JSON 对象，不超过 64 KiB；不支持注释或末尾逗号']
      ]) +
      '<p>自定义内容统一使用 <code>local:&lt;folder-slug&gt;</code> 作为运行 ID；即使 module.json 写了与官方相同的 id，也不会覆盖内置或官方模块。官方 ZIP 的 id、版本、最低程序版本与入口必须和清单一致。</p><div class="callout amber">路径必须位于当前模块内；禁止绝对路径、反斜杠、冒号、百分号二次解码、点段、设备名等不安全形式。坏模块被单独跳过并给出警告，其他壁纸仍可使用。</div>'},
    {id:'discovery', title:'原生目录发现与优先级', html:
      '<ol><li>扫描随包 <code>wallpapers/</code>，建立内置壁纸基线。</li><li>读取用户 <code>online/&lt;id&gt;/active.json</code>；活动版本有效时，以同 ID 的已下载版本覆盖内置快照。</li><li>扫描用户 <code>local/</code>，以 <code>local:&lt;slug&gt;</code> 独立加入自定义壁纸。</li><li>逐模块验证元数据、版本兼容性、入口及目录边界，按 order 和 ID 排序。</li><li>管理界面显示合并后的“我的壁纸”与警告；维护扫描或“刷新”按钮重新发现目录变化。</li></ol><p>内置、官方、自定义三种来源共用同一显示链路。官方活动指针可回到 <code>builtin</code>，此时同 ID 使用随程序提供的快照。自定义 ID 与官方 ID 隔离。新增或更新内容不改变 Tauri 资源映射，也不需要重新安装程序。</p><p>自动发现更新目录列表，不承诺对运行中的任意网页源文件热替换。修改正在播放的 HTML / JS 后，可重新应用该壁纸；复制大模块时建议先在 local 之外完成，再一次移入，避免被扫描到半成品。</p>'},
    {id:'online-updates', title:'GitHub 在线壁纸库与安全安装', html:
      '<p>官方仓库为 <a href="https://github.com/whoarei/wallpapers">whoarei/wallpapers</a>，稳定清单入口为 <a href="https://github.com/whoarei/wallpapers/releases/latest/download/catalog.json">releases/latest/download/catalog.json</a>。客户端匿名读取公开 Release，无需 GitHub 登录或个人令牌。</p><h3>用户操作与下载边界</h3><ol><li>打开“发现”即刷新清单，也可点击“刷新壁纸库”重试。程序只请求清单并显示封面、可安装版本和更新状态。</li><li>用户选择某一张壁纸的“下载 / 更新”，程序才下载该条目的一个版本 ZIP；不会自动安装全库。</li><li>校验 ZIP 大小和 SHA-256，在用户暂存目录内受限解压；再核对元数据、入口和兼容性。</li><li>将完整版本写入 <code>online/&lt;id&gt;/&lt;version&gt;/</code>，原子替换 active.json 的活动指针。</li><li>保留上一活动版本，提供回退；安装和播放不要求持续联网。</li></ol>' +
      code(JSON.stringify({current:'1.1.0',previous:'1.0.0'},null,2)) +
      '<p><code>previous</code> 也可以是 <code>builtin</code>，用于回到内置快照。回退交换 current 与 previous；更新失败不得把不完整目录设为活动版本。下载与导入路径检查拒绝链接、越界、大小写重名、设备名和非法 ZIP 路径，并限制文件数量及解压大小。</p><p>断网时可继续播放现有壁纸；最近可用清单缓存在原 AppData 设置目录的 online-catalog.json。SHA-256 用于比对发布清单和下载文件的一致性，内容仍由官方仓库维护；程序将管理能力限制在管理窗口，自定义壁纸窗口没有下载或文件管理权限。</p>' +
      '<h3>官方库独立发布</h3><p>维护流程见 <a href="https://github.com/whoarei/wallpapers#readme">壁纸仓库 README</a>：新增 <code>wallpapers/&lt;id&gt;/</code> 和完整元数据，修改内容时提升该壁纸版本，独立提升 library.json 的清单版本，运行 <code>python scripts/build.py</code>，检查后提交并推送 <code>library-vX.Y.Z</code> 标签。内容 CI 生成每张 ZIP、封面、catalog.json 和校验文件，公开 Release 后稳定入口指向新清单。</p><p>主程序 0.4.0 内置仍为原来的两张壁纸。“通往别处的窗户”由内容仓库独立提供，用户检查后单项下载和离线应用；它不需要加入 EXE 或重新发布主程序。程序升级器的自动下载策略不适用于壁纸库。</p>'},
    {id:'interfaces', title:'本地协议与权限边界', html:
      table(['接口 / 位置','行为'],[
        ['管理窗口 IPC','仅 manager 窗口可调用；Tauri 命令 ACL 与宿主窗口标签检查同时限制'],
        ['<code>feed_aquarium</code>','管理窗口或原生托盘操作当前显示器；校验 aquarium 分配与手动暂停，并确认页面回执'],
        ['<code>http://wallpaper.localhost/&lt;id&gt;/&lt;relative&gt;</code>','Tauri 内部协议映射；读取已发现模块中的静态资源'],
        ['资源请求方法','GET / HEAD；支持单个字节范围请求；不提供写入接口'],
        ['管理窗口资源作用域','允许读取模块封面等已发现资源'],
        ['每屏壁纸资源作用域','仅允许读取该窗口被分配的壁纸 ID，跨模块请求被拒绝'],
        ['路径与响应','一次百分号解码、规范化目录边界检查、MIME、no-store、CSP 与 nosniff'],
        ['程序升级管理','仅管理窗口可检查和确认安装；壁纸页面不具备升级能力'],
        ['旧 <code>/api/modules</code>','仅属于 Legacy 浏览器示例，桌面主程序不再调用']
      ]) +
      '<p>管理窗口可以选择目录、导入、更新与切换壁纸；壁纸页面只负责显示自身内容。协议处理器对实际文件做规范化边界检查，拒绝跨壁纸目录读取；未知窗口标签不给予默认全库权限。完整单文件响应上限为 64 MiB，单次范围响应上限为 8 MiB，避免无界读取。</p><p>这些能力隔离避免壁纸脚本调用主程序管理命令。自定义壁纸本身仍是用户导入的网页内容，应按其来源选择；本协议不提供任意系统文件访问或模块后端进程启动。</p>'},
    {id:'deployment', title:'安装、离线使用与日常维护', html:
      '<ol><li>从 <a href="https://github.com/whoarei/wallpaper-box/releases">主程序 Releases</a> 下载 Windows x64 NSIS 安装包。</li><li>安装后运行 EXE。0.2.x 用户需先手动安装一次 0.4.0，才能使用后续程序在线升级。</li><li>首次在主屏查看水族箱，然后按需选择显示器和壁纸。已有 WebView2 时，两张内置壁纸无需网络。</li><li>新增自定义内容时在“设置”中打开壁纸文件夹，将完整模块放入 local；也可点击“导入壁纸”选择文件夹或 ZIP。</li><li>需要新官方内容时进入“发现”，刷新清单后逐张下载；回到“我的壁纸”点击封面应用。</li></ol>' +
      table(['改动','需要的操作'],[
        ['新增 local 文件夹','保存完整目录，点击“刷新”或等待维护扫描'],
        ['修改 module.json','保持字段与路径有效，刷新目录'],
        ['修改正在播放的 HTML / JS','重新应用该壁纸，使 WebView 载入新内容'],
        ['官方壁纸更新','检查更新，点击该壁纸更新；可回退上一活动版本'],
        ['升级主程序','后台下载验签后，点击“重启并升级”并确认；用户壁纸与 AppData 设置保留'],
        ['只更新壁纸库','在内容仓库发布新清单与包；无需重新构建主程序']
      ]) +
      '<p>联网检查与下载需要能访问官方 GitHub Release；失败时仍可使用本地内容和当前程序。没有 WebView2 的机器首次安装运行时仍需联网或事先准备运行时。原 Docker 容器可按需保留用于浏览器开发，正常播放不需要它们运行。</p>'},
    {id:'migration', title:'从 Docker 版迁移与状态兼容', html:
      '<p>旧展示服务位于 <code>display-service/</code>，作为 Legacy 浏览器开发示例保留。本地优先版本使用根目录 <code>wallpapers/aquarium</code> 和 <code>wallpapers/pinewind-town</code> 两张快照打包，不再从 8088 获取模块或启动 Compose。</p><p>既有自定义网页可从旧 <code>display-service/modules/&lt;slug&gt;</code> 复制到用户 <code>local/&lt;slug&gt;</code>，或通过“导入文件夹”接入；检查相对资源路径和元数据后刷新。旧目录里的其他模块不会未经选择自动导入。</p><p>应用标识不变，原显示器选择、壁纸 ID 与手动暂停设置继续沿用；原两张壁纸 ID 保持 aquarium / pinewind-town。自定义内容使用 local: 前缀，需要在管理界面选择对应模块。0.2.x 没有程序在线升级能力，安装一次 0.4.0 后才启用后续签名更新流程；便携版迁移和便携升级不在本次范围内。</p><div class="callout amber">网页 localStorage 按来源隔离。旧 <code>http://127.0.0.1:8088</code> 与新的 wallpaper.localhost 来源不同，种花记录、页面内设置等不保证自动迁移；需要时应为具体壁纸单独增加导出 / 导入。保留宿主 settings.json 不代表网页存储全部兼容。</div>'},
    {id:'verification', title:'验收与回归检查', html:
      '<p>以下是 0.4.0 的验收范围，最终执行结果应随发版记录补齐。测试清单列出预期行为，不代表所有真实设备场景已经验证；本文不声称新版本 CI 或真实跨版本安装已经成功。</p>' +
      table(['范围','必须确认的行为'],[
        ['离线与资源','Docker 停止且网络不可用时，两张内置壁纸可打开、切换和重启恢复'],
        ['本地发现','添加 local 模块、坏元数据隔离、同名自定义模块不会覆盖内置'],
        ['路径与权限','拒绝穿越 / 二次解码 / 设备名；壁纸不能读取其他模块或调用管理 IPC'],
        ['在线更新','检查不下全库；单项下载通过大小 / SHA-256；失败保留旧活动版本'],
        ['版本与回退','官方更新覆盖同 ID 内置；回退上一版本与 builtin；重启后继续生效'],
        ['全新在线壁纸','内容库独立发布新模块后，主程序不重编即可发现、单项下载、应用'],
        ['自动检查调度','每次启动一次；持续运行本地日期改变时一次；失败不在当天后台循环重试'],
        ['程序后台下载','发现新版立即下载与验签；壁纸继续播放，失败保留当前程序'],
        ['签名与版本绑定','公钥校验通过才 ready；拒绝篡改、错误密钥、错误版本及非官方地址'],
        ['确认安装','ready 不自行退出；取消继续运行，确认“重启并升级”才启动安装'],
        ['跨版本保留','真实安装升级后已下载壁纸、自定义内容、每屏选择与暂停状态保留，结果须单独记录'],
        ['导入','文件夹与 ZIP、可选一层包装目录、危险压缩路径和超限包拒绝'],
        ['水族箱投喂','管理窗口 / 托盘入口、按点击坐标投喂、pointer / mouse 事件顺序、焦点保持、暂停和饱食处理、真实鱼群进食'],
        ['桌面点击过滤','短点击识别；拖拽后回原点仍取消；修饰键、其他按键和超时取消；负坐标、多 DPI 坐标换算；原生桌面图标 / 菜单命中须实机验证'],
        ['桌面与显示器','真实主屏效果、托盘、暂停、退出恢复、多屏 / DPI / 断连和 Explorer 恢复；健康双屏层级连续检查不重排，异常层级一次修复后稳定'],
        ['发布包','五项产物、schema 3 installerFiles、NSIS 载荷一致，无 portable.flag / 用户数据 / 私钥'],
        ['文档','10 套配色、刷新恢复、无脚本阅读、移动布局、打印配色与离线打开']
      ]) +
      code(String.raw`# Rust 行为测试（与发布一致的特性）
cargo test --locked --release --features custom-protocol --manifest-path wallpaper-host/src-tauri/Cargo.toml

# 生成技术文档
node display-service/docs/architecture-source.cjs
node <rtd-html-docs>/scripts/render.mjs --input display-service/docs/architecture.spec.json --output display-service/public/docs/architecture.html --force`) +
      '<p>管理界面的模拟 IPC 检查执行 <code>npm --prefix wallpaper-host run test:ui</code>，覆盖按需下载、更新 / 回退、错误保留及投喂入口；<code>npm --prefix wallpaper-host run test:aquarium</code> 使用真实内置水族箱页面和虚拟时钟，检查食物增加、鱼群进食、按钮与坐标点击、暂停和饱食逻辑。手势判定与坐标边界由 Rust 测试覆盖；Explorer / UIA 命中和原始鼠标操作仍须实机验证。测试项目及真实设备执行结果以验证记录为准，不将计划项计为通过。</p><div class="callout"><strong>2026-11-11 本地修复验证：</strong>22 项 Rust 测试、6 项真实水族箱回归和 13 项管理界面检查通过。本机主屏 3840 × 2160、副屏 2560 × 1600（位于主屏左侧），均为 150% 缩放；用户确认空白水面可投喂、桌面图标和框选正常。宿主回执记录每次新增 7 粒鱼食及对应点击位置。混合 DPI 与其他 Explorer 版本尚未实机验证；此前点击投喂验证针对 0.3.1 发布代码，云端构建与产物校验结果以对应 GitHub Actions / Release 为准。</div><p>文档浏览器验证使用 RTD 技能附带 verify.mjs 与已有 Playwright / Edge 环境，报告和截图放在临时目录，不打入发布包。旧 Node registry 测试仍可用于 Legacy 示例，不能代替新原生目录、协议与在线安装测试。</p>'},
    {id:'troubleshooting', title:'排查、扩展与参考', html:
      table(['现象','检查方向'],[
        ['壁纸列表为空或模块消失','查看管理界面警告；确认用户目录、合法名称、入口、JSON 与 minAppVersion'],
        ['内置可用但在线检查失败','检查网络和 GitHub Release；已有内容可继续离线播放'],
        ['ZIP 校验或安装失败','保留现有版本，重新下载；检查清单 SHA-256、大小、元数据和路径'],
        ['自定义壁纸与官方同名','运行 ID 使用 local: 前缀，在“我的壁纸”中选择对应来源'],
        ['更改网页后仍是旧画面','刷新目录后重新应用壁纸；自动发现不等于网页热替换'],
        ['程序自动检查失败','确认 GitHub 网络；当天不会后台反复重试，可手动检查或等待下一天 / 下次启动'],
        ['下载好了但没有安装','ready 只提示，点击“重启并升级”并确认后才安装'],
        ['更新签名或版本不符','不安装该包，保留当前程序；检查公钥、发布版本和官方清单'],
        ['屏幕或桌面层异常','查看 diagnostics.json / host.log；确认 Explorer、WebView2 和显示器状态'],
        ['种花等页面状态丢失','检查旧 / 新网页来源差异；宿主设置与网页 localStorage 是两类数据'],
        ['桌面点击不能投喂','确认点击桌面空白处、未按修饰键且没有拖动，壁纸未手动暂停；查看 host.log 的监听启动和 Desktop click 回执及 diagnostics.json 的 desktop_clicks；也可使用管理窗口 / 托盘投喂'],
        ['E 键不能投喂','宿主不接收全局键盘输入；E 键仅用于浏览器独立页面，桌面可直接点击空白水面'],
        ['投喂入口不见或禁用','确认选中显示器正在播放 aquarium；手动暂停时先继续，加载中或饱食时按提示稍后重试']
      ]) +
      '<h3>后续扩展</h3><p>普通网页壁纸通过 module.json 与内容目录扩展，不要求特殊 SDK。新增宿主能力、权限或新的模块类型需要主程序升级；纯内容和既有 web 模块的更新通过内容库独立发布。若要把本地目录分享为浏览器网站，可继续参考 Legacy Compose 示例，但它与桌面运行链路独立。</p><h3>实现参考</h3><ul><li><a href="https://github.com/whoarei/wallpaper-box">壁纸盒子源码与程序 Release</a></li><li><a href="https://github.com/whoarei/wallpapers#readme">官方壁纸库规范与发布流程</a></li><li><a href="https://v2.tauri.app/learn/system-tray/">Tauri 系统托盘</a>与<a href="https://v2.tauri.app/security/capabilities/">能力与权限</a></li><li><a href="https://v2.tauri.app/distribute/windows-installer/">Tauri Windows Installer</a></li><li><a href="https://learn.microsoft.com/en-us/windows/win32/shell/ishelldispatch4-toggledesktop">Windows Shell ToggleDesktop</a></li></ul>'}
  ],
  footer: 'Wallpaper Box 0.4.0 · 本地壁纸与签名安装版升级'
};

fs.writeFileSync(path.join(__dirname, 'architecture.spec.json'), JSON.stringify(spec, null, 2) + '\n');
console.log('Generated docs/architecture.spec.json');
