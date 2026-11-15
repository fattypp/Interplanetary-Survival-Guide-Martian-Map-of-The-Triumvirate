/* Team feature (see docs/ARCHITECTURE.md): simulated crew-mates, their suit vitals, a map layer and a chat.
   HONESTY: there is no real team feed. Everything here is simulated and labelled "simulated" in the UI.
   Part 1 is pure logic (also runs under Node / the browser test page). Part 2 is the UI (needs window.Atlas). */
(function () {
  'use strict';

  /* ======================= Part 1: pure logic ======================= */
  var MPP = 5.55;                 // fallback metres per PAGE pixel; the UI computes the real value from meta.bbox/page (see metersPerPx)
  var O2_RATE = 100 / (6 * 3600); // % per second: a full bottle lasts 6 h of simulated time
  var BAT_RATE = 100 / (8 * 3600);// % per second: a full battery lasts 8 h
  var MAX_STEP_PX = 3;            // never move further than this in one collision check (craters are >= ~10 px)
  var HR_MIN = 45, HR_MAX = 180;
  var MAX_LEN = 280;              // chat message length limit

  // Metres per page pixel, same formula as suit.js / route-planner.js: Mars 59270 m per degree, lon span over page width.
  // (meta.m_per_px is the IMAGE pixel scale, not the page scale, so it is not used.)
  function metersPerPx(meta) {
    var b = meta && meta.bbox, pg = meta && meta.page;
    if (b && pg && pg[0] > 0) {
      var m = (b.lon1 - b.lon0) * 59270 * Math.cos(((b.lat0 + b.lat1) / 2) * Math.PI / 180) / pg[0];
      if (isFinite(m) && m > 0) return m;
    }
    return MPP;
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // mulberry32 whose state lives in the member (m.rs), so it can be saved and resumed.
  function rand(m) {
    m.rs = (m.rs + 0x6D2B79F5) | 0;
    var t = m.rs;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  // Confident craters (confidence >= minConf) as circles in page px: [{x, y, r}]. page = [x, y, radius].
  function blockedCraters(data, minConf) {
    minConf = minConf === undefined ? 0.6 : minConf;
    var list = (data && data.craters) || [];
    return list.filter(function (c) { return c && c.page && c.confidence >= minConf; })
      .map(function (c) { return { x: c.page[0], y: c.page[1], r: c.page[2] }; });
  }

  function isBlocked(x, y, ctx) {
    var m = ctx.margin === undefined ? 12 : ctx.margin, pad = ctx.pad === undefined ? 6 : ctx.pad;
    if (!(x >= m && x <= ctx.W - m && y >= m && y <= ctx.H - m)) return true;
    for (var i = 0; i < ctx.blocks.length; i++) {
      var c = ctx.blocks[i], dx = x - c.x, dy = y - c.y, rr = c.r + pad;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  // Nearest free point to (x, y), searching outwards in a spiral. Used for start positions.
  function freePoint(x, y, ctx) {
    if (!isBlocked(x, y, ctx)) return { x: x, y: y };
    for (var r = 8; r < 600; r += 8) {
      for (var a = 0; a < 16; a++) {
        var px = x + Math.cos(a / 16 * 2 * Math.PI) * r, py = y + Math.sin(a / 16 * 2 * Math.PI) * r;
        if (!isBlocked(px, py, ctx)) return { x: px, y: py };
      }
    }
    return { x: ctx.W / 2, y: ctx.H / 2 };
  }

  var TURNS = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI];

  /* Move a member by dt simulated seconds. Seeded random walk: the heading drifts a little each step; a step
     into a confident crater or off the map is replaced by the first free alternative heading, else the member waits.
     m.mode 'return' walks towards ctx.home instead of wandering. Mutates and returns m. */
  function stepMember(m, dt, ctx) {
    if (!(dt > 0)) return m;
    var left = dt;
    m.moving = false;
    while (left > 1e-9) {
      var d = Math.min(left, 5);
      left -= d;
      if (m.pause > 0) { m.pause = Math.max(0, m.pause - d); continue; }
      if (m.mode !== 'return' && rand(m) < 0.004 * d) { m.pause = 15 + rand(m) * 45; continue; }   // stops to work
      var returning = m.mode === 'return';
      if (returning) {
        var target = Math.atan2(ctx.home.y - m.y, ctx.home.x - m.x);
        m.heading = target + (rand(m) - 0.5) * 0.3;
      } else {
        m.heading += (rand(m) - 0.5) * 0.7 * Math.min(1, d / 2);
      }
      var dist = m.speed * (returning ? 1.3 : 1) * d;
      var n = Math.max(1, Math.ceil(dist / MAX_STEP_PX)), sd = dist / n;
      for (var i = 0; i < n; i++) {
        var moved = false;
        for (var k = 0; k < TURNS.length; k++) {
          var hd = m.heading + TURNS[k];
          var nx = m.x + Math.cos(hd) * sd, ny = m.y + Math.sin(hd) * sd;
          if (!isBlocked(nx, ny, ctx)) { m.x = nx; m.y = ny; if (k) m.heading = hd; moved = true; break; }
        }
        if (!moved) break;
        m.moving = true;
      }
    }
    return m;
  }

  /* Advance the suit values by dt seconds. Oxygen and battery only go down (until a resupply), heart rate follows
     activity with noise. Everything is clamped: 0..100 % and HR_MIN..HR_MAX bpm. When oxygen or battery is low the
     member heads back to ctx.home and, once there, is resupplied (m.resupplied becomes true for one call). */
  function stepVitals(m, dt, ctx) {
    if (!(dt > 0)) return m;
    m.resupplied = false;
    var act = m.moving ? 1 : (m.pause > 0 ? 0 : 0.5);
    m.o2 = clamp(m.o2 - O2_RATE * dt * (0.7 + 0.3 * act), 0, 100);
    m.bat = clamp(m.bat - BAT_RATE * dt * (0.6 + 0.4 * act), 0, 100);
    var stress = m.mode === 'return' ? 10 : 0;
    var target = m.restHr + 22 * act * (m.speed / 0.2) + stress;
    var k = Math.min(1, dt / 20);
    m.hr = clamp(m.hr + (target - m.hr) * k + (rand(m) - 0.5) * 6 * Math.min(1, Math.sqrt(dt / 5)), HR_MIN, HR_MAX);
    if (m.mode !== 'return' && (m.o2 < 20 || m.bat < 15)) m.mode = 'return';
    if (m.mode === 'return' && ctx && ctx.home) {
      var dx = m.x - ctx.home.x, dy = m.y - ctx.home.y;
      if (dx * dx + dy * dy < 40 * 40) { m.o2 = 100; m.bat = 100; m.mode = 'explore'; m.resupplied = true; }
    }
    return m;
  }

  // Status flags for a vitals snapshot {oxygenPct, batteryPct, heartRate}. Text + icon, never only colour.
  var LIMITS = { o2Low: 25, o2Crit: 10, batLow: 25, batCrit: 10, hrHigh: 120, hrCrit: 150, hrLow: 50 };
  function flags(v) {
    var out = [];
    if (v.oxygenPct < LIMITS.o2Crit) out.push({ key: 'oxygen', level: 'critical', icon: '⛔', text: 'Oxygen critical' });
    else if (v.oxygenPct < LIMITS.o2Low) out.push({ key: 'oxygen', level: 'low', icon: '⚠', text: 'Oxygen low' });
    if (v.batteryPct < LIMITS.batCrit) out.push({ key: 'battery', level: 'critical', icon: '⛔', text: 'Battery critical' });
    else if (v.batteryPct < LIMITS.batLow) out.push({ key: 'battery', level: 'low', icon: '⚠', text: 'Battery low' });
    if (v.heartRate >= LIMITS.hrCrit) out.push({ key: 'heart', level: 'critical', icon: '⛔', text: 'Heart rate very high' });
    else if (v.heartRate >= LIMITS.hrHigh) out.push({ key: 'heart', level: 'high', icon: '▲', text: 'Heart rate high' });
    else if (v.heartRate < LIMITS.hrLow) out.push({ key: 'heart', level: 'low', icon: '▼', text: 'Heart rate low' });
    return out;
  }

  var DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // From (x1,y1) to (x2,y2) in page px (y grows downwards, north is up). -> {m, deg, dir}
  function distBearing(x1, y1, x2, y2, mpp) {
    var dx = x2 - x1, dy = y1 - y2;
    var deg = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
    return { m: Math.sqrt(dx * dx + dy * dy) * (mpp || MPP), deg: deg, dir: DIRS[Math.round(deg / 45) % 8] };
  }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m / 10) * 10 + ' m'; }

  function cleanText(s) {
    return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
  }

  /* Canned, context-aware reply. ctx = {name, oxygenPct, batteryPct, heartRate, mode, distanceM, dir}.
     rand01 is a 0..1 function. Returns text only; the UI flags it as simulated. */
  function replyFor(text, ctx, rand01) {
    var t = ' ' + String(text || '').toLowerCase() + ' ';
    var pick = function (a) { return a[Math.floor(rand01() * a.length) % a.length]; };
    var o2 = Math.round(ctx.oxygenPct), bat = Math.round(ctx.batteryPct), hr = Math.round(ctx.heartRate);
    var back = ctx.mode === 'return';
    var where = ctx.distanceM === null || ctx.distanceM === undefined ? '' : fmtDist(ctx.distanceM) + ' ' + ctx.dir + ' of you';
    if (/\b(sos|help|emergency|mayday)\b/.test(t)) {
      return back ? 'Copy. I am already low (' + o2 + '% oxygen) and heading to base, will relay your call.' :
        'Copy, heading to you now' + (where ? ' (I am ' + where + ')' : '') + '. Stay put.';
    }
    if (/\b(battery|power|charge)\b/.test(t)) {
      return 'My battery is at ' + bat + '%' + (bat < 25 ? ', getting low, I will swap soon.' : ', good for now.');
    }
    if (/\b(oxygen|o2|air)\b/.test(t)) {
      return 'Oxygen at ' + o2 + '%' + (o2 < 25 ? '. That is low, I am heading back to base.' : ', plenty left.');
    }
    if (/\b(heart|pulse|bpm|hr)\b/.test(t)) {
      return 'Heart rate is ' + hr + ' bpm' + (hr >= 120 ? ', a bit high, slowing down.' : ', steady.');
    }
    if (/\b(where|position|location|distance|far)\b/.test(t)) {
      return where ? 'I am ' + where + '.' : 'I cannot see your position right now.';
    }
    if (/\b(back|return|base|home|rtb|come)\b/.test(t)) {
      return back ? 'Already heading back to base (' + o2 + '% oxygen).' : pick(['Copy, I will head back once I finish this leg.', 'Understood. Wrapping up, then returning to base.']);
    }
    if (/\b(hello|hi|hey|ping|status|how)\b/.test(t)) {
      return 'Hi! Oxygen ' + o2 + '%, battery ' + bat + '%, heart rate ' + hr + ' bpm' + (back ? ', heading back to base.' : '.');
    }
    if (/\b(thanks|thank|ok|okay|copy|roger)\b/.test(t)) return pick(['Roger.', 'Copy that.', 'Understood.']);
    return (back ? 'Message noted. I am heading back to base, oxygen at ' + o2 + '%.' :
      pick(['Copy that. Continuing the traverse, I will report at the next waypoint.', 'Noted. Nothing unusual on my side.', 'Understood, carrying on.']));
  }

  // Chat storage helpers (store = {get,set}); keys are per teammate.
  function chatKey(id) { return 'team.chat.' + id; }
  function loadChat(store, id) {
    var raw = store.get(chatKey(id), []);
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (m) { return m && typeof m.text === 'string' && typeof m.t === 'string' && typeof m.from === 'string'; })
      .map(function (m) { return { t: m.t, from: m.from, text: m.text.slice(0, MAX_LEN), sim: !!m.sim }; }).slice(-100);
  }
  function saveChat(store, id, list) { store.set(chatKey(id), list.slice(-100)); }

  var DEFAULTS = [
    // speed in page px/s: 0.22 px/s = 1.2 m/s and 0.18 px/s = 1.0 m/s at about 5.55 m/px (normal walking pace)
    // fx, fy: start point as a fraction of the map (two fixed points on the delta / crater floor, away from the corner)
    { id: 'jayesh', name: 'Jayesh', rs: 1101, o2: 82, bat: 71, restHr: 68, speed: 0.22, fx: 0.47, fy: 0.5 },
    { id: 'juhyeok', name: 'Juhyeok', rs: 2202, o2: 23, bat: 58, restHr: 74, speed: 0.18, fx: 0.38, fy: 0.64 }
  ];

  function makeMembers(ctx) {
    return DEFAULTS.map(function (d) {
      var p = freePoint(ctx.W * d.fx, ctx.H * d.fy, ctx);
      return { id: d.id, name: d.name, rs: d.rs, x: p.x, y: p.y, heading: (d.rs % 628) / 100, speed: d.speed, o2: d.o2, bat: d.bat,
        hr: d.restHr, restHr: d.restHr, mode: 'explore', pause: 0, moving: false, resupplied: false };
    });
  }

  var Logic = {
    MPP: MPP, MAX_LEN: MAX_LEN, LIMITS: LIMITS, HR_MIN: HR_MIN, HR_MAX: HR_MAX, DEFAULTS: DEFAULTS,
    rand: rand, blockedCraters: blockedCraters, isBlocked: isBlocked, freePoint: freePoint, stepMember: stepMember,
    stepVitals: stepVitals, flags: flags, distBearing: distBearing, fmtDist: fmtDist, cleanText: cleanText,
    replyFor: replyFor, chatKey: chatKey, loadChat: loadChat, saveChat: saveChat, makeMembers: makeMembers, metersPerPx: metersPerPx
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logic;
  if (typeof window === 'undefined') return;
  window.TeamLogic = Logic;
  if (!window.Atlas) return;

  /* ======================= Part 2: UI ======================= */
  var Atlas = window.Atlas, h = Atlas.h;
  var data = window.JEZERO_CRATERS || { craters: [] };
  var mpp = metersPerPx(data.meta);
  var ctx = { W: Atlas.W, H: Atlas.H, blocks: blockedCraters(data, 0.6), margin: 12, pad: 6, home: null };
  // "Base" = the start point of the user (Atlas.me when this script loads, i.e. the landing site clamped to the map)
  var start = Atlas.me && isFinite(Atlas.me.x) ? { x: Atlas.me.x, y: Atlas.me.y } : { x: Atlas.W - 24, y: Atlas.H / 2 };
  ctx.home = { x: start.x, y: start.y };

  var members = makeMembers(ctx);
  (function restore() {
    var saved = Atlas.store.get('team.state', null);
    if (!saved || saved.v !== 2 || !Array.isArray(saved.members)) return;
    saved.members.forEach(function (s) {
      var m = members.filter(function (q) { return q.id === s.id; })[0];
      if (!m || !s) return;
      var okNum = function (v, lo, hi) { return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi; };
      if (okNum(s.x, 0, ctx.W) && okNum(s.y, 0, ctx.H) && !isBlocked(s.x, s.y, ctx) && okNum(s.o2, 0, 100) && okNum(s.bat, 0, 100) && okNum(s.hr, HR_MIN, HR_MAX) &&
        typeof s.rs === 'number' && isFinite(s.rs) && okNum(s.heading, -1e4, 1e4)) {
        m.x = s.x; m.y = s.y; m.o2 = s.o2; m.bat = s.bat; m.hr = s.hr; m.rs = s.rs | 0; m.heading = s.heading;
        m.mode = s.mode === 'return' ? 'return' : 'explore';
      }
    });
  })();

  function snapshot(m, t) {   // the "telemetry packet" the cards show
    m.tel = { t: t.toISOString(), oxygenPct: Math.round(m.o2 * 10) / 10, batteryPct: Math.round(m.bat * 10) / 10, heartRate: Math.round(m.hr) };
  }
  var t0 = Atlas.now();
  members.forEach(function (m, i) { snapshot(m, t0); m.nextTel = t0.getTime() + 10000 + i * 5000; });

  function meOf() { return Atlas.me && isFinite(Atlas.me.x) && isFinite(Atlas.me.y) ? Atlas.me : null; }
  function relTo(m) {
    var me = meOf();
    return me ? distBearing(me.x, me.y, m.x, m.y, mpp) : null;
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hms(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }
  function hm(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }

  Atlas.team = {
    members: function () {
      return members.map(function (m) {
        return { id: m.id, name: m.name, x: m.x, y: m.y, oxygenPct: m.tel.oxygenPct, batteryPct: m.tel.batteryPct, heartRate: m.tel.heartRate,
          lastUpdate: m.tel.t, status: m.mode === 'return' ? 'returning to base' : 'on traverse', simulated: true };
      });
    },
    open: function (id) { return openChat(id); }
  };

  /* ---------- map layer ---------- */
  var layerG = Atlas.el('g', { id: 'layer-team', class: 'team-layer' });
  var markers = {};
  members.forEach(function (m) {
    var gg = Atlas.el('g', { class: 'team-mk', tabindex: '0', role: 'button' }, layerG);
    var k = Atlas.el('g', { class: 'k' }, gg);
    Atlas.el('circle', { r: 17, fill: 'transparent' }, k);
    Atlas.el('polygon', { points: '0,-11 10,0 0,11 -10,0', class: 'team-shape' }, k);
    Atlas.el('circle', { r: 2.6, fill: '#fff' }, k);
    var lab = Atlas.el('text', { x: 15, y: 5, class: 'team-lab' }, k);
    lab.textContent = m.name + ' (sim)';
    gg.addEventListener('click', function (e) { if (Atlas.pick && Atlas.pick.busy && Atlas.pick.busy()) return; e.stopPropagation(); selectMember(m.id, false); });
    gg.addEventListener('keydown', function (e) {
      if (Atlas.pick && Atlas.pick.busy && Atlas.pick.busy()) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectMember(m.id, false); }
    });
    markers[m.id] = gg;
  });
  function placeMarkers() {
    members.forEach(function (m) {
      var g = markers[m.id];
      g.setAttribute('transform', 'translate(' + m.x.toFixed(1) + ' ' + m.y.toFixed(1) + ')');
      var rel = relTo(m), fl = flags(vit(m));
      g.setAttribute('aria-label', m.name + ', simulated crew-mate' + (rel ? ', ' + fmtDist(rel.m) + ' ' + rel.dir + ' of you' : '') +
        (fl.length ? ', ' + fl.map(function (f) { return f.text; }).join(', ') : '') + '. Press Enter to show details.');
      g.setAttribute('class', 'team-mk' + (fl.length ? ' alert' : '') + (selected === m.id ? ' sel' : ''));
    });
  }
  Atlas.registerLayer({ id: 'team', label: 'Team (simulated)', group: 'Crew', color: '#2fd0a0', node: layerG, on: true, count: members.length });

  function vit(m) { return { oxygenPct: m.tel.oxygenPct, batteryPct: m.tel.batteryPct, heartRate: m.tel.heartRate }; }

  /* ---------- tab UI ---------- */
  var root, listEl, chatBox, liveEl, cards = {}, selected = null, chatId = null, logEl, inputEl, sendBtn, countEl, chatTitle;
  var unread = Atlas.store.get('team.unread', {});
  if (!unread || typeof unread !== 'object') unread = {};
  var lastFlagKeys = {};

  function panelEl() { return root && root.closest ? root.closest('.tabpanel') : null; }
  function tabVisible() { var p = panelEl(); return !!p && !p.hidden; }

  function meter(label, id) {
    var fill = h('div', { class: 'tm-fill' });
    var bar = h('div', { class: 'tm-bar', attrs: { role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' } }, fill);
    var val = h('span', { class: 'tm-val' }), flag = h('span', { class: 'tm-flag' });
    return { row: h('div', { class: 'tm-row' }, [h('span', { class: 'tm-lbl', text: label }), bar, val, flag]), fill: fill, bar: bar, val: val, flag: flag };
  }

  function buildCard(m) {
    var c = { m: m };
    c.o2 = meter('Oxygen'); c.bat = meter('Battery'); c.hr = meter('Heart');
    c.status = h('span', { class: 'tm-status' });
    c.meta = h('p', { class: 'tm-meta' });
    c.badge = h('span', { class: 'tm-badge', hidden: true });
    c.focusBtn = h('button', { type: 'button', class: 'tm-focus', attrs: { 'aria-label': 'Show ' + m.name + ' on the map' }, onclick: function () { selectMember(m.id, false); } }, [
      h('span', { class: 'tm-name', text: m.name }), h('span', { class: 'tm-sim', text: 'simulated crew' }), c.status
    ]);
    c.chatBtn = h('button', { type: 'button', class: 'tm-chatbtn', attrs: { 'aria-label': 'Chat with ' + m.name } }, [h('span', { attrs: { 'aria-hidden': 'true' }, text: '💬 ' }), 'Chat', c.badge]);
    c.chatBtn.addEventListener('click', function () { openChat(m.id); });
    c.el = h('article', { class: 'tm-card', attrs: { 'data-id': m.id, 'aria-label': m.name + ' (simulated crew-mate)' } },
      [c.focusBtn, c.o2.row, c.bat.row, c.hr.row, c.meta, h('div', { class: 'tm-actions' }, c.chatBtn)]);
    return c;
  }

  function setMeter(mt, pct, text, f) {
    mt.fill.style.width = clamp(pct, 0, 100) + '%';
    mt.bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    mt.bar.setAttribute('aria-valuetext', text + (f ? ', ' + f.text : ''));
    mt.val.textContent = text;
    mt.flag.textContent = f ? f.icon + ' ' + f.text.replace(/^(Oxygen|Battery|Heart rate) /, '') : '';
    mt.row.className = 'tm-row' + (f ? ' ' + f.level : '');
  }

  function renderCard(m) {
    var c = cards[m.id]; if (!c) return;
    var v = vit(m), fl = flags(v), by = {};
    fl.forEach(function (f) { by[f.key] = f; });
    setMeter(c.o2, v.oxygenPct, v.oxygenPct.toFixed(0) + ' %', by.oxygen);
    setMeter(c.bat, v.batteryPct, v.batteryPct.toFixed(0) + ' %', by.battery);
    setMeter(c.hr, (v.heartRate - 40) / 1.4, v.heartRate + ' bpm', by.heart);
    c.status.textContent = m.mode === 'return' ? '↩ returning to base' : (m.moving ? '→ on traverse' : '• working');
    var rel = relTo(m);
    c.meta.textContent = 'Updated ' + hms(new Date(m.tel.t)) + ' · ' + (rel ? fmtDist(rel.m) + ' ' + rel.dir + ' (' + Math.round(rel.deg) + '°) from you' : 'distance unknown (your position is not available)');
    var n = unread[m.id] || 0;
    c.badge.hidden = !n; c.badge.textContent = n > 9 ? '9+' : String(n);
    c.badge.setAttribute('aria-label', n + ' unread message' + (n === 1 ? '' : 's'));
    c.el.classList.toggle('sel', selected === m.id);
    // announce only when a flag appears (polite live region), never on every update
    var key = fl.map(function (f) { return f.key + f.level; }).join(',');
    if (key !== lastFlagKeys[m.id]) {
      var fresh = fl.filter(function (f) { return (lastFlagKeys[m.id] || '').indexOf(f.key + f.level) < 0; });
      if (fresh.length && lastFlagKeys[m.id] !== undefined && liveEl) liveEl.textContent = m.name + ' (simulated): ' + fresh.map(function (f) { return f.text; }).join(', ') + '.';
      lastFlagKeys[m.id] = key;
    }
  }
  function renderAll() { members.forEach(renderCard); placeMarkers(); updateDockBadge(); }

  function totalUnread() { return members.reduce(function (s, m) { return s + (unread[m.id] || 0); }, 0); }
  // Only used for the unread badge (and the openTab fallback). The label changes with unread, so match by prefix.
  function dockBtn() { return document.querySelector('.dock-tab[aria-label^="Team tab"]'); }
  function updateDockBadge() {
    var btn = dockBtn(); if (!btn) return;
    var b = btn.querySelector('.tm-dockbadge'), n = totalUnread();
    if (!n) { if (b) b.parentNode.removeChild(b); btn.setAttribute('aria-label', 'Team tab'); return; }
    if (!b) { b = h('span', { class: 'tm-dockbadge' }); btn.appendChild(b); }
    b.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', 'Team tab, ' + n + ' unread message' + (n === 1 ? '' : 's'));
  }

  function setUnread(id, n) {
    if (n) unread[id] = n; else delete unread[id];
    Atlas.store.set('team.unread', unread);
    renderCard(byId(id)); updateDockBadge();
  }
  function byId(id) { return members.filter(function (m) { return m.id === id; })[0]; }

  function showTab() {
    if (typeof Atlas.openTab === 'function') { Atlas.openTab('team', true); return; }
    var btn = dockBtn();   // fallback for a shell without Atlas.openTab
    if (btn && btn.getAttribute('aria-pressed') !== 'true') btn.click();
  }

  function selectMember(id, openingChat) {
    var m = byId(id); if (!m) return;
    selected = id;
    showTab();
    Atlas.focus(m.x, m.y, 3);
    renderAll();
    var c = cards[id];
    if (c && c.el.scrollIntoView && !openingChat) { try { c.el.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }
    clearTimeout(selectMember.t);
    selectMember.t = setTimeout(function () { if (selected === id) { selected = null; renderAll(); } }, 4000);
  }

  /* ---------- chat ---------- */
  function renderMsg(msg, m) {
    var mine = msg.from === 'me';
    var who = mine ? 'You' : m.name;
    var when = hm(new Date(msg.t));
    var meta = h('div', { class: 'tm-mmeta' }, [who + ' · ' + when, !mine && msg.sim ? h('span', { class: 'tm-simtag', text: 'simulated reply' }) : null]);
    return h('div', { class: 'tm-msg ' + (mine ? 'me' : 'them') }, [meta, h('p', { class: 'tm-mtext', text: msg.text })]);   // text only ever via textContent
  }
  function renderLog() {
    var m = byId(chatId); if (!m) return;
    while (logEl.firstChild) logEl.removeChild(logEl.firstChild);
    var list = loadChat(Atlas.store, chatId);
    if (!list.length) logEl.appendChild(h('p', { class: 'tm-empty', text: 'No messages yet. Replies from ' + m.name + ' are simulated.' }));
    list.forEach(function (msg) { logEl.appendChild(renderMsg(msg, m)); });
    logEl.scrollTop = logEl.scrollHeight;
  }
  function openChat(id) {
    var m = byId(id); if (!m || !root) { if (m && !root) { showTab(); return openChat(id); } return false; }
    chatId = id; showTab();
    chatBox.hidden = false;
    chatTitle.textContent = 'Chat with ' + m.name + ' (simulated)';
    logEl.setAttribute('aria-label', 'Messages with ' + m.name);
    inputEl.setAttribute('aria-label', 'Message to ' + m.name);
    renderLog();
    if (unread[id]) setUnread(id, 0);
    Object.keys(cards).forEach(function (k) { cards[k].chatBtn.setAttribute('aria-expanded', k === id ? 'true' : 'false'); });
    try { chatBox.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
    inputEl.focus();
    return true;
  }
  function closeChat() {
    var prev = chatId; chatId = null; chatBox.hidden = true;
    Object.keys(cards).forEach(function (k) { cards[k].chatBtn.setAttribute('aria-expanded', 'false'); });
    if (prev && cards[prev]) cards[prev].chatBtn.focus();
  }
  function appendMsg(id, msg) {
    var list = loadChat(Atlas.store, id); list.push(msg); saveChat(Atlas.store, id, list);
    if (chatId === id) {
      var m = byId(id), empty = logEl.querySelector('.tm-empty');
      if (empty) logEl.removeChild(empty);
      logEl.appendChild(renderMsg(msg, m)); logEl.scrollTop = logEl.scrollHeight;
    }
  }
  function sendMessage() {
    var text = cleanText(inputEl.value);
    if (!text || !chatId) { updateSend(); return false; }
    var id = chatId, m = byId(id);
    appendMsg(id, { t: Atlas.now().toISOString(), from: 'me', text: text, sim: false });
    inputEl.value = ''; updateSend();
    var delay = 1500 + rand(m) * 2500;   // real milliseconds, "typing" time
    setTimeout(function () { simulatedReply(id, text); }, delay);
    return true;
  }
  function simulatedReply(id, text) {
    var m = byId(id); if (!m) return;
    var rel = relTo(m);
    var reply = replyFor(text, { name: m.name, oxygenPct: m.tel.oxygenPct, batteryPct: m.tel.batteryPct, heartRate: m.tel.heartRate,
      mode: m.mode, distanceM: rel ? rel.m : null, dir: rel ? rel.dir : '' }, function () { return rand(m); });
    appendMsg(id, { t: Atlas.now().toISOString(), from: id, text: reply, sim: true });
    if (!(chatId === id && tabVisible())) {
      setUnread(id, (unread[id] || 0) + 1);
      Atlas.toast(m.name + ' (simulated): ' + reply.slice(0, 80), 'info');
    }
  }
  function updateSend() {
    var n = inputEl.value.length;
    sendBtn.disabled = !cleanText(inputEl.value);
    countEl.textContent = n + '/' + MAX_LEN;
  }

  function render(container) {
    root = container;
    liveEl = h('p', { class: 'tm-sr', attrs: { role: 'status', 'aria-live': 'polite' } });
    listEl = h('div', { class: 'tm-list' });
    members.forEach(function (m) { cards[m.id] = buildCard(m); listEl.appendChild(cards[m.id].el); });
    chatTitle = h('h3', { class: 'tm-ctitle', id: 'tm-ctitle' });
    logEl = h('div', { class: 'tm-log', tabindex: '0', attrs: { role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions' } });
    inputEl = h('input', { type: 'text', id: 'tm-input', class: 'tm-input', maxlength: String(MAX_LEN), autocomplete: 'off' });
    countEl = h('span', { class: 'tm-count', attrs: { 'aria-hidden': 'true' } });
    sendBtn = h('button', { type: 'submit', class: 'tm-send', text: 'Send' });
    var form = h('form', { class: 'tm-form' }, [
      h('label', { class: 'tm-sr', attrs: { for: 'tm-input' }, text: 'Message' }),
      h('div', { class: 'tm-inrow' }, [inputEl, sendBtn]), countEl
    ]);
    form.addEventListener('submit', function (e) { e.preventDefault(); sendMessage(); });
    inputEl.addEventListener('input', updateSend);
    chatBox = h('section', { class: 'tm-chat', hidden: true, attrs: { 'aria-labelledby': 'tm-ctitle' } }, [
      h('div', { class: 'tm-chead' }, [chatTitle, h('button', { type: 'button', class: 'tm-cx', text: '✕', attrs: { 'aria-label': 'Close chat' }, onclick: closeChat })]),
      h('p', { class: 'tm-note', text: 'Simulated crew: replies are canned and made up by this app, not sent by a person.' }),
      logEl, form
    ]);
    chatBox.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeChat(); } });
    root.appendChild(h('p', { class: 'tm-note', text: 'Simulated crew. There is no real team feed: positions, suit values and replies are generated. They walk at about 1 m/s and head back to base (your start point) when low on oxygen or battery. Values refresh about every 10 s.' }));
    root.appendChild(liveEl); root.appendChild(listEl); root.appendChild(chatBox);
    updateSend();
    renderAll();
  }

  Atlas.registerTab({ id: 'team', title: 'Team', icon: '👥', order: 30, render: render });

  /* ---------- simulation loop (driven by Atlas.clock) ---------- */
  var lastSim = Atlas.now().getTime(), ticks = 0;
  function tick() {
    var nowD = Atlas.now(), now = nowD.getTime();
    var dt = (now - lastSim) / 1000; lastSim = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1200);
    members.forEach(function (m) {
      stepMember(m, dt, ctx);
      stepVitals(m, dt, ctx);
      if (m.resupplied) {
        if (m.tel) { /* shown at next packet */ }
        Atlas.toast(m.name + ' (simulated) is back at base and resupplied', 'info');
      }
      if (now >= m.nextTel) { snapshot(m, nowD); m.nextTel = now + 10000; }
    });
    if (root) members.forEach(renderCard);
    placeMarkers();
    if (++ticks % 5 === 0) save();
  }
  function save() {
    Atlas.store.set('team.state', { v: 2, members: members.map(function (m) { return { id: m.id, x: m.x, y: m.y, o2: m.o2, bat: m.bat, hr: m.hr, rs: m.rs, heading: m.heading, mode: m.mode }; }) });
  }
  setInterval(tick, 1000);
  window.addEventListener('beforeunload', save);
  var meT = null;
  Atlas.bus.on('me:moved', function () { if (meT) return; meT = setTimeout(function () { meT = null; if (root) members.forEach(renderCard); placeMarkers(); }, 1000); });
  Atlas.bus.on('tab:toggled', function (e) {
    if (e && e.id === 'team' && e.open && chatId && unread[chatId]) setUnread(chatId, 0);
    if (e && e.id === 'team') updateDockBadge();
  });
  placeMarkers();
  updateDockBadge();
})();
