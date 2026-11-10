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
function injectNativeFixture({ state, catalog, failCheck, failRollback }) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const calls = [];
  const previous = new Map();
  let pendingFailure = !!failCheck;
  window.__uiTest = {
    calls,
    failNextCheck() { pendingFailure = true; },
    state() { return copy(state); },
  };
  window.__TAURI__ = { core: { invoke: async (command, args = {}) => {
    calls.push({ command, args: copy(args) });
    switch (command) {
      case 'get_state': return copy(state);
      case 'check_online':
        if (pendingFailure) {
          pendingFailure = false;
          state.online.last_error = 'GitHub 连接失败：离线测试';
          throw state.online.last_error;
        }
        state.online = { catalog: copy(catalog), checked_at: 1794297600,
          cached: false, last_error: null };
        return copy(state);
      case 'install_online': {
        const item = state.online.catalog?.wallpapers.find(item => item.id === args.moduleId);
        if (!item) throw new Error('Test IPC: unknown selected wallpaper');
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

async function ready(page) {
  await page.waitForFunction(() => document.getElementById('module-count').textContent === '02');
}

async function visible(locator) {
  await locator.waitFor({ state: 'visible' });
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
      await local.getByRole('button', { name: '设为该屏幕壁纸', exact: true }).click();
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
      await moduleCard(page, '#modules', '松风镇').getByRole('button', { name: '设为该屏幕壁纸', exact: true }).click();
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

    console.log(`\n${passed} UI contracts passed; viewport 780x600; zero horizontal overflow; zero JavaScript errors.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
