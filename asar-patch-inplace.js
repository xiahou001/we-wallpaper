// 对 app.asar 做"等长原位补丁":把 index.html 槽位(26614 字节)里的内容换成
// 注入版。步骤:去掉原文件的行首缩进/空行腾空间 → 拼注入 → 用空格补齐到原长
// → 在原 offset 直接覆写。文件头(条目表)不动;Windows 端 Electron 默认不校验
// asar 内容哈希(无 fuse 哨兵),等长覆写即可生效,重启后加载。
const fs = require('fs');
const path = require('path');
// ZCode 安装目录:默认 %LOCALAPPDATA%\Programs\ZCode,可用环境变量 ZCODE_DIR 覆盖
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const ASAR = path.join(ZCODE_DIR, 'resources', 'app.asar');
const fd = fs.openSync(ASAR, 'r');
const probe = Buffer.alloc(64);
fs.readSync(fd, probe, 0, 64, 0);
const jsonSize = probe.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const DATA_START = 8 + probe.readUInt32LE(4);

const parts = ['out', 'renderer', 'index.html'];
let node = { files: header.files };
for (const p of parts) node = node.files[p];
const OFF = DATA_START + Number(node.offset);
const SIZE = node.size;
console.log('slot offset=' + OFF + ' size=' + SIZE);

const origBuf = Buffer.alloc(SIZE);
fs.readSync(fd, origBuf, 0, SIZE, OFF);
const orig = origBuf.toString('utf8');
if (orig.includes('embed.css')) { console.log('ALREADY PATCHED IN ASAR'); process.exit(0); }
if (!orig.includes('<title>ZCode</title>')) { console.error('UNEXPECTED CONTENT'); process.exit(1); }

// 压缩原文件:去掉每行行首空白与空行(HTML/CSS/JS 语义不受影响)
const compact = orig.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
const inject = '<link rel="stylesheet" href="http://127.0.0.1:7396/embed.css"/><script src="http://127.0.0.1:7396/embed.js" defer></script>';
const patched = compact.replace('<title>ZCode</title>', '<title>ZCode</title>' + inject);
const body = Buffer.from(patched, 'utf8');
if (body.length > SIZE) { console.error('DOES NOT FIT: need ' + body.length + ' > ' + SIZE); process.exit(1); }
const out = Buffer.alloc(SIZE, 0x20); // 空格补齐
body.copy(out);
fs.closeSync(fd);
const wfd = fs.openSync(ASAR, 'r+'); // 只读 fd 不能写,另开读写句柄
try {
  fs.writeSync(wfd, out, 0, SIZE, OFF);
} finally {
  fs.closeSync(wfd);
}
console.log('PATCHED IN PLACE: ' + body.length + '/' + SIZE + ' bytes used at offset ' + OFF);
