// Capture signer output: key material must never reach CI logs, even on errors.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {hostRoot, installerName, stableVersion} from './update-signatures.mjs';

const directory = path.resolve(process.argv[2] || '.');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
assert.match(manifest.version, stableVersion);
const environment = {...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD:process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD || ''};
const supplied = environment.TAURI_SIGNING_PRIVATE_KEY;
if (!environment.TAURI_SIGNING_PRIVATE_KEY_PATH && supplied && supplied.length < 512 && fs.existsSync(supplied)) {
  environment.TAURI_SIGNING_PRIVATE_KEY_PATH = supplied;
  delete environment.TAURI_SIGNING_PRIVATE_KEY;
}
assert.ok(environment.TAURI_SIGNING_PRIVATE_KEY || environment.TAURI_SIGNING_PRIVATE_KEY_PATH, 'An updater signing key is required');
const result = spawnSync(process.execPath, [path.join(hostRoot, 'node_modules/@tauri-apps/cli/tauri.js'),
  'signer', 'sign', '--app-version', manifest.version, path.join(directory, installerName(manifest.version))],
{env:environment, windowsHide:true, encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:120000});
if (result.status !== 0) throw new Error('Updater signing failed; signer output withheld to protect key material. Check the signing key and password.');
console.log(`Signed Windows installer for v${manifest.version}.`);
