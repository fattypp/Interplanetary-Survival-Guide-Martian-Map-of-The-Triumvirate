/* control.js: the operator page. It is the simulation authority: it ticks JdaSim (~10 Hz), publishes the 'world' state through
   JdaLink (1 Hz) and applies 'cmd' messages from other pages. JdaLink / JdaLinkUI may be missing; the page then runs standalone. */
(function () {
  'use strict';
  var Sim = window.JdaSim;
  if (!Sim) { document.body.textContent = 'sim-core.js failed to load.'; return; }
  var C = Sim.C;
  var sim = Sim.create({ seed: 20260101 });
  var $ = function (id) { return document.getElementById(id); };
  var REMOTE_CMDS = ['walk', 'stop', 'return', 'setSpeed', 'setClockSpeed', 'set', 'event', 'reset'];
  var CLOCKS = [1, 10, 60, 600, 3600];
  var authorId = 'c' + Math.random().toString(36).slice(2, 8), epoch = Date.now();
  var role = 'authority', observeUntil = 0, otherEvents = 0, lastOther = null, otherEpoch = 0;   // role: 'observing' | 'authority' | 'blocked'
  var cards = {}, lastIds = '', roomCode = null, offLink = null, lastTick = Date.now(), W = sim.world();

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function fmt(v, d) { return typeof v === 'number' && isFinite(v) ? v.toFixed(d) : '-'; }
  function logLine(text, cls) {
    var ol = $('log'), t = W && W.t ? W.t.slice(11, 19) : '--:--:--';
    var li = h('li', cls ? { class: cls } : {}, [h('time', { text: t }), document.createTextNode(text)]);
    ol.insertBefore(li, ol.firstChild);
    while (ol.children.length > 60) ol.removeChild(ol.lastChild);
  }
  function nameOf(id) { return W.crew[id] ? W.crew[id].name : id; }

  /* ---------- commands ---------- */
  function run(cmd, who) {
    var r = sim.command(cmd);
    W = sim.world();
    if (!r.ok) logLine((who || 'Operator') + ': ' + cmd.cmd + ' failed (' + r.error + ')');
    else logLine((who || 'Operator') + ': ' + describe(cmd));
    publish();
    return r;
  }
  function describe(c) {
    var who = c.crew ? (c.crew === 'all' ? 'everyone' : nameOf(c.crew)) : '';
    switch (c.cmd) {
      case 'walk': return who + ' walks' + (c.to && c.to.label ? ' to ' + c.to.label : c.heading !== undefined ? ' on heading ' + c.heading : '') + (c.path && c.path.length ? ' and on through ' + (c.path.length) + ' more stops' : '');
      case 'stop': return who + ' stops';
      case 'return': return who + ' returns to base';
      case 'setSpeed': return who + ' speed ' + c.mps + ' m/s';
      case 'setClockSpeed': return 'clock x' + c.n;
      case 'set': return who + ' ' + c.field + ' = ' + c.value;
      case 'event': return 'events ' + JSON.stringify({ solar: c.solar, dust: c.dust });
      default: return c.cmd;
    }
  }
  function walkTo(id, p) { return run({ cmd: 'walk', crew: id, to: { lat: p.lat, lon: p.lon, label: p.label } }); }

  function moveNow() {
    var id = $('heroCrew').value; if (!id || !W.crew[id]) return;
    if (W.clockSpeed < 60) run({ cmd: 'setClockSpeed', n: 60 });
    var path = Sim.demoPath(), first = path.shift();
    run({ cmd: 'walk', crew: id, to: first, path: path, thenReturn: true });
  }

  function sendSos(id) {
    var c = W.crew[id]; if (!c) return;
    var msg = { type: 'sos', name: c.name, lat: c.lat, lon: c.lon, simTime: W.t };
    var L = window.JdaLink;
    if (L && L.send && L.room) { try { L.send(msg); logLine('SOS sent for ' + c.name + ' at ' + fmt(c.lat, 4) + ', ' + fmt(c.lon, 4), 'sos'); } catch (e) { logLine('SOS failed: ' + e.message); } }
    else logLine('SOS not sent: not in a room', 'sos');
  }

  /* ---------- UI: global ---------- */
  function buildGlobal() {
    var box = $('clockBtns');
    CLOCKS.forEach(function (n) {
      box.appendChild(h('button', { type: 'button', class: 'btn', 'data-n': n, 'aria-pressed': 'false', text: 'x' + n, onclick: function () { run({ cmd: 'setClockSpeed', n: n }); } }));
    });
    $('evSolar').addEventListener('change', function () { run({ cmd: 'event', solar: this.checked }); });
    $('evDust').addEventListener('change', function () { run({ cmd: 'event', dust: this.checked }); });
    $('resetBtn').addEventListener('click', function () { if (window.confirm('Reset the simulation (positions, vitals, dose, clock)?')) run({ cmd: 'reset' }); });
    $('moveNow').addEventListener('click', moveNow);
    $('addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('addName').value.replace(/\s+/g, ' ').trim();
      if (!name) { $('addName').focus(); return; }
      var r = sim.addCrew({ name: name });
      logLine(r.ok ? 'Operator: added crew ' + name : 'Add crew failed (' + r.error + ')');
      $('addName').value = ''; W = sim.world(); publish(); render();
    });
  }

  /* ---------- UI: crew cards ---------- */
  function slider(label, min, max, step, onChange, unit, auto) {
    var id = 'sl' + Math.random().toString(36).slice(2, 8);
    var inp = h('input', { type: 'range', id: id, min: min, max: max, step: step });
    var out = h('output', { for: id, text: '' });
    inp.addEventListener('input', function () { out.textContent = this.value + (unit || ''); inp.dataset.dirty = '1'; });
    inp.addEventListener('change', function () { onChange(Number(this.value)); delete inp.dataset.dirty; });
    var row = h('div', { class: 'slider' }, [h('label', { for: id, text: label }), inp, out]);
    if (auto) {
      var cb = h('input', { type: 'checkbox', checked: true, id: id + 'a' });
      cb.addEventListener('change', function () { if (cb.checked) auto(); });
      row.appendChild(h('label', { class: 'check auto', for: id + 'a' }, [cb, 'Automatic']));
      row._auto = cb;
    }
    return { row: row, inp: inp, out: out, unit: unit || '' };
  }

  function buildCard(id) {
    var el = {}, hrAuto;
    var vit = h('dl', { class: 'vit' });
    ['o2', 'bat', 'hr', 'suit', 'amb', 'rad', 'dose', 'speed', 'pos'].forEach(function (k) {
      el[k] = h('dd', { text: '-' });
      vit.appendChild(h('div', {}, [h('dt', { text: { o2: 'Oxygen', bat: 'Battery', hr: 'Heart rate', suit: 'Suit temp', amb: 'Ambient', rad: 'Radiation', dose: 'Dose', speed: 'Speed', pos: 'Map x,y' }[k] }), el[k]]));
    });
    el.mode = h('span', { class: 'mode', text: 'idle' });
    el.name = h('span', { text: id });
    var dest = h('select', { 'aria-label': 'Destination for ' + id });
    var keys = ['three', 'hawks', 'fan', 'neretva', 'whh', 'seitah', 'landing'];
    keys.forEach(function (k) { dest.appendChild(h('option', { value: k, text: Sim.PLACES[k].label })); });
    var head = h('input', { type: 'number', min: 0, max: 359, step: 1, value: 90, 'aria-label': 'Heading in degrees from north', style: 'width:5.5em' });
    var spd = slider('Walking speed', 0.1, 10, 0.1, function (v) { run({ cmd: 'setSpeed', crew: id, mps: v }); }, ' m/s');
    var o2 = slider('Oxygen', 0, 100, 1, function (v) { run({ cmd: 'set', crew: id, field: 'o2Pct', value: v }); }, ' %');
    var bat = slider('Battery', 0, 100, 1, function (v) { run({ cmd: 'set', crew: id, field: 'batPct', value: v }); }, ' %');
    var hr = slider('Heart rate', 40, 200, 1, function (v) { run({ cmd: 'set', crew: id, field: 'hr', value: v }); hr.row._auto.checked = false; }, ' bpm',
      function () { run({ cmd: 'set', crew: id, field: 'hr', value: null }); });
    hrAuto = hr.row._auto; hrAuto.checked = true;
    el.sliders = { speed: spd, o2: o2, bat: bat, hr: hr };
    var card = h('article', { class: 'card', 'aria-label': id }, [
      h('h3', {}, [el.name, el.mode]),
      vit,
      h('div', { class: 'btnrow' }, [
        h('button', { type: 'button', class: 'btn primary', text: 'Walk', onclick: function () { walkTo(id, Sim.PLACES[dest.value]); } }),
        h('button', { type: 'button', class: 'btn', text: 'Stop', onclick: function () { run({ cmd: 'stop', crew: id }); } }),
        h('button', { type: 'button', class: 'btn', text: 'Return', onclick: function () { run({ cmd: 'return', crew: id }); } }),
        h('button', { type: 'button', class: 'btn danger', text: 'SOS', onclick: function () { sendSos(id); } })
      ]),
      h('div', { class: 'btnrow' }, [h('label', { class: 'field inline' }, ['To ', dest]),
        h('label', { class: 'field inline' }, ['Heading ', head]),
        h('button', { type: 'button', class: 'btn', text: 'Walk on heading', onclick: function () { run({ cmd: 'walk', crew: id, heading: Number(head.value) || 0 }); } })]),
      spd.row, o2.row, bat.row, hr.row,
      h('div', { class: 'btnrow' }, [h('button', { type: 'button', class: 'btn', text: 'Remove', onclick: function () { if (window.confirm('Remove ' + nameOf(id) + '?')) { sim.removeCrew(id); W = sim.world(); publish(); render(); } } })])
    ]);
    el.card = card;
    return el;
  }

  function setSlider(s, v) {
    if (document.activeElement === s.inp || s.inp.dataset.dirty) return;
    s.inp.value = v; s.out.textContent = s.inp.value + s.unit;
  }

  /* ---------- UI: render ---------- */
  function render() {
    var ids = Object.keys(W.crew);
    var key = ids.join('|');
    if (key !== lastIds) {
      lastIds = key;
      var box = $('cards'); while (box.firstChild) box.removeChild(box.firstChild);
      cards = {};
      ids.forEach(function (id) { cards[id] = buildCard(id); box.appendChild(cards[id].card); });
      var hero = $('heroCrew'), prev = hero.value;
      while (hero.firstChild) hero.removeChild(hero.firstChild);
      ids.forEach(function (id) { hero.appendChild(h('option', { value: id, text: W.crew[id].name })); });
      if (prev && W.crew[prev]) hero.value = prev;
      buildTable(ids); buildLinks();
    }
    ids.forEach(function (id) {
      var c = W.crew[id], e = cards[id]; if (!e) return;
      e.name.textContent = c.name;
      e.card.setAttribute('aria-label', c.name);
      e.mode.textContent = c.mode; e.mode.className = 'mode ' + c.mode;
      e.o2.textContent = fmt(c.o2Pct, 1) + ' %'; e.o2.className = c.o2Pct < 25 ? 'low' : '';
      e.bat.textContent = fmt(c.batPct, 1) + ' %'; e.bat.className = c.batPct < 25 ? 'low' : '';
      e.hr.textContent = c.hr + ' bpm'; e.suit.textContent = fmt(c.suitTempC, 1) + ' C'; e.amb.textContent = fmt(c.ambientTempC, 0) + ' C';
      e.rad.textContent = fmt(c.radUsvH, 1) + ' uSv/h'; e.dose.textContent = fmt(c.doseMsv, 3) + ' mSv';
      e.speed.textContent = fmt(c.speedMps, 1) + ' m/s'; e.pos.textContent = fmt(c.x, 0) + ', ' + fmt(c.y, 0);
      setSlider(e.sliders.o2, Math.round(c.o2Pct)); setSlider(e.sliders.bat, Math.round(c.batPct));
      if (e.sliders.hr.row._auto.checked) setSlider(e.sliders.hr, c.hr);
    });
    // table
    ids.forEach(function (id) {
      var c = W.crew[id], r = rows[id]; if (!r) return;
      var v = [c.name, c.mode, fmt(c.lat, 5), fmt(c.lon, 5), fmt(c.x, 0) + ', ' + fmt(c.y, 0), fmt(c.speedMps, 1), fmt(c.headingDeg, 0), fmt(c.o2Pct, 1), fmt(c.batPct, 1), c.hr, fmt(c.suitTempC, 1), fmt(c.ambientTempC, 1), fmt(c.radUsvH, 1), fmt(c.doseMsv, 3)];
      v.forEach(function (t, i) { if (r[i].textContent !== String(t)) r[i].textContent = t; });
    });
    // header, clock, events
    $('missionTime').textContent = W.t.slice(0, 10) + ' ' + W.t.slice(11, 19) + ' UTC';
    $('localTime').textContent = Sim.localMarsTime(W.t);
    $('clockNow').textContent = 'x' + W.clockSpeed;
    Array.prototype.forEach.call($('clockBtns').children, function (b) { b.setAttribute('aria-pressed', Number(b.dataset.n) === W.clockSpeed ? 'true' : 'false'); });
    if (document.activeElement !== $('evSolar')) $('evSolar').checked = W.events.solar;
    if (document.activeElement !== $('evDust')) $('evDust').checked = W.events.dust;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  var rows = {};
  function buildTable(ids) {
    var tb = $('tbody'); while (tb.firstChild) tb.removeChild(tb.firstChild);
    rows = {};
    ids.forEach(function (id) {
      var tr = h('tr'), cells = [];
      for (var i = 0; i < 14; i++) { var td = h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}); cells.push(td); tr.appendChild(td); }
      rows[id] = cells; tb.appendChild(tr);
    });
  }

  /* ---------- UI: links ---------- */
  function pageUrl(name, code, crew) {
    var path = location.pathname, dist = /simulation-control\.html$/.test(path);
    var map = { helmet: 'astronaut-helmet.html', tablet: 'astronaut-tablet.html', atlas: 'jezero-delta-atlas.html', earth: 'earth-control.html' };
    var src = { helmet: 'helmet.html', tablet: 'tablet.html', atlas: 'index.html', earth: 'earth.html' };
    var u = new URL(dist ? map[name] : src[name], location.href).href.split('#')[0].split('?')[0];
    return u + '#room=' + code + (crew ? '&crew=' + crew : '');
  }
  function buildLinks() {
    var ul = $('links'); while (ul.firstChild) ul.removeChild(ul.firstChild);
    if (!roomCode) { ul.appendChild(h('li', { text: 'Join a room first; the links then include its code.' })); return; }
    var list = [];
    Object.keys(W.crew).forEach(function (id) {
      list.push(['Helmet, ' + W.crew[id].name, pageUrl('helmet', roomCode, id)]);
      list.push(['Tablet, ' + W.crew[id].name, pageUrl('tablet', roomCode, id)]);
    });
    list.push(['Atlas', pageUrl('atlas', roomCode)]);
    list.push(['Earth control', pageUrl('earth', roomCode)]);
    list.forEach(function (it, i) {
      var inp = h('input', { type: 'text', readonly: true, value: it[1], id: 'lk' + i, 'aria-label': it[0] + ' link' });
      var btn = h('button', { type: 'button', class: 'btn', text: 'Copy', 'aria-label': 'Copy ' + it[0] + ' link', onclick: function () { copy(inp, btn); } });
      ul.appendChild(h('li', {}, [h('label', { for: 'lk' + i, text: it[0] }), inp, btn]));
    });
  }
  function copy(inp, btn) {
    function done(ok) { var o = btn.textContent; btn.textContent = ok ? 'Copied' : 'Press Ctrl+C'; setTimeout(function () { btn.textContent = o; }, 1500); }
    inp.focus(); inp.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(inp.value).then(function () { done(true); }, function () { var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } done(ok); });
    else { var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ } done(ok); }
  }

  /* ---------- link: room, publishing, incoming commands ---------- */
  function publish(stale) {
    var L = window.JdaLink;
    if (role !== 'authority' || !(L && L.room && typeof L.setState === 'function')) return;
    var pub = {}; Object.keys(W).forEach(function (k) { pub[k] = W[k]; });
    pub.authorId = authorId; pub.epoch = epoch; pub.hb = Date.now(); pub.stale = !!stale;
    try { L.setState('world', pub); } catch (e) { /* link not ready */ }
  }
  /* ---- authority arbitration: only one control page publishes per room ---- */
  function setRole(r, why) {
    role = r;
    var blocked = r === 'blocked', b = $('authBanner'), main = $('main');
    b.hidden = !blocked;
    if ('inert' in main) main.inert = blocked;
    main.setAttribute('aria-disabled', blocked ? 'true' : 'false');
    if (blocked) $('authText').textContent = why;
    $('pubStatus').textContent = r === 'authority' ? 'This page is the simulation authority and is publishing.' : r === 'observing' ? 'Checking whether another control page is already running this room.' : 'Not publishing: another control page is running this room.';
    if (why && !blocked) logLine(why);
  }
  function onWorldState(v) {
    if (!v || typeof v !== 'object' || !v.crew || typeof v.authorId !== 'string' || v.authorId === authorId) return;
    var now = Date.now();
    lastOther = { w: v, ms: now };
    if (v.stale) { if (role === 'blocked') $('authText').textContent = 'The other control page has closed or stopped. Take over to run the simulation from here.'; return; }
    if (role === 'observing') {
      otherEvents++;
      if (otherEvents >= 2 || Math.abs(now - Number(v.hb)) < 2500) setRole('blocked', 'Another control page is already running this room. This page is not publishing, so the two cannot overwrite each other.');
    } else if (role === 'authority' && Number(v.epoch) > epoch) {
      setRole('blocked', 'Another control page took over this room. This page has stopped publishing.');
    }
  }
  function takeOver() {
    if (lastOther && Date.now() - lastOther.ms < 15000) sim.load(lastOther.w);   // continue from its world, no jump back
    epoch = Math.max(Date.now(), (lastOther && Number(lastOther.w.epoch) || 0) + 1);
    W = sim.world(); lastTick = Date.now();
    setRole('authority', 'Took over as the simulation authority.');
    publish();
    lastIds = ''; render();
  }
  function watchRoom() {
    var L = window.JdaLink, room = L && L.room;
    var code = room && room.code ? room.code : null;
    $('linkStatus').textContent = code ? (L.status || 'joined') : (L ? 'not joined' : 'link unavailable');
    if (code === roomCode) return;
    roomCode = code;
    $('roomCode').textContent = code || 'none';
    if (offLink) { try { offLink(); } catch (e) { /* ignore */ } offLink = null; }
    if (code && typeof L.on === 'function') {
      var offMsg = L.on(onMessage), offSt = typeof L.onState === 'function' ? L.onState('world', onWorldState) : null;
      offLink = function () { try { offMsg(); } catch (e) { /* ignore */ } if (offSt) { try { offSt(); } catch (e) { /* ignore */ } } };
      logLine('Joined room ' + code);
      otherEvents = 0; lastOther = null; observeUntil = Date.now() + 3000; setRole('observing');
    }
    if (!code) setRole('authority');
    buildLinks();
  }
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'cmd' && role !== 'blocked' && REMOTE_CMDS.indexOf(m.cmd) >= 0) {
      var who = m.from && m.from.name ? m.from.name : 'Remote';
      run({ cmd: m.cmd, crew: m.crew, to: m.to, heading: m.heading, path: m.path, mps: m.mps, n: m.n, field: m.field, value: m.value, solar: m.solar, dust: m.dust, speed: m.speed }, who);
    } else if (m.type === 'sos') {
      logLine('SOS received from ' + String(m.from && m.from.name || m.from || 'unknown').slice(0, 30), 'sos');
    }
  }

  /* ---------- main loops ---------- */
  buildGlobal();
  try { if (window.JdaLinkUI && window.JdaLinkUI.mount) window.JdaLinkUI.mount({ role: 'control', ask: ['code'], name: 'Operator' }); } catch (e) { logLine('Room dialog failed: ' + e.message); }
  /* Catch-up integration: a throttled or backgrounded tab integrates the real time that passed (up to 10 minutes) in sub-steps. */
  var pubCount = 0;
  function pump() {
    var now = Date.now(), dt = Math.min(now - lastTick, 600000); lastTick = now;
    while (dt > 0) { var d = Math.min(dt, 5000); sim.tick(d); dt -= d; }
    if (role === 'observing' && now >= observeUntil) setRole('authority', 'No other control page found; this page is the simulation authority.');
    if (role === 'blocked' && lastOther && now - lastOther.ms > 8000) { takeOver(); logLine('The other control page stopped sending updates, so this page took over.'); }
    W = role === 'blocked' && lastOther ? lastOther.w : sim.world();
    if (++pubCount >= 10) { pubCount = 0; publish(); }
  }
  var worker = null;
  try {   // a dedicated worker's timer is not throttled in background tabs; falls back to setInterval
    var url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},100)'], { type: 'text/javascript' }));
    worker = new Worker(url); worker.onmessage = pump;
  } catch (e) { worker = null; }
  setInterval(function () { if (!worker || Date.now() - lastTick > 1500) pump(); }, 100);
  window.addEventListener('pagehide', function () { publish(true); });
  $('takeOver').addEventListener('click', takeOver);
  setInterval(render, 250);
  setInterval(watchRoom, 500);
  render(); watchRoom();
  logLine('Simulation ready. Press Move now to send a crew member on a walk.');
  window.JdaControl = { sim: sim, run: run, world: function () { return W; } };   // for tests and the console
})();
