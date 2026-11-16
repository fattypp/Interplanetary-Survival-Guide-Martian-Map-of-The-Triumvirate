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
  /* 4-decimal degrees with hemisphere letter; a value that rounds to zero is never shown as south/west or '-0' */
  function deg(v, pos, neg) { var r = Math.abs(v).toFixed(4); return r + '°' + (v < 0 && Number(r) !== 0 ? neg : pos); }
  function wrapLon(v) { return ((v + 180) % 360 + 360) % 360 - 180; }
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
    else if (prev !== 'nominal' && l === 'nominal' && p < T.pctCaution + 3) l = 'caution';   // leaving danger or caution: one step at a time, never a jump back to danger
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
  /* crop of the Jezero CTX mosaic that fits base camp and the five stops; the crew dot moves over it */
  var MM = null;
  function mmSetup() {
    var M = window.JEZERO_MISSION, pts = [];
    if (M && M.base && isFinite(M.base.x)) pts.push({ x: +M.base.x, y: +M.base.y, base: true, name: 'Base camp' });
    if (M && M.stops) M.stops.forEach(function (s) { if (isFinite(s.x) && isFinite(s.y)) pts.push({ x: +s.x, y: +s.y, n: s.n, name: s.name }); });
    if (!pts.length) return null;
    var xs = pts.map(function (q) { return q.x; }), ys = pts.map(function (q) { return q.y; });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    var box = $('map'), marks = [];
    pts.forEach(function (q) {
      var e = document.createElement('i'); e.className = 'mk' + (q.base ? ' base' : ''); e.textContent = q.base ? '' : String(q.n);
      box.insertBefore(e, $('dot')); marks.push({ q: q, el: e });
    });
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: Math.max(60, x1 - x0), h: Math.max(60, y1 - y0), marks: marks };
  }
  function minimap(m) {
    m = m || {};
    if (MM === null) MM = mmSetup() || false;
    var map = $('map'), cw = map.clientWidth, ch = map.clientHeight, img = $('mapImg'), dot = $('dot');
    var c = MM || { cx: MAP_W / 2, cy: MAP_H / 2, w: MAP_W, h: MAP_H, marks: [] };
    var PAD = 14, sc = Math.min((cw - 2 * PAD) / c.w, (ch - 2 * PAD) / c.h);
    var ox = cw / 2 - c.cx * sc, oy = ch / 2 - c.cy * sc;    // atlas px -> minimap px: p * sc + o
    img.style.backgroundSize = MAP_W * sc + 'px ' + MAP_H * sc + 'px';
    img.style.backgroundPosition = ox + 'px ' + oy + 'px';
    c.marks.forEach(function (k) { k.el.style.left = (k.q.x * sc + ox) + 'px'; k.el.style.top = (k.q.y * sc + oy) + 'px'; });
    var x = num(m.x, NaN), y = num(m.y, NaN);
    if (!isFinite(x) || !isFinite(y)) { dot.style.display = 'none'; return; }
    dot.style.display = '';
    var dx = x * sc + ox, dy = y * sc + oy;
    var off = dx < 0 || dx > cw || dy < 0 || dy > ch;
    dx = Math.min(cw - 6, Math.max(6, dx)); dy = Math.min(ch - 6, Math.max(6, dy));
    dot.style.left = dx + 'px'; dot.style.top = dy + 'px';
    dot.classList.toggle('off', off);
    dot.style.setProperty('--hd', num(m.headingDeg, 0) + 'deg');
    $('map').setAttribute('aria-label', 'Minimap: base camp, stops 1 to 5 and your position' + (off ? ' (you are outside the mapped area)' : ''));
  }
  function travelTag(m) {
    var moving = m && (m.mode === 'walking' || m.mode === 'returning');   // no tag while idle or resting at base: nobody is out or driving
    var t = moving ? (m.travel === 'rover' ? 'ROVER' : m.travel === 'foot' ? 'EVA' : '') : '', sp = m ? num(m.speedMps, NaN) : NaN;
    var tag = $('travel');
    txt(tag, t ? t + (isFinite(sp) && sp > 0.05 ? ' ' + sp.toFixed(1) + ' m/s' : '') : '');
    tag.hidden = !t;
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
  function missionTasks() { var M = window.JEZERO_MISSION; return M && M.tasks ? M.tasks : []; }
  function stopName(id) {
    var M = window.JEZERO_MISSION, st = M && M.stops ? M.stops.filter(function (x) { return x.id === id; })[0] : null;
    return st ? (st.n ? 'Stop ' + st.n + ': ' : '') + st.name : '';
  }
  function doneIds() {
    var set = {}, ms = task && Array.isArray(task.missions) ? task.missions : null;
    if (ms) ms.forEach(function (x) { if (x && x.done) set[x.id] = 1; });
    return set;
  }
  /* next undone task of the ordered list; a world record naming a task (taskId) sets the starting point */
  function nextTask(m) {
    var list = missionTasks(), done = task && Array.isArray(task.missions) ? doneIds() : null, i = 0, n;
    if (!list.length) {
      n = task && task.next && typeof task.next === 'object' ? task.next : null;
      return n ? { title: str(n.title, 120), where: str(n.stopName, 80), startISO: n.startISO || null } : null;
    }
    if (m && m.taskId) { for (var k = 0; k < list.length; k++) if (list[k].id === m.taskId) { i = k; break; } }
    else if (m && m.stopId) { for (var j = 0; j < list.length; j++) if (list[j].stopId === m.stopId) { i = j; break; } }
    else if (m && !done && m.progress && isFinite(Number(m.progress.done))) i = Math.max(0, Math.min(list.length, Math.floor(Number(m.progress.done))));   // no tablet data and no task in the record (e.g. after a fallback): continue after the tasks the run finished
    for (; i < list.length; i++) if (!done || !done[list[i].id]) break;
    if (i >= list.length) return { done: true };
    if (!(m && (m.taskId || m.stopId)) && !done && task && task.next && task.next.taskId) {
      for (var q = 0; q < list.length; q++) if (list[q].id === task.next.taskId) { i = q; break; }
    }
    var t = list[i], n2 = task && task.next && task.next.taskId === t.id ? task.next : null;
    return { title: str(t.title, 120), where: stopName(t.stopId), startISO: n2 && n2.startISO ? n2.startISO : null };
  }
  function watchTasks(id) {
    if (!id || id === taskFor || !window.JdaLink || !JdaLink.onState) return;
    if (taskOff) { try { taskOff(); } catch (e) {} }
    taskFor = id; task = null;
    try { taskOff = JdaLink.onState('tasks:' + id, function (v) { task = v && typeof v === 'object' ? v : null; renderTask(); }); } catch (e) { taskOff = null; }
  }
  function renderTask() {
    var nt = nextTask(lastWorld), title, when = '';
    if (nt && nt.done) title = 'All tasks complete';
    else if (nt) {
      title = nt.title; when = nt.where;
      var d = nt.startISO ? new Date(nt.startISO) : null, nw = now();
      if (d && !isNaN(d) && nw) {
        var mins = Math.round((d - nw) / 60000);
        when += (when ? ' - ' : '') + (mins > 1 ? 'in ' + (mins >= 60 ? Math.floor(mins / 60) + ' h ' + (mins % 60) + ' min' : mins + ' min') : 'now');
      }
    } else title = 'No task scheduled';
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
    if (isFinite(rad)) rad = Math.max(0, Math.min(99999, rad));
    txt($('temp'), isFinite(temp) ? (Math.round(Math.max(-999, Math.min(999, temp))) || 0) + ' °C' : '--');
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
      txt($('coords'), deg(num(m.lat, 0), 'N', 'S') + ', ' + deg(wrapLon(num(m.lon, 0)), 'E', 'W') + ', z ' + (isFinite(z) ? Math.round(z) + ' m' : '--'));
    } else txt($('coords'), '--');
    minimap(m); travelTag(m);
    renderTask();
  }

  /* ---------- parallax drift while walking ---------- */
  function drift(ts) {
    var m = lastWorld, walking = m && (m.mode === 'walking' || m.mode === 'returning');
    if (!walking && ts - drift.last < 66) { requestAnimationFrame(drift); return; }   // idle sway is a few px per second: about 15 updates a second are enough
    drift.last = ts;
    var t = ts / 1000, sp = walking ? Math.max(0.6, Math.min(2.5, num(m && m.speedMps, 1))) : 0;
    var amp = walking ? 1 : 0.18;
    var x = Math.sin(t * 0.21) * 14 * amp + (walking ? Math.sin(t * 0.9 * sp) * 2.5 : 0);
    var y = Math.cos(t * 0.17) * 6 * amp + (walking ? Math.abs(Math.sin(t * 1.7 * sp)) * 5 : 0);
    $('scene').style.setProperty('--px', x.toFixed(1) + 'px'); $('scene').style.setProperty('--py', y.toFixed(1) + 'px');
    requestAnimationFrame(drift);
  }

  drift.last = 0;

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
