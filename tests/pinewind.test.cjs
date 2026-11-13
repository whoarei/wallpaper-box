/* Exercise the shipped Pinewind page and the production desktop adapter.
 * Run: npm --prefix wallpaper-host run test:pinewind
 * PLAYWRIGHT_PATH / EDGE_PATH can select a local browser on other platforms.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {bootstrap}=require('./wallpaper-test-support.cjs');

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

(async () => {
  const { chromium } = playwright();
  const html = fs.readFileSync(path.resolve(__dirname, '../wallpapers/pinewind-town/index.html'), 'utf8');
  const wrapper = fs.readFileSync(path.resolve(__dirname, '../wallpaper-host/src-tauri/wallpaper-mode.js'), 'utf8');
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
    if(['/wallpaper-adapter.js','/translations.js','/i18n.js'].includes(request.url)){response.writeHead(200,{'Content-Type':'text/javascript'});response.end(fs.readFileSync(path.resolve(__dirname,'../wallpapers/pinewind-town'+request.url)));return;}
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    // Match native initialization before the real page scripts execute.
    response.end(request.url === '/wallpaper' ? html.replace('<head>', '<head><script>'+bootstrap(wrapper)+'</script>') : html.replace('<head>', '<head><script>'+bootstrap(wrapper,'preview')+'</script>'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  let browser, passed = 0;
  try {
    const executablePath = process.env.EDGE_PATH || [
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
    ].filter(Boolean).find(filename => fs.existsSync(filename));
    browser = await chromium.launch({ headless: true,
      ...(executablePath ? { executablePath } : { channel: 'msedge' }) });

    async function test(name, wallpaperMode, body) {
      const context = await browser.newContext({ viewport: { width: 960, height: 600 }, locale: 'zh-CN' });
      const page = await context.newPage(), errors = [], external = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin !== address) {
          external.push(route.request().url());
          return route.abort();
        }
        return route.continue();
      });
      await page.clock.install();
      await page.goto(`${address}/${wallpaperMode ? 'wallpaper' : 'preview'}`);
      await page.waitForFunction(() => !!window.pinewind);
      await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now()) + 100));
      try {
        await body(page);
        assert.deepEqual(errors, [], 'The real page must run without JavaScript errors');
        assert.deepEqual(external, [], 'The wallpaper must remain offline');
        console.log(`PASS ${name}`);
        passed++;
      } finally {
        await context.close();
      }
    }

    async function desktopClick(page, selector) {
      return page.evaluate(selector => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return window.__SCREEN_GARDEN_DESKTOP_CLICK((r.x + r.width / 2) / innerWidth, (r.y + r.height / 2) / innerHeight);
      }, selector);
    }

    await test('preview keeps its fullscreen button, shortcuts, and original presentation', false, async page => {
      assert.equal(await page.locator('.dock').isVisible(), true);
      assert.equal(await page.locator('#fullscreen').isVisible(), true);
      assert.equal(await page.locator('.clock').isVisible(), true);
      assert.match(await page.locator('#phase').getAttribute('title'), /（D）/);
      await page.keyboard.press('d');
      assert.equal(await page.evaluate(() => window.pinewind.getState().phase), 1);
    });

    await test('desktop controls change day, weather, and train through relayed clicks', true, async page => {
      assert.equal(await page.locator('.dock').isVisible(), true);
      assert.equal(await page.locator('#fullscreen').isVisible(), false);
      assert.equal(await page.locator('.clock').isVisible(), false);
      assert.doesNotMatch(await page.locator('#phase').getAttribute('title'), /（D）/);
      const before = await page.evaluate(() => window.pinewind.getState());
      assert.equal((await desktopClick(page, '#phase')).delivered, true);
      assert.equal((await desktopClick(page, '#weather')).delivered, true);
      assert.equal((await desktopClick(page, '#train')).delivered, true);
      const after = await page.evaluate(() => window.pinewind.getState());
      assert.equal(after.phase, 1);
      assert.equal(after.raining, true);
      assert.equal(after.trainAge, 0);
      assert.equal(after.flowers, before.flowers, 'Control clicks must not plant flowers underneath');
      assert.equal(await page.locator('.toast').isVisible(), true);
    });

    await test('desktop help opens and closes with usable desktop instructions', true, async page => {
      await desktopClick(page, '#help');
      assert.equal(await page.locator('#helpPanel').isVisible(), true);
      assert.equal(await page.locator('#help').getAttribute('aria-expanded'), 'true');
      const help = await page.locator('#helpPanel').textContent();
      assert.match(help, /桌面空白/);
      assert.match(help, /托盘菜单/);
      assert.doesNotMatch(help, /F11|快捷键|空格|网页全屏/);
      await desktopClick(page, '#closeHelp');
      assert.equal(await page.locator('#helpPanel').isVisible(), false);
      assert.equal(await page.locator('#help').getAttribute('aria-expanded'), 'false');
    });

    await test('desktop grass clicks still plant flowers at the original position', true, async page => {
      const result = await page.evaluate(() => {
        const before = window.pinewind.getState().flowers;
        const reply = window.__SCREEN_GARDEN_DESKTOP_CLICK(0.1,0.6);
        return {before, reply, after:window.pinewind.getState().flowers};
      });
      assert.equal(result.reply.delivered, true);
      assert.equal(result.after, result.before + 5);
    });

    await test('relayed movement wakes an idle dock without changing the scene or focus', true, async page => {
      await page.clock.runFor(10000);
      assert.equal(await page.locator('body').evaluate(body => body.classList.contains('idle')), true);
      assert.equal(await page.locator('.dock').evaluate(dock => {
        for (const animation of dock.getAnimations()) animation.finish();
        return getComputedStyle(dock).opacity;
      }), '0');
      const result = await page.evaluate(() => {
        const before = window.pinewind.getState(), focus = document.activeElement, events = [];
        document.addEventListener('pointermove', event => events.push({x:event.clientX,y:event.clientY,buttons:event.buttons}));
        const reply = window.__SCREEN_GARDEN_DESKTOP_MOVE(0.4, 0.5);
        return {before, after:window.pinewind.getState(), reply, events, focusPreserved:focus === document.activeElement};
      });
      assert.equal(result.reply.delivered, true);
      assert.deepEqual(result.events, [{x:384,y:300,buttons:0}]);
      assert.deepEqual(result.after, result.before);
      assert.equal(result.focusPreserved, true);
      assert.equal(await page.locator('body').evaluate(body => body.classList.contains('idle')), false);
      await page.clock.runFor(1300);
      assert.equal(await page.locator('.dock').evaluate(dock => {
        for (const animation of dock.getAnimations()) animation.finish();
        return getComputedStyle(dock).opacity;
      }), '1');
      await desktopClick(page, '#weather');
      assert.equal(await page.evaluate(() => window.pinewind.getState().raining), true);
    });

    await test('invalid movement cannot wake the dock, and open help prevents idle hiding', true, async page => {
      await page.clock.runFor(10000);
      const rejected = await page.evaluate(() => {
        const points = [[-0.1,0.5],[1,0.5],[0.5,1],[NaN,0.5],[Infinity,0.5],['0.5',0.5]];
        return points.map(([x,y]) => window.__SCREEN_GARDEN_DESKTOP_MOVE(x,y));
      });
      assert.ok(rejected.every(reply => reply.delivered === false));
      assert.equal(await page.locator('body').evaluate(body => body.classList.contains('idle')), true);
      await page.evaluate(() => window.__SCREEN_GARDEN_DESKTOP_MOVE(0.5,0.5));
      await page.clock.runFor(1300);
      await desktopClick(page, '#help');
      await page.clock.runFor(10000);
      assert.equal(await page.locator('body').evaluate(body => body.classList.contains('idle')), false);
      assert.equal(await page.locator('#helpPanel').isVisible(), true);
    });

    console.log(`\n${passed} real Pinewind regressions passed.`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
