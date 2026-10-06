// 追加到 server.mjs:faststart(moov 前置)无损重排 —— 源自 dsh-wallpaper-engine
// 未发布版的「切换延迟根因」修复:moov 在文件尾部的 mp4,浏览器为读元数据要顺流
// 整读整个文件(实测 764MB/1.7s),切换延迟 ∝ 文件大小。一次性 `ffmpeg -c copy
// -movflags +faststart`(不重编码,实测 729MB/0.92s),按「源路径+大小+mtime」缓存。
import { execFile } from 'node:child_process';

let ffmpegPath = undefined;
let ffmpegChecked = false;
function detectFfmpeg() {
  if (ffmpegChecked) return ffmpegPath;
  ffmpegChecked = true;
  const cands = [];
  if (process.env.FFMPEG_PATH) cands.push(process.env.FFMPEG_PATH);
  cands.push('ffmpeg'); // PATH
  try {
    // winget 装的 Gyan.FFmpeg
    const wl = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Packages');
    for (const d of fs.readdirSync(wl) || []) {
      if (!d.toLowerCase().startsWith('gyan.ffmpeg')) continue;
      const base = path.join(wl, d);
      for (const v of fs.readdirSync(base)) {
        cands.push(path.join(base, v, 'bin', 'ffmpeg.exe'));
        cands.push(path.join(base, v, 'ffmpeg.exe'));
      }
    }
  } catch {}
  cands.push(path.join(HOME, '.dsh-wallpaper-engine', 'ffmpeg', 'ffmpeg.exe'));
  for (const c of cands) {
    try {
      execFileSync(c, ['-version'], { stdio: 'ignore', timeout: 5000 });
      ffmpegPath = c;
      return ffmpegPath;
    } catch {}
  }
  return null;
}

// moov 是否已在文件头部(前 2MB 内):在 → 播放器元数据立即可得;不在 → 需要重排
function moovAtHead(abs) {
  try {
    const fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(Math.min(2 * 1024 * 1024, fs.statSync(abs).size));
    try { fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
    return buf.indexOf(Buffer.from('moov')) >= 0;
  } catch { return true; }
}

// 变体生成(带去重:同一源并发请求共享同一个 promise)
const faststartJobs = new Map();
function faststartVariant(abs, id) {
  try {
    const st = fs.statSync(abs);
    if (!/\.(mp4|m4v|mov)$/i.test(abs)) return Promise.resolve(null);
    if (!detectFfmpeg()) return Promise.resolve(null);
    const key = abs + '|' + st.size + '|' + Math.floor(st.mtimeMs);
    const outDir = path.join(APP_DIR, 'cache', 'faststart');
    const out = path.join(outDir, id + '.mp4');
    if (fs.existsSync(out) && fs.statSync(out).size > 1024) return Promise.resolve(out);
    if (moovAtHead(abs)) return Promise.resolve(null);   // 已是 faststart,无需重排
    if (faststartJobs.has(key)) return faststartJobs.get(key);
    const job = new Promise((resolve) => {
      fs.mkdirSync(outDir, { recursive: true });
      const tmp = out + '.tmp';
      execFile(ffmpegPath, ['-y', '-i', abs, '-c', 'copy', '-movflags', '+faststart', tmp],
        { timeout: 120000 }, (err) => {
          faststartJobs.delete(key);
          try {
            if (err || !fs.existsSync(tmp) || fs.statSync(tmp).size < 1024) {
              diagRecord('faststart-error', { id, error: String(err && err.message || err).slice(0, 240) });
              return resolve(null);
            }
            fs.renameSync(tmp, out);
            diagRecord('faststart-ok', { id, bytes: fs.statSync(out).size });
            resolve(out);
          } catch (e2) { diagRecord('faststart-error', { id, error: String(e2 && e2.message || e2).slice(0, 240) }); resolve(null); }
        });
    });
    faststartJobs.set(key, job);
    return job;
  } catch (err) {
    diagRecord('faststart-error', { id, error: String(err && err.message || err).slice(0, 240) });
    return Promise.resolve(null);
  }
}
