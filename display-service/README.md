# 壁纸盒子：模块化展示服务

> Legacy 浏览器开发示例：壁纸盒子 0.2.0 已改用 Tauri 原生目录发现与本地协议，运行无需 Docker，安装包也不再包含此服务。日常使用、用户壁纸目录与在线更新请看[主项目 README](../README.md)及[最新 HTML 技术方案](public/docs/architecture.html)。本目录继续保留原浏览器展示服务供开发参考，以下命令只适用于该示例。

- 首页：http://127.0.0.1:8088/
- 松风镇：http://127.0.0.1:8088/pinewind-town/
- 技术方案（HTML）：[public/docs/architecture.html](public/docs/architecture.html)
- 在线技术方案：http://127.0.0.1:8088/docs/architecture.html
- 模块目录接口：http://127.0.0.1:8088/api/modules

## 添加模块：只放文件夹

```text
modules/
  my-scene/
    index.html
    module.json    可选
    cover.webp     可选
    assets/        可选
```

保存后即可访问 `http://127.0.0.1:8088/my-scene/`。打开的首页每 5 秒自动发现变化，重新聚焦时也会更新；不用改首页、Compose 或 Nginx，不用重建或重启容器。

没有 `module.json` 时，名称使用文件夹名，入口使用 `index.html`。需要自定义时：

```json
{
  "name": "我的风景",
  "subtitle": "MY SCENE",
  "description": "一小片自己的世界。",
  "entry": "index.html",
  "cover": "cover.webp",
  "tags": ["慢生活"],
  "order": 20,
  "enabled": true
}
```

文件夹名使用 1～64 个小写字母、数字、连字符，首字符为字母或数字。保留名为 `api`、`assets`、`docs`、`healthz`。入口和封面使用模块内的相对路径，CSS、JS、图片等资源也建议使用相对路径。

不指定封面时，会依次寻找 `cover.webp`、`cover.jpg`、`cover.png`、`cover.svg`；都没有时显示默认封面。`order` 越小越靠前。`enabled: false` 仅从首页隐藏，原 URL 仍能访问。

移出或删除模块文件夹后，首页会自动移除该入口。JSON 损坏或入口不存在时，目录接口 `warnings` 给出原因，其他模块继续正常显示。复制大型模块可先使用点开头的暂存目录，复制完成后再重命名。

## 服务与文件

```text
display-service/
  compose.yaml                Docker Compose：web + registry
  nginx.conf / site.conf      通用静态路由与接口代理
  registry/server.cjs         无第三方依赖的 Node.js 目录扫描服务
  modules/                    所有展示模块，整目录只读挂载
    pinewind-town/            已迁移的松风镇
  public/                     首页、assets、HTML 技术文档
  routes/                     可选反向代理配置
  docs/                       技术方案内容源
  tests/                      逻辑、在线服务和浏览器验证
```

只发布 `127.0.0.1:8088`；目录服务只在 Docker 内部访问。模块和配置保存在宿主机，镜像使用摘要固定。松风镇原地址、HTML 内容和 8088 来源下的浏览器种花记录保持兼容；旧 47831 来源下的浏览器记录不会自动迁移。

## 管理

在本目录执行：

```powershell
docker compose up -d --wait
docker compose ps
docker compose logs --tail 50 web registry
docker compose stop
```

Docker Desktop 需运行。`restart: unless-stopped` 会在引擎启动后恢复未被手动停止的服务；手动停止后运行 `up -d --wait` 恢复。

- 模块内容或元数据：保存即可；模块页面源码变化后刷新该页面。
- 首页 HTML / CSS / JS：刷新首页。
- `registry/server.cjs`：`docker compose restart registry`。
- Nginx 配置：先 `docker compose exec web nginx -t`，成功后 `docker compose exec web nginx -s reload`。
- Compose、镜像或挂载：`docker compose up -d --wait`。

新增独立后端仍需启动后端服务，并按需设置 `routes/*.conf`。示例见 `routes/local-app.conf.example`。容器访问 Windows 宿主机应用使用 `host.docker.internal`，应用需能从 Docker 网络访问并支持配置的 URL 前缀。

## 验证

```powershell
node --test tests/registry.test.cjs
node tests/verify-running.cjs
# 使用现有 Playwright 和浏览器做前端验证
node tests/gallery.browser.cjs '<Playwright 模块绝对路径>' '<浏览器 exe 绝对路径>'
```

在线验收会临时添加并移除测试模块，检查元数据更新、错误隔离和移除；同时确认容器 ID 和启动时间未变化。浏览器验收检查新卡片自动出现/移除、元数据按文本渲染及桌面/手机布局。

HTML 技术方案使用 RTD 文档技能生成，内容源为 `docs/architecture-source.cjs`。先运行该文件生成 `architecture.spec.json`，再用技能的 `render.mjs` 渲染到 `public/docs/architecture.html`。文档自带目录、10 套配色、离线阅读和打印 / 保存 PDF。
