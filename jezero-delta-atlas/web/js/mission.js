/* Mission feature: stops (from docs/mission-guide.md via data/mission-data.js), pin layer 'mission-stops',
   Mission tab, user-added missions, and the Atlas.missions API (see docs/ARCHITECTURE.md). */
(function () {
  'use strict';
  var A = window.Atlas, D = window.JEZERO_MISSION;
  if (!A || !D) { if (window.console) console.error('mission.js needs atlas-shell.js and data/mission-data.js'); return; }
  var h = A.h, SRC = 'docs/mission-guide.md';
  var MAX_TITLE = 80, MAX_DESC = 500, MAX_CUSTOM = 200;
  var NS = 'http://www.w3.org/2000/svg';

  /* ---------- positions: taken from Atlas.mapData (the exact values the sample and place layers draw) ----------
     mapData x,y are true page pixels even when onMap is false (outside the current map). */
  var PLACE_KEY = { 'place-landing': 'landing', 'place-hawksbill-gap': 'hawks', 'place-three-forks': 'three',
    'place-neretva-vallis': 'neretva', 'place-witch-hazel-hill': 'whh', 'place-seitah': 'seitah' };
  var MD = A.mapData || { samples: [], places: [] };
  function mdSample(n) { for (var i = 0; i < MD.samples.length; i++) if (MD.samples[i].n === n) return MD.samples[i]; return null; }
  function mdPlace(key) { for (var i = 0; i < MD.places.length; i++) if (MD.places[i].id === key) return MD.places[i]; return null; }
  function inMap(x, y) { return x >= 0 && x <= A.W && y >= 0 && y <= A.H; }

  /* ---------- state ---------- */
  var objectives = D.objectives || [];
  var objIndex = {}; objectives.forEach(function (o, i) { objIndex[o.id] = i + 1; });
  var done = A.store.get('mission.done', {}); if (!done || typeof done !== 'object' || Array.isArray(done)) done = {};
  var custom = A.store.get('mission.custom', []); if (!Array.isArray(custom)) custom = [];
  custom = custom.filter(function (c) { return c && typeof c.id === 'string' && typeof c.title === 'string'; });
  var seq = Number(A.store.get('mission.seq', 0)) || 0;
  custom.forEach(function (c) { var n = parseInt(String(c.id).replace('custom-', ''), 10); if (n > seq) seq = n; });

  var stops = [];
  (D.stops || []).forEach(function (s) {
    var p = null, num = parseInt(s.id.replace('sample-', ''), 10) || s.no, md = null;
    if (s.kind === 'sample') md = mdSample(num); else md = mdPlace(PLACE_KEY[s.id]);
    if (md) p = [md.x, md.y];
    else if (typeof s.lat === 'number' && typeof s.lon === 'number') p = A.xy(s.lon, s.lat);   // a stop added to the guide with its own position
    var hasPos = !!p, on = hasPos && inMap(p[0], p[1]), q = hasPos ? A.ll(p[0], p[1]) : null;
    var approx = s.kind === 'sample' || (s.id !== 'place-landing' && !(typeof s.lat === 'number'));
    stops.push({
      id: s.id, no: s.no, name: s.name, sub: s.kind, area: s.area, sol: s.sol, date: s.date, objectives: s.objectives || [],
      title: s.kind === 'sample' ? 'Sample ' + num + ' · ' + s.name : s.name,
      kind: 'stop', description: s.description, x: on ? p[0] : null, y: on ? p[1] : null, lat: q ? q[1] : null, lon: q ? q[0] : null,
      source: SRC, onMap: on, hasPos: hasPos, approx: approx, px: hasPos ? p[0] : null, py: hasPos ? p[1] : null
    });
  });

  function save() { A.store.set('mission.done', done); A.store.set('mission.custom', custom); A.store.set('mission.seq', seq); }
  function changed(reason, id) { A.bus.emit('missions:changed', { reason: reason, id: id || null }); }
  function isDone(id) { return !!done[id]; }

  function customView(c, i) {
    var hasPos = typeof c.x === 'number' && typeof c.y === 'number', q = hasPos ? A.ll(c.x, c.y) : null;
    return {
      id: c.id, title: c.title, kind: 'custom', description: c.description || '', x: hasPos ? c.x : null, y: hasPos ? c.y : null,
      lat: q ? q[1] : null, lon: q ? q[0] : null, source: 'user', done: isDone(c.id), no: i + 1, onMap: hasPos
    };
  }
  function stopView(s) {
    var o = {}; Object.keys(s).forEach(function (k) { o[k] = s[k]; });
    o.objectives = s.objectives.slice(); o.done = isDone(s.id); return o;
  }

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

  var API = A.missions = {
    list: function () {
      var out = objectives.map(function (o) {
        return { id: o.id, title: o.title, kind: 'objective', description: o.text, x: null, y: null, lat: null, lon: null, source: SRC };
      });
      return out.concat(stops.map(stopView), custom.map(customView));
    },
    stops: function () { return stops.map(stopView); },
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
      var known = stops.some(function (s) { return s.id === id; }) || custom.some(function (c) { return c.id === id; });
      if (!known) return false;
      if (flag) done[id] = true; else delete done[id];
      save(); changed('done', id); return true;
    },
    isDone: isDone
  };

  /* ---------- pin layer ---------- */
  var layer = A.el('g', { class: 'ms-layer' });
  var pend = A.el('g', { class: 'ms-pending' }, layer);   // preview pin while picking a location
  var pinsG = A.el('g', {}, layer);
  var PIN = 'M0,0 C-3,-8 -11,-13 -11,-20 A11,11 0 1 1 11,-20 C11,-13 3,-8 0,0Z';

  function objClass(s) {
    if (s.kind === 'custom') return 'ms-custom';
    var n = s.objectives.length;
    return n === 0 ? 'ms-none' : n > 1 ? 'ms-multi' : 'ms-o' + (((objIndex[s.objectives[0]] || 1) - 1) % 4 + 1);
  }
  function objNames(s) { return s.objectives.map(function (id) { return 'Objective ' + objIndex[id]; }).join(', '); }
  function pinLabel(s) { return s.title + (s.kind === 'custom' ? ' (my mission)' : ' (' + (objNames(s) || 'no objective') + ')') + (s.approx ? ', approximate position' : '') + (isDone(s.id) ? ', visited' : ''); }

  function makePin(s, text, parent) {
    var g = A.el('g', { class: 'ms-pin hit ' + objClass(s) + (isDone(s.id) ? ' ms-done' : '') + (s.approx ? ' ms-approx' : ''), transform: 'translate(' + s.x + ' ' + s.y + ')', tabindex: '0', role: 'button', 'aria-label': pinLabel(s), 'data-id': s.id }, parent);
    var k = A.el('g', { class: 'ms-s' }, g);
    A.el('path', { class: 'ms-body', d: PIN }, k);
    var t = A.el('text', { class: 'ms-num', x: 0, y: -16.5, 'text-anchor': 'middle' }, k); t.textContent = text;
    if (isDone(s.id)) { A.el('circle', { class: 'ms-tick', cx: 9, cy: -6, r: 5 }, k); var c = A.el('text', { class: 'ms-tickt', x: 9, y: -3, 'text-anchor': 'middle' }, k); c.textContent = '✓'; }
    var lab = A.el('text', { class: 'ms-lab', x: 15, y: -14 }, k); lab.textContent = s.title;
    g.addEventListener('click', function (e) { if (A.pick.busy()) return; e.stopPropagation(); select(s.id); });
    g.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !A.pick.busy()) { e.preventDefault(); select(s.id); } });
    return g;
  }
  function drawPins() {
    while (pinsG.firstChild) pinsG.removeChild(pinsG.firstChild);
    var n = 0;
    stops.forEach(function (s) { if (s.onMap) makePin(s, String(s.no), pinsG); });
    custom.forEach(function (c, i) { var v = customView(c, i); if (v.onMap) makePin(v, 'C' + (i + 1), pinsG); });
  }

  /* ---------- edge markers for stops outside the map ---------- */
  var KM_PER_DEG = 59.27;   // Mars, 3396 km radius (same constant atlas-map.js uses for its scale bar)
  var DIRS = ['east', 'southeast', 'south', 'southwest', 'west', 'northwest', 'north', 'northeast'];
  function dirName(dx, dy) { var a = Math.atan2(dy, dx), i = Math.round(a / (Math.PI / 4)); return DIRS[(i + 8) % 8]; }
  function kmBetween(x1, y1, x2, y2) {
    var a = A.ll(x1, y1), b = A.ll(x2, y2), dl = (b[0] - a[0]) * Math.cos((a[1] + b[1]) / 2 * Math.PI / 180) * KM_PER_DEG, dp = (b[1] - a[1]) * KM_PER_DEG;
    return Math.sqrt(dl * dl + dp * dp);
  }
  function fmtKm(k) { return k < 10 ? (Math.round(k * 10) / 10) + '' : Math.round(k) + ''; }
  var EDGE_INSET = 30, CLUSTER = 70;   // page px
  function edgePoint(px, py) {   // where the line from the map centre to the stop leaves the map, pulled EDGE_INSET inside
    var cx = A.W / 2, cy = A.H / 2, dx = px - cx, dy = py - cy;
    var t = Math.min(dx ? (A.W / 2 - EDGE_INSET) / Math.abs(dx) : Infinity, dy ? (A.H / 2 - EDGE_INSET) / Math.abs(dy) : Infinity);
    return { x: cx + dx * t, y: cy + dy * t, ang: Math.atan2(dy, dx), dir: dirName(dx, dy) };
  }
  var edges = [];   // [{x,y,ang,dir,members:[stop]}]
  (function () {
    stops.forEach(function (s) {
      if (s.onMap || !s.hasPos) return;
      var e = edgePoint(s.px, s.py), hit = null;
      edges.forEach(function (c) { if (!hit && Math.hypot(c.x - e.x, c.y - e.y) < CLUSTER) hit = c; });
      if (hit) { hit.members.push(s); if (hit.dir !== e.dir) hit.dir = dirName(hit.mx, hit.my); } else { e.members = [s]; e.mx = s.px - A.W / 2; e.my = s.py - A.H / 2; edges.push(e); }
    });
    edges.forEach(function (c) {
      var d = c.members.map(function (m) { return kmBetween(c.x, c.y, m.px, m.py); });
      c.minKm = Math.min.apply(null, d); c.maxKm = Math.max.apply(null, d); c.i = -1;
    });
  })();
  function edgeLabel(c) {
    var n = c.members.length, km = n === 1 ? 'about ' + fmtKm(c.minKm) + ' km' : 'about ' + fmtKm(c.minKm) + ' to ' + fmtKm(c.maxKm) + ' km';
    return (n === 1 ? c.members[0].title : n + ' stops (' + c.members.map(function (m) { return m.no; }).join(', ') + ')') + ', outside the map, ' + km + ' ' + c.dir + ' of the map edge';
  }
  function selectEdge(c) {
    if (A.pick.busy()) return;
    c.i = (c.i + 1) % c.members.length;
    var m = c.members[c.i];
    select(m.id);
    if (c.members.length > 1) {
      var meta = document.querySelector('#info .meta');
      A.setInfo(m.title, document.querySelector('#info p').textContent, 'Marker ' + (c.i + 1) + ' of ' + c.members.length + ': ' + c.members.length + ' stops outside the map to the ' + c.dir + '. Click the marker again for the next one. ' + (meta ? meta.textContent : ''));
    }
  }
  function drawEdges() {
    while (edgeG.firstChild) edgeG.removeChild(edgeG.firstChild);
    edges.forEach(function (c) {
      var n = c.members.length, g = A.el('g', { class: 'ms-edge hit', transform: 'translate(' + c.x + ' ' + c.y + ')', tabindex: '0', role: 'button', 'aria-label': edgeLabel(c) }, edgeG);
      var k = A.el('g', { class: 'ms-s' }, g);
      A.el('polygon', { class: 'ms-arrow', points: '19,0 11,-7 11,7', transform: 'rotate(' + (c.ang * 180 / Math.PI) + ')' }, k);
      A.el('circle', { class: 'ms-edgec', r: 11 }, k);
      var t = A.el('text', { class: 'ms-num', x: 0, y: 4, 'text-anchor': 'middle' }, k); t.textContent = n === 1 ? String(c.members[0].no) : String(n);
      var lab = A.el('text', { class: 'ms-lab', x: 0, y: -16, 'text-anchor': 'middle' }, k); lab.textContent = n === 1 ? c.members[0].title : n + ' stops ' + c.dir;
      g.addEventListener('click', function (e) { if (A.pick.busy()) return; e.stopPropagation(); selectEdge(c); });
      g.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !A.pick.busy()) { e.preventDefault(); selectEdge(c); } });
    });
  }
  var edgeG = A.el('g', { class: 'ms-edges' }, layer);
  drawEdges();

  A.registerLayer({
    id: 'mission-stops', label: 'Mission stops', group: 'Mission', color: '#c4501b', node: layer, on: true,
    count: stops.filter(function (s) { return s.hasPos; }).length
  });

  /* ---------- selecting a stop ---------- */
  function find(id) {
    var l = API.list(), r = null; l.forEach(function (m) { if (m.id === id && m.kind !== 'objective') r = m; }); return r;
  }
  function select(id) {
    var m = find(id); if (!m) return;
    var text = m.description || '(no description)';
    if (m.kind === 'stop') {
      if (m.sol !== null) text += ' Sealed on sol ' + m.sol + (m.date ? ' (' + m.date + ')' : '') + '.';
      text += ' Area: ' + m.area + '. Serves: ' + (objNames(m) || 'no listed objective') + '.';
      if (m.approx) text += m.sub === 'sample' ? ' Position approximate: placed by area, not the true sample location.' : ' Position approximate.';
    }
    var meta = m.kind === 'custom' ? 'My mission' : 'Mission stop ' + m.no;
    if (m.onMap) meta += ' · ' + m.lat.toFixed(4) + '°N  ' + m.lon.toFixed(4) + '°E';
    else if (m.kind === 'custom') meta += ' · no location';
    else {
      meta += ' · outside current map';
      if (m.hasPos) { var e = edgePoint(m.px, m.py); meta += ' (about ' + fmtKm(kmBetween(e.x, e.y, m.px, m.py)) + ' km ' + e.dir + ' of the map edge)'; }
    }
    if (m.approx && m.onMap) meta += ' · approximate';
    meta += isDone(m.id) ? ' · visited' : '';
    A.setInfo(m.title, text, meta);
    if (m.onMap) A.focus(m.x, m.y, 2.6);
  }

  /* ---------- Mission tab ---------- */
  var ui = { list: null, prog: null, bar: null, q: '', filter: 'all', open: {}, custIds: {} };
  var form = {};

  function stopMatches(s, q) {
    if (ui.filter === 'todo' && isDone(s.id)) return false;
    if (ui.filter === 'done' && !isDone(s.id)) return false;
    if (!q) return true;
    var hay = [s.title, s.name, s.area, s.description, s.date || '', s.sol !== null ? 'sol ' + s.sol : '', s.onMap ? '' : 'outside current map'].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function customMatches(c, q) {
    if (ui.filter === 'todo' && c.done) return false;
    if (ui.filter === 'done' && !c.done) return false;
    return !q || (c.title + ' ' + c.description).toLowerCase().indexOf(q) >= 0;
  }

  function row(m, isCustom) {
    var cb = h('input', { type: 'checkbox', checked: m.done, attrs: { 'aria-label': 'Mark ' + m.title + ' as visited', 'data-key': 'cb:' + m.id }, onchange: function () { API.setDone(m.id, cb.checked); } });
    var sub = [];
    if (isCustom) sub.push(m.onMap ? 'on the map' : 'no location');
    else {
      sub.push(m.area);
      if (m.sol !== null) sub.push('sol ' + m.sol);
      if (!m.onMap) sub.push('outside current map');
    }
    var go = h('button', { type: 'button', class: 'ms-go', attrs: { 'data-key': 'go:' + m.id, 'aria-label': 'Show ' + m.title + ' on the map' }, onclick: function () { select(m.id); } }, [
      h('span', { class: 'ms-badge ' + objClass(m) + (m.onMap ? '' : ' ms-off'), text: isCustom ? 'C' + m.no : String(m.no), attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: 'ms-t' }, [h('b', { text: m.title }), h('small', { text: sub.join(' · ') })])
    ]);
    var kids = [h('label', { class: 'ms-chk' }, [cb]), go];
    if (isCustom) kids.push(delButton(m));
    return h('div', { class: 'ms-row' + (m.done ? ' is-done' : '') }, kids);
  }
  function delButton(m) {
    var armed = false, timer = null;
    var b = h('button', { type: 'button', class: 'ms-del', text: '✕', attrs: { 'aria-label': 'Delete mission ' + m.title, 'data-key': 'del:' + m.id } });
    b.onclick = function () {
      if (!armed) {
        armed = true; b.textContent = 'Sure?'; b.classList.add('armed'); b.setAttribute('aria-label', 'Confirm deleting ' + m.title);
        timer = setTimeout(function () { armed = false; b.textContent = '✕'; b.classList.remove('armed'); b.setAttribute('aria-label', 'Delete mission ' + m.title); }, 4000);
        return;
      }
      clearTimeout(timer); API.remove(m.id); A.toast('Deleted mission "' + m.title + '"', 'info');
    };
    return b;
  }

  function section(key, head, text, items, doneN, totalN, builder, emptyText) {
    var q = ui.q, forced = !!q || ui.filter !== 'all';
    var det = h('details', { class: 'ms-det', attrs: { 'data-sec': key } }, [
      h('summary', {}, ['Stops ', h('span', { class: 'ms-n', text: items.length === totalN ? String(totalN) : items.length + ' of ' + totalN })])
    ]);
    det.open = forced || !!ui.open[key];
    det.addEventListener('toggle', function () { if (!forced) ui.open[key] = det.open; });
    if (!items.length) det.appendChild(h('p', { class: 'ms-empty', text: emptyText }));
    items.forEach(function (it) { det.appendChild(builder(it)); });
    var pct = totalN ? Math.round(doneN / totalN * 100) : 0;
    return h('section', { class: 'ms-sec' }, [
      h('h3', {}, [head, h('span', { class: 'ms-n', text: doneN + ' / ' + totalN + ' visited' })]),
      text ? h('p', { class: 'ms-text', text: text }) : null,
      h('div', { class: 'ms-bar', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(totalN), 'aria-valuenow': String(doneN), 'aria-label': head + ' progress' } }, h('i', { style: 'width:' + pct + '%' })),
      det
    ]);
  }

  function refresh() {
    if (!ui.list) return;
    var focusKey = document.activeElement && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-key') : null;
    var q = ui.q.trim().toLowerCase(), views = stops.map(stopView);
    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
    objectives.forEach(function (o) {
      var all = views.filter(function (s) { return s.objectives.indexOf(o.id) >= 0; });
      var d = all.filter(function (s) { return s.done; }).length;
      ui.list.appendChild(section(o.id, o.title, o.text, all.filter(function (s) { return stopMatches(s, q); }), d, all.length, function (s) { return row(s, false); }, 'No stops match.'));
    });
    var loose = views.filter(function (s) { return !s.objectives.length; });
    if (loose.length) {
      var dl = loose.filter(function (s) { return s.done; }).length;
      ui.list.appendChild(section('other', 'Other stops', 'Stops with no listed objective.', loose.filter(function (s) { return stopMatches(s, q); }), dl, loose.length, function (s) { return row(s, false); }, 'No stops match.'));
    }
    var cv = custom.map(customView), cd = cv.filter(function (c) { return c.done; }).length;
    ui.list.appendChild(section('custom', 'My missions', 'Missions you added. They are stored only in this browser.', cv.filter(function (c) { return customMatches(c, q); }), cd, cv.length, function (c) { return row(c, true); }, cv.length ? 'No missions match.' : 'None yet. Add one below.'));
    var nd = views.filter(function (s) { return s.done; }).length;
    ui.prog.textContent = 'Visited ' + nd + ' of ' + views.length + ' stops' + (cv.length ? ' · ' + cd + ' of ' + cv.length + ' of my missions' : '');
    ui.progBar.style.width = (views.length ? Math.round(nd / views.length * 100) : 0) + '%';
    ui.progBox.setAttribute('aria-valuenow', String(nd)); ui.progBox.setAttribute('aria-valuemax', String(views.length));
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
    id: 'mission', title: 'Mission', icon: '🎯', order: 10,
    render: function (container) {
      ui.root = container; container.classList.add('ms-tab');
      ui.prog = h('p', { class: 'ms-prog' });
      ui.progBar = h('i');
      ui.progBox = h('div', { class: 'ms-bar big', attrs: { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuenow': '0', 'aria-valuemax': '0', 'aria-label': 'Visited stops' } }, ui.progBar);
      var search = h('input', { type: 'search', class: 'ms-search', placeholder: 'Search stops (name, area, sol, date)', attrs: { 'aria-label': 'Search stops' }, oninput: function () { ui.q = search.value; refresh(); } });
      var filt = h('select', { class: 'ms-filter', attrs: { 'aria-label': 'Filter stops by status' }, onchange: function () { ui.filter = filt.value; refresh(); } }, [
        h('option', { value: 'all', text: 'All' }), h('option', { value: 'todo', text: 'Not visited' }), h('option', { value: 'done', text: 'Visited' })]);
      ui.list = h('div', { class: 'ms-list' });
      var legend = h('p', { class: 'ms-legend' }, objectives.map(function (o, i) { return h('span', {}, [h('i', { class: 'ms-sw ms-o' + (i % 4 + 1) }), o.title]); })
        .concat([h('span', {}, [h('i', { class: 'ms-sw ms-multi' }), 'Both']), h('span', {}, [h('i', { class: 'ms-sw ms-custom' }), 'Mine']),
          h('span', {}, [h('i', { class: 'ms-sw ms-dash' }), 'Dashed outline: approximate position']),
          h('span', {}, [h('i', { class: 'ms-sw ms-arrow-sw' }), 'Arrow marker: stop outside the map (number or count)'])]));
      container.appendChild(h('div', {}, [
        h('p', { class: 'ms-intro', text: 'Stops from the mission guide. Sample positions are approximate (placed by area, not the true sample locations). Tick a stop when you have visited it.' }),
        h('p', { class: 'ms-intro', text: 'Objective tags are a simplified editorial mapping (see docs/mission-guide.md), not an official science assignment.' }),
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
