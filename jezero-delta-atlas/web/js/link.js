/* link.js: message link between the Mars base page and the Earth control page. Exposes window.JdaLink.
   Mode "same-browser": BroadcastChannel + localStorage, works between tabs of one browser.
   Mode "online": the same messages are also POSTed to / polled from a Supabase table (see docs/LINK.md).
   Messages are plain JSON, {id, t, type, ...}. Everything received is treated as untrusted data. */
(function () {
  'use strict';
  var KEY = 'jda.link.msg', LOG = 'jda.link.log', POLL_MS = 3000;
  var cfg = window.JDA_LINK || {};
  var online = !!(cfg.url && cfg.key);
  var subs = [], seen = {}, bc = null;

  function deliver(m) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.type !== 'string' || seen[m.id]) return;
    seen[m.id] = 1;
    subs.slice().forEach(function (fn) { try { fn(m); } catch (e) { if (window.console) console.error('JdaLink handler failed', e); } });
  }
  function readLog() {
    try { var a = JSON.parse(localStorage.getItem(LOG) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function appendLog(m) {
    try { var a = readLog(); a.push(m); localStorage.setItem(LOG, JSON.stringify(a.slice(-100))); } catch (e) { /* ignore */ }
  }

  try { if (window.BroadcastChannel) { bc = new BroadcastChannel('jda-link'); bc.onmessage = function (e) { deliver(e.data); }; } } catch (e) { bc = null; }
  window.addEventListener('storage', function (e) {
    if (e.key !== KEY || !e.newValue) return;
    try { deliver(JSON.parse(e.newValue)); } catch (err) { /* ignore corrupt */ }
  });

  function remoteUrl(q) { return cfg.url.replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(cfg.table || 'link_messages') + (q || ''); }
  function remoteHeaders() { return { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }; }
  function poll() {
    fetch(remoteUrl('?select=payload&order=created_at.desc&limit=30'), { headers: remoteHeaders() })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (rows) { rows.reverse().forEach(function (row) { appendLog(row.payload); deliver(row.payload); }); })
      .catch(function (e) { if (window.console) console.warn('JdaLink online poll failed', e); });
  }
  if (online) { poll(); setInterval(poll, POLL_MS); }

  window.JdaLink = {
    mode: online ? 'online' : 'same-browser',
    on: function (fn) { subs.push(fn); },
    history: readLog,
    send: function (msg) {
      var m = Object.assign({}, msg, { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), t: new Date().toISOString() });
      seen[m.id] = 1;
      appendLog(m);
      try { if (bc) bc.postMessage(m); } catch (e) { /* ignore */ }
      try { localStorage.setItem(KEY, JSON.stringify(m)); } catch (e) { /* ignore */ }
      if (online) fetch(remoteUrl(), { method: 'POST', headers: remoteHeaders(), body: JSON.stringify({ id: m.id, payload: m }) })
        .catch(function (e) { if (window.console) console.warn('JdaLink online send failed', e); });
      return m;
    }
  };
})();
