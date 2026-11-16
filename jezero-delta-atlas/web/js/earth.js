/* earth.js: Earth control view. Shows SOS alerts sent by the Mars base page through JdaLink.
   All text is written with textContent (messages are untrusted). Everything here is simulated. */
(function () {
  'use strict';
  var alerts = {};   // sos id -> {id, from, lat, lon, t, ackAt}
  var order = [];
  var list = document.getElementById('alerts'), empty = document.getElementById('empty'),
      banner = document.getElementById('banner');
  if (window.JdaLinkUI) window.JdaLinkUI.mount({ role: 'earth', ask: ['code'] });

  function sender(m) {   // v2 puts {role,id,name} in m.from; older senders used a plain string
    var f = m.from;
    return name(m.name || m.fromName || (typeof f === 'string' ? f : f && (f.name || f.id)));
  }
  function name(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 24) || 'Crew member'; }
  function num(v) { v = Number(v); return isFinite(v) ? v : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  function render() {
    empty.hidden = order.length > 0;
    list.textContent = '';
    order.slice().reverse().forEach(function (id) {
      var a = alerts[id], li = el('li', 'alert' + (a.ackAt ? ' acked' : ''));
      var h = el('h3'); h.appendChild(el('span', 'status', a.ackAt ? '■ ACKNOWLEDGED' : '▲ ACTIVE'));
      h.appendChild(document.createTextNode(a.from + ' pressed SOS'));
      li.appendChild(h);
      li.appendChild(el('div', 'meta', 'received ' + when(a.t) + (a.lat !== null ? ' · position ' + a.lat.toFixed(4) + '°N, ' + a.lon.toFixed(4) + '°E' : '')));
      if (!a.ackAt) {
        var b = el('button', '', 'Acknowledge'); b.type = 'button';
        b.addEventListener('click', function () { a.ackAt = new Date().toISOString(); window.JdaLink.send({ type: 'ack', sosId: id, by: 'Earth control' }); render(); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    var active = order.filter(function (id) { return !alerts[id].ackAt; });
    banner.hidden = !active.length;
    if (active.length) {
      var a = alerts[active[active.length - 1]];
      banner.textContent = '▲ ' + a.from + ' pressed SOS';
      banner.appendChild(el('small', '', active.length > 1 ? active.length + ' active alerts' : 'Alert from the Mars base'));
      document.title = '▲ SOS: ' + a.from + ' · Earth Mission Control';
    } else document.title = 'Earth Mission Control';
  }

  /* ---------- reports from the planner (type 'report'): plain text only ---------- */
  var reports = {}, rOrder = [], rUnread = 0, rList = document.getElementById('reports'), rEmpty = document.getElementById('reports-empty'),
      rBadge = document.getElementById('reports-badge'), loading = true;
  function addReport(m) {
    if (m.to && m.to !== 'earth') return;
    var key = typeof m.reportId === 'string' && m.reportId ? m.reportId.slice(0, 60) : m.id;
    if (!key || reports[key]) return;
    var f = m.from && typeof m.from === 'object' ? m.from : {};
    reports[key] = { key: key, from: name(m.from && f.name || m.fromName || (typeof m.from === 'string' ? m.from : '') || f.id),
      t: m.at || m.t, subject: String(m.subject == null ? '' : m.subject).replace(/\s+/g, ' ').trim().slice(0, 120) || '(no subject)',
      body: String(m.body == null ? '' : m.body).replace(/\r\n?/g, '\n').slice(0, 4000), misses: num(m.misses), seen: false };
    rOrder.push(key);
    if (!loading) { rUnread++; renderReports(); }
  }
  function renderReports() {
    rEmpty.hidden = rOrder.length > 0;
    rList.textContent = '';
    rOrder.slice().sort(function (a, b) { return String(reports[b].t).localeCompare(String(reports[a].t)); }).forEach(function (k) {
      var r = reports[k], d = el('details', 'report' + (r.seen ? '' : ' fresh'));
      var s = el('summary'); s.appendChild(el('span', 'rsub', r.subject));
      s.appendChild(el('span', 'rmeta', r.from + ' · ' + when(r.t) + (r.misses ? ' · ' + r.misses + ' missed' : '')));
      d.appendChild(s); d.appendChild(el('pre', 'rbody', r.body || '(empty report)'));
      d.open = !!r.open;
      d.addEventListener('toggle', function () { r.open = d.open; if (d.open && !r.seen) { r.seen = true; d.classList.remove('fresh'); rUnread = Math.max(0, rUnread - 1); badge(); } });
      rList.appendChild(d);
    });
    badge();
  }
  function badge() { rBadge.hidden = !rUnread; rBadge.textContent = rUnread > 9 ? '9+' : String(rUnread); }

  function handle(m) {
    if (m.type === 'sos') {
      if (alerts[m.id]) return;
      alerts[m.id] = { id: m.id, from: sender(m), lat: num(m.lat), lon: num(m.lon), t: m.t, ackAt: null };
      order.push(m.id);
    } else if (m.type === 'report') { addReport(m); return;
    } else if (m.type === 'ack' && alerts[m.sosId]) {
      alerts[m.sosId].ackAt = m.t;
    } else return;
    render();
  }

  var loadedFor = null;
  function roomKey() { var r = window.JdaLink.room; return r ? r.code : null; }
  function loadHistory() {
    loadedFor = roomKey();
    if (!loadedFor) return;
    loading = true; reports = {}; rOrder = []; rUnread = 0;
    (window.JdaLink.history(200) || []).forEach(handle);   // alerts and reports sent before this page was opened
    loading = false; rUnread = rOrder.length; renderReports();
  }
  window.JdaLink.on(handle);
  loadHistory();
  setInterval(function () {   // room joined or changed after load: drop alerts of the old room, read the new one's history
    if (roomKey() === loadedFor) return;
    alerts = {}; order = []; loadHistory(); render();
  }, 1000);
  render();

  // chat with the crew (JdaChat, person to person; no automatic replies)
  var chatBox = document.getElementById('chat');
  function crewPeers() {
    var out = [];
    function add(id, nm) { id = String(id || ''); if (id && id !== 'earth' && id !== 'legacy' && !out.some(function (q) { return q.id === id; })) out.push({ id: id, name: nm || id }); }
    try { if (!window.JdaLink.room) return out;
      var w = window.JdaLink.getState && window.JdaLink.getState('world');   // crew known from the shared world, even when offline
      if (w && w.value && w.value.crew) Object.keys(w.value.crew).forEach(function (k) { var r = w.value.crew[k]; if (r) add(r.id || k, r.name); });
      (window.JdaLink.history(200) || []).forEach(function (m) {            // anyone seen in the room's history
        var f = m && m.from; if (f && typeof f === 'object' && f.role !== 'earth' && f.role !== 'control' && f.role !== 'legacy') add(f.id, f.name);
      });
      (window.JdaLink.presence() || []).forEach(function (p) {
      if (p && p.id && p.role !== 'earth' && p.role !== 'control' && p.role !== 'legacy' && !out.some(function (q) { return q.id === p.id; })) out.push({ id: p.id, name: p.name || p.id });
    }); } catch (e) { /* no presence yet */ }
    return out;
  }
  if (window.JdaChat && chatBox) {
    var chat = window.JdaChat.mount(chatBox, { link: window.JdaLink, meId: 'earth', meName: 'Earth control', peers: crewPeers, allowEarth: false });
    var chatBadge = document.getElementById('chat-badge'), base = document.title;
    chat.onUnread(function (total) {
      chatBadge.hidden = !total; chatBadge.textContent = total > 9 ? '9+' : String(total);
      if (!total && !/SOS/.test(document.title)) document.title = 'Earth Mission Control';
    });
  }
})();
