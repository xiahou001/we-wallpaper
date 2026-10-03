#!/usr/bin/env node
/**
 * we-wallpaper — 本地动态壁纸服务器(零依赖,Node >= 18)。
 *
 * 从 dsh-wallpaper-engine 抽出的独立版:扫描 Steam Wallpaper Engine 创意工坊
 * 壁纸,Scene 类型用自带的 WebWallGL 渲染器(vendor/webwallgl,MIT)实时渲染,
 * video 类型直接播放。控制面是纯 HTTP API,供 ZCode skill / player 调用。
 *
 * 路由:
 *   GET  /                          播放页
 *   GET  /api/wallpapers            壁纸清单
 *   GET  /api/state                 当前状态 {currentId, paused, volume, rotate}
 *   POST /api/select {id}           切换壁纸
 *   POST /api/pause  {paused}       暂停/恢复
 *   POST /api/volume {volume}       0..1
 *   POST /api/rotate {enabled, intervalMin}
 *   GET  /preview/<id>              预览图(gif/jpg)
 *   GET  /media/<id>/<file...>      壁纸自有文件(视频等,支持 Range)
 *   GET  /scene-files/<token>/<rest> scene.pkg 载荷(token=base64url(abs))
 *   GET  /wallpaper-engine/scene-live/*  vendored WebWallGL 渲染页
 *
 * 状态持久化:~/.we-wallpaper/state.json
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.WE_WP_PORT || 7396);
const HOME = os.homedir();
const APP_DIR = path.join(HOME, '.we-wallpaper');
const STATE_FILE = path.join(APP_DIR, 'state.json');
const VENDOR_DIR = path.join(__dirname, 'vendor', 'webwallgl');
const PUBLIC_DIR = path.join(__dirname, 'public');
const LIVE_PREFIX = '/wallpaper-engine/scene-live';

// ── 配置/状态 ────────────────────────────────────────────────────────────────
// state.json 可加 "workshopDirs": ["<其它含 431960 的目录>"] 补充扫描路径。
let state = {
  currentId: null, paused: false, volume: 1,
  rotate: { enabled: false, intervalMin: 30, playlist: null },   // playlist:轮播列表名
  transition: { kind: 'crossfade', ms: 1800 },                    // 切换过场
  appearance: { main: 0, row: 52, sidebar: 55, brightness: 100, stroke: 35, zoom: 100 },
  readability: { auto: true },                                    // 智能可读性:按壁纸亮度换文字色
  occlusion: 'hidden',                                            // 遮挡暂停:never|hidden|focus
  sceneFps: 30,                                                   // 场景渲染帧率上限
  playlists: [],                                                  // [{name, ids:[]}]
};
try {
  const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state = {
    ...state, ...s,
    rotate: { ...state.rotate, ...(s.rotate || {}) },
    transition: { ...state.transition, ...(s.transition || {}) },
    appearance: { ...state.appearance, ...(s.appearance || {}) },
    readability: { ...state.readability, ...(s.readability || {}) },
  };
} catch {}
let luminance = null;   // 播放器实测壁纸亮度 0..1(内存态,不落盘)
const saveState = () => {
  try { fs.mkdirSync(APP_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch {}
};

// ── 壁纸扫描(参考 dsh-wallpaper-engine 的 Steam 库定位逻辑)──────────────────
function steamLibraries() {
  const vdfs = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Steam/config/libraryfolders.vdf'),
    'C:/Program Files/Steam/config/libraryfolders.vdf',
  ];
  const libs = new Set();
  for (const vdf of vdfs) {
    try {
      const t = fs.readFileSync(vdf, 'utf8');
      for (const m of t.matchAll(/"path"\s+"([^"]+)"/g)) libs.add(m[1].replace(/\\\\/g, '/'));
    } catch {}
  }
  return [...libs];
}

function scanWallpapers() {
  const roots = [];
  for (const lib of steamLibraries()) {
    roots.push(lib + '/steamapps/workshop/content/431960');
  }
  for (const extra of state.workshopDirs || []) roots.push(extra);
  // 自定义壁纸(工作台上传):~/.we-wallpaper/custom/<id>/project.json + 媒体文件
  const customRoot = path.join(APP_DIR, 'custom');
  let customIds = [];
  try { customIds = fs.readdirSync(customRoot); } catch {}
  for (const id of customIds) {
    const dir = path.join(customRoot, id);
    try { JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); roots.push(dir); } catch {}
    // 上面的通用扫描按 project.json 的 file 字段找主文件;type 也来自它
  }
  const list = [];
  for (const root of roots) {
    let ids = [];
    try { ids = fs.readdirSync(root); } catch { continue; }
    for (const id of ids) {
      const dir = path.join(root, id);
      let proj;
      try { proj = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')); } catch { continue; }
      const fileAbs = proj.file ? path.join(dir, proj.file) : null;
      const fileOk = fileAbs && fs.existsSync(fileAbs);
      const type = String(proj.type || '').toLowerCase();
      let previewAbs = proj.preview ? path.join(dir, proj.preview) : null;
      if (!previewAbs || !fs.existsSync(previewAbs)) {
        previewAbs = ['preview.jpg', 'preview.gif', 'preview.png']
          .map((f) => path.join(dir, f)).find((p) => fs.existsSync(p)) || null;
      }
      if (type === 'scene') {
        // 工坊条目常声明 scene.json 却只带打包的 scene.pkg(参考
        // dsh-wallpaper-engine 的 resolveSceneMainFileP):依次探测声明文件、
        // scene.pkg、scene.json,再退到目录里唯一的 *.pkg。
        const declared = proj.file;
        let mainAbs = [declared, 'scene.pkg', 'scene.json']
          .map((f) => (f ? path.join(dir, f) : null))
          .find((p) => p && fs.existsSync(p) && fs.statSync(p).isFile());
        if (!mainAbs) {
          try {
            const pkgs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pkg'));
            if (pkgs.length === 1) mainAbs = path.join(dir, pkgs[0]);
          } catch {}
        }
        if (mainAbs) list.push({ id, title: proj.title || id, type: 'scene', dir, fileAbs: mainAbs, previewAbs, playable: true });
        else list.push({ id, title: proj.title || id, type, dir, fileAbs: null, previewAbs, playable: false });
      } else if (type === 'video' && fileOk) {
        list.push({ id, title: proj.title || id, type: 'video', dir, fileAbs, previewAbs, playable: true });
      } else if (type === 'image' && fileOk) {
        list.push({ id, title: proj.title || id, type: 'image', dir, fileAbs, previewAbs: fileAbs, playable: true });
      } else if (type === 'web' && fileOk) {
        list.push({ id, title: proj.title || id, type: 'web', dir, fileAbs, previewAbs, playable: true });
      } else {
        list.push({ id, title: proj.title || id, type, dir, fileAbs: null, previewAbs, playable: false });
      }
    }
  }
  return list;
}
let inventory = scanWallpapers();

// ── HTTP 基础设施 ─────────────────────────────────────────────────────────────
function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.pkg': 'application/octet-stream', '.tex': 'application/octet-stream',
  '.frag': 'text/plain; charset=utf-8', '.vert': 'text/plain; charset=utf-8', '.glsl': 'text/plain; charset=utf-8',
};

/** 静态发送器:Range / ETag+Last-Modified(304)/ 缓存头。 */
function serveFile(abs, req, res, { cache = 'no-store' } = {}) {
  let st;
  try { st = fs.statSync(abs); } catch { res.statusCode = 404; res.end('not found'); return; }
  if (st.isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  const headers = { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache };
  if (cache !== 'no-store') {
    headers['ETag'] = `"${st.size}-${Math.floor(st.mtimeMs)}"`;
    headers['Last-Modified'] = st.mtime.toUTCString();
  }
  const etag = headers['ETag'];
  if (etag && req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return; }
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [a, b] = range.slice(6).split('-').map((x) => (x ? Number(x) : NaN));
    let start = Number.isFinite(a) ? a : 0;
    let end = Number.isFinite(b) ? Math.min(b, st.size - 1) : st.size - 1;
    if (start >= st.size || end < start) {
      res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return;
    }
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    headers['Content-Length'] = end - start + 1;
    headers['Accept-Ranges'] = 'bytes';
    res.writeHead(206, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(abs, { start, end }).pipe(res);
    return;
  }
  headers['Content-Length'] = st.size;
  headers['Accept-Ranges'] = 'bytes';
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(abs).pipe(res);
}

/** 目录围栏:abs 必须落在 fence 内。 */
function fenced(fence, ...parts) {
  const abs = path.resolve(fence, ...parts.filter((p) => p != null && p !== ''));
  const norm = path.resolve(fence) + path.sep;
  if (abs !== path.resolve(fence) && !abs.startsWith(norm)) return null;
  return abs;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); if (chunks.length > 1e4) req.destroy(); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── 轮换(优先用选中的轮播列表,否则全部可播壁纸)──────────────────────────────
let rotateTimer = 0;
function scheduleRotation() {
  if (rotateTimer) { clearInterval(rotateTimer); rotateTimer = 0; }
  if (!state.rotate.enabled) return;
  const ms = Math.max(1, Number(state.rotate.intervalMin) || 30) * 60_000;
  rotateTimer = setInterval(() => {
    const pl = state.playlists.find((p) => p.name === state.rotate.playlist);
    const pool = inventory.filter((w) => w.playable && (pl ? pl.ids.includes(w.id) : true));
    if (pool.length < 1) return;
    const idx = pool.findIndex((w) => w.id === state.currentId);
    state.currentId = pool[(idx + 1) % pool.length].id;
    state.paused = false;
    saveState();
  }, ms);
  rotateTimer.unref();
}

// ── 服务器 ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  const p = decodeURIComponent(u.pathname);
  const method = (req.method || 'GET').toUpperCase();

  try {
    // CORS:聊天窗口是 file:// 源,面板的 fetch 需要跨域许可(服务器只绑 127.0.0.1)
    if (p.startsWith('/api/')) {
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }
      res.setHeader('Access-Control-Allow-Origin', '*');
    }

    // ---- API ----
    if (p === '/api/wallpapers') {
      return sendJSON(res, 200, {
        wallpapers: inventory.map((w) => {
          const sceneBase = w.type === 'scene' && w.fileAbs
            ? Buffer.from(w.fileAbs, 'utf8').toString('base64url') : null;
          const rel = w.fileAbs ? path.relative(w.dir, w.fileAbs).split(path.sep).map(encodeURIComponent).join('/') : null;
          return {
            id: w.id, title: w.title, type: w.type, playable: w.playable,
            preview: w.previewAbs ? `/preview/${w.id}` : null,
            hasPkg: w.type === 'scene',
            sceneBase,                                   // scene:渲染页 src 段(其下拼 scene.pkg)
            mediaUrl: (w.type === 'video' || w.type === 'image') && rel ? `/media/${w.id}/${rel}` : null,
            sizeBytes: (() => { try { return fs.statSync(w.fileAbs).size; } catch { return 0; } })(),
          };
        }),
        state,
      });
    }
    if (p === '/api/state') return sendJSON(res, 200, { ...state, luminance });
    if (p === '/api/select' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const w = inventory.find((x) => x.id === String(body.id));
      if (!w) return sendJSON(res, 404, { error: 'no such wallpaper', id: body.id });
      if (!w.playable) return sendJSON(res, 400, { error: 'wallpaper not playable', type: w.type });
      state.currentId = w.id;
      state.paused = false;
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/pause' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      state.paused = !!body.paused;
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/volume' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      state.volume = Math.max(0, Math.min(1, Number(body.volume) || 0));
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/rotate' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      state.rotate.enabled = !!body.enabled;
      if (body.intervalMin != null) state.rotate.intervalMin = Math.max(1, Number(body.intervalMin) || 30);
      saveState();
      scheduleRotation();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/scan' && method === 'POST') {
      inventory = scanWallpapers();
      return sendJSON(res, 200, { count: inventory.length });
    }
    if (p === '/api/close' && method === 'POST') {
      state.currentId = null;                       // 关闭壁纸层,回深色底
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/transition' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const ms = Math.max(0, Math.min(8000, Number(body.ms) || 0));
      state.transition = { kind: ms > 0 ? 'crossfade' : 'none', ms };
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/appearance' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      for (const k of ['main', 'row', 'sidebar', 'stroke']) {
        if (body[k] != null) state.appearance[k] = Math.max(0, Math.min(100, Number(body[k])));
      }
      if (body.brightness != null) state.appearance.brightness = Math.max(40, Math.min(160, Number(body.brightness)));
      if (body.zoom != null) state.appearance.zoom = Math.max(80, Math.min(140, Number(body.zoom)));
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/readability' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.auto != null) state.readability.auto = !!body.auto;
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/luminance' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const v = Number(body.v);
      luminance = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null;
      return sendJSON(res, 200, { v: luminance });
    }
    if (p === '/api/advanced' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.occlusion != null && ['never', 'hidden', 'focus'].includes(body.occlusion)) state.occlusion = body.occlusion;
      if (body.sceneFps != null) state.sceneFps = [15, 30, 60].includes(Number(body.sceneFps)) ? Number(body.sceneFps) : state.sceneFps;
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/playlists' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const name = String(body.name || '').trim();
      if (!name) return sendJSON(res, 400, { error: 'name required' });
      const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
      const idx = state.playlists.findIndex((x) => x.name === name);
      if (idx >= 0) state.playlists[idx] = { name, ids };
      else state.playlists.push({ name, ids });
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/playlists/delete' && method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      state.playlists = state.playlists.filter((x) => x.name !== body.name);
      if (state.rotate.playlist === body.name) { state.rotate.playlist = null; scheduleRotation(); }
      saveState();
      return sendJSON(res, 200, state);
    }
    if (p === '/api/upload' && method === 'POST') {
      // 工作台"自定义壁纸":原始字节体,filename 走查询串(支持图片/视频)
      const filename = (u.searchParams.get('filename') || '').replace(/[\\/:*?"<>|]/g, '_');
      if (!filename) { res.statusCode = 400; return res.end('filename required'); }
      const ext = path.extname(filename).toLowerCase();
      if (!['.mp4', '.webm', '.mov', '.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) {
        res.statusCode = 400; return res.end('unsupported file type');
      }
      const type = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext) ? 'image' : 'video';
      const id = 'custom-' + Date.now();
      const dir = path.join(APP_DIR, 'custom', id);
      fs.mkdirSync(dir, { recursive: true });
      await new Promise((resolve2, reject2) => {
        const ws = fs.createWriteStream(path.join(dir, filename));
        req.pipe(ws);
        ws.on('finish', resolve2); ws.on('error', reject2); req.on('error', reject2);
      });
      fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
        title: filename.replace(/\.[^.]+$/, ''), type, file: filename,
      }));
      inventory = scanWallpapers();
      return sendJSON(res, 200, { id, count: inventory.length });
    }

    // ---- 聊天窗口背景层的远程样式/脚本与诊断 ----
    if (p === '/embed.css') {
      // DSH 式布局 + 智能可读性(源自 dsh-wallpaper-engine 的主题跟随/可读性下限):
      // 播放器实测壁纸亮度 → 亮壁纸自动切深色文字+浅玻璃,暗壁纸用浅色文字+深玻璃;
      // 文字描边滑杆控制全局 text-shadow;界面缩放/亮度热生效。
      const a = state.appearance;
      const lum = luminance == null ? 0.3 : luminance;
      const lightWall = state.readability.auto && lum > 0.55;   // 壁纸偏亮
      const glassDark = (base, alpha) =>
        alpha <= 0 ? 'transparent' : `color-mix(in srgb, ${base} ${alpha}%, transparent)`;
      const rowBase = lightWall ? '#ffffff' : '#14161c';
      const mainBase = lightWall ? '#ffffff' : '#14161c';
      const sideBase = lightWall ? '#f2f3f5' : '#0c0e12';
      const fg = lightWall ? '#1b1e24' : '#eef1f6';
      const shadow = Math.round(a.stroke * 0.5) / 100;
      const css = `
html, body { background: #101216 !important; }
#root { position: relative; z-index: 1; zoom: ${a.zoom}%; text-shadow: 0 1px 2px rgba(0,0,0,${(shadow * 0.7).toFixed(2)}), 0 0 ${(Math.max(2, Math.round(a.stroke / 10)))}px rgba(0,0,0,${(shadow * 0.45).toFixed(2)}); }
#we-wp-layer { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; z-index: 0; pointer-events: none; filter: brightness(${a.brightness}%) saturate(1.08); }
/* 文字主题跟随壁纸亮度(智能可读性) */
:root:not(.dark), .dark {
  --color-foreground: ${fg} !important;
  --color-foreground-subtle: ${fg}b8 !important;
  --color-foreground-subtlest: ${fg}80 !important;
  --color-background: ${glassDark(mainBase, a.main)} !important;
  --color-background-win-alt: ${glassDark(mainBase, a.main)} !important;
  --color-header: ${glassDark(mainBase, a.main)} !important;
  --color-background-alt: ${glassDark(rowBase, a.row)} !important;
  --color-panel: ${glassDark(rowBase, a.row + 4)} !important;
  --color-sidebar: ${glassDark(sideBase, a.sidebar)} !important;
}
.dark { --color-surface: ${glassDark(lightWall ? '#1b1e24' : '#ffffff', Math.round(a.row / 5))} !important; }
`;
      res.writeHead(200, {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(css);
    }
    if (p === '/bootstrap.js') {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'bootstrap.js'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(js);
    }
    if (p === '/embed.js') {
      const js = fs.readFileSync(path.join(__dirname, 'public', 'embed.js'), 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      return res.end(js);
    }
    if (p === '/api/diag') {
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }
      const body = await readBody(req);
      try {
        fs.mkdirSync(APP_DIR, { recursive: true });
        fs.appendFileSync(path.join(APP_DIR, 'diag.log'),
          new Date().toISOString() + ' ' + body.slice(0, 8000) + '\n');
      } catch {}
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end('"ok"');
    }

    if (p === '/embed-test') {
      return serveFile(path.join(PUBLIC_DIR, 'embed-test.html'), req, res);
    }
    if (p === '/workbench') {
      return serveFile(path.join(PUBLIC_DIR, 'workbench.html'), req, res);
    }
    if (p === '/workbench.js') return serveFile(path.join(PUBLIC_DIR, 'workbench.js'), req, res, { cache: 'no-store' });
    if (p === '/workbench.css') return serveFile(path.join(PUBLIC_DIR, 'workbench.css'), req, res, { cache: 'no-store' });

    // ---- 播放页 ----
    if (p === '/' || p === '/index.html') {
      return serveFile(path.join(PUBLIC_DIR, 'player.html'), req, res);
    }
    if (p === '/player.js') return serveFile(path.join(PUBLIC_DIR, 'player.js'), req, res);
    if (p === '/panel.js') return serveFile(path.join(PUBLIC_DIR, 'panel.js'), req, res, { cache: 'no-store' });
    if (p === '/player.css') return serveFile(path.join(PUBLIC_DIR, 'player.css'), req, res);

    // ---- 预览图 ----
    if (p.startsWith('/preview/')) {
      const id = p.slice('/preview/'.length);
      const w = inventory.find((x) => x.id === id);
      if (!w || !w.previewAbs) { res.statusCode = 404; return res.end('no preview'); }
      return serveFile(w.previewAbs, req, res, { cache: 'public, max-age=300' });
    }

    // ---- 壁纸自有文件(目录围栏=壁纸目录)----
    if (p.startsWith('/media/')) {
      const rest = p.slice('/media/'.length); // <id>/<file...>
      const slash = rest.indexOf('/');
      const id = rest.slice(0, slash);
      const rel = rest.slice(slash + 1);
      const w = inventory.find((x) => x.id === id);
      if (!w) { res.statusCode = 404; return res.end('no such wallpaper'); }
      const abs = fenced(w.dir, rel);
      if (!abs) { res.statusCode = 403; return res.end('forbidden-media'); }
      return serveFile(abs, req, res, { cache: 'public, max-age=3600' });
    }

    // ---- scene.pkg 载荷(token=base64url(scene.pkg 绝对路径),与 dsh-wallpaper-engine 同协议)----
    if (p.startsWith('/scene-files/')) {
      const rest = p.slice('/scene-files/'.length); // <token>/<file...>
      const slash = rest.indexOf('/');
      const token = rest.slice(0, slash);
      const rel = rest.slice(slash + 1);
      let fileAbs;
      try { fileAbs = Buffer.from(token, 'base64url').toString('utf8'); } catch { res.statusCode = 400; return res.end('bad token'); }
      if (!fileAbs || (!fs.existsSync(fileAbs) && !fs.existsSync(path.dirname(fileAbs)))) { res.statusCode = 404; return res.end('stale token'); }
      const abs = fenced(path.dirname(fileAbs), rel);
      if (!abs) { res.statusCode = 403; return res.end('forbidden-scene-files'); }
      return serveFile(abs, req, res, { cache: 'public, max-age=3600' });
    }

    // ---- vendored WebWallGL 渲染页(哈希名资源 immutable)----
    if (p === LIVE_PREFIX || p.startsWith(LIVE_PREFIX + '/')) {
      const rel = p.slice(LIVE_PREFIX.length).replace(/^\/+/, '') || 'index.html';
      const abs = fenced(VENDOR_DIR, rel);
      if (!abs) { res.statusCode = 403; return res.end('forbidden-scene-live'); }
      return serveFile(abs, req, res, { cache: rel === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable' });
    }

    res.statusCode = 404;
    res.end('not found');
  } catch (err) {
    try { sendJSON(res, 500, { error: String((err && err.message) || err) }); } catch {}
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const playable = inventory.filter((w) => w.playable).length;
  console.log(`[we-wallpaper] http://127.0.0.1:${PORT}  壁纸 ${inventory.length} 个(可播放 ${playable})`);
  console.log(`[we-wallpaper] 状态文件: ${STATE_FILE}`);
});
scheduleRotation();
