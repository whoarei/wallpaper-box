/* Real bundled aquarium regressions. Run: node tests/aquarium.test.cjs
 * Uses the locked wallpaper-host Playwright dependency and local Microsoft Edge.
 * PLAYWRIGHT_PATH / EDGE_PATH can override those paths. No assets are mocked.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const feedScript = fs.readFileSync(path.resolve(__dirname, '../wallpaper-host/src-tauri/aquarium-feed.js'), 'utf8');

function playwright() {
  for (const candidate of [process.env.PLAYWRIGHT_PATH,
    path.resolve(__dirname, '../wallpaper-host/node_modules/playwright-core'),
    'playwright', 'playwright-core'].filter(Boolean)) {
    try { return require(candidate); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Run npm --prefix wallpaper-host ci, or set PLAYWRIGHT_PATH.');
}

async function serveAquarium(wrapper) {
  const root = path.resolve(__dirname, '../wallpapers/aquarium');
  const files = { '/': ['index.html', 'text/html; charset=utf-8'],
    '/aquarium.js': ['aquarium.js', 'text/javascript; charset=utf-8'],
    '/aquarium.css': ['aquarium.css', 'text/css; charset=utf-8'] };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/favicon.ico') { response.writeHead(204).end(); return; }
    const file = files[pathname];
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    let content = fs.readFileSync(path.join(root, file[0]));
    if (pathname === '/' && url.searchParams.has('wallpaper')) {
      // Clock is installed before document scripts; inject the real wallpaper
      // wrapper before the real deferred module, matching native initialization.
      // Two independent addInitScripts have undefined ordering in Playwright.
      content = content.toString('utf8').replace('<head>', `<head><script>${wrapper}</script>`);
    }
    response.end(content);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, address: `http://127.0.0.1:${server.address().port}` };
}

async function aquariumState(page) { return page.evaluate(() => window.aquarium.getState()); }

async function advanceUntilEaten(page, previousEaten) {
  // Drive every real RAF and physics update on a virtual clock. Software canvas
  // rendering on CI can take >20 wall seconds for a few simulation seconds;
  // waiting for wall time made a healthy aquarium randomly miss its deadline.
  // No fish, food, update function, or canvas API is stubbed or accelerated.
  let state;
  for (let elapsed = 0; elapsed < 30000; elapsed += 500) {
    await page.clock.runFor(500);
    state = await aquariumState(page);
    if (state.eaten > previousEaten) return state;
  }
  assert.fail(`Fish did not consume food within 30 simulation seconds: ${JSON.stringify(state)}`);
}

// Execute the production script verbatim, as native eval_with_callback does.
async function hostFeed(page) {
  return page.evaluate(script => {
    const before = window.aquarium.getState();
    const reply = (0, eval)(script);
    return { before, reply, after: window.aquarium.getState() };
  }, feedScript);
}

function assertOnePortion({ before, reply, after }) {
  assert.equal(after.totalFed, before.totalFed + 7, 'The existing feed handler must add seven food particles');
  assert.equal(after.foods, before.foods + 7);
  assert.equal(after.fish, 30);
  assert.deepEqual(reply, { ok: true, foods: after.foods, totalFed: after.totalFed },
    'The native callback must confirm the food was actually added');
}

(async () => {
  const { chromium } = playwright();
  const wrapper = fs.readFileSync(path.resolve(__dirname, '../wallpaper-host/src-tauri/wallpaper-mode.js'), 'utf8');
  const { server, address } = await serveAquarium(wrapper);
  let browser;
  let passed = 0;
  try {
    const executablePath = process.env.EDGE_PATH || [
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean).find(filename => fs.existsSync(filename));
    browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : { channel: 'msedge' }) });

    async function test(name, wallpaperMode, body) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-CN' });
      await context.addInitScript(script => {
        // At document creation the actual module has not initialized its HUD or
        // diagnostics yet. Test the real bridge's loading response at that time.
        window.__aquariumFeedBeforeReady = (0, eval)(script);
      }, feedScript);
      const page = await context.newPage();
      page.setDefaultTimeout(120000);
      const start = new Date('2026-11-11T00:00:00Z');
      await page.clock.install({ time: start });
      await page.clock.pauseAt(new Date(start.getTime() + 1000));
      const errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== address) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      try {
        await page.goto(address + (wallpaperMode ? '/?wallpaper=1' : '/'), { waitUntil: 'load' });
        await page.clock.runFor(100);
        assert.ok((await aquariumState(page)).frames > 1);
        await body(page);
        assert.deepEqual(errors, [], 'The real aquarium must have no JavaScript or console errors');
        assert.deepEqual(external, [], 'The bundled aquarium must work entirely offline');
        console.log(`PASS ${name}`);
        passed += 1;
      } finally { await context.close(); }
    }

    await test('hidden wallpaper HUD still accepts host feeding and fish consume the food', true, async page => {
      assert.equal(await page.locator('html').getAttribute('data-screen-garden-wallpaper'), 'true');
      assert.equal(await page.locator('#feed').isVisible(), false, 'Wallpaper mode intentionally hides its web controls');
      const portion = await hostFeed(page);
      assertOnePortion(portion);
      assert.ok(portion.after.foods > 0);
      const consumed = await advanceUntilEaten(page, portion.before.eaten);
      assert.equal(consumed.totalFed, portion.after.totalFed);
      assert.ok(consumed.foods < portion.after.foods, 'Fish must consume real food rather than only display a toast');
    });

    await test('host pause queues food and resume restores simulation and feeding', true, async page => {
      await page.evaluate(() => window.__SCREEN_GARDEN_SET_PAUSED(true));
      const frozen = await aquariumState(page);
      await page.clock.runFor(1000);
      assert.equal((await aquariumState(page)).frames, frozen.frames, 'Host pause must freeze animation frames');
      const queued = await hostFeed(page);
      assertOnePortion(queued);
      await page.clock.runFor(1000);
      const still = await aquariumState(page);
      assert.equal(still.frames, frozen.frames);
      assert.equal(still.time, frozen.time);
      assert.equal(still.foods, queued.after.foods, 'Occlusion queues the food without advancing physics');
      await page.evaluate(() => window.__SCREEN_GARDEN_SET_PAUSED(false));
      await page.clock.runFor(100);
      assert.ok((await aquariumState(page)).frames > frozen.frames);
      assertOnePortion(await hostFeed(page));
      await advanceUntilEaten(page, frozen.eaten);
      assert.ok((await aquariumState(page)).time > frozen.time);
    });

    await test('the original web canvas and E controls retain feeding and manual pause behavior', false, async page => {
      assert.equal(await page.locator('#feed').isVisible(), true);
      const before = await aquariumState(page);
      // Virtual RAF is paused, so bypass Playwright's two-frame stability wait;
      // this still dispatches the real browser pointer/click events to canvas.
      await page.locator('#aquarium').click({ position: { x: 640, y: 168 }, force: true });
      assert.equal((await aquariumState(page)).totalFed, before.totalFed + 7, 'Canvas clicks must still feed');
      await page.keyboard.press('e');
      assert.equal((await aquariumState(page)).totalFed, before.totalFed + 14, 'E must still feed');
      await page.keyboard.press('Space');
      assert.equal((await aquariumState(page)).paused, true);
      await page.keyboard.press('e');
      assert.equal((await aquariumState(page)).totalFed, before.totalFed + 14, 'Web manual pause must reject feeding');
      await page.keyboard.press('Space');
      assert.equal((await aquariumState(page)).paused, false);
      await page.keyboard.press('e');
      assert.equal((await aquariumState(page)).totalFed, before.totalFed + 21, 'Feeding must resume with the simulation');
    });

    await test('native feeding reports loading, internal pause and a full meal without false success', true, async page => {
      const loading = await page.evaluate(() => window.__aquariumFeedBeforeReady);
      assert.equal(loading.ok, false);
      assert.match(loading.message, /正在载入/);
      await page.keyboard.press('Space');
      const paused = await hostFeed(page);
      assert.equal(paused.before.paused, true);
      assert.deepEqual(paused.reply, { ok: false, message: '水族箱已暂停，请先继续播放。' });
      assert.equal(paused.after.totalFed, paused.before.totalFed);
      assert.equal(paused.after.foods, paused.before.foods);
      await page.keyboard.press('Space');
      const meal = await page.evaluate(script => {
        const before = window.aquarium.getState();
        const replies = Array.from({ length: 8 }, () => (0, eval)(script));
        return { before, replies, after: window.aquarium.getState() };
      }, feedScript);
      assert.equal(meal.replies.filter(reply => reply.ok).length, 7);
      assert.equal(meal.after.foods, 49, 'The existing module permits seven portions before its >42 limit');
      assert.equal(meal.after.totalFed, meal.before.totalFed + 49);
      assert.deepEqual(meal.replies.at(-1), { ok: false, message: '先让鱼儿慢慢吃完这一餐。' },
        'A meal rejected by the real handler must not be acknowledged as successful');
    });

    console.log(`\n${passed} real aquarium regressions passed; zero JavaScript errors; zero external requests.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
