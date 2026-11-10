import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {createUpdateManifest} from './create-update-manifest.mjs';
import {hostRoot, installerName, verifyMinisign, verifyUpdateDirectory} from './update-signatures.mjs';
import {normalizeTauriExe, normalizedExeHash} from './installer-payload.mjs';

test('installer payload normalization changes only supported Tauri bundle markers', () => {
  const base = Buffer.from('MZ-before__TAURI_BUNDLE_TYPE_VAR_UNK-between__TAURI_BUNDLE_TYPE_VAR_UNK-after');
  const nsis = Buffer.from(base.toString().replaceAll('_VAR_UNK', '_VAR_NSS'));
  assert.ok(normalizeTauriExe(nsis).equals(base));
  assert.equal(normalizedExeHash(base), normalizedExeHash(nsis));
  const changed = Buffer.from(nsis); changed[0] ^= 1;
  assert.notEqual(normalizedExeHash(changed), normalizedExeHash(base));
  assert.throws(() => normalizeTauriExe(Buffer.from('MZ no bundle marker')));
  assert.throws(() => normalizeTauriExe(Buffer.from('MZ__TAURI_BUNDLE_TYPE_VAR_BAD')));
});

test('real Tauri signatures bind installer bytes and release version; static feed rejects substitutions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wallpaper-box-release-test-'));
  const cli = path.join(hostRoot, 'node_modules/@tauri-apps/cli/tauri.js');
  function tauri(args) {
    const result = spawnSync(process.execPath, [cli, ...args], {windowsHide:true,stdio:['ignore','pipe','pipe'],timeout:30000});
    assert.equal(result.status, 0, 'Tauri signer failed; captured output withheld to protect test keys');
  }
  try {
    const key = path.join(directory, 'test.key');
    tauri(['signer','generate','--write-keys',key,'--password','','--ci']);
    const publicKey = fs.readFileSync(key + '.pub', 'utf8').trim();
    const version = '0.3.0', filename = installerName(version), installer = path.join(directory, filename);
    const bytes = Buffer.from('MZ\0real Tauri updater signature test\xff', 'binary');
    fs.writeFileSync(installer, bytes);
    tauri(['signer','sign','--private-key-path',key,'--password','','--app-version',version,installer]);
    const signature = fs.readFileSync(installer + '.sig', 'utf8').trim();
    verifyMinisign(bytes, signature, publicKey, version, filename);
    const damaged = Buffer.from(bytes); damaged[damaged.length - 1] ^= 1;
    assert.throws(() => verifyMinisign(damaged, signature, publicKey, version, filename), /verification failed/);
    assert.throws(() => verifyMinisign(bytes, signature, publicKey, '0.3.1', filename), /announced app version/);
    const altered = Buffer.from(signature, 'base64').toString().replace('version:0.3.0', 'version:0.3.1');
    assert.throws(() => verifyMinisign(bytes, Buffer.from(altered).toString('base64'), publicKey, '0.3.1', filename), /comment verification failed/);
    assert.throws(() => verifyMinisign(bytes, 'not-a-signature', publicKey, version, filename));
    fs.writeFileSync(path.join(directory, 'release-manifest.json'), JSON.stringify({schemaVersion:3,version,updater:{signed:true}}));
    const feed = createUpdateManifest(directory, {publicKey,notes:'Signed installer test',pubDate:'2026-11-11T00:00:00Z'});
    assert.deepEqual(Object.keys(feed.platforms), ['windows-x86_64']);
    verifyUpdateDirectory(directory, publicKey);
    const originalFeed = JSON.stringify(feed);
    function reject(mutate, pattern) {
      const modified = JSON.parse(originalFeed); mutate(modified);
      fs.writeFileSync(path.join(directory, 'latest.json'), JSON.stringify(modified));
      assert.throws(() => verifyUpdateDirectory(directory, publicKey), pattern);
    }
    reject(value => { value.version = '0.3.1'; }, /versions differ/);
    reject(value => { value.platforms['windows-x86_64'].url = 'https://example.com/malware.exe'; }, /Unexpected update URL/);
    reject(value => { value.platforms['windows-x86_64'].signature += 'x'; }, /\.sig contents/);
    reject(value => { value.platforms['windows-x86_64'].size++; }, /size differs/);
    reject(value => { value.platforms['windows-x86_64-portable'] = value.platforms['windows-x86_64']; }, /only the Windows x64 installer/);
  } finally {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('wallpaper-box-release-test-'));
    fs.rmSync(resolved, {recursive:true,force:true});
  }
});
