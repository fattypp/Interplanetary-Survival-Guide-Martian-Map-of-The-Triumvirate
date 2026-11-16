/* control.js: the operator page. It is the simulation authority: it ticks JdaSim (~10 Hz), publishes the 'world' state through
   JdaLink (1 Hz) and applies 'cmd' messages from other pages. JdaLink / JdaLinkUI may be missing; the page then runs standalone. */
(function () {
  'use strict';
  var Sim = window.JdaSim;
  if (!Sim) { document.body.textContent = 'sim-core.js failed to load.'; return; }
  var C = Sim.C, MI = Sim.missionInfo(), SPD = Sim.speeds();
  var sim = Sim.create({ seed: 20260101 });
  var $ = function (id) { return document.getElementById(id); };
  var REMOTE_CMDS = ['walk', 'stop', 'return', 'setSpeed', 'setTravel', 'runMission', 'setClockSpeed', 'set', 'event', 'reset'];
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

  /* in-page confirmation (no browser dialogs): alertdialog with focus trap, Esc or Cancel closes, focus returns to the trigger */
  function confirmStep(trigger, title, yesLabel, onYes) {
    var back = h('div', { class: 'cf-back' }), yes, no, prevent = false;
    function close(ok) {
      if (prevent) return; prevent = true;
      document.removeEventListener('keydown', onKey, true);
      if (back.parentNode) back.parentNode.removeChild(back);
      var t = trigger && document.contains(trigger) ? trigger : ($('addName') || document.body);
      try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      if (ok) { onYes(); if (!document.contains(t) || document.activeElement === document.body) { try { $('addName').focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(false); }
      else if (e.key === 'Tab') {
        var f = [no, yes], i = f.indexOf(document.activeElement);
        if (i < 0) { f[0].focus(); e.preventDefault(); }
        else if (e.shiftKey && i === 0) { f[1].focus(); e.preventDefault(); }
        else if (!e.shiftKey && i === 1) { f[0].focus(); e.preventDefault(); }
      }
    }
    no = h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: function () { close(false); } });
    yes = h('button', { type: 'button', class: 'btn danger', text: yesLabel, onclick: function () { close(true); } });
    var dlg = h('div', { class: 'cf-dlg', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'cf-t' }, [h('p', { id: 'cf-t', text: title }), h('div', { class: 'btnrow' }, [no, yes])]);
    back.appendChild(dlg);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(back); no.focus();
  }

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
      case 'setTravel': return who + ' travels ' + (c.mode === 'rover' ? 'by rover' : 'on foot');
      case 'runMission': return who + ' runs the mission: base camp, ' + MI.stops.length + ' stops, back to base camp';
      case 'setClockSpeed': return 'clock x' + c.n;
      case 'set': return who + ' ' + c.field + ' = ' + c.value;
      case 'event': return 'events ' + JSON.stringify({ solar: c.solar, dust: c.dust });
      default: return c.cmd;
    }
  }
  function walkTo(id, p, travel) { return run({ cmd: 'walk', crew: id, to: { lat: p.lat, lon: p.lon, label: p.name }, travel: travel }); }
  function destinations() { return [MI.base].concat(MI.stops); }

  function runMission() {
    var id = $('heroCrew').value; if (!id || !W.crew[id]) { logLine('Run mission: no crew member selected (add one first).'); return; }
    if (W.clockSpeed < 60) run({ cmd: 'setClockSpeed', n: 600 });
    run({ cmd: 'runMission', crew: id });
  }
  /* simulated seconds as h/min, plus the real time it takes at the current clock multiplier */
  function dur(s) {
    if (!(s >= 0)) return '-';
    var m = Math.round(s / 60);
    return m >= 60 ? Math.floor(m / 60) + ' h ' + pad(m % 60) + ' min' : m < 1 ? '< 1 min' : m + ' min';
  }
  function etaText(s) {
    if (s === null || s === undefined) return '-';
    var real = s / (W.clockSpeed || 1);
    return dur(s) + ' (' + (real < 90 ? Math.round(real) + ' s' : Math.round(real / 60) + ' min') + ' real)';
  }
  function stopLabel(c) {
    if (c.stopId) {
      var st = MI.stops.filter(function (x) { return x.id === c.stopId; })[0], t = MI.tasks.filter(function (x) { return x.id === c.taskId; })[0];
      return 'Stop ' + (st ? st.n + ', ' + st.name : c.stopId) + (t ? ' / ' + t.title : '');
    }
    return c.target && c.target.label ? 'En route to ' + c.target.label : '-';
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
    $('resetBtn').addEventListener('click', function () { var b = this; confirmStep(b, 'Reset the simulation (positions, vitals, dose, clock)? A running mission stops.', 'Yes, reset', function () { run({ cmd: 'reset' }); }); });
    $('runMission').addEventListener('click', runMission);
    $('addForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('addName').value.replace(/\s+/g, ' ').trim();
      if (!name) { $('addName').focus(); return; }
      name = name.slice(0, 24);
      var low = name.toLowerCase();
      if (Object.keys(W.crew).some(function (k) { return String(W.crew[k].name).toLowerCase() === low; })) {   // two cards with the same name cannot be told apart
        logLine('Add crew failed (a crew member named ' + name + ' already exists)'); $('addName').focus(); return;
      }
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
    ['o2', 'bat', 'hr', 'suit', 'amb', 'rad', 'dose', 'speed', 'pos', 'travel', 'where', 'dist', 'eta'].forEach(function (k) {
      el[k] = h('dd', { text: '-' });
      vit.appendChild(h('div', {}, [h('dt', { text: { o2: 'Oxygen', bat: 'Battery', hr: 'Heart rate', suit: 'Suit temp', amb: 'Ambient', rad: 'Radiation', dose: 'Dose', speed: 'Speed', pos: 'Map x,y', travel: 'Travel', where: 'Stop / task', dist: 'Distance left', eta: 'ETA' }[k] }), el[k]]));
    });
    el.mode = h('span', { class: 'mode', text: 'idle' });
    el.name = h('span', { text: id });
    var dest = h('select', { 'aria-label': 'Destination for ' + id });
    destinations().forEach(function (p, i) { dest.appendChild(h('option', { value: i, text: (p.n ? p.n + '. ' : '') + p.name })); });
    var head = h('input', { type: 'number', min: 0, max: 359, step: 1, value: 90, 'aria-label': 'Heading in degrees from north', style: 'width:5.5em' });
    var spd = slider('Speed (rover ' + SPD.rover + ', foot ' + SPD.foot + ' m/s)', 0.1, 10, 0.1, function (v) { run({ cmd: 'setSpeed', crew: id, mps: v }); }, ' m/s');
    var o2 = slider('Oxygen', 0, 100, 1, function (v) { run({ cmd: 'set', crew: id, field: 'o2Pct', value: v }); }, ' %');
    var bat = slider('Battery', 0, 100, 1, function (v) { run({ cmd: 'set', crew: id, field: 'batPct', value: v }); }, ' %');
    var hr = slider('Heart rate', 40, 200, 1, function (v) { run({ cmd: 'set', crew: id, field: 'hr', value: v }); hr.row._auto.checked = false; }, ' bpm',
      function () { run({ cmd: 'set', crew: id, field: 'hr', value: null }); });
    hrAuto = hr.row._auto; hrAuto.checked = true;
    el.sliders = { speed: spd, o2: o2, bat: bat, hr: hr };
    el.prog = h('progress', { max: Math.max(1, MI.tasks.length), value: 0, 'aria-label': 'Tasks done' });
    el.progText = h('span', { class: 'progtext', text: '0 of ' + MI.tasks.length + ' tasks' });
    el.travelBtns = {};
    var tsw = h('div', { class: 'seg', role: 'group', 'aria-label': 'Travel mode for ' + id }, [['rover', 'Rover'], ['foot', 'On foot']].map(function (m) {
      var b = h('button', { type: 'button', class: 'btn', 'aria-pressed': 'false', text: m[1], onclick: function () { run({ cmd: 'setTravel', crew: id, mode: m[0] }); } });
      el.travelBtns[m[0]] = b; return b;
    }));
    var card = h('article', { class: 'card', 'aria-label': id }, [
      h('h3', {}, [el.name, el.mode]),
      vit,
      h('div', { class: 'progrow' }, [el.prog, el.progText]),
      h('div', { class: 'btnrow' }, [h('span', { class: 'lbl', text: 'Travel' }), tsw,
        h('button', { type: 'button', class: 'btn', text: 'Run mission', onclick: function () { run({ cmd: 'runMission', crew: id }); } })]),
      h('div', { class: 'btnrow' }, [
        h('button', { type: 'button', class: 'btn primary', text: 'Walk', onclick: function () { walkTo(id, destinations()[Number(dest.value)]); } }),
        h('button', { type: 'button', class: 'btn', text: 'Stop', onclick: function () { run({ cmd: 'stop', crew: id }); } }),
        h('button', { type: 'button', class: 'btn', text: 'Return', onclick: function () { run({ cmd: 'return', crew: id }); } }),
        h('button', { type: 'button', class: 'btn danger', text: 'SOS', onclick: function () { sendSos(id); } })
      ]),
      h('div', { class: 'btnrow' }, [h('label', { class: 'field inline' }, ['To ', dest]),
        h('label', { class: 'field inline' }, ['Heading ', head]),
        h('button', { type: 'button', class: 'btn', text: 'Walk on heading', onclick: function () {
          var hv = String(head.value).trim(), hn = Number(hv);
          if (hv === '' || !isFinite(hn)) { logLine('Walk on heading needs a number of degrees from north (0 to 359).'); head.focus(); return; }
          run({ cmd: 'walk', crew: id, heading: ((hn % 360) + 360) % 360 });
        } })]),
      spd.row, o2.row, bat.row, hr.row,
      h('div', { class: 'btnrow' }, [h('button', { type: 'button', class: 'btn', text: 'Remove', onclick: function (ev) {
        if (Object.keys(W.crew).length <= 1) { logLine('Remove failed (at least one crew member must stay; Reset does not bring removed crew back)'); return; }
        confirmStep(ev.currentTarget, 'Remove ' + nameOf(id) + ' from the simulation?', 'Yes, remove', function () { sim.removeCrew(id); W = sim.world(); publish(); render(); });
      } })])
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
      var trv = c.travel === 'rover' ? 'rover' : 'foot';
      e.travel.textContent = trv === 'rover' ? 'Rover (cabin air)' : 'On foot (suit)';
      e.where.textContent = stopLabel(c);
      e.dist.textContent = c.distM === null || c.distM === undefined ? '-' : c.distM >= 1000 ? fmt(c.distM / 1000, 2) + ' km' : fmt(c.distM, 0) + ' m';
      e.eta.textContent = etaText(c.etaS);
      var pr = c.progress || { done: 0, total: MI.tasks.length };
      e.prog.max = Math.max(1, pr.total); e.prog.value = pr.done; e.progText.textContent = pr.done + ' of ' + pr.total + ' tasks';
      Object.keys(e.travelBtns).forEach(function (k) { e.travelBtns[k].setAttribute('aria-pressed', k === trv ? 'true' : 'false'); });
      setSlider(e.sliders.speed, c.speedMps > 0 ? c.speedMps : SPD[trv]);
      setSlider(e.sliders.o2, Math.round(c.o2Pct)); setSlider(e.sliders.bat, Math.round(c.batPct));
      if (e.sliders.hr.row._auto.checked) setSlider(e.sliders.hr, c.hr);
    });
    // table
    ids.forEach(function (id) {
      var c = W.crew[id], r = rows[id]; if (!r) return;
      var v = [c.name, c.mode, c.travel === 'rover' ? 'rover' : 'foot', c.stopId ? c.stopId + (c.taskId ? ' / ' + c.taskId : '') : '-', (c.progress ? c.progress.done + '/' + c.progress.total : '-'), fmt(c.lat, 5), fmt(c.lon, 5), fmt(c.x, 0) + ', ' + fmt(c.y, 0), fmt(c.speedMps, 1), fmt(c.headingDeg, 0), fmt(c.o2Pct, 1), fmt(c.batPct, 1), c.hr, fmt(c.suitTempC, 1), fmt(c.ambientTempC, 1), fmt(c.radUsvH, 1), fmt(c.doseMsv, 3)];
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
      for (var i = 0; i < 17; i++) { var td = h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : {}); cells.push(td); tr.appendChild(td); }
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
  /* A reloaded (or re-opened) control page continues from the room's last published world (a closed control page leaves one, marked stale)
     instead of rewinding every crew member to the start. Only worlds published within the last 30 minutes are used. */
  var resumed = false;
  function resumeRoomWorld() {
    if (resumed) return; resumed = true;
    var L = window.JdaLink, st = null;
    try { st = L && L.getState ? L.getState('world') : null; } catch (e) { st = null; }
    var v = st && st.value;
    if (!v || typeof v !== 'object' || !v.crew || v.authorId === authorId || !(Date.now() - Number(v.hb) < 30 * 60000)) return;
    if (sim.load(v)) { W = sim.world(); lastIds = ''; logLine('Resumed from the last world of this room (' + String(v.t).slice(11, 19) + ' mission time). Use Reset simulation to start over.'); }
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
      otherEvents = 0; lastOther = null; resumed = false; observeUntil = Date.now() + 3000; setRole('observing');
    }
    if (!code) setRole('authority');
    buildLinks();
  }
  function onMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'cmd' && role !== 'blocked' && REMOTE_CMDS.indexOf(m.cmd) >= 0) {
      var who = m.from && m.from.name ? m.from.name : 'Remote';
      run({ cmd: m.cmd, crew: m.crew, to: m.to, heading: m.heading, path: m.path, mps: m.mps, n: m.n, field: m.field, value: m.value, solar: m.solar, dust: m.dust, speed: m.speed, travel: m.travel, mode: m.mode, thenReturn: m.thenReturn }, who);
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
    if (role === 'observing' && now >= observeUntil) { resumeRoomWorld(); setRole('authority', 'No other control page found; this page is the simulation authority.'); }
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
  logLine('Simulation ready. Press Run mission to send a crew member from base camp through all stops and back.');
  window.JdaControl = { sim: sim, run: run, world: function () { return W; } };   // for tests and the console
})();
