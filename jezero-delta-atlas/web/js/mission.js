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
  function isDone(id) {
    var s = stopById[id];
    if (s) return s.taskIds.length > 0 && s.taskIds.every(function (t) { return !!done[t]; });   // a stop is visited when both its tasks are done
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
    o.objectives = s.objectives.slice(); o.taskIds = s.taskIds.slice(); o.done = isDone(s.id); return o;
  }
  function taskView(t) { var o = {}; Object.keys(t).forEach(function (k) { o[k] = t[k]; }); o.done = isDone(t.id); return o; }
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
    tasks: function () { return tasks.map(taskView); },
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
      var s = stopById[id], ids = s ? s.taskIds : (taskById[id] || custom.some(function (c) { return c.id === id; })) ? [id] : null;
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
     tasks (mission order, 2 per stop) are marked done here, so the Mission tab, Planner and schedule show them as done.
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
    n = Math.max(0, Math.min(tasks.length, Math.floor(Number(n)) || 0));
    var chg = false;
    if (n < runLast) {
      tasks.forEach(function (t) { if (runMarked[t.id] && done[t.id]) { delete done[t.id]; chg = true; } });
      runHandled = {}; runMarked = {};
    }
    runLast = n;
    for (var i = 0; i < n; i++) {
      var id = tasks[i].id;
      if (runHandled[id]) continue;
      runHandled[id] = true;
      if (!done[id]) { done[id] = true; runMarked[id] = true; chg = true; }
    }
    saveRun();
    if (chg) { save(); changed('run'); }
  }
  var setDoneUser = API.setDone;
  API.setDone = function (id, flag) {
    var s = stopById[id], ids = s ? s.taskIds : [id];
    ids.forEach(function (k) { delete runMarked[k]; });
    saveRun();
    return setDoneUser(id, flag);
  };
  if (window.JdaWorld && typeof window.JdaWorld.on === 'function') window.JdaWorld.on(function () {
    var W = window.JdaWorld, me = null;
    if (W.source !== 'authority') return;
    try { me = W.me(); } catch (e) { me = null; }
    if (me && me.progress && isFinite(Number(me.progress.done))) applyRun(me.progress.done);
  });

  /* ---------- pin layer ---------- */
  var layer = A.el('g', { class: 'ms-layer' });
  var pend = A.el('g', { class: 'ms-pending' }, layer);   // preview pin while picking a location
  var pinsG = A.el('g', {}, layer);
  var PIN = 'M0,0 C-3,-8 -11,-13 -11,-20 A11,11 0 1 1 11,-20 C11,-13 3,-8 0,0Z';
  var HOME = 'M0,0 L-9,-9 L-9,-20 L0,-27 L9,-20 L9,-9Z';   // base camp: a house-shaped marker, the tip is the point

  function pinLabel(s) {
    if (s.kind === 'base') return s.title + ', start and end of the drive';
    if (s.kind === 'custom') return s.title + ' (my mission)' + (isDone(s.id) ? ', done' : '');
    return 'Stop ' + s.no + ': ' + s.title + ', 2 tasks' + (isDone(s.id) ? ', done' : '');
  }
  function makePin(s, text, parent) {
    var cls = s.kind === 'custom' ? 'ms-custom' : s.kind === 'base' ? 'ms-base' : 'ms-multi';
    var g = A.el('g', { class: 'ms-pin hit ' + cls + (s.kind !== 'base' && isDone(s.id) ? ' ms-done' : ''), transform: 'translate(' + s.x + ' ' + s.y + ')', tabindex: '0', role: 'button', 'aria-label': pinLabel(s), 'data-id': s.id }, parent);
    var k = A.el('g', { class: 'ms-s' }, g);
    A.el('path', { class: 'ms-body', d: s.kind === 'base' ? HOME : PIN }, k);
    var t = A.el('text', { class: 'ms-num', x: 0, y: s.kind === 'base' ? -12.5 : -16.5, 'text-anchor': 'middle' }, k); t.textContent = text;
    if (s.kind !== 'base' && isDone(s.id)) { A.el('circle', { class: 'ms-tick', cx: 9, cy: -6, r: 5 }, k); A.el('path', { class: 'ms-tickp', d: 'M6.2 -6 L8.4 -3.8 L12 -8.2' }, k); }
    var lab = A.el('text', { class: 'ms-lab', x: 15, y: -14 }, k); lab.textContent = s.title;
    g.addEventListener('click', function (e) { if (A.pick.busy()) return; e.stopPropagation(); select(s.id); });
    g.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !A.pick.busy()) { e.preventDefault(); select(s.id); } });
    return g;
  }
  function drawPins() {
    while (pinsG.firstChild) pinsG.removeChild(pinsG.firstChild);
    makePin(base, 'B', pinsG);
    stops.forEach(function (s) { if (s.onMap) makePin(s, String(s.no), pinsG); });
    custom.forEach(function (c, i) { var v = customView(c, i); if (v.onMap) makePin(v, 'C' + (i + 1), pinsG); });
  }

  A.registerLayer({
    id: 'mission-stops', label: 'Base camp and mission stops', group: 'Mission', color: '#c4501b', node: layer, on: true,
    count: stops.length
  });

  /* ---------- selecting a stop, a task or base camp ---------- */
  function find(id) {
    if (id === 'base') return baseView();
    var l = API.list(), r = null; l.forEach(function (m) { if (m.id === id && m.kind !== 'objective') r = m; }); return r;
  }
  function taskLine(t) { return t.objectiveShort + ': ' + t.title + ' (about ' + t.estMin + ' min)'; }
  function select(id) {
    var m = find(id); if (!m) return;
    var text = m.description || '(no description)', meta;
    if (m.kind === 'stop') {
      var ts = tasks.filter(function (t) { return t.stopId === m.id; });
      text += ' Tasks: ' + ts.map(taskLine).join('. ') + '.';
      meta = 'Mission stop ' + m.no;
    } else if (m.kind === 'task') {
      text = m.description + ' About ' + m.estMin + ' min.';
      meta = 'Stop ' + m.stopNo + ', ' + m.stopName + ' · ' + m.objectiveShort;
    } else if (m.kind === 'base') meta = 'Base camp, start and end of the drive';
    else meta = 'My mission';
    if (m.onMap) meta += ' · ' + m.lat.toFixed(4) + '°N  ' + m.lon.toFixed(4) + '°E';
    else if (m.kind === 'custom') meta += ' · no location';
    meta += m.kind !== 'base' && isDone(m.id) ? ' · done' : '';
    A.setInfo(m.kind === 'stop' ? 'Stop ' + m.no + ' · ' + m.title : m.title, text, meta);
    if (m.onMap) A.focus(m.x, m.y, 2.6);
  }

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
      h('span', { class: 'ms-t' }, [h('b', { text: s.title }), h('small', { text: nd + ' of ' + s.taskIds.length + ' tasks done' + (d ? ' · stop done' : '') })])
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
    var q = ui.q.trim().toLowerCase(), tv = tasks.map(taskView);
    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
    // the two objectives, with progress over their 5 tasks
    var objSec = h('section', { class: 'ms-sec' }, [h('h3', { text: 'Objectives' })]);
    objectives.forEach(function (o) {
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

  A.registerTab({
    id: 'mission', title: 'Mission', icon: 'mission', order: 10,
    render: function (container) {
      ui.root = container; container.classList.add('ms-tab');
      ui.prog = h('p', { class: 'ms-prog' });
      ui.progBar = h('i');
      ui.progBox = h('div', { class: 'ms-bar big', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuenow': '0', 'aria-valuemax': '0', 'aria-label': 'Visited stops' } }, ui.progBar);
      var search = h('input', { type: 'search', class: 'ms-search', placeholder: 'Search tasks (title, stop, objective)', attrs: { 'aria-label': 'Search tasks' }, oninput: function () { ui.q = search.value; refresh(); } });
      var filt = h('select', { class: 'ms-filter', attrs: { 'aria-label': 'Filter tasks by status' }, onchange: function () { ui.filter = filt.value; refresh(); } }, [
        h('option', { value: 'all', text: 'All' }), h('option', { value: 'todo', text: 'Not done' }), h('option', { value: 'done', text: 'Done' })]);
      ui.list = h('div', { class: 'ms-list' });
      var legend = h('p', { class: 'ms-legend' }, [h('span', {}, [h('i', { class: 'ms-sw ms-multi' }), 'Stop (numbered 1 to 5)']), h('span', {}, [h('i', { class: 'ms-sw ms-base' }), 'Base camp']),
        h('span', {}, [h('i', { class: 'ms-sw ms-custom' }), 'My mission'])]);
      container.appendChild(h('div', {}, [
        h('p', { class: 'ms-intro', text: 'Jezero Pathfinder: drive the pressurised rover from base camp to five stops, get out on foot at each one, then drive back. At every stop there are two tasks, one for each objective. Tick a task when it is done.' }),
        ui.prog, ui.progBox, legend,
        h('div', { class: 'ms-tools' }, [search, filt]),
        ui.list, buildForm()
      ]));
      refresh();
    }
  });

  A.bus.on('missions:changed', function () { drawPins(); refresh(); showPending(); });
  drawPins();
})();
