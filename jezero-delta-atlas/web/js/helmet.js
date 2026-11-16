/* Helmet HUD. Reads crew data only through JdaWorld, messages and tasks through JdaLink. Plain browser JS. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var NS = 'http://www.w3.org/2000/svg';
  var MAP_W = 1990, MAP_H = 1390, ZOOM = 3;
  var RL = (window.JEZERO_SCIENCE && JEZERO_SCIENCE.radiation && JEZERO_SCIENCE.radiation.limits) || {};   // uSv/h, same source as suit.js
  var T = { radCaution: num(RL.caution, 36), radDanger: num(RL.danger, 55), pctCaution: 25, pctCritical: 10 };   // percent for o2/battery
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $helmet = $('helmet');
  var lastWorld = null, taskOff = null, taskFor = null, task = null, crewId = null;

  function num(v, d) { if (v === null || v === undefined || v === '') return d; v = Number(v); return isFinite(v) ? v : d; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function txt(el, s) { if (el.textContent !== s) el.textContent = s; }
  function me() { try { return window.JdaWorld && JdaWorld.me ? JdaWorld.me() : null; } catch (e) { return null; } }
  function wrld() { try { return window.JdaWorld && JdaWorld.world ? JdaWorld.world() : null; } catch (e) { return null; } }
  function now() { var w = wrld(), d = w && w.t ? new Date(w.t) : null; return d && !isNaN(d) ? d : null; }
  function lmst() {   // Mars local solar time, hours, from the sim's own calendar
    var w = wrld(), S = window.JdaSim; if (!w || !w.t || !S || !S.localHour || !S.C) return null;
    var h = S.localHour(Date.parse(w.t) - Date.parse(S.C.START_ISO)); return isFinite(h) ? h : null;
  }

  /* ---------- levels with hysteresis ---------- */
  var lv = { o2: 'nominal', bat: 'nominal', rad: 'nominal' };
  function pctLevel(key, p) {
    var prev = lv[key], l;
    if (p < T.pctCritical) l = 'danger';
    else if (p < T.pctCaution) l = 'caution';
    else l = 'nominal';
    if (prev === 'danger' && l !== 'danger' && p < T.pctCritical + 3) l = 'danger';
    if (prev !== 'nominal' && l === 'nominal' && p < T.pctCaution + 3) l = prev;
    return (lv[key] = l);
  }
  function radLevel(r) {
    var prev = lv.rad, l = r >= T.radDanger ? 'danger' : r >= T.radCaution ? 'caution' : 'nominal';
    if (prev === 'danger' && l === 'caution' && r > T.radDanger * 0.9) l = 'danger';
    if (prev !== 'nominal' && l === 'nominal' && r > T.radCaution * 0.9) l = 'caution';
    return (lv.rad = l);
  }

  /* ---------- bars ---------- */
  function bar(key, pct) {
    var b = $(key), f = $(key + 'Fill'), p = $(key + 'Pct');
    if (pct == null) { f.style.height = '0'; txt(p, '--'); b.className = 'bar'; b.removeAttribute('aria-valuenow'); return 'nominal'; }
    pct = Math.max(0, Math.min(100, pct));
    var l = pctLevel(key, pct);
    f.style.height = pct + '%';
    txt(p, Math.round(pct) + '%');
    b.className = 'bar' + (l === 'nominal' ? '' : ' ' + l);
    b.setAttribute('aria-valuenow', String(Math.round(pct)));
    b.setAttribute('aria-valuetext', Math.round(pct) + ' percent' + (l === 'nominal' ? '' : ', ' + (l === 'danger' ? 'critical' : 'low')));
    return l;
  }

  /* ---------- minimap ---------- */
  function minimap(m) {
    m = m || {};
    var map = $('map'), cw = map.clientWidth, ch = map.clientHeight, img = $('mapImg'), dot = $('dot');
    var iw = cw * ZOOM, ih = iw * MAP_H / MAP_W;
    img.style.backgroundSize = iw + 'px ' + ih + 'px';
    var x = num(m.x, NaN), y = num(m.y, NaN);
    if (!isFinite(x) || !isFinite(y)) { dot.style.display = 'none'; img.style.backgroundPosition = '50% 50%'; return; }
    dot.style.display = '';
    var px = x / MAP_W * iw, py = y / MAP_H * ih;
    var bx = Math.min(0, Math.max(cw - iw, cw / 2 - px)), by = Math.min(0, Math.max(ch - ih, ch / 2 - py));
    img.style.backgroundPosition = bx + 'px ' + by + 'px';
    var dx = bx + px, dy = by + py;
    var off = dx < 0 || dx > cw || dy < 0 || dy > ch || x < 0 || y < 0 || x > MAP_W || y > MAP_H;
    dx = Math.min(cw - 6, Math.max(6, dx)); dy = Math.min(ch - 6, Math.max(6, dy));
    dot.style.left = dx + 'px'; dot.style.top = dy + 'px';
    dot.classList.toggle('off', off);
    dot.style.setProperty('--hd', num(m.headingDeg, 0) + 'deg');
    $('map').setAttribute('aria-label', 'Minimap, position ' + Math.round(x) + ' by ' + Math.round(y) + (off ? ', outside the mapped area' : ''));
  }

  /* ---------- alerts ---------- */
  var alertState = {}, sosMine = {};
  function icon(kind) {
    var s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS(NS, 'path'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor'); p.setAttribute('stroke-width', '2');
    p.setAttribute('d', kind === 'danger' ? 'M7 2h10l5 5v10l-5 5H7l-5-5V7z M12 7v6 M12 16.5v.5' : 'M12 3 22 21H2z M12 10v5 M12 17.5v.5');
    s.appendChild(p); return s;
  }
  function setAlert(id, level, text) {
    var box = $('alerts'), cur = alertState[id];
    if (cur && cur.level === level && cur.text === text) return;
    if (cur) { cur.el.remove(); delete alertState[id]; }
    if (!level || level === 'nominal') return;
    var d = document.createElement('div'); d.className = 'alert ' + (level === 'danger' ? 'danger' : '');
    d.appendChild(icon(level));
    var s = document.createElement('span'); s.textContent = (level === 'danger' ? 'DANGER: ' : 'CAUTION: ') + text; d.appendChild(s);
    box.appendChild(d); alertState[id] = { level: level, text: text, el: d };
  }

  /* ---------- toasts ---------- */
  function toast(kind, head, body) {
    var t = document.createElement('div'); t.className = 'toast ' + kind;
    var b = document.createElement('b'); b.textContent = head; t.appendChild(b);
    var s = document.createElement('span'); s.textContent = body; t.appendChild(s);
    var box = $('toasts'); box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(function () { t.remove(); }, 9000);
  }
  function str(v, n) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, n) : ''; }
  function onMsg(m) {
    if (!m || typeof m !== 'object') return;
    var mid = crewId || (window.JdaLink && JdaLink.room && JdaLink.room.id) || null;
    if (m.type === 'chat') {
      if (m.to && m.to !== 'all' && m.to !== mid) return;
      var who = str(m.fromName, 40) || str(m.from && m.from.name, 40) || 'Crew';
      var text = str(m.text, 500); if (!text) return;
      toast('chat', 'MESSAGE FROM ' + who.toUpperCase(), text);
    } else if (m.type === 'sos') {
      if (m.from && m.from.id && m.from.id === mid && m.id) sosMine[m.id] = 1;
    } else if (m.type === 'ack') {
      if (!m.sosId || !sosMine[m.sosId]) return;
      toast('ack', 'SOS ACKNOWLEDGED', 'Received by ' + (str(m.by, 40) || 'Earth control') + '. Help is being arranged.');
    }
  }

  /* ---------- next task ---------- */
  function fallbackTask() {
    var M = window.JEZERO_MISSION, s = M && M.stops;
    if (!s || !s.length) return null;
    for (var i = 0; i < s.length; i++) if (!s[i].done) return { title: str(s[i].name, 120), startISO: null, whenText: null };
    return null;
  }
  function watchTasks(id) {
    if (!id || id === taskFor || !window.JdaLink || !JdaLink.onState) return;
    if (taskOff) { try { taskOff(); } catch (e) {} }
    taskFor = id; task = null;
    try { taskOff = JdaLink.onState('tasks:' + id, function (v) { task = v && typeof v === 'object' ? v : null; renderTask(); }); } catch (e) { taskOff = null; }
  }
  function renderTask() {
    var n = task && task.next && typeof task.next === 'object' ? task.next : null, title, when = '';
    if (n) {
      title = str(n.title, 120);
      var d = n.startISO ? new Date(n.startISO) : null, nw = now();
      if (d && !isNaN(d) && nw) {
        var mins = Math.round((d - nw) / 60000);
        when = mins > 1 ? 'Starts at ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' (in ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') + ')' : 'Starting now';
      } else when = 'No start time set';
    } else if (task && task.progress && task.progress.total > 0 && task.progress.done >= task.progress.total) {
      title = 'All tasks complete'; when = '';
    } else {
      var f = fallbackTask();
      if (f) { title = f.title; when = ''; } else { title = 'No task scheduled'; }
    }
    txt($('taskTitle'), title); txt($('taskWhen'), when);
  }

  /* ---------- main render ---------- */
  function render() {
    var m = me();
    lastWorld = m;
    if (m && m.id) { crewId = m.id; watchTasks(m.id); }
    else if (window.JdaLink && JdaLink.room && JdaLink.room.id) watchTasks(JdaLink.room.id);
    var lh = lmst();
    txt($('clock'), lh == null ? '--:--' : pad(Math.floor(lh)) + ':' + pad(Math.floor((lh % 1) * 60)));
    var temp = m ? num(m.ambientTempC, NaN) : NaN, rad = m ? num(m.radUsvH, NaN) : NaN;
    txt($('temp'), isFinite(temp) ? Math.round(temp) + ' °C' : '--');
    var rl = isFinite(rad) ? radLevel(rad) : 'nominal';
    var rd = $('rad'); txt(rd, isFinite(rad) ? rad.toFixed(rad < 10 ? 1 : 0) + ' µSv/h' : '--'); rd.className = rl === 'nominal' ? '' : rl;
    var o2 = m && isFinite(num(m.o2Pct, NaN)) ? num(m.o2Pct, 0) : null, bt = m && isFinite(num(m.batPct, NaN)) ? num(m.batPct, 0) : null;
    var lo = bar('o2', o2), lb = bar('bat', bt);
    $helmet.classList.toggle('lowo2', lo !== 'nominal');
    setAlert('rad', rl, rl === 'danger' ? 'radiation above the suit limit, seek shelter' : 'radiation rising');
    setAlert('o2', lo, lo === 'danger' ? 'oxygen critical, return to base now' : 'oxygen low');
    setAlert('bat', lb, lb === 'danger' ? 'battery critical' : 'battery low');
    if (m && isFinite(num(m.lat, NaN)) && isFinite(num(m.lon, NaN))) {
      var z = num(m.zM, NaN);
      txt($('coords'), Math.abs(m.lat).toFixed(4) + '°' + (m.lat >= 0 ? 'N' : 'S') + ', ' + Math.abs(m.lon).toFixed(4) + '°' + (m.lon >= 0 ? 'E' : 'W') + ', z ' + (isFinite(z) ? Math.round(z) + ' m' : '--'));
    } else txt($('coords'), '--');
    minimap(m);
    renderTask();
  }

  /* ---------- parallax drift while walking ---------- */
  function drift(ts) {
    var m = lastWorld, walking = m && (m.mode === 'walking' || m.mode === 'returning');
    var t = ts / 1000, sp = walking ? Math.max(0.6, Math.min(2.5, num(m && m.speedMps, 1))) : 0;
    var amp = walking ? 1 : 0.18;
    var x = Math.sin(t * 0.21) * 14 * amp + (walking ? Math.sin(t * 0.9 * sp) * 2.5 : 0);
    var y = Math.cos(t * 0.17) * 6 * amp + (walking ? Math.abs(Math.sin(t * 1.7 * sp)) * 5 : 0);
    $('scene').style.setProperty('--px', x.toFixed(1) + 'px'); $('scene').style.setProperty('--py', y.toFixed(1) + 'px');
    requestAnimationFrame(drift);
  }

  /* ---------- wiring ---------- */
  function start() {
    try { if (window.JdaLinkUI && JdaLinkUI.mount) JdaLinkUI.mount({ role: 'helmet', ask: ['code', 'crew'], position: 'top-right' }); } catch (e) { if (window.console) console.warn('link ui', e); }
    try {
      if (window.JdaLink && JdaLink.history) { var h = JdaLink.history(200) || []; h.forEach(function (x) { if (x && x.type === 'sos' && x.from && x.from.id && x.from.id === ((window.JdaLink.room && JdaLink.room.id) || crewId) && x.id) sosMine[x.id] = 1; }); }
      if (window.JdaLink && JdaLink.on) JdaLink.on(onMsg);
    } catch (e) {}
    try { if (window.JdaWorld && JdaWorld.on) JdaWorld.on(render); } catch (e) {}
    setInterval(render, 1000);
    window.addEventListener('resize', function () { minimap(lastWorld); });
    render();
    if (!reduce) requestAnimationFrame(drift);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
