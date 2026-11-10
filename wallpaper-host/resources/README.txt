壁纸盒子 0.2.1 · Windows x64

首次使用
1. 安装程序或完整解压便携 ZIP，运行 wallpaper-box.exe。
2. 内置松风镇与静水之间水族箱，选择显示器后即可设为桌面背景。
3. 不需要 Docker、Node.js、Nginx 或本机 HTTP 服务，断网也可播放已安装壁纸。
4. 程序仍需要 WebView2；安装版会在缺少它时下载 Microsoft 官方运行时。

水族箱投喂
选择正在播放水族箱的显示器，点击管理窗口或托盘右键菜单中的“投喂鱼儿”。
入口只在该屏幕使用水族箱时显示；手动暂停时请先继续播放。
遮挡自动暂停时仍可投喂，回到桌面后鱼儿会继续游动进食。
加载未完成、页面自身暂停或鱼食还没吃完时，程序会提示原因。
壁纸模式鼠标穿透，原点击水面 / E 键投喂仅在浏览器独立页面使用。
程序不安装鼠标或键盘全局钩子，也不注册投喂全局快捷键。
本次修复在宿主中复用原投喂逻辑，无需更新壁纸库；两张内置壁纸仍为 1.0.0，最低程序版本仍为 0.2.0。

在线壁纸
官方壁纸仓库：https://github.com/whoarei/wallpapers
程序中的在线壁纸入口可检查、下载、安装和更新壁纸，无需 GitHub 登录。
下载包会核对大小与 SHA-256，并在临时目录完成资源检查后才切换版本。
下载或安装失败不会覆盖正在使用的旧版本。已安装壁纸可断网播放，并可回退上一版本。
更新壁纸只需内容仓库发布新版本，不必重新安装壁纸盒子程序。

自定义壁纸
可导入壁纸文件夹或 ZIP，也可打开用户壁纸目录，把模块放入 local/<模块名>/。
最小模块只需 index.html；可选 module.json、cover.jpg，以及相对路径的 JS / CSS / 图片 / 字体资源。
目录变化后列表和托盘自动更新，自定义内容不会覆盖内置壁纸。

壁纸目录
内置：程序目录下 wallpapers/，随程序升级。
安装版用户壁纸：%LOCALAPPDATA%/WallpaperBox/wallpapers/
便携版用户壁纸：程序旁 UserData/wallpapers/，由 portable.flag 标识便携模式。
local/ 保存自定义模块，online/ 保存下载的独立版本及激活记录。
升级时保留用户壁纸目录；便携版请保留 UserData/ 和完整的程序资源目录。

托盘操作
左键打开管理界面；右键选择显示器、切换壁纸、投喂水族箱、暂停、继续或退出。
关闭管理窗口会收起到托盘。“退出壁纸盒子”结束程序并恢复原桌面。
显示器选择、壁纸选择与暂停设置继续保存在 %APPDATA%/local.screen-garden.wallpaper/。

技术方案：docs/architecture.html，可离线打开。
程序仓库：https://github.com/whoarei/wallpaper-box
安装包发布：https://github.com/whoarei/wallpaper-box/releases

本版本支持 Windows x64；安装包未作 Authenticode 签名，暂未包含程序本体自动更新或开机启动。
