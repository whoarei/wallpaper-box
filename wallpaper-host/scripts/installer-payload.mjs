import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export function normalizeTauriExe(input) {
  const bytes = Buffer.from(input), prefix = Buffer.from('__TAURI_BUNDLE_TYPE_VAR_');
  let offset = -1, count = 0;
  while ((offset = bytes.indexOf(prefix, offset + 1)) >= 0) {
    const type = bytes.subarray(offset + prefix.length, offset + prefix.length + 3).toString();
    assert.ok(type === 'UNK' || type === 'NSS', 'Unexpected Tauri bundle marker');
    Buffer.from('UNK').copy(bytes, offset + prefix.length);
    count++;
  }
  assert.ok(count > 0 && count <= 16, 'Unexpected Tauri bundle marker count');
  return bytes;
}

export const normalizedExeHash = bytes => createHash('sha256').update(normalizeTauriExe(bytes)).digest('hex');
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  assert.ok(process.argv[2], 'Usage: node installer-payload.mjs <base-executable>');
  console.log(normalizedExeHash(fs.readFileSync(process.argv[2])));
}
