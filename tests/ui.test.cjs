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
  '.css': 'text/css; charset=utf-8' };

function serveUi() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
    if (!['index.html', 'app.js', 'app.css'].includes(filename)) {
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
    entry: 'index.html', tags: [], size: 12345, unpackedSize: 54321,
    downloadUrl: `https://github.com/whoarei/wallpapers/releases/download/library-v1.1.0/${id}-${version}.zip`,
    sha256: 'a'.repeat(64), coverUrl: null });
  return {
    catalog: { schemaVersion: 1, version: '1.1.0', wallpapers: [
      remote('aquarium', '水族箱', '1.1.0'), remote('pinewind-town', '松风镇', '1.0.0'),
      remote('window-to-elsewhere', '通往别处的窗户', '1.0.0'),
    ] },
    state: { version: '0.2.0', service: 'http://wallpaper.localhost', auto_pause: true,
      proxy: { mode: 'system', url: '' },
      wallpaper_repositories: [{url:'https://gitee.com/xishuaiya/wallpapers',enabled:true},{url:'https://github.com/whoarei/wallpapers',enabled:false}],
      selected_monitor: 'primary', displays: [
        { id: 'primary', name: '主显示器', width: 3840, height: 2160, scale: 1.5 },
        { id: 'secondary', name: '副显示器', width: 1920, height: 1080, scale: 1 },
      ], modules, warnings: [], transfer: null, last_error: null,
      wallpapers: [{ display_id: 'primary', module_id: 'aquarium', name: '水族箱',
        paused: false, auto_paused: false }],
      online: { catalog: null, checked_at: 0, cached: false, last_error: null },
    },
  };
}

// This fixture owns native state. UI updates only through the production invoke
// API and its ordinary one-second polling, matching a Tauri manager window.
function injectNativeFixture({ state, catalog, failCheck, failRollback, failAppCheck, failAppInstall,
  failPreview, deferApply, deferInstall, failProxySave, failProxyTest, deferProxyTest, failCover, persistProxy, persistRepositories, failRepositorySave, sourceCatalogs, sourceFailures }) {
  const copy = value => JSON.parse(JSON.stringify(value));
  if (persistProxy && sessionStorage.getItem('native-proxy')) {
    state.proxy = JSON.parse(sessionStorage.getItem('native-proxy'));
  }
  if (persistRepositories && sessionStorage.getItem('native-repositories')) {
    state.wallpaper_repositories = JSON.parse(sessionStorage.getItem('native-repositories'));
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
  const previous = new Map();
  let pendingFailure = !!failCheck;
  let finishOperation;
  window.__uiTest = {
    calls, repositoryRequests,
    failNextCheck() { pendingFailure = true; },
    state() { return copy(state); },
    setAppUpdate(patch) { Object.assign(state.app_update, copy(patch)); },
    finishOperation() { assertPendingOperation(); finishOperation(); finishOperation = null; },
  };
  function assertPendingOperation() { if (!finishOperation) throw new Error('No pending fixture operation'); }
  window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
    calls.push({ command, args: copy(args) });
    switch (command) {
      case 'get_state': return copy(state);
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
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDZkAAAAASUVORK5CYII=';
      case 'refresh_modules': return copy(state);
      case 'open_wallpaper_folder':
      case 'hide_manager':
      case 'quit_app': return null;
      case 'capture_desktop':
      case 'show_desktop': return 'preview.png';
      case 'remove_wallpaper':
        state.wallpapers = state.wallpapers.filter(wallpaper => wallpaper.display_id !== args.monitorId);
        return copy(state);
      case 'import_wallpaper':
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
      case 'feed_aquarium': {
        const playing = state.wallpapers.find(wallpaper => wallpaper.display_id === args.monitorId);
        if (playing?.module_id !== 'aquarium' || playing.paused) {
          throw new Error('Test IPC: cannot feed this display');
        }
        return copy(state);
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
      case 'install_online': {
        const item = state.online.catalog?.wallpapers.find(item => item.id === args.moduleId);
        if (!item) throw new Error('Test IPC: unknown selected wallpaper');
        if (deferInstall) {
          state.transfer = { id: item.id, name: item.name, received: 1048576, total: 2097152 };
          await new Promise(resolve => { finishOperation = resolve; });
          state.transfer = null;
        }
        const index = state.modules.findIndex(module => module.id === item.id);
        if (index >= 0) previous.set(item.id, copy(state.modules[index]));
        const installed = { id: item.id, name: item.name, subtitle: item.subtitle,
          description: item.description, href: `/${item.id}/${item.entry}`, cover: null,
          tags: item.tags, version: item.version, source: 'online', rollback_available: index >= 0 };
        if (index >= 0) state.modules[index] = installed; else state.modules.push(installed);
        state.online.last_error = null;
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
          name: module.name, paused: false, auto_paused: false });
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

    await test('compact home fits both window sizes and keeps low-frequency actions out of the gallery', null, async page => {
      for (const [width, height] of [[1080, 760], [780, 600]]) {
        await page.setViewportSize({ width, height });
        const bounds = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
        assert.ok(bounds.width <= width && bounds.height <= height, JSON.stringify({ viewport: [width, height], bounds }));
      }
      assert.equal(await page.locator('#auto-pause').isVisible(), false);
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
      await page.locator('#displays').selectOption('secondary');
      await page.waitForFunction(() => document.getElementById('current-title').textContent.includes('尚未设置'));
      assert.equal(await page.locator('#pause').isVisible(), false);
      await page.getByRole('button', { name: '将松风镇应用到副显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await page.locator('#reload').click();
      await page.waitForFunction(() => !document.getElementById('displays').disabled);
      await page.getByRole('button', { name: '更多播放操作', exact: true }).click();
      await page.locator('#remove').click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent.includes('尚未设置'));
      await page.locator('#displays').selectOption('primary');
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '水族箱');
      assert.deepEqual((await page.evaluate(() => window.__uiTest.state())).wallpapers.map(item => item.display_id), ['primary']);
      assert.deepEqual((await actions(page)).filter(call => call.command === 'apply_wallpaper'), [
        { command: 'apply_wallpaper', args: { monitorId: 'secondary', moduleId: 'pinewind-town' } },
        { command: 'apply_wallpaper', args: { monitorId: 'secondary', moduleId: 'pinewind-town' } },
      ]);
    });

    await test('one import entry respects native picker cancellation and retains import failures', null, async page => {
      await page.locator('#import-open').click();
      await page.locator('#import-folder').click();
      await page.waitForFunction(() => !document.getElementById('import-open').disabled);
      assert.equal(await page.locator('#import-dialog').isVisible(), false);
      assert.equal(await page.locator('#toast').getAttribute('class'), 'toast', 'Canceling must not claim a successful import');
      await page.locator('#import-open').click();
      await page.locator('#import-zip').click();
      await visible(page.locator('#error'));
      await page.waitForTimeout(1150);
      assert.match(await page.locator('#error').textContent(), /ZIP 文件无效/);
      assert.equal(await page.locator('#modules .module').count(), 2);
      assert.deepEqual(await actions(page), [
        { command: 'import_wallpaper', args: { kind: 'folder' } },
        { command: 'import_wallpaper', args: { kind: 'zip' } },
      ]);
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
      await page.locator('#settings-open').click();
      assert.equal(await page.locator('#repository-url-0').inputValue(), 'https://gitee.com/xishuaiya/wallpapers');
      assert.equal(await page.getByRole('switch', { name: '启用仓库 1', exact: true }).isChecked(), true);
      assert.equal(await page.getByRole('switch', { name: '启用仓库 2', exact: true }).isChecked(), false);
      assert.equal(await page.locator('#save-repositories').isDisabled(), true);
      await page.keyboard.press('Escape');await page.locator('#tab-online').click();
      await visible(moduleCard(page, '#online-modules', '通往别处的窗户'));
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://gitee.com/xishuaiya/wallpapers']);
      assert.match(await moduleCard(page, '#online-modules', '通往别处的窗户').textContent(), /来源：gitee.com\/xishuaiya\/wallpapers/);
    });

    await test('custom repository drafts survive polling and normalized ordering persists after reload', fixture => {
      fixture.persistRepositories = true;
    }, async page => {
      await page.locator('#settings-open').click();await page.locator('#add-repository').click();
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
      await page.reload();await ready(page);await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
      await page.getByRole('switch', { name: '启用仓库 1', exact: true }).uncheck();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      await page.keyboard.press('Escape');await page.locator('#tab-online').click();
      assert.equal(await page.locator('#check-online').isDisabled(), true);
      assert.match(await page.locator('#online-empty').textContent(), /添加或启用/);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), []);
      assert.equal(await page.evaluate(() => window.__uiTest.state().modules.length), 2);
      await page.locator('#settings-open').click();
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
      assert.match(await card.textContent(), /来源：github.com\/whoarei\/wallpapers/);
      await visible(page.locator('#online-error'));assert.match(await page.locator('#online-error').textContent(), /gitee.com.*仓库暂时不可用/);
      await page.locator('#settings-open').click();
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
      assert.match(await card.textContent(), /来源：gitee.com/);assert.match(await card.textContent(), /v1.1.0/);
      await page.locator('#settings-open').click();await page.getByRole('button',{name:'上移仓库 2',exact:true}).click();
      await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);
      await page.keyboard.press('Escape');
      assert.match(await card.textContent(), /来源：github.com/);assert.match(await card.textContent(), /v2.0.0/);
      await page.locator('#settings-open').click();
      await page.getByRole('switch',{name:'启用仓库 1',exact:true}).uncheck();await page.locator('#save-repositories').click();
      await page.waitForFunction(() => document.getElementById('save-repositories').disabled);await page.keyboard.press('Escape');
      assert.match(await card.textContent(), /来源：gitee.com/);assert.match(await card.textContent(), /v1.1.0/);
      assert.deepEqual(await page.evaluate(() => window.__uiTest.repositoryRequests), ['https://gitee.com/xishuaiya/wallpapers','https://github.com/whoarei/wallpapers']);
    });

    await test('failed repository saves retain edited addresses and enable switches', fixture => {
      fixture.failRepositorySave = true;
    }, async page => {
      await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
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
      await page.reload();await ready(page);await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
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
      assert.equal(await page.locator('#displays').isDisabled(), true);
      assert.equal(await page.locator('#pause').isDisabled(), true);
      assert.equal((await actions(page)).filter(call => call.command === 'apply_wallpaper').length, 1);
      await page.evaluate(() => window.__uiTest.finishOperation());
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      assert.equal(await page.locator('#displays').isEnabled(), true);
    });

    await test('pending downloads still show polled progress and allow local wallpaper changes', fixture => {
      fixture.deferInstall = true;
    }, async page => {
      await page.locator('#tab-online').click();
      await moduleCard(page, '#online-modules', '通往别处的窗户').getByRole('button', { name: '下载壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('transfer-progress').value === 50);
      assert.equal(await page.locator('#transfer').isVisible(), true);
      await page.locator('#tab-local').click();
      await page.getByRole('button', { name: '将松风镇应用到主显示器', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.evaluate(() => window.__uiTest.finishOperation());
      await page.waitForFunction(() => document.getElementById('module-count').textContent === '03');
      assert.equal(await page.locator('#current-title').textContent(), '松风镇');
      assert.equal(await page.locator('#transfer').isVisible(), false);
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
      assert.equal((await actions(page)).length, 2, 'Cached tab navigation must not recheck or install');
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
      assert.equal(await remote.getByRole('button', { name: '已是最新', exact: true }).isDisabled(), true);
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
      assert.equal(await sameBuild.getByRole('button', { name: '已是最新', exact: true }).isDisabled(), true,
        'Build metadata must not change version precedence');
      const incompatible = moduleCard(page, '#online-modules', '通往别处的窗户');
      assert.equal(await incompatible.getByRole('button', { name: '需要程序 0.2.0', exact: true }).isDisabled(), true,
        'A prerelease of the app must not satisfy the minimum stable app version');
      assert.deepEqual(await actions(page), [], 'Version rendering must never download or recheck automatically');
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

    await test('aquarium feeding targets the selected screen and respects wallpaper and pause state', fixture => {
      fixture.state.wallpapers.push({ display_id: 'secondary', module_id: 'aquarium',
        name: '水族箱', paused: false, auto_paused: true });
    }, async page => {
      const feed = page.locator('#feed-aquarium');
      await visible(feed);
      assert.equal(await feed.isEnabled(), true);
      await feed.click();
      await page.locator('#displays').selectOption('secondary');
      await page.waitForFunction(() => document.getElementById('current-status').textContent === '遮挡，自动暂停');
      assert.equal(await feed.isEnabled(), true, 'Occlusion must allow queuing food before returning to the desktop');
      await feed.click();
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('feed-aquarium').hidden);
      assert.equal(await feed.isVisible(), false, 'Feeding must be hidden for other wallpaper modules');
      await page.locator('#displays').selectOption('primary');
      await visible(feed);
      await page.locator('#pause').click();
      await page.waitForFunction(() => document.getElementById('feed-aquarium').disabled);
      assert.equal(await feed.isDisabled(), true, 'Manual pause must disable feeding');
      await page.locator('#pause').click();
      await page.waitForFunction(() => !document.getElementById('feed-aquarium').disabled);
      assert.equal(await feed.isEnabled(), true);
      const calls = await actions(page);
      assert.deepEqual(calls.filter(call => call.command === 'feed_aquarium'), [
        { command: 'feed_aquarium', args: { monitorId: 'primary' } },
        { command: 'feed_aquarium', args: { monitorId: 'secondary' } },
      ]);
      assert.deepEqual(calls.filter(call => call.command === 'pause_wallpaper'), [
        { command: 'pause_wallpaper', args: { monitorId: 'primary', paused: true } },
        { command: 'pause_wallpaper', args: { monitorId: 'primary', paused: false } },
      ]);
      assert.equal(calls.some(call => ['check_online', 'install_online'].includes(call.command)), false);
    });

    await test('background app downloads show progress and ready never installs automatically', fixture => {
      appUpdateFixture(fixture, 'checking');
    }, async page => {
      await page.locator('#settings-open').click();
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
      await visible(page.locator('#install-app-update'));
      assert.match(await page.locator('#app-update-toggle').textContent(), /已就绪/);
      assert.equal(await page.locator('#version').textContent(), '0.3.0');
      assert.equal(await page.locator('#app-update-latest').textContent(), '0.3.1');
      await page.locator('#app-update-notes-wrap summary').click();
      assert.match(await page.locator('#app-update-notes').textContent(), /<script>/);
      assert.equal(await page.evaluate(() => window.badUpdateNotes), undefined);
      assert.equal(await page.locator('#app-update-confirm').isVisible(), false);
      await screenshot(page, 'app-update-ready');
      await page.waitForTimeout(1150);
      assert.deepEqual(await actions(page), [
        { command: 'apply_wallpaper', args: { monitorId: 'primary', moduleId: 'pinewind-town' } },
      ], 'Ready notification must never install or request a second download');
    });

    await test('app installation requires a cancelable confirmation and is submitted once', fixture => {
      appUpdateFixture(fixture, 'ready');
    }, async page => {
      await page.locator('#settings-open').click();
      await visible(page.locator('#install-app-update'));
      await page.locator('#install-app-update').click();
      await visible(page.locator('#app-update-confirm'));
      assert.match(await page.locator('#app-update-confirm-copy').textContent(), /v0\.3\.1/);
      await screenshot(page, 'app-update-confirm');
      await page.locator('#cancel-app-update').click();
      assert.equal(await page.locator('#app-update-confirm').isVisible(), false);
      assert.deepEqual(await actions(page), [], 'Cancel must leave installation untouched');
      await page.locator('#install-app-update').click();
      await page.evaluate(() => {
        document.getElementById('confirm-app-update').click();
        document.getElementById('confirm-app-update').click();
      });
      await page.waitForFunction(() => document.getElementById('app-update-status').textContent.includes('启动安装'));
      assert.equal(await page.locator('#app-update-confirm').isVisible(), false);
      assert.deepEqual(await actions(page), [
        { command: 'install_app_update', args: { confirmed: true, version: '0.3.1' } },
      ]);
    });

    await test('app update network rejection persists without blocking local wallpapers', fixture => {
      appUpdateFixture(fixture, 'idle', { version: null, notes: null });
      fixture.failAppCheck = true;
    }, async page => {
      await page.locator('#settings-open').click();
      await page.locator('#check-app-update').click();
      await visible(page.locator('#app-update-error'));
      assert.match(await page.locator('#app-update-error').textContent(), /程序更新网络不可用/);
      await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '应用壁纸', exact: true }).click();
      await page.waitForFunction(() => document.getElementById('current-title').textContent === '松风镇');
      await page.locator('#settings-open').click();
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
      await page.locator('#settings-open').click();
      assert.match(await page.locator('#app-update-error').textContent(), /下载中断/);
      await page.locator('#download-app-update').click();
      await page.waitForFunction(() => document.getElementById('app-update-progress').value === 25);
      assert.equal(await page.locator('#app-update-error').isVisible(), false);
      await page.evaluate(() => window.__uiTest.setAppUpdate({ phase: 'ready', received: 1048576 }));
      await visible(page.locator('#install-app-update'));
      await page.locator('#install-app-update').click();
      await page.locator('#confirm-app-update').click();
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

    await test('installation pins the version shown in confirmation when backend state changes before IPC', fixture => {
      appUpdateFixture(fixture, 'ready');
    }, async page => {
      await page.locator('#settings-open').click();
      await page.locator('#install-app-update').click();
      await visible(page.locator('#app-update-confirm'));
      assert.match(await page.locator('#app-update-confirm-copy').textContent(), /v0\.3\.1/);
      await page.evaluate(() => {
        // Simulate a backend change just before invoking, before the next poll
        // can inform the UI. The native contract must receive the confirmed pin.
        window.__uiTest.setAppUpdate({ version: '0.3.2' });
        document.getElementById('confirm-app-update').click();
      });
      await visible(page.locator('#app-update-error'));
      assert.match(await page.locator('#app-update-error').textContent(), /版本已变化/);
      assert.equal(await page.evaluate(() => window.__uiTest.state().app_update.phase), 'ready');
      assert.deepEqual(await actions(page), [
        { command: 'install_app_update', args: { confirmed: true, version: '0.3.1' } },
      ], 'A new backend candidate must not silently replace the user-confirmed installation');
    });

    console.log(`\n${passed} UI contracts passed; viewport 780x600; zero horizontal overflow; zero JavaScript errors.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
