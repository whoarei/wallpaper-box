'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {discoverModules, createServer} = require('../registry/server.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'display-registry-test-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('display-registry-test-'));
    await fs.rm(resolved, {recursive: true, force: true});
  });
  return root;
}
async function add(root, id, manifest, entry = 'index.html') {
  const dir = path.join(root, id);
  await fs.mkdir(dir, {recursive: true});
  if (entry) { await fs.mkdir(path.dirname(path.join(dir, entry)), {recursive: true}); await fs.writeFile(path.join(dir, entry), '<h1>Scene</h1>'); }
  if (manifest !== undefined) await fs.writeFile(path.join(dir, 'module.json'), JSON.stringify(manifest));
  return dir;
}
test('new, renamed, updated and removed folders are discovered without a process restart', async t => {
  const root = await fixture(t);
  assert.deepEqual((await discoverModules(root)).modules, []);
  const dir = await add(root, 'new-scene');
  assert.equal((await discoverModules(root)).modules[0].href, '/new-scene/');
  await fs.writeFile(path.join(dir, 'module.json'), JSON.stringify({name: '新风景', order: 1}));
  assert.equal((await discoverModules(root)).modules[0].name, '新风景');
  await fs.rename(dir, path.join(root, 'renamed-scene'));
  assert.equal((await discoverModules(root)).modules[0].id, 'renamed-scene');
  await fs.unlink(path.join(root, 'renamed-scene', 'index.html'));
  assert.equal((await discoverModules(root)).modules.length, 0);
});
test('custom nested entry, local cover and sorting are reflected in the catalog', async t => {
  const root = await fixture(t);
  await add(root, 'later', {order: 20});
  const dir = await add(root, 'first', {entry: 'view/start.html', order: 5, tags: ['夜景']}, 'view/start.html');
  await fs.writeFile(path.join(dir, 'cover.svg'), '<svg/>');
  const result = await discoverModules(root);
  assert.equal(result.modules[0].href, '/first/view/start.html');
  assert.equal(result.modules[0].cover, '/first/cover.svg');
  assert.deepEqual(result.modules[0].tags, ['夜景']);
  assert.deepEqual(result.warnings, []);
});
test('disabled and incomplete folders stay out, malformed modules do not break valid ones', async t => {
  const root = await fixture(t);
  await add(root, 'valid'); await add(root, 'disabled', {enabled: false});
  await add(root, 'incomplete', undefined, null); await add(root, 'docs');
  const dir = await add(root, 'broken'); await fs.writeFile(path.join(dir, 'module.json'), '{');
  await add(root, 'wrong-type', {tags: 'not-an-array'});
  const result = await discoverModules(root);
  assert.deepEqual(result.modules.map(module => module.id), ['valid']);
  assert.deepEqual(result.warnings.map(warning => warning.id), ['broken', 'incomplete', 'wrong-type']);
});
test('entry traversal and remote cover URLs cannot become catalog links', async t => {
  const root = await fixture(t);
  await add(root, 'escape', {entry: '../outside.html'});
  await add(root, 'remote-cover', {cover: 'https://example.com/cover.png'});
  const result = await discoverModules(root);
  assert.equal(result.modules.length, 1); assert.equal(result.modules[0].cover, null);
  assert.equal(result.warnings.length, 2);
});
test('read-only HTTP catalog reports changes and returns proper method and failure status', async t => {
  const root = await fixture(t), server = createServer(root);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base + '/api/modules')).json()).modules.length, 0);
  await add(root, 'hot-added');
  const response = await fetch(base + '/api/modules');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).modules[0].id, 'hot-added');
  assert.equal((await fetch(base + '/api/modules', {method: 'POST'})).status, 405);
  assert.equal((await fetch(base + '/unknown')).status, 404);
  const moved = root + '-unavailable';
  await fs.rename(root, moved);
  try { assert.equal((await fetch(base + '/api/modules')).status, 503); }
  finally { await fs.rename(moved, root); }
});
