// 把 app.asar 完整解包到 resources/app(Electron 优先加载 app 目录,原 asar 不动)
// node asar-extract.js
const fs = require('fs');
const path = require('path');
// ZCode 安装目录:默认 %LOCALAPPDATA%\Programs\ZCode,可用环境变量 ZCODE_DIR 覆盖
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const ASAR = path.join(ZCODE_DIR, 'resources', 'app.asar');
const UNPACKED = ASAR + '.unpacked';
const DEST = path.join(ZCODE_DIR, 'resources', 'app');
const fd = fs.openSync(ASAR, 'r');
const probe = Buffer.alloc(64);
fs.readSync(fd, probe, 0, 64, 0);
const jsonSize = probe.readUInt32LE(12);
const jsonBuf = Buffer.alloc(jsonSize);
fs.readSync(fd, jsonBuf, 0, jsonSize, 16);
const header = JSON.parse(jsonBuf.toString('utf8'));
const DATA_START = 8 + probe.readUInt32LE(4);

let files = 0, dirs = 0, links = 0;
function walk(node, rel) {
  for (const [name, child] of Object.entries(node.files || {})) {
    const abs = path.join(DEST, rel, name);
    const r = rel ? rel + '/' + name : name;
    if (child.link) { // symlink:直接跳过(Windows 客户端包里若有也会在 unpacked 处理)
      links++; continue;
    }
    if (child.files) { fs.mkdirSync(abs, { recursive: true }); dirs++; walk(child, r); continue; }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (child.unpacked) {
      const src = path.join(UNPACKED, r);
      try { fs.copyFileSync(src, abs); } catch (e) { console.error('unpacked miss: ' + r); }
    } else {
      const len = child.size;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, DATA_START + Number(child.offset));
      fs.writeFileSync(abs, buf);
    }
    files++;
  }
}
fs.mkdirSync(DEST, { recursive: true });
walk({ files: header.files }, '');
console.log('DONE files=' + files + ' dirs=' + dirs + ' linksSkipped=' + links);
