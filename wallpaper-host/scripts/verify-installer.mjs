import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const directory=path.resolve(process.argv[2]);
const sevenZip=process.argv[3]||path.join(process.env.ProgramFiles||'C:\\Program Files','7-Zip','7z.exe');
const manifest=JSON.parse(fs.readFileSync(path.join(directory,'release-manifest.json'),'utf8'));
assert.match(manifest.version,/^\d+\.\d+\.\d+$/);
const installer=path.join(directory,`wallpaper-box_${manifest.version}_x64-setup.exe`);
const installerListing=execFileSync(sevenZip,['l','-slt',installer],{windowsHide:true,maxBuffer:8*1024*1024,encoding:'utf8',stdio:['ignore','pipe','pipe']});
assert.ok(!installerListing.split(/\r?\n/).some(line=>line==='Path = portable.flag'),'NSIS installer must not contain the portable mode marker');
let verifiedFiles=0;
for(const file of manifest.portableFiles){
  assert.ok(!file.path.includes('..')&&!file.path.startsWith('/')&&!file.path.includes('\\'),'Unsafe payload path');
  // The marker is intentionally exclusive to the portable ZIP and is validated
  // there by verify-release.ps1; NSIS must not enable portable storage mode.
  if(file.path==='portable.flag')continue;
  // Decode each NSIS payload to stdout. No installer execution, disk extraction,
  // registry changes, or temporary directory removal is needed.
  const bytes=execFileSync(sevenZip,['x','-so','-y',installer,file.path.replaceAll('/','\\')],{windowsHide:true,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
  assert.equal(bytes.length,file.bytes,`Installer payload size differs: ${file.path}`);
  if(file.path==='wallpaper-box.exe'&&createHash('sha256').update(bytes).digest('hex')!==file.sha256){
    // tauri-utils::platform::__TAURI_BUNDLE_TYPE is deliberately patched from
    // UNK (portable) to NSS (NSIS). Normalize only these three bytes and require
    // every other byte to match; the outer installer hash remains exact.
    const portable=execFileSync(sevenZip,['x','-so','-y',path.join(directory,`wallpaper-box_${manifest.version}_windows-x64-portable.zip`),'wallpaper-box.exe'],{windowsHide:true,maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']});
    assert.equal(createHash('sha256').update(portable).digest('hex'),file.sha256);
    const marker=Buffer.from('__TAURI_BUNDLE_TYPE_VAR_UNK');
    const offset=portable.indexOf(marker);
    assert.ok(offset>=0,'Portable Tauri bundle marker is missing');
    assert.equal(bytes.subarray(offset,offset+marker.length).toString(),'__TAURI_BUNDLE_TYPE_VAR_NSS');
    marker.copy(bytes,offset);
  }
  assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256,`Installer payload checksum differs: ${file.path}`);
  verifiedFiles++;
}
console.log(`Installer payload verified: ${verifiedFiles} shared files (portable.flag excluded; Tauri EXE bundle marker normalized).`);
