/**
 * embed.js — 注入进 ZCode 聊天窗口的壁纸层逻辑(经 /embed.js 加载)。
 *
 * 职责:
 *   1. 挂 pointer-events:none 的 iframe 壁纸层 + 服务器探活重试;
 *   2. 热更新样式:每 5s 拉 embed.css,变了立即应用 —— 服务器上改样式,
 *      用户窗口 5 秒内自动生效,永远不需要刷新/重启客户端;
 *   3. DOM 诊断每 60s 上报(data-slot 普查 + 大面积表面),驱动行级玻璃精调。
 */
(function () {
  var BASE = 'http://127.0.0.1:7396';

  // ── 热更新样式 ──────────────────────────────────────────────
  var styleEl = null;
  var lastCss = '';
  function refreshCss() {
    fetch(BASE + '/embed.css', { cache: 'no-store' })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        if (t === lastCss) return;
        if (!styleEl) {
          styleEl = document.createElement('style');
          styleEl.id = 'we-wp-style-dyn';
          document.head.appendChild(styleEl);
        }
        styleEl.textContent = t;
        lastCss = t;
      })
      .catch(function () {});
  }

  // ── 壁纸 iframe ────────────────────────────────────────────
  function mount() {
    var old = document.getElementById('we-wp-layer');
    if (old) {
      if (old.src.indexOf(BASE + '/') !== 0) old.src = BASE + '/?embed=1';
      old.style.display = 'block';
      old.style.visibility = 'visible';
      return;
    }
    var f = document.createElement('iframe');
    f.id = 'we-wp-layer';
    f.setAttribute('allow', 'autoplay');
    f.setAttribute('allowtransparency', 'true');
    f.setAttribute('title', 'wallpaper');
    f.style.cssText = 'display:block!important;visibility:visible!important;position:fixed;inset:0;width:100%;height:100%;border:0;z-index:0;pointer-events:none;background:transparent;';
    document.body.insertBefore(f, document.body.firstChild);
    function load() {
      fetch(BASE + '/api/state', { cache: 'no-store', mode: 'no-cors' })
        .then(function () {
          f.style.display = 'block';
          f.style.visibility = 'visible';
          if (!f.src || f.src === 'about:blank') f.src = BASE + '/?embed=1';
        })
        .catch(function () { setTimeout(load, 2000); });
    }
    f.addEventListener('error', function () { setTimeout(load, 2000); });
    load();
  }

  // ── 诊断上报 ───────────────────────────────────────────────
  function diag() {
    try {
      var f = document.getElementById('we-wp-layer');
      var info = {
        href: String(location.href).slice(0, 120),
        title: document.title,
        iframe: !!f,
        iframeDisplay: f ? getComputedStyle(f).display : null,
        iframeRect: f ? (function (r) { return Math.round(r.width) + 'x' + Math.round(r.height); })(f.getBoundingClientRect()) : null,
        bigSurfaces: [],
        slots: [],
      };
      // 大面积表面(≥30% 视口,含 fixed 遮罩)
      var els = document.body ? document.body.querySelectorAll('*') : [];
      for (var i = 0, n = 0; i < els.length && n < 20; i++) {
        var el = els[i];
        var r = el.getBoundingClientRect();
        if (r.width < innerWidth * 0.3 || r.height < innerHeight * 0.3) continue;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        var bg = cs.backgroundColor;
        var bf = cs.backdropFilter || cs.webkitBackdropFilter;
        if ((!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && (!bf || bf === 'none')) continue;
        info.bigSurfaces.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          cls: String(el.className).slice(0, 110) || undefined,
          bg: bg,
          blur: bf && bf !== 'none' ? bf : undefined,
        });
        n++;
      }
      // data-slot 普查(shadcn 风格组件名):高频 slot 附带一份样本类名
      var slotCount = {}, slotSample = {};
      for (var j = 0; j < els.length; j++) {
        var s = els[j].getAttribute && els[j].getAttribute('data-slot');
        if (!s) continue;
        slotCount[s] = (slotCount[s] || 0) + 1;
        if (!slotSample[s]) slotSample[s] = String(els[j].className).slice(0, 150);
      }
      var keys = Object.keys(slotCount).sort(function (a, b) { return slotCount[b] - slotCount[a]; }).slice(0, 40);
      for (var k = 0; k < keys.length; k++) info.slots.push({ slot: keys[k], n: slotCount[keys[k]], cls: slotSample[keys[k]] });
      fetch(BASE + '/api/diag', {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(info),
      }).catch(function () {});
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
  function onReady() {
    mount();
    refreshCss();
    setInterval(refreshCss, 5000);
    diag();
    setInterval(diag, 60000);
    // 壁纸面板/工作台入口:仅聊天窗口(file:// 宿主)加载;
    // 播放页自身(127.0.0.1:7396/?embed=1)不加载,否则壁纸 iframe 里会再长一个按钮
    if (location.origin !== BASE) {
      var s = document.createElement('script');
      s.src = BASE + '/panel.js?v=' + Date.now();
      document.head.appendChild(s);
      hookSettingsDialog();
    }
  }

  // ── 设置页注入:在左侧"基础设置"分组的"外观"项后面加 "Wallpaper" ─────────
  // ZCode 设置是独立整页(非弹窗),侧边栏项是普通按钮。策略:找文本恰为"外观"、
  // 位于屏幕左栏(x<380)的叶子节点 → 克隆其最近的可点击祖先 → 改文本 → 插到后面。
  var hookInjected = 0;
  function hookSettingsDialog() {
    if (document.getElementById('we-wp-settings-entry')) { hookInjected = 1; return; }
    if (document.body.textContent.indexOf('基础设置') < 0) return;   // 不在设置页
    var leaves = document.body.querySelectorAll('*');
    for (var i = 0; i < leaves.length; i++) {
      var el = leaves[i];
      if (el.children.length !== 0 || el.id === 'we-wp-settings-entry') continue;
      var txt = (el.textContent || '').trim();
      // 兼容带图标前缀的条目(如 "🎨 外观"),也兼容纯文本 "外观"
      if (!(txt === '外观' || (txt.indexOf('外观') >= 0 && txt.length <= 8))) continue;
      var r = el.getBoundingClientRect();
      if (r.x < 0 || r.x > 380 || r.width > 340) continue;           // 必须在左栏
      var host0 = el.closest('button') || el.closest('[role="button"]') || el.closest('a') || el;
      if (!host0 || host0.id === 'we-wp-settings-entry') continue;
      var item = host0.cloneNode(true);
      item.id = 'we-wp-settings-entry';
      // 改克隆体里的文本节点
      var tnode = item.querySelector('*');
      var set = false;
      var walk = item.querySelectorAll('*');
      for (var k = 0; k < walk.length; k++) {
        var wtxt = (walk[k].textContent || '').trim();
        if (walk[k].children.length === 0 && wtxt.indexOf('外观') >= 0 && wtxt.length <= 8) {
          walk[k].textContent = 'Wallpaper'; set = true; break;
        }
      }
      if (!set) item.textContent = 'Wallpaper';
      item.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        if (window.__weWpOpenWorkbench) window.__weWpOpenWorkbench();
      });
      if (host0.nextSibling) host0.parentNode.insertBefore(item, host0.nextSibling);
      else host0.parentNode.appendChild(item);
      hookInjected = 1;
      try {
        fetch(BASE + '/api/diag', { method: 'POST', mode: 'cors', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hook: 'settings-entry-injected', after: '外观(基础设置)' }) }).catch(function () {});
      } catch (e2) {}
      return;
    }
  }
  // 设置页是 SPA 路由:进设置时 DOM 才出现,靠观察器触发;500ms 节流
  var hookScanPending = 0;
  new MutationObserver(function () {
    if (hookScanPending) return;
    hookScanPending = setTimeout(function () { hookScanPending = 0; hookSettingsDialog(); }, 500);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
