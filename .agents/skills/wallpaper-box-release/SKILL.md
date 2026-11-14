---
name: wallpaper-box-release
description: "准备或发布 whoarei/wallpaper-box 主程序的新版本时使用。先列出相对最新正式版的更新点和版本推荐理由，再将更新摘要放入版本选择问题中，提供三个实际版本选项；用户选择后再同步版本、提交、构建并发布。适用于发布、发版、创建发布标签、出安装包或整理发版步骤等请求。"
---

# 壁纸盒子主程序发布

在仓库根目录执行。先读 `README.md`、`docs/guide.md` 的“本地构建与核对”“主程序发布”、`.github/workflows/windows.yml` 和 `.github/scripts/publish-release.ps1`，以当前文件为准。

本 skill 用于 `whoarei/wallpaper-box` 的 Windows x64 主程序。`whoarei/wallpapers` 的内容库使用另一套版本与 `library-vX.Y.Z` 标签，不在这里发布。仅整理 skill、修改代码或制作原型不触发发布。

发布目标仅为 GitHub。Gitee 已永久停止源码、分支、标签、Release 和附件同步；
不执行补传、镜像修复或同步脚本，不派发、重跑或恢复历史 Gitee 工作流，
不将 Gitee 状态作为发布完成条件。向 `whoarei/wallpapers` 同步协议文档仍只推送 GitHub，
不延伸到 Gitee。Gitee 已有内容及客户端仓库读取能力按原状保留。

## 先展示修改点，再选择版本

用户未指定本次具体版本时，先完成已授权且不依赖版本选择的工作：检查代码与远端状态、汇总相对最新公开正式版的修改点、完成有关检查。按以下顺序展示信息，再弹出**三个实际版本号**供用户选择，推荐项排第一：

1. 说明当前最新正式版，以及本地或远端 main 与它的差异。
2. 单独列出“本次更新”清单，每条描述一个用户可见的新增、调整或修复。如涉及默认行为或兼容性变化，明确说明实际影响；有多少实际更新就列多少，不凑条目。不能只列提交标题、代码文件名、构建步骤，或笼统地说“新增功能”“内容不变”。
3. 依据上述更新点解释推荐补丁、次版本或主版本的理由，再给出实际推荐版本。
4. 最后调用版本选择工具；选择问题本身必须包含当前正式版、同一份更新点摘要和推荐理由，使用户只看选择界面就能判断版本。不要依赖可能被折叠的进度消息，也不要先弹出版本选择器，再补充更新说明。

每次需要重新选择版本时也遵循此顺序，包括 CI 失败、标签占用或发布范围变化后的重新选择。摘要仍以最新公开正式版为基准，列出本次尚未发布的完整更新，并补充这次新增的修复；不能只写失败原因或“功能范围不变”。同版本、同范围的例行重试沿用已有授权，不为展示摘要而重复询问。

候选以**最新公开的稳定 Release** `x.y.z` 为基准：

| 类型 | 候选版本 | 推荐依据 |
| --- | --- | --- |
| 补丁 | `x.y.(z+1)` | 修复问题或小幅调整 |
| 次版本 | `x.(y+1).0` | 新增向后兼容的功能 |
| 主版本 | `(x+1).0.0` | 不兼容变更或用户决定的大版本里程碑 |

- 选项必须填写计算后的实际值。推荐项标注“推荐”，其余两个候选紧随其后；每项最多一句简短说明。不要先要求用户手写版本号或特定确认口令。
- 优先使用可用的选项交互工具收集版本偏好。将当前正式版、逐条更新摘要和推荐理由放在工具的问题正文中，最后询问“本次发布使用哪个版本号？”。工具的选项只列三个版本，不另加“确认发布”“取消”或“其他”选项。界面自带的自由输入可用于指定另一个具体版本。
- 例如，最新正式版为 `0.4.0`，本次新增并行下载时，展示修改点后给出 `0.5.0（推荐）`、`0.4.1`、`1.0.0`。这只是规则示例，执行时必须重新核对真实版本。
- 候选须高于最新正式版，并核对远端标签是否占用。不把仓库当前版本、README 示例或提前写入 main 的未确认版本当作候选基准；本地、远端 main 与公开版本不一致时简短说明。
- 用户已经要求发布时，其**主动提交的具体版本选择**与已有发布指令共同构成本次明确授权。选中推荐项、选中另外一项或自由输入具体版本均有效；提交选择后直接继续，不再追加一次“确认发布吗”。若用户仅讨论版本或修改 skill，版本选择本身不授权发布。
- 预选推荐项、跳过问题、没有答复、等待超时，以及没有对应到明确选项的“继续”，均不算用户提交了版本选择。
- 用户已明确指定本次“发布 vX.Y.Z”时直接复用，不再弹出选项。仅说“考虑用 vX.Y.Z”不算已选定。

版本选择问题的示例（所有值必须以本次实际核对结果替换）：

> 当前正式版：v0.6.0。
>
> 本次更新：
> - 新增代理设置，默认跟随系统，支持手动代理和直连。
> - 支持自定义多个壁纸仓库并独立启停，默认仅启用 Gitee。
> - 关闭仓库后保留已下载壁纸，升级沿用显示器和播放设置。
>
> 推荐 v0.7.0：本次新增向后兼容的功能，适合次版本。
>
> 本次发布使用哪个版本号？选择后将构建、签名并公开 GitHub Release。

对应选项为 `0.7.0（推荐）`、`0.6.1`、`1.0.0`。示例不构成当前版本建议或发布授权。

**版本选择必须早于版本修改。** 用户作出具体选择前，不得写入候选版本、创建该版本的发布说明、提交或推送含候选版本的发版改动、启动该版本的安装包构建、推送发布标签、上传产物或公开 Release。已单独授权的功能实现、普通代码提交及不改版本的检查可以继续，不能夹带未确认的版本。不要为了先拿到发版提交 SHA，提前写入版本并推送 main。

用户选择后，再同步版本并生成实际发版提交。例行的版本同步、发布说明和同范围构建修复不要求再次选择；只有目标版本、仓库或发布内容发生实质变化时才重新选择。这次授权不沿用到另一次发布。

## 1. 查明当前状态

1. 检查 `git status --short`、当前分支、完整 HEAD、暂存区与未提交改动；保留已有用户改动。使用现有 checkout，不另建 worktree，除非用户明确要求。
2. 核对 origin 确为 `github.com/whoarei/wallpaper-box`，读取远端标签和 GitHub 最新正式 Release。区分本地版本、远端标签、草稿和已公开版本；访问失败时不能把未知当作“尚未发布”。
3. 复用已有 HTTPS Git 代理和 GitHub CLI 凭据。只查看凭据名称和配置状态，不输出值。Git 读取成功不等于拥有 GitHub API 或发布权限；仅在实际所需操作受阻时请求补齐权限。
4. 汇总相对上一个正式版的变更，提出或核对发布版本。当前流水线只支持无前导零的稳定三段版本 `X.Y.Z`，标签为 `vX.Y.Z`；不要擅自用预发布标签或降级版本。
5. 目标版本须高于最新正式版。已有公开 Release 不得覆盖；已有标签须核对其提交。失败 CI 或现有草稿只能在版本、目标提交和授权均一致时恢复，不强推或移动标签。

可用的只读命令（GitHub CLI 命令显式指定仓库）：

```sh
git status --short
git rev-parse --verify HEAD
git ls-remote --tags origin
gh release list --repo whoarei/wallpaper-box --limit 20
gh release view --repo whoarei/wallpaper-box --json tagName,isDraft,isPrerelease,url
```

## 2. 用户选择后，同步并复核版本

仅在已取得或复用本次具体版本选择与发布授权后执行本节；尚未选择时，先按上面的三个版本选项收集偏好。

下列“当前程序版本”必须与目标版本一致：

| 文件 | 核对位置 |
| --- | --- |
| `wallpaper-host/src-tauri/Cargo.toml` | `[package].version` |
| `wallpaper-host/src-tauri/Cargo.lock` | 本项目 `screen-garden` 包的版本，不是锁文件格式版本 |
| `wallpaper-host/src-tauri/tauri.conf.json` | 顶层 `version` |
| `wallpaper-host/package.json` | 顶层 `version` |
| `wallpaper-host/package-lock.json` | 顶层 `version` 和 `packages[""].version` |
| `wallpaper-host/resources/README.txt` | 首行的当前程序版本 |
| `wallpaper-host/ui/index.html` | `#version` 的初始版本占位（若仍为固定文本） |
| `.github/release-notes/vX.Y.Z.md` | 文件名、标题与本次说明 |

更新根 README、`docs/guide.md` 和随包说明中描述当前版本的文字。历史迁移说明、依赖版本、壁纸模块版本及 `minAppVersion` 各有含义，不能全局替换。保持依赖锁定，不借发版升级无关依赖。

运行 `npm --prefix wallpaper-host run check:version`。该脚本目前只核对部分清单，**通过不代替上表逐项核对**。同时审阅 diff，确保发布说明描述实际完成的功能，并如实标注未运行的设备验收。

## 3. 检查与构建

本地按当前 CI 和 README 执行有关检查：

```sh
npm --prefix wallpaper-host run check:version
node --check wallpaper-host/ui/app.js
node --test wallpaper-host/scripts/release.test.mjs
node --test display-service/tests/registry.test.cjs
npm --prefix wallpaper-host run test:ui
npm --prefix wallpaper-host run test:aquarium
cargo fmt --check --manifest-path wallpaper-host/src-tauri/Cargo.toml
```

遵循项目固定的 Node、Rust 和 Tauri 版本。使用已有依赖；需要重装时遵循锁文件，保持 TLS、完整性校验与签名验证开启。

Linux 的浏览器检查可以通过 `EDGE_PATH` 指定已验证的 Chromium。它们不能代替 Windows 原生窗口、WebView2 与桌面设备验收。

Windows CI 还会构建 NSIS 安装包并执行：

```sh
cargo test --locked --release --features custom-protocol --manifest-path wallpaper-host/src-tauri/Cargo.toml
```

在缺少 Windows 的环境中，区分本地通过、CI 待执行和设备未验收。推送标签触发的 Windows 检查必须全部成功，不能绕过失败的构建或测试公开发布。main、PR 或在分支上手动运行工作流只产出 Actions Artifact；它们本身不是正式发布。

签名复用 GitHub Actions 的 `TAURI_SIGNING_PRIVATE_KEY` 和相应密码配置；本地签名用工作区之外的密钥路径。不得把私钥写入仓库、skill、聊天或日志，也不能为通过检查而更换内置公钥或省略签名。

## 4. 确认后触发发布

1. 完成版本同步、发布说明与有关检查，审阅本次发布文件并准备目标提交。不能把未提交的改动算入标签内容；不得用 `git add .` 混入无关用户文件。
2. 报告已选择的目标版本、完整提交 SHA、变更摘要、通过/失败/未运行的检查和已知限制。版本已选择且范围未变化时直接继续，不再追加文字确认。
3. 再次核对目标提交、版本文件、远端标签和 Release 状态。目标提交应与已选择的版本和范围一致；存在版本冲突或状态未知时，先解决再继续。
4. 将确切目标提交推送到已核对的远端，创建并推送指向该提交的 `vX.Y.Z` 标签。命令必须使用本次确认的实际版本；禁止强推、删除或移动已有发布标签。
5. 标签推送会触发 `.github/workflows/windows.yml` 的 build 和 publish 作业。它将先创建草稿，上传并回下载校验，随后自动公开；用户的确认必须覆盖这一行为。
6. 用 `gh run list` 找到该标签且对应目标 SHA 的工作流运行，再用 `gh run view` / `gh run watch` 跟踪。不能把另一个分支、旧提交或旧运行成功当作本次成功。

通常使用现有 CI，不额外手动上传。确需本地发布时，必须在 Windows 完成 `npm run bundle`（工作目录 `wallpaper-host`），用 `package-release.ps1 -RequireSigned` 生成产物，再通过 `verify-release.ps1 -RequireSigned`、`verify-installer.mjs` 核对，最后复用 `.github/scripts/publish-release.ps1`。该脚本会公开 Release，仍受版本确认约束。

## 5. 核对发布结果

预期五个文件，所有版本、签名、清单和 SHA-256 必须对应同一个安装包：

- `wallpaper-box_X.Y.Z_x64-setup.exe`
- `wallpaper-box_X.Y.Z_x64-setup.exe.sig`
- `latest.json`
- `release-manifest.json`
- `SHA256SUMS.txt`

核对对应 CI 的 build/publish 均成功，Release 已公开，标签指向目标 SHA，五项资产齐全，`latest.json` 的版本、Windows x64 下载 URL 和签名正确。复用现有验证脚本，不以页面存在、工作流已排队或本地检查通过代替发布成功。

失败时读对应运行的日志，修复具体问题，保留草稿和既有公开版本；不要盲目重发标签或绕过签名校验。

最终报告选择的版本、标签、目标提交、工作流结果、真实 Release 链接、产物验证和剩余限制。只有核实已公开，才说“发布成功”；否则准确说明目前处于准备、等待选择版本、构建中、草稿或失败状态。main 构建成功应报告为“分支构建通过”，不能称为“新版本已发布”。
