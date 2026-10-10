// 补丁看门狗:壁纸服务器周期性检查 ZCode 客户端的注入补丁是否还在,
// 被 ZCode 自动更新覆盖后自动重新打上(asar 解包 + index.html 注入 + 原位补丁)。
// 这样"ZCode 更新 → 壁纸掉线"不再需要人工跑 apply.cmd。
const { execFile } = require('child_process');
const path = require('path');

const ROOT = __dirname;
const ZCODE_DIR = process.env.ZCODE_DIR || path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ZCode');
const ASAR = path.join(ZCODE_DIR, 'resources', 'app.asar');
const UNPACKED_INDEX = path.join(ZCODE_DIR, 'resources', 'app', 'out', 'renderer', 'index.html');
const MARK = 'bootstrap.js';           // 注入标志
const CHECK_MS = 60 * 1000;            // 每分钟检查一次
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 两次重打补丁的最小间隔(补丁失败时不要疯狂重试)

let lastApply = 0;
let applying = false;

function patchMissing() {
  // 已解包目录存在 → 只看 index.html 是否还有注入
  if (require('fs').existsSync(UNPACKED_INDEX)) {
    try {
      return !require('fs').readFileSync(UNPACKED_INDEX, 'utf8').includes(MARK);
    } catch { return true; }
  }
  // 没有解包目录 → Electron 会直接加载 app.asar,检查 asar 里的槽位是否已注入
  try {
    const fd = require('fs').openSync(ASAR, 'r');
    const probe = Buffer.alloc(64);
    require('fs').readSync(fd, probe, 0, 64, 0);
    const jsonSize = probe.readUInt32LE(12);
    const jsonBuf = Buffer.alloc(jsonSize);
    require('fs').readSync(fd, jsonBuf, 0, jsonSize, 16);
    const header = JSON.parse(jsonBuf.toString('utf8'));
    const dataStart = 8 + probe.readUInt32LE(4);
    let node = { files: header.files };
    for (const p of ['out', 'renderer', 'index.html']) node = node.files[p];
    const off = dataStart + Number(node.offset);
    const buf = Buffer.alloc(Math.min(node.size, 8192));
    require('fs').readSync(fd, buf, 0, buf.length, off);
    require('fs').closeSync(fd);
    return !buf.toString('utf8').includes(MARK);
  } catch { return false; } // asar 读取失败(如正在更新)→ 不动,下轮再看
}

function runApply() {
  if (applying || Date.now() - lastApply < MIN_INTERVAL_MS) return;
  applying = true;
  console.log('[watchdog] 检测到补丁丢失,重新打补丁…');
  execFile('cmd.exe', ['/d', '/s', '/c', 'apply.cmd'], { cwd: ROOT, timeout: 120000 },
    (err, stdout, stderr) => {
      applying = false;
      lastApply = Date.now();
      console.log('[watchdog] ' + (err
        ? '打补丁失败: ' + String(stderr || err.message).trim()
        : '打补丁完成: ' + String(stdout).trim().replace(/\s+/g, ' | ')));
    });
}

const timer = setInterval(() => { if (patchMissing()) runApply(); }, CHECK_MS);
timer.unref();
// 启动时先查一轮
setTimeout(() => { if (patchMissing()) runApply(); }, 15 * 1000).unref();
console.log('[watchdog] 补丁看门狗已启动(每 60s 检查一次)');
module.exports = { patchMissing, startPatchWatchdog: () => {} }; // 定时器随模块加载即启动
