/* earth.js: Earth control view. Shows SOS alerts sent by the Mars base page through JdaLink.
   All text is written with textContent (messages are untrusted). */
(function () {
  'use strict';
  var alerts = Object.create(null);   // sos id -> {id, from, fromId, lat, lon, t, ackAt}
  var order = [];
  var list = document.getElementById('alerts'), empty = document.getElementById('empty'),
      banner = document.getElementById('banner');
  if (window.JdaLinkUI) window.JdaLinkUI.mount({ role: 'earth', ask: ['code'] });

  function sender(m) {   // v2 puts {role,id,name} in m.from; older senders used a plain string
    var f = m.from;
    return name(txt(m.name) || txt(m.fromName) || (typeof f === 'string' ? f : f && (txt(f.name) || txt(f.id))));
  }
  function senderId(m) { var f = m.from; return f && typeof f === 'object' && f.id && f.role !== 'control' && f.role !== 'earth' && f.role !== 'legacy' && f.id !== 'legacy' ? String(f.id).slice(0, 40) : ''; }
  function txt(v) { return typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : ''; }   // never "[object Object]"
  function name(s) { return txt(s).replace(/\s+/g, ' ').trim().slice(0, 24) || 'Crew member'; }
  function num(v) { if (typeof v !== 'number' && typeof v !== 'string') return null; if (v === '') return null; v = Number(v); return isFinite(v) ? v : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  /* ---------- tabs: Alerts + one "Next action" tab per acknowledged alert (ARIA tabs pattern) ---------- */
  var tabs = {}, tabOrder = [], activeTab = 'alerts', tabbar = document.getElementById('tabbar'), panels = document.getElementById('panels');
  var CLOSED_KEY = 'jda.earth.closedTabs.';
  function room() { try { return window.JdaLink.room ? window.JdaLink.room.code : ''; } catch (e) { return ''; } }
  function closedSet() { try { return JSON.parse(localStorage.getItem(CLOSED_KEY + room()) || '[]'); } catch (e) { return []; } }
  function setClosed(list) { try { localStorage.setItem(CLOSED_KEY + room(), JSON.stringify(list.slice(-50))); } catch (e) { /* storage blocked */ } }

  function tabButtons() { return [].slice.call(tabbar.querySelectorAll('[role="tab"]')); }
  function selectTab(id, focus) {
    activeTab = tabs[id] || id === 'alerts' ? id : 'alerts';
    tabButtons().forEach(function (b) {
      var on = b.getAttribute('data-id') === activeTab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    document.getElementById('panel-alerts').hidden = activeTab !== 'alerts';
    tabOrder.forEach(function (k) { tabs[k].panel.hidden = k !== activeTab; });
    if (activeTab !== 'alerts') updateTab(tabs[activeTab]);
    if (focus) { var b = document.getElementById(activeTab === 'alerts' ? 'tab-alerts' : tabs[activeTab].btn.id); if (b) b.focus(); }
  }
  document.getElementById('tab-alerts').setAttribute('data-id', 'alerts');
  tabbar.addEventListener('keydown', function (e) {
    var t = e.target; if (!t || t.getAttribute('role') !== 'tab') return;
    var bs = tabButtons(), i = bs.indexOf(t), n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % bs.length; else if (e.key === 'ArrowLeft') n = (i - 1 + bs.length) % bs.length;
    else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = bs.length - 1;
    else if (e.key === 'Delete' && t.getAttribute('data-id') !== 'alerts') { e.preventDefault(); closeTab(t.getAttribute('data-id')); return; }
    else return;
    e.preventDefault(); selectTab(bs[n].getAttribute('data-id'), true);
  });
  tabbar.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[role="tab"]') : null;
    if (t) selectTab(t.getAttribute('data-id'), false);
  });

  function openAdviceTab(id, focus) {
    var a = alerts[id]; if (!a || !window.JdaAdvice) return;
    var closed = closedSet();
    if (!tabs[id]) {
      if (!focus && closed.indexOf(id) >= 0) return;          // closed by the operator earlier
      tabs[id] = buildTab(a); tabOrder.push(id);
    }
    if (focus && closed.indexOf(id) >= 0) setClosed(closed.filter(function (x) { return x !== id; }));
    if (focus) { selectTab(id, true); var h = tabs[id].panel.querySelector('h2'); if (h) { /* focus stays on the tab, the panel is next in tab order */ } }
    else if (activeTab !== id) selectTab(activeTab, false);
  }
  function closeTab(id) {
    var t = tabs[id]; if (!t) return;
    var idx = tabOrder.indexOf(id), wasActive = activeTab === id;
    t.wrap.parentNode.removeChild(t.wrap); t.panel.parentNode.removeChild(t.panel);
    delete tabs[id]; tabOrder.splice(idx, 1);
    var c = closedSet(); if (c.indexOf(id) < 0) c.push(id); setClosed(c);
    if (wasActive) { var next = tabOrder[Math.min(idx, tabOrder.length - 1)] || 'alerts'; selectTab(next, true); }
  }
  function resetTabs() { tabOrder.slice().forEach(function (k) { var t = tabs[k]; t.wrap.parentNode.removeChild(t.wrap); t.panel.parentNode.removeChild(t.panel); }); tabs = {}; tabOrder = []; selectTab('alerts', false); }

  function buildTab(a) {
    var t = { id: a.id, alert: a, sig: '', rows: {}, sent: {}, edited: {}, confirming: null, lastResult: null };
    var wrap = el('div', 'tabwrap'); wrap.setAttribute('data-tab', a.id);
    var btn = el('button', 'tab', 'Next action: ' + a.from); btn.type = 'button'; btn.id = 'tab-n-' + a.id.replace(/[^A-Za-z0-9_-]/g, '_');
    btn.setAttribute('role', 'tab'); btn.setAttribute('data-id', a.id); btn.setAttribute('aria-selected', 'false'); btn.tabIndex = -1;
    var pid = 'panel-n-' + btn.id.slice(6); btn.setAttribute('aria-controls', pid);
    var x = el('button', 'tabx', 'x'); x.type = 'button'; x.setAttribute('aria-label', 'Close tab Next action: ' + a.from); x.title = 'Close tab';
    x.addEventListener('click', function () { closeTab(a.id); });
    wrap.appendChild(btn); wrap.appendChild(x); tabbar.appendChild(wrap);

    var p = el('div', 'npanel'); p.id = pid; p.setAttribute('role', 'tabpanel'); p.setAttribute('aria-labelledby', btn.id); p.hidden = true; p.tabIndex = -1;
    var head = el('div', 'nhead');
    head.appendChild(el('h2', 'nh', 'Next action for ' + a.from));
    head.appendChild(el('p', 'nsub', 'Suggested by the system, the operator decides.'));
    var sev = el('p', 'nsev'); var dt = el('p', 'ndata'); var stale = el('p', 'nstale'); stale.hidden = true;
    head.appendChild(sev); head.appendChild(dt); head.appendChild(stale); p.appendChild(head);
    p.appendChild(el('h3', 'sec', 'Suggested actions, most urgent first'));
    var ol = el('ol', 'nactions'); p.appendChild(ol);
    p.appendChild(el('h3', 'sec', 'Facts used'));
    var dl = el('dl', 'nfacts'); p.appendChild(dl);
    var tools = el('div', 'ntools');
    var cp = el('button', 'btn', 'Copy plan'); cp.type = 'button';
    var cps = el('span', 'nstat'); cps.setAttribute('role', 'status');
    cp.addEventListener('click', function () { copyText(planText(t), function (ok) { cps.textContent = ok ? 'Plan copied.' : 'Could not copy. Select the text and copy it by hand.'; }); });
    tools.appendChild(cp); tools.appendChild(cps); p.appendChild(tools);
    var live = el('p', 'nstat nlive'); live.setAttribute('role', 'status'); p.appendChild(live);
    panels.appendChild(p);
    t.wrap = wrap; t.btn = btn; t.panel = p; t.sev = sev; t.dt = dt; t.stale = stale; t.ol = ol; t.dl = dl; t.live = live;
    updateTab(t);
    return t;
  }

  function copyText(text, done) {
    function fallback() {
      var ta = el('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta); ta.select(); var ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback); else fallback();
  }
  function planText(t) {
    var r = t.lastResult; if (!r) return '';
    var out = ['Next action for ' + t.alert.from + ' (suggested by the system, the operator decides)', r.summary, r.updatedAt ? 'Data time: ' + r.updatedAt : 'No live crew data', ''];
    r.actions.forEach(function (a, i) { out.push((i + 1) + '. ' + a.title, '   ' + a.detail, '   Why: ' + a.reason); });
    out.push('', 'Facts used:'); r.facts.forEach(function (f) { out.push('- ' + f.label + ': ' + f.value); });
    return out.join('\n');
  }

  var worldSeenAt = 0;   // local arrival time of the last world update (the sender's clock may differ from this device)
  try { window.JdaLink.onState('world', function () { worldSeenAt = Date.now(); }); } catch (e) { /* no link */ }
  function worldNow() {
    try { var w = window.JdaLink.getState && window.JdaLink.getState('world'); return w && w.value && typeof w.value === 'object' ? w : null; } catch (e) { return null; }
  }
  function crewFor(a, world) {
    if (!world || !world.crew) return null;
    if (a.fromId && world.crew[a.fromId]) return world.crew[a.fromId];
    var nm = a.from.toLowerCase(), found = null;
    Object.keys(world.crew).forEach(function (k) { var r = world.crew[k]; if (r && !found && (String(r.name || '').toLowerCase() === nm || String(r.id || k).toLowerCase() === nm)) found = r; });
    return found;
  }
  function crewTargetId(t) {
    var a = t.alert; if (a.fromId) return a.fromId;
    var w = worldNow(), c = w && crewFor(a, w.value); return c && c.id ? String(c.id).slice(0, 40) : '';
  }
  function adviceFor(t) {
    var w = worldNow(), world = w ? w.value : null;
    var lim = (window.JEZERO_SCIENCE && window.JEZERO_SCIENCE.radiation && window.JEZERO_SCIENCE.radiation.limits) || null;
    var res = window.JdaAdvice.suggest({ sos: { id: t.alert.id, from: t.alert.from, fromName: t.alert.from, lat: t.alert.lat, lon: t.alert.lon, t: t.alert.t },
      crew: crewFor(t.alert, world), world: world, mission: window.JEZERO_MISSION || null, limits: lim, speeds: window.JEZERO_SPEEDS || null });
    return { res: res, meta: w };
  }

  function updateTab(t) {
    if (!t || !window.JdaAdvice) return;
    var o = adviceFor(t), r = o.res, ageS = o.meta ? (Date.now() - Math.max(worldSeenAt, o.meta.from && o.meta.from.cid === window.JdaLink.clientId && typeof o.meta.t === 'number' ? o.meta.t : 0) || (typeof o.meta.t === 'number' ? o.meta.t : Date.parse(o.meta.t))) / 1000 : null;
    var stale = ageS !== null && isFinite(ageS) && ageS > 15;
    var sig = JSON.stringify(r) + '|' + stale + '|' + crewTargetId(t);
    if (sig === t.sig) return;
    t.sig = sig; t.lastResult = r;
    setText(t.sev, r.summary); t.sev.className = 'nsev sev-' + r.severity;
    t.sev.setAttribute('data-sev', r.severity);
    setText(t.dt, r.updatedAt ? 'Crew data from mission time ' + String(r.updatedAt).replace('T', ' ').replace(/:\d\d(\.\d+)?Z$/, ' UTC') : 'No live crew data. The advice uses only the SOS message.');
    t.stale.hidden = !stale; setText(t.stale, stale ? 'Crew data has not updated for ' + Math.round(ageS) + ' s. The advice shows the last known values.' : '');
    reconcileActions(t, r.actions);
    reconcileFacts(t, r.facts);
  }
  function setText(node, s) { if (node.textContent !== s) node.textContent = s; }

  function reconcileActions(t, actions) {
    var seen = {}, target = crewTargetId(t);
    actions.forEach(function (a, i) {
      seen[a.id] = 1;
      var row = t.rows[a.id];
      if (!row) { row = t.rows[a.id] = buildRow(t, a); }
      setText(row.title, (i + 1) + '. ' + a.title); setText(row.detail, a.detail); setText(row.why, 'Why: ' + a.reason);
      row.li.setAttribute('data-sev', a.priority <= 3 ? 'urgent' : 'normal');
      row.a = a; row.sendOk = !!a.canSend && !!target;
      if (row.ta && !t.edited[a.id] && row.ta.value !== a.message) row.ta.value = a.message;
      if (row.send) row.send.hidden = !row.sendOk || t.confirming === a.id;
      if (row.nosend) row.nosend.hidden = !(a.canSend && !target);
      if (t.ol.children[i] !== row.li) t.ol.insertBefore(row.li, t.ol.children[i] || null);
    });
    Object.keys(t.rows).forEach(function (k) {
      if (seen[k]) return;
      var row = t.rows[k];
      if (t.confirming === k) t.confirming = null;
      if (row.li.parentNode) row.li.parentNode.removeChild(row.li);   // a removed action disappears; if it was sent, the Sent note stays in the status line
      delete t.rows[k];
    });
  }
  function buildRow(t, a) {
    var li = el('li', 'nact'); li.setAttribute('data-id', a.id);
    var row = { li: li, a: a };
    row.title = el('h4', 'nt'); row.detail = el('p', 'nd'); row.why = el('p', 'nw');
    li.appendChild(row.title); li.appendChild(row.detail); li.appendChild(row.why);
    if (a.canSend) {
      var lab = el('label', 'nlab', 'Message to crew (you can edit it before sending)'); var tid = 'msg-' + t.btn.id + '-' + a.id; lab.setAttribute('for', tid);
      var ta = el('textarea', 'nmsg'); ta.id = tid; ta.rows = 3; ta.maxLength = 500;
      ta.addEventListener('input', function () { t.edited[a.id] = true; if (t.confirming === a.id) cancelConfirm(t, row); });
      row.ta = ta;
      var bar = el('div', 'nbar');
      row.send = el('button', 'btn', 'Send to crew'); row.send.type = 'button';
      row.send.addEventListener('click', function () {
        if (!ta.value.trim()) { setText(t.live, 'Write a message first.'); return; }
        t.confirming = a.id; row.send.hidden = true; row.confirm.hidden = false; row.yes.focus();
      });
      row.confirm = el('div', 'nconfirm'); row.confirm.hidden = true; row.confirm.setAttribute('role', 'group'); row.confirm.setAttribute('aria-label', 'Confirm sending');
      row.confirm.appendChild(el('span', 'nq', 'Send this message to ' + t.alert.from + ' now?'));
      row.yes = el('button', 'btn go', 'Yes, send'); row.yes.type = 'button';
      row.no = el('button', 'btn', 'Cancel'); row.no.type = 'button';
      row.yes.addEventListener('click', function () { doSend(t, a.id, row); });
      row.no.addEventListener('click', function () { cancelConfirm(t, row); row.send.focus(); });
      row.confirm.addEventListener('keydown', function (e) { if (e.key === 'Escape') { cancelConfirm(t, row); row.send.focus(); } });
      row.confirm.appendChild(row.yes); row.confirm.appendChild(row.no);
      row.sentNote = el('p', 'nsent'); row.sentNote.hidden = true;
      row.nosend = el('p', 'nw', 'This alert has no crew id, so the message cannot be sent from here. Use voice.'); row.nosend.hidden = true;
      bar.appendChild(row.send); bar.appendChild(row.confirm);
      li.appendChild(lab); li.appendChild(ta); li.appendChild(bar); li.appendChild(row.sentNote); li.appendChild(row.nosend);
      if (t.sent[a.id]) showSent(t, row);
    }
    return row;
  }
  function cancelConfirm(t, row) { t.confirming = null; row.confirm.hidden = true; row.send.hidden = !row.sendOk; }
  function showSent(t, row) { var s = t.sent[row.a.id]; row.sentNote.hidden = false; row.sentNote.textContent = 'Sent to ' + t.alert.from + ' at ' + when(s.at) + ': ' + s.text; }
  function doSend(t, id, row) {
    var to = crewTargetId(t), text = row.ta.value.replace(/\s+/g, ' ').trim().slice(0, 500);
    t.confirming = null; row.confirm.hidden = true;
    var sent = null;
    if (to && text && window.JdaLink && window.JdaLink.room) { try { sent = window.JdaLink.send({ type: 'chat', to: to, text: text, fromName: 'Earth control' }); } catch (e) { sent = null; } }
    if (!sent) { row.send.hidden = false; setText(t.live, 'Could not send. Check the connection status and try again.'); row.send.focus(); return; }
    t.sent[id] = { text: text, at: sent.t || new Date().toISOString() };
    row.send.textContent = 'Send again'; row.send.hidden = !row.sendOk; showSent(t, row);
    setText(t.live, 'Message sent to ' + t.alert.from + '.');
    row.send.focus();
  }
  function reconcileFacts(t, facts) {
    var sig = JSON.stringify(facts); if (t.factSig === sig) return; t.factSig = sig;
    t.dl.textContent = '';
    facts.forEach(function (f) { var d = el('div', 'nfact'); d.appendChild(el('dt', '', f.label)); d.appendChild(el('dd', '', f.value)); t.dl.appendChild(d); });
    if (!facts.length) t.dl.appendChild(el('dd', 'empty', 'No data available.'));
  }
  setInterval(function () { if (!document.hidden && activeTab !== 'alerts' && tabs[activeTab]) updateTab(tabs[activeTab]); }, 1000);

  function render() {
    empty.hidden = order.length > 0;
    list.textContent = '';
    order.slice().reverse().forEach(function (id) {
      var a = alerts[id], li = el('li', 'alert' + (a.ackAt ? ' acked' : ''));
      var h = el('h3'); h.appendChild(el('span', 'status', a.ackAt ? '■ ACKNOWLEDGED' : '▲ ACTIVE'));
      h.appendChild(document.createTextNode(a.from + ' pressed SOS'));
      li.appendChild(h);
      li.appendChild(el('div', 'meta', 'received ' + when(a.t) + (a.lat !== null && a.lon !== null ? ' · position ' + a.lat.toFixed(4) + '°N, ' + a.lon.toFixed(4) + '°E' : '')));
      if (!a.ackAt) {
        var b = el('button', '', 'Acknowledge'); b.type = 'button';
        b.addEventListener('click', function () {
          if (a.ackAt) return;   // already acknowledged (double click, or acknowledged from another Earth page meanwhile)
          a.ackAt = new Date().toISOString(); window.JdaLink.send({ type: 'ack', sosId: id, by: 'Earth control' });
          render(); openAdviceTab(id, true);
        });
        li.appendChild(b);
      } else if (window.JdaAdvice) {
        var lk = el('button', 'tablink', 'Open next action: ' + a.from); lk.type = 'button';
        lk.addEventListener('click', function () { openAdviceTab(id, true); });
        li.appendChild(lk);
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
    reports[key] = { key: key, from: name(txt(f.name) || txt(m.fromName) || (typeof m.from === 'string' ? m.from : '') || txt(f.id)),
      t: txt(m.at) || txt(m.t), subject: txt(m.subject).replace(/\s+/g, ' ').trim().slice(0, 120) || '(no subject)',
      body: txt(m.body).replace(/\r\n?/g, '\n').slice(0, 4000), misses: num(m.misses), seen: false };
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
      if (alerts[m.id] || typeof m.id !== 'string') return;
      alerts[m.id] = { id: m.id, from: sender(m), fromId: senderId(m), lat: num(m.lat), lon: num(m.lon), t: m.t, ackAt: null };
      order.push(m.id);
    } else if (m.type === 'report') { addReport(m); return;
    } else if (m.type === 'ack' && alerts[m.sosId]) {
      alerts[m.sosId].ackAt = m.t;
      render(); openAdviceTab(m.sosId, false); return;   // acknowledged earlier or on another Earth page: restore the tab, keep focus where it is
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
    alerts = {}; order = []; resetTabs(); loadHistory(); render();
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
