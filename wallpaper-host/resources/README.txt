壁纸盒子 0.1.0 · Windows x64

首次使用
1. 安装并启动 Docker Desktop，使用 Linux 容器。
2. 运行 wallpaper-box.exe。
3. 若提示“内容服务未连接”，点击“启动内容服务”。首次启动需要下载镜像。
4. 选择显示器，再选择松风镇或静水之间水族箱。

安装版和便携版都附带 display-service 目录，包含 Docker 配置和两个壁纸模块。
请保留完整目录。安装程序会在缺少 WebView2 时下载 Microsoft 官方运行时。

新增壁纸
将 HTML / CSS / JavaScript 模块放入正在运行的展示服务对应的 display-service/modules/<模块名>/。
首次使用随包服务时为安装或解压目录；已运行的 8088 服务会被复用，原模块目录继续生效。
入口为 index.html，可选 module.json。首页和托盘自动更新模块列表。
内容服务启动后访问 http://127.0.0.1:8088/。
技术文档位于 display-service/public/docs/architecture.html，也可离线打开。

托盘操作
左键打开管理界面；右键选择显示器、切换壁纸、暂停、继续或退出。
关闭管理窗口会收起到托盘。“退出壁纸盒子”结束程序并恢复原桌面。

设置保存在 %APPDATA%/local.screen-garden.wallpaper/，与早期便携版兼容。
退出壁纸程序不会停止共享的 Docker 内容服务。

项目：https://github.com/whoarei/wallpaper-box
发布：https://github.com/whoarei/wallpaper-box/releases

首版范围：Windows x64；需要 Docker Desktop 和 WebView2。
安装包未作 Authenticode 签名；暂未提供自动更新或开机启动。
