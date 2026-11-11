---
name: wallpaper-box-release
description: "准备或发布 whoarei/wallpaper-box 主程序的新版本时使用。核对版本、测试、签名与产物，在用户明确确认目标版本后推送标签并跟踪 GitHub Release。适用于发布、发版、创建发布标签、出安装包或整理发版步骤等请求。"
---

# 壁纸盒子主程序发布

在仓库根目录执行。先读 `README.md` 的“本地构建与核对”“主程序发布”、`.github/workflows/windows.yml` 和 `.github/scripts/publish-release.ps1`，以当前文件为准。

本 skill 用于 `whoarei/wallpaper-box` 的 Windows x64 主程序。`whoarei/wallpapers` 的内容库使用另一套版本与 `library-vX.Y.Z` 标签，不在这里发布。仅整理 skill、修改代码或制作原型不触发发布。

## 必须确认发布版本

推送发布标签、运行标签发布工作流、上传 Release 产物或公开 Release 前，必须有用户对本次**具体目标版本及发布行为**的明确确认。

- 不把仓库当前版本、README 示例、现有最大标签或自动推算的下一个版本直接当作发布目标。
- 可以根据变更提出候选版本，并先完成可逆的版本同步、发布说明和检查，供用户审阅。候选版本不构成发布授权。
- 提问前，完成已获授权且不依赖确认的准备工作，展示检查结果、待发布改动和目标提交，让用户确认一个具体结果。
- 普通的“发布一下”“继续”“按惯例发版”，以及默认选项、跳过问题或等待超时，都不能代替具体版本确认。
- 用户在本次流程已明确说“确认发布 vX.Y.Z”，或明确指定“发布 vX.Y.Z”，且版本与发布范围未变化，可复用这次确认，不重复索取。仅说“考虑用 vX.Y.Z”不算确认。
- 目标版本、仓库或本次发布内容发生实质变化，重新说明变化并确认；确认不沿用到另一次发布。

没有明确确认时，使用包含实际值的问题，例如：

> 当前最新正式版为 vA，本地版本为 vB；拟发布 vC，标签为 vC，目标提交为 `<SHA>`。变更为……，检查结果为……。确认发布 vC 吗？推送标签后，Windows CI 全部通过会自动公开 GitHub Release。

不要保留上例中的占位符，也不要把提问本身当作用户的答复。等待期间继续完成独立检查；不执行依赖确认的发布操作。

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

## 2. 同步并复核版本

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

更新根 README 和随包说明中描述当前版本的文字。历史迁移说明、依赖版本、壁纸模块版本及 `minAppVersion` 各有含义，不能全局替换。保持依赖锁定，不借发版升级无关依赖。

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
2. 展示目标版本、完整提交 SHA、变更摘要、通过/失败/未运行的检查和已知限制。按前面的版本确认规则取得或复用明确确认。
3. 确认后再次核对目标提交、版本文件、远端标签和 Release 状态。目标提交应与已审阅结果一致；存在版本冲突或状态未知时，先解决再继续。
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

最终报告确认的版本、标签、目标提交、工作流结果、真实 Release 链接、产物验证和剩余限制。只有核实已公开，才说“发布成功”；否则准确说明目前处于准备、等待确认、构建中、草稿或失败状态。
