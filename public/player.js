/**
 * we-wallpaper 播放页。
 *
 * scene 壁纸:挂 vendored WebWallGL 渲染页 iframe(/wallpaper-engine/scene-live/),
 * 通过 URL 参数传入载荷地址 —— 协议与 dsh-wallpaper-engine 的 liveRenderUrl 一致:
 *   ?type=scene&fit=cover&sceneFps=30&muted=…&src=<base64url(scene.pkg绝对路径)>&mediaBase=<origin>/scene-files
 * video 壁纸:直接 <video loop> 播放 /media/<id>/<文件名>。
 *
 * 控制面状态来自服务器 /api/state(单真源):本页每 2s 轮询,
 * 因此 ZCode skill 走 HTTP API 切换/暂停时,已打开的播放页会即时跟随。
 */
(() => {
  // embed=1:作为 ZCode 聊天窗口的背景层运行 —— 隐藏控制界面、不绑任何键盘/鼠标
  // 事件(避免抢聊天输入),只按服务器状态渲染;控制一律走 skill 的 HTTP API。
  const EMBED = new URLSearchParams(location.search).has('embed');
  const stage = document.getElementById('stage');
  const $ = (id) => document.getElementById(id);

  let wallpapers = [];
  let state = { currentId: null, paused: false, volume: 1, rotate: { enabled: false, intervalMin: 30 } };
  let mountedId = null;
  let layer = null;          // 当前层元素(iframe / video / img)
  let hudTimer = 0;
  let sawGesture = false;    // 首次用户手势后允许出声
  let recoveryTimer = 0;
  let recoveryAttempts = 0;
  let sceneWatchdog = 0;

  const api = (path, body) => fetch(path, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : undefined).then((r) => r.json());
  const current = () => wallpapers.find((w) => w.id === state.currentId) || null;
  function notifyParentReady() {
    if (!EMBED || window.parent === window) return;
    try { window.parent.postMessage({ source: 'we-wallpaper', type: 'ready' }, '*'); } catch {}
  }

  // ── 挂载/卸载 ──────────────────────────────────────────────
  function unmount() {
    clearTimeout(recoveryTimer);
    clearTimeout(sceneWatchdog);
    if (!layer) return;
    try { layer.src = 'about:blank'; } catch {}
    layer.remove();
    layer = null;
    mountedId = null;
  }

  function wallpaperFailed(w, reason) {
    const active = current();
    if (!w || !active || active.id !== w.id) return;
    const attempt = ++recoveryAttempts;
    try {
      fetch('/api/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'playback-recovery', id: w.id, type: w.type, attempt, reason }) }).catch(() => {});
    } catch {}
    if (attempt <= 3) {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        if (current().id !== w.id) return;
        unmount();
        mountedId = null;
        mountCurrent();
      }, Math.min(8000, 1000 * attempt));
      return;
    }
    // Scene 优先尝试从 scene.pkg 中抽出的内嵌 MP4，再降级到作者预览图。
    if (w.type === 'scene') {
      unmount();
      const v = document.createElement('video');
      v.loop = true; v.muted = effectiveMuted(); v.autoplay = true; v.playsInline = true;
      v.src = '/scene-video/' + encodeURIComponent(w.id); v.className = 'layer-enter';
      v.addEventListener('loadeddata', () => { recoveryAttempts = 0; v.classList.add('layer-on'); });
      v.addEventListener('error', () => { unmount(); if (w.preview) { mountFallback(w); $('hud-title').textContent = w.title + '（预览图）'; } });
      stage.appendChild(v); layer = v; mountedId = w.id; v.play().catch(() => {});
      $('hud-title').textContent = w.title + '（视频降级）';
    } else if (w.preview) {
      unmount();
      mountFallback(w);
      $('hud-title').textContent = w.title + '（预览图）';
    }
  }

  function mountScene(w) {
    const iframe = document.createElement('iframe');
    iframe.allow = 'autoplay';
    iframe.setAttribute('allowtransparency', 'true');
    const muted = effectiveMuted();
    const fps = state.sceneFps || 30;
    const src = '/wallpaper-engine/scene-live/index.html'
      + '?type=scene&fit=cover&sceneFps=' + fps
      + '&muted=' + (muted ? 'true' : 'false')
      + '&src=' + encodeURIComponent(w.sceneBase)
      + '&mediaBase=' + encodeURIComponent(location.origin + '/scene-files');
    iframe.src = src;
    iframe.className = 'layer-enter';
    iframe.addEventListener('load', () => {
      requestAnimationFrame(() => iframe.classList.add('layer-on'));
    });
    iframe.addEventListener('error', () => wallpaperFailed(w, 'scene-iframe-error'));
    stage.appendChild(iframe);
    layer = iframe;
    mountedId = w.id;
    clearTimeout(sceneWatchdog);
    sceneWatchdog = setTimeout(() => {
      if (layer !== iframe || mountedId !== w.id) return;
      try {
        const ready = iframe.contentWindow && iframe.contentWindow.__wp;
        if (!ready) wallpaperFailed(w, 'scene-timeout');
      } catch { wallpaperFailed(w, 'scene-timeout'); }
    }, 12000);
  }

  function mountVideo(w) {
    const v = document.createElement('video');
    v.loop = true;
    v.muted = effectiveMuted();
    v.autoplay = true;
    v.playsInline = true;
    v.src = w.mediaUrl;
    v.className = 'layer-enter';
    v.addEventListener('loadeddata', () => {
      recoveryAttempts = 0;
      requestAnimationFrame(() => v.classList.add('layer-on'));
    });
    v.addEventListener('error', () => wallpaperFailed(w, 'video-error'));
    v.addEventListener('stalled', () => {
      clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        if (layer === v && v.readyState < 2) wallpaperFailed(w, 'video-stalled');
      }, 8000);
    });
    stage.appendChild(v);
    layer = v;
    v.play().catch(() => {});
    requestAnimationFrame(() => v.classList.add('layer-on'));
    mountedId = w.id;
  }

  function mountImage(w) {
    const img = document.createElement('img');
    img.src = w.mediaUrl;
    img.className = 'layer-enter';
    stage.appendChild(img);
    layer = img;
    mountedId = w.id;
  }

  function mountFallback(w) {
    const img = document.createElement('img');
    if (w.preview) img.src = w.preview;
    img.className = 'layer-enter';
    stage.appendChild(img);
    layer = img;
    mountedId = w.id;
  }

  function mountCurrent() {
    const w = current();
    if (!w) {                                   // 已关闭:卸载,回深色底
      unmount();
      $('hud-title').textContent = '壁纸已关闭';
      document.title = '动态壁纸';
      return;
    }
    if (w.id === mountedId) return;
    recoveryAttempts = 0;
    clearTimeout(recoveryTimer);
    const ms = state.transition ? (state.transition.ms || 0) : 0;
    // 旧层淡出(交叉淡化:新旧层叠放,旧的盖不住新的)
    if (layer) {
      const old = layer;
      layer = null;
      if (ms > 0) {
        old.style.transition = 'opacity ' + ms + 'ms ease';
        old.style.opacity = '0';
        setTimeout(() => { try { old.remove(); } catch {} }, ms + 150);
      } else {
        old.remove();
      }
    }
    $('hud-title').textContent = w.title;
    document.title = w.title + ' · 动态壁纸';
    if (w.playable && w.type === 'scene') mountScene(w);
    else if (w.playable && w.type === 'video') mountVideo(w);
    else if (w.playable && w.type === 'image') mountImage(w);
    else mountFallback(w);
    if (layer) {
      layer.style.zIndex = '1';                 // 新层压住淡出中的旧层
      if (ms > 0) {
        layer.style.transition = 'opacity ' + ms + 'ms ease';
        layer.style.opacity = '0';
        requestAnimationFrame(() => { if (layer) layer.style.opacity = '1'; });
      }
    }
    applyPaused();
  }

  // ── 控制下发 ───────────────────────────────────────────────
  const effectiveMuted = () => state.volume <= 0;

  function applyPaused() {
    if (!layer || !current() || current().id !== mountedId) return;
    // 遮挡暂停三档:never=仅手动;hidden=切走/最小化;focus=失焦即停(省电)
    var occluded = state.occlusion === 'hidden' ? document.hidden
      : state.occlusion === 'focus' ? (document.hidden || !document.hasFocus())
      : false;
    const paused = state.paused || occluded;
    try {
      if (layer.tagName === 'IFRAME') {
        const wp = layer.contentWindow && layer.contentWindow.__wp;
        if (wp) (paused ? wp.pause() : wp.resume());
      } else if (layer.tagName === 'VIDEO') {
        if (paused) layer.pause();
        else layer.play().catch(() => {});
      }
    } catch {}
    $('btn-pause').textContent = state.paused ? '▶' : '⏸';
  }

  function applyVolume() {
    const muted = effectiveMuted();
    try {
      if (layer && layer.tagName === 'IFRAME') {
        const wp = layer.contentWindow && layer.contentWindow.__wp;
        if (wp && wp.setVolume) wp.setVolume(muted ? 0 : state.volume);
      } else if (layer && layer.tagName === 'VIDEO') {
        layer.muted = muted;
        layer.volume = Math.max(0.01, state.volume);
      }
    } catch {}
    $('btn-mute').textContent = muted ? '🔇' : '🔊';
    // 出声切换对渲染页是初始化参数,改不动已就绪的 iframe;重建层让其生效。
  }

  function applyRotate() {
    $('btn-rotate').classList.toggle('hbtn--active', !!state.rotate.enabled);
  }

  // ── 亮度采样(智能可读性):视频帧/场景抓帧 → 平均亮度 → 上报服务器 ──
  var lumCanvas = document.createElement('canvas');
  lumCanvas.width = 64; lumCanvas.height = 36;
  function reportLuminance(v) {
    fetch('/api/luminance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: v }) }).catch(function () {});
  }
  function luminanceFromImage(img) {
    try {
      var ctx = lumCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 64, 36);
      var d = ctx.getImageData(0, 0, 64, 36).data;
      var sum = 0;
      for (var i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      reportLuminance(sum / (d.length / 4) / 255);
    } catch (e) {}
  }
  function sampleLuminance() {
    try {
      if (!layer || state.paused) return;
      if (layer.tagName === 'VIDEO' && layer.videoWidth) { luminanceFromImage(layer); return; }
      if (layer.tagName === 'IFRAME') {
        var wp = layer.contentWindow && layer.contentWindow.__wp;
        if (wp && typeof wp.capture === 'function') {
          var url = wp.capture();
          if (url) { var im = new Image(); im.onload = function () { luminanceFromImage(im); }; im.src = url; }
        }
      }
    } catch (e) {}
  }
  setInterval(sampleLuminance, 5000);

  // ── 轮询(服务器是单真源,skill 的改动会即时生效)──────────────
  let pollBusy = false;
  async function poll() {
    if (pollBusy) return;
    pollBusy = true;
    try {
      const prev = JSON.stringify(state);
      state = await api('/api/state');
      if (JSON.stringify(state) !== prev) {
        mountCurrent();
        applyPaused();
        applyVolume();
        applyRotate();
      }
    } catch {} // 服务器暂离:保持当前画面
    pollBusy = false;
  }
  setInterval(poll, 2000);

  // ── HUD 交互 ───────────────────────────────────────────────
  function pokeHud() {
    if (EMBED) return;
    $('hud').classList.remove('hud--hidden');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => $('hud').classList.add('hud--hidden'), 3000);
  }
  if (!EMBED) {
    ['mousemove', 'mousedown', 'keydown', 'touchstart'].forEach((ev) =>
      window.addEventListener(ev, pokeHud, { passive: true }));
  }

  async function togglePause() {
    state = await api('/api/pause', { paused: !state.paused });
    applyPaused();
  }
  async function toggleMute() {
    sawGesture = true;
    state = await api('/api/volume', { volume: state.volume > 0 ? 0 : 1 });
    applyVolume();
  }
  async function toggleRotate() {
    state = await api('/api/rotate', { enabled: !state.rotate.enabled });
    applyRotate();
  }

  $('btn-pause').onclick = togglePause;
  $('btn-mute').onclick = toggleMute;
  $('btn-rotate').onclick = toggleRotate;
  $('btn-full').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  };
  $('btn-list').onclick = () => $('panel').classList.toggle('panel--hidden');
  $('panel-close').onclick = () => $('panel').classList.add('panel--hidden');

  window.addEventListener('keydown', (e) => {
    if (EMBED) return; // 背景层绝不抢聊天窗口的键盘事件
    sawGesture = true;
    if (e.key === ' ') { e.preventDefault(); togglePause(); }
    else if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (e.key === 'f' || e.key === 'F') $('btn-full').onclick();
    else if (e.key === 'l' || e.key === 'L') $('panel').classList.toggle('panel--hidden');
    else if (e.key === 'Escape') $('panel').classList.add('panel--hidden');
  });

  document.addEventListener('visibilitychange', applyPaused);

  // ── 列表 ───────────────────────────────────────────────────
  function renderList() {
    const box = $('panel-list');
    box.innerHTML = '';
    for (const w of wallpapers) {
      const item = document.createElement('div');
      item.className = 'wp-item' + (w.id === state.currentId ? ' wp-item--current' : '')
        + (w.playable ? '' : ' wp-item--unplayable');
      const thumb = document.createElement('img');
      thumb.className = 'wp-item__thumb';
      thumb.loading = 'lazy';
      thumb.src = w.preview || '';
      const meta = document.createElement('div');
      meta.className = 'wp-item__meta';
      const name = document.createElement('div');
      name.className = 'wp-item__name';
      name.textContent = w.title;
      const sub = document.createElement('div');
      sub.className = 'wp-item__sub';
      sub.innerHTML = (w.type === 'scene' ? '场景' : w.type === 'video' ? '视频' : w.type) +
        (w.playable ? ' <span class="wp-item__badge">' + (w.hasPkg ? 'WebGL' : 'MP4') + '</span>' : ' <span class="wp-item__badge">不可播</span>');
      meta.append(name, sub);
      item.append(thumb, meta);
      if (w.playable) item.onclick = async () => { sawGesture = true; state = await api('/api/select', { id: w.id }); mountCurrent(); renderList(); };
      box.appendChild(item);
    }
  }

  // ── 启动 ───────────────────────────────────────────────────
  (async () => {
    const inv = await api('/api/wallpapers');
    wallpapers = inv.wallpapers;
    state = inv.state;
    // 未选过 → 默认第一张可播放的
    if (!state.currentId || !current() || !current().playable) {
      const first = wallpapers.find((w) => w.playable);
      if (first) { state = await api('/api/select', { id: first.id }); }
    }
    renderList();
    applyRotate();
    mountCurrent();
    if (EMBED) {
      document.body.classList.add('embed');
      notifyParentReady();
      setTimeout(notifyParentReady, 1000);
    } else {
      pokeHud();
    }
  })();
})();
