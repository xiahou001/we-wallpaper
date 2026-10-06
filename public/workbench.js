/**
 * workbench.js — DSH 式壁纸工作台页面逻辑(独立页,也被聊天窗口模态引用)。
 * 左侧导航四个分区:壁纸 / 外观 / 轮播 / 高级;数据走壁纸服务器 HTTP API。
 */
(function () {
  var BASE = location.origin;
  var state = null, wallpapers = [], playlists = [];
  var page = 'wall';
  var editorName = null, editorIds = null;
  var scanStatus = '';              // "重新扫描"的结果提示,跨 render 保留
  var content = document.getElementById('content');

  function api(path, body) {
    return fetch(BASE + path, body !== undefined ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : undefined).then(function (r) { return r.json(); });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  // 悬停预取:提前触发服务端的 faststart 重排与元数据 Range 请求,
  // 点击播放时首帧立即可得(单槽 + 60s TTL,避免重复预热)
  var preheatSlot = null, preheatAt = 0;
  function preheat(w) {
    if (!w || !w.mediaUrl) return;
    var now = Date.now();
    if (preheatSlot === w.id && now - preheatAt < 60000) return;
    preheatSlot = w.id; preheatAt = now;
    fetch(BASE + w.mediaUrl, { headers: { Range: 'bytes=0-65535' }, cache: 'no-store' }).catch(function () {});
  }
    var typeLabel = function (w) { return w.type === 'scene' ? '场景' : w.type === 'video' ? '视频' : w.type === 'image' ? '图片' : w.type === 'web' ? '网页' : w.type; };
  var cur = function () { return wallpapers.find(function (w) { return state && w.id === state.currentId; }) || null; };

  // forceScan=true 时先调 /api/scan(手动重新扫描 / 打开面板),
  // 让 Steam 刚下载或退订的壁纸立即反映到列表。
  function loadData(forceScan) {
    var pre = forceScan ? api('/api/scan', {}).catch(function () { return null; }) : Promise.resolve(null);
    return pre.then(function () {
      return Promise.all([api('/api/wallpapers'), api('/api/state')]);
    }).then(function (rs) {
      wallpapers = rs[0].wallpapers || [];
      state = rs[1];
      playlists = state.playlists || [];
    });
  }

  function render() {
    content.innerHTML = '';
    if (!state) { content.appendChild(el('div', 'loading', '壁纸服务器暂不可用 —— 请确认 we-wallpaper 服务器在运行')); return; }
    if (page === 'wall') renderWall();
    else if (page === 'look') renderLook();
    else if (page === 'rot') renderRot();
    else renderAdv();
  }

  // ── 壁纸 ─────────────────────────────────────────────────
  function renderWall() {
    content.appendChild(el('div', 'sec', '当前壁纸'));
    var w = cur();
    var hero = el('div', 'hero');
    var disc = el('img', 'disc' + (w && !state.paused ? ' spinning' : ''));   // 黑胶唱片效果
    disc.src = w && w.preview ? w.preview : '';
    hero.appendChild(disc);
    var info = el('div', 'info');
    if (w) {
      info.appendChild(el('div', 'name', w.title));
      info.appendChild(el('div', 'meta', typeLabel(w) + '壁纸 · ' + (state.paused ? '已暂停' : '播放中')));
    } else {
      info.appendChild(el('div', 'name', '壁纸未启用'));
      info.appendChild(el('div', 'meta', '从下方列表选择一张壁纸开始'));
    }
    hero.appendChild(info);
    var acts = el('div', 'acts');
    var closeBtn = el('button', 'btn danger', '关闭壁纸');
    closeBtn.onclick = function () { api('/api/close', {}).then(function (s) { state = s; render(); }); };
    acts.appendChild(closeBtn);
    hero.appendChild(acts);
    content.appendChild(hero);

    content.appendChild(el('div', 'sec', '播放控制'));
    var ctl = el('div', 'row');
    var pause = el('button', 'btn' + (state.paused ? ' on' : ''), state.paused ? '▶ 恢复播放' : '⏸ 暂停');
    pause.onclick = function () { api('/api/pause', { paused: !state.paused }).then(function (s) { state = s; render(); }); };
    var mute = el('button', 'btn', state.volume > 0 ? '🔊 音乐开' : '🔇 音乐关');
    mute.onclick = function () { api('/api/volume', { volume: state.volume > 0 ? 0 : 1 }).then(function (s) { state = s; render(); }); };
    ctl.appendChild(pause); ctl.appendChild(mute);
    content.appendChild(ctl);

    content.appendChild(el('div', 'sec', '自定义壁纸(上传图片 / 视频 / 单文件网页)'));
    var up = el('div', 'row');
    var file = document.createElement('input');
    file.type = 'file'; file.accept = 'video/mp4,video/webm,image/*,.html,.htm'; file.style.display = 'none';
    var upBtn = el('button', 'btn primary', '⬆ 上传壁纸');
    var upStat = el('span', 'muted', '支持 mp4 / webm / jpg / png / gif');
    upBtn.onclick = function () { file.click(); };
    file.onchange = function () {
      var f = file.files[0];
      if (!f) return;
      upStat.textContent = '上传中… ' + f.name + '(' + Math.round(f.size / 1048576) + 'MB)';
      fetch(BASE + '/api/upload?filename=' + encodeURIComponent(f.name), {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: f,
      }).then(function (r) { return r.json(); })
        .then(function () { upStat.textContent = '已加入列表'; return loadData(); })
        .then(render)
        .catch(function () { upStat.textContent = '上传失败'; });
    };
    up.appendChild(upBtn); up.appendChild(upStat); up.appendChild(file);
    content.appendChild(up);

    content.appendChild(el('div', 'sec', '内容分级过滤(源自 dsh-wallpaper-engine)'));
    var cfRow = el('div', 'row');
    var cf = el('button', 'btn' + (state.contentFilter ? ' on' : ''), state.contentFilter ? '● 已隐藏 R 级' : '○ 不过滤');
    cf.onclick = function () { api('/api/advanced', { contentFilter: !state.contentFilter }).then(function (s) { state = s; render(); }); };
    cfRow.appendChild(cf);
    content.appendChild(cfRow);
    content.appendChild(el('div', 'sec', '选择壁纸(' + wallpapers.filter(function (x) { return x.playable; }).length + ' 张可用)'));
    var grid = el('div', 'grid');
    wallpapers.forEach(function (wp) {
      var card = el('div', 'card' + (state.currentId === wp.id ? ' current' : '') + (wp.playable ? '' : ' dead'));
      if (wp.playable) { card.onclick = function () { api('/api/select', { id: wp.id }).then(function (s) { state = s; render(); }); }; card.onpointerenter = function () { preheat(wp); }; }
      var img = el('img', 'thumb'); img.loading = 'lazy'; img.src = wp.preview || '';
      var name = el('div', 'name', wp.title);
      name.appendChild(el('span', 'badge', typeLabel(wp)));
      card.appendChild(img); card.appendChild(name);
      grid.appendChild(card);
    });
    content.appendChild(grid);
  }

  // ── 外观 ─────────────────────────────────────────────────
  function slider(parent, label, value, min, max, oninput) {
    var row = el('div', 'row');
    row.appendChild(el('label', null, label));
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = min; inp.max = max; inp.value = value;
    var val = el('span', 'val', value + '%');
    inp.oninput = function () { val.textContent = inp.value + '%'; oninput(Number(inp.value)); };
    row.appendChild(inp); row.appendChild(val);
    parent.appendChild(row);
  }
    function renderLook() {
      content.appendChild(el('div', 'sec', '智能可读性(源自 dsh-wallpaper-engine 的主题跟随)'));
      var rr = el('div', 'row');
      var rbtn = el('button', 'btn' + (state.readability.auto ? ' on' : ''), state.readability.auto ? '● 已开启' : '○ 已关闭');
      rbtn.title = '按壁纸实测亮度自动切换文字颜色:亮壁纸→深色文字+浅玻璃,暗壁纸→浅色文字+深玻璃';
      rbtn.onclick = function () { api('/api/readability', { auto: !state.readability.auto }).then(function (s) { state = s; render(); }); };
      rr.appendChild(rbtn);
      rr.appendChild(el('span', 'muted', '实测亮度:' + (state.luminance != null ? Math.round(state.luminance * 100) + '%' : '测量中…')));
      content.appendChild(rr);

      content.appendChild(el('div', 'sec', '文字描边(对抗亮壁纸上的浅色字)'));
      slider(content, '描边强度', state.appearance.stroke, 0, 100, function (v) { state.appearance.stroke = v; api('/api/appearance', { stroke: v }); });

      content.appendChild(el('div', 'sec', '界面玻璃透明度(改动约 5 秒内自动应用到聊天窗口)'));
      slider(content, '主区背景', state.appearance.main, 0, 100, function (v) { state.appearance.main = v; api('/api/appearance', { main: v }); });
      slider(content, '行 / 面板', state.appearance.row, 0, 100, function (v) { state.appearance.row = v; api('/api/appearance', { row: v }); });
      slider(content, '侧栏', state.appearance.sidebar, 0, 100, function (v) { state.appearance.sidebar = v; api('/api/appearance', { sidebar: v }); });

      content.appendChild(el('div', 'sec', '壁纸与界面'));
      slider(content, '壁纸亮度', state.appearance.brightness, 50, 160, function (v) { state.appearance.brightness = v; api('/api/appearance', { brightness: v }); });
      slider(content, '界面缩放', state.appearance.zoom, 80, 140, function (v) { state.appearance.zoom = v; api('/api/appearance', { zoom: v }); });
      slider(content, '聊天框磨砂(blur)', state.appearance.blur, 0, 40, function (v) { state.appearance.blur = v; api('/api/appearance', { blur: v }); });
      // 聊天框玻璃颜色:与 ZCode 的 Wallpaper Engine 设置页同一形式(色板 + 自定义取色)
      var swRow = el('div', 'row');
      swRow.appendChild(el('label', null, '聊天框玻璃颜色'));
      var GLASS_PALETTE = ['#14161c', '#000000', '#2ec5d3', '#e79bb0', '#f0a04b', '#e8615a', '#f2f3f5', '#8ecf5a'];
      var curGlass = state.appearance.glassColor || '#14161c';
      GLASS_PALETTE.forEach(function (c) {
        var b = document.createElement('button');
        b.title = c;
        b.style.cssText = 'width:26px;height:26px;border-radius:50%;padding:0;cursor:pointer;background:' + c
          + ';border:2px solid ' + (curGlass === c ? '#f2f3f5' : 'rgba(255,255,255,.22)') + ';';
        b.onclick = function () { api('/api/appearance', { glassColor: c }).then(function (s) { state = s; render(); }); };
        swRow.appendChild(b);
      });
      var customColor = document.createElement('input');
      customColor.type = 'color';
      customColor.value = curGlass;
      customColor.title = '自定义玻璃颜色';
      customColor.style.cssText = 'width:34px;height:26px;padding:0;border:0;background:transparent;cursor:pointer;';
      customColor.oninput = function () { state.appearance.glassColor = customColor.value; api('/api/appearance', { glassColor: customColor.value }); };
      customColor.onchange = function () { api('/api/appearance', { glassColor: customColor.value }).then(function (s) { state = s; render(); }); };
      swRow.appendChild(customColor);
      content.appendChild(swRow);
      content.appendChild(el('div', 'muted', '当前玻璃颜色 ' + curGlass + ';浅色玻璃会自动切换成深色文字。'));
      slider(content, '聊天框玻璃透明度', state.appearance.glass, 0, 100, function (v) { state.appearance.glass = v; api('/api/appearance', { glass: v }); });
      content.appendChild(el('div', 'muted', '玻璃透明度:0 = 完全实心,100 = 最透(最能看清壁纸)。改动约 5 秒内自动应用,不需要重启 ZCode。'));

      content.appendChild(el('div', 'sec', '快速预设'));
      var presets = el('div', 'row');
      [['全透', { main: 0, row: 52, sidebar: 55 }], ['轻纱', { main: 30, row: 62, sidebar: 64 }], ['雾面', { main: 62, row: 76, sidebar: 78 }]].forEach(function (p) {
        var b = el('button', 'btn', p[0]);
        b.onclick = function () { api('/api/appearance', p[1]).then(function (s) { state = s; render(); }); };
        presets.appendChild(b);
      });
      content.appendChild(presets);
    }

  // ── 轮播 ─────────────────────────────────────────────────
  function renderRot() {
    content.appendChild(el('div', 'sec', '自动轮转'));
    var row = el('div', 'row');
    var rot = el('button', 'btn' + (state.rotate.enabled ? ' on' : ''), state.rotate.enabled ? '● 轮转中' : '○ 已关闭');
    rot.onclick = function () {
      api('/api/rotate', { enabled: !state.rotate.enabled, intervalMin: state.rotate.intervalMin, playlist: state.rotate.playlist })
        .then(function (s) { state = s; render(); });
    };
    row.appendChild(rot);
    var sel = document.createElement('select');
    [15, 30, 60, 120].forEach(function (m) {
      var o = document.createElement('option');
      o.value = m; o.textContent = m + ' 分钟';
      if (state.rotate.intervalMin === m) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = function () {
      api('/api/rotate', { enabled: state.rotate.enabled, intervalMin: Number(sel.value), playlist: state.rotate.playlist })
        .then(function (s) { state = s; render(); });
    };
    row.appendChild(sel);
    content.appendChild(row);

    content.appendChild(el('div', 'sec', '轮播列表'));
    var prow = el('div', 'row');
    var psel = document.createElement('select');
    var none = document.createElement('option'); none.value = ''; none.textContent = '— 全部壁纸 —';
    psel.appendChild(none);
    playlists.forEach(function (p) {
      var o = document.createElement('option'); o.value = p.name; o.textContent = p.name + ' (' + p.ids.length + ' 张)';
      if (state.rotate.playlist === p.name) o.selected = true;
      psel.appendChild(o);
    });
    psel.onchange = function () {
      api('/api/rotate', { enabled: state.rotate.enabled, intervalMin: state.rotate.intervalMin, playlist: psel.value || null })
        .then(function (s) { state = s; render(); });
    };
    prow.appendChild(psel);
    var newBtn = el('button', 'btn primary', '新建列表');
    newBtn.onclick = function () {
      editorName = '轮播 ' + new Date().toISOString().slice(5, 16).replace('T', ' ');
      editorIds = null; render();
    };
    prow.appendChild(newBtn);
    var delBtn = el('button', 'btn danger', '删除当前');
    delBtn.onclick = function () {
      if (!state.rotate.playlist) return;
      api('/api/playlists/delete', { name: state.rotate.playlist }).then(function (s) { state = s; return loadData(); }).then(render);
    };
    prow.appendChild(delBtn);
    content.appendChild(prow);

    if (editorName != null) {
      content.appendChild(el('div', 'sec', '编辑:' + editorName));
      var nameRow = el('div', 'row');
      var nameIn = document.createElement('input');
      nameIn.type = 'text'; nameIn.value = editorName;
      nameRow.appendChild(nameIn);
      content.appendChild(nameRow);
      var box = el('div', 'plistbox');
      wallpapers.forEach(function (w) {
        if (!w.playable) return;
        var c = el('label', 'chk');
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = editorIds ? editorIds.indexOf(w.id) >= 0 : true;
        cb.onchange = function () {
          editorIds = editorIds || wallpapers.filter(function (x) { return x.playable; }).map(function (x) { return x.id; });
          if (cb.checked) { if (editorIds.indexOf(w.id) < 0) editorIds.push(w.id); }
          else editorIds = editorIds.filter(function (x) { return x !== w.id; });
        };
        var img = el('img'); img.src = w.preview || '';
        c.appendChild(cb); c.appendChild(img);
        c.appendChild(el('span', 'n', w.title));
        box.appendChild(c);
      });
      content.appendChild(box);
      var srow = el('div', 'row');
      var save = el('button', 'btn primary', '保存列表');
      save.onclick = function () {
        var nm = nameIn.value.trim() || editorName;
        api('/api/playlists', { name: nm, ids: editorIds || wallpapers.filter(function (x) { return x.playable; }).map(function (x) { return x.id; }) })
          .then(function (s) { state = s; return loadData(); })
          .then(function () { editorName = editorIds = null; render(); });
      };
      srow.appendChild(save);
      var cancel = el('button', 'btn', '取消');
      cancel.onclick = function () { editorName = editorIds = null; render(); };
      srow.appendChild(cancel);
      content.appendChild(srow);
    } else {
      content.appendChild(el('div', 'muted', state.rotate.playlist
        ? '当前使用列表:' + state.rotate.playlist
        : '未选择列表 = 在全部可播壁纸中轮转'));
    }
  }

  // ── 高级 ─────────────────────────────────────────────────
    function renderAdv() {
      content.appendChild(el('div', 'sec', '切换过场(交叉淡化)'));
      var row = el('div', 'row');
      [['无', 0], ['快 600ms', 600], ['标准 1800ms', 1800], ['慢 3000ms', 3000]].forEach(function (p) {
        var b = el('button', 'btn' + (state.transition.ms === p[1] ? ' on' : ''), p[0]);
        b.onclick = function () { api('/api/transition', { ms: p[1] }).then(function (s) { state = s; render(); }); };
        row.appendChild(b);
      });
      content.appendChild(row);
      content.appendChild(el('div', 'muted', '换壁纸时新旧画面交叉淡化,当前 ' + state.transition.ms + ' ms'));

      content.appendChild(el('div', 'sec', '省电(源自 dsh-wallpaper-engine)'));
      var fpsRow = el('div', 'row');
      fpsRow.appendChild(el('label', null, '场景帧率上限'));
      [15, 30, 60].forEach(function (f) {
        var b = el('button', 'btn' + (state.sceneFps === f ? ' on' : ''), f + ' fps');
        b.onclick = function () { api('/api/advanced', { sceneFps: f }).then(function (s) { state = s; render(); }); };
        fpsRow.appendChild(b);
      });
      content.appendChild(fpsRow);
      var occRow = el('div', 'row');
      occRow.appendChild(el('label', null, '遮挡暂停'));
      [['never', '从不'], ['hidden', '切走/最小化时'], ['focus', '失焦即停']].forEach(function (p) {
        var b = el('button', 'btn' + (state.occlusion === p[0] ? ' on' : ''), p[1]);
        b.onclick = function () { api('/api/advanced', { occlusion: p[0] }).then(function (s) { state = s; render(); }); };
        occRow.appendChild(b);
      });
      content.appendChild(occRow);
      content.appendChild(el('div', 'muted', '场景帧率改动在下次切换壁纸时生效;遮挡暂停对视频与场景壁纸同时生效。'));

      content.appendChild(el('div', 'sec', '媒体集成(源自 dsh-wallpaper-engine)'));
      var lyrRow = el('div', 'row');
      var lyr = el('button', 'btn' + (state.lyrics ? ' on' : ''), state.lyrics ? '● 歌词跑马灯已开启' : '○ 歌词跑马灯已关闭');
      lyr.title = 'Now Playing 播放音乐时,在聊天窗口底部显示 lrclib.net 的同步歌词(默认关闭)';
      lyr.onclick = function () { api('/api/advanced', { lyrics: !state.lyrics }).then(function (s) { state = s; render(); }); };
      lyrRow.appendChild(lyr);
      content.appendChild(lyrRow);
      var npLine = el('div', 'muted', '正在读取系统媒体信息…');
      api('/api/nowplaying').then(function (np) {
        npLine.textContent = np && np.available && np.title
          ? 'Now Playing:' + np.title + (np.artist ? ' — ' + np.artist : '') + ' · ' + (np.status === 'playing' ? '播放中' : np.status)
          : 'Now Playing:当前没有正在播放的媒体(支持所有走 Windows 媒体控件的播放器)';
      }).catch(function () { npLine.textContent = 'Now Playing:不可用'; });
      content.appendChild(npLine);

      content.appendChild(el('div', 'sec', '维护'));
      var row2 = el('div', 'row');
      var scan = el('button', 'btn primary', '⟳ 重新扫描壁纸库');
      // 手动扫描:立即重读工坊目录,并汇报新增/删除/清理结果(否则"点了几次都不知道有没有生效")。
      scan.onclick = function () {
        scan.disabled = true;
        scanStatus = '正在扫描 Steam 工坊目录…';
        api('/api/scan', {}).then(function (r) {
          return loadData().then(function () {
            var bits = [];
            if (r && r.added) bits.push('新增 ' + r.added + ' 张');
            if (r && r.removed) bits.push('移除 ' + r.removed + ' 张');
            if (r && r.prunedCache) bits.push('清理缓存 ' + r.prunedCache + ' 项');
            scanStatus = '已扫描完成:共 ' + ((r && r.count) || wallpapers.length) + ' 张壁纸 · '
              + (bits.length ? bits.join('，') : '没有变化');
            render();
          });
        }).catch(function () {
          scanStatus = '扫描失败:请确认壁纸服务器 (127.0.0.1:7396) 正在运行';
          render();
        });
      };
      row2.appendChild(scan);
      content.appendChild(row2);
      content.appendChild(el('div', 'muted', scanStatus
        || '删除或退订壁纸后点这里可立即同步;平时每 5 秒也会自动同步。'));

      content.appendChild(el('div', 'sec', '状态'));
      content.appendChild(el('div', 'muted',
        '壁纸 ' + wallpapers.length + ' 张 · 轮播列表 ' + playlists.length + ' 个 · 当前 ' +
        (cur() ? cur().title : '未启用') + ' · 服务器 127.0.0.1:7396'));
    }

  // ── 导航 ─────────────────────────────────────────────────
  document.querySelectorAll('.nav nav button').forEach(function (b) {
    b.onclick = function () {
      page = b.dataset.page;
      editorName = editorIds = null;
      document.querySelectorAll('.nav nav button').forEach(function (x) { x.classList.toggle('on', x === b); });
      render();
    };
  });
  // 模态宿主:Esc 关闭
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') parent.postMessage('we-wp-close', '*');
  });

  loadData(true).then(render).catch(function () { render(); });
  // 状态轮询(打开期间保持同步)
  setInterval(function () {
    api('/api/state').then(function (s) {
      // 亮度采样每 5s 都在变,剔除后再对比,否则工作台每 5s 重渲染打断滑杆操作
      var a = Object.assign({}, s, { luminance: undefined });
      var b = Object.assign({}, state, { luminance: undefined });
      if (!panelDirty() && JSON.stringify(a) !== JSON.stringify(b)) { state = s; playlists = s.playlists || []; render(); }
    }).catch(function () {});
  }, 3000);
  var inventoryBusy = false;
  setInterval(function () {
    if (inventoryBusy || panelDirty()) return;
    inventoryBusy = true;
    Promise.all([api('/api/wallpapers'), api('/api/state')]).then(function (rs) {
      var next = rs[0].wallpapers || [];
      var oldKey = wallpapers.map(function (x) { return x.id + ':' + x.title + ':' + x.playable; }).join('|');
      var newKey = next.map(function (x) { return x.id + ':' + x.title + ':' + x.playable; }).join('|');
      if (oldKey !== newKey) { wallpapers = next; state = rs[1]; playlists = state.playlists || []; render(); }
    }).catch(function () {}).then(function () { inventoryBusy = false; });
  }, 5000);
  function panelDirty() { return editorName != null; }
})();
