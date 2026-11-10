'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require(process.argv[2] || 'playwright');
const root = path.resolve(__dirname, '..', 'modules');
const id = 'browser-check-' + Date.now();
const directory = path.join(root, id);
(async () => {
  const browser = await chromium.launch({headless: true, executablePath: process.argv[3]});
  let made = false;
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8088/');
    await page.locator('[data-module="pinewind-town"]').waitFor();
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await fs.mkdir(directory); made = true;
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Scene</title><h1>Scene</h1>');
    await fs.writeFile(path.join(directory, 'module.json'), JSON.stringify({name: '<b>自动发现验证</b>', order: 1}));
    const added = page.locator(`[data-module="${id}"]`);
    await added.waitFor({state: 'visible', timeout: 15000});
    assert.equal(await added.locator('h2').textContent(), '<b>自动发现验证</b>');
    assert.equal(await added.locator('h2 b').count(), 0, 'Manifest text must not execute as HTML');
    assert.equal(navigations, 0, 'Hot add must not reload the page');
    await fs.unlink(path.join(directory, 'module.json'));
    await fs.unlink(path.join(directory, 'index.html'));
    await fs.rmdir(directory); made = false;
    await added.waitFor({state: 'hidden', timeout: 15000});
    assert.equal(navigations, 0, 'Hot removal must not reload the page');
    for (const [width, height] of [[1440,1000],[390,844]]) {
      await page.setViewportSize({width,height});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Layout overflow at ${width}`);
      assert.ok(await page.getByRole('link', {name: '进入风景', exact: false}).isVisible());
    }
    assert.deepEqual(errors, []);
    console.log('PASS: browser hot add/remove without navigation; literal metadata rendering; desktop/mobile layout; no page errors.');
  } finally {
    if (made) {
      assert.equal(path.dirname(directory), root);
      for (const file of ['index.html','module.json']) await fs.unlink(path.join(directory,file)).catch(error=>{if(error.code!=='ENOENT')throw error;});
      await fs.rmdir(directory);
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
