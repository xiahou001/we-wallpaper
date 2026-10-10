// 从备份恢复 app.asar 的 index.html 原始字节(配合 restore.cmd / 手动恢复)
const fs = require('fs');
const path = require('path');
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const ASAR = path.join(ZCODE_DIR, 'resources', 'app.asar');
const BACKUP_DIR = path.join(require('os').homedir(), '.we-wallpaper', 'asar-backup');
const metaFile = path.join(BACKUP_DIR, 'meta.json');
const binFile = path.join(BACKUP_DIR, 'index.html.bin');

if (!fs.existsSync(metaFile) || !fs.existsSync(binFile)) {
  console.error('没有找到备份(' + BACKUP_DIR + ')。影子目录时代的安装无需恢复。');
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
const st = fs.statSync(ASAR);
if (st.size !== meta.asarSize) {
  console.error('app.asar 大小与备份时不一致(ZCode 已更新?),拒绝恢复以免损坏。');
  console.error('更新后的 asar 本来就是原生未注入状态,无需恢复。');
  process.exit(1);
}
const data = fs.readFileSync(binFile);
if (data.length > meta.slotSize) { console.error('备份数据长度异常'); process.exit(1); }
// 原生备份是"压缩去注入"版(比槽位短):恢复时用空格补齐到槽位长度
const out = Buffer.alloc(meta.slotSize, 0x20);
data.copy(out);
const fd = fs.openSync(ASAR, 'r');
const probe = Buffer.alloc(64);
fs.readSync(fd, probe, 0, 64, 0);
fs.closeSync(fd);
const DATA_START = 8 + probe.readUInt32LE(4);
const OFF = DATA_START + meta.slotOffset;
const cur = Buffer.alloc(16);
const rfd = fs.openSync(ASAR, 'r');
fs.readSync(rfd, cur, 0, 16, OFF);
fs.closeSync(rfd);
if (cur.toString('utf8', 0, 16) === data.toString('utf8', 0, 16) && data.includes('embed.css')) {
  console.log('该区域当前就是注入状态,准备恢复原生字节…');
}
let wfd;
try { wfd = fs.openSync(ASAR, 'r+'); } catch (e) { console.error('无法写入(被占用?):' + e.message); process.exit(1); }
try { fs.writeSync(wfd, out, 0, out.length, OFF); } finally { fs.closeSync(wfd); }
console.log('RESTORED: 原始 index.html 字节已写回 offset ' + OFF + '。重启 ZCode 即为原生界面。');
