// 对 app.asar 做"等长原位补丁"——推荐的注入方式(替代 resources/app 影子目录)。
//
// 为什么比影子目录稳定:
//   影子目录(resources/app)会一直遮蔽 app.asar。ZCode 更新替换 asar 后,旧影子
//   仍在 ⇒ 旧前端配新后端 ⇒ 协议错乱/报错。原位补丁则随更新自然失效(回原生),
//   重新跑一次 apply 即可,永远不会出现新旧错配。
//
// 步骤:① 若从未备份,先把原始 index.html 字节存到 ~/.we-wallpaper/asar-backup/;
//      ② 压缩腾空间 → 注入微型加载器 → 空格补齐到原长 → 原 offset 覆写;
//      ③ 读回校验。文件头不动;Windows 端 Electron 默认不校验 asar 内容哈希。
const fs = require('fs');
const path = require('path');
// ZCode 安装目录:默认 %LOCALAPPDATA%\Programs\ZCode,可用环境变量 ZCODE_DIR 覆盖
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const ASAR = path.join(ZCODE_DIR, 'resources', 'app.asar');
const BACKUP_DIR = path.join(require('os').homedir(), '.we-wallpaper', 'asar-backup');

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

// ── 备份:只在首次补丁时保存原始字节(含 slot 元数据)──
const metaFile = path.join(BACKUP_DIR, 'meta.json');
if (!fs.existsSync(metaFile)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  fs.writeFileSync(path.join(BACKUP_DIR, 'index.html.bin'), pristineBuf);
  // 若槽位已含注入(老安装迁移/重跑),先剥离注入标签再备份 —— 永远不把补丁字节当原生备份
  let pristineBuf = origBuf;
  if (orig.includes('127.0.0.1:7396')) {
    const s = orig
      .replace(/<link rel="stylesheet" href="http:\/\/127\.0\.0\.1:7396\/[^\"]*"\s*\/?>/g, '')
      .replace(/<script src="http:\/\/127\.0\.0\.1:7396\/[^\"]*"[^>]*><\/script>/g, '');
    pristineBuf = Buffer.from(s, 'utf8');
    console.log('槽位已含旧注入:备份已剥离注入标签(原生字节)');
  }
  fs.writeFileSync(metaFile, JSON.stringify({
    backedUpAt: new Date().toISOString(),
    slotOffset: OFF, slotSize: SIZE, asarSize: fs.statSync(ASAR).size,
  }, null, 2));
  console.log('原始 index.html 已备份到 ' + BACKUP_DIR);
} else {
  console.log('备份已存在,跳过');
}

if (orig.includes('embed.css') && orig.includes('bootstrap.js')) { console.log('ALREADY PATCHED IN ASAR'); process.exit(0); }
if (!orig.includes('<title>ZCode</title>')) { console.error('UNEXPECTED CONTENT'); process.exit(1); }

// 压缩原文件并 upgrade any previous loader to the retrying bootstrap.
const compact = orig.replace(/^[ \t]+/gm, '').replace(/\n{2,}/g, '\n');
const inject = '<link rel="stylesheet" href="http://127.0.0.1:7396/embed.css?v=2"/><script src="http://127.0.0.1:7396/bootstrap.js?v=2" defer></script>';
const loader = /<link\s+rel="stylesheet"\s+href="http:\/\/127\.0\.0\.1:7396\/embed\.css[^"]*"\s*\/?><script\s+src="http:\/\/127\.0\.0\.1:7396\/(?:embed|bootstrap)\.js[^"]*"\s+defer><\/script>/g;
const patched = loader.test(compact)
  ? compact.replace(loader, inject)
  : compact.includes('bootstrap.js')
    ? compact
    : compact.replace('<title>ZCode</title>', '<title>ZCode</title>' + inject);
const body = Buffer.from(patched, 'utf8');
if (body.length > SIZE) { console.error('DOES NOT FIT: need ' + body.length + ' > ' + SIZE); process.exit(1); }
const out = Buffer.alloc(SIZE, 0x20); // 空格补齐
body.copy(out);

// ── 写入(处理 ZCode 正在运行时的占用)──
let wfd;
try {
  wfd = fs.openSync(ASAR, 'r+'); // 只读 fd 不能写,另开读写句柄
} catch (e) {
  console.error('无法打开 app.asar 写入(可能被正在运行的 ZCode 锁定):' + e.message);
  console.error('请完全退出 ZCode 后重新运行本脚本。');
  process.exit(1);
}
try {
  fs.writeSync(wfd, out, 0, SIZE, OFF);
} catch (e) {
  console.error('写入失败:' + e.message);
  console.error('请完全退出 ZCode 后重新运行本脚本。');
  process.exit(1);
} finally {
  fs.closeSync(wfd);
}

// ── 读回校验 ──
const vfd = fs.openSync(ASAR, 'r');
const vbuf = Buffer.alloc(SIZE);
fs.readSync(vfd, vbuf, 0, SIZE, OFF);
fs.closeSync(vfd);
if (!vbuf.toString('utf8').includes('embed.css')) { console.error('READBACK MISMATCH!'); process.exit(1); }
console.log('PATCHED IN PLACE: ' + body.length + '/' + SIZE + ' bytes used at offset ' + OFF + '(读回校验通过)');
console.log('提示:ZCode 更新后注入会自然失效回原生(不报错),重新运行 apply 即可。');
