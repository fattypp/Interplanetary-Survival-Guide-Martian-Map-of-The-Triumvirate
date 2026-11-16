/* link.js: JdaLink v2, message / state / presence link between pages, isolated by ROOM CODE. Exposes window.JdaLink.
   Transports (see docs/LINK.md): relay (same-origin /api, server/relay.py, works across devices on one network),
   online (Supabase, only if web/data/link-config.js is filled in), local (BroadcastChannel + localStorage, same browser).
   Everything received is untrusted data and is validated. Messages never cross rooms. */
(function () {
  'use strict';
  var CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/, LEGACY = 'LOCAL', ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var MAX_MSG = 4096, MAX_STATE = 65536, HEARTBEAT = 5000, ONLINE_MS = 15000, POLL_MS = 900, LOG_N = 200, OUTBOX_N = 100;
  var ROLES = ['crew', 'earth', 'control', 'helmet', 'tablet', 'legacy'];
  var cfg = window.JDA_LINK || {};
  var cid = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);   // this page load
  var subs = [], statusSubs = [], presSubs = [], stateSubs = Object.create(null);
  var room = null, status = 'local', S = null, implicit = false, pendingOut = { msgs: [], state: {} };   // pendingOut: what an implicit (LOCAL) room sent, replayed into the first explicit room   // S = per-join session (timers, seen, log, state, presence)

  /* ---------- helpers ---------- */
  function slug(s, n) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n || 24); }
  function cleanName(s) { return String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24); }
  function normCode(c) { return String(c == null ? '' : c).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
  function validCode(c) { return CODE_RE.test(c) || c === LEGACY; }
  function newCode() {
    var out = '', a = new Uint8Array(5);
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 5; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < 5; j++) out += ALPHA.charAt(a[j] % ALPHA.length);
    return out;
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 5); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function size(o) {   // JSON size in UTF-8 bytes, the same measure the relay uses (emoji / CJK count by bytes, not UTF-16 units)
    var j; try { j = JSON.stringify(o); } catch (e) { return Infinity; }
    if (typeof j !== 'string') return Infinity;
    try { return unescape(encodeURIComponent(j)).length; } catch (e) { return j.length * 3; }
  }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }
  function safeKey(k) { return typeof k === 'string' && /^[A-Za-z0-9:_.-]{1,64}$/.test(k) && k !== '__proto__'; }
  function warn() { if (window.console) console.warn.apply(console, ['JdaLink'].concat([].slice.call(arguments))); }
  function call(fn, a, b) { try { fn(a, b); } catch (e) { if (window.console) console.error('JdaLink handler failed', e); } }

  function cleanFrom(f) {
    if (!isObj(f)) return null;
    var role = typeof f.role === 'string' && ROLES.indexOf(f.role) >= 0 ? f.role : '';
    if (!role) return null;
    return { role: role, id: slug(f.id, 32), name: cleanName(f.name), cid: typeof f.cid === 'string' ? f.cid.slice(0, 40) : '' };
  }
  /* validate an incoming message for the current room; returns a clean copy or null */
  function validMsg(m, code) {
    if (!isObj(m) || size(m) > MAX_MSG) return null;
    if (typeof m.id !== 'string' || !m.id || m.id.length > 64 || typeof m.type !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(m.type)) return null;
    if (m.room !== code) return null;
    var from = cleanFrom(m.from);
    if (!from) return null;
    var c = clone(m);
    c.from = from;
    delete c.seq; delete c.replay;
    if (typeof c.t !== 'string' || isNaN(Date.parse(c.t))) return null;
    if (c.type === 'chat') {
      if (typeof c.text !== 'string') return null;
      c.text = c.text.slice(0, 500);
    }
    return c;
  }
  function validEntry(e) {
    if (!isObj(e) || !('value' in e) || size(e.value) > MAX_STATE) return null;
    var from = cleanFrom(e.from) || { role: 'legacy', id: '', name: '', cid: '' };
    return { value: clone({ v: e.value }).v, t: isFinite(Number(e.t)) ? Number(e.t) : Date.now(), from: from, ver: isFinite(Number(e.ver)) ? Number(e.ver) : 0 };
  }

  /* ---------- session ---------- */
  function newSession(code) {
    var N = Object.create; return { code: code, seen: N(null), seenQ: [], log: [], state: N(null), mine: N(null), outbox: [], epoch: null, repub: false, relayVer: N(null), pres: N(null), timers: [], bc: null, listeners: [], relay: false, online: false, relayFails: 0, since: 0, stateVer: 0, closed: false, synced: false };
  }
  function markSeen(id) { S.seen[id] = 1; S.seenQ.push(id); if (S.seenQ.length > 3000) delete S.seen[S.seenQ.shift()]; }
  function setStatus(s) { if (s === status) return; status = s; statusSubs.slice().forEach(function (fn) { call(fn, s); }); }
  function pushLog(m) { S.log.push(m); if (S.log.length > LOG_N) S.log.shift(); }

  /* incoming message from any transport; `replay` marks backlog fetched at join */
  function deliver(raw, replay) {
    if (!S || S.closed) return;
    var m = validMsg(raw, S.code);
    if (!m || S.seen[m.id]) return;
    markSeen(m.id);
    pushLog(m);
    if (m.from.cid && m.from.cid === cid) return;   // never echo to the sender
    var out = m;
    if (replay) { out = clone(m); out.replay = true; }
    subs.slice().forEach(function (fn) { call(fn, out); });
  }
  function applyState(key, raw, viaRelay) {
    if (!S || S.closed || !safeKey(key)) return;
    var e = validEntry(raw);
    if (!e) return;
    var cur = S.state[key];
    if (viaRelay) { if (e.ver && e.ver <= (S.relayVer[key] || 0)) return; S.relayVer[key] = e.ver; }
    else if (cur && e.t <= cur.t) return;
    var changed = !cur || cur.t !== e.t || cur.from.cid !== e.from.cid;
    S.state[key] = e;
    if (changed && e.from.cid !== cid) fireState(key);
  }
  function fireState(key) {
    var e = S.state[key];
    (stateSubs[key] || []).slice().forEach(function (fn) { call(fn, clone({ v: e.value }).v, { t: e.t, from: e.from }); });
  }

  /* ---------- local transport (BroadcastChannel + localStorage, namespaced by room) ---------- */
  var P = 'jda.link.';
  function k(code, what) { return P + code + '.' + what; }
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); return true; } catch (e) { return false; } }
  function readLocalLog(code) {
    try { var a = JSON.parse(lsGet(k(code, 'log')) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; }
  }
  function startLocal() {
    var code = S.code, ses = S;
    readLocalLog(code).forEach(function (m) { var v = validMsg(m, code); if (v && !ses.seen[v.id]) { markSeen(v.id); pushLog(v); } });
    try {
      var pre = k(code, 'state.');
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(pre) === 0) { try { applyState(key.slice(pre.length), JSON.parse(localStorage.getItem(key)), false); } catch (e) { /* ignore */ } }
      }
    } catch (e) { /* ignore */ }
    try {
      if (window.BroadcastChannel) {
        ses.bc = new BroadcastChannel('jda-link:' + code);
        ses.bc.onmessage = function (ev) { if (ev.data && ev.data.k === 'msg') deliver(ev.data.m); else if (ev.data && ev.data.k === 'state') applyState(ev.data.key, ev.data.e, false); };
      }
    } catch (e) { ses.bc = null; }
    function onStorage(e) {
      if (!e.key || !e.newValue) return;
      try {
        if (e.key === k(code, 'msg')) deliver(JSON.parse(e.newValue));
        else if (e.key.indexOf(k(code, 'state.')) === 0) applyState(e.key.slice(k(code, 'state.').length), JSON.parse(e.newValue), false);
      } catch (err) { /* ignore corrupt */ }
    }
    window.addEventListener('storage', onStorage);
    ses.listeners.push(function () { window.removeEventListener('storage', onStorage); });
  }
  function localPresence() {
    var out = {}, pre = k(S.code, 'pres.'), now = Date.now();
    try {
      for (var i = localStorage.length - 1; i >= 0; i--) {
        var key = localStorage.key(i);
        if (!key || key.indexOf(pre) !== 0) continue;
        try {
          var p = JSON.parse(localStorage.getItem(key));
          if (!p || now - p.lastSeen > 60000) { localStorage.removeItem(key); continue; }
          var f = cleanFrom(p);
          if (f) out[key.slice(pre.length)] = { role: f.role, id: f.id, name: f.name, lastSeen: Math.min(Number(p.lastSeen) || 0, now) };
        } catch (e) { localStorage.removeItem(key); }
      }
    } catch (e) { /* ignore */ }
    return out;
  }

  /* ---------- relay transport ---------- */
  function api(path, opt) {
    opt = opt || {};
    var ctl = window.AbortController ? new AbortController() : null, tm = ctl ? setTimeout(function () { ctl.abort(); }, 4000) : 0;
    return fetch('/api' + path, { method: opt.method || 'GET', headers: opt.body ? { 'Content-Type': 'application/json' } : {}, body: opt.body ? JSON.stringify(opt.body) : undefined, cache: 'no-store', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { clearTimeout(tm); if (!r.ok) { var er = new Error('HTTP ' + r.status); er.status = r.status; throw er; } return r.json(); }, function (e) { clearTimeout(tm); throw e; });
  }
  function probeRelay() {
    if (!/^https?:$/.test(location.protocol)) return Promise.resolve(false);
    return api('/ping').then(function (j) { return !!(j && j.ok); }, function () { return false; });
  }
  function relayOk() { var ses = S; if (ses && ses.relayFails) { ses.relayFails = 0; setStatus('relay'); } }
  function relayFail(e) { var ses = S; if (!ses || (e && e.status === 429)) return; ses.relayFails++; if (ses.relayFails === 3) { warn('relay unreachable, using the same-browser link', e && e.message); setStatus('local'); } }
  /* messages wait in the outbox until the relay has accepted them (relay restarting, rate limit, brief outage) */
  function postOut(ses, item) {
    if (item.busy || ses.closed) return;
    item.busy = true;
    api('/rooms/' + ses.code + '/msg', { method: 'POST', body: item.m }).then(function () {
      var i = ses.outbox.indexOf(item); if (i >= 0) ses.outbox.splice(i, 1);
    }, function (e) {
      item.busy = false;
      if (e && (e.status === 400 || e.status === 403 || e.status === 404 || e.status === 411 || e.status === 413)) { var i = ses.outbox.indexOf(item); if (i >= 0) ses.outbox.splice(i, 1); warn('relay refused a message', e.message); }
      else relayFail(e);
    });
  }
  function queueOut(ses, m) {
    var item = { m: m, busy: false };
    ses.outbox.push(item);
    if (ses.outbox.length > OUTBOX_N) ses.outbox.shift();
    if (ses.relay) postOut(ses, item);
  }
  function flushOut(ses) { ses.outbox.slice().forEach(function (it) { postOut(ses, it); }); }
  function republishAll(ses) {   // a relay that restarted (or was not reachable before) has none of this page's messages or state: send them again (the relay and readers dedupe by id)
    ses.log.forEach(function (m) { if (m.from && m.from.cid === cid && !ses.outbox.some(function (it) { return it.m.id === m.id; })) queueOut(ses, m); });
    ses.repub = true;
  }
  function startRelay() {
    var ses = S, base = '/rooms/' + ses.code, delay = POLL_MS;
    ses.relay = true; setStatus('relay');
    republishAll(ses);
    function loop() {
      if (ses.closed) return;
      delay = POLL_MS;
      Promise.all([api(base + '/msgs?since=' + ses.since), api(base + '/state?since=' + ses.stateVer)]).then(function (r) {
        if (ses.closed) return;
        var first = !ses.synced, restarted = !!(r[0].epoch && ses.epoch && r[0].epoch !== ses.epoch);
        if (r[0].epoch) ses.epoch = r[0].epoch;
        if (restarted) { ses.relayVer = {}; ses.since = 0; ses.stateVer = 0; republishAll(ses); }
        if (r[0].reset) ses.since = 0;
        (r[0].msgs || []).forEach(function (m) { deliver(m, first); });
        if (isFinite(r[0].next) && !restarted) ses.since = r[0].next;
        if (r[1].reset || restarted) ses.relayVer = {};
        var items = r[1].items || {};
        Object.keys(items).forEach(function (key) { applyState(key, items[key], true); });
        if (isFinite(r[1].ver) && !restarted) ses.stateVer = r[1].ver;
        if (ses.repub && !restarted) {   // put back this page's own state values that the relay does not have
          ses.repub = false;
          Object.keys(ses.mine).forEach(function (key) {
            if (!(key in items) && !(ses.state[key] && ses.state[key].from.cid !== cid)) api(base + '/state/' + encodeURIComponent(key), { method: 'PUT', body: ses.mine[key] }).catch(function (x) { relayFail(x); });
          });
        }
        ses.synced = true;
        flushOut(ses);
        relayOk();
      }).catch(function (e) { if (e && e.status === 429) delay = 2500; relayFail(e); }).then(function () { if (!ses.closed) ses.timers.push(setTimeout(loop, delay)); });
    }
    loop();
  }

  /* ---------- online transport (Supabase, see docs/LINK.md) ---------- */
  var online = !!(cfg.url && cfg.key);
  function remoteUrl(q) { return String(cfg.url).replace(/\/+$/, '') + '/rest/v1/' + encodeURIComponent(cfg.table || 'link_messages') + (q || ''); }
  function remoteHeaders(extra) { var h = { apikey: cfg.key, Authorization: 'Bearer ' + cfg.key, 'Content-Type': 'application/json' }; for (var x in extra) h[x] = extra[x]; return h; }
  function remoteGet(q) { return fetch(remoteUrl(q), { headers: remoteHeaders() }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); }
  function remoteUpsert(row) {
    return fetch(remoteUrl('?on_conflict=id'), { method: 'POST', headers: remoteHeaders({ Prefer: 'resolution=merge-duplicates,return=minimal' }), body: JSON.stringify(row) })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); });
  }
  function startOnline() {
    var ses = S, rc = encodeURIComponent('eq.' + ses.code), first = true;
    ses.online = true;
    function poll() {
      if (ses.closed) return;
      var since = new Date(Date.now() - 20000).toISOString();
      Promise.all([
        remoteGet('?select=payload&room=' + rc + '&kind=eq.msg&order=created_at.desc&limit=50'),
        remoteGet('?select=payload&room=' + rc + '&kind=eq.state'),
        remoteGet('?select=payload&room=' + rc + '&kind=eq.pres&updated_at=gte.' + encodeURIComponent(since))
      ]).then(function (r) {
        if (ses.closed) return;
        r[0].reverse().forEach(function (row) { deliver(row.payload, first); });
        r[1].forEach(function (row) { if (row.payload && safeKey(row.payload.key)) applyState(row.payload.key, row.payload.entry, false); });
        r[2].forEach(function (row) { var p = row.payload; if (isObj(p) && typeof p.cid === 'string' && p.cid !== cid) setPresence(p.cid, p); });
        first = false;
        if (!ses.relay && status !== 'online') setStatus('online');
      }).catch(function (e) { warn('online poll failed', e && e.message); })
        .then(function () { if (!ses.closed) ses.timers.push(setTimeout(poll, 2500)); });
    }
    poll();
  }

  /* ---------- presence ---------- */
  function selfInfo() { return { cid: cid, role: room.role, id: room.id, name: room.name }; }
  function setPresence(c, p) {
    var f = cleanFrom(p);
    if (!S || !f) return;
    S.pres[c] = { role: f.role, id: f.id, name: f.name, lastSeen: isFinite(Number(p.lastSeen)) ? Math.min(Number(p.lastSeen), Date.now()) : Date.now() };
  }
  function presenceList() {
    var now = Date.now(), out = [], all = {}, x;
    for (x in S.pres) all[x] = S.pres[x];
    var lp = localPresence();
    for (x in lp) { if (!all[x] || all[x].lastSeen < lp[x].lastSeen) all[x] = lp[x]; }
    all[cid] = { role: room.role, id: room.id, name: room.name, lastSeen: now };
    for (x in all) {
      var p = all[x];
      if (now - p.lastSeen < ONLINE_MS) out.push({ role: p.role, id: p.id, name: p.name, lastSeen: p.lastSeen });
    }
    out.sort(function (a, b) { return a.role < b.role ? -1 : a.role > b.role ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return out;
  }
  function firePresence() { if (!S || !room) return; var l = presenceList(); presSubs.slice().forEach(function (fn) { call(fn, l); }); }
  function heartbeat() {
    var ses = S;
    if (!ses || ses.closed) return;
    var me = selfInfo();
    lsSet(k(ses.code, 'pres.' + cid), JSON.stringify({ role: me.role, id: me.id, name: me.name, lastSeen: Date.now() }));
    var jobs = [];
    if (ses.relay) jobs.push(api('/rooms/' + ses.code + '/presence', { method: 'POST', body: me }).then(function (r) {
      var now = Date.now();
      (r.list || []).forEach(function (p) {
        if (isObj(p) && typeof p.cid === 'string' && isFinite(Number(p.age))) { var f = cleanFrom(p); if (f) ses.pres[p.cid] = { role: f.role, id: f.id, name: f.name, lastSeen: now - Number(p.age) }; }
      });
      for (var c in ses.pres) if (now - ses.pres[c].lastSeen > 60000) delete ses.pres[c];
    }).catch(function () { /* the poll loop reports relay failures */ }));
    if (ses.online) { var o = selfInfo(); o.lastSeen = Date.now(); jobs.push(remoteUpsert({ id: 'pres:' + ses.code + ':' + cid, room: ses.code, kind: 'pres', payload: o, updated_at: new Date().toISOString() }).catch(function () { })); }
    Promise.all(jobs).then(firePresence);
  }
  window.addEventListener('pagehide', function () {
    if (!S || !room) return;
    try { localStorage.removeItem(k(S.code, 'pres.' + cid)); } catch (e) { /* ignore */ }
    try { if (S.relay && navigator.sendBeacon) navigator.sendBeacon('/api/rooms/' + S.code + '/presence', new Blob([JSON.stringify({ cid: cid, role: room.role, id: room.id, name: room.name, leave: true })], { type: 'application/json' })); } catch (e) { /* ignore */ }
  });

  /* ---------- public API ---------- */
  function teardown() {
    if (!S) return;
    S.closed = true;
    S.timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    S.listeners.forEach(function (f) { f(); });
    try { if (S.bc) S.bc.close(); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(k(S.code, 'pres.' + cid)); } catch (e) { /* ignore */ }
  }
  function join(code, who) {
    who = who || {};
    var c = normCode(code);
    if (!c) c = newCode();
    if (!validCode(c)) throw new Error('JdaLink.join: invalid room code (5 characters, A-Z without I or O, and 2-9)');
    var role = ROLES.indexOf(who.role) >= 0 ? who.role : 'crew';
    teardown();
    var carry = implicit ? pendingOut : null;
    implicit = (c === LEGACY && who.role === 'legacy');
    if (!implicit || !carry) pendingOut = { msgs: [], state: {} };
    room = { code: c, role: role, id: slug(who.id, 32) || (role === 'crew' ? '' : role), name: cleanName(who.name) || (who.id ? cleanName(who.id) : '') };
    S = newSession(c);
    setStatus('local');
    startLocal();
    var ses = S;
    ses.timers.push(setInterval(heartbeat, HEARTBEAT));
    ses.timers.push(setInterval(firePresence, 2000));
    heartbeat();
    function flushCarry() {   // publish what was sent before the page joined a real room, once the transport is known
      if (!carry || implicit || ses.closed) return;
      var now = Date.now();
      carry.msgs.filter(function (x) { return now - x.at < 120000; }).forEach(function (x) { try { send(x.msg); } catch (e) { /* ignore */ } });
      Object.keys(carry.state).forEach(function (key) { try { setState(key, carry.state[key]); } catch (e) { /* ignore */ } });
      pendingOut = { msgs: [], state: {} };
    }
    function reprobe(ses2) {   // relay not reachable at load: keep looking, so a relay started later (or restarted) is picked up without a reload
      var tm = setTimeout(function () {
        if (ses2.closed || ses2.relay) return;
        probeRelay().then(function (ok2) { if (ses2.closed) return; if (ok2) { startRelay(); heartbeat(); } else reprobe(ses2); });
      }, 4000);
      ses2.timers.push(tm);
    }
    if (c !== LEGACY) {   // the legacy default room never leaves this browser
      probeRelay().then(function (ok) {
        if (ses.closed) return;
        if (ok) startRelay();
        else if (/^https?:$/.test(location.protocol)) reprobe(ses);
        if (online) startOnline();
        heartbeat();
        flushCarry();
      });
    }
    return { code: c };
  }
  function ensure() { if (!room) join(LEGACY, { role: 'legacy', id: 'legacy', name: '' }); }

  function send(msg) {
    ensure();
    if (!isObj(msg) || typeof msg.type !== 'string') throw new Error('JdaLink.send: message needs a string type');
    var ses = S, m = {};
    Object.keys(msg).forEach(function (x) { if (x !== '__proto__') m[x] = msg[x]; });
    if (implicit) { try { pendingOut.msgs.push({ at: Date.now(), msg: clone(msg) }); if (pendingOut.msgs.length > 20) pendingOut.msgs.shift(); } catch (e) { /* ignore */ } }
    // a caller-supplied string `from` is a display name: keep it as fromName, `from` itself is always the sender envelope
    if (typeof m.from === 'string' && !m.fromName) m.fromName = cleanName(m.from);
    if (typeof m.fromName === 'string') m.fromName = cleanName(m.fromName);
    else if (room.name && m.type === 'chat') m.fromName = room.name;
    m.id = newId(); m.t = new Date().toISOString(); m.room = ses.code;
    m.from = { role: room.role, id: room.id, name: room.name, cid: cid };
    if (m.type === 'chat' && typeof m.text === 'string') m.text = m.text.slice(0, 500);
    try { m = clone(m); } catch (e) { throw new Error('JdaLink.send: message is not JSON'); }
    if (!validMsg(m, ses.code)) { warn('message rejected (too large or invalid)'); return null; }
    markSeen(m.id); pushLog(m);
    lsSet(k(ses.code, 'log'), JSON.stringify(ses.log.slice(-LOG_N)));
    try { if (ses.bc) ses.bc.postMessage({ k: 'msg', m: m }); } catch (e) { /* ignore */ }
    lsSet(k(ses.code, 'msg'), JSON.stringify(m));
    queueOut(ses, m);
    if (ses.online) remoteUpsert({ id: m.id, room: ses.code, kind: 'msg', payload: m }).catch(function (e) { warn('online send failed', e && e.message); });
    return m;
  }
  function setState(key, value) {
    ensure();
    if (!safeKey(key)) throw new Error('JdaLink.setState: bad key');
    if (size(value) > MAX_STATE) { warn('state too large'); return false; }
    if (implicit) { try { pendingOut.state[key] = clone({ v: value }).v; } catch (e) { /* ignore */ } }
    var ses = S, e = { value: clone({ v: value }).v, t: Date.now(), from: { role: room.role, id: room.id, name: room.name, cid: cid }, ver: 0 };
    ses.state[key] = e;
    var wire = { value: e.value, t: e.t, from: e.from };
    lsSet(k(ses.code, 'state.' + key), JSON.stringify(wire));
    try { if (ses.bc) ses.bc.postMessage({ k: 'state', key: key, e: wire }); } catch (x) { /* ignore */ }
    ses.mine[key] = wire;
    if (ses.relay) api('/rooms/' + ses.code + '/state/' + encodeURIComponent(key), { method: 'PUT', body: wire }).catch(function (x) { relayFail(x); });
    if (ses.online) remoteUpsert({ id: 'state:' + ses.code + ':' + key, room: ses.code, kind: 'state', payload: { key: key, entry: wire }, updated_at: new Date().toISOString() }).catch(function () { });
    return true;
  }
  function getState(key) {
    ensure();
    var e = S.state[key];
    return e ? { value: clone({ v: e.value }).v, t: e.t, from: e.from } : null;
  }
  function onState(key, fn) {
    ensure();
    if (!safeKey(key) || typeof fn !== 'function') return function () { };
    (stateSubs[key] = stateSubs[key] || []).push(fn);
    var e = S.state[key];
    if (e) setTimeout(function () { var cur = S && S.state[key]; if (cur) call(fn, clone({ v: cur.value }).v, { t: cur.t, from: cur.from }); }, 0);
    return function () { var a = stateSubs[key] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); };
  }
  function off(list, fn) { return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); }; }

  var api2 = {
    join: join,
    onStatus: function (fn) { if (typeof fn !== 'function') return function () { }; statusSubs.push(fn); setTimeout(function () { if (statusSubs.indexOf(fn) >= 0) call(fn, status); }, 0); return off(statusSubs, fn); },
    on: function (fn) { ensure(); if (typeof fn !== 'function') return function () { }; subs.push(fn); return off(subs, fn); },
    send: send,
    history: function (n) { ensure(); n = n > 0 ? Math.min(n | 0, LOG_N) : LOG_N; return clone(S.log.slice(-n)); },
    setState: setState, getState: getState, onState: onState,
    presence: function () { ensure(); return presenceList(); },
    onPresence: function (fn) { presSubs.push(fn); return off(presSubs, fn); },
    newCode: newCode, normCode: normCode, isValidCode: function (c) { return CODE_RE.test(normCode(c)); },
    clientId: cid
  };
  Object.defineProperty(api2, 'room', { get: function () { return room ? { code: room.code, role: room.role, id: room.id, name: room.name, implicit: implicit } : null; }, enumerable: true });
  Object.defineProperty(api2, 'status', { get: function () { return status; }, enumerable: true });
  Object.defineProperty(api2, 'mode', { get: function () { return status === 'online' ? 'online' : 'same-browser'; }, enumerable: true });   // legacy
  window.JdaLink = api2;
})();
