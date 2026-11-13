/*
 * UI contract tests, using the real manager HTML/CSS/JS and a native IPC fixture.
 * Run: node tests/ui.test.cjs
 * Requires Node.js, Microsoft Edge and Playwright. No packages are installed.
 * Set PLAYWRIGHT_PATH to a Playwright package directory if it is not resolvable;
 * EDGE_PATH may override the browser executable. No GitHub calls or downloads.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    path.resolve(__dirname, '../wallpaper-host/node_modules/playwright-core'),
    'playwright',
    'playwright-core',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Playwright is unavailable. Set PLAYWRIGHT_PATH to its package directory.');
}

const uiRoot = path.resolve(__dirname, '../wallpaper-host/ui');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function serveUi() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.js', 'app.css', 'settings.css', 'online.css', 'icon.png', 'window-controls.js', 'wallpaper-settings.js'].includes(filename)) {
      response.writeHead(404).end(); return;
    }
    response.writeHead(200, { 'Content-Type': mime[path.extname(filename)], 'Cache-Control': 'no-store' });
    response.end(fs.readFileSync(path.join(uiRoot, filename)));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    resolve({ server, address: `http://127.0.0.1:${server.address().port}` });
  }));
}

function fixtures() {
  const module = (id, name) => ({ id, name, subtitle: 'OFFLINE WALLPAPER',
    description: '随时可以播放的本机壁纸。', href: `/${id}/index.html`, cover: null,
    tags: [], version: '1.0.0', source: 'builtin', rollback_available: false });
  const modules = [module('aquarium', '水族箱'), module('pinewind-town', '松风镇')];
  const remote = (id, name, version) => ({ id, name, subtitle: 'OFFICIAL WALLPAPER',
    description: '由官方壁纸库提供，只按需下载这一张壁纸。', version, minAppVersion: '0.2.0',
    entry: 'index.html', tags: [], size: 12344, unpackedSize: 54321,
    downloadUrl: `https://github.com/whoarei/wallpapers/releases/download/library-v1.1.0/${id}-${version}.zip`,
    sha256: 'a'.repeat(64), coverUrl: null });
  return {
    catalog: { schemaVersion: 1, version: '1.1.0', wallpapers: [
      remote('aquarium', '水族箱', '1.1.0'), remote('pinewind-town', '松风镇', '1.0.0'),
      remote('window-to-elsewhere', '通往别处的窗户', '1.0.0'),
    ] },
    state: { version: '0.2.0', service: 'http://wallpaper.localhost', auto_pause: true, auto_start: true, auto_start_error: null,
      proxy: { mode: 'system', url: '' },
      wallpaper_repositories: [{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true},{url:'https://github.com/whoarei/wallpapers',enabled:false}],
      selected_monitor: 'primary', displays: [
        { id: 'primary', name: '主显示器', primary: true, width: 3840, height: 2160, scale: 1.5 },
        { id: 'secondary', name: '副显示器', primary: false, width: 1920, height: 1080, scale: 1 },
      ], modules, warnings: [], downloads: [], last_error: null,
      wallpapers: [{ display_id: 'primary', module_id: 'aquarium', name: '水族箱',
        paused: false, auto_paused: false, instance_id:'primary-document', actions:[{id:'feed',label:'投喂鱼儿',enabled:true,allowWhenOccluded:true}],
        resources: { status: 'ready', cpu_percent: 1.2, memory_bytes: 134217728 } }],
      online: { catalog: null, checked_at: 0, cached: false, last_error: null },
    },
  };
}

function parallelDownloads(fixture) {
  fixture.deferInstall = true;
  fixture.deferCancellation = true;
  const template = fixture.catalog.wallpapers[2];
  for (let i = 4; i <= 8; i++) {
    fixture.catalog.wallpapers.push({ ...template, id: `scene-${i}`, name: `风景 ${i}` });
  }
}

function wallpaperHistory(fixture) {
  fixture.deferInstall = true;
  Object.assign(fixture.state.modules[0], { version: '1.1.0', source: 'online' });
  const latest = fixture.catalog.wallpapers[0];
  fixture.historyPages = [
    { wallpapers: [latest, {...latest, version:'1.0.0'}], next_page:2, warning:null },
    { wallpapers: [{...latest, version:'1.0.0'}, {...latest, version:'0.9.0'}], next_page:null, warning:null },
  ];
}

// This fixture owns native state. UI updates only through the production invoke
// API and its ordinary one-second polling, matching a Tauri manager window.
function injectNativeFixture({ state, catalog, failCheck, failRollback, failAppCheck, failAppInstall,
  failPreview, deferApply, deferInstall, deferAction, failAction, failProxySave, failProxyTest, deferProxyTest, failCover, persistProxy, persistRepositories, failRepositorySave, sourceCatalogs, sourceFailures, deferCancellation, importedModule, failAutoStart, deferAutoStart, persistAutoStart, historyPages, failHistory, deferHistory, coverData, initialWindowState }) {
  const copy = value => JSON.parse(JSON.stringify(value));
  if (persistProxy && sessionStorage.getItem('native-proxy')) {
    state.proxy = JSON.parse(sessionStorage.getItem('native-proxy'));
  }
  if (persistRepositories && sessionStorage.getItem('native-repositories')) {
    state.wallpaper_repositories = JSON.parse(sessionStorage.getItem('native-repositories'));
  }
  if (persistAutoStart && sessionStorage.getItem('native-auto-start') !== null) {
    state.auto_start = JSON.parse(sessionStorage.getItem('native-auto-start'));
  }
  const repositoryRequests = [];
  function mergedSources(sources) {
    const seen = new Set();
    const wallpapers = sources.flatMap(source => (source.catalog?.wallpapers || []).filter(item => {
      if (seen.has(item.id)) return false;seen.add(item.id);return true;
    }));
    const first = sources.find(source => source.catalog);
    return {catalog:first?{...copy(first.catalog),wallpapers}:null,sources,checked_at:1794297600,
      cached:sources.some(source=>source.cached),last_error:sources.filter(source=>source.last_error).map(source=>source.repository+'：'+source.last_error).join('；')||null};
  }
  const calls = [];
  const listeners = new Map();
  const previous = new Map();
  let pendingFailure = !!failCheck;
  let pendingHistoryFailure = !!failHistory;
  const historyChoices = new Map();
  let finishOperation;
  const windowState = { maximized: false, focused: true, minimized: false, ...initialWindowState };
  const windowCalls = [];
  const windowListeners = new Map(['resize', 'focus', 'scale'].map(name => [name, new Set()]));
  let failWindowToggle = false, failWindowHide = false, holdWindowRead = false, releaseWindowRead;
  function emitWindowEvent(name, patch = {}) {
    Object.assign(windowState, patch);
    windowListeners.get(name).forEach(callback => callback({ payload: name === 'focus' ? windowState.focused : {} }));
  }
  const nativeWindow = {
    isMaximized: async () => {
      const value = windowState.maximized;
      if (!holdWindowRead) return value;
      holdWindowRead = false;
      return new Promise(resolve => { releaseWindowRead = () => resolve(value); });
    },
    isFocused: async () => windowState.focused,
    toggleMaximize: async () => {
      windowCalls.push('toggleMaximize');
      if (failWindowToggle) { failWindowToggle = false; throw '系统暂时无法调整窗口'; }
      emitWindowEvent('resize', { maximized: !windowState.maximized });
    },
    minimize: async () => { windowCalls.push('minimize'); windowState.minimized = true; },
    startDragging: async () => { windowCalls.push('startDragging'); },
    onResized: callback => listenWindow('resize', callback),
    onFocusChanged: callback => listenWindow('focus', callback),
    onScaleChanged: callback => listenWindow('scale', callback),
  };
  function listenWindow(name, callback) {
    const listeners = windowListeners.get(name);
    listeners.add(callback);
    return Promise.resolve(() => listeners.delete(callback));
  }
  window.__uiTest = {
    calls, repositoryRequests,
    emit(name) { listeners.get(name)?.({ event: name, payload: null }); },
    windowCalls,
    windowState: () => copy(windowState),
    emitWindowEvent,
    windowListenerCount: () => [...windowListeners.values()].reduce((sum, listeners) => sum + listeners.size, 0),
    failNextWindowToggle() { failWindowToggle = true; },
    failNextWindowHide() { failWindowHide = true; },
    holdNextWindowRead() { holdWindowRead = true; },
    releaseWindowRead() { releaseWindowRead(); releaseWindowRead = null; },
    failNextCheck() { pendingFailure = true; },
    state() { return copy(state); },
    setWallpaper(displayId, patch) {Object.assign(state.wallpapers.find(w=>w.display_id===displayId),copy(patch));},
    selectDisplay(displayId) {state.selected_monitor=displayId;},
    setAppUpdate(patch) { Object.assign(state.app_update, copy(patch)); },
    setResources(displayId, resources) { state.wallpapers.find(w => w.display_id === displayId).resources = copy(resources); },
    finishOperation() { assertPendingOperation(); finishOperation(); finishOperation = null; },
    setDownload(id, patch) { Object.assign(state.downloads.find(t => t.id === id), copy(patch)); },
    setCatalog(items) { state.online.catalog.wallpapers = copy(items); },
    setDisplays(displays) {
      state.displays = copy(displays);
      if (!displays.some(d => d.id === state.selected_monitor)) state.selected_monitor = displays[0]?.id || '';
    },
    completeDownload,
    failDownload(id, error = '下载连接中断') { const task=state.downloads.find(t=>t.id===id);task.phase='failed';task.error=error;task.speed=0;pump(); },
    finishCancellation(id) { state.downloads=state.downloads.filter(t=>t.id!==id);pump(); },
  };
  function assertPendingOperation() { if (!finishOperation) throw new Error('No pending fixture operation'); }
  function pump() {
    let active=state.downloads.filter(t=>!['queued','failed'].includes(t.phase)).length;
    for(const task of state.downloads){if(task.phase==='queued'&&active<5){task.phase='downloading';active++;}}
    let position=0;for(const task of state.downloads)task.queue_position=task.phase==='queued'?++position:null;
  }
  function installItem(item) {
    const index=state.modules.findIndex(module=>module.id===item.id);
    if(index>=0)previous.set(item.id,copy(state.modules[index]));
    const installed={id:item.id,name:item.name,subtitle:item.subtitle,description:item.description,href:`/${item.id}/${item.entry}`,cover:null,tags:item.tags,version:item.version,source:'online',rollback_available:index>=0};
    if(index>=0)state.modules[index]=installed;else state.modules.push(installed);
  }
  function completeDownload(id) {
    const task=state.downloads.find(t=>t.id===id);if(!task)throw new Error('Missing download');
    installItem(task.item);state.downloads=state.downloads.filter(t=>t.id!==id);pump();
  }
  window.__TAURI__ = { window: { getCurrentWindow: () => nativeWindow }, event: { listen: async (name, handler) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  } }, core: { invoke: async (command, args = {}) => {
    calls.push({ command, args: copy(args) });
    switch (command) {
      case 'get_state': return copy(state);
      case 'set_auto_start':
        if (deferAutoStart) await new Promise(resolve => { finishOperation = resolve; });
        if (failAutoStart) throw '无法访问 Windows 启动设置（0x80070005）。';
        state.auto_start = args.enabled;state.auto_start_error = null;
        if (persistAutoStart) sessionStorage.setItem('native-auto-start', JSON.stringify(args.enabled));
        return copy(state);
      case 'preview_wallpaper':
        if (failPreview) throw '打开预览失败，请重试。';
        if (!state.modules.some(module => module.id === args.moduleId)) throw '壁纸不存在';
        return null;
      case 'auto_pause': state.auto_pause = args.enabled; return copy(state);
      case 'set_wallpaper_repositories': {
        if (failRepositorySave) throw '壁纸仓库设置保存失败，请检查设置目录是否可写。';
        const normalized=args.repositories.map(repository=>({url:repository.url.trim().replace(/\/$/,'').replace(/\.git$/,'').toLowerCase(),enabled:repository.enabled}));
        if(new Set(normalized.map(repository=>repository.url)).size!==normalized.length)throw '壁纸仓库地址重复，请保留一项。';
        state.wallpaper_repositories=normalized;
        if(persistRepositories)sessionStorage.setItem('native-repositories',JSON.stringify(normalized));
        state.online=mergedSources(normalized.filter(repository=>repository.enabled).map(repository=>{
          const prior=state.online.sources?.find(source=>source.repository===repository.url);
          return prior?{...copy(prior),cached:true,last_error:null}:{repository:repository.url,catalog:null,checked_at:0,cached:false,last_error:null};
        }));
        return copy(state);
      }
      case 'set_proxy':
        if (failProxySave) throw '代理设置保存失败，请检查设置目录是否可写。';
        state.proxy = { mode: args.proxy.mode, url: args.proxy.mode === 'manual' ? new URL(args.proxy.url).href : '' };
        if (persistProxy) sessionStorage.setItem('native-proxy', JSON.stringify(state.proxy));
        return copy(state);
      case 'test_proxy':
        if (deferProxyTest) await new Promise(resolve => { finishOperation = resolve; });
        if (failProxyTest) throw '连接 GitHub 失败，请检查代理设置和网络后重试。';
        return null;
      case 'load_online_cover':
        if (failCover) throw '封面下载失败。';
        return coverData?.[args.moduleId] || 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDZkAAAAASUVORK5CYII=';
      case 'refresh_modules': return copy(state);
      case 'open_wallpaper_folder':
      case 'open_about_link':
      case 'quit_app': return null;
      case 'hide_manager':
        if (failWindowHide) { failWindowHide = false; throw '托盘暂时不可用'; }
        return null;
      case 'capture_desktop':
      case 'show_desktop': return 'preview.png';
      case 'remove_wallpaper':
        state.wallpapers = state.wallpapers.filter(wallpaper => wallpaper.display_id !== args.monitorId);
        return copy(state);
      case 'import_wallpaper':
        if (importedModule) { state.modules.push(copy(importedModule)); return copy(state); }
        if (args.kind === 'zip') throw 'ZIP 文件无效，请选择完整壁纸包。';
        return null; // Canceling the native picker must not report an import.
      case 'check_app_update':
        if (failAppCheck) throw '程序更新网络不可用，请稍后重试。';
        state.app_update = { ...state.app_update, phase: 'downloading', version: '0.3.1',
          received: 0, total: 1048576, error: null };
        return copy(state);
      case 'download_app_update':
        state.app_update = { ...state.app_update, phase: 'downloading', received: 262144,
          total: 1048576, error: null };
        return copy(state);
      case 'install_app_update':
        if (args.confirmed !== true || state.app_update.phase !== 'ready') {
          throw new Error('Test IPC: update installation requires ready state and explicit confirmation');
        }
        if (args.version !== state.app_update.version) throw '程序更新版本已变化，请重新确认。';
        if (failAppInstall) throw '安装包验证被拒绝，请重新检查程序更新。';
        state.app_update.phase = 'installing';
        return copy(state);
      case 'select_monitor':
        if (!state.displays.some(display => display.id === args.monitorId)) {
          throw new Error('Test IPC: unknown monitor');
        }
        state.selected_monitor = args.monitorId;
        return copy(state);
      case 'pause_wallpaper': {
        const playing = state.wallpapers.find(wallpaper => wallpaper.display_id === args.monitorId);
        if (!playing) throw new Error('Test IPC: no wallpaper to pause');
        playing.paused = args.paused;
        return copy(state);
      }
      case 'invoke_wallpaper_action': {
        if(deferAction)await new Promise(resolve=>{finishOperation=resolve;});
        const playing=state.wallpapers.find(wallpaper=>wallpaper.display_id===args.monitorId);
        if(playing?.instance_id!==args.instanceId)return {ok:false,requestId:'test-request',code:'STALE_INSTANCE',message:'壁纸已经切换或重新加载。'};
        const action=playing.actions?.find(action=>action.id===args.actionId);
        if(!action||!action.enabled||playing.paused||(playing.auto_paused&&!action.allowWhenOccluded)){
          return {ok:false,requestId:'test-request',code:'DISABLED',message:'这个壁纸操作暂时不可用。'};
        }
        if(failAction)return {ok:false,requestId:'test-request',code:'RESULT_UNKNOWN',message:'未能确认操作结果，请先查看壁纸，避免重复操作。'};
        return {ok:true,requestId:'test-request'};
      }
      case 'check_online':
        if (pendingFailure) {
          pendingFailure = false;
          state.online.last_error = 'GitHub 连接失败：离线测试';
          throw state.online.last_error;
        }
        state.online = mergedSources((state.wallpaper_repositories||[{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true}]).filter(repository=>repository.enabled).map(repository=>{
          repositoryRequests.push(repository.url);
          const prior=state.online.sources?.find(source=>source.repository===repository.url);
          if(sourceFailures?.includes(repository.url))return {repository:repository.url,catalog:prior?.catalog||null,checked_at:prior?.checked_at||0,cached:!!prior?.catalog,last_error:'仓库暂时不可用'};
          const current=copy(sourceCatalogs?.[repository.url]||catalog);
          current.wallpapers.forEach(item=>item.repository=repository.url);
          return {repository:repository.url,catalog:current,checked_at:1794297600,cached:false,last_error:null};
        }));
        return copy(state);
      case 'load_wallpaper_history': {
        if (deferHistory) await new Promise(resolve => { finishOperation = resolve; });
        if (pendingHistoryFailure) { pendingHistoryFailure = false; throw '历史版本连接失败，请重试。'; }
        const latest=state.online.catalog?.wallpapers.find(item=>item.id===args.moduleId&&item.repository===args.repository);
        if(!latest)throw '壁纸来源已变化';
        const page=copy(historyPages?.[args.page-1]||{wallpapers:[latest,{...latest,version:'0.9.0'}],next_page:null,warning:null});
        for(const item of page.wallpapers){item.repository=args.repository;historyChoices.set(JSON.stringify([item.repository,item.id,item.version]),copy(item));}
        return page;
      }
      case 'install_online': {
        if(state.downloads.some(t=>t.id===args.moduleId))return copy(state);
        const item=args.version?historyChoices.get(JSON.stringify([args.repository,args.moduleId,args.version])):state.online.catalog?.wallpapers.find(item=>item.id===args.moduleId);
        if(!item)throw new Error('Test IPC: unknown selected wallpaper');
        state.downloads.push({id:item.id,item:copy(item),phase:'queued',received:deferInstall?item.size/2:0,total:item.size,speed:1024,error:null,queue_position:null});pump();
        if(deferInstall)finishOperation=()=>completeDownload(item.id);else completeDownload(item.id);
        return copy(state);
      }
      case 'download_action': {
        const task=state.downloads.find(t=>t.id===args.moduleId);if(!task)return copy(state);
        if(args.action==='retry'){if(task.phase!=='failed')throw '无需重试';task.phase='queued';task.received=0;task.error=null;pump();}
        else if(args.action==='cancel'){
          if(task.phase==='installing')throw '正在安装，请稍后再试';
          if(deferCancellation&&task.phase==='downloading')task.phase='cancelling';
          else {state.downloads=state.downloads.filter(t=>t.id!==args.moduleId);pump();}
        }else throw new Error('Unknown download action');
        return copy(state);
      }
      case 'apply_wallpaper': {
        const module = state.modules.find(module => module.id === args.moduleId);
        if (!module || !state.displays.some(display => display.id === args.monitorId)) {
          throw new Error('Test IPC: invalid wallpaper or monitor');
        }
        if (deferApply) await new Promise(resolve => { finishOperation = resolve; });
        state.wallpapers = state.wallpapers.filter(wallpaper => wallpaper.display_id !== args.monitorId);
        state.wallpapers.push({ display_id: args.monitorId, module_id: module.id,
          name: module.name, paused: false, auto_paused: false, instance_id:'document-'+args.monitorId+'-'+module.id, actions:copy(module.actions||[]) });
        return copy(state);
      }
      case 'rollback_wallpaper': {
        // Native rollback can reject without adding a persistent error to View.
        // The manager must keep this rejected IPC error visible itself.
        if (failRollback) throw '上一版本文件已损坏：回退失败';
        const prior = previous.get(args.moduleId);
        if (!prior) throw new Error('Test IPC: no rollback version');
        const index = state.modules.findIndex(module => module.id === args.moduleId);
        previous.set(args.moduleId, copy(state.modules[index]));
        state.modules[index] = { ...prior, rollback_available: true };
        return copy(state);
      }
      default: throw new Error(`Unexpected UI command: ${command}`);
    }
  } } };
}

async function actions(page) {
  return page.evaluate(() => window.__uiTest.calls.filter(call => call.command !== 'get_state'));
}

function moduleCard(page, container, name) {
  return page.locator(`${container} .module`).filter({ has: page.getByRole('heading', { name, exact: true }) });
}

function monitorChoice(page, id) {
  return page.locator(`#displays .monitor-choice[data-monitor-id="${id}"]`);
}

function appUpdateFixture(fixture, phase, extra = {}) {
  fixture.state.version = '0.3.0';
  fixture.state.app_update = { phase, current_version: '0.3.0', version: '0.3.1',
    notes: '修复显示器切换。\n下载后由用户决定安装时间。', received: 0, total: null,
    error: null, last_checked_at: 1794297600, ...extra };
}

async function ready(page) {
  await page.waitForFunction(() => document.querySelectorAll('#modules .module').length >= 2);
}

async function visible(locator) {
  await locator.waitFor({ state: 'visible' });
}

async function screenshot(page, name) {
  if (!process.env.UI_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `${name}.png`), fullPage: true });
}

async function settingsScreenshot(page, name) {
  if (!process.env.UI_SCREENSHOT_DIR) return;
  fs.mkdirSync(process.env.UI_SCREENSHOT_DIR, { recursive: true });
  await page.locator('#settings-dialog').screenshot({ path: path.join(process.env.UI_SCREENSHOT_DIR, `${name}.png`) });
}

async function noHorizontalOverflow(page, label) {
  const result = await page.evaluate(() => ({
    viewport: innerWidth,
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    outside: [...document.querySelectorAll('body *')].filter(node => {
      const box = node.getBoundingClientRect();
      return box.width && (box.right > innerWidth + 1 || box.left < -1);
    }).slice(0, 8).map(node => ({ tag: node.tagName, id: node.id, class: node.className })),
  }));
  assert.ok(result.width <= result.viewport, `${label}: horizontal overflow ${JSON.stringify(result)}`);
}

(async () => {
  const { chromium } = loadPlaywright();
  const { server, address } = await serveUi();
  let browser;
  let passed = 0;
  const jsErrors = [];
  try {
    const executablePath = process.env.EDGE_PATH || [
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean).find(filename => fs.existsSync(filename));
    browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : { channel: 'msedge' }) });

    async function test(name, configure, body) {
      const fixture = fixtures();
      if (configure) configure(fixture);
      const context = await browser.newContext({ viewport: { width: 780, height: 600 }, locale: 'zh-CN' });
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on('pageerror', error => jsErrors.push(`${name}: ${error.message}`));
      page.on('console', message => { if (message.type() === 'error') jsErrors.push(`${name}: ${message.text()}`); });
      const externalRequests = [];
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== address) {
          externalRequests.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.addInitScript(injectNativeFixture, fixture);
      try {
        await page.goto(address, { waitUntil: 'networkidle' });
        await ready(page);
        await body(page);
        await noHorizontalOverflow(page, name);
        assert.deepEqual(externalRequests, [], 'UI contract test must not contact GitHub or fetch wallpaper packages');
        assert.deepEqual(jsErrors, [], 'No JavaScript errors');
        console.log(`PASS ${name}`);
        passed += 1;
      } finally { await context.close(); }
    }

    await test('caption controls invoke native window actions and close only to the tray', null, async page => {
      const config = JSON.parse(fs.readFileSync(path.join(uiRoot, '../src-tauri/tauri.conf.json'), 'utf8'));
      const capability = JSON.parse(fs.readFileSync(path.join(uiRoot, '../src-tauri/capabilities/default.json'), 'utf8'));
      assert.equal(config.app.windows.find(window => window.label === 'manager').decorations, false);
      assert.deepEqual(capability.windows, ['manager']);
      for (const permission of ['allow-minimize', 'allow-toggle-maximize', 'allow-start-dragging']) {
        assert.ok(capability.permissions.includes(`core:window:${permission}`));
      }
      const maximize = page.locator('#window-maximize');
      await maximize.click();
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-label') === '还原');
      assert.equal(await maximize.getAttribute('aria-pressed'), 'true');
      assert.equal(await maximize.locator('.maximize-icon').isVisible(), false);
      assert.equal(await maximize.locator('.restore-icon').isVisible(), true);
      await maximize.press('Enter');
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-label') === '最大化');
      await maximize.press('Space');
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-label') === '还原');
      await page.locator('#window-minimize').click();
      assert.equal((await page.evaluate(() => window.__uiTest.windowState())).minimized, true);
      const before = await page.evaluate(() => window.__uiTest.state().wallpapers);
      await page.locator('#window-close').click();
      assert.deepEqual(await actions(page), [{ command: 'hide_manager', args: {} }]);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.state().wallpapers), before);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.windowCalls), [
        'toggleMaximize', 'toggleMaximize', 'toggleMaximize', 'minimize',
      ]);
    });

    await test('caption follows native maximize, focus and DPI events without stale reads', fixture => {
      fixture.initialWindowState = { maximized: true, focused: false };
    }, async page => {
      const maximize = page.locator('#window-maximize');
      await page.waitForFunction(() => document.body.classList.contains('window-inactive'));
      assert.equal(await maximize.getAttribute('title'), '还原');
      await page.evaluate(() => window.__uiTest.emitWindowEvent('resize', { maximized: false }));
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-pressed') === 'false');
      await page.evaluate(() => {
        window.__uiTest.holdNextWindowRead();
        window.__uiTest.emitWindowEvent('resize');
      });
      await page.evaluate(() => window.__uiTest.emitWindowEvent('resize', { maximized: true }));
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-pressed') === 'true');
      await page.evaluate(() => window.__uiTest.releaseWindowRead());
      assert.equal(await maximize.getAttribute('aria-label'), '还原');
      await page.evaluate(() => window.__uiTest.emitWindowEvent('focus', { focused: true }));
      await page.waitForFunction(() => !document.body.classList.contains('window-inactive'));
      await page.evaluate(() => window.__uiTest.emitWindowEvent('scale', { maximized: false }));
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-label') === '最大化');
      assert.equal(await maximize.locator('.maximize-icon').isVisible(), true);
      assert.equal(await maximize.locator('.restore-icon').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.windowCalls), []);
    });

    await test('title bar drags only from noninteractive regions and double click toggles once', null, async page => {
      await page.locator('.brand strong').dispatchEvent('mousedown', { button: 0, detail: 1 });
      await page.locator('.brand strong').dispatchEvent('mousedown', { button: 0, detail: 2 });
      await page.locator('.brand strong').dispatchEvent('dblclick', { button: 0, detail: 2 });
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-label') === '还原');
      await page.locator('.topbar').dispatchEvent('mousedown', { button: 2, detail: 1 });
      for (const selector of ['#tab-local', '#settings-open', '#window-minimize', '#window-maximize', '#window-close']) {
        await page.locator(selector).dispatchEvent('mousedown', { button: 0, detail: 1 });
      }
      await page.locator('.topbar').dispatchEvent('pointerdown', { pointerType: 'touch', isPrimary: true, button: 0 });
      assert.deepEqual(await page.evaluate(() => window.__uiTest.windowCalls), [
        'startDragging', 'toggleMaximize', 'startDragging',
      ]);
      assert.deepEqual(await actions(page), []);
      assert.equal(await page.locator('#settings-dialog').isVisible(), false);
    });

    await test('window action failures keep the real state and wallpaper controls usable', null, async page => {
      await page.evaluate(() => window.__uiTest.failNextWindowToggle());
      await page.locator('#window-maximize').click();
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('切换窗口大小失败'));
      assert.equal(await page.locator('#window-maximize').getAttribute('aria-pressed'), 'false');
      await page.locator('#window-maximize').click();
      await page.waitForFunction(() => document.querySelector('#window-maximize').getAttribute('aria-pressed') === 'true');
      await page.evaluate(() => window.__uiTest.failNextWindowHide());
      await page.locator('#window-close').click();
      await page.waitForFunction(() => document.getElementById('toast').textContent.includes('收起窗口失败'));
      await page.locator('#pause').click();
      await page.waitForFunction(() => document.getElementById('current-status').textContent === '已暂停');
      assert.deepEqual(await actions(page), [
        { command: 'hide_manager', args: {} },
        { command: 'pause_wallpaper', args: { monitorId: 'primary', paused: true } },
      ]);
    });

    await test('caption targets stay reachable beside download and update badges at all screen sizes', fixture => {
      appUpdateFixture(fixture, 'ready', { received: 1048576, total: 1048576 });
      const item = fixture.catalog.wallpapers[2];
      fixture.state.downloads.push({ id: item.id, item, phase: 'downloading', received: 1000,
        total: item.size, speed: 1024, error: null, queue_position: null });
    }, async page => {
      await visible(page.locator('#app-update-toggle'));
      await visible(page.locator('#download-filter'));
      for (const [width, height] of [[1080, 760], [780, 600], [390, 844]]) {
        await page.setViewportSize({ width, height });
        const boxes = await page.locator('.caption-button').evaluateAll(buttons => buttons.map(button => {
          const rect = button.getBoundingClientRect();
          return { x: rect.x, y: rect.y, right: rect.right, width: rect.width, height: rect.height };
        }));
        assert.ok(boxes.every(box => box.width === 46 && box.height === 40 && box.y === 0 && box.x >= 0));
        assert.equal(boxes[2].right, width);
        assert.ok(boxes[0].right <= boxes[1].x && boxes[1].right <= boxes[2].x);
        const blocked = await page.locator('.topbar button').evaluateAll(buttons => buttons.filter(button => {
          const box = button.getBoundingClientRect();
          return box.width && box.height && !button.contains(document.elementFromPoint(
            box.x + box.width / 2, box.y + box.height / 2,
          ));
        }).map(button => button.id));
        assert.deepEqual(blocked, [], `header targets overlap at ${width}`);
        await noHorizontalOverflow(page, `caption at ${width}`);
      }
      await page.setViewportSize({ width: 1080, height: 760 });
      await page.locator('#window-maximize').focus();
      assert.equal(await page.locator('#window-maximize').evaluate(button => getComputedStyle(button).outlineStyle), 'solid');
      await screenshot(page, 'custom-titlebar');
      assert.equal(await page.evaluate(() => window.__uiTest.windowListenerCount()), 3);
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
      assert.equal(await page.evaluate(() => window.__uiTest.windowListenerCount()), 0);
    });

    await test('compact home fits both window sizes and keeps low-frequency actions out of the gallery', null, async page => {
      for (const [width, height] of [[1080, 760], [780, 600]]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
        assert.ok(bounds.width <= width && bounds.height <= height, JSON.stringify({ viewport: [width, height], bounds }));
      }
      assert.equal(await page.locator('#auto-pause').isVisible(), false);
      assert.equal(await page.locator('#import-open').count(), 0);
      assert.equal(await page.locator('#import-folder').isVisible(), false);
      assert.equal(await page.locator('#remove').isVisible(), false);
      assert.equal(await page.locator('#app-update-toggle').isVisible(), false);
      await screenshot(page, 'compact-home');
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await visible(page.locator('#remove'));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#remove').isVisible(), false);
      assert.deepEqual(await actions(page), []);
    });

    await test('settings categories keep routine controls compact and support keyboard navigation', null, async page => {
      await page.locator('#settings-open').click();
      const dialog=page.locator('#settings-dialog');
      assert.equal(await page.locator('#settings-tab-general').getAttribute('aria-selected'),'true');
      assert.equal(await page.locator('#auto-pause').isVisible(),true);
      assert.equal(await page.locator('#repository-url-0').isVisible(),false);
      assert.equal(await page.locator('#proxy-mode').isVisible(),false);
      assert.equal(await page.locator('#check-app-update').isVisible(),false);
      for(const [width,height] of [[1080,760],[780,600]]) {
        await page.setViewportSize({width,height});
        const bounds=await dialog.boundingBox();
        assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=width&&bounds.y+bounds.height<=height,JSON.stringify(bounds));
        const body=await page.locator('#settings-general-panel .settings-panel-body').evaluate(node=>({height:node.clientHeight,content:node.scrollHeight}));
        assert.ok(body.content<=body.height,`General settings fit without scrolling: ${JSON.stringify(body)}`);
      }
      await settingsScreenshot(page,'settings-general');
      await page.locator('#settings-tab-general').focus();await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('#settings-tab-wallpaper').getAttribute('aria-selected'),'true');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('#settings-tab-repositories').getAttribute('aria-selected'),'true');
      assert.equal(await page.locator('#repository-url-0').isVisible(),true);
      assert.equal(await page.locator('#auto-pause').isVisible(),false);
      await settingsScreenshot(page,'settings-repositories');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.locator('#proxy-mode').isVisible(),true);
      assert.equal(await page.locator('#settings-tab-proxy').evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('End');assert.equal(await page.locator('#check-app-update').isVisible(),true);
      await page.keyboard.press('Home');assert.equal(await page.locator('#auto-pause').isVisible(),true);
      assert.deepEqual(await actions(page),[],'Navigation must not trigger native changes');
    });

    await test('startup defaults on and an explicit choice survives polling and reopening', fixture => {
      fixture.persistAutoStart = true;
    }, async page => {
      await page.locator('#settings-open').click();
      assert.equal(await page.locator('#auto-start').isChecked(),true);
      assert.deepEqual(await actions(page),[],'Rendering the saved startup state must not modify Windows');
      await page.locator('#auto-start').uncheck();
      await page.waitForFunction(()=>!document.getElementById('auto-start').disabled);
      assert.equal(await page.locator('#auto-start').isChecked(),false);
      await page.waitForTimeout(1150);
      await page.keyboard.press('Escape');await page.locator('#settings-open').click();
      assert.equal(await page.locator('#auto-start').isChecked(),false);
      await page.reload();await ready(page);await page.locator('#settings-open').click();
      assert.equal(await page.locator('#auto-start').isChecked(),false);
      await page.locator('#auto-start').check();
      await page.waitForFunction(()=>!document.getElementById('auto-start').disabled);
      assert.equal((await page.evaluate(()=>window.__uiTest.state())).auto_start,true);
      assert.equal(await page.locator('#current-title').textContent(),'水族箱');
      assert.deepEqual(await actions(page),[{command:'set_auto_start',args:{enabled:true}}]);
    });

    await test('startup failures restore the real switch state and stay beside the control', fixture => {
      fixture.failAutoStart = true;fixture.deferAutoStart = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#auto-start').uncheck();
      assert.equal(await page.locator('#auto-start').isDisabled(),true);
      await page.evaluate(()=>{const node=document.getElementById('auto-start');node.dispatchEvent(new Event('change'));});
      assert.equal((await actions(page)).filter(call=>call.command==='set_auto_start').length,1);
      await page.evaluate(()=>window.__uiTest.finishOperation());
      await visible(page.locator('#auto-start-error'));
      assert.equal(await page.locator('#auto-start').isChecked(),true);
      assert.equal(await page.locator('#auto-start').isDisabled(),false);
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#auto-start-error').textContent(),/Windows 启动设置/);
      assert.equal(await page.locator('#error').isVisible(),false);
      await page.locator('#auto-pause').uncheck();
      await page.waitForFunction(()=>!document.getElementById('auto-pause').disabled);
      assert.equal(await page.locator('#current-title').textContent(),'水族箱');
    });

    await test('startup initialization errors show the disabled system state without interrupting playback', fixture => {
      fixture.state.auto_start = false;fixture.state.auto_start_error = '无法访问 Windows 启动设置。';
    }, async page => {
      await page.locator('#settings-open').click();
      assert.equal(await page.locator('#auto-start').isChecked(),false);
      await visible(page.locator('#auto-start-error'));
      assert.equal(await page.locator('#error').isVisible(),false);
      assert.deepEqual(await actions(page),[]);
    });

    await test('settings preserve unsaved drafts across categories and adapt to a narrow window', null, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      await page.locator('#proxy-mode').selectOption('manual');await page.locator('#proxy-url').fill('http://127.0.0.1:7890');
      await page.locator('#settings-tab-repositories').click();await page.getByRole('switch',{name:'启用仓库 1',exact:true}).uncheck();
      await page.locator('#settings-tab-general').click();await page.waitForTimeout(1150);
      await page.locator('#settings-tab-proxy').click();
      assert.equal(await page.locator('#proxy-mode').inputValue(),'manual');
      assert.equal(await page.locator('#proxy-url').inputValue(),'http://127.0.0.1:7890');
      assert.equal(await page.locator('#save-proxy').isEnabled(),true);
      await settingsScreenshot(page,'settings-proxy');
      await page.setViewportSize({width:420,height:680});
      await page.waitForFunction(()=>document.querySelector('.settings-nav').getAttribute('aria-orientation')==='horizontal');
      const button=await page.locator('#save-proxy').boundingBox();
      assert.ok(button.y>=0&&button.y+button.height<=680,JSON.stringify(button));
      await noHorizontalOverflow(page,'narrow settings');await settingsScreenshot(page,'settings-compact');
      await page.locator('#settings-tab-repositories').click();
      assert.equal(await page.getByRole('switch',{name:'启用仓库 1',exact:true}).isChecked(),false);
      assert.deepEqual(await page.evaluate(()=>window.__uiTest.state().proxy),{mode:'system',url:''});
      assert.equal(await page.evaluate(()=>window.__uiTest.state().wallpaper_repositories[0].enabled),true);
      await page.keyboard.press('Escape');await page.locator('#settings-open').click();
      assert.equal(await page.locator('#settings-tab-repositories').getAttribute('aria-selected'),'true');
      assert.deepEqual(await actions(page),[],'Drafts and tab changes must not save automatically');
      await page.setViewportSize({width:780,height:600});
    });

    await test('long repository lists scroll independently while navigation and save remain reachable', fixture => {
      for(let index=2;index<16;index++)fixture.state.wallpaper_repositories.push({url:`https://github.com/example/scene-${index}`,enabled:true});
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      assert.equal(await page.locator('#add-repository').isDisabled(),true);
      const body=page.locator('#settings-repositories-panel .settings-panel-body');
      assert.equal(await body.evaluate(node=>node.scrollHeight>node.clientHeight),true);
      await body.evaluate(node=>node.scrollTop=node.scrollHeight);
      await page.getByRole('switch',{name:'启用仓库 16',exact:true}).uncheck();
      for(const locator of [page.locator('#save-repositories'),page.locator('#settings-tab-general'),page.locator('#about-open')]) {
        const box=await locator.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=600,JSON.stringify(box));
      }
      await page.locator('#save-repositories').click();
      await page.waitForFunction(()=>document.getElementById('repositories-status').textContent.includes('已保存'));
      assert.equal(await page.evaluate(()=>window.__uiTest.state().wallpaper_repositories[15].enabled),false);
      assert.equal(await page.locator('#current-title').textContent(),'水族箱');
      assert.equal((await actions(page)).filter(call=>call.command==='set_wallpaper_repositories').length,1);
    });

    await test('about shows the installed version and opens links through native IPC', fixture => {
      fixture.state.version = '8.7.6';
    }, async page => {
      await page.locator('#settings-open').click();
      await page.getByRole('button', { name: '关于壁纸盒子', exact: true }).click();
      const about = page.getByRole('dialog', { name: '关于壁纸盒子', exact: true });
      await visible(about);
      assert.equal(await page.locator('#about-version').textContent(), '8.7.6');
      assert.equal(await about.locator('img').evaluate(image => image.complete && image.naturalWidth > 0), true);
      assert.match(await about.textContent(), /作者 · whoarei/);
      await about.getByRole('link', { name: /项目主页/ }).click();
      await about.getByRole('link', { name: /问题反馈/ }).click();
      await about.locator('summary').click();
      assert.match(await about.textContent(), /MIT \/ Apache-2.0/);
      await about.getByRole('link', { name: /Tauri/ }).click();
      await about.getByRole('link', { name: /Microsoft Edge WebView2/ }).click();
      assert.deepEqual(await actions(page), ['project', 'issues', 'tauri', 'webview2'].map(link => ({
        command: 'open_about_link', args: { link },
      })));
      for (const [width, height] of [[1080, 760], [780, 600]]) {
        await page.setViewportSize({ width, height });
        const box = await about.boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height,
          `About stays inside ${width}x${height}: ${JSON.stringify(box)}`);
        await noHorizontalOverflow(page, `about at ${width}x${height}`);
      }
      await screenshot(page, 'about-licenses');
      await page.keyboard.press('Escape');
      assert.equal(await about.isVisible(), false);
      assert.equal(await page.locator('#settings-dialog').isVisible(), true);
      assert.equal(await page.locator('#about-open').evaluate(button => button === document.activeElement), true);
    });

    await test('tray about events reuse the same panel without changing playback', null, async page => {
      await page.evaluate(() => { window.__uiTest.emit('show-about'); window.__uiTest.emit('show-about'); });
      const about = page.getByRole('dialog', { name: '关于壁纸盒子', exact: true });
      await visible(about);
      assert.equal(await page.locator('#settings-dialog').isVisible(), false);
      assert.equal(await page.locator('#about-version').textContent(), '0.2.0');
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.deepEqual(await actions(page), []);
      await screenshot(page, 'about');
      await about.getByRole('button', { name: '关闭关于', exact: true }).click();
      assert.equal(await about.isVisible(), false);
      await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
    });

    await test('resource usage explains its five-second scope and remains measured while paused', null, async page => {
      assert.equal(await page.locator('#resource-cpu').textContent(), '1.2%');
      assert.equal(await page.locator('#resource-memory').textContent(), '128 MB');
      await page.locator('#current-resources summary').click();
      await visible(page.locator('.resource-explanation'));
      assert.match(await page.locator('.resource-explanation').textContent(), /每 5 秒更新/);
      assert.match(await page.locator('.resource-explanation').textContent(), /专用工作集/);
      await screenshot(page, 'resource-usage-explanation');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.resource-explanation').isVisible(), false);
      await page.locator('#pause').click();
      await page.waitForFunction(() => document.getElementById('current-status').textContent === '已暂停');
      assert.equal(await page.locator('#resource-cpu').textContent(), '1.2%');
      assert.equal(await page.locator('#resource-memory').textContent(), '128 MB');
    });

    await test('resource usage follows the selected screen and disappears when its wallpaper closes', fixture => {
      fixture.state.wallpapers.push({ display_id: 'secondary', module_id: 'pinewind-town', name: '松风镇',
        paused: false, auto_paused: false,
        resources: { status: 'ready', cpu_percent: 0, memory_bytes: 536870912 } });
    }, async page => {
      await monitorChoice(page, 'secondary').click();
      await page.waitForFunction(() => document.getElementById('resource-memory').textContent === '512 MB');
      assert.equal(await page.locator('#resource-cpu').textContent(), '0.0%');
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await page.locator('#remove').click();
      await page.locator('#current-resources').waitFor({ state: 'hidden' });
      await monitorChoice(page, 'primary').click();
      await page.waitForFunction(() => document.getElementById('resource-memory').textContent === '128 MB');
      assert.equal(await page.locator('#resource-cpu').textContent(), '1.2%');
    });

    await test('resource sampling, unavailable readings and recovery never masquerade as zero', fixture => {
      fixture.state.wallpapers[0].resources = { status: 'sampling', cpu_percent: null, memory_bytes: 67108864 };
    }, async page => {
      assert.equal(await page.locator('#resource-cpu').textContent(), '采样中');
      assert.equal(await page.locator('#resource-memory').textContent(), '64 MB');
      await page.evaluate(() => window.__uiTest.setResources('primary', {
        status: 'unavailable', cpu_percent: null, memory_bytes: null,
      }));
      await page.waitForFunction(() => document.getElementById('resource-cpu').textContent === '暂不可用');
      assert.equal(await page.locator('#resource-memory').textContent(), '暂不可用');
      await page.evaluate(() => window.__uiTest.setResources('primary', {
        status: 'ready', cpu_percent: 0, memory_bytes: 0,
      }));
      await page.waitForFunction(() => document.getElementById('resource-cpu').textContent === '0.0%');
      assert.equal(await page.locator('#resource-memory').textContent(), '0 MB');
    });

    await test('hidden manager stops polling and refreshes on reopening', null, async page => {
      const before = await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        document.dispatchEvent(new Event('visibilitychange'));
        return window.__uiTest.calls.filter(call => call.command === 'get_state').length;
      });
      await page.waitForTimeout(1600);
      const hidden = await page.evaluate(() => window.__uiTest.calls.filter(call => call.command === 'get_state').length);
      assert.equal(hidden, before);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, value: false });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(before => window.__uiTest.calls.filter(call => call.command === 'get_state').length > before, before);
    });

    await test('playback controls remain reachable while browsing a larger collection', fixture => {
      for (let index = 0; index < 14; index++) fixture.state.modules.push({
        ...fixture.state.modules[0], id: `scene-${index}`, name: `本地场景 ${index + 1}`,
      });
    }, async page => {
      async function controlsOnScreen() {
        const bounds = await page.locator('.current').boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 600, JSON.stringify(bounds));
        assert.equal(await page.locator('#pause').isVisible(), true);
      }
      await controlsOnScreen();
      await page.mouse.wheel(0, 600);
      await controlsOnScreen();
      await page.locator('#pause').click();
      await page.waitForFunction(() => document.getElementById('current-status').textContent === '已暂停');
      assert.deepEqual(await actions(page), [{ command: 'pause_wallpaper', args: { monitorId: 'primary', paused: true } }]);
    });

    await test('cover applies in one click while preview leaves desktop assignments untouched', null, async page => {
      await page.getByRole('button', { name: '预览松风镇', exact: true }).click();
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.deepEqual(await actions(page), [{ command: 'preview_wallpaper', args: { moduleId: 'pinewind-town' } }]);
      await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      assert.equal(await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).isDisabled(), true);
      assert.deepEqual(await actions(page), [
        { command: 'preview_wallpaper', args: { moduleId: 'pinewind-town' } },
        { command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'pinewind-town' } },
      ]);
    });

    await test('screen selection, empty playback, removal and reload preserve the other screen', null, async page => {
      await monitorChoice(page, 'secondary').click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent.includes('尚未设置'));
      assert.equal(await page.locator('#pause').isVisible(), false);
      await page.getByRole('button', { name: '将松风镇应用到副显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await page.locator('#reload').click();
      await page.waitForFunction(() => !document.querySelector('#displays .monitor-choice').disabled);
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await page.locator('#remove').click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent.includes('尚未设置'));
      await monitorChoice(page, 'primary').click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '水族箱');
      assert.deepEqual((await page.evaluate(() => window.__uiTest.state())).wallpapers.map(item => item.display_id), ['primary']);
      assert.deepEqual((await actions(page)).filter(call => call.command === 'apply_wallpaper'), [
        { command: 'apply_wallpaper', args: { monitorId: 'secondary', moduleId: 'pinewind-town' } },
        { command: 'apply_wallpaper', args: { monitorId: 'secondary', moduleId: 'pinewind-town' } },
      ]);
    });

    await test('settings import actions respect picker cancellation and retain failures beside the controls', null, async page => {
      await page.locator('#settings-open').click();
      await page.locator('#import-folder').click();
      await page.waitForFunction(() => !document.getElementById('import-folder').disabled);
      assert.equal(await page.locator('#settings-dialog').isVisible(), true);
      assert.equal(await page.locator('#import-dialog').count(), 0);
      assert.equal(await page.locator('#toast').getAttribute('class'), 'toast', 'Canceling must not claim a successful import');
      await page.locator('#import-zip').click();
      await visible(page.locator('#import-error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#import-error').textContent(), /ZIP 文件无效/);
      assert.equal(await page.locator('#modules .module').count(), 2);
      assert.deepEqual(await actions(page), [
        { command: 'import_wallpaper', args: { kind: 'folder' } },
        { command: 'import_wallpaper', args: { kind: 'zip' } },
      ]);
    });

    await test('successful settings import returns to the local gallery without applying wallpaper', fixture => {
      fixture.importedModule = { ...fixture.state.modules[1], id: 'imported-scene', name: '导入的风景', source: 'local' };
    }, async page => {
      await page.locator('#tab-online').click();
      await page.locator('#settings-open').click();
      await page.locator('#import-folder').click();
      await page.waitForFunction(() => !document.getElementById('settings-dialog').open);
      assert.equal(await page.locator('#local-panel').isVisible(), true);
      await visible(moduleCard(page, '#modules', '导入的风景'));
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.equal((await actions(page)).filter(call => call.command === 'apply_wallpaper').length, 0);
    });

    await test('monitor thumbnails show each assignment, preserve portrait shape and select without applying', fixture => {
      fixture.state.service = '';
      for (const [index, module] of fixture.state.modules.entries()) {
        module.cover = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="${index ? '#cbdcbb' : '#478580'}"/></svg>`);
      }
      Object.assign(fixture.state.displays[1], { width: 1080, height: 1920 });
      fixture.state.wallpapers.push({ display_id: 'secondary', module_id: 'pinewind-town', name: '松风镇', paused: false, auto_paused: false });
    }, async page => {
      const primary = monitorChoice(page, 'primary'), secondary = monitorChoice(page, 'secondary');
      assert.equal(await primary.getAttribute('aria-pressed'), 'true');
      assert.equal(await secondary.getAttribute('aria-pressed'), 'false');
      assert.notEqual(await primary.locator('img').getAttribute('src'), await secondary.locator('img').getAttribute('src'));
      const shape = await secondary.locator('.monitor-screen').boundingBox();
      assert.ok(shape.height > shape.width, 'Portrait screens retain their orientation');
      await secondary.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelector('[data-monitor-id="secondary"]').getAttribute('aria-pressed') === 'true');
      assert.equal(await page.locator('#current-title').textContent(), '松风镇');
      assert.equal(await secondary.evaluate(node => node === document.activeElement), true);
      await page.waitForTimeout(1150);
      assert.equal(await secondary.evaluate(node => node === document.activeElement), true, 'Polling retains keyboard focus');
      await secondary.click();
      assert.deepEqual(await actions(page), [{ command: 'select_monitor', args: { monitorId: 'secondary' } }]);
      await screenshot(page, 'monitor-thumbnails');
      const cover = await primary.locator('img').getAttribute('src');
      await moduleCard(page, '#modules', '水族箱').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(cover => document.querySelector('[data-monitor-id="secondary"] img')?.getAttribute('src') === cover, cover);
      assert.equal(await primary.locator('img').getAttribute('src'), cover, 'Updating the chosen screen preserves the other thumbnail');
    });

    await test('a large monitor group scrolls locally and handles disconnecting and reconnecting screens', fixture => {
      for (let i = 3; i <= 9; i++) fixture.state.displays.push({
        ...fixture.state.displays[1], id: `screen-${i}`, name: `显示器 ${i}`,
      });
    }, async page => {
      assert.equal(await page.locator('#displays .monitor-choice').count(), 9);
      const last = monitorChoice(page, 'screen-9');
      await last.focus();
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.__uiTest.state().selected_monitor === 'screen-9');
      const bounds = await page.locator('#displays').evaluate(node => ({ width: node.clientWidth, scroll: node.scrollWidth }));
      assert.ok(bounds.scroll > bounds.width, 'Extra screens scroll inside the selector');
      await noHorizontalOverflow(page, 'nine monitor thumbnails');
      const primary = (await page.evaluate(() => window.__uiTest.state())).displays[0];
      await page.evaluate(display => window.__uiTest.setDisplays([display]), primary);
      await page.waitForFunction(() => document.querySelectorAll('#displays .monitor-choice').length === 1);
      assert.equal(await monitorChoice(page, 'primary').getAttribute('aria-pressed'), 'true');
      await page.evaluate(() => window.__uiTest.setDisplays([]));
      await page.waitForFunction(() => document.querySelector('#displays').textContent.includes('未检测到'));
      assert.equal(await page.locator('#modules .apply').first().isDisabled(), true);
      await page.evaluate(display => window.__uiTest.setDisplays([display]), primary);
      await page.waitForFunction(() => document.querySelector('[data-monitor-id="primary"]')?.getAttribute('aria-pressed') === 'true');
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
    });

    await test('settings invokes the existing pause, scan and folder commands without changing wallpaper', null, async page => {
      await page.locator('#settings-open').click();
      await page.locator('#auto-pause').uncheck();
      await page.waitForFunction(() => !document.getElementById('auto-pause').disabled);
      assert.equal(await page.locator('#auto-pause').isChecked(), false);
      await page.locator('#refresh').click();
      await page.waitForFunction(() => !document.getElementById('refresh').disabled);
      assert.equal(await page.locator('#toast').evaluate(node => node.matches(':popover-open')), true,
        'Feedback must remain visible above the modal settings dialog');
      await page.locator('#open-folder').click();
      await screenshot(page, 'settings');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#settings-dialog').isVisible(), false);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.deepEqual(await actions(page), [
        { command: 'auto_pause', args: { enabled: false } },
        { command: 'refresh_modules', args: {} },
        { command: 'open_wallpaper_folder', args: {} },
      ]);
    });

    await test('default discovery requests only Gitee and keeps GitHub disabled', null, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      assert.equal(await page.locator('#repository-url-0').inputValue(), 'https://gitee.com/xishuaiya/wallpapers');
      assert.equal(await page.getByRole('switch', { name: '启用仓库 1', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('switch', { name: '启用仓库 2', exact: true }).isChecked(), false);
      assert.equal(await page.locator('#save-repositories').isDisabled(), true);
      await page.keyboard.press('Escape');await page.locator('#tab-online').click();
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://gitee.com/xishuaiya/wallpapers']);
      assert.match(await moduleCard(page, '#online-modules', '通往别处的窗户').getAttribute('title'), /来源：gitee.com\/xishuaiya\/wallpapers/);
    });

    await test('custom repository drafts survive polling and normalized ordering persists after reload', fixture => {
      fixture.persistRepositories = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();await page.locator('#add-repository').click();
      await page.locator('#repository-url-2').fill('https://github.com/example/custom.git');
      await page.waitForTimeout(1150);
      assert.equal(await page.locator('#repository-url-2').inputValue(), 'https://github.com/example/custom.git');
      await page.getByRole('button', { name: '上移仓库 3', exact: true }).click();
      await page.getByRole('button', { name: '上移仓库 2', exact: true }).click();
      assert.equal(await page.locator('#repository-url-0').inputValue(), 'https://github.com/example/custom.git');
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('repositories-status').textContent.includes('已保存'));
      assert.equal(await page.locator('#repository-url-0').inputValue(), 'https://github.com/example/custom');
      assert.equal(await page.locator('#save-repositories').isDisabled(), true);
      await page.setViewportSize({width:1080,height:900});
      await page.locator('#repositories-title').scrollIntoViewIfNeeded();await screenshot(page,'wallpaper-repositories');
      await page.reload();await ready(page);await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      assert.equal(await page.locator('#repository-url-0').inputValue(), 'https://github.com/example/custom');
      await page.getByRole('button', { name: '移除仓库 3', exact: true }).click();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      assert.equal(await page.locator('.repository-row').count(), 2);
      await page.keyboard.press('Escape');await page.locator('#tab-online').click();
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://github.com/example/custom','https://gitee.com/xishuaiya/wallpapers']);
    });

    await test('disabling all repositories skips discovery requests and preserves downloaded wallpapers', fixture => {
      fixture.state.modules[0].source = 'online';
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      await page.getByRole('switch', { name: '启用仓库 1', exact: true }).uncheck();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      await page.keyboard.press('Escape');await page.locator('#tab-online').click();
      assert.equal(await page.locator('#check-online').isDisabled(), true);
      assert.match(await page.locator('#online-empty').textContent(), /添加或启用/);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), []);
      assert.equal(await page.evaluate(() => window.__uiTest.state().modules.length), 2);
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      await page.getByRole('switch', { name: '启用仓库 2', exact: true }).check();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      await page.keyboard.press('Escape');await page.locator('#tab-local').click();await page.locator('#tab-online').click();
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://github.com/whoarei/wallpapers']);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
    });

    await test('a failed repository still shows healthy repositories and its own error', fixture => {
      fixture.state.wallpaper_repositories[1].enabled = true;
      fixture.sourceFailures = ['https://gitee.com/xishuaiya/wallpapers'];
    }, async page => {
      await page.locator('#tab-online').click();
      const card=moduleCard(page,'#online-modules','通往别处的窗户');await visible(card);
      assert.match(await card.getAttribute('title'), /来源：github.com\/whoarei\/wallpapers/);
      await visible(page.locator('#online-error'));assert.match(await page.locator('#online-error').textContent(), /gitee.com.*仓库暂时不可用/);
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      assert.match(await page.locator('.repository-source-status').first().textContent(), /仓库暂时不可用/);
      assert.match(await page.locator('.repository-source-status').nth(1).textContent(), /3 张壁纸/);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
    });

    await test('duplicate wallpaper IDs follow repository order and switching off removes stale results', fixture => {
      fixture.state.wallpaper_repositories[1].enabled = true;
      fixture.sourceCatalogs = {'https://github.com/whoarei/wallpapers':JSON.parse(JSON.stringify(fixture.catalog))};
      fixture.sourceCatalogs['https://github.com/whoarei/wallpapers'].wallpapers[0].version = '2.0.0';
    }, async page => {
      await page.locator('#tab-online').click();
      const card=moduleCard(page,'#online-modules','水族箱');await visible(card);
      assert.equal(await page.locator('#online-modules .module').count(),3);
      assert.match(await card.getAttribute('title'), /来源：gitee.com/);assert.match(await card.textContent(), /v1.1.0/);
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();await page.getByRole('button',{name:'上移仓库 2',exact:true}).click();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      await page.keyboard.press('Escape');
      assert.match(await card.getAttribute('title'), /来源：github.com/);assert.match(await card.textContent(), /v2.0.0/);
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      await page.getByRole('switch',{name:'启用仓库 1',exact:true}).uncheck();await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);await page.keyboard.press('Escape');
      assert.match(await card.getAttribute('title'), /来源：gitee.com/);assert.match(await card.textContent(), /v1.1.0/);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://gitee.com/xishuaiya/wallpapers','https://github.com/whoarei/wallpapers']);
    });

    await test('failed repository saves retain edited addresses and enable switches', fixture => {
      fixture.failRepositorySave = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      await page.locator('#repository-url-0').fill('https://gitee.com/example/custom.git');
      await page.getByRole('switch',{name:'启用仓库 1',exact:true}).uncheck();
      await page.locator('#save-repositories').click();await visible(page.locator('#repositories-error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#repositories-error').textContent(), /保存失败/);
      assert.equal(await page.locator('#repository-url-0').inputValue(),'https://gitee.com/example/custom.git');
      assert.equal(await page.getByRole('switch',{name:'启用仓库 1',exact:true}).isChecked(),false);
      assert.equal(await page.locator('#save-repositories').isEnabled(),true);
      assert.deepEqual((await page.evaluate(() => window.__uiTest.state())).wallpaper_repositories[0],{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true});
    });

    await test('old settings default to system proxy and unsaved drafts survive polling', fixture => {
      delete fixture.state.proxy;
      fixture.persistProxy = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      assert.equal(await page.locator('#proxy-mode').inputValue(), 'system');
      assert.equal(await page.locator('#proxy-manual').isVisible(), false);
      assert.equal(await page.locator('#save-proxy').isDisabled(), true);
      await page.locator('#proxy-mode').selectOption('manual');
      await page.locator('#proxy-url').fill('socks5h://127.0.0.1:1080');
      await page.waitForTimeout(1150);
      assert.equal(await page.locator('#proxy-url').inputValue(), 'socks5h://127.0.0.1:1080');
      assert.equal(await page.locator('#proxy-mode').inputValue(), 'manual');
      assert.deepEqual(await actions(page), [], 'Editing must not change the active proxy');
      await screenshot(page, 'proxy-manual-draft');
      await page.locator('#save-proxy').click();
      await page.waitForFunction(() => document.getElementById('proxy-status').textContent.includes('已保存'));
      assert.equal(await page.locator('#proxy-url').inputValue(), 'socks5h://127.0.0.1:1080');
      assert.equal(await page.locator('#save-proxy').isDisabled(), true);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      await page.reload();await ready(page);await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      assert.equal(await page.locator('#proxy-mode').inputValue(), 'manual');
      assert.equal(await page.locator('#proxy-url').inputValue(), 'socks5h://127.0.0.1:1080');
      await page.locator('#proxy-mode').selectOption('direct');
      await page.locator('#save-proxy').click();
      await page.waitForFunction(() => document.getElementById('save-proxy').disabled);
      assert.equal(await page.locator('#proxy-manual').isVisible(), false);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.state().proxy), { mode: 'direct', url: '' });
      await page.locator('#proxy-mode').selectOption('system');
      await page.locator('#save-proxy').click();
      await page.waitForFunction(() => document.getElementById('save-proxy').disabled);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.state().proxy), { mode: 'system', url: '' });
    });

    await test('proxy connection test uses the draft without saving and blocks duplicate submissions', fixture => {
      fixture.deferProxyTest = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      await page.locator('#proxy-mode').selectOption('manual');
      await page.locator('#proxy-url').fill('http://127.0.0.1:7890');
      await page.locator('#test-proxy').evaluate(button => { button.click();button.click(); });
      await page.waitForFunction(() => document.getElementById('test-proxy').disabled);
      assert.equal(await page.locator('#proxy-mode').isDisabled(), true);
      assert.equal(await page.locator('#save-proxy').isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.state().proxy), { mode: 'system', url: '' });
      await page.evaluate(() => window.__uiTest.finishOperation());
      await page.waitForFunction(() => document.getElementById('proxy-status').textContent.includes('尚未保存'));
      assert.equal(await page.locator('#save-proxy').isEnabled(), true);
      assert.deepEqual(await actions(page), [{ command: 'test_proxy', args: { proxy: { mode: 'manual', url: 'http://127.0.0.1:7890' } } }]);
    });

    await test('empty proxy addresses and failed saves keep drafts and the active configuration', fixture => {
      fixture.failProxySave = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      await page.locator('#proxy-mode').selectOption('manual');
      await page.locator('#save-proxy').click();
      await visible(page.locator('#proxy-error'));
      assert.deepEqual(await actions(page), []);
      await page.locator('#proxy-url').fill('http://127.0.0.1:7890');
      await page.locator('#save-proxy').click();
      await page.waitForFunction(() => document.getElementById('proxy-error').textContent.includes('保存失败'));
      await page.waitForTimeout(1150);
      assert.equal(await page.locator('#proxy-url').inputValue(), 'http://127.0.0.1:7890');
      assert.equal(await page.locator('#save-proxy').isEnabled(), true);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.state().proxy), { mode: 'system', url: '' });
    });

    await test('proxy test errors persist without blocking offline playback', fixture => {
      fixture.failProxyTest = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      await page.locator('#test-proxy').click();
      await visible(page.locator('#proxy-error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#proxy-error').textContent(), /连接 GitHub 失败/);
      assert.equal(await page.locator('#test-proxy').isEnabled(), true);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
    });

    await test('online covers load through native IPC and reload after proxy changes', fixture => {
      fixture.catalog.wallpapers[2].coverUrl = 'https://github.com/whoarei/wallpapers/releases/download/library-v1.1.0/window-to-elsewhere-1.0.0-cover.png';
    }, async page => {
      await page.locator('#tab-online').click();
      const cover = moduleCard(page, '#online-modules', '通往别处的窗户').locator('img');
      await cover.waitFor();
      await page.waitForFunction(() => document.querySelector('#online-modules img')?.naturalWidth > 0);
      assert.match(await cover.getAttribute('src'), /^data:image\/png;base64,/);
      await page.locator('#settings-open').click();await page.locator('#settings-tab-proxy').click();
      await page.locator('#proxy-mode').selectOption('direct');
      await page.locator('#save-proxy').click();
      await page.waitForFunction(() => window.__uiTest.calls.filter(call => call.command === 'load_online_cover').length === 2);
      assert.deepEqual((await actions(page)).filter(call => call.command === 'load_online_cover'), [
        { command: 'load_online_cover', args: { moduleId: 'window-to-elsewhere' } },
        { command: 'load_online_cover', args: { moduleId: 'window-to-elsewhere' } },
      ]);
    });

    await test('failed native cover downloads retain a usable wallpaper card', fixture => {
      fixture.failCover = true;
      fixture.catalog.wallpapers[2].coverUrl = 'https://github.com/whoarei/wallpapers/releases/download/library-v1.1.0/window-to-elsewhere-1.0.0-cover.png';
    }, async page => {
      await page.locator('#tab-online').click();
      const card = moduleCard(page, '#online-modules', '通往别处的窗户');
      await visible(card.locator('.cover-fallback'));
      assert.equal(await card.getByRole('button', { name: '下载壁纸', exact: true }).isEnabled(), true);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
    });

    await test('pending apply blocks duplicate clicks and monitor changes until native completion', fixture => {
      fixture.deferApply = true;
    }, async page => {
      await page.evaluate(() => {
        const button = document.querySelector('[aria-label="将松风镇应用到主显示器"]');
        button.click(); button.click();
      });
      assert.equal(await monitorChoice(page, 'primary').isDisabled(), true);
      assert.equal(await page.locator('#pause').isDisabled(), true);
      assert.equal((await actions(page)).filter(call => call.command === 'apply_wallpaper').length, 1);
      await page.evaluate(() => window.__uiTest.finishOperation());
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      assert.equal(await monitorChoice(page, 'primary').isEnabled(), true);
    });

    await test('pending downloads still show polled progress and allow local wallpaper changes', fixture => {
      fixture.deferInstall = true;
    }, async page => {
      await page.locator('#tab-online').click();
      await moduleCard(page, '#online-modules', '通往别处的窗户').getByRole('button', { name: '下载壁纸', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#online-modules .task-progress')?.value === 50);
      assert.equal(await page.locator('#download-filter').isVisible(), true);
      await page.locator('#tab-local').click();
      await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.evaluate(() => window.__uiTest.finishOperation());
      await page.waitForFunction(() => document.getElementById('module-count').textContent === '03');
      assert.equal(await page.locator('#current-title').textContent(), '松风镇');
      assert.equal(await page.locator('#download-filter').isVisible(), false);
    });

    await test('five downloads run together while later tasks queue and removal preserves order', parallelDownloads, async page => {
      await page.locator('#tab-online').click();
      const ids = await page.locator('#online-modules .download').evaluateAll(buttons => buttons.map(b => b.dataset.moduleId));
      for (const id of ids.slice(0, 7)) {
        const button = page.locator(`#online-modules .download[data-module-id="${id}"]`);
        assert.equal(await button.isEnabled(), true, 'Other cards remain available during downloads');
        await button.click();
      }
      await page.waitForFunction(() => window.__uiTest.state().downloads.length === 7);
      const tasks = (await page.evaluate(() => window.__uiTest.state())).downloads;
      assert.equal(tasks.filter(t => t.phase === 'downloading').length, 5);
      assert.deepEqual(tasks.filter(t => t.phase === 'queued').map(t => [t.id, t.queue_position]), [[ids[5], 1], [ids[6], 2]]);
      assert.match(await page.locator('#download-filter').textContent(), /下载中 5 · 等待 2/);
      const queued = page.locator(`#online-modules [data-download-id="${ids[5]}"]`);
      await queued.hover();
      await queued.getByRole('button', { name: /移出队列/ }).click();
      await page.waitForFunction(id => !window.__uiTest.state().downloads.some(t => t.id === id), ids[5]);
      assert.match(await page.locator(`#online-modules [data-download-id="${ids[6]}"]`).textContent(), /第 1 项/);
      assert.equal(await page.locator('#transfer').count(), 0, 'No independent transfer panel');
      for (const [width, height] of [[1080, 760], [780, 600]]) {
        await page.setViewportSize({ width, height });
        await page.evaluate(() => scrollTo(0, 0));
        const bounds = await page.evaluate(() => ({
          task: document.querySelector('#online-modules .download-task').getBoundingClientRect().bottom,
          player: document.querySelector('.current').getBoundingClientRect().top,
        }));
        assert.ok(bounds.task < bounds.player, `Progress and controls fit above playback at ${width}x${height}: ${JSON.stringify(bounds)}`);
        await noHorizontalOverflow(page, `parallel downloads at ${width}x${height}`);
        await screenshot(page, `parallel-downloads-${width}`);
      }
    });

    await test('hover and keyboard cancellation preserve focus during progress and await worker shutdown', parallelDownloads, async page => {
      await page.locator('#tab-online').click();
      const ids = await page.locator('#online-modules .download').evaluateAll(buttons => buttons.map(b => b.dataset.moduleId));
      for (const id of ids.slice(0, 6)) await page.locator(`#online-modules .download[data-module-id="${id}"]`).click();
      const slot = page.locator(`#online-modules [data-download-id="${ids[0]}"]`);
      const cancel = slot.getByRole('button', { name: /取消下载/ });
      await page.mouse.move(0, 0);
      await page.waitForFunction(id => getComputedStyle(document.querySelector(`#online-modules [data-download-id="${id}"] .task-action`)).opacity === '0', ids[0]);
      await cancel.focus();
      await page.waitForFunction(() => getComputedStyle(document.activeElement).opacity === '1');
      await cancel.evaluate(button => { window.__focusedCancel = button; });
      await page.evaluate(id => window.__uiTest.setDownload(id, { received: 9258, speed: 2048 }), ids[0]);
      await page.waitForFunction(() => document.querySelector('#online-modules .task-progress').value === 75);
      assert.equal(await cancel.evaluate(button => button === window.__focusedCancel && button === document.activeElement), true);
      await page.keyboard.press('Enter');
      await page.waitForFunction(id => window.__uiTest.state().downloads.find(t => t.id === id).phase === 'cancelling', ids[0]);
      assert.match(await slot.textContent(), /正在取消/);
      assert.equal((await page.evaluate(() => window.__uiTest.state())).downloads.find(t => t.id === ids[5]).phase, 'queued');
      await page.evaluate(id => window.__uiTest.finishCancellation(id), ids[0]);
      await page.waitForFunction(id => document.querySelector(`#online-modules [data-download-id="${id}"]`)?.dataset.phase === 'downloading', ids[5]);
      assert.equal((await page.evaluate(() => window.__uiTest.state())).downloads.filter(t => t.phase === 'downloading').length, 5);
    });

    await test('failed downloads retain their target and expose retry while other cards keep running', parallelDownloads, async page => {
      await page.locator('#tab-online').click();
      await page.locator('#online-modules .download[data-module-id="window-to-elsewhere"]').click();
      await page.locator('#online-modules .download[data-module-id="scene-4"]').click();
      await page.evaluate(() => {
        window.__uiTest.failDownload('window-to-elsewhere', '连接中断，原壁纸已保留');
        const items = window.__uiTest.state().online.catalog.wallpapers;
        items.find(t => t.id === 'window-to-elsewhere').version = '2.0.0';
        window.__uiTest.setCatalog(items);
      });
      const remote = moduleCard(page, '#online-modules', '通往别处的窗户');
      const retry = remote.getByRole('button', { name: '重试通往别处的窗户', exact: true });
      await visible(retry);
      await page.mouse.move(0, 0);
      assert.equal(await retry.evaluate(button => getComputedStyle(button).opacity), '1');
      assert.match(await remote.textContent(), /连接中断，原壁纸已保留/);
      assert.match(await remote.textContent(), /v1\.0\.0/);
      assert.doesNotMatch(await remote.textContent(), /v2\.0\.0/);
      assert.equal((await page.evaluate(() => window.__uiTest.state())).downloads.find(t => t.id === 'scene-4').phase, 'downloading');
      await screenshot(page, 'download-failure');
      await retry.click();
      await page.waitForFunction(() => window.__uiTest.state().downloads.find(t => t.id === 'window-to-elsewhere').phase === 'downloading');
      assert.equal((await page.evaluate(() => window.__uiTest.state())).downloads.find(t => t.id === 'window-to-elsewhere').item.version, '1.0.0');
      await page.evaluate(() => window.__uiTest.failDownload('window-to-elsewhere'));
      await visible(remote.getByRole('button', { name: '移除失败记录：通往别处的窗户', exact: true }));
      await remote.hover();
      await remote.getByRole('button', { name: '移除失败记录：通往别处的窗户', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#online-modules [data-card-key="window-to-elsewhere"]').textContent.includes('v2.0.0'));
    });

    await test('the header filters the discovery grid and tasks survive a changed catalog', parallelDownloads, async page => {
      await page.locator('#tab-online').click();
      await page.locator('#online-modules .download[data-module-id="window-to-elsewhere"]').click();
      await page.locator('#online-modules .download[data-module-id="scene-4"]').click();
      await page.evaluate(() => {
        window.__uiTest.failDownload('scene-4');
        window.__uiTest.setCatalog([]);
      });
      await page.locator('#tab-local').click();
      await page.locator('#download-filter').click();
      assert.equal(await page.locator('#online-panel').isVisible(), true);
      assert.equal(await page.locator('#download-filter').getAttribute('aria-pressed'), 'true');
      await page.waitForFunction(() => document.querySelectorAll('#online-modules .module').length === 2);
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      await visible(moduleCard(page, '#online-modules', '风景 4'));
      assert.equal((await actions(page)).filter(c => c.command === 'check_online').length, 1, 'Filtering must not fetch another catalog');
      await page.evaluate(() => window.__uiTest.completeDownload('window-to-elsewhere'));
      await page.waitForFunction(() => document.querySelectorAll('#online-modules .module').length === 1);
      await page.locator('#clear-download-filter').click();
      assert.equal(await page.locator('#download-filter').getAttribute('aria-pressed'), 'false');
      await page.locator('#tab-local').click();
      assert.equal(await page.locator('#download-filter').getAttribute('aria-pressed'), 'false');
    });

    await test('100 percent waits for verified installation and completion never switches playback', fixture => {
      fixture.deferInstall = true;
    }, async page => {
      await page.locator('#tab-online').click();
      const remote = moduleCard(page, '#online-modules', '通往别处的窗户');
      await remote.getByRole('button', { name: '下载壁纸', exact: true }).click();
      for (const [phase, label] of [['verifying', '校验中'], ['waiting_install', '等待安装'], ['installing', '安装中']]) {
        await page.evaluate(phase => window.__uiTest.setDownload('window-to-elsewhere', { phase, received: 12344 }), phase);
        await page.waitForFunction(label => document.querySelector('#online-modules [data-download-id="window-to-elsewhere"] .task-label')?.textContent === label+' · v1.0.0', label);
        assert.equal(await remote.getByRole('button', { name: '应用壁纸', exact: true }).count(), 0);
        assert.equal(await remote.locator('.task-action').isVisible(), false);
        assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      }
      await page.evaluate(() => window.__uiTest.completeDownload('window-to-elsewhere'));
      await visible(remote.getByRole('button', { name: '应用壁纸', exact: true }));
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.equal((await actions(page)).filter(c => c.command === 'apply_wallpaper').length, 0);
      await remote.getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '通往别处的窗户');
    });

    await test('preview errors remain visible without changing playback or auto pause', fixture => {
      fixture.failPreview = true;
    }, async page => {
      await page.getByRole('button', { name: '预览松风镇', exact: true }).click();
      await visible(page.locator('#error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#error').textContent(), /打开预览失败/);
      assert.equal(await page.locator('#current-title').textContent(), '水族箱');
      assert.equal((await page.evaluate(() => window.__uiTest.state())).auto_pause, true);
      assert.deepEqual(await actions(page), [{ command: 'preview_wallpaper', args: { moduleId: 'pinewind-town' } }]);
    });

    await test('version dropdown downloads the selected historical version and retries that version', fixture => {
      wallpaperHistory(fixture);
      fixture.coverData = {};
      for (const id of ['aquarium', 'pinewind-town']) {
        fixture.coverData[id] = 'data:image/jpeg;base64,'+fs.readFileSync(path.resolve(__dirname, '../wallpapers', id, 'cover.jpg')).toString('base64');
        fixture.catalog.wallpapers.find(item=>item.id===id).coverUrl = `https://gitee.com/xishuaiya/wallpapers/releases/download/library-v1.1.0/${id}-cover.jpg`;
      }
    }, async page => {
      await page.locator('#tab-online').click();
      const card=moduleCard(page,'#online-modules','水族箱'),menu=page.locator('#wallpaper-versions');
      await card.locator('.version-trigger').focus();await page.keyboard.press('ArrowDown');
      await visible(menu.getByRole('option').filter({hasText:'v1.0.0'}));
      assert.equal(await menu.getByRole('option').filter({hasText:'v1.0.0'}).evaluate(node=>node===document.activeElement),true,'The first keyboard-opened list focuses an available version after loading');
      assert.equal(await menu.getByRole('option').filter({hasText:'v1.1.0'}).isDisabled(),true);
      assert.equal(await page.locator('dialog[open]').count(),0,'Version selection must not open a modal');
      await page.waitForTimeout(1150);
      assert.equal(await menu.evaluate(node=>node.matches(':popover-open')),true,'Polling keeps the version list open');
      await menu.getByRole('button',{name:'更早版本 ↓',exact:true}).click();
      const older=menu.getByRole('option').filter({hasText:'v0.9.0'});await visible(older);
      assert.equal(await menu.getByRole('option').filter({hasText:'v1.0.0'}).count(),1,'Repeated library releases must not duplicate versions');
      await screenshot(page,'history-list');
      await older.click();
      await visible(card.getByRole('progressbar'));
      assert.equal((await page.evaluate(()=>window.__uiTest.state())).modules[0].version,'1.1.0');
      assert.match(await page.locator('#toast').textContent(),/正在下载 v0.9.0.*替换当前版本/);
      const install=(await actions(page)).filter(call=>call.command==='install_online');
      assert.deepEqual(install,[{command:'install_online',args:{moduleId:'aquarium',version:'0.9.0',repository:'https://gitee.com/xishuaiya/wallpapers'}}]);
      await page.evaluate(()=>{
        const items=window.__uiTest.state().online.catalog.wallpapers;items[0].version='2.0.0';window.__uiTest.setCatalog(items);
        window.__uiTest.failDownload('aquarium');
      });
      const retry=card.getByRole('button',{name:'重试水族箱',exact:true});await visible(retry);await retry.click();
      await page.waitForFunction(()=>window.__uiTest.state().downloads[0].phase==='downloading');
      assert.equal((await page.evaluate(()=>window.__uiTest.state())).downloads[0].item.version,'0.9.0');
      await screenshot(page,'history-download');
      await page.evaluate(()=>window.__uiTest.completeDownload('aquarium'));
      await page.waitForFunction(()=>document.querySelector('#online-modules [data-card-key="aquarium"] .version-trigger').textContent.includes('v0.9.0')&&!document.querySelector('#online-modules [data-card-key="aquarium"] .download-task:not([hidden])'));
      assert.match(await page.locator('#toast').textContent(),/水族箱已替换为 v0.9.0/);
      assert.equal((await actions(page)).some(call=>call.command==='apply_wallpaper'),false,'Replacing an installed version keeps monitor assignments');
    });

    await test('version history retries failures, disables incompatible entries and supports the keyboard', fixture => {
      wallpaperHistory(fixture);fixture.failHistory=true;
      const latest=fixture.catalog.wallpapers[0];
      fixture.historyPages=[{wallpapers:[latest,{...latest,version:'2.0.0',minAppVersion:'99.0.0'},{...latest,version:'0.9.0'}],next_page:null,warning:null}];
    }, async page => {
      await page.locator('#tab-online').click();
      const card=moduleCard(page,'#online-modules','水族箱'),menu=page.locator('#wallpaper-versions');
      await card.locator('.version-trigger').click();
      await menu.getByRole('button',{name:'加载未完成，点击重试',exact:true}).click();
      await visible(menu.getByRole('option').filter({hasText:'v0.9.0'}));
      assert.equal(await menu.getByRole('option').filter({hasText:'v2.0.0'}).isDisabled(),true);
      assert.match(await menu.getByRole('option').filter({hasText:'v2.0.0'}).getAttribute('title'),/99.0.0/);
      await page.locator('#collection-title').click();
      assert.equal(await menu.evaluate(node=>node.matches(':popover-open')),false);
      await card.locator('.version-trigger').focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('Escape');
      assert.equal(await card.locator('.version-trigger').evaluate(node=>node===document.activeElement),true);
      await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
      await visible(card.getByRole('progressbar'));
      assert.equal((await page.evaluate(()=>window.__uiTest.state())).downloads[0].item.version,'0.9.0');
      assert.equal((await actions(page)).filter(call=>call.command==='load_wallpaper_history').length,2,'Reopening a loaded list reuses the catalog for the selected source');
      await card.getByRole('button',{name:'取消下载：水族箱',exact:true}).click();
      await page.waitForFunction(()=>!window.__uiTest.state().downloads.length);
      assert.equal((await page.evaluate(()=>window.__uiTest.state())).modules[0].version,'1.1.0');
      await page.waitForTimeout(3200);
      assert.equal(await page.locator('#toast').evaluate(node=>node.classList.contains('show')),false,'Version notices disappear after three seconds');
    });

    await test('changing repository settings discards an in-flight history list', fixture => {
      wallpaperHistory(fixture);fixture.deferHistory=true;
    }, async page => {
      await page.locator('#tab-online').click();
      await moduleCard(page,'#online-modules','水族箱').locator('.version-trigger').click();
      await visible(page.locator('#wallpaper-versions').getByRole('status'));
      await page.locator('#settings-open').click();await page.locator('#settings-tab-repositories').click();
      await page.getByRole('switch',{name:'启用仓库 1',exact:true}).uncheck();await page.locator('#save-repositories').click();
      await page.waitForFunction(()=>document.getElementById('save-repositories').disabled);
      await page.evaluate(()=>window.__uiTest.finishOperation());await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
      assert.equal(await page.locator('#wallpaper-versions').evaluate(node=>node.matches(':popover-open')),false);
      assert.equal(await page.locator('#online-modules .module').count(),0);
      assert.equal((await actions(page)).some(call=>call.command==='install_online'),false);
    });

    await test('startup and polling never check or install wallpapers', null, async page => {
      await visible(page.locator('#local-panel'));
      await page.waitForTimeout(1150); // Exercise production polling as well as the initial get_state.
      assert.deepEqual(await actions(page), []);
      assert.equal(await page.locator('#modules .module').count(), 2);
    });

    await test('online browsing and refresh fetch only the catalog', null, async page => {
      await page.locator('#tab-online').click();
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      assert.deepEqual(await actions(page), [{ command: 'check_online', args: {} }]);
      await page.locator('#check-online').click();
      await page.waitForFunction(() => !document.getElementById('check-online').disabled);
      assert.deepEqual(await actions(page), [
        { command: 'check_online', args: {} }, { command: 'check_online', args: {} },
      ]);
      await noHorizontalOverflow(page, 'online catalog at 780x600');
      await page.locator('#tab-local').click();
      await page.locator('#tab-online').click();
      assert.deepEqual(await actions(page), Array.from({ length: 3 }, () => ({ command: 'check_online', args: {} })),
        'Returning to discovery must refresh even with a cached catalog');
      await page.locator('#tab-online').click();
      assert.deepEqual(await actions(page), Array.from({ length: 4 }, () => ({ command: 'check_online', args: {} })),
        'Clicking the selected discovery tab must also refresh once');
    });

    await test('one selected download becomes a playable local wallpaper', null, async page => {
      await page.locator('#tab-online').click();
      const remote = moduleCard(page, '#online-modules', '通往别处的窗户');
      await visible(remote);
      await remote.getByRole('button', { name: '下载壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('module-count').textContent === '03');
      assert.deepEqual((await actions(page)).filter(call => call.command === 'install_online'), [
        { command: 'install_online', args: { moduleId: 'window-to-elsewhere' } },
      ]);
      assert.deepEqual((await actions(page)).map(call => call.command), ['check_online', 'install_online']);
      assert.equal(await remote.getByRole('button', { name: '应用壁纸', exact: true }).isEnabled(), true);
      await page.locator('#tab-local').click();
      const local = moduleCard(page, '#modules', '通往别处的窗户');
      await visible(local);
      assert.match(await local.textContent(), /已下载 · v1\.0\.0/);
      await local.getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '通往别处的窗户');
      assert.deepEqual((await actions(page)).at(-1), {
        command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'window-to-elsewhere' },
      });
    });

    await test('a network failure preserves offline playback', fixture => { fixture.failCheck = true; }, async page => {
      await page.locator('#tab-online').click();
      await visible(page.locator('#online-error'));
      assert.match(await page.locator('#online-error').textContent(), /GitHub 连接失败/);
      await page.locator('#tab-local').click();
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      assert.deepEqual(await actions(page), [
        { command: 'check_online', args: {} },
        { command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'pinewind-town' } },
      ]);
    });

    await test('version updates and rollback target only the selected wallpaper', fixture => {
      fixture.state.online = { catalog: fixture.catalog, checked_at: 1794297600, cached: true, last_error: null };
    }, async page => {
      await page.locator('#tab-online').click();
      const card = moduleCard(page, '#online-modules', '水族箱');
      await visible(card);
      assert.equal(await page.locator('#update-count').textContent(), '1 可更新');
      await card.getByRole('button', { name: '更新到 v1.1.0', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('update-count').textContent !== '1 可更新');
      await page.locator('#tab-local').click();
      const local = moduleCard(page, '#modules', '水族箱');
      assert.match(await local.textContent(), /已下载 · v1\.1\.0/);
      await local.locator('.module-details summary').click();
      await local.getByRole('button', { name: '切换到上一版本', exact: true }).click();
      await page.waitForFunction(() => [...document.querySelectorAll('#modules .module')]
        .find(card => card.querySelector('h3').textContent === '水族箱').textContent.includes('内置 · v1.0.0'));
      assert.deepEqual(await actions(page), [
        { command: 'check_online', args: {} },
        { command: 'install_online', args: { moduleId: 'aquarium' } },
        { command: 'rollback_wallpaper', args: { moduleId: 'aquarium' } },
      ]);
    });

    await test('semver prereleases and build metadata govern update and compatibility buttons', fixture => {
      fixture.state.version = '0.2.0-rc.2+test';
      Object.assign(fixture.state.modules[0], { version: '1.0.0-alpha', source: 'online' });
      Object.assign(fixture.catalog.wallpapers[0], { version: '1.0.0', minAppVersion: '0.1.0' });
      Object.assign(fixture.state.modules[1], { version: '1.0.0+local', source: 'online' });
      Object.assign(fixture.catalog.wallpapers[1], { version: '1.0.0+release.2', minAppVersion: '0.1.0' });
      fixture.state.online = { catalog: fixture.catalog, checked_at: 1794297600, cached: true, last_error: null };
    }, async page => {
      await page.locator('#tab-online').click();
      const stable = moduleCard(page, '#online-modules', '水族箱');
      await visible(stable);
      assert.equal(await page.locator('#update-count').textContent(), '1 可更新',
        'A stable release must update an installed prerelease with the same numeric version');
      assert.equal(await stable.getByRole('button', { name: '更新到 v1.0.0', exact: true }).isEnabled(), true);
      const sameBuild = moduleCard(page, '#online-modules', '松风镇');
      assert.equal(await sameBuild.getByRole('button', { name: '应用壁纸', exact: true }).isEnabled(), true,
        'Build metadata must not change version precedence');
      const incompatible = moduleCard(page, '#online-modules', '通往别处的窗户');
      assert.equal(await incompatible.getByRole('button', { name: '需要程序 0.2.0', exact: true }).isDisabled(), true,
        'A prerelease of the app must not satisfy the minimum stable app version');
      assert.deepEqual(await actions(page), [{ command: 'check_online', args: {} }],
        'Opening discovery must refresh the cached catalog without downloading');
    });

    await test('a rejected rollback remains visible on the local tab after rendering and polling', fixture => {
      fixture.failRollback = true;
      Object.assign(fixture.state.modules[0], { version: '1.1.0', source: 'online', rollback_available: true });
    }, async page => {
      const local = moduleCard(page, '#modules', '水族箱');
      await local.locator('.module-details summary').click();
      await local.getByRole('button', { name: '切换到上一版本', exact: true }).click();
      await visible(page.locator('#error'));
      assert.match(await page.locator('#error').textContent(), /上一版本文件已损坏：回退失败/);
      await page.waitForTimeout(1150); // Error must survive both finally-render and native-state polling.
      assert.equal(await page.locator('#error').isVisible(), true);
      assert.match(await page.locator('#error').textContent(), /上一版本文件已损坏：回退失败/);
      assert.match(await local.textContent(), /已下载 · v1\.1\.0/, 'Failed rollback must retain the active version');
      const backend = await page.evaluate(() => window.__uiTest.state());
      assert.equal(backend.last_error, null);
      assert.equal(backend.online.last_error, null, 'This regression must exercise a UI-owned IPC rejection');
      assert.deepEqual(await actions(page), [
        { command: 'rollback_wallpaper', args: { moduleId: 'aquarium' } },
      ]);
    });

    await test('declared wallpaper operations bind a document and respect explicit occlusion policy', fixture => {
      fixture.state.wallpapers.push({display_id:'secondary',module_id:'local:custom',name:'自定义画面',
        paused:false,auto_paused:true,instance_id:'secondary-document',
        actions:[{id:'spark',label:'点亮',enabled:true,allowWhenOccluded:true}]});
    }, async page => {
      const action=page.locator('#wallpaper-action');
      await visible(action);assert.equal(await action.textContent(),'投喂鱼儿');
      await action.click();
      await monitorChoice(page,'secondary').click();
      await page.waitForFunction(()=>document.getElementById('wallpaper-action').textContent==='点亮');
      assert.equal(await action.isEnabled(),true);
      await action.click();
      await page.evaluate(()=>window.__uiTest.setWallpaper('secondary',{actions:[]}));
      await page.waitForFunction(()=>document.getElementById('wallpaper-actions').hidden);
      await monitorChoice(page,'primary').click();await visible(action);
      await page.locator('#pause').click();await page.waitForFunction(()=>document.getElementById('wallpaper-action').disabled);
      await page.locator('#pause').click();await page.waitForFunction(()=>!document.getElementById('wallpaper-action').disabled);
      const calls=await actions(page);
      assert.deepEqual(calls.filter(call=>call.command==='invoke_wallpaper_action'),[
        {command:'invoke_wallpaper_action',args:{monitorId:'primary',instanceId:'primary-document',actionId:'feed'}},
        {command:'invoke_wallpaper_action',args:{monitorId:'secondary',instanceId:'secondary-document',actionId:'spark'}}
      ]);
    });

    await test('all declared operations remain reachable and labels are rendered as plain text', fixture => {
      const playing=fixture.state.wallpapers[0];
      playing.module_id='local:unrecognized';playing.name='第三方壁纸';
      playing.actions=Array.from({length:16},(_,i)=>({id:'action-'+i,label:i===0?'<b>点亮</b>':'操作 '+i,enabled:i!==3,disabledReason:i===3?'正在冷却':undefined}));
    }, async page => {
      assert.equal(await page.locator('#wallpaper-action').textContent(),'<b>点亮</b>');
      assert.equal(await page.locator('#wallpaper-action b').count(),0);
      await page.locator('#wallpaper-actions-menu summary').click();
      assert.equal(await page.locator('#wallpaper-extra-actions button').count(),15);
      assert.equal(await page.locator('[data-wallpaper-action="action-3"]').isDisabled(),true);
      assert.equal(await page.locator('[data-wallpaper-action="action-3"]').getAttribute('title'),'正在冷却');
      await page.locator('[data-wallpaper-action="action-15"]').click();
      assert.equal((await actions(page)).at(-1).args.actionId,'action-15');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    });

    await test('pending operations prevent duplicates and never redirect to a new document', fixture => {
      fixture.deferAction=true;
    }, async page => {
      await page.evaluate(()=>{document.getElementById('wallpaper-action').click();document.getElementById('wallpaper-action').click();});
      await page.waitForFunction(()=>document.getElementById('wallpaper-action').disabled);
      await page.evaluate(()=>{
        window.__uiTest.setWallpaper('primary',{instance_id:'replacement-document',actions:[]});
        window.__uiTest.finishOperation();
      });
      await page.waitForFunction(()=>document.getElementById('error').textContent.includes('重新加载'));
      assert.equal((await actions(page)).filter(call=>call.command==='invoke_wallpaper_action').length,1);
      assert.deepEqual((await actions(page)).find(call=>call.command==='invoke_wallpaper_action').args,
        {monitorId:'primary',instanceId:'primary-document',actionId:'feed'});
    });

    await test('unknown action outcomes remain visible and are never automatically retried', fixture => {
      fixture.failAction=true;
    }, async page => {
      await page.locator('#wallpaper-action').click();
      await page.waitForFunction(()=>document.getElementById('error').textContent.includes('避免重复操作'));
      await page.evaluate(()=>window.__uiTest.emit('host-updated'));
      await page.waitForFunction(()=>!document.getElementById('wallpaper-action').disabled);
      assert.equal((await actions(page)).filter(call=>call.command==='invoke_wallpaper_action').length,1);
      assert.match(await page.locator('#error').textContent(),/避免重复操作/);
    });

    await test('background app downloads show progress and ready never installs automatically', fixture => {
      appUpdateFixture(fixture, 'checking');
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      assert.match(await page.locator('#app-update-status').textContent(), /正在检查/);
      assert.deepEqual(await actions(page), [], 'Backend scheduling must not be duplicated by UI startup');
      await page.evaluate(() => window.__uiTest.setAppUpdate({ phase: 'downloading', received: 524288, total: 1048576 }));
      await page.waitForFunction(() => document.getElementById('app-update-progress').value === 50);
      assert.match(await page.locator('#app-update-size').textContent(), /512 KB \/ 1\.0 MB/);
      assert.equal(await page.locator('#download-app-update').isVisible(), false, 'A new version downloads automatically');
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.evaluate(() => window.__uiTest.setAppUpdate({ phase: 'ready', received: 1048576,
        notes: '新版已验证。\n<script>window.badUpdateNotes=true</script>\n' + 'LongReleaseNote'.repeat(60) }));
      await page.waitForFunction(() => !document.getElementById('app-update-toggle').hidden);
      assert.equal(await page.locator('#settings-dialog').isVisible(), false, 'Ready notification must not interrupt browsing');
      await page.locator('#app-update-toggle').click();
      assert.equal(await page.locator('#settings-tab-updates').getAttribute('aria-selected'),'true');
      await visible(page.locator('#install-app-update'));
      assert.match(await page.locator('#app-update-toggle').textContent(), /已就绪/);
      assert.equal(await page.locator('#version').textContent(), '0.3.0');
      assert.equal(await page.locator('#app-update-latest').textContent(), '0.3.1');
      await page.locator('#app-update-notes-wrap summary').click();
      assert.match(await page.locator('#app-update-notes').textContent(), /<script>/);
      assert.equal(await page.evaluate(() => window.badUpdateNotes), undefined);
      assert.equal(await page.locator('#app-update-confirm').count(), 0);
      await screenshot(page, 'app-update-ready');
      await page.waitForTimeout(1150);
      assert.deepEqual(await actions(page), [
        { command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'pinewind-town' } },
      ], 'Ready notification must never install or request a second download');
    });

    await test('restart and upgrade installs directly once without a second confirmation', fixture => {
      appUpdateFixture(fixture, 'ready');
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      await visible(page.locator('#install-app-update'));
      await page.evaluate(() => {
        document.getElementById('install-app-update').click();
        document.getElementById('install-app-update').click();
      });
      await page.waitForFunction(() => document.getElementById('app-update-status').textContent.includes('启动安装'));
      assert.equal(await page.locator('#app-update-confirm').count(), 0);
      assert.equal(await page.locator('#install-app-update').isVisible(), false);
      assert.deepEqual(await actions(page), [
        { command: 'install_app_update', args: { confirmed: true, version: '0.3.1' } },
      ]);
    });

    await test('app update network rejection persists without blocking local wallpapers', fixture => {
      appUpdateFixture(fixture, 'idle', { version: null, notes: null });
      fixture.failAppCheck = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      await page.locator('#check-app-update').click();
      await visible(page.locator('#app-update-error'));
      assert.match(await page.locator('#app-update-error').textContent(), /程序更新网络不可用/);
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      await page.waitForTimeout(1150);
      assert.equal(await page.locator('#app-update-error').isVisible(), true);
      assert.match(await page.locator('#app-update-error').textContent(), /程序更新网络不可用/);
      assert.equal(await page.locator('#check-app-update').isEnabled(), true);
      assert.equal(await page.locator('#download-app-update').isVisible(), false);
      assert.deepEqual(await actions(page), [
        { command: 'check_app_update', args: {} },
        { command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'pinewind-town' } },
      ]);
    });

    await test('app download retry reports progress and retains rejected installation errors', fixture => {
      appUpdateFixture(fixture, 'error', { error: '下载中断，原安装版本仍可使用。' });
      fixture.failAppInstall = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      assert.match(await page.locator('#app-update-error').textContent(), /下载中断/);
      await page.locator('#download-app-update').click();
      await page.waitForFunction(() => document.getElementById('app-update-progress').value === 25);
      assert.equal(await page.locator('#app-update-error').isVisible(), false);
      await page.evaluate(() => window.__uiTest.setAppUpdate({ phase: 'ready', received: 1048576 }));
      await visible(page.locator('#install-app-update'));
      await page.locator('#install-app-update').click();
      await visible(page.locator('#app-update-error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#app-update-error').textContent(), /安装包验证被拒绝/);
      assert.equal(await page.locator('#install-app-update').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.__uiTest.state().app_update.error), null,
        'Rejected IPC errors must survive in the UI even when snapshots omit them');
      assert.deepEqual(await actions(page), [
        { command: 'download_app_update', args: {} },
        { command: 'install_app_update', args: { confirmed: true, version: '0.3.1' } },
      ]);
    });

    await test('installation pins the displayed version when backend state changes before the upgrade click', fixture => {
      appUpdateFixture(fixture, 'ready');
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#settings-tab-updates').click();
      await visible(page.locator('#install-app-update'));
      assert.equal(await page.locator('#app-update-latest').textContent(), '0.3.1');
      await page.evaluate(() => {
        // Simulate a backend change just before invoking, before the next poll
        // can inform the UI. The native contract must receive the displayed pin.
        window.__uiTest.setAppUpdate({ version: '0.3.2' });
        document.getElementById('install-app-update').click();
      });
      await visible(page.locator('#app-update-error'));
      assert.match(await page.locator('#app-update-error').textContent(), /版本已变化/);
      assert.equal(await page.evaluate(() => window.__uiTest.state().app_update.phase), 'ready');
      assert.deepEqual(await actions(page), [
        { command: 'install_app_update', args: { confirmed: true, version: '0.3.1' } },
      ], 'A new backend candidate must not silently replace the version the user clicked');
    });

    console.log(`\n${passed} UI contracts passed; viewport 780x600; zero horizontal overflow; zero JavaScript errors.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
