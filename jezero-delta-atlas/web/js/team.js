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
    if (v.oxygenPct < LIMITS.o2Crit) out.push({ key: 'oxygen', level: 'critical', icon: '■', text: 'Oxygen critical' });
    else if (v.oxygenPct < LIMITS.o2Low) out.push({ key: 'oxygen', level: 'low', icon: '▲', text: 'Oxygen low' });
    if (v.batteryPct < LIMITS.batCrit) out.push({ key: 'battery', level: 'critical', icon: '■', text: 'Battery critical' });
    else if (v.batteryPct < LIMITS.batLow) out.push({ key: 'battery', level: 'low', icon: '▲', text: 'Battery low' });
    if (v.heartRate >= LIMITS.hrCrit) out.push({ key: 'heart', level: 'critical', icon: '■', text: 'Heart rate very high' });
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

  /* Where a teammate is, in words: 'returning to base' | 'on traverse' (moving) | 'at base' (within AT_BASE_M of base camp) | 'at stop N' (record has stopId) | 'stopped'.
     m = {mode, moving, x, y, stopId}; base = {x, y} in page px; mpp = metres per page px. Without a base position a stationary member is 'stopped'. */
  var AT_BASE_M = 100;
  function statusLabel(m, base, mpp) {
    if (m.mode === 'return') return 'returning to base';
    if (m.moving) return 'on traverse';
    if (base && isFinite(base.x) && isFinite(base.y) && isFinite(m.x) && isFinite(m.y) && Math.hypot(m.x - base.x, m.y - base.y) * (mpp || MPP) <= AT_BASE_M) return 'at base';
    var n = m.stopId ? /(\d+)$/.exec(String(m.stopId)) : null;
    return n ? 'at stop ' + n[1] : 'stopped';
  }

  var Logic = {
    statusLabel: statusLabel, AT_BASE_M: AT_BASE_M,
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

  var members = makeMembers(ctx), walkers = members;   // walkers: internal fallback crew, used only when JdaWorld has no data
  (function restore() {
    var saved = Atlas.store.get('team.state', null);
    if (!saved || saved.v !== 2 || !Array.isArray(saved.members)) return;
    saved.members.forEach(function (s) {
      if (!s || typeof s !== 'object') return;
      var m = members.filter(function (q) { return q.id === s.id; })[0];
      if (!m) return;
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

  function baseXY() { var b = Atlas.base; return b && isFinite(b.x) ? { x: b.x, y: b.y } : ctx.home; }
  function statusOf(m) { return statusLabel(m, baseXY(), mpp); }
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
          lastUpdate: m.tel.t, status: statusOf(m), simulated: !worldOn };
      });
    },
    open: function (id) { return openChat(id); }
  };

  /* ---------- map layer ---------- */
  var layerG = Atlas.el('g', { id: 'layer-team', class: 'team-layer' });
  var markers = {};
  function ensureMarker(m) {
    if (markers[m.id]) return;
    var gg = Atlas.el('g', { class: 'team-mk', tabindex: '0', role: 'button' }, layerG);
    var k = Atlas.el('g', { class: 'k' }, gg);
    Atlas.el('circle', { r: 17, fill: 'transparent' }, k);
    Atlas.el('polygon', { points: '0,-11 10,0 0,11 -10,0', class: 'team-shape' }, k);
    Atlas.el('circle', { r: 2.6, fill: '#fff' }, k);
    var lab = Atlas.el('text', { x: 15, y: 5, class: 'team-lab' }, k);
    lab.textContent = m.name; gg._lab = lab;
    gg.addEventListener('click', function (e) { if (Atlas.pick && Atlas.pick.busy && Atlas.pick.busy()) return; e.stopPropagation(); selectMember(m.id, false); });
    gg.addEventListener('keydown', function (e) {
      if (Atlas.pick && Atlas.pick.busy && Atlas.pick.busy()) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); selectMember(m.id, false); }
    });
    markers[m.id] = gg;
  }
  members.forEach(ensureMarker);
  function placeMarkers() {
    members.forEach(function (m) {
      var g = markers[m.id]; if (!g) return;
      if (g._lab && g._lab.textContent !== m.name) g._lab.textContent = m.name;
      g.setAttribute('transform', 'translate(' + m.x.toFixed(1) + ' ' + m.y.toFixed(1) + ')');
      var rel = relTo(m), fl = flags(vit(m));
      g.setAttribute('aria-label', m.name + ', crew member' + (rel ? ', ' + fmtDist(rel.m) + ' ' + rel.dir + ' of you' : '') +
        (fl.length ? ', ' + fl.map(function (f) { return f.text; }).join(', ') : '') + '. Press Enter to show details.');
      g.setAttribute('class', 'team-mk' + (fl.length ? ' alert' : '') + (selected === m.id ? ' sel' : ''));
    });
  }
  Atlas.registerLayer({ id: 'team', label: 'Team', group: 'Crew', color: '#2fd0a0', node: layerG, on: true, count: members.length });

  function vit(m) { return { oxygenPct: m.tel.oxygenPct, batteryPct: m.tel.batteryPct, heartRate: m.tel.heartRate }; }

  /* ---------- tab UI ---------- */
  var root, listEl, chatBox, liveEl, cards = {}, selected = null, chatId = null, logEl, inputEl, sendBtn, countEl, chatTitle;
  var unread = Atlas.store.get('team.unread', {});
  if (!unread || typeof unread !== 'object' || Array.isArray(unread)) unread = {};
  Object.keys(unread).forEach(function (k) { var n = unread[k]; if (typeof n !== 'number' || !isFinite(n) || n <= 0) delete unread[k]; else unread[k] = Math.min(999, Math.floor(n)); });
  var lastFlagKeys = {};
  var extraUnread = 0;   // unread real messages in conversations that are not a teammate card (All crew, Earth control)

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
      h('span', { class: 'tm-name', text: m.name }), c.status
    ]);
    c.chatBtn = h('button', { type: 'button', class: 'tm-chatbtn', attrs: { 'aria-label': 'Chat with ' + m.name } }, [h('span', { attrs: { 'aria-hidden': 'true' } }, [Atlas.icon('chat', 14)]), ' Chat', c.badge]);
    c.chatBtn.addEventListener('click', function () { openChat(m.id); });
    c.el = h('article', { class: 'tm-card', attrs: { 'data-id': m.id, 'aria-label': m.name + ', crew member' } },
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
    var sl = statusOf(m); c.status.textContent = (sl === 'returning to base' ? '↩ ' : sl === 'on traverse' ? '→ ' : '• ') + sl;
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
      if (fresh.length && lastFlagKeys[m.id] !== undefined && liveEl) liveEl.textContent = m.name + ': ' + fresh.map(function (f) { return f.text; }).join(', ') + '.';
      lastFlagKeys[m.id] = key;
    }
  }
  function renderAll() { members.forEach(renderCard); placeMarkers(); updateDockBadge(); }

  function totalUnread() { return members.reduce(function (s, m) { return s + (unread[m.id] || 0); }, 0) + extraUnread; }
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

  /* ---------- chat: one real chat (JdaChat over a JdaLink room) ----------
     Messages are person to person. This tab never answers on anybody's behalf: there are no automatic replies.
     (replyFor() stays in Part 1 as pure logic with its tests, but the UI does not call it.) Without a joined room
     the chat box only explains that a room is needed. */
  var realChat = null, realHost = null, realCode = null, roomBtn = null, noRoomNote = null;
  function roomJoined() { return !!(window.JdaLink && window.JdaLink.room && window.JdaChat); }
  function realPeers() {
    var me = window.JdaLink.room.id, list = members.filter(function (m) { return m.id !== me; }).map(function (m) { return { id: m.id, name: m.name }; });
    try {
      (window.JdaLink.presence() || []).forEach(function (p) {
        if (p && p.id && p.role !== 'earth' && p.role !== 'control' && p.role !== 'legacy' && p.id !== me && !list.some(function (q) { return q.id === p.id; })) list.push({ id: p.id, name: p.name || p.id });
      });
    } catch (e) { /* no presence yet */ }
    return list;
  }
  function syncReal() {
    if (roomBtn) roomBtn.hidden = !roomJoined();
    if (!roomJoined()) return;
    var room = window.JdaLink.room;
    if (realChat && realCode === room.code + '|' + room.id) return;
    if (realChat) { realChat.destroy(); realChat = null; }
    realCode = room.code + '|' + room.id;
    if (!realHost) realHost = h('div', { class: 'tm-real' });
    realChat = window.JdaChat.mount(realHost, { link: window.JdaLink, meId: room.id, meName: room.name, peers: realPeers, allowEarth: true, initial: chatId || 'all' });
    realChat.onUnread(function (total, by) {
      var sum = 0;
      members.forEach(function (m) { var n = by[m.id] || 0; sum += n; if ((unread[m.id] || 0) !== n) setUnread(m.id, n); });
      extraUnread = Math.max(0, total - sum); updateDockBadge();
    });
    if (root) mountReal();
  }
  function mountReal() { if (realHost && chatBox && realHost.parentNode !== chatBox) chatBox.insertBefore(realHost, noRoomNote); if (noRoomNote) noRoomNote.hidden = !!realChat; }
  function showChatBox(title) {
    showTab(); syncReal();
    chatBox.hidden = false; chatTitle.textContent = title; mountReal();
    try { chatBox.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ }
  }
  function openChat(id) {
    var m = byId(id); if (!m) return false;
    if (!root) { showTab(); if (!root) return false; }
    chatId = id; showChatBox('Chat with ' + m.name);
    if (realChat) { realChat.select(id); realChat.markRead(); realChat.focus(); }
    if (unread[id]) setUnread(id, 0);
    Object.keys(cards).forEach(function (k) { cards[k].chatBtn.setAttribute('aria-expanded', k === id ? 'true' : 'false'); });
    return true;
  }
  function openRoomChat() {   // group / Earth conversations (not tied to a teammate card)
    if (!root) { showTab(); if (!root) return; }
    chatId = null; showChatBox('Room chat');
    if (realChat) { realChat.select('all'); realChat.markRead(); realChat.focus(); }
    Object.keys(cards).forEach(function (k) { cards[k].chatBtn.setAttribute('aria-expanded', 'false'); });
  }
  function closeChat() {
    var prev = chatId; chatId = null; chatBox.hidden = true;
    Object.keys(cards).forEach(function (k) { cards[k].chatBtn.setAttribute('aria-expanded', 'false'); });
    if (prev && cards[prev]) cards[prev].chatBtn.focus();
  }

  /* ---------- crew list: the shared world (JdaWorld) when it has data, else the internal walkers ---------- */
  var worldOn = false, wMembers = {};
  function worldApi() { var W = window.JdaWorld; try { return W && W.world && W.world() && W.crew ? W : null; } catch (e) { return null; } }
  function numOr(v, d) { v = Number(v); return isFinite(v) ? v : d; }
  function reconcile(list) {
    var same = list.length === members.length && list.every(function (m, i) { return members[i] === m; });
    if (same) return;
    members = list;
    var keep = {}; list.forEach(function (m) { keep[m.id] = 1; });
    Object.keys(markers).forEach(function (k) { if (!keep[k]) { if (markers[k].parentNode) markers[k].parentNode.removeChild(markers[k]); delete markers[k]; } });
    list.forEach(ensureMarker);
    if (root) {
      Object.keys(cards).forEach(function (k) { if (!keep[k]) { if (cards[k].el.parentNode) cards[k].el.parentNode.removeChild(cards[k].el); delete cards[k]; } });
      list.forEach(function (m) { if (!cards[m.id]) cards[m.id] = buildCard(m); listEl.appendChild(cards[m.id].el); });
      if (chatId && !keep[chatId]) closeChat();
    }
    renderAll();
  }
  function syncWorld() {
    var W = worldApi();
    if (!W) { worldOn = false; reconcile(walkers); return; }
    worldOn = true;
    var me = W.id(), when = W.time(), list = [];
    W.crew().forEach(function (r) {
      if (!r || !r.id || r.id === me) return;
      var m = wMembers[r.id] || (wMembers[r.id] = { id: String(r.id), name: String(r.id), x: ctx.home.x, y: ctx.home.y });
      m.name = String(r.name || r.id).replace(/\s+/g, ' ').trim().slice(0, 24) || m.id;
      m.x = numOr(r.x, m.x); m.y = numOr(r.y, m.y);
      m.mode = r.mode === 'returning' ? 'return' : 'explore'; m.moving = r.mode === 'walking' || r.mode === 'returning'; m.stopId = typeof r.stopId === 'string' ? r.stopId : null;
      m.tel = { t: when.toISOString(), oxygenPct: Math.round(clamp(numOr(r.o2Pct, 0), 0, 100) * 10) / 10,
        batteryPct: Math.round(clamp(numOr(r.batPct, 0), 0, 100) * 10) / 10, heartRate: Math.round(clamp(numOr(r.hr, 70), HR_MIN, HR_MAX)) };
      list.push(m);
    });
    reconcile(list);
  }

  function render(container) {
    root = container;
    liveEl = h('p', { class: 'tm-sr', attrs: { role: 'status', 'aria-live': 'polite' } });
    listEl = h('div', { class: 'tm-list' });
    members.forEach(function (m) { cards[m.id] = buildCard(m); listEl.appendChild(cards[m.id].el); });
    chatTitle = h('h3', { class: 'tm-ctitle', id: 'tm-ctitle' });
    noRoomNote = h('p', { class: 'tm-note', text: 'Join a room (room code) to chat with your crew and Earth control.' });
    chatBox = h('section', { class: 'tm-chat', hidden: true, attrs: { 'aria-labelledby': 'tm-ctitle' } }, [
      h('div', { class: 'tm-chead' }, [chatTitle, h('button', { type: 'button', class: 'tm-cx', attrs: { 'aria-label': 'Close chat' }, onclick: closeChat }, [Atlas.icon('close', 12)])]),
      noRoomNote
    ]);
    mountReal();
    chatBox.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); closeChat(); } });
    root.appendChild(h('p', { class: 'tm-note', text: 'Your teammates: position and suit values, updated about every second. Use Chat to talk to them.' }));
    roomBtn = h('button', { type: 'button', class: 'tm-chatbtn tm-roombtn', hidden: !roomJoined(), text: 'Room chat: all crew, Earth control', onclick: openRoomChat });
    root.appendChild(liveEl); root.appendChild(roomBtn); root.appendChild(listEl); root.appendChild(chatBox);
    renderAll();
  }

  Atlas.registerTab({ id: 'team', title: 'Team', icon: 'team', order: 30, render: render });

  /* ---------- simulation loop (driven by Atlas.clock) ---------- */
  var lastSim = Atlas.now().getTime(), ticks = 0;
  function tick() {
    syncReal();
    syncWorld();
    if (worldOn) { lastSim = Atlas.now().getTime(); if (root) members.forEach(renderCard); placeMarkers(); return; }
    var nowD = Atlas.now(), now = nowD.getTime();
    var dt = (now - lastSim) / 1000; lastSim = now;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1200);
    members.forEach(function (m) {
      stepMember(m, dt, ctx);
      stepVitals(m, dt, ctx);
      if (m.resupplied) {
        if (m.tel) { /* shown at next packet */ }
        Atlas.toast(m.name + ' is back at base and resupplied', 'info');
      }
      if (now >= m.nextTel) { snapshot(m, nowD); m.nextTel = now + 10000; }
    });
    if (root) members.forEach(renderCard);
    placeMarkers();
    if (++ticks % 5 === 0) save();
  }
  function save() {
    Atlas.store.set('team.state', { v: 2, members: walkers.map(function (m) { return { id: m.id, x: m.x, y: m.y, o2: m.o2, bat: m.bat, hr: m.hr, rs: m.rs, heading: m.heading, mode: m.mode }; }) });
  }
  setInterval(tick, 1000);
  window.addEventListener('beforeunload', save);
  var meT = null;
  Atlas.bus.on('me:moved', function () { if (meT) return; meT = setTimeout(function () { meT = null; if (root) members.forEach(renderCard); placeMarkers(); }, 1000); });
  Atlas.bus.on('tab:toggled', function (e) {
    if (e && e.id === 'team' && e.open && chatId && unread[chatId]) setUnread(chatId, 0);
    if (e && e.id === 'team' && e.open && realChat) realChat.markRead();
    if (e && e.id === 'team') updateDockBadge();
  });
  placeMarkers();
  updateDockBadge();
})();
