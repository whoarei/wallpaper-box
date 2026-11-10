'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const modulesRoot = path.join(root, 'modules');
const base = 'http://127.0.0.1:8088';
const id = 'discovery-check-' + Date.now();
const directory = path.join(modulesRoot, id);
function snapshot() {
  const ids = execFileSync('docker', ['compose', 'ps', '-q'], {cwd: root, encoding: 'utf8'}).trim().split(/\s+/).filter(Boolean).sort();
  return execFileSync('docker', ['inspect', ...ids, '--format', '{{.Id}} {{.State.StartedAt}}'], {encoding: 'utf8'}).trim();
}
async function catalog() {
  const response = await fetch(base + '/api/modules');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return response.json();
}
(async () => {
  const before = snapshot();
  const baseline = await catalog();
  const town = baseline.modules.find(module => module.id === 'pinewind-town');
  assert.equal(town.href, '/pinewind-town/');
  const page = await fetch(base + town.href);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const served = Buffer.from(await page.arrayBuffer());
  assert.equal(createHash('sha256').update(served).digest('hex'), createHash('sha256').update(await fs.readFile(path.join(modulesRoot, 'pinewind-town', 'index.html'))).digest('hex'));
  for (const uri of ['/', '/assets/gallery.js', '/assets/gallery.css', '/healthz']) assert.equal((await fetch(base + uri)).status, 200, uri);
  for (const uri of ['/compose.yaml', '/server.cjs', '/.git/config', '/api/unknown', '/missing/']) assert.equal((await fetch(base + uri)).status, 404, uri);
  assert.equal((await fetch(base + '/api/modules', {method: 'POST'})).status, 405);
  const redirect = await fetch(base + '/pinewind-town', {redirect: 'manual'});
  assert.equal(redirect.status, 301);
  assert.equal(new URL(redirect.headers.get('location'), base).href, base + '/pinewind-town/');
  await fs.mkdir(directory);
  try {
    await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><title>Discovery check</title><h1>Fresh scene</h1>');
    assert.ok((await catalog()).modules.some(module => module.id === id && module.name === id));
    assert.equal((await fetch(base + '/' + id + '/')).status, 200);
    await fs.writeFile(path.join(directory, 'module.json'), JSON.stringify({name: '热加入验证', order: 1}));
    assert.equal((await catalog()).modules[0].name, '热加入验证');
    await fs.writeFile(path.join(directory, 'module.json'), '{');
    const broken = await catalog();
    assert.ok(broken.warnings.some(warning => warning.id === id));
    assert.ok(broken.modules.some(module => module.id === town.id));
    await fs.writeFile(path.join(directory, 'module.json'), JSON.stringify({enabled: false}));
    assert.ok(!(await catalog()).modules.some(module => module.id === id));
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), modulesRoot);
    assert.ok(path.basename(directory).startsWith('discovery-check-'));
    for (const file of ['index.html', 'module.json']) await fs.unlink(path.join(directory, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await fs.rmdir(directory);
  }
  const final = await catalog();
  assert.ok(!final.modules.some(module => module.id === id));
  assert.deepEqual(final.warnings, baseline.warnings);
  assert.equal(snapshot(), before, 'Container IDs and startup times must stay unchanged');
  console.log('PASS: unchanged container IDs/start times; hot add, metadata update, invalid JSON isolation, disable and remove; original town URL/bytes; static assets, health, redirect, 405 and 404 routes.');
})().catch(error => { console.error(error); process.exitCode = 1; });
