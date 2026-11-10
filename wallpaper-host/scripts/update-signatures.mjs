// Tauri's base64-wrapped Minisign format. Verification uses Node/OpenSSL's
// Ed25519 primitive, not a reimplementation of the signature algorithm.
import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const repository = 'whoarei/wallpaper-box';
export const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
export const hostRoot = path.dirname(scriptsRoot);
export const repoRoot = path.dirname(hostRoot);
export const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export const installerName = version => `wallpaper-box_${version}_x64-setup.exe`;

function base64(value, label) {
  assert.equal(typeof value, 'string', `${label} must be text`);
  const text = value.trim();
  assert.ok(text.length > 0 && text.length <= 16384 && text.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(text), `Invalid ${label} encoding`);
  const bytes = Buffer.from(text, 'base64');
  assert.equal(bytes.toString('base64'), text, `Non-canonical ${label} encoding`);
  return bytes;
}

export function updaterPublicKey() {
  const config = JSON.parse(fs.readFileSync(path.join(hostRoot, 'src-tauri/tauri.conf.json'), 'utf8'));
  const key = config.plugins?.updater?.pubkey;
  assert.equal(typeof key, 'string', 'Configure plugins.updater.pubkey before signing releases');
  return key;
}

export function verifyMinisign(bytes, encodedSignature, encodedPublicKey, version, filename) {
  assert.match(version, stableVersion, 'Invalid signed app version');
  const keyLines = base64(encodedPublicKey, 'public key').toString('utf8').trimEnd().split(/\r?\n/);
  assert.equal(keyLines.length, 2, 'Invalid Minisign public key');
  assert.ok(keyLines[0].startsWith('untrusted comment: '), 'Invalid public key comment');
  const publicBytes = base64(keyLines[1], 'public key body');
  assert.equal(publicBytes.length, 42, 'Invalid public key size');
  assert.equal(publicBytes.subarray(0, 2).toString(), 'Ed', 'Unsupported public key algorithm');
  const lines = base64(encodedSignature, 'signature').toString('utf8').trimEnd().split(/\r?\n/);
  assert.equal(lines.length, 4, 'Invalid Minisign signature');
  assert.ok(lines[0].startsWith('untrusted comment: '), 'Invalid signature comment');
  assert.ok(lines[2].startsWith('trusted comment: '), 'Missing signed comment');
  const signature = base64(lines[1], 'artifact signature');
  const globalSignature = base64(lines[3], 'comment signature');
  assert.equal(signature.length, 74, 'Invalid artifact signature size');
  assert.equal(globalSignature.length, 64, 'Invalid comment signature size');
  assert.equal(signature.subarray(0, 2).toString(), 'ED', 'Updater signature must use Minisign prehash mode');
  assert.ok(signature.subarray(2, 10).equals(publicBytes.subarray(2, 10)), 'Signature key ID differs');
  const publicKey = createPublicKey({format:'der', type:'spki', key:Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'), publicBytes.subarray(10)
  ])});
  const digest = createHash('blake2b512').update(bytes).digest();
  assert.ok(verify(null, digest, publicKey, signature.subarray(10)), 'Installer signature verification failed');
  const comment = lines[2].slice('trusted comment: '.length);
  assert.ok(verify(null, Buffer.concat([signature.subarray(10), Buffer.from(comment)]), publicKey, globalSignature), 'Signed comment verification failed');
  const versions = comment.split('\t').filter(field => field.startsWith('version:'));
  assert.deepEqual(versions, [`version:${version}`], 'Signature must bind the announced app version');
  if (filename) assert.ok(comment.split('\t').includes(`file:${filename}`), 'Signed filename differs');
  return comment;
}

export function verifyUpdateDirectory(directory, publicKey = updaterPublicKey()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, 3, 'Expected installer release manifest schema 3');
  assert.match(manifest.version, stableVersion);
  assert.equal(manifest.updater?.signed, true, 'Release must have signed updater artifacts');
  const filename = installerName(manifest.version);
  const bytes = fs.readFileSync(path.join(directory, filename));
  const signature = fs.readFileSync(path.join(directory, filename + '.sig'), 'utf8').trim();
  verifyMinisign(bytes, signature, publicKey, manifest.version, filename);
  const update = JSON.parse(fs.readFileSync(path.join(directory, 'latest.json'), 'utf8'));
  assert.equal(update.version, manifest.version, 'Update and release versions differ');
  assert.equal(typeof update.notes, 'string', 'Update notes must be text');
  assert.ok(update.notes.length <= 65536, 'Update notes are too large');
  assert.ok(typeof update.pub_date === 'string' && Number.isFinite(Date.parse(update.pub_date)), 'Invalid publication date');
  assert.deepEqual(Object.keys(update.platforms), ['windows-x86_64'], 'Release supports only the Windows x64 installer');
  const platform = update.platforms['windows-x86_64'];
  assert.equal(platform.url, `https://github.com/${repository}/releases/download/v${manifest.version}/${filename}`, 'Unexpected update URL');
  assert.equal(platform.signature, signature, 'Manifest signature must contain the .sig contents');
  assert.equal(platform.size, bytes.length, 'Announced installer size differs');
  return {version:manifest.version, installer:filename, size:bytes.length};
}
