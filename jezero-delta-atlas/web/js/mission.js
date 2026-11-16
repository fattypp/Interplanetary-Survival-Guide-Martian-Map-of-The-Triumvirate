/* Mission feature: base camp, 5 stops and their 10 tasks (docs/mission-guide.md via data/mission-data.js), pin layer 'mission-stops',
   Mission tab, user-added missions, and the Atlas.missions API (see docs/ARCHITECTURE.md). */
(function () {
  'use strict';
  var A = window.Atlas, D = window.JEZERO_MISSION;
  if (!A || !D) { if (window.console) console.error('mission.js needs atlas-shell.js and data/mission-data.js'); return; }
  /* ---------- mission clock: follows the shared world while an authority (control page) is live ----------
     In a room, Atlas.now() is the world time (interpolated between updates at the world's clock speed); without one the page
     keeps its own clock, and Atlas.clock.setSpeed works as before. Atlas.clock.live() tells which one is active. */
  (function () {
    var clk = A.clock; if (!clk || typeof clk.now !== 'function') return;
    var origNow = clk.now, origSet = clk.setSpeed, base = null, realBase = 0, spd = 1, wasLive = false;
    function live() { var W = window.JdaWorld; return !!(W && W.source === 'authority' && base !== null); }
    window.JdaWorld && window.JdaWorld.on(function (w) {
      if (window.JdaWorld.source !== 'authority' || !w || !isFinite(Date.parse(w.t))) return;
      base = Date.parse(w.t); realBase = Date.now(); spd = Number(w.clockSpeed) > 0 ? Number(w.clockSpeed) : 1;
      clk.speed = spd;
    });
    function worldDate() { return new Date(base + (Date.now() - realBase) * spd); }
    function now() {
      if (live()) { wasLive = true; return worldDate(); }
      if (wasLive) {   // authority gone: carry on locally from the last world time and speed
        wasLive = false;
        var d = worldDate();
        clk.now = function () { return d; }; origSet(spd); clk.now = now;   // origSet anchors at clock.now()
      }
      return origNow();
    }
    clk.live = live;
    clk.now = now; A.now = now;
    clk.setSpeed = function (n) { if (live()) return; origSet(n); };
  })();

  var h = A.h, SRC = 'docs/mission-guide.md';
  var MAX_TITLE = 80, MAX_DESC = 500, MAX_CUSTOM = 200;
  var NS = 'http://www.w3.org/2000/svg';

  function inMap(x, y) { return x >= 0 && x <= A.W && y >= 0 && y <= A.H; }

  /* ---------- state ---------- */
  var objectives = D.objectives || [];
  var objById = {}; objectives.forEach(function (o) { objById[o.id] = o; });
  /* The objective the user chose (js/objective.js, window.JdaObjective): 1, 2 or 'both'. Nothing chosen yet counts as both until
     the choice dialog is answered. Tasks of the other objective stay in the data (and keep their done state) but are out of scope:
     they are not listed, counted, planned or scheduled. */
  var OB = window.JdaObjective || null;
  function choice() { var c = OB ? OB.get() : null; return c === null || c === undefined ? 'both' : c; }
  function inScope(objId) { var c = choice(); return c === 'both' || Number(objId) === c; }
  var done = A.store.get('mission.done', {}); if (!done || typeof done !== 'object' || Array.isArray(done)) done = {};
  var custom = A.store.get('mission.custom', []); if (!Array.isArray(custom)) custom = [];
  (function () {   // saved missions from older versions or a corrupt store: keep usable ones, drop duplicate ids and off-map positions
    var seen = {};
    custom = custom.filter(function (c) {
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || typeof c.title !== 'string' || seen[c.id] || taskByIdEarly(c.id)) return false;
      seen[c.id] = 1;
      if (typeof c.description !== 'string') c.description = '';
      if (typeof c.x !== 'number' || typeof c.y !== 'number' || !isFinite(c.x) || !isFinite(c.y) || !inMap(c.x, c.y)) { c.x = null; c.y = null; }
      return true;
    });
    function taskByIdEarly(id) { return (D.tasks || []).some(function (t) { return t.id === id; }) || (D.stops || []).some(function (t) { return t.id === id; }) || id === 'base'; }
  })();
  var seq = Number(A.store.get('mission.seq', 0)) || 0;
  custom.forEach(function (c) { var n = parseInt(String(c.id).replace('custom-', ''), 10); if (n > seq) seq = n; });

  /* Base camp, the 5 stops and the 10 tasks come from data/mission-data.js (generated from docs/mission-guide.md).
     x,y are page px; lat/lon come back through Atlas.ll so they agree with the map readout. */
  function place(o) {
    var q = A.ll(o.x, o.y);
    return { x: o.x, y: o.y, lat: q[1], lon: q[0], onMap: inMap(o.x, o.y) };
  }
  var base = (function () {
    var b = D.base || { id: 'base', name: 'Base camp', x: A.W - 24, y: A.H / 2 };
    var p = place(b);
    return { id: 'base', name: b.name, title: b.name, kind: 'base', description: b.description || 'Start and end of the drive. Confirm the ground is flat and rock-free enough to live on.',
      x: p.x, y: p.y, lat: p.lat, lon: p.lon, source: SRC, onMap: p.onMap };
  })();
  var stops = (D.stops || []).map(function (s) {
    var p = place(s);
    return { id: s.id, no: s.n, n: s.n, name: s.name, title: s.name, kind: 'stop', description: s.description, x: p.x, y: p.y, lat: p.lat, lon: p.lon,
      source: SRC, onMap: p.onMap, objectives: objectives.map(function (o) { return o.id; }), taskIds: [] };
  });
  var stopById = {}; stops.forEach(function (s) { stopById[s.id] = s; });
  var tasks = (D.tasks || []).filter(function (t) { return stopById[t.stopId]; }).map(function (t) {
    var s = stopById[t.stopId], o = objById[t.objective] || {};
    s.taskIds.push(t.id);
    return { id: t.id, kind: 'task', stopId: s.id, stopNo: s.n, stopName: s.name, objective: t.objective, objectiveShort: o.short || ('Objective ' + t.objective),
      title: t.title, description: t.description, estMin: t.estMin, x: s.x, y: s.y, lat: s.lat, lon: s.lon, source: SRC, onMap: s.onMap };
  });
  var taskById = {}; tasks.forEach(function (t) { taskById[t.id] = t; });

  function save() { A.store.set('mission.done', done); A.store.set('mission.custom', custom); A.store.set('mission.seq', seq); }
  function changed(reason, id) { A.bus.emit('missions:changed', { reason: reason, id: id || null }); }
  function scopedIds(s) { return s.taskIds.filter(function (id) { return inScope(taskById[id].objective); }); }
  function isDone(id) {
    var s = stopById[id];
    if (s) { var own = scopedIds(s); return own.length > 0 && own.every(function (t) { return !!done[t]; }); }   // a stop is visited when its tasks of the chosen objective(s) are done
    return !!done[id];
  }

  function customView(c, i) {
    var hasPos = typeof c.x === 'number' && typeof c.y === 'number', q = hasPos ? A.ll(c.x, c.y) : null;
    return {
      id: c.id, title: c.title, kind: 'custom', description: c.description || '', x: hasPos ? c.x : null, y: hasPos ? c.y : null,
      lat: q ? q[1] : null, lon: q ? q[0] : null, source: 'user', done: isDone(c.id), no: i + 1, onMap: hasPos
    };
  }
  function stopView(s) {
    var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    o.objectives = s.objectives.slice(); o.taskIds = s.taskIds.slice(); o.scopedTaskIds = scopedIds(s); o.done = isDone(s.id); return o;
  }
  function taskView(t) { var o = {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; }); o.done = isDone(t.id); o.inScope = inScope(t.objective); return o; }
  function baseView() { var o = {}; Object.keys(base).forEach(function (k) { o[k] = base[k]; }); return o; }

  /* ---------- validation and API ---------- */
  function validate(m) {
    var errs = [];
    if (!m || typeof m !== 'object') return { errors: ['Mission data is missing.'] };
    var title = typeof m.title === 'string' ? m.title.replace(/\s+/g, ' ').trim() : '';
    var desc = m.description === undefined || m.description === null ? '' : m.description;
    if (typeof desc !== 'string') { errs.push('Description must be text.'); desc = ''; }
    desc = desc.trim();
    if (!title) errs.push('Title is required.');
    else if (title.length > MAX_TITLE) errs.push('Title is too long (' + title.length + ' of ' + MAX_TITLE + ' characters).');
    if (desc.length > MAX_DESC) errs.push('Description is too long (' + desc.length + ' of ' + MAX_DESC + ' characters).');
    var x = null, y = null;
    if (m.x !== undefined && m.x !== null || m.y !== undefined && m.y !== null) {
      if (typeof m.x !== 'number' || typeof m.y !== 'number' || !isFinite(m.x) || !isFinite(m.y)) errs.push('Location must be two numbers.');
      else if (!inMap(m.x, m.y)) errs.push('Location is outside the map.');
      else { x = m.x; y = m.y; }
    }
    if (custom.length >= MAX_CUSTOM) errs.push('Too many custom missions (limit ' + MAX_CUSTOM + '). Delete some first.');
    return errs.length ? { errors: errs } : { value: { title: title, description: desc, x: x, y: y } };
  }

  /* Atlas.missions.list(): objectives, stops, tasks, then user missions. kind is 'objective' | 'stop' | 'task' | 'custom'.
     Base camp is not a stop: it is Atlas.missions.base(). setDone(id) accepts a task (one task), a stop (both its tasks) or a custom mission. */
  var API = A.missions = {
    list: function () {
      var out = objectives.map(function (o) {
        return { id: o.id, title: o.title, short: o.short, kind: 'objective', description: o.title, x: null, y: null, lat: null, lon: null, source: SRC };
      });
      return out.concat(stops.map(stopView), tasks.map(taskView), custom.map(customView));
    },
    stops: function () { return stops.map(stopView); },
    tasks: function () { return tasks.map(taskView); },                       // all 10, each with inScope (true for the chosen objective(s))
    scopedTasks: function () { return tasks.filter(function (t) { return inScope(t.objective); }).map(taskView); },   // 5 or 10, in stop order
    base: baseView,
    /* returns the new mission, or null when the input is invalid (use A.missions.validate for the reasons) */
    add: function (m) {
      var v = validate(m);
      if (!v.value) return null;
      var c = { id: 'custom-' + (++seq), title: v.value.title, description: v.value.description, x: v.value.x, y: v.value.y };
      custom.push(c); save(); changed('add', c.id);
      return customView(c, custom.length - 1);
    },
    validate: function (m) { return validate(m).errors || []; },
    remove: function (id) {
      var i = -1; custom.forEach(function (c, k) { if (c.id === id) i = k; });
      if (i < 0) return false;
      custom.splice(i, 1); delete done[id]; save(); changed('remove', id); return true;
    },
    setDone: function (id, flag) {
      var s = stopById[id], ids = s ? scopedIds(s) : (taskById[id] || custom.some(function (c) { return c.id === id; })) ? [id] : null;
      if (!ids) return false;
      ids.forEach(function (k) { if (flag) done[k] = true; else delete done[k]; });
      save(); changed('done', id); return true;
    },
    isDone: isDone,
    /* testing hook: behave as if the world run reports n finished tasks (see 'mission run mirror' below) */
    _applyRun: function (n) { applyRun(n); }
  };

  /* ---------- mission run mirror ----------
     While a world authority (control page) runs the mission, this crew member's record has progress:{done,total}. The first `done`
     tasks are marked done here: exactly progress.doneIds when present, else (older records) the first `done` tasks of the chosen objective(s), so the Mission tab, Planner and schedule show them as done.
     - Marked once per task (runHandled): a task the user un-ticks afterwards is NOT ticked again until the run restarts.
     - A task ticked or un-ticked by hand leaves runMarked (the user owns it from then on).
     - progress.done going down means the run restarted: tasks marked by the run (and still in runMarked) are re-opened, handling is reset.
     - Nothing is published back to the world. Without an authority nothing here runs and manual ticking is unchanged. The run state (handled / marked / last) is kept in jda.mission.run so a reload does not forget which ticks came from the run. */
  var runSaved = A.store.get('mission.run', null);
  if (!runSaved || typeof runSaved !== 'object' || Array.isArray(runSaved)) runSaved = {};
  function idMap(v) { var o = {}; if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (k) { if (v[k] === true && taskById[k]) o[k] = true; }); return o; }
  var runHandled = idMap(runSaved.handled), runMarked = idMap(runSaved.marked), runLast = isFinite(Number(runSaved.last)) ? Math.max(-1, Math.floor(Number(runSaved.last))) : -1;
  function saveRun() { A.store.set('mission.run', { handled: runHandled, marked: runMarked, last: runLast }); }
  function applyRun(n) {
    var sc = tasks.filter(function (t) { return inScope(t.objective); });   // the run works through the chosen tasks only, in mission order
    n = Math.max(0, Math.min(sc.length, Math.floor(Number(n)) || 0));
    var chg = false;
    if (n < runLast) {
      tasks.forEach(function (t) { if (runMarked[t.id] && done[t.id]) { delete done[t.id]; chg = true; } });
      runHandled = {}; runMarked = {};
    }
    runLast = n;
    for (var i = 0; i < n; i++) {
      var id = sc[i].id;
      if (runHandled[id]) continue;
      runHandled[id] = true;
      if (!done[id]) { done[id] = true; runMarked[id] = true; chg = true; }
    }
    saveRun();
    if (chg) { save(); changed('run'); }
  }
  /* Exact mirror: the world record carries progress.doneIds, every task the run actually completed (independent of the current choice).
     Those ids are marked done as run-sourced; run-sourced ticks no longer listed (a restart) are re-opened; ticks made by hand are never touched. */
  function applyRunIds(list) {
    var want = {}, chg = false;
    (Array.isArray(list) ? list : []).forEach(function (id) { if (typeof id === 'string' && taskById[id]) want[id] = true; });
    Object.keys(runMarked).forEach(function (id) { if (!want[id]) { if (done[id]) { delete done[id]; chg = true; } delete runMarked[id]; } });
    Object.keys(runHandled).forEach(function (id) { if (!want[id]) delete runHandled[id]; });
    tasks.forEach(function (t) {
      if (!want[t.id] || runHandled[t.id]) return;
      runHandled[t.id] = true;
      if (!done[t.id]) { done[t.id] = true; runMarked[t.id] = true; chg = true; }
    });
    runLast = -1; saveRun();
    if (chg) { save(); changed('run'); }
  }
  API._applyRunIds = applyRunIds;
  var setDoneUser = API.setDone;
  API.setDone = function (id, flag) {
    var s = stopById[id], ids = s ? scopedIds(s) : [id];
    ids.forEach(function (k) { delete runMarked[k]; });
    saveRun();
    return setDoneUser(id, flag);
  };
  if (window.JdaWorld && typeof window.JdaWorld.on === 'function') window.JdaWorld.on(function () {
    var W = window.JdaWorld, me = null;
    if (W.source !== 'authority') return;
    try { me = W.me(); } catch (e) { me = null; }
    if (me && me.progress && Array.isArray(me.progress.doneIds)) applyRunIds(me.progress.doneIds);
    else if (me && me.progress && isFinite(Number(me.progress.done))) applyRun(me.progress.done);   // older world records: positional
  });

  /* ---------- pin layer (always on, drawn above every other layer in its own svg #ov-top) ---------- */
  var topSvg = document.getElementById('ov-top');
  var layer = A.el('g', { class: 'ms-layer' }, topSvg || undefined);
  var pend = A.el('g', { class: 'ms-pending' }, layer);   // preview pin while picking a location
  var pinsG = A.el('g', {}, layer);
  var PIN = 'M0,0 C-3,-8 -11,-13 -11,-20 A11,11 0 1 1 11,-20 C11,-13 3,-8 0,0Z';
  var HOME = 'M0,0 L-9,-9 L-9,-20 L0,-27 L9,-20 L9,-9Z';   // base camp: a house-shaped marker, the tip is the point
  var pinEls = {};   // id -> {g, lab, w, x, y, kind}
  var sel = { id: null };   // the stop (or base camp) whose card is open

  function pinLabel(s) {
    if (s.kind === 'base') return s.title + ', start and end of the drive';
    if (s.kind === 'custom') return s.title + ' (my mission)' + (isDone(s.id) ? ', done' : '');
    return 'Stop ' + s.no + ': ' + s.title + ', ' + scopedIds(s).length + (scopedIds(s).length === 1 ? ' task' : ' tasks') + (isDone(s.id) ? ', done' : '');
  }
  function shortName(s) { var n = s.title || ''; return n.length > 24 ? n.slice(0, 23).replace(/\s+\S*$/, function (m) { return m.length > 8 ? '' : m; }).trim() + '\u2026' : n; }
  function makePin(s, text, parent) {
    var cls = s.kind === 'custom' ? 'ms-custom' : s.kind === 'base' ? 'ms-base' : 'ms-multi';
    var core = s.kind === 'custom' ? '' : ' ms-core';
    var g = A.el('g', { class: 'ms-pin hit ' + cls + core + (s.kind !== 'base' && isDone(s.id) ? ' ms-done' : '') + (sel.id === s.id ? ' ms-sel' : ''), transform: 'translate(' + s.x + ' ' + s.y + ')', tabindex: '0', role: 'button', 'aria-label': pinLabel(s), 'data-id': s.id }, parent);
    var k = A.el('g', { class: 'ms-s' }, g);
    var d = s.kind === 'base' ? HOME : PIN;
    A.el('path', { class: 'ms-halo', d: d }, k);
    A.el('path', { class: 'ms-body', d: d }, k);
    var t = A.el('text', { class: 'ms-num', x: 0, y: s.kind === 'base' ? -12.5 : -16.5, 'text-anchor': 'middle' }, k); t.textContent = text;
    if (s.kind !== 'base' && isDone(s.id)) { A.el('circle', { class: 'ms-tick', cx: 9, cy: -6, r: 5 }, k); A.el('path', { class: 'ms-tickp', d: 'M6.2 -6 L8.4 -3.8 L12 -8.2' }, k); }
    var lab = A.el('text', { class: 'ms-lab', x: 15, y: -14 }, k); lab.textContent = s.kind === 'custom' ? s.title : shortName(s);
    g.addEventListener('click', function (e) { if (A.pick.busy()) return; e.stopPropagation(); if (s.kind === 'custom') select(s.id); else openStop(s.id, { opener: g }); });
    g.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !A.pick.busy()) { e.preventDefault(); if (s.kind === 'custom') select(s.id); else openStop(s.id, { opener: g }); } });
    if (s.kind !== 'custom') pinEls[s.id] = { g: g, lab: lab, w: 0, x: s.x, y: s.y, kind: s.kind, n: s.no || 0, title: s.title };
    return g;
  }
  function drawPins() {
    while (pinsG.firstChild) pinsG.removeChild(pinsG.firstChild);
    pinEls = {};
    makePin(base, 'B', pinsG);
    stops.forEach(function (s) { if (s.onMap) makePin(s, String(s.no), pinsG); });
    custom.forEach(function (c, i) { var v = customView(c, i); if (v.onMap) makePin(v, 'C' + (i + 1), pinsG); });
    layoutSoon();
  }

  /* locked: the layer selector shows it as "always on" and nobody can hide it, so base camp and the 5 stops are always on the map */
  A.registerLayer({
    id: 'mission-stops', label: 'Base camp and mission stops', group: 'Mission', color: '#c4501b', node: layer, on: true, locked: true,
    count: stops.length
  });

  /* ---------- label declutter, edge indicators ---------- */
  var layoutQueued = false;
  function layoutSoon() { if (layoutQueued) return; layoutQueued = true; (window.requestAnimationFrame || setTimeout)(function () { layoutQueued = false; layoutAll(); }); }
  function order() {   // label priority: the open stop, then stops 1..5, then base camp
    var ids = Object.keys(pinEls).sort(function (a, b) {
      var A1 = a === sel.id ? -1 : pinEls[a].kind === 'base' ? 99 : pinEls[a].n, B1 = b === sel.id ? -1 : pinEls[b].kind === 'base' ? 99 : pinEls[b].n; return A1 - B1;
    });
    return ids;
  }
  function hit(a, b, pad) { pad = pad || 0; return a[0] < b[2] + pad && a[2] > b[0] - pad && a[1] < b[3] + pad && a[3] > b[1] - pad; }
  function layoutLabels() {
    var v = A.view(), ids = order(), bodies = [], placed = [], rg = visRegion(v, occluders()), fixedR = keepRects(document.getElementById('map').getBoundingClientRect());
    ids.forEach(function (id) { var e = pinEls[id]; e.sx = v.x + e.x * v.k; e.sy = v.y + e.y * v.k; bodies.push([e.sx - 13, e.sy - 33, e.sx + 13, e.sy + 2, id]); });
    ids.forEach(function (id) {
      var e = pinEls[id];
      if (!e.w) { try { e.w = e.lab.getComputedTextLength(); } catch (x) { e.w = 0; } if (!e.w) e.w = (e.lab.textContent || '').length * 8; e.w += 6; }
      var tries = [[e.sx + 14, 'start', 15], [e.sx - 14 - e.w, 'end', -15]], ok = null;
      for (var i = 0; i < tries.length && !ok; i++) {
        var r = [tries[i][0], e.sy - 31, tries[i][0] + e.w, e.sy - 10], clash = r[0] < rg.L || r[2] > rg.R || r[1] < 2 || r[3] > rg.B;
        for (var j = 0; j < bodies.length && !clash; j++) if (bodies[j][4] !== id && hit(r, bodies[j], 2)) clash = true;
        for (var m = 0; m < placed.length && !clash; m++) if (hit(r, placed[m], 3)) clash = true;
        for (var q = 0; q < fixedR.length && !clash; q++) if (hit(r, fixedR[q])) clash = true;
        if (!clash) { ok = tries[i]; placed.push(r); }
      }
      e.lab.classList.toggle('on', !!ok);
      if (ok) { e.lab.setAttribute('x', ok[2]); e.lab.setAttribute('text-anchor', ok[1]); }
    });
  }

  /* edge indicators: when a stop or base camp is outside the part of the map the user can see, a small arrow chip with its number
     sits at the edge of the visible part, in the direction of the pin. Tap to centre the map on it. */
  var edgeBox = null, edgeEls = {};
  function dirWord(dx, dy) {
    var a = Math.atan2(-dy, dx) * 180 / Math.PI, names = ['east', 'north east', 'north', 'north west', 'west', 'south west', 'south', 'south east'];
    return names[Math.round(((a % 360) + 360) % 360 / 45) % 8];
  }
  function rectOf(el) { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? r : null; }
  function phoneNow() { return !!(window.matchMedia && window.matchMedia('(max-width:640px)').matches); }
  function occluders() {   // rectangles of the open tab panels and the stop card, in map coordinates
    var out = [], mr = document.getElementById('map').getBoundingClientRect();
    [].forEach.call(document.querySelectorAll('.tabpanel'), function (p) { if (!p.hidden) { var r = rectOf(p); if (r) out.push(r); } });
    [].forEach.call(document.querySelectorAll('.sci-legend'), function (p) { var r = rectOf(p); if (r) out.push(r); });   // legends of the science layers (layers-science.js)
    if (card && !card.hidden) { var cr = rectOf(card); if (cr) out.push(cr); }
    return out.map(function (r) { return [r.left - mr.left, r.top - mr.top, r.right - mr.left, r.bottom - mr.top]; });
  }
  function visRegion(v, occ) {   // the visible part of the map: minus open panels on the left (desktop) / bottom sheets (phone) and the stop card
    var L = 6, R = v.w - 6, T = 6, B = v.h - 6, phone = phoneNow();
    occ.forEach(function (o) {
      if (phone) { if (o[1] > v.h * 0.3) B = Math.min(B, o[1] - 6); }
      else if (o[0] < v.w * 0.5) L = Math.max(L, o[2] + 6);
      else R = Math.min(R, o[0] - 6);
    });
    return { L: L, R: R, T: T, B: B };
  }
  var KEEP = '#dock>*,.tools,#layersel>*,.readout,.inset,#ms-strip,.lu-chip,#pickbar:not([hidden])';
  function keepRects(mr) {   // fixed controls drawn above the map (dock, zoom, layers, readout, inset, strip, link pill)
    var keep = []; [].forEach.call(document.querySelectorAll(KEEP), function (e) { var r = rectOf(e); if (r) keep.push([r.left - mr.left - 4, r.top - mr.top - 4, r.right - mr.left + 4, r.bottom - mr.top + 4]); });
    return keep;
  }
  function layoutEdges() {
    if (!edgeBox) return;
    var v = A.view(), occ = occluders(), mr = document.getElementById('map').getBoundingClientRect(), phone = phoneNow();
    var rg = visRegion(v, occ), L = rg.L, R = rg.R, T = rg.T, B = rg.B;
    var keep = keepRects(mr), tooNarrow = (R - L) < 110;   // panels fill the width: no room for chips, the strip still works
    var cx = (L + R) / 2, cy = (T + B) / 2, CH = 17, placed = [];
    order().forEach(function (id) {
      var e = pinEls[id], chip = edgeEls[id]; if (!chip) return;
      var sx = v.x + e.x * v.k, sy = v.y + e.y * v.k, inside = sx >= L + 4 && sx <= R - 4 && sy >= T + 34 && sy <= B - 2;
      if (inside) { // under a panel, the card or a fixed control (layers button, MOLA inset, ...)?
        occ.forEach(function (o) { if (sx > o[0] && sx < o[2] && sy > o[1] && sy < o[3]) inside = false; });
        keep.forEach(function (o) { if (sx > o[0] && sx < o[2] && sy - 14 > o[1] && sy - 14 < o[3]) inside = false; });
      }
      chip.hidden = inside || tooNarrow; if (inside || tooNarrow) return;
      var dx = sx - cx, dy = sy - cy, x0 = L + CH + 4, x1 = R - CH - 4, y0 = T + CH + 56, y1 = B - CH - 4;
      if (x1 < x0) { x0 = x1 = (L + R) / 2; }
      var tx = dx > 0 ? (x1 - cx) / dx : dx < 0 ? (x0 - cx) / dx : Infinity, ty = dy > 0 ? (y1 - cy) / dy : dy < 0 ? (y0 - cy) / dy : Infinity;
      var t = Math.min(tx, ty), px = cx + dx * t, py = cy + dy * t, alongX = ty <= tx;
      px = Math.min(x1, Math.max(x0, px)); py = Math.min(y1, Math.max(y0, py));
      function bad(qx, qy) {
        var r = [qx - CH, qy - CH, qx + CH, qy + CH], i;
        for (i = 0; i < keep.length; i++) if (hit(r, keep[i])) return true;
        for (i = 0; i < placed.length; i++) if (hit(r, placed[i], 2)) return true;
        return false;
      }
      if (bad(px, py)) {   // slide along the edge (both ways) to the nearest free spot
        var found = false;
        for (var st = 8; st < 900 && !found; st += 8) {
          var cand = alongX ? [[px + st, py], [px - st, py]] : [[px, py + st], [px, py - st]];
          for (var ci = 0; ci < 2 && !found; ci++) {
            var qx = Math.min(x1, Math.max(x0, cand[ci][0])), qy = Math.min(y1, Math.max(y0, cand[ci][1]));
            if (!bad(qx, qy)) { px = qx; py = qy; found = true; }
          }
        }
      }
      placed.push([px - CH, py - CH, px + CH, py + CH]);
      chip.style.left = (px - CH) + 'px'; chip.style.top = (py - CH) + 'px';
      var arrow = chip.firstChild; arrow.style.transform = 'rotate(' + Math.round(Math.atan2(dy, dx) * 180 / Math.PI) + 'deg)';
      chip.setAttribute('aria-label', (e.kind === 'base' ? 'Base camp' : 'Stop ' + e.n + ', ' + e.title) + ' is off screen to the ' + dirWord(dx, dy) + '. Centre the map on it.');
    });
  }
  function layoutAll() { try { layoutLabels(); } catch (e) { if (window.console) console.error(e); } try { layoutEdges(); } catch (e2) { if (window.console) console.error(e2); } }
  function buildEdges() {
    edgeBox = h('div', { id: 'ms-edges', class: 'ui' });
    [{ id: 'base', t: 'B' }].concat(stops.map(function (s) { return { id: s.id, t: String(s.no) }; })).forEach(function (o) {
      var chip = h('button', { type: 'button', class: 'ms-edge' + (o.id === 'base' ? ' ms-edge-base' : ''), hidden: true, attrs: { 'aria-label': 'Centre the map on ' + o.t, 'data-for': o.id }, onclick: function () { goTo(o.id, true); } },
        [h('span', { class: 'ms-edge-arrow', attrs: { 'aria-hidden': 'true' } }), h('b', { text: o.t, attrs: { 'aria-hidden': 'true' } })]);
      edgeEls[o.id] = chip; edgeBox.appendChild(chip);
    });
    document.body.appendChild(edgeBox);
  }

  /* ---------- always visible strip: Base camp and the 5 stops ---------- */
  var strip = null, stripEls = {};
  function buildStrip() {
    strip = h('div', { id: 'ms-strip', class: 'ui', attrs: { role: 'toolbar', 'aria-label': 'Base camp and the five stops' } });
    [{ id: 'base', t: 'B', name: base.title }].concat(stops.map(function (s) { return { id: s.id, t: String(s.no), name: s.title, no: s.no }; })).forEach(function (o) {
      var b = h('button', { type: 'button', class: 'ms-chip' + (o.id === 'base' ? ' ms-chip-base' : ''), attrs: { title: (o.no ? 'Stop ' + o.no + ': ' : '') + o.name, 'aria-label': (o.no ? 'Stop ' + o.no + ': ' : '') + o.name + ', centre the map and show details', 'aria-pressed': 'false', 'data-for': o.id },
        onclick: function () { openStop(o.id, { opener: b }); } }, [h('span', { text: o.t, attrs: { 'aria-hidden': 'true' } })]);
      stripEls[o.id] = b; strip.appendChild(b);
    });
    document.body.appendChild(strip);
  }
  function syncStrip() {
    Object.keys(stripEls).forEach(function (id) {
      var b = stripEls[id], on = sel.id === id, d = id !== 'base' && isDone(id);
      b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('is-done', d);
    });
    Object.keys(pinEls).forEach(function (id) { pinEls[id].g.classList.toggle('ms-sel', sel.id === id); });
  }

  /* ---------- the stop card ---------- */
  var IMGS = window.JEZERO_STOP_IMAGES || {};
  var RAW_URL = 'https://mars.nasa.gov/mars2020/multimedia/raw-images/';
  var card = null, cardBody = null, cardTitle = null, cardOpener = null;
  function safeSrc(u) { return typeof u === 'string' && /^(\.{1,2}\/|\/|data:image\/|https:\/\/)/.test(u) && !/^\s*javascript:/i.test(u); }
  function coordText(m) { return m.lat.toFixed(4) + '\u00b0N  ' + m.lon.toFixed(4) + '\u00b0E'; }
  function placeholder() { return h('div', { class: 'ms-nopic', attrs: { role: 'img', 'aria-label': 'Picture not available yet' } }, [h('span', { text: 'Picture not available yet' })]); }
  function pictureBlock(id) {
    var im = IMGS[id], fig = h('figure', { class: 'ms-fig' });
    if (!im || !safeSrc(im.src)) { fig.appendChild(placeholder()); return fig; }
    var wrap = h('div', { class: 'ms-picwrap' }), img = h('img', { class: 'ms-pic', loading: 'lazy', decoding: 'async', alt: String(im.caption || 'Perseverance raw image of the area near this stop'), src: im.src });
    img.addEventListener('error', function () { if (wrap.parentNode) wrap.parentNode.replaceChild(placeholder(), wrap); var cp = fig.querySelector('figcaption'); if (cp) cp.hidden = true; });
    wrap.appendChild(img); fig.appendChild(wrap);
    var credit = 'NASA/JPL-Caltech, Perseverance' + (im.sol !== undefined && im.sol !== null ? ' sol ' + im.sol : '') + (im.camera ? ', ' + im.camera : '');
    fig.appendChild(h('figcaption', { class: 'ms-cap' }, [
      h('span', { class: 'ms-credit', text: credit }), ' ',
      h('a', { href: RAW_URL, target: '_blank', rel: 'noopener noreferrer', text: 'More raw images', attrs: { 'aria-label': 'More raw images from the Perseverance rover, opens in a new tab' } }),
      im.note ? h('span', { class: 'ms-match', text: String(im.note) }) : null
    ]));
    return fig;
  }
  function cardTask(t) {
    var inS = inScope(t.objective), d = isDone(t.id);
    var cb = h('input', { type: 'checkbox', checked: d, attrs: { 'aria-label': 'Mark ' + t.title + ' as done', 'data-key': 'cc:' + t.id }, onchange: function () { API.setDone(t.id, cb.checked); } });
    return h('li', { class: 'ms-ctask ms-co' + t.objective + (inS ? '' : ' is-off') + (d ? ' is-done' : '') }, [
      h('label', { class: 'ms-cchk' }, [cb]),
      h('div', { class: 'ms-ctext' }, [
        h('p', { class: 'ms-cobj' }, [h('span', { class: 'ms-badge ms-obj ms-o' + t.objective, text: 'O' + t.objective, attrs: { 'aria-hidden': 'true' } }), 'Objective ' + t.objective + ': ' + t.objectiveShort,
          inS ? null : h('em', { class: 'ms-notin', text: 'not in your chosen objective' })]),
        h('h4', { text: t.title }),
        h('p', { class: 'ms-cdesc', text: t.description }),
        h('p', { class: 'ms-cmeta', text: 'About ' + t.estMin + ' min' })
      ])
    ]);
  }
  function fillCard() {
    if (!card || !sel.id) return;
    var m = sel.id === 'base' ? base : stopById[sel.id]; if (!m) return;
    var focusKey = document.activeElement && card.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
    var isBase = m.kind === 'base', title = isBase ? m.title : 'Stop ' + m.n + ' \u00b7 ' + m.title;
    cardTitle.textContent = title; card.setAttribute('aria-label', title);
    while (cardBody.firstChild) cardBody.removeChild(cardBody.firstChild);
    cardBody.appendChild(pictureBlock(m.id));
    cardBody.appendChild(h('p', { class: 'ms-cdesc0', text: m.description || '' }));
    cardBody.appendChild(h('p', { class: 'ms-ccoord', text: coordText(m) }));
    if (isBase) {
      cardBody.appendChild(h('p', { class: 'ms-cnote', text: 'Start and end of the drive. There are no tasks here: all five stops are visited whichever objective you chose.' }));
    } else {
      var ts = tasks.filter(function (t) { return t.stopId === m.id; }), nIn = ts.filter(function (t) { return inScope(t.objective); }).length;
      cardBody.appendChild(h('h3', { class: 'ms-ch', text: 'Tasks at this stop' }));
      cardBody.appendChild(h('p', { class: 'ms-cnote', text: 'One task for each objective. ' + (nIn === 2 ? 'You chose both objectives, so both count.' : 'You chose ' + OBJ_LABEL(choice()) + '; the other task stays here for reference.') }));
      cardBody.appendChild(h('ul', { class: 'ms-ctasks' }, ts.map(cardTask)));
    }
    if (focusKey) { var f = card.querySelector('[data-key="' + focusKey.replace(/["\\]/g, '') + '"]'); if (f) f.focus(); }
  }
  function OBJ_LABEL(c) { return c === 'both' ? 'both objectives' : c === 1 || c === 2 ? 'Objective ' + c + ' (' + (objById[c] ? objById[c].short.toLowerCase() : '') + ')' : 'no objective'; }
  function buildCard() {
    cardTitle = h('h2', { id: 'ms-card-t', class: 'ms-card-t' });
    cardBody = h('div', { class: 'ms-card-b' });
    card = h('section', { id: 'ms-card', class: 'ui ms-card', hidden: true, tabindex: '-1', attrs: { role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ms-card-t' } }, [
      h('div', { class: 'ms-card-h' }, [cardTitle, h('button', { type: 'button', class: 'ms-card-x', attrs: { 'aria-label': 'Close the stop card' }, onclick: function () { closeStop(true); } }, [A.icon ? A.icon('close', 14) : 'x'])]),
      cardBody
    ]);
    document.body.appendChild(card);
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !card || card.hidden || e.defaultPrevented) return;
      if ((A.picking && A.picking()) || document.getElementById('ms-ob-back') || document.querySelector('#sos-back:not([hidden])') || document.querySelector('.lu-back')) return;
      e.preventDefault(); closeStop(true);
    });
    window.addEventListener('resize', function () { if (sel.id) placeCard(); layoutSoon(); });
  }
  /* Placement: on desktop the card docks on the right and the pin is brought to the middle of the free area between the open tab
     panels and the card; on a phone the card is a bottom sheet and the pin goes to the middle of the map above it. Either way the
     card never covers the tapped pin (the pan range is widened by the card's size so even a stop at the map edge can get clear of it). */
  function placeCard() {
    if (!card || card.hidden || !sel.id) return;
    var m = sel.id === 'base' ? base : stopById[sel.id], v = A.view(), phone = phoneNow();
    card.classList.toggle('ms-sheet', phone);
    var cr = card.getBoundingClientRect(), tx, ty;
    if (phone) {
      A.setViewPad && A.setViewPad(0, 0, 0, cr.height + 12);
      tx = v.w / 2; ty = Math.max(130, (218 + (v.h - cr.height)) / 2);
    } else {
      var L = 12;
      [].forEach.call(document.querySelectorAll('.tabpanel'), function (p) { if (!p.hidden) { var r = rectOf(p); if (r && r.left < v.w / 2) L = Math.max(L, r.right + 12); } });
      var Rr = cr.left - 12;
      if (Rr - L < 160) L = 12;
      A.setViewPad && A.setViewPad(0, cr.width + 70, 0, 0);
      tx = (L + Rr) / 2; ty = (68 + v.h - 12) / 2;
    }
    A.focusAt(m.x, m.y, 2.6, tx, ty);
  }
  function openStop(id, o) {
    o = o || {};
    var m = id === 'base' ? base : stopById[id]; if (!m || !card) return;
    var was = sel.id;
    sel.id = id;
    cardOpener = o.opener || (document.activeElement !== document.body ? document.activeElement : null);
    card.hidden = false; fillCard();
    card.scrollTop = 0; cardBody.scrollTop = 0;
    placeCard(); syncStrip(); layoutSoon();
    if (was !== id) { try { card.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    if (o.task) { var cb = card.querySelector('[data-key="cc:' + o.task + '"]'); if (cb) { cb.scrollIntoView({ block: 'nearest' }); cb.focus(); } }
    A.bus.emit('mission:stopopen', { id: id });
  }
  function closeStop(restore) {
    if (!card || card.hidden) return;
    card.hidden = true; sel.id = null;
    A.setViewPad && A.setViewPad(0, 0, 0, 0);
    syncStrip(); layoutSoon();
    if (restore && cardOpener && document.body.contains(cardOpener)) { try { cardOpener.focus(); } catch (e) { /* ignore */ } }
    cardOpener = null;
    A.bus.emit('mission:stopclose', {});
  }
  function goTo(id, pan) {   // an edge chip: bring the pin back into view without changing the zoom
    var m = id === 'base' ? base : stopById[id]; if (!m) return;
    if (sel.id === id) { placeCard(); return; }
    var v = A.view(); A.focusAt(m.x, m.y, 1, v.w / 2, v.h / 2);
    if (pan) layoutSoon();
  }

  /* ---------- selecting a stop, a task or base camp ---------- */
  function find(id) {
    if (id === 'base') return baseView();
    var l = API.list(), r = null; l.forEach(function (m) { if (m.id === id && m.kind !== 'objective') r = m; }); return r;
  }
  function select(id, opener) {
    var m = find(id); if (!m) return;
    if (m.kind === 'stop' || m.kind === 'base') { openStop(m.id, { opener: opener }); return; }
    if (m.kind === 'task') { openStop(m.stopId, { opener: opener, task: m.id }); return; }
    var meta = 'My mission';
    if (m.onMap) meta += ' \u00b7 ' + m.lat.toFixed(4) + '\u00b0N  ' + m.lon.toFixed(4) + '\u00b0E';
    else meta += ' \u00b7 no location';
    meta += isDone(m.id) ? ' \u00b7 done' : '';
    A.setInfo(m.title, m.description || '(no description)', meta);
    if (m.onMap) A.focus(m.x, m.y, 2.6);
  }
  API.open = function (id) { select(id); };   // open the card of a stop, a task (its stop) or base camp, or show a custom mission
  API.closeCard = function () { closeStop(false); };

  /* ---------- Mission tab ---------- */
  var ui = { list: null, prog: null, bar: null, q: '', filter: 'all', open: {}, custIds: {} };
  var form = {};

  function taskMatches(t, q) {
    if (ui.filter === 'todo' && isDone(t.id)) return false;
    if (ui.filter === 'done' && !isDone(t.id)) return false;
    if (!q) return true;
    return [t.title, t.description, t.stopName, t.objectiveShort, 'stop ' + t.stopNo].join(' ').toLowerCase().indexOf(q) >= 0;
  }
  function customMatches(c, q) {
    if (ui.filter === 'todo' && c.done) return false;
    if (ui.filter === 'done' && !c.done) return false;
    return !q || (c.title + ' ' + c.description).toLowerCase().indexOf(q) >= 0;
  }

  function taskRow(t) {
    var cb = h('input', { type: 'checkbox', checked: t.done, attrs: { 'aria-label': 'Mark ' + t.title + ' as done', 'data-key': 'cb:' + t.id }, onchange: function () { API.setDone(t.id, cb.checked); } });
    var go = h('button', { type: 'button', class: 'ms-go', attrs: { 'data-key': 'go:' + t.id, 'aria-label': 'Show the task ' + t.title + ' on the map' }, onclick: function () { select(t.id); } }, [
      h('span', { class: 'ms-badge ms-obj ms-o' + t.objective, text: 'O' + t.objective, attrs: { title: t.objectiveShort } }),
      h('span', { class: 'ms-t' }, [h('b', { text: t.title }), h('small', { text: t.objectiveShort + ' · about ' + t.estMin + ' min' })])
    ]);
    return h('div', { class: 'ms-row ms-task' + (t.done ? ' is-done' : '') }, [h('label', { class: 'ms-chk' }, [cb]), go]);
  }
  function stopBlock(s, ts) {
    var d = isDone(s.id), nd = ts.filter(function (t) { return t.done; }).length;
    var head = h('button', { type: 'button', class: 'ms-go ms-stophead', attrs: { 'data-key': 'go:' + s.id, 'aria-label': 'Show stop ' + s.no + ', ' + s.title + ', on the map' }, onclick: function () { select(s.id); } }, [
      h('span', { class: 'ms-badge ms-multi', text: String(s.no), attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ms-t' }, [h('b', { text: s.title }), h('small', { text: nd + ' of ' + s.scopedTaskIds.length + (s.scopedTaskIds.length === 1 ? ' task done' : ' tasks done') + (d ? ' · stop done' : '') })])
    ]);
    return h('div', { class: 'ms-stop' + (d ? ' is-done' : '') }, [head].concat(ts.map(taskRow)));
  }
  function customRow(m) {
    var cb = h('input', { type: 'checkbox', checked: m.done, attrs: { 'aria-label': 'Mark ' + m.title + ' as done', 'data-key': 'cb:' + m.id }, onchange: function () { API.setDone(m.id, cb.checked); } });
    var go = h('button', { type: 'button', class: 'ms-go', attrs: { 'data-key': 'go:' + m.id, 'aria-label': 'Show ' + m.title + ' on the map' }, onclick: function () { select(m.id); } }, [
      h('span', { class: 'ms-badge ms-custom', text: 'C' + m.no, attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ms-t' }, [h('b', { text: m.title }), h('small', { text: m.onMap ? 'on the map' : 'no location' })])
    ]);
    return h('div', { class: 'ms-row' + (m.done ? ' is-done' : '') }, [h('label', { class: 'ms-chk' }, [cb]), go, delButton(m)]);
  }
  function delButton(m) {
    var armed = false, timer = null;
    var b = h('button', { type: 'button', class: 'ms-del', text: '×', attrs: { 'aria-label': 'Delete mission ' + m.title, 'data-key': 'del:' + m.id } });
    b.onclick = function () {
      if (!armed) {
        armed = true; b.textContent = 'Sure?'; b.classList.add('armed'); b.setAttribute('aria-label', 'Confirm deleting ' + m.title);
        timer = setTimeout(function () { armed = false; b.textContent = '×'; b.classList.remove('armed'); b.setAttribute('aria-label', 'Delete mission ' + m.title); }, 4000);
        return;
      }
      clearTimeout(timer); API.remove(m.id); A.toast('Deleted mission "' + m.title + '"', 'info');
    };
    return b;
  }
  function bar(doneN, totalN, label) {
    var pct = totalN ? Math.round(doneN / totalN * 100) : 0;
    return h('div', { class: 'ms-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(totalN), 'aria-valuenow': String(doneN), 'aria-label': label } }, h('i', { style: 'width:' + pct + '%' }));
  }

  function refresh() {
    if (!ui.list) return;
    var focusKey = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-key') : null;
    var q = ui.q.trim().toLowerCase(), tv = tasks.map(taskView).filter(function (t) { return t.inScope; });   // only the chosen objective(s): 5 or 10 tasks
    var cho = choice();
    ui.obj.textContent = '';
    ui.obj.appendChild(h('span', { class: 'ms-objlab', text: 'Objective:' }));
    ui.obj.appendChild(h('b', { class: 'ms-objval', text: OB && OB.has() ? (cho === 'both' ? 'Both objectives' : 'Objective ' + cho + ', ' + (objById[cho] ? objById[cho].short.toLowerCase() : '')) : 'not chosen yet' }));
    ui.obj.appendChild(h('button', { type: 'button', class: 'ms-btn ms-objchg', text: OB && OB.has() ? 'Change' : 'Choose', attrs: { 'data-key': 'objchg', 'aria-label': 'Change the objective you are fulfilling' }, onclick: function () { openObjective(false); } }));
    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
    // the two objectives, with progress over their 5 tasks
    var objSec = h('section', { class: 'ms-sec' }, [h('h3', { text: 'Objectives' })]);
    objectives.forEach(function (o) {
      if (!inScope(o.id)) return;
      var mine = tv.filter(function (t) { return t.objective === o.id; }), d = mine.filter(function (t) { return t.done; }).length;
      objSec.appendChild(h('div', { class: 'ms-obj-row' }, [
        h('p', { class: 'ms-objt' }, [h('span', { class: 'ms-badge ms-obj ms-o' + o.id, text: 'O' + o.id }), h('b', { text: ' ' + o.title }), h('span', { class: 'ms-n', text: d + ' / ' + mine.length + ' tasks' })]),
        bar(d, mine.length, o.short + ' progress')
      ]));
    });
    ui.list.appendChild(objSec);
    // base camp, then the stops with their tasks
    var stopSec = h('section', { class: 'ms-sec' }, [h('h3', {}, ['Route', h('span', { class: 'ms-n', text: 'base camp + ' + stops.length + ' stops' })])]);
    stopSec.appendChild(h('div', { class: 'ms-row ms-basefix' }, [h('button', { type: 'button', class: 'ms-go', attrs: { 'data-key': 'go:base', 'aria-label': 'Show base camp on the map' }, onclick: function () { select('base'); } }, [
      h('span', { class: 'ms-badge ms-base', text: 'B', attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ms-t' }, [h('b', { text: base.title }), h('small', { text: 'Start and end of the drive' })])])]));
    var shown = 0;
    stops.forEach(function (s) {
      var ts = tv.filter(function (t) { return t.stopId === s.id; }), vis = ts.filter(function (t) { return taskMatches(t, q); });
      if (!vis.length) return;
      shown++; stopSec.appendChild(stopBlock(stopView(s), vis));
    });
    if (!shown) stopSec.appendChild(h('p', { class: 'ms-empty', text: 'No tasks match.' }));
    ui.list.appendChild(stopSec);
    var cv = custom.map(customView), cd = cv.filter(function (c) { return c.done; }).length;
    var cs = h('section', { class: 'ms-sec' }, [h('h3', {}, ['My missions', h('span', { class: 'ms-n', text: cd + ' / ' + cv.length + ' done' })]),
      h('p', { class: 'ms-text', text: 'Missions you added. They are stored only in this browser.' })]);
    var cshow = cv.filter(function (c) { return customMatches(c, q); });
    if (!cshow.length) cs.appendChild(h('p', { class: 'ms-empty', text: cv.length ? 'No missions match.' : 'None yet. Add one below.' }));
    cshow.forEach(function (c) { cs.appendChild(customRow(c)); });
    ui.list.appendChild(cs);
    var nd = tv.filter(function (t) { return t.done; }).length, sd = stops.filter(function (s) { return isDone(s.id); }).length;
    ui.prog.textContent = nd + ' of ' + tv.length + ' tasks done · ' + sd + ' of ' + stops.length + ' stops done' + (cv.length ? ' · ' + cd + ' of ' + cv.length + ' of my missions' : '');
    ui.progBar.style.width = (tv.length ? Math.round(nd / tv.length * 100) : 0) + '%';
    ui.progBox.setAttribute('aria-valuenow', String(nd)); ui.progBox.setAttribute('aria-valuemax', String(tv.length));
    if (focusKey) { var f = ui.root.querySelector('[data-key="' + focusKey.replace(/["\\]/g, '') + '"]'); if (f) f.focus(); }
  }

  /* --- add form --- */
  function picking() { return A.picking && A.picking() === 'mission'; }
  function setPicking(on) {
    if (on && !picking()) {
      A.pick({ owner: 'mission', label: 'mission location', onCancel: syncPick }, function (ev) {
        var q = A.ll(ev.x, ev.y); form.lat.value = q[1].toFixed(5); form.lon.value = q[0].toFixed(5);
        form.picked = { x: ev.x, y: ev.y, lat: form.lat.value, lon: form.lon.value };
        showPending(); form.lat.focus();
      });
    } else if (!on && picking()) A.pick.cancel('mission');
    syncPick();
  }
  function syncPick() {   // follows the shell: also runs on 'pick:changed' when someone else starts a pick
    if (!form.pick) return;
    var on = picking();
    form.pick.setAttribute('aria-pressed', on ? 'true' : 'false');
    form.pick.textContent = on ? 'Click the map… (cancel)' : 'Pick on map';
    form.hint.textContent = on ? 'Click anywhere on the map to set the location. Press Escape to cancel.' : '';
  }
  A.bus.on('pick:changed', syncPick);
  function readLocation() {   // -> {x,y} | null (no location) | {error}
    var a = form.lat.value.trim(), b = form.lon.value.trim();
    if (!a && !b) return null;
    if (!a || !b) return { error: 'Enter both latitude and longitude, or leave both empty.' };
    if (form.picked && form.picked.lat === a && form.picked.lon === b) return { x: form.picked.x, y: form.picked.y };
    var la = Number(a.replace(',', '.')), lo = Number(b.replace(',', '.'));
    if (!isFinite(la) || !isFinite(lo)) return { error: 'Latitude and longitude must be numbers.' };
    var p = A.xy(lo, la);
    if (!inMap(p[0], p[1])) return { error: 'That location is outside the map (latitude ' + A.ll(0, A.H)[1].toFixed(2) + ' to ' + A.ll(0, 0)[1].toFixed(2) + ', longitude ' + A.ll(0, 0)[0].toFixed(2) + ' to ' + A.ll(A.W, 0)[0].toFixed(2) + ').' };
    return { x: p[0], y: p[1] };
  }
  function showPending() {
    if (!form.lat) return;   // the tab has not been opened yet, so there is no form
    while (pend.firstChild) pend.removeChild(pend.firstChild);
    var loc = readLocation();
    if (loc && !loc.error) {
      var g = A.el('g', { class: 'ms-pin ms-custom ms-ghost', transform: 'translate(' + loc.x + ' ' + loc.y + ')' }, pend), k = A.el('g', { class: 'ms-s' }, g);
      A.el('path', { class: 'ms-body', d: PIN }, k);
    }
  }
  function counter(input, max, out) { out.textContent = input.value.length + ' / ' + max; out.classList.toggle('bad', input.value.length > max); }
  function submit(e) {
    e.preventDefault();
    var loc = readLocation(), errs = [];
    if (loc && loc.error) errs.push(loc.error);
    var m = { title: form.title.value, description: form.desc.value };
    if (loc && !loc.error) { m.x = loc.x; m.y = loc.y; }
    errs = API.validate(m).concat(errs);
    form.title.setAttribute('aria-invalid', /Title/.test(errs.join(' ')) ? 'true' : 'false');
    while (form.err.firstChild) form.err.removeChild(form.err.firstChild);
    if (errs.length) {
      errs.forEach(function (t) { form.err.appendChild(h('div', { text: t })); });
      if (form.title.getAttribute('aria-invalid') === 'true') form.title.focus();
      return;
    }
    var c = API.add(m);
    if (!c) { form.err.appendChild(h('div', { text: 'Could not add the mission.' })); return; }
    form.title.value = form.desc.value = form.lat.value = form.lon.value = ''; form.picked = null; form.title.setAttribute('aria-invalid', 'false');
    counter(form.title, MAX_TITLE, form.tn); counter(form.desc, MAX_DESC, form.dn);
    setPicking(false); showPending();
    ui.open.custom = true; refresh();
    A.toast('Mission "' + c.title + '" added' + (c.onMap ? '' : ' (no location)'), 'info');
    form.title.focus();
  }

  function buildForm() {
    form.title = h('input', { type: 'text', id: 'ms-title', maxlength: MAX_TITLE, attrs: { autocomplete: 'off', 'aria-describedby': 'ms-err ms-tn' }, placeholder: 'e.g. Collect a regolith sample' });
    form.tn = h('span', { id: 'ms-tn', class: 'ms-count' });
    form.desc = h('textarea', { id: 'ms-desc', rows: 3, maxlength: MAX_DESC, placeholder: 'Optional details' });
    form.dn = h('span', { class: 'ms-count' });
    form.lat = h('input', { type: 'text', id: 'ms-lat', attrs: { inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Latitude in degrees north' }, placeholder: 'Lat °N' });
    form.lon = h('input', { type: 'text', id: 'ms-lon', attrs: { inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Longitude in degrees east' }, placeholder: 'Lon °E' });
    form.pick = h('button', { type: 'button', class: 'ms-btn', text: 'Pick on map', attrs: { 'aria-pressed': 'false' }, onclick: function () { setPicking(!picking()); } });
    form.clear = h('button', { type: 'button', class: 'ms-btn', text: 'No location', onclick: function () { form.lat.value = form.lon.value = ''; form.picked = null; setPicking(false); showPending(); } });
    form.hint = h('p', { class: 'ms-hint', attrs: { 'aria-live': 'polite' } });
    form.err = h('div', { id: 'ms-err', class: 'ms-err', attrs: { role: 'alert' } });
    form.title.addEventListener('input', function () { counter(form.title, MAX_TITLE, form.tn); });
    form.desc.addEventListener('input', function () { counter(form.desc, MAX_DESC, form.dn); });
    form.lat.addEventListener('input', showPending); form.lon.addEventListener('input', showPending);
    counter(form.title, MAX_TITLE, form.tn); counter(form.desc, MAX_DESC, form.dn);
    var f = h('form', { class: 'ms-form', attrs: { novalidate: '', 'aria-label': 'Add a mission' }, onsubmit: submit }, [
      h('h3', { text: 'Add a mission' }),
      h('label', { for: 'ms-title' }, ['Title ', form.tn]), form.title,
      h('label', { for: 'ms-desc' }, ['Description ', form.dn]), form.desc,
      h('div', { class: 'ms-loc' }, [h('span', { class: 'ms-lbl', text: 'Location (optional)' }),
        h('div', { class: 'ms-latlon' }, [form.lat, form.lon]),
        h('div', { class: 'ms-locbtn' }, [form.pick, form.clear])]),
      form.hint, form.err,
      h('button', { type: 'submit', class: 'ms-add', text: 'Add mission' })
    ]);
    return f;
  }

  /* ---------- objective choice dialog ---------- */
  var obDlg = null, obPrev = null;
  function objCardsData() {
    var t1 = tasks.filter(function (t) { return t.objective === 1; }), t2 = tasks.filter(function (t) { return t.objective === 2; });
    var o1 = objById[1] || { title: 'Objective 1' }, o2 = objById[2] || { title: 'Objective 2' };
    return [
      { v: 1, title: 'Objective 1', sub: o1.title, tasks: t1, note: '5 tasks, one at each stop.' },
      { v: 2, title: 'Objective 2', sub: o2.title, tasks: t2, note: '5 tasks, one at each stop.' },
      { v: 'both', title: 'Both objectives', sub: 'Do the tasks of Objective 1 and Objective 2', tasks: [], note: '10 tasks, two at each stop: all the tasks of both lists.' }
    ];
  }
  function closeObjective(restore) {
    if (!obDlg) return;
    document.removeEventListener('keydown', obKey, true);
    if (obDlg.parentNode) obDlg.parentNode.removeChild(obDlg);
    obDlg = null;
    if (restore && obPrev && document.body.contains(obPrev)) { try { obPrev.focus(); } catch (e) { /* ignore */ } }
  }
  function obKey(e) {
    if (!obDlg) return;
    var required = obDlg.getAttribute('data-required') === '1';
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!required) closeObjective(true); return; }   // a first-run choice must be answered
    if (e.key !== 'Tab') return;
    var f = [].slice.call(obDlg.querySelectorAll('button:not([disabled])'));
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !obDlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !obDlg.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  }
  function openObjective(required) {
    if (obDlg || !OB) return;
    obPrev = document.activeElement;
    var cur = OB.get(), cards = objCardsData(), firstBtn = null;
    var grid = h('div', { class: 'ms-ob-grid', attrs: { role: 'group', 'aria-labelledby': 'ms-ob-t' } });
    cards.forEach(function (c) {
      var on = cur === c.v;
      var b = h('button', { type: 'button', class: 'ms-ob-card' + (on ? ' is-on' : ''), attrs: { 'aria-pressed': on ? 'true' : 'false', 'data-choice': String(c.v) }, onclick: function () {
        OB.set(c.v); closeObjective(!required); Atlas.toast('Your objective: ' + (c.v === 'both' ? 'both objectives' : 'Objective ' + c.v) + '. ' + (c.v === 'both' ? '10' : '5') + ' tasks.', 'info');
      } }, [
        h('span', { class: 'ms-ob-t', text: c.title }),
        h('span', { class: 'ms-ob-s', text: c.sub }),
        c.tasks.length ? h('ul', { class: 'ms-ob-l' }, c.tasks.map(function (t) { return h('li', { text: 'Stop ' + t.stopNo + ': ' + t.title }); })) : h('span', { class: 'ms-ob-l' }, [h('span', { text: 'Every stop has two tasks, one of each objective.' })]),
        h('span', { class: 'ms-ob-n', text: c.note })
      ]);
      if (!firstBtn || on) firstBtn = firstBtn && !on ? firstBtn : b;
      grid.appendChild(b);
    });
    var dlg = h('div', { class: 'ms-ob-dlg', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'ms-ob-t', 'aria-describedby': 'ms-ob-d' } }, [
      h('h2', { id: 'ms-ob-t', text: 'Choose your objective' }),
      h('p', { id: 'ms-ob-d', text: required ? 'Which objective do you want to fulfil on this mission? Pick one to continue. You will visit all five stops whichever you choose, and you can change your choice later from the Mission tab.' : 'Which objective do you want to fulfil? Tasks you already finished stay finished. All five stops are visited whichever you choose.' }),
      grid,
      required ? null : h('div', { class: 'ms-ob-act' }, [h('button', { type: 'button', class: 'ms-btn', text: 'Cancel', onclick: function () { closeObjective(true); } })])
    ]);
    obDlg = h('div', { id: 'ms-ob-back', class: 'ui', attrs: { 'data-required': required ? '1' : '0' } }, [dlg]);
    document.body.appendChild(obDlg);
    document.addEventListener('keydown', obKey, true);
    try { firstBtn.focus(); } catch (e) { /* ignore */ }
  }
  API.chooseObjective = function () { openObjective(false); };
  /* first run (or a crew member with no choice yet): ask, and keep asking until answered. It waits for the room dialog of the link first. */
  (function () {
    if (!OB) return;
    var idle = 0;
    function check() {
      if (obDlg) return;
      if (!OB.pending()) { idle = 0; return; }
      if (document.querySelector('.lu-back')) { idle = 0; return; }
      var L = window.JdaLink;
      if (L && !(L.room && !L.room.implicit) && idle < 3) { idle++; return; }   // the room dialog may not have opened yet
      openObjective(true);
    }
    setInterval(check, 500);
    OB.on(function () { if (obDlg && obDlg.getAttribute('data-required') === '1') closeObjective(false); });   // answered elsewhere (another page of this crew)
  })();

  A.registerTab({
    id: 'mission', title: 'Mission', icon: 'mission', order: 10,
    render: function (container) {
      ui.root = container; container.classList.add('ms-tab');
      ui.prog = h('p', { class: 'ms-prog' });
      ui.progBar = h('i');
      ui.progBox = h('div', { class: 'ms-bar big', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuenow': '0', 'aria-valuemax': '0', 'aria-label': 'Tasks done' } }, ui.progBar);
      ui.obj = h('div', { class: 'ms-objctl' });
      var search = h('input', { type: 'search', class: 'ms-search', placeholder: 'Search tasks (title, stop, objective)', attrs: { 'aria-label': 'Search tasks' }, oninput: function () { ui.q = search.value; refresh(); } });
      var filt = h('select', { class: 'ms-filter', attrs: { 'aria-label': 'Filter tasks by status' }, onchange: function () { ui.filter = filt.value; refresh(); } }, [
        h('option', { value: 'all', text: 'All' }), h('option', { value: 'todo', text: 'Not done' }), h('option', { value: 'done', text: 'Done' })]);
      ui.list = h('div', { class: 'ms-list' });
      var legend = h('p', { class: 'ms-legend' }, [h('span', {}, [h('i', { class: 'ms-sw ms-multi' }), 'Stop (numbered 1 to 5)']), h('span', {}, [h('i', { class: 'ms-sw ms-base' }), 'Base camp']),
        h('span', {}, [h('i', { class: 'ms-sw ms-custom' }), 'My mission'])]);
      container.appendChild(h('div', {}, [
        ui.obj,
        h('p', { class: 'ms-intro', text: 'Jezero Pathfinder: drive the pressurised rover from base camp to five stops, get out on foot at each one, then drive back. Every stop has one task for each objective; you do the ones of the objective you chose. Tick a task when it is done.' }),
        ui.prog, ui.progBox, legend,
        h('div', { class: 'ms-tools' }, [search, filt]),
        ui.list, buildForm()
      ]));
      refresh();
    }
  });

  A.bus.on('missions:changed', function () { drawPins(); refresh(); showPending(); syncStrip(); if (sel.id) fillCard(); });
  buildCard(); buildStrip(); buildEdges(); drawPins(); syncStrip();
  if (A.onView) A.onView(layoutSoon);
  ['tab:toggled', 'layer:changed', 'pick:changed'].forEach(function (n) { A.bus.on(n, function () { setTimeout(layoutSoon, 60); }); });   // panels, legends and the picking bar change what is visible
  setInterval(layoutSoon, 1500);   // catches anything else that opens over the map (science legends, dialogs)
  // the pins, strip and card follow the objective: tasks of the other objective stay in the data but leave the lists, counts, plan and run
  if (OB) OB.on(function () {
    runLast = -1; saveRun();   // the scope changed: do not mistake the next, smaller or larger run count for a restart
    changed('objective');
  });
})();
