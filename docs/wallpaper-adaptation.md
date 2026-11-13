# 壁纸适配规范

把一个好用的网页，变成一张好用的桌面壁纸。

页面保持独立，按运行能力适配，业务逻辑留在壁纸里。

- 面向 **网页壁纸开发者**
- 基础运行时协议 **v1 · v0.10.0 起支持**
- 基础支持宿主 **v0.10.0+**
- 更新 **2026.11.13**

面向使用 HTML、CSS、JavaScript 开发网页壁纸的作者。只做基本播放与点击，可先看第 02—06 节；要在主程序中增加操作或设置页，再看第 07 节。示例与文档均可离线使用。

## 目录

- [01 先记住这三条](#01-先记住这三条)
- [02 准备一个能离线运行的目录](#02-准备一个能离线运行的目录)
- [03 识别自己运行在哪里](#03-识别自己运行在哪里)
- [04 让控制栏在桌面上也好用](#04-让控制栏在桌面上也好用)
- [05 接收点击与移动](#05-接收点击与移动)
- [06 处理暂停，避免后台继续忙](#06-处理暂停避免后台继续忙)
- [07 可选：操作与壁纸设置](#07-可选操作与壁纸设置)
- [08 完整示例：复制后就能打开](#08-完整示例复制后就能打开)
- [09 旧壁纸怎么兼容，内容怎么更新](#09-旧壁纸怎么兼容内容怎么更新)
- [10 交付前，按这张清单检查](#10-交付前按这张清单检查)
- [11 常见问题，先从这里查](#11-常见问题先从这里查)
- [12 版本状态与参考来源](#12-版本状态与参考来源)
- [壁纸设置接口](#可选壁纸设置通信)

## 01 先记住这三条

适用对象：使用 HTML、CSS、JavaScript 开发网页壁纸的作者。宿主指“壁纸盒子”主程序。

### 01 / 普通网页优先：先在浏览器里运行

不安装 SDK 也能播放。没有宿主接口时，场景、按钮和页面交互仍可用。

### 02 / 界面由壁纸负责：控件怎么显示，你决定

宿主不按壁纸名称、DOM ID 或 CSS 类名隐藏、修改你的界面。

### 03 / 按能力提供功能：桌面不等于浏览器

桌面模式保留鼠标穿透，不能依赖键盘焦点、原生悬停和浏览器用户激活。

> **主程序从 v0.10.0 起提供 v1**
>
> 基础规范对应 **v0.10.0 起**的通用宿主接口、状态事件与操作调用实现。v0.9.0 及更早版本尚不提供这些公开接口。[壁纸设置通信](#可选壁纸设置通信)是 v0.12.0 起提供的可选扩展，v0.11.0 及更早版本尚不支持；不能仅凭 protocolVersion 为 1 就调用设置接口。下面的基础播放示例仍可在普通浏览器中独立运行。

只想做好页面播放和桌面点击，阅读第 02—06 节即可；希望在主程序或托盘里显示“投喂”“召唤”等按钮，或提供壁纸自己的设置页，再阅读第 07 节。第 08 节提供可直接复制的完整示例。

| 谁来做 | 负责什么 | 不应做什么 |
| --- | --- | --- |
| 壁纸盒子（宿主） | 创建窗口、告知运行环境、转发有效输入、暂停与恢复、调用壁纸声明的操作；支持设置扩展时保存、读取与分发配置。 | 识别某张壁纸的内部变量，查找它的按钮，替它修改样式和说明。 |
| 你的壁纸 | 绘制场景、控制栏、帮助文案、昼夜天气等业务逻辑，以及对运行环境的适配。 | 假定自己总能获得键盘焦点，或需要宿主为自己的 DOM 写一段专用代码。 |
| 可选操作接口 | 让主程序展示壁纸主动声明的功能，调用统一入口并读取结果。 | 根据壁纸 ID 写 `if / else`，或把操作 ID 当作系统权限。 |

## 02 准备一个能离线运行的目录

HTML、脚本、样式和素材放在一起，使用相对路径。先保证断网后也能打开。

**目录结构**

```text
meadow/
├─ index.html        页面入口
├─ module.json       壁纸信息
├─ cover.jpg         列表封面
├─ scene.js          可选：场景逻辑
├─ scene.css         可选：样式
├─ settings.html     可选：自定义设置页，需 v0.12.0+ 宿主
└─ assets/           可选：图片、字体、音频等素材
```

### 填写 module.json

以下沿用现有 `schemaVersion: 1` 的格式，不为本规范新增未实现的清单字段。自定义本地壁纸可省略清单；准备分发时建议完整填写，官方内容包需满足内容库要求。

**JSON · 基础网页示例**

```json
{
  "schemaVersion": 1,
  "id": "meadow",
  "type": "web",
  "name": "林间微光",
  "description": "点击空白处，点亮一束星光。",
  "entry": "index.html",
  "cover": "cover.jpg",
  "version": "1.0.0",
  "minAppVersion": "0.2.0",
  "tags": ["自然", "点击互动"]
}
```

| 字段 / 项目 | 怎么填写 |
| --- | --- |
| id | 使用小写字母、数字、连字符，长度不超过 64，首字符为字母或数字；避开 Windows 保留名。此处示例为 `meadow`。本地导入后的运行 ID 可能带 `local:` 前缀，不要在网页内按运行 ID 分支。 |
| entry / cover | 相对于壁纸目录的文件路径，例如 `index.html`、`assets/cover.jpg`。不使用绝对路径、反斜杠或 `../`。 |
| settings.entry | 设置扩展的可选字段，指向包内独立 HTML 页面，例如 `settings.html`；格式与资源路径规则见[设置通信约定](#可选壁纸设置通信)。普通壁纸可以省略，v0.11.0 及更早版本尚不读取此字段。 |
| version | 这张壁纸的内容版本。改动 HTML、脚本或素材后更新版本，不覆盖已发布的同版本包。 |
| minAppVersion | 能满足该包实际需求的最低主程序版本。上例只表示普通网页，不承诺 v1 接口；强依赖新接口的包必须填写正式提供该接口的主程序版本。 |
| 依赖与资源 | 核心素材、脚本和字体随包提供，不依赖 CDN 才能显示；不包含机器本地路径、密钥和可执行后端。网络增强功能失败时仍保留基本场景。 |

> **两个版本号不要混淆**
>
> `module.json.schemaVersion` 是文件清单格式，`protocolVersion` 是运行时接口格式。本文的 v1 接口不会自动改变清单格式，也不表示某个尚未确定的主程序发行版本已经支持它。

## 03 识别自己运行在哪里

先识别环境，再决定显示哪些入口；不通过壁纸名称或页面地址猜测。

| 运行环境 | 页面应如何工作 | 能力来源 |
| --- | --- | --- |
| 桌面壁纸 desktop | 鼠标穿透、不抢焦点。提供可点击的页面按钮；隐藏不可用的网页全屏及键盘提示。 | v1 使用宿主提供的能力；旧宿主仅有模式标识时采取保守降级。 |
| 应用内预览 preview | 普通窗口内展示壁纸；键盘仅在窗口聚焦时可用。预览不修改当前桌面分配。 | v1 预览提供环境信息，但不接入桌面管理操作或宿主暂停。 |
| 独立浏览器 browser | 没有壁纸盒子接口也能运行。普通鼠标、聚焦后的键盘和浏览器允许的全屏可用。 | 壁纸自行使用浏览器能力检测，不能访问宿主专用接口。 |

### 推荐的环境检测写法

**v1 运行时接口**

把初始化放在 DOM 就绪后执行；兼容旧宿主时，也能避免过早读取尚未设置的模式标识。完整示例已经包含这个等待。

**javascript**

```javascript
const host = window.wallpaperHost?.protocolVersion === 1
  ? window.wallpaperHost
  : null;

// 现有宿主已经设置的旧模式标识。它不代表 v1 已经就绪。
const legacyDesktop = !host &&
  document.documentElement.dataset.screenGardenWallpaper === "true";

const mode = host?.mode ?? (legacyDesktop ? "desktop" : "browser");
const capabilities = host?.capabilities ?? {
  pointer: legacyDesktop ? "relayed" : "native",
  pointerMove: !legacyDesktop,   // 旧标识不能证明有移动转发能力
  keyboard: !legacyDesktop,
  fullscreen: !legacyDesktop && Boolean(document.fullscreenEnabled),
  pause: false,                 // 不代表旧宿主不会冻结 RAF，只是没有 v1 状态接口
  actions: false,
  settings: false               // 设置是可选扩展，旧 v1 宿主也可能没有
};

document.documentElement.dataset.sceneMode = mode; // 壁纸自己的样式标识
document.querySelector(".fullscreen-button").hidden = !capabilities.fullscreen;
```

> **兼容旧版本时，宁可少承诺一点**
>
> 没有 v1 对象时不调用新接口。只有旧桌面标识时，不承诺键盘、全屏或完整暂停状态；不能确认鼠标移动可用时，建议让控制栏保持可见。v1 之前的宿主仍可能强制覆盖页面样式，单靠此检测不能消除旧宿主的干预。

### 参考：v1 宿主对象与设置扩展（供接入时查阅）

对象由宿主在壁纸脚本执行前提供，字段只读。每次页面导航获得新的 `instanceId`；普通窗口 resize 不更换实例。预览不注入桌面输入，也不冻结预览的 RAF；支持设置扩展时，也会提供相同壁纸的配置快照和变更事件。

**javascript**

```javascript
// v1 · 仅展示宿主注入的对象结构，壁纸不要自行覆盖它。
window.wallpaperHost = {
  protocolVersion: 1,
  mode: "desktop",                  // 宿主仅提供 desktop 或 preview
  instanceId: "opaque-instance-id", // 不解析、不保存为用户配置
  capabilities: {
    pointer: "relayed",             // desktop: relayed；preview: native
    pointerMove: true,
    keyboard: false,
    fullscreen: false,
    pause: true,
    actions: true,
    settings: true                 // v0.12.0 起的可选扩展；旧 v1 宿主可能缺少此字段
  },
  getState() {
    return { paused: false, pauseReason: "none", locale: "en" };
  },
  getSettings() {                   // 仅支持设置扩展的宿主提供
    return {};                     // 配置对象本身，不含 revision 包装
  }
};
```

`getState()` 同步返回当前快照。桌面模式的键盘和全屏能力为 `false`；暂停和操作能力以实际字段为准。预览中的 `pause`、`actions` 为 `false`，其全屏能力还需结合浏览器权限。能力为 `false` 时，不以“接口碰巧存在”绕过它。设置扩展在桌面和预览中都可用，须同时检查 `capabilities.settings === true` 与 `typeof host.getSettings === "function"`；缺少任一条件就按默认配置运行。

只读对象用于防止误改，不能替代宿主的原生实例、来源和权限校验。旧的 `data-screen-garden-wallpaper` 标识保留作兼容；普通浏览器没有宿主对象，`browser` 是壁纸自身的回退值。

### 语言同步（v1 的可选扩展）

主程序将已解析的界面语言放入 `wallpaperHost.getState().locale`，当前值为 `zh-CN` 或 `en`。“跟随系统”的偏好不会原样传入壁纸。桌面与应用内预览都提供此字段；加载前注入初始值，切换后通过既有 `wallpaperhost:statechange` 事件发送包含语言、暂停状态和暂停原因的完整只读快照。语言变化不更换实例、不重载网页、不解除暂停，也不重放互动操作。

这是新增可选字段，`protocolVersion` 仍为 `1`。v1 的旧宿主可能没有 `locale`，旧壁纸也可以忽略新增字段；不按主程序版本号猜测能力。缺少字段或独立浏览器运行时，可回退到 `navigator.language`，再选取壁纸支持的语言。没有翻译时保留壁纸原文。主程序从 v0.11.0 起提供此可选扩展；旧版 v1 宿主不一定含有该字段。

**javascript · 壁纸自行管理文案**

```javascript
const host = window.wallpaperHost?.protocolVersion === 1 ? window.wallpaperHost : null;
const messages = {
  "zh-CN": { feed: "投喂鱼儿", paused: "画面已暂停，请先继续。" },
  en: { feed: "Feed fish", paused: "The scene is paused. Resume it first." }
};
let locale;
function syncLanguage() {
  const requested = host?.getState().locale ?? navigator.language;
  const next = /^zh(?:-|$)/i.test(requested) ? "zh-CN" : "en";
  if (next === locale) return;
  locale = next;
  document.documentElement.lang = locale;
  document.querySelector("#feed").textContent = messages[locale].feed;
  // 同步刷新 title、aria-label、提示、帮助与日期格式；不执行投喂等场景操作。
}
syncLanguage(); // 在 DOM 就绪后执行
window.addEventListener("wallpaperhost:statechange", syncLanguage);
// getActions() 每次查询时读取 messages[locale]，保持 id 不变。
// invoke() 返回的禁用原因和失败提示也使用当前语言。
```

主程序会重新读取操作描述，使管理窗口和托盘使用当前 `label` / `disabledReason`。壁纸只需监听公开事件，不调用或覆盖宿主的内部语言设置入口。仅适配语言不要求提供互动操作接口，`capabilities.actions === false` 的预览同样可以接收语言。

名称与说明可在 `module.json` 或在线清单的壁纸条目中增加可选 `locales`，例如 `"locales": { "en": { "name": "Meadow", "description": "A quiet meadow." } }`。支持 `name`、`subtitle`、`description`；未提供的字段回退到原值，ID 和包版本不随语言变化，清单 `schemaVersion` 仍为 1。该元数据只用于管理界面与托盘展示，壁纸内部文案仍由自己的脚本翻译。

## 04 让控制栏在桌面上也好用

控制栏属于你的页面。宿主不提供按钮选择器，也不要求固定类名。

以“林间微光”的天气控制为例，控制栏由壁纸决定；各模式的界面差异如下：

| 运行模式 | 网页全屏入口 | 开发要点 |
| --- | --- | --- |
| 桌面壁纸 | 隐藏 | 鼠标点击和移动可用；不依赖键盘、原生悬停或网页全屏。 |
| 应用内预览 | 按浏览器能力显示 | 普通窗口内可接收鼠标和聚焦后的键盘；全屏仍需浏览器允许。 |
| 独立浏览器 | 按浏览器能力显示 | 没有宿主接口，场景与页面按钮仍应正常工作。 |

- **操作入口可发现：**昼夜、天气、投喂等功能有可点击按钮，不能只提供快捷键；桌面模式的说明不写“按 F / H / 空格操作”。
- **自动淡出可以保留：**监听 `document` 的 `pointermove` 和 `pointerdown` 唤醒；帮助面板打开或键盘焦点在控制栏内时，不自动隐藏。
- **不要只靠悬停：**桌面合成的移动事件不会自动产生浏览器原生 `:hover`、`pointerenter`、`pointerleave` 或 `title` 提示。必要的标签直接展示，悬停效果由壁纸自己的事件逻辑实现。
- **按钮别误触场景：**把场景点击绑定在 canvas 或场景容器上，控制栏阻止冒泡；点“天气”不能同时在背景种花或投喂。
- **支持不同窗口：**使用响应式布局；不能假定固定 960 × 600、横屏或固定任务栏高度。宿主按工作区布局，壁纸通常不再重复减一次任务栏高度。
- **交互保持轻量：**桌面没有可靠的文本输入焦点；复杂表单、文件选择和配置功能不依赖直接在壁纸层输入。

**javascript**

```javascript
const controls = document.querySelector(".scene-controls");
let idleTimer;
let helpOpen = false; // 由你的帮助面板更新

function wakeControls() {
  controls.classList.remove("is-idle");
  clearTimeout(idleTimer);
  if (!capabilities.pointerMove) return; // 不确定能否唤醒，就不自动淡出
  idleTimer = setTimeout(() => {
    if (!helpOpen && !controls.contains(document.activeElement)) {
      controls.classList.add("is-idle");
    }
  }, 8500);
}

controls.addEventListener("click", event => event.stopPropagation());
document.addEventListener("pointermove", wakeControls, { passive: true });
document.addEventListener("pointerdown", wakeControls, { passive: true });
// helpOpen 由你的帮助面板维护；页面卸载时清理定时器与监听。
```

> **桌面图标优先**
>
> 宿主只转发桌面空白处的有效输入。控制栏上方覆盖了桌面图标、任务栏或其他窗口时，该位置不会穿透操作壁纸。这是输入边界，不应通过抢焦点或拦截 Explorer 来“修复”。

## 05 接收点击与移动

场景继续使用标准 DOM 事件，不需要调用内部的 __SCREEN_GARDEN_* 函数。

| 输入 | 开发者可以依赖的行为 | 需要避免的假设 |
| --- | --- | --- |
| 桌面短点击 | 有效左键短点击按 `pointerdown → mousedown → pointerup → mouseup → click` 顺序投递，命中页面对应元素并冒泡。 | 不要同时在 pointerdown 和 click 做同一次业务操作；不要因为 `isTrusted === false` 拒绝桌面交互。 |
| 桌面鼠标移动 | 通过空白区域检查后投递低频 `pointermove`，可用于唤醒控制栏。核对基线最多约 10 次 / 秒，并可能更少。 | 不保证逐像素移动，不适合依赖连续轨迹的画笔、拖动或精确悬停；鼠标移入图标或其他窗口后可能直接停止收到事件。 |
| 键盘 / 滚轮 / 拖动 / 右键 | 普通浏览器与预览按浏览器规则运行。v1 桌面输入不承诺转发这些事件。 | 不能只用键盘、滚轮或拖拽才能完成核心操作，也不能要求宿主安装全局键盘钩子。 |
| 浏览器用户激活 | 桌面投递的是合成事件，不产生真实的浏览器用户激活。 | 不能依赖它开启全屏、弹出文件选择器、播放受限制的声音或调用剪贴板；要有可用的降级入口。 |

### 坐标换算：使用事件位置和当前画布矩形

**javascript**

```javascript
canvas.addEventListener("click", event => {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;

  const u = (event.clientX - rect.left) / rect.width;
  const v = (event.clientY - rect.top) / rect.height;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return;

  // 仅适用于画面直接拉伸填满 canvas 的情况。
  const x = u * logicalWidth;
  const y = v * logicalHeight;
  handleSceneClick(x, y);
});
```

如果使用 `object-fit: cover`、留黑边、CSS 变换或相机缩放，还要按你的实际绘制变换做逆变换。不要把宿主物理像素、`screenX` 或固定的系统缩放比例直接当作场景坐标。

### 参考：宿主转发与输入边界

宿主负责排除桌面图标及文字、任务栏、菜单、其他窗口、拖动、长按和带 Ctrl / Shift / Alt 的点击；这些规则在原生层执行，不交给壁纸猜测。按下与松开必须属于同一有效区域和同一运行实例。

宿主内部使用归一化坐标 `0 ≤ u,v < 1`，再转换为页面坐标 `x = floor(u × innerWidth)`、`y = floor(v × innerHeight)`。负坐标显示器和 DPI 差异由宿主处理；页面只消费 DOM 事件。

点击的 `button` 为 0，按下阶段 `buttons` 为 1，松开与点击阶段为 0；移动事件 `buttons` 为 0。不要把桌面合成移动用于判断真实的鼠标按键状态。输入回执只说明事件是否投递，不能代表种花、投喂等业务已经成功。

## 06 处理暂停，避免后台继续忙

把“主程序暂停”和“页面自己的暂停”分开保存；恢复时不能互相覆盖。

- **主程序暂停**：例如用户手动暂停、窗口遮挡。通过 v1 状态接口读取。
- **页面自己的暂停**：用户在壁纸按钮里暂停画面，由壁纸保存。
- **实际停止条件**：任一暂停成立，场景就不推进。

**javascript**

```javascript
const host = window.wallpaperHost?.protocolVersion === 1
  ? window.wallpaperHost
  : null;
let userPaused = false;
let hostPaused = host?.getState().paused ?? false;
let lastFrame = performance.now();

window.addEventListener("wallpaperhost:statechange", () => {
  if (!host) return;
  hostPaused = host.getState().paused;
  lastFrame = performance.now(); // 恢复时重置时钟
});

function frame(now) {
  const dt = Math.min(Math.max((now - lastFrame) / 1000, 0), 0.1);
  lastFrame = now;
  if (!userPaused && !hostPaused) updateScene(dt);
  drawScene();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
// updateScene / drawScene 是你的场景函数。
```

- v1 的状态是 `{ paused, pauseReason }`，原因为 `none`、`manual`、`occluded` 或 `system`。桌面文档在载入阶段以 `paused: true / system` 开始，挂载与状态确认后再通知实际状态；预览始终没有宿主暂停。开发者先读快照，再监听变化。
- 宿主的 RAF 暂停包装不能自动暂停 `setInterval`、Worker、CSS 动画、视频或音频。壁纸应在状态变化时停止自己的持续工作，恢复时按原状态继续；不要恢复用户本来就暂停的声音或视频。
- 视频或音频恢复可能受浏览器策略限制；捕获 `play()` 的拒绝并展示可理解的状态，不假装已恢复播放。
- 非必须的计时任务采用合理频率；不要为轮询宿主能力增加高频定时器。窗口关闭、重新加载时清理资源。

### 参考：暂停状态事件的约定 v1 · v0.10.0 起支持

事件在 `window` 上触发，名称为 `wallpaperhost:statechange`，`event.detail` 为与 `getState()` 同结构的状态快照。宿主先更新内部状态，再发送事件；即使 RAF 已冻结，状态事件仍要送达。

多个原因同时存在时，v1 快照按 `manual → system → occluded → none` 的优先级报告。宿主恢复不能清除页面自己的暂停。页面也不能用派发同名 DOM 事件改变真实宿主状态。

不要调用或覆写 `window.__SCREEN_GARDEN_SET_PAUSED`，也不要把合成的 `visibilitychange` 当作完整的宿主暂停状态协议。旧宿主没有 v1 状态接口时，至少限制帧间时间差，防止恢复后场景突然快进。

## 07 可选：操作与壁纸设置

本节前半部分约定管理窗口或托盘中的“投喂”“召唤”等操作，后半部分约定[壁纸设置页与配置通信](#可选壁纸设置通信)。两项能力独立，页面里的按钮和桌面点击不依赖它们。

> **可选的 v1 操作接口**
>
> v0.10.0 起的主程序按本节发现并调用壁纸提供的操作。普通网页可以省略这一接口；v0.9.0 及更早版本不会因为页面添加了此对象就自动生成按钮，测试时需使用 v0.10.0 或更新版本。

你在页面里提供 `window.wallpaperApp`。主程序读取操作列表，按列表显示文字和可用状态；用户点击后，主程序调用统一入口。**“投喂能否成功”“是否饱食”由壁纸判断，宿主不再读取鱼食数量或点击你的某个 DOM 按钮。**

- **getActions()**：告诉主程序：有哪些操作、显示什么文字、现在能不能点。
- **invoke(request)**：执行指定操作，与页面按钮共用你的业务函数。
- **返回实际结果**：成功才返回 ok；不能执行时说明原因。

**javascript**

```javascript
// v1 · 结构示意；完整可运行写法见第 08 节。
window.wallpaperApp = {
  protocolVersion: 1,
  getActions() {
    return [{
      id: "burst",
      label: "点亮星光",
      enabled: true,
      allowWhenOccluded: false
    }];
  },
  invoke(request) {
    // 校验 request；调用页面按钮使用的同一个业务函数。
    // 根据真实执行结果返回，不能“收到请求就算成功”。
  }
};
```

v1 只支持**立即完成并同步返回 JSON 结果**的页面操作。不返回 Promise；不把网络请求、文件选择或系统设置混进这个接口。普通网页不实现它也能播放，主程序仅不展示这些额外按钮。

### 参考 A：操作描述、调用参数与返回值

| 入口 / 字段 | v1 约定 |
| --- | --- |
| protocolVersion | 固定为整数 `1`。不支持的协议版本视为没有可用操作。 |
| getActions() | 同步返回数组，最多 16 项。不得在查询时触发场景操作；在 DOMContentLoaded 时可用。尚未就绪时返回空数组。 |
| 操作 id | 每张壁纸内唯一且稳定，匹配 `^[a-z][a-z0-9-]{0,47}$`。它是普通业务名称，不是主程序权限名称。 |
| label / enabled | `label` 为 1—32 个 UTF-16 代码单元；`enabled` 为布尔值。操作名称按纯文本显示，不解析 HTML，也不依赖外部图片。 |
| disabledReason | 禁用时建议提供，最多 120 个 UTF-16 代码单元。比如“请先继续画面”或“先等鱼儿吃完”。 |
| allowWhenOccluded | 可选布尔值，默认 false。只有 true 且壁纸仍声明 enabled 时，才允许在仅因遮挡而暂停期间执行；手动或系统暂停时始终不允许。 |
| invoke(request) | 同步接收下面的调用对象，返回下面的结果对象。v1 操作接口不提供任意用户输入参数，也不接受代码字符串。 |

**JSON · 请求与结果**

```jsonc
// 宿主传给 invoke 的调用对象
{
  "protocolVersion": 1,
  "instanceId": "opaque-instance-id",
  "requestId": "opaque-request-id",
  "actionId": "burst"
}

// 成功：场景状态确实已改变
{
  "ok": true,
  "requestId": "opaque-request-id",
  "data": { "total": 12 }
}

// 失败：没有把操作当成成功
{
  "ok": false,
  "requestId": "opaque-request-id",
  "code": "PAUSED",
  "message": "画面已暂停，请先继续。"
}
```

`requestId`、`instanceId` 为非空字符串，长度不超过 128 个 UTF-16 代码单元。成功和失败结果都回传原 `requestId`。失败消息最多 512 个 UTF-16 代码单元；标签、原因和消息应为有效 Unicode，且不含 ASCII 控制字符。`data` 可省略，须能序列化为 JSON；单次操作列表和单次结果分别不超过 8 KiB UTF-8。字段长度统一按 JavaScript `string.length` 计算。

宿主将标签、原因和消息作为纯文本显示，不执行壁纸提供的 HTML 或代码。`data` 中的业务字段仅用于通用显示或诊断，不成为宿主按壁纸类型分支的依据。

### 参考 B：暂停、重复点击与结果不确定时怎么处理

- 宿主在打开菜单、切换屏幕以及调用前后重新读取操作列表；开放着的管理界面可随正常状态刷新更新按钮。v1 不要求壁纸建立主动跨进程通知通道。
- 宿主执行前复核当前实例、动作存在性、enabled 和暂停状态；壁纸执行时再次检查自己的条件。界面上的旧状态不能代替执行时的检查。
- 一次请求绑定发起时的屏幕和运行实例；切屏、换壁纸、重新加载后，不把旧请求或旧回执套到新的实例。
- 宿主为同一实例的操作串行调用，等待回执期间阻止重复提交；不会把选择新屏幕后的一次点击偷偷改投到旧屏幕。
- 壁纸保存当前页面最近 128 个有效请求的结果。同一个 requestId、同一个动作重复到达时返回缓存结果；同一个 requestId 换了动作时拒绝。主程序仍不得自动重试非幂等操作。
- 操作列表查询和动作回执的宿主等待上限均为 2 秒。超时或回执丢失时，操作可能已经发生；显示“结果未知”，不要当成成功，也不要自动再投喂一次。超时不代表网页代码已被取消。
- 调用抛错或返回格式错误时，如果无法确认是否已有副作用，也按结果未知处理；不能推断“肯定没有执行”。
- 允许遮挡期间执行的动作，应已完成内存中的真实状态更新；画面可在恢复后呈现。仍不能绕过页面自己的暂停、容量和冷却规则。

### 参考 C：建议使用的错误码

| 错误码 | 含义 / 页面或宿主的处理 |
| --- | --- |
| NOT_READY | 页面或业务数据还未准备好。暂不展示可点的操作，或提示稍后再试。 |
| UNSUPPORTED | 未接入该协议或不支持该能力。基本播放继续工作。 |
| UNKNOWN_ACTION | 动作不存在。刷新操作列表，不猜测替代按钮。 |
| DISABLED | 动作因容量、冷却等业务条件暂不可执行。 |
| PAUSED | 宿主规则或页面自身暂停不允许当前动作。 |
| INVALID_REQUEST | 参数、格式、重复请求内容或结果格式不符合约定。 |
| STALE_INSTANCE | 请求属于已经切换、关闭或重新加载的实例。 |
| BUSY | 该实例仍在处理上一次调用，不重复提交。 |
| FAILED | 已知执行失败，给出简短、可理解的原因。 |
| RESULT_UNKNOWN | 宿主等待超时或丢失回执，不能确认是否执行；不自动重试。 |

### 可选：壁纸设置通信

**v1 可选扩展 · v0.12.0 起**

> **协议版本与发行状态**
>
> 以下设置接口由 v0.12.0 起提供，v0.11.0 及更早版本尚不支持。扩展保持 `wallpaperHost.protocolVersion: 1` 和 `module.json.schemaVersion: 1`，以新增能力字段 `capabilities.settings` 区分；旧 v1 宿主不因此自动获得新能力。强依赖设置扩展的内容包应声明 minAppVersion 为 0.12.0 或更高版本。

设置页负责编辑，主程序负责保存和分发，播放页负责解释参数并更新画面。设置页写入与播放页读取的是同一份设备配置，按壁纸 ID 保存，多屏共享；不使用显示器 ID 或运行实例 ID 分开保存。

#### 1. 声明设置页与公开接口

在 module.json 中增加可选的 settings.entry，指向壁纸目录内独立且实际存在的 HTML 文件；不接受远程地址、越界路径或主播放入口。旧壁纸省略即可继续播放。设置页的业务字段和布局由壁纸作者决定。

**module.json · 增加此字段**

```json
{"settings": {"entry": "settings.html"}}
```

| 接口 | 调用位置 / 契约 |
| --- | --- |
| `wallpaperHost.getSettings()` | 播放页同步读取当前完整配置对象；首次为 `{}`，每次返回独立副本，不返回 revision 包装，也不保存配置。先检查设置能力和方法是否存在。 |
| `wallpaperhost:settingschange` | 播放页 window 上的事件，`detail = { revision, settings }`；settings 是完整配置。宿主先更新内部快照，再触发事件。修改事件参数不会写回设备配置。 |
| `wallpaperSettings.load()` | 设置页引入宿主 SDK 后异步调用，返回 `Promise<{ revision, settings, locale }>`；首次为 `{ revision: 0, settings: {}, locale }`。 |
| `wallpaperSettings.save(settings, expectedRevision)` | 设置页异步保存完整 JSON 对象，返回 `Promise<{ snapshot: { revision, settings }, running, pending, locale }>`。expectedRevision 必须取自最近一次 load 或成功 save；失败时 Promise 拒绝并给出 Error.message。 |

设置页位于隔离 iframe 中，允许脚本和表单事件，不能访问主程序 DOM、原生 IPC 或浏览器存储。内容安全策略禁止表单默认提交；页面应拦截 submit，再调用 SDK。使用普通 script 引入 `/__wallpaper_host__/settings.js`；该脚本由宿主提供，无需复制进壁纸包，独立浏览器或旧宿主不提供它。

**settings.html · 最小读写示例**

```html
<script src="/__wallpaper_host__/settings.js" defer></script>
<form id="settings-form">
  <label>光照 <select id="lighting"><option value="0">晨光</option><option value="1">暮色</option><option value="2">月光</option></select></label>
  <button id="save" disabled>保存更改</button>
</form>
<p id="status" role="status"></p>
<script>
window.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('settings-form');
  const lighting = document.getElementById('lighting');
  const save = document.getElementById('save');
  const status = document.getElementById('status');
  let revision = 0;
  let ready = false;
  // 先拦截原生提交；加载失败时也不能导航或误保存默认值。
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!ready || save.disabled) return;
    save.disabled = true;
    try {
      const result = await wallpaperSettings.save({ lighting: Number(lighting.value) }, revision);
      revision = result.snapshot.revision; // 下次保存必须使用新 revision
      status.textContent = result.pending ? '已保存，部分窗口将在就绪后同步。' :
        result.running ? '已保存，已通知正在运行的壁纸。' : '已保存，下次启动壁纸时生效。';
    } catch (error) {
      status.textContent = error.message; // 冲突时请用户重新加载，不覆盖别人的修改
    } finally {
      save.disabled = false;
    }
  });
  try {
    const snapshot = await wallpaperSettings.load();
    revision = snapshot.revision;
    const value = snapshot.settings.lighting;
    lighting.value = Number.isInteger(value) && value >= 0 && value <= 2 ? String(value) : '0';
    ready = true;
    save.disabled = false;
  } catch (error) {
    status.textContent = error.message;
  }
});
</script>
```

设置页 SDK 另提供只读 `wallpaperSettings.locale`（zh-CN 或 en），load/save 回执包含当前 locale。主程序语言变化时在设置页 window 上发送 `wallpapersettings:localechange`，detail 为 `{ locale }`。页面可据此更新文案，应保留未保存的表单值；locale 是主程序界面语言，不写入每张壁纸的配置，也不增加配置 revision。

#### 2. 保存、版本与分发规则

- [ ] settings 必须是 JSON 对象，序列化后的 UTF-8 大小不超过 32 KiB。save 替换完整配置，不做局部合并；未提供的字段由壁纸采用默认值。
- [ ] revision 是每张壁纸独立的非负安全整数，初始为 0，每次成功保存递增。expectedRevision 不匹配时拒绝保存；不能自行猜测、递增或在冲突后盲目覆盖。
- [ ] 主程序先将配置写入设备的 settings.json，成功后更新内存并通知对应窗口。保存失败时保留原配置，不通知壁纸应用失败的修改。
- [ ] running 是对应壁纸正在运行的桌面实例数量，不包含预览。pending 为 true 表示至少一个目标窗口暂时无法接收通知，配置已经保存。pending 为 false 也不等于所有壁纸已经完成业务处理，界面宜表述为“已保存、已通知”。
- [ ] 桌面和应用内预览在自身脚本执行前取得最新已保存配置；运行中接收 settingschange。暂停或遮挡不阻止配置投递，应用参数不能擅自恢复动画、音频或计时器。
- [ ] 未运行时仅保存最终配置，下次启动读取最新值，不积攒历史事件。相同或较旧的 revision 不重复触发变更事件；窗口换成另一张壁纸后，旧模块的更新不作用于新文档。
- [ ] 内容更新、版本回退和程序重启保留相同壁纸 ID 的配置。字段迁移、校验和安全默认值由壁纸负责；运行中的快捷操作不会自动写回配置。

**播放页 · 能力检测、首次读取与后续更新**

```javascript
const host = window.wallpaperHost?.protocolVersion === 1 ? window.wallpaperHost : null;
const supportsSettings = host?.capabilities?.settings === true &&
  typeof host.getSettings === 'function';

// applySettings 是壁纸自己的业务函数，负责校验字段、迁移与默认值。
if (supportsSettings) {
  window.addEventListener('wallpaperhost:settingschange', event => {
    applySettings(event.detail.settings);
  });
  applySettings(host.getSettings());
} else {
  applySettings({}); // 旧宿主和普通浏览器仍能按默认配置播放
}
```

页面不应直接调用 `__SCREEN_GARDEN_SET_SETTINGS`，也不能通过自行派发同名 DOM 事件改变主程序保存的配置。设置接口与 getActions/invoke 独立，不能用 actions 或 pause 能力代替 settings 检测。

#### 3. 设置页 SDK 的消息格式

页面作者通过 SDK 读写，无需自行维护 postMessage。排查互通问题时，可对照以下 v1 消息：channel 固定为 `wallpaper-settings-v1`，session 是本次 iframe 的不透明会话值，requestId 是 SDK 生成的 1—16 位十进制字符串，method 只接受 load 或 save；主程序按当前设置页绑定壁纸，子页面不能通过传入 moduleId 指定其他壁纸。

**JavaScript 对象 · 请求与回执**

```javascript
// load 请求
{ channel: 'wallpaper-settings-v1', session: 'opaque-session', requestId: '1', method: 'load' }
// save 请求：完整配置对象和最近一次读取/保存得到的 revision
{ channel: 'wallpaper-settings-v1', session: 'opaque-session', requestId: '2',
  method: 'save', settings: { lighting: 2 }, expectedRevision: 0 }
// load 成功回执
{ channel: 'wallpaper-settings-v1', session: 'opaque-session', requestId: '1', ok: true,
  result: { revision: 0, settings: {}, locale: 'zh-CN' } }
// save 成功回执
{ channel: 'wallpaper-settings-v1', session: 'opaque-session', requestId: '2', ok: true,
  result: { snapshot: { revision: 1, settings: { lighting: 2 } }, running: 2, pending: false, locale: 'zh-CN' } }
// 失败回执：SDK 将其转换为 rejected Promise / Error
{ channel: 'wallpaper-settings-v1', session: 'opaque-session', requestId: '2', ok: false,
  error: '配置已发生变化，请重新加载设置后再保存。' }
```

语言变化通知同样携带 channel 和 session，消息为 `{ channel, session, type: "localechange", locale }`；它不对应一次读写请求，因此没有 requestId。SDK 据此更新只读 locale 并触发 wallpapersettings:localechange，作者无需保存或回执。

宿主同时校验 iframe 的 Window 来源、隔离页面的 null origin 和 session，回执携带同一 requestId。向不透明来源发送消息需要 targetOrigin 为 `*`，但不能因此省略来源与会话校验。切换壁纸、重新加载设置页或内容包更新后，旧页面的消息和延迟回执失效；这不会撤回已经提交到主程序的保存，重新打开后应 load 确认。

#### 4. 错误与恢复

| 情况 | 页面处理 |
| --- | --- |
| 格式、大小或版本冲突 | 捕获 Error 并保留用户输入。版本冲突时提示重新加载最新配置，再由用户决定如何修改。 |
| 磁盘保存失败 | 显示失败原因，保留原有已保存配置；不要显示保存成功。 |
| 壁纸已移除、包已更新或设置页会话变化 | 重新打开设置页；不把旧页的请求或回执应用到新设置页。 |
| 请求并发或超时 | 同一设置页串行读写。宿主对并发请求返回忙碌，SDK 每次等待最多 15 秒。超时不取消已经提交的保存，可能已经写入；重新读取确认后再决定是否重试。 |
| 普通浏览器、旧宿主或未适配壁纸 | 播放页按默认配置运行；没有声明设置页时，主程序显示暂无自定义设置。SDK 应只在主程序提供的设置页环境中使用。 |

这些失败通过 SDK 的 rejected Promise / Error.message 表达，不套用前面的操作接口错误码。完整页面可参考内置壁纸的 settings.html；主程序不按壁纸名称定义光照、天气等业务字段。

## 08 完整示例：复制后就能打开

示例是一个纯本地网页：点击画面或按钮增加星光，支持暂停、响应式画布和可选的 v1 操作。

复制下方完整 HTML 源码并保存为 `index.html`，直接用浏览器打开即可。配合第 02 节的 `module.json` 可组成一个壁纸目录；正式分发前自行制作封面。

不联网、不加载第三方库。网页部分可直接运行；宿主对象和操作协议在支持 v1 的开发版本中可接入主程序。

### 完整 HTML 源码（含可选 v1 操作）

**HTML · 完整示例**

```html
<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>林间微光 · 最小适配示例</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#173c32;color:#f4f5df;font:14px/1.7 system-ui,sans-serif}
canvas{display:block;width:100%;height:100%}
.scene-controls{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);display:flex;gap:8px;padding:10px;border:1px solid #dcebc344;border-radius:12px;background:#16372de8;transition:opacity .3s}
.scene-controls.is-idle{opacity:0;pointer-events:none}
button{font:inherit;white-space:nowrap;color:inherit;background:#ffffff12;border:0;border-radius:6px;padding:8px 12px;cursor:pointer}
button:focus-visible{outline:2px solid #e1eab5;outline-offset:3px}
button[hidden]{display:none}
.scene-status{position:fixed;top:20px;left:24px;right:24px;font-size:12px;color:#d4e4c7}
@media(max-width:480px){.scene-controls{bottom:16px;gap:5px;padding:8px}button{font-size:12px;padding:8px 9px}}
@media(prefers-reduced-motion:reduce){.scene-controls{transition:none}}
</style>
<canvas id="scene" aria-label="点击画面点亮星光"></canvas>
<div class="scene-status" role="status" aria-live="polite">点击画面点亮星光。</div>
<nav class="scene-controls" aria-label="画面控制">
  <button id="burst" type="button">点亮星光</button>
  <button id="pause" type="button">暂停画面</button>
  <button class="fullscreen-button" type="button">全屏</button>
</nav>
<script>
(() => {
  function startScene() {
  const root = document.documentElement;
  const host = window.wallpaperHost?.protocolVersion === 1 ? window.wallpaperHost : null;
  const legacy = !host && root.dataset.screenGardenWallpaper === "true";
  const mode = host?.mode ?? (legacy ? "desktop" : "browser");
  const caps = host?.capabilities ?? {
    pointer: legacy ? "relayed" : "native",
    pointerMove: !legacy, keyboard: !legacy,
    fullscreen: !legacy && Boolean(document.fullscreenEnabled),
    pause: false, actions: false
  };
  root.dataset.sceneMode = mode;
  const canvas = document.getElementById("scene"), ctx = canvas.getContext("2d");
  const controls = document.querySelector(".scene-controls");
  const status = document.querySelector(".scene-status");
  const fullscreen = document.querySelector(".fullscreen-button");
  fullscreen.hidden = !caps.fullscreen;
  status.textContent = mode === "desktop"
    ? "点击桌面空白处点亮星光；移动鼠标可唤回控制栏。"
    : "点击画面点亮星光；也可以使用下方按钮。";
  if (mode === "desktop" && !caps.pointerMove) {
    status.textContent = "点击桌面空白处点亮星光；当前保持控制栏可见。";
  }
  let width = 1, height = 1, time = 0, total = 0, userPaused = false;
  let hostPaused = host?.getState().paused ?? false;
  let last = performance.now(), wakeAt = last;
  const dots = [], replies = new Map();
  function canAct() { return !userPaused && !hostPaused; }
  function draw() {
    ctx.fillStyle = "#173c32"; ctx.fillRect(0,0,width,height);
    for (const dot of dots) {
      ctx.globalAlpha = .55 + .4 * Math.sin(time * 1.4 + dot.phase);
      ctx.fillStyle = "#e3ecb7";
      ctx.fillRect(dot.u * width, dot.v * height, 4, 4);
    }
    ctx.globalAlpha = 1;
  }
  function resize() {
    const rect = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1,2);
    width = Math.max(1,rect.width); height = Math.max(1,rect.height);
    canvas.width = Math.floor(width * dpr); canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0); draw();
  }
  function wake() { wakeAt = performance.now(); controls.classList.remove("is-idle"); }
  function burst(u = .5,v = .5) {
    if (!canAct()) return false;
    dots.push({u,v,phase:Math.random() * Math.PI * 2});
    if (dots.length > 100) dots.shift();
    total++; status.textContent = "已点亮 " + total + " 束星光。"; draw();
    return true;
  }
  controls.addEventListener("click",event => event.stopPropagation());
  document.getElementById("burst").onclick = () => burst();
  document.getElementById("pause").onclick = event => {
    userPaused = !userPaused; last = performance.now();
    event.currentTarget.textContent = userPaused ? "继续画面" : "暂停画面"; wake();
  };
  fullscreen.onclick = async () => {
    if (!caps.fullscreen) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.requestFullscreen();
    } catch { status.textContent = "当前环境不允许网页全屏。"; }
  };
  canvas.addEventListener("click",event => {
    const r = canvas.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = (event.clientX-r.left)/r.width, v = (event.clientY-r.top)/r.height;
    if (u >= 0 && u < 1 && v >= 0 && v < 1) burst(u,v);
  });
  document.addEventListener("pointermove",wake,{passive:true});
  document.addEventListener("pointerdown",wake,{passive:true});
  window.addEventListener("resize",resize);
  window.addEventListener("wallpaperhost:statechange",() => {
    if (!host) return;
    hostPaused = host.getState().paused; last = performance.now();
  });
  function frame(now) {
    const dt = Math.min(Math.max((now-last)/1000,0),.1); last = now;
    if (canAct()) { time += dt; draw(); }
    if (caps.pointerMove && now-wakeAt > 8500 && !controls.contains(document.activeElement)) {
      controls.classList.add("is-idle");
    }
    requestAnimationFrame(frame);
  }
  // 可选 v1 操作。它与页面按钮共用 burst()，不需要宿主认识这张壁纸。
  function fail(requestId,code,message) { return {ok:false,requestId,code,message}; }
  window.wallpaperApp = Object.freeze({
    protocolVersion: 1,
    getActions() {
      if (!host || !caps.actions) return [];
      return [{
        id:"burst",label:"点亮星光",enabled:canAct(),
        disabledReason:canAct() ? undefined : "画面已暂停，请先继续。",
        allowWhenOccluded:false
      }];
    },
    invoke(request) {
      const id = typeof request?.requestId === "string" ? request.requestId : "";
      if (!host || !caps.actions) return fail(id,"UNSUPPORTED","当前环境没有主程序操作能力。");
      if (!request || request.protocolVersion !== 1 || !id || id.length > 128 ||
          typeof request.actionId !== "string" || !/^[a-z][a-z0-9-]{0,47}$/.test(request.actionId) ||
          typeof request.instanceId !== "string" || !request.instanceId || request.instanceId.length > 128) {
        return fail(id,"INVALID_REQUEST","调用参数无效。");
      }
      if (request.instanceId !== host.instanceId) return fail(id,"STALE_INSTANCE","画面已经切换。");
      const old = replies.get(id);
      if (old) return old.actionId === request.actionId ? old.result : fail(id,"INVALID_REQUEST","重复请求内容不一致。");
      let result;
      if (request.actionId !== "burst") result = fail(id,"UNKNOWN_ACTION","没有这个操作。");
      else if (!burst()) result = fail(id,"PAUSED","画面已暂停，请先继续。");
      else result = {ok:true,requestId:id,data:{total}};
      replies.set(id,{actionId:request.actionId,result});
      if (replies.size > 128) replies.delete(replies.keys().next().value);
      return result;
    }
  });
  resize(); requestAnimationFrame(frame);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded",startScene,{once:true});
  } else startScene();
})();
</script>
</html>
```

> **示例不是宿主实现**
>
> 在浏览器里直接运行时会自动回退，页面按钮可用，但不会在当前主程序中注册任何原生菜单。自动化测试中的模拟宿主也只用于检查分支，不代表已经完成 Windows 桌面适配。

## 09 旧壁纸怎么兼容，内容怎么更新

不要为了照顾旧包，又把针对某张壁纸的补丁放回宿主。

| 组合 | 应有结果 | 作者需要注意 |
| --- | --- | --- |
| 普通浏览器 + 任意壁纸 | 基本场景和页面交互可用，没有宿主也不报错。 | 新接口全部按存在性和版本检测；不能在顶层直接无条件调用宿主。 |
| 符合 v1 的新宿主 + 未适配旧包 | 宿主不强制隐藏旧包的界面，转发通用点击与移动。 | 旧包的全屏入口、快捷键文案和自身暂停机制不会自动改好；需要内容更新。未声明的主程序扩展操作不显示。 |
| 符合 v1 的新宿主 + v1 壁纸 | 按能力展示界面，接收状态变化，声明并执行可选操作。 | 对不支持的能力保持可用降级；主程序不因壁纸名称增加新代码。 |
| 旧宿主 + 新壁纸包 | 普通网页功能可按作者设计回退，但不承诺完整桌面适配。 | 旧宿主的强制 CSS 规则仍可能干扰界面。必须依赖 v1 才能正常工作的包应提高 minAppVersion，不能继续标旧最低版本。 |

> **主程序中的专用操作也要一起迁移**
>
> 正式 v0.9.0 的水族箱投喂入口采用专用适配。v0.10.0 已将入口改为由壁纸声明的操作生成；未实现操作接口的旧水族箱包仍可保留页面投喂交互，但主程序中的扩展入口需要更新包后才能提供。这项变化必须写入兼容说明。

### 壁纸作者的更新顺序

1. 先保证网页独立运行，再加环境检测与能力降级。
2. 把控制栏、帮助、全屏等桌面差异放在壁纸自己的 HTML / CSS / JS 中。
3. 需要主程序操作时，实现可选接口；不需要则省略。
4. 提升这张壁纸的内容版本，按实际依赖设置最低主程序版本；不覆盖已有发布包。
5. 按内容库流程生成 ZIP、清单、大小和校验信息。内置快照与官方内容源的对应版本应保持一致。

用户可能同时使用内置壁纸、已下载版本和本地导入版本。只修改主程序仓库内的快照，不能保证用户正在播放的旧下载包自动获得新代码；也不应未经选择静默替换用户的本地包。

### 给主程序维护者：本次主程序的实现内容与后续发布顺序

1. 提供一致的 v1 运行环境与状态接口，桌面和预览按各自能力初始化。
2. 删除通用样式强制隐藏，以及识别 `window.pinewind` 后改 DOM、标题、帮助文案的专用分支。
3. 通用点击回执只报告投递状态，不读取 `window.aquarium` 或任何业务状态。
4. 将管理窗口、托盘的专用投喂路径改为“读取操作列表 → 校验 → 调用 → 显示结果”，不再查找某个 `#feed` 按钮。
5. 保留鼠标穿透、原生空白区域检查、实例校验和通用暂停支持；不向壁纸开放管理窗口的系统权限。
6. 先提供正式可下载、可验证的宿主实现，再发布强依赖它的内容包；主程序和内容包分别按各自发布流程管理。

## 10 交付前，按这张清单检查

先做浏览器检查，再做真实桌面检查。浏览器模拟通过，不等于 Explorer 桌面已经验收。

- [ ] 断网打开 index.html，场景、脚本、字体和图片仍正常；没有宿主对象时不报错。
- [ ] 桌面模式不会显示不可用的全屏和键盘操作说明；预览、浏览器保留自身可用入口。
- [ ] 画面操作有鼠标按钮入口；控制栏隐藏后能唤回，无法确认移动能力时保持可见。
- [ ] 点击控制栏只执行对应操作，不同时种花、投喂或触发其他背景效果。
- [ ] 暂停后画面停止推进；定时器、视频、音频、Worker 等持续工作得到合理处理，恢复不快进。
- [ ] 主程序恢复不会擅自取消用户在页面内设置的暂停。
- [ ] 横屏、竖屏、窗口缩小和不同缩放下，控制栏与帮助可见、可点，场景点击位置正确。
- [ ] 可选操作的禁用、成功、失败、重复请求和切换实例都有正确结果，没有“收到请求就成功”。
- [ ] 版本与最低主程序版本符合实际；内置快照和下载包都检查过，不能只测其中一个。

| 检查场景 | 建议方式 | 通过标准 |
| --- | --- | --- |
| 独立浏览器、模式回退、操作接口 | 浏览器自动化；接口开发时可用明确标注的模拟对象检查页面分支，交付前仍应测试真实实现。 | 没有 JS 错误；按钮正确；请求去重与暂停规则有效。模拟结果只证明页面逻辑。 |
| 类名不应被宿主干预 | 准备普通测试页，故意使用 .hud、.overlay、.toast 等类名。 | 符合 v1 的宿主不隐藏这些元素，不改标题、文字或事件处理。 |
| 暂停与资源 | 自动化观察场景状态；结合进程资源与媒体状态检查。 | 暂停期间状态不推进，恢复不突跳，不持续进行无必要的重计算或播放。 |
| 真实桌面输入 | Windows / Explorer 实机，桌面图标、框选、任务栏、菜单、普通窗口都参与测试。 | 桌面空白处交互正常；图标和原始桌面操作不受影响，壁纸不抢焦点。 |
| 多屏与缩放 | 至少覆盖负坐标副屏、竖屏、混合 DPI、任务栏工作区变化。 | 显示范围和点击映射一致；切屏或换壁纸后的旧请求不作用于新实例。 |
| 壁纸设置通信 | 检查未运行保存、启动前读取、多屏共享、暂停时更新、保存失败、版本冲突和旧设置页回执。 | 读取与保存为同一份配置；失败不覆盖；旧页面不影响新页面；配置变更不恢复暂停。 |
| 版本组合 | 当前支持宿主、旧宿主、旧内容包、新内容包分别验证。 | 最低版本声明真实；不支持时明确降级，不能把模拟的新接口写成当前宿主已经支持。 |

## 11 常见问题，先从这里查

大多数问题来自运行环境、坐标或事件的假设，而不是需要宿主为某张壁纸加特例。

| 现象 | 先检查 | 推荐处理 |
| --- | --- | --- |
| 预览有控制栏，桌面没有 | 是否被旧宿主强制 CSS 隐藏？页面是否自行进入 idle 或隐藏界面状态？ | 先区分宿主版本与页面行为；新版由壁纸自行控制显示，不增加主程序专用白名单。 |
| 移动鼠标没有按钮高亮 | 是否只依赖 :hover、pointerenter 或原生 title？ | 必要标签直接可见；通过标准 pointermove 在壁纸内实现轻量反馈，不能要求宿主模拟完整浏览器悬停。 |
| 点按钮时背景也响应 | 是否在 document 上无差别处理 click，或同时处理了 down 与 click？ | 场景监听限定在场景区域；控制栏阻止冒泡；同一业务只处理一次。 |
| 点击位置偏了 | 是否混用了物理像素、CSS 像素、固定分辨率或忽略了 cover 裁切？ | 以当前画布矩形做转换；存在裁切、变换时逆变换到实际场景坐标。 |
| 暂停后还有声音或后台仍忙 | 是否还有定时器、视频、音频、Worker、CSS 动画？ | 按暂停状态管理这些资源；不要以为冻结 RAF 就等于停止一切。 |
| 恢复后时间跳了一大截 | 是否直接使用恢复后的大帧间隔？ | 重置帧时间基准，给 dt 设置合理上限；不要把暂停时长当成模拟时长补跑。 |
| 主程序按钮没有出现 | 是否只是添加了接口对象，而正在使用的正式版本尚未支持 v1？操作列表是否为空、无效或未就绪？ | 确认正式接口版本与能力，再检查协议字段。页面按钮仍应独立可用。 |
| 点一次主程序操作却执行两次 | 是否在超时后自动重试，或给重复请求生成了新的 ID？ | 串行调用、使用同一个请求的回执缓存；结果未知时不自动重试非幂等动作。 |

## 12 版本状态与参考来源

对照 v0.9.0 与 v0.10.0，区分旧行为和 v1 接口的支持范围。

| 项目 | 正式 v0.9.0 | v0.10.0 |
| --- | --- | --- |
| module.json schema 1、相对路径、本地目录 | 已有 | 沿用现有格式，不增加未经实现的清单字段。 |
| 旧模式标识、通用点击/移动与 RAF 暂停 | 已有 | 保留兼容；完善暂停原因和加载期间的初始状态。 |
| 宿主隐藏 HUD / overlay、松风镇 DOM 适配、水族箱专用调用 | 包含这些专用逻辑 | 已移除。两张内置壁纸及内容库源码自行处理显示与业务操作。 |
| wallpaperHost、wallpaperApp、状态事件与通用操作发现 | 尚不支持这些公开接口 | 已实现。包含实例绑定、超时、去重、校验、管理窗口与托盘操作。 |
| 正式支持版本与内容发布 | v0.9.0 已发行 | 主程序 v0.10.0 提供 v1；两张内置快照为 1.0.1。在线内容库独立发布，不随程序升级替换已有在线包。 |

- [v0.10.0 宿主源码](https://github.com/whoarei/wallpaper-box/tree/v0.10.0)：通用运行时、原生操作调用、管理界面与内置适配。
- `wallpaper-host/src-tauri/wallpaper-mode.js`：环境、输入、暂停事件、操作传输，以及 v0.12.0 起的配置快照和变更事件。
- `wallpaper-host/src-tauri/wallpaper-settings.js`、`wallpaper-host/ui/wallpaper-settings.js`：设置页 SDK 与隔离消息通道。
- `wallpaper-host/src-tauri/src/wallpaper_settings.rs`、`wallpaper-host/src-tauri/src/host/wallpaper_settings.rs`：配置版本、持久化与窗口通知。
- `wallpaper-host/src-tauri/src/wallpaper_protocol.rs`：原生协议类型与字段校验。
- `wallpaper-host/src-tauri/src/host/wallpaper_actions.rs`：通用发现、实例绑定与操作回执。
- `tests/wallpaper-protocol.test.cjs`、`tests/wallpaper-modules.test.cjs`：实际运行时与真实壁纸页面验证。`tests/wallpaper-settings.test.cjs`：设置读写、隔离、保存失败、未运行与多屏同步的集成验证。
- [正式版基线 v0.9.0](https://github.com/whoarei/wallpaper-box/blob/66fbf98/docs/guide.md)：用于对照旧行为，不代表该版本已支持 v1。

| 设置扩展 | 正式 v0.10.0—v0.11.0 | v0.12.0 |
| --- | --- | --- |
| protocolVersion / schemaVersion | 均为 1 | 仍为 1，扩展通过能力检测启用 |
| settings.entry、设置页 SDK | 尚不支持 | 已实现，允许配置未运行的已安装壁纸 |
| capabilities.settings、getSettings、settingschange | 尚不支持；采用默认配置 | 桌面与预览均提供，按壁纸 ID 共享配置 |

基础 v1 支持版本：主程序 v0.10.0 起；设置扩展从 v0.12.0 起支持。文档日期：2026 年 11 月 13 日。浏览器接口检查不代替 Windows Explorer 实机验收，设备检查范围见对应发行说明。
