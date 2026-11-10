const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const size=256,raw=Buffer.alloc((size*4+1)*size);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
 const p=y*(size*4+1)+1+x*4,dx=x-127.5,dy=y-127.5;
 if(dx*dx+dy*dy<118*118){const light=1-y/size*.2;raw[p]=Math.round(68*light);raw[p+1]=Math.round(105*light);raw[p+2]=Math.round(80*light);raw[p+3]=255;
  const wave=109+Math.sin(x/27)*13;
  if(x>52&&x<204&&(Math.abs(y-wave)<6||Math.abs(y-wave-37)<6)){raw[p]=237;raw[p+1]=238;raw[p+2]=205;}
 }
}
function crc(data){let c=0xffffffff;for(const byte of data){c^=byte;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(type,data){const tag=Buffer.from(type),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([length,tag,data,sum]);}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
const ico=Buffer.alloc(22);ico.writeUInt16LE(1,2);ico.writeUInt16LE(1,4);ico.writeUInt16LE(1,10);ico.writeUInt16LE(32,12);ico.writeUInt32LE(png.length,14);ico.writeUInt32LE(22,18);
const dest=path.resolve(__dirname,'../src-tauri/icons');fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,'icon.png'),png);fs.writeFileSync(path.join(dest,'icon.ico'),Buffer.concat([ico,png]));
