import assert from 'node:assert/strict';
import path from 'node:path';
import {verifyUpdateDirectory} from './update-signatures.mjs';

assert.ok(process.argv[2], 'Usage: node verify-update-signatures.mjs <release-directory>');
const result = verifyUpdateDirectory(path.resolve(process.argv[2]));
console.log(`Verified updater signature and signed app version v${result.version}: ${result.installer} (${result.size} bytes).`);
