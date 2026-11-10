import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {installerName, stableVersion} from './update-signatures.mjs';
import {normalizeTauriExe} from './installer-payload.mjs';

assert.ok(process.argv[2], 'Usage: node verify-installer.mjs <release-directory> [7z.exe]');
const directory = path.resolve(process.argv[2]);
const sevenZip = process.argv[3] || path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip', '7z.exe');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 3);
assert.match(manifest.version, stableVersion);
const installer = path.join(directory, installerName(manifest.version));
const listing = execFileSync(sevenZip, ['l','-slt',installer], {windowsHide:true,maxBuffer:8*1024*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']});
const listedPaths = listing.split(/\r?\n/).filter(line => line.startsWith('Path = ')).map(line => line.slice(7).replaceAll('\\','/'));
assert.ok(!listedPaths.some(value => value.split('/').some(segment => /^(portable\.flag|UserData|\.downloads|\.imports)$/i.test(segment))), 'Installer must not contain portable mode or user data');
const unique = new Set();
for (const file of manifest.installerFiles) {
  assert.ok(typeof file.path === 'string' && !file.path.split('/').some(segment => !segment || segment === '.' || segment === '..') && !/[\\:%]/.test(file.path), 'Unsafe installer payload path');
  assert.ok(!unique.has(file.path.toLowerCase()), 'Duplicate installer payload path');
  unique.add(file.path.toLowerCase());
  assert.equal(listedPaths.filter(value => value === file.path).length, 1, `Installer payload missing or duplicate: ${file.path}`);
  let bytes = execFileSync(sevenZip, ['x','-so','-y',installer,file.path.replaceAll('/','\\')], {windowsHide:true,maxBuffer:128*1024*1024,stdio:['ignore','pipe','pipe']});
  assert.equal(bytes.length, file.bytes, `Installer payload size differs: ${file.path}`);
  if (file.path === 'wallpaper-box.exe') {
    assert.equal(file.normalization, 'tauri-bundle-type');
    bytes = normalizeTauriExe(bytes);
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, `Installer payload checksum differs: ${file.path}`);
}
const helpers = new Set(['System.dll','modern-wizard.bmp','nsDialogs.dll','nsis_tauri_utils.dll','StartMenu.dll','NSISdl.dll'].map(name => '$pluginsdir/' + name.toLowerCase()));
for (const value of listedPaths) {
  if (value === installer.replaceAll('\\','/') || unique.has(value.toLowerCase()) || helpers.has(value.toLowerCase())) continue;
  assert.fail(`Unlisted installer payload: ${value}`);
}
console.log(`Installer payload verified: ${unique.size} files; only the Tauri EXE UNK/NSS marker normalized.`);
