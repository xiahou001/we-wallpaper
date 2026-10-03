/* ZCode startup bootstrap: load embed.js only after the wallpaper server is reachable. */
(function () {
  'use strict';
  if (window.__weWpBootstrapV2) return;
  window.__weWpBootstrapV2 = true;
  var BASE = 'http://127.0.0.1:7396';
  var retryTimer = 0;
  var loading = false;
  function retry() {
    if (loading) return;
    loading = true;
    fetch(BASE + '/api/state?bootstrap=' + Date.now(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('wallpaper server ' + r.status);
        var script = document.createElement('script');
        script.src = BASE + '/embed.js?bootstrap=' + Date.now();
        script.async = false;
        script.onload = function () { loading = false; };
        script.onerror = function () {
          loading = false;
          clearTimeout(retryTimer);
          retryTimer = setTimeout(retry, 2000);
        };
        (document.head || document.documentElement).appendChild(script);
      })
      .catch(function () {
        loading = false;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(retry, 2000);
      });
  }
  retry();
})();
