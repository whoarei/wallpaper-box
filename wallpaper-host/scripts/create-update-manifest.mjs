import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {installerName, repository, repoRoot, stableVersion, updaterPublicKey, verifyMinisign} from './update-signatures.mjs';

export function createUpdateManifest(directory, {publicKey = updaterPublicKey(), notes, pubDate = new Date().toISOString()} = {}) {
  const release = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
  assert.equal(release.schemaVersion, 3);
  assert.equal(release.updater?.signed, true);
  assert.match(release.version, stableVersion);
  const filename = installerName(release.version);
  const bytes = fs.readFileSync(path.join(directory, filename));
  const signature = fs.readFileSync(path.join(directory, filename + '.sig'), 'utf8').trim();
  verifyMinisign(bytes, signature, publicKey, release.version, filename);
  const notesFile = path.join(repoRoot, '.github/release-notes', `v${release.version}.md`);
  notes ??= fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8') : `壁纸盒子 v${release.version}`;
  const result = {version:release.version, notes, pub_date:pubDate, platforms:{'windows-x86_64':{
    signature, url:`https://github.com/${repository}/releases/download/v${release.version}/${filename}`, size:bytes.length
  }}};
  fs.writeFileSync(path.join(directory, 'latest.json'), JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], 'Usage: node create-update-manifest.mjs <release-directory>');
  const result = createUpdateManifest(path.resolve(process.argv[2]));
  console.log(`Created signed updater manifest v${result.version}: Windows x64 installer only.`);
}
