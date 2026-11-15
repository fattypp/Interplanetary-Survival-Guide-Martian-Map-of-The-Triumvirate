/* Suit feature: simulated suit telemetry, radiation alerts, astronaut position (Atlas.me), personal stats, health check.
   Contract: docs/ARCHITECTURE.md. EVERYTHING here is a labelled simulation: there is no real suit, radiation or vitals feed.
   Structure: (1) SuitModel = pure functions (also exported for Node / browser tests), (2) UI + wiring, only when window.Atlas exists. */
(function (root) {
  'use strict';

  /* ================= (1) PURE MODEL ================= */

  /* Constants (all simulated, chosen to be plausible and easy to reason about).
     Consumption is in percent of a full tank / full battery per SIMULATED hour. */
  var C = {
    O2_PER_H:   { resting: 4,  walking: 9, working: 12 },   // full tank lasts 25 h resting, ~11 h walking, ~8 h working
    BAT_PER_H:  { resting: 3,  walking: 6, working: 8 },    // battery: 33 h resting, ~17 h walking, 12.5 h working
    JITTER: 0.10,            // consumption varies +-5% per step (seeded, so repeatable)
    WALK_MPS: 1.4,           // walking speed in metres per simulated second
    CAUTION_PCT: 25,         // oxygen / battery caution below this
    CRITICAL_PCT: 10,        // oxygen / battery critical below this
    PCT_HYST: 3,             // a resource level is left only after recovering this many points above its threshold
    RAD_CAUTION_FRAC: 0.8,   // fallback: caution = 80% of the danger limit when no usable limits.caution is given
    RAD_HYST: 0.9,           // a radiation level is left only below 90% of its threshold
    REPEAT_MIN: 15,          // re-alert while a non-nominal level persists, every N simulated minutes
    MAX_DT_H: 4,             // longest simulated span handled per tick (a closed page does not "catch up")
    SUBSTEP_MIN: 5           // radiation is sampled at least every 5 simulated minutes of a long tick
  };
  var RANK = { nominal: 0, caution: 1, danger: 2 };

  function num(v, fb) { v = Number(v); return isFinite(v) ? v : fb; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* seeded generator (mulberry32): same seed, same sequence */
  function rng(seed) {
    var a = (num(seed, 1) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function activityKey(a) { return C.O2_PER_H[a] !== undefined ? a : 'resting'; }

  function freshState(seed) { return { oxygenPct: 100, batteryPct: 100, doseMSv: 0, seed: (num(seed, 20260101) >>> 0) || 1 }; }

  function sanitize(s) {
    s = s || {};
    return {
      oxygenPct: clamp(num(s.oxygenPct, 100), 0, 100),
      batteryPct: clamp(num(s.batteryPct, 100), 0, 100),
      doseMSv: Math.max(0, num(s.doseMSv, 0)),
      seed: (num(s.seed, 1) >>> 0) || 1
    };
  }

  /* One simulation step. dtH = simulated hours (>=0), ctx = {activity, radiation (uSv/h or null)}.
     Pure: returns a new state, never mutates. Consumption clamps at 0; dose only grows. */
  function step(state, dtH, ctx) {
    var s = sanitize(state);
    ctx = ctx || {};
    dtH = num(dtH, 0); if (dtH < 0) dtH = 0;
    var act = activityKey(ctx.activity);
    var r = rng(s.seed);
    var j = 1 + (r() - 0.5) * C.JITTER;
    var rad = num(ctx.radiation, 0); if (rad < 0) rad = 0;
    return {
      oxygenPct: clamp(s.oxygenPct - C.O2_PER_H[act] * j * dtH, 0, 100),
      batteryPct: clamp(s.batteryPct - C.BAT_PER_H[act] * j * dtH, 0, 100),
      doseMSv: s.doseMSv + rad * dtH / 1000,           // uSv/h * h = uSv; /1000 = mSv
      seed: Math.floor(r() * 4294967296) >>> 0
    };
  }

  /* Hours until the first of oxygen/battery runs out at the CURRENT activity (no jitter). */
  function hoursRemaining(state, activity) {
    var s = sanitize(state), a = activityKey(activity);
    var o = s.oxygenPct / C.O2_PER_H[a], b = s.batteryPct / C.BAT_PER_H[a];
    return o <= b ? { hours: o, limiting: 'oxygen' } : { hours: b, limiting: 'battery' };
  }

  /* Radiation thresholds from Atlas.radiation.limits: danger = the suit's resistance, caution = approaching it. */
  function radThresholds(limits) {
    var danger = limits ? num(limits.danger, NaN) : NaN;
    if (!(danger > 0)) return null;
    var caution = num(limits.caution, NaN);
    if (!(caution > 0 && caution < danger)) caution = danger * C.RAD_CAUTION_FRAC;
    return { caution: caution, danger: danger };
  }

  /* Level of a dose rate with hysteresis: enter a level at its threshold, leave it only below RAD_HYST * threshold. */
  function radLevel(rate, prev, limits) {
    var t = radThresholds(limits), x = num(rate, NaN);
    if (!t || !isFinite(x)) return 'nominal';
    prev = RANK[prev] !== undefined ? prev : 'nominal';
    var lvl = x >= t.danger ? 'danger' : x >= t.caution ? 'caution' : 'nominal';
    if (RANK[lvl] < RANK[prev]) {                       // dropping: only if clearly below the threshold of the previous level
      var hold = prev === 'danger' ? t.danger : t.caution;
      if (x >= hold * C.RAD_HYST) lvl = prev;
      else if (prev === 'danger' && x >= t.caution * C.RAD_HYST) lvl = 'caution';
    }
    return lvl;
  }

  /* Oxygen / battery level with hysteresis ('danger' here means critical). */
  function pctLevel(pct, prev) {
    var x = num(pct, NaN); if (!isFinite(x)) return 'nominal';
    prev = RANK[prev] !== undefined ? prev : 'nominal';
    var lvl = x < C.CRITICAL_PCT ? 'danger' : x < C.CAUTION_PCT ? 'caution' : 'nominal';
    if (RANK[lvl] < RANK[prev]) {
      var hold = prev === 'danger' ? C.CRITICAL_PCT : C.CAUTION_PCT;
      if (x < hold + C.PCT_HYST) lvl = prev;
      else if (prev === 'danger' && x < C.CAUTION_PCT + C.PCT_HYST) lvl = 'caution';
    }
    return lvl;
  }

  /* Alert once when a non-nominal level is entered or changes, then repeat every repeatMs while it persists. */
  function shouldAlert(prevLevel, level, lastAlertMs, nowMs, repeatMs) {
    if (level === 'nominal' || RANK[level] === undefined) return false;
    if (level !== prevLevel) return true;
    var last = num(lastAlertMs, -Infinity), now = num(nowMs, 0);
    return now - last >= num(repeatMs, C.REPEAT_MIN * 60000);
  }

  /* Overall suit condition: worst of radiation, oxygen, battery. */
  function condition(levels) {
    var w = 0;
    ['radiation', 'oxygen', 'battery'].forEach(function (k) { if (levels && RANK[levels[k]] > w) w = RANK[levels[k]]; });
    return ['nominal', 'caution', 'critical'][w];
  }

  /* metres per page pixel: same formula as the scale bar / route planner (bbox width and page width); falls back to meta.m_per_px */
  function metersPerPx(meta) {
    meta = meta || {};
    var b = meta.bbox, pg = meta.page;
    if (b && pg && pg[0] > 0) {
      var m = (b.lon1 - b.lon0) * 59270 * Math.cos(((b.lat0 + b.lat1) / 2) * Math.PI / 180) / pg[0];
      if (isFinite(m) && m > 0) return m;
    }
    return num(meta.m_per_px, 5.5) || 5.5;
  }

  /* Advance along a polyline by distM metres. walk = {pts:[[x,y]..], i} (i = index of next point). Returns new position and whether done. */
  function advance(pos, walk, distM, mpp) {
    var x = pos.x, y = pos.y, left = Math.max(0, num(distM, 0)) / (mpp > 0 ? mpp : 5.5), i = walk.i;
    while (i < walk.pts.length && left > 0) {
      var tx = walk.pts[i][0], ty = walk.pts[i][1], d = Math.hypot(tx - x, ty - y);
      if (d <= left) { x = tx; y = ty; left -= d; i++; }
      else { x += (tx - x) * left / d; y += (ty - y) * left / d; left = 0; }
    }
    return { x: x, y: y, i: i, done: i >= walk.pts.length };
  }

  /* ----- personal stats (simulated) ----- */

  function hash(n) { return rng(Math.floor(num(n, 0)) | 0)(); }   // 0..1 from an integer

  /* ctx: {activity, oxygenPct, sleepHours, hoursAwake, hoursSinceMeal}. salt varies the noise (health checks). Deterministic. */
  function vitals(simMs, ctx, salt) {
    ctx = ctx || {}; salt = num(salt, 0);
    var a = activityKey(ctx.activity), minute = Math.floor(num(simMs, 0) / 60000);
    var r = rng(minute * 31 + salt * 7919 + 17);
    var noise = function (amp) { return (r() - 0.5) * 2 * amp; };
    var sleep = clamp(num(ctx.sleepHours, 7), 0, 14), awake = clamp(num(ctx.hoursAwake, 8), 0, 48), meal = clamp(num(ctx.hoursSinceMeal, 3), 0, 24);
    var o2 = clamp(num(ctx.oxygenPct, 100), 0, 100);
    var load = { resting: 0, walking: 0.8, working: 1.2 }[a];
    var fatigue = clamp(0.3 * awake + load + (sleep < 6 ? (6 - sleep) * 0.6 : 0), 0, 10);
    var hr = 60 + { resting: 0, walking: 25, working: 35 }[a] + fatigue * 1.2 + (o2 < 20 ? 10 : 0) + noise(3);
    var spo2 = 98 - (o2 < 15 ? 3 : 0) - (o2 < 5 ? 4 : 0) + noise(0.8);
    var temp = 36.6 + { resting: 0, walking: 0.2, working: 0.4 }[a] + noise(0.15);
    var hyd = 98 - 3.2 * meal - load * 2 + noise(1.5);
    return {
      heartRate: Math.round(hr), spo2: Math.round(clamp(spo2, 70, 100)), temperatureC: Math.round(temp * 10) / 10,
      fatigue: Math.round(fatigue * 10) / 10, hydration: Math.round(clamp(hyd, 0, 100)), sleepHours: Math.round(sleep * 10) / 10
    };
  }

  /* Plain-language flags for abnormal values (empty array = all normal). */
  function flags(v) {
    var f = [];
    if (!v) return f;
    if (v.heartRate > 100) f.push('Heart rate high (' + v.heartRate + ' bpm)'); else if (v.heartRate < 50) f.push('Heart rate low (' + v.heartRate + ' bpm)');
    if (v.spo2 < 95) f.push('SpO2 low (' + v.spo2 + '%)');
    if (v.temperatureC > 37.8) f.push('Body temperature high (' + v.temperatureC + ' °C)'); else if (v.temperatureC < 36.0) f.push('Body temperature low (' + v.temperatureC + ' °C)');
    if (v.fatigue >= 7) f.push('Fatigue high (' + v.fatigue + '/10)');
    if (v.hydration < 60) f.push('Hydration low (' + v.hydration + '%)');
    if (v.sleepHours < 6) f.push('Short sleep (' + v.sleepHours + ' h)');
    return f;
  }

  /* Fallback daily rhythm when there is no schedule: sleep 23:00-06:30 and meals 07/13/19 h of the clock that is `offsetMin`
     minutes ahead of UTC. The pure function defaults to 0 (UTC) so tests are deterministic; the UI passes the browser's local offset. */
  function rhythm(simMs, offsetMin) {
    var shifted = num(simMs, 0) + num(offsetMin, 0) * 60000;
    var d = new Date(shifted), hod = d.getUTCHours() + d.getUTCMinutes() / 60;
    var day = Math.floor(shifted / 86400000);
    var mealHours = [7, 13, 19], since = 24;
    mealHours.forEach(function (m) { var x = (hod - m + 24) % 24; if (x < since) since = x; });
    return { hoursAwake: (hod - 6.5 + 24) % 24, hoursSinceMeal: since, sleepHours: 6 + 2 * hash(day) };
  }

  /* Derive sleep / awake / meal from schedule blocks [{start,end,type}] (ISO strings); falls back to rhythm(). */
  function fromSchedule(blocks, simMs, offsetMin) {
    var base = rhythm(simMs, offsetMin);
    if (!Array.isArray(blocks) || !blocks.length) { base.source = 'model'; return base; }
    var sleepMs = 0, lastSleepEnd = -Infinity, lastMeal = -Infinity, any = false, from = simMs - 86400000;
    blocks.forEach(function (b) {
      var s = Date.parse(b && b.start), e = Date.parse(b && b.end);
      if (!isFinite(s) || !isFinite(e)) return;
      if (b.type === 'sleep') {
        any = true;
        sleepMs += Math.max(0, Math.min(e, simMs) - Math.max(s, from));
        if (e <= simMs && e > lastSleepEnd) lastSleepEnd = e;
      } else if (b.type === 'meal' && e <= simMs && e > lastMeal) lastMeal = e;
    });
    var out = { source: 'schedule', sleepHours: base.sleepHours, hoursAwake: base.hoursAwake, hoursSinceMeal: base.hoursSinceMeal };
    if (any && sleepMs > 0) out.sleepHours = sleepMs / 3600000;
    if (isFinite(lastSleepEnd)) out.hoursAwake = (simMs - lastSleepEnd) / 3600000;
    if (isFinite(lastMeal)) out.hoursSinceMeal = (simMs - lastMeal) / 3600000;
    if (!any && !isFinite(lastMeal)) out.source = 'model';
    return out;
  }

  function fmtAgo(ms) {
    ms = num(ms, 0);
    if (ms < 60000) return 'just now';
    var m = Math.floor(ms / 60000);
    if (m < 60) return m + ' min ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + ' h ' + (m % 60) + ' min ago';
    return Math.floor(h / 24) + ' d ' + (h % 24) + ' h ago';
  }

  var SuitModel = {
    C: C, rng: rng, freshState: freshState, sanitize: sanitize, step: step, hoursRemaining: hoursRemaining,
    radThresholds: radThresholds, radLevel: radLevel, pctLevel: pctLevel, shouldAlert: shouldAlert, condition: condition,
    metersPerPx: metersPerPx, advance: advance, vitals: vitals, flags: flags, rhythm: rhythm, fromSchedule: fromSchedule, fmtAgo: fmtAgo
  };
  root.SuitModel = SuitModel;
  if (typeof module !== 'undefined' && module.exports) module.exports = SuitModel;

  /* ================= (2) UI + WIRING ================= */
  var Atlas = root.Atlas;
  if (!Atlas || typeof document === 'undefined') return;
  var h = Atlas.h, el = Atlas.el, store = Atlas.store;

  var meta = (root.JEZERO_CRATERS && root.JEZERO_CRATERS.meta) || {};
  var MPP = metersPerPx(meta);
  var W = Atlas.W, H = Atlas.H;

  /* ---- persisted state ---- */
  var START = { x: Atlas.me.x, y: Atlas.me.y };   // initial start point (nearest map edge to the landing site), before a saved position is restored
  var saved = store.get('suit.state', null);
  var S = saved ? sanitize(saved) : freshState(20260101);
  var working = !!store.get('suit.working', false);
  var meSaved = store.get('suit.me', null);
  if (meSaved && isFinite(meSaved.x) && isFinite(meSaved.y) && meSaved.x >= 0 && meSaved.x <= W && meSaved.y >= 0 && meSaved.y <= H) {
    Atlas.me.x = meSaved.x; Atlas.me.y = meSaved.y;
  }
  var history = store.get('health.history', []);
  if (!Array.isArray(history)) history = [];
  history = history.slice(-20);

  var walk = null;               // {pts, i, note}
  var activity = 'resting';
  var radNow = null;             // uSv/h or null (no data)
  var levels = { radiation: 'nominal', oxygen: 'nominal', battery: 'nominal' };
  var lastAlert = { radiation: -Infinity, oxygen: -Infinity, battery: -Infinity };
  var lastAlertReal = { radiation: 0, oxygen: 0, battery: 0 };
  var lastSim = Atlas.now().getTime();   // no catch-up for time while the page was closed
  var moveMode = false;
  var tpArmed = false;           // 'Jump (demo)' armed: the next map click teleports instead of walking
  var ui = null;                 // refs of the suit tab once rendered
  var pui = null;                // refs of the personal tab

  function radiation() { return Atlas.radiation && typeof Atlas.radiation.at === 'function' ? Atlas.radiation : null; }
  function limits() { var r = radiation(); return r && r.limits ? r.limits : null; }

  function sample() {
    var r = radiation();
    if (!r) return null;
    try { var v = Number(r.at(Atlas.me.x, Atlas.me.y)); return isFinite(v) && v >= 0 ? v : null; } catch (e) { return null; }
  }

  function currentBlock(nowMs) {
    try {
      if (!Atlas.schedule || typeof Atlas.schedule.get !== 'function') return null;
      var list = Atlas.schedule.get() || [];
      for (var i = 0; i < list.length; i++) {
        var s = Date.parse(list[i].start), e = Date.parse(list[i].end);
        if (nowMs >= s && nowMs < e) return list[i];
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* walking follows the user's movement; otherwise "working" if toggled on or the schedule says mission/task; else resting */
  function pickActivity(nowMs) {
    if (walk) return 'walking';
    if (working) return 'working';
    var b = currentBlock(nowMs);
    return b && (b.type === 'mission' || b.type === 'task') ? 'working' : 'resting';
  }

  /* ---- alerts ---- */
  function alertText(kind, level, v) {
    var t = radThresholds(limits());
    // radiation: wording follows the VALUE (a level held by hysteresis just under the limit still says "close to")
    var sev = kind === 'radiation' ? (t && v >= t.danger ? 'ABOVE' : 'close to') : (level === 'danger' ? 'critical' : 'low');
    if (kind === 'radiation') {
      var u = (radiation() && radiation().unit) || 'µSv/h';
      return 'Radiation ' + sev + ' suit resistance: ' + v.toFixed(1) + ' ' + u + (t ? ' (limit ' + t.danger + ')' : '') + ' (simulated)';
    }
    return (kind === 'oxygen' ? 'Oxygen ' : 'Battery ') + sev + ': ' + Math.round(v) + '% (simulated)';
  }
  function evalAlerts(nowMs) {
    var vals = { radiation: radNow, oxygen: S.oxygenPct, battery: S.batteryPct };
    ['radiation', 'oxygen', 'battery'].forEach(function (k) {
      var prev = levels[k];
      var lvl = k === 'radiation' ? (radNow === null ? 'nominal' : radLevel(radNow, prev, limits())) : pctLevel(vals[k], prev);
      var fire = shouldAlert(prev, lvl, lastAlert[k], nowMs, C.REPEAT_MIN * 60000);
      // repeats also need 60 real seconds, so a fast demo clock cannot spam; level changes always fire
      if (fire && lvl === prev && Date.now() - lastAlertReal[k] < 60000) fire = false;
      levels[k] = lvl;
      if (fire) {
        lastAlert[k] = nowMs; lastAlertReal[k] = Date.now();
        var text = alertText(k, lvl, vals[k]);
        Atlas.bus.emit('suit:alert', { level: lvl === 'danger' ? 'danger' : 'caution', text: text, kind: k });
        Atlas.toast(text, lvl === 'danger' ? 'danger' : 'warn');
      } else if (lvl === 'nominal' && prev !== 'nominal') {
        Atlas.toast((k === 'radiation' ? 'Radiation' : k === 'oxygen' ? 'Oxygen' : 'Battery') + ' back to normal (simulated)', 'info');
        lastAlert[k] = -Infinity;
      }
    });
  }

  /* ---- simulation tick ---- */
  function tick() {
    var nowMs = Atlas.now().getTime();
    var dtMs = nowMs - lastSim; lastSim = nowMs;
    if (!isFinite(dtMs) || dtMs < 0) dtMs = 0;
    var dtH = Math.min(dtMs / 3600000, C.MAX_DT_H);
    activity = pickActivity(nowMs);
    var n = Math.max(1, Math.min(48, Math.ceil(dtH * 60 / C.SUBSTEP_MIN)));
    var sub = dtH / n, moved = false, doneWalk = false;
    for (var i = 0; i < n; i++) {
      var act = walk ? 'walking' : activity;
      if (walk) {
        var r = advance(Atlas.me, walk, C.WALK_MPS * sub * 3600, MPP);
        if (r.x !== Atlas.me.x || r.y !== Atlas.me.y) moved = true;
        Atlas.me.x = r.x; Atlas.me.y = r.y; walk.i = r.i;
        if (r.done) { walk = null; doneWalk = true; }
      }
      radNow = sample();
      S = step(S, sub, { activity: act, radiation: radNow });
    }
    if (doneWalk) activity = pickActivity(nowMs);
    if (moved) { Atlas.bus.emit('me:moved', { x: Atlas.me.x, y: Atlas.me.y }); drawMe(); }
    if (doneWalk) { Atlas.toast('You arrived (simulated position)', 'info'); drawMe(); }
    evalAlerts(nowMs);
    store.set('suit.state', S);
    store.set('suit.me', { x: Atlas.me.x, y: Atlas.me.y });
    refreshSuit(nowMs); refreshPersonal(nowMs);
  }

  /* ---- Atlas.suit ---- */
  function suitState() {
    var t = radThresholds(limits());
    return {
      oxygenPct: S.oxygenPct, batteryPct: S.batteryPct,
      condition: condition(levels),
      radiationNow: radNow, radiationTotalmSv: S.doseMSv,
      suitRadiationLimit: t ? t.danger : null,
      activity: activity, simulated: true
    };
  }

  function planRoute(from, to) {
    // Use the same A* planner as the Map tab (avoids detected craters). Falls back to a straight line.
    try {
      var RP = root.RoutePlanner, cr = root.JEZERO_CRATERS;
      if (RP && cr && cr.craters && meta.page) {
        if (!planRoute.grid) planRoute.grid = RP.buildGrid(cr.craters, meta);
        var res = RP.plan(planRoute.grid, [from.x, from.y], to, 1);
        if (res && res.points && res.points.length) return { pts: res.points.map(function (p) { return [p[0], p[1]]; }), note: 'planned route around craters' };
        return { pts: [[to[0], to[1]]], note: 'straight line (' + (res && res.error ? res.error : 'no route') + ')' };
      }
    } catch (e) { /* fall through */ }
    return { pts: [[to[0], to[1]]], note: 'straight line' };
  }

  function moveTo(x, y, opt) {
    x = Number(x); y = Number(y);
    if (!isFinite(x) || !isFinite(y)) return false;
    x = clamp(x, 0, W); y = clamp(y, 0, H);
    if ((opt && opt.teleport) || tpArmed) {
      tpArmed = false;
      walk = null; Atlas.me.x = x; Atlas.me.y = y;
      Atlas.bus.emit('me:moved', { x: x, y: y }); drawMe(); tick(); return true;
    }
    var p = planRoute(Atlas.me, [x, y]);
    walk = { pts: p.pts, i: 0, note: p.note, target: [x, y] };
    drawMe();
    Atlas.toast('Walking to the target at ' + C.WALK_MPS + ' m/s of mission time (' + p.note + ')', 'info');
    return true;
  }
  function stop() { walk = null; drawMe(); }

  Atlas.suit = {
    state: suitState,
    moveTo: moveTo,
    stop: stop,
    setWorking: function (b) { working = !!b; store.set('suit.working', working); },
    resupply: function () { S = freshState(S.seed); levels.oxygen = levels.battery = 'nominal'; store.set('suit.state', S); refreshSuit(Atlas.now().getTime()); },
    model: SuitModel
  };

  /* ---- health ---- */
  function context(nowMs) {
    var sc = fromSchedule((function () { try { return Atlas.schedule && Atlas.schedule.get ? Atlas.schedule.get() : null; } catch (e) { return null; } })(), nowMs, -new Date(nowMs).getTimezoneOffset());
    sc.activity = activity; sc.oxygenPct = S.oxygenPct;
    return sc;
  }
  function healthRun() {
    var nowMs = Atlas.now().getTime();
    var v = vitals(nowMs, context(nowMs), history.length + 1);
    var f = flags(v);
    var rec = {
      time: new Date(nowMs).toISOString(), heartRate: v.heartRate, spo2: v.spo2, temperatureC: v.temperatureC,
      fatigue: v.fatigue, hydration: v.hydration, sleepHours: v.sleepHours,
      notes: f.length ? f.join('; ') : 'All values within normal range (simulated)', abnormal: f
    };
    history.push(rec); history = history.slice(-20);
    store.set('health.history', history);
    Atlas.bus.emit('health:done', rec);
    Atlas.toast('Health check done (simulated): ' + (f.length ? f.length + ' value(s) to watch' : 'all normal'), f.length ? 'warn' : 'info');
    refreshPersonal(nowMs);
    return rec;
  }
  /* The health-check interval belongs to the planner config (window.JEZERO_SCHEDULE_CONFIG, normalised by ScheduleEngine). We only read it. */
  function healthConfig() {
    try {
      var E = root.ScheduleEngine, cfg = E && E.normalizeConfig ? E.normalizeConfig(root.JEZERO_SCHEDULE_CONFIG) : null;
      if (cfg && cfg.health) return { intervalHours: num(cfg.health.intervalHours, 24), enabled: cfg.health.enabled !== false };
    } catch (e) { /* fall through */ }
    return { intervalHours: 24, enabled: true };
  }
  var HEALTH_CFG = healthConfig();
  Atlas.health = {
    run: healthRun,
    last: function () { return history.length ? history[history.length - 1] : null; },
    history: function () { return history.slice(); },
    intervalHours: HEALTH_CFG.intervalHours,   // read from the planner config (schedule-config.js), see healthConfig()
    enabled: HEALTH_CFG.enabled
  };

  /* ---- map layer 'me' ---- */
  var meG = el('g', { 'data-layer': 'me' }, null);
  var meMark, mePath;
  function drawMe() {
    if (!meG.parentNode && meG.ownerSVGElement === null) { /* registerLayer moves it */ }
    while (meG.firstChild) meG.removeChild(meG.firstChild);
    if (walk) {
      var pts = [Atlas.me.x + ',' + Atlas.me.y].concat(walk.pts.slice(walk.i).map(function (p) { return p[0] + ',' + p[1]; })).join(' ');
      mePath = el('polyline', { points: pts, fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '6 5', 'vector-effect': 'non-scaling-stroke', opacity: 0.9 }, meG);
    }
    meMark = el('g', { transform: 'translate(' + Atlas.me.x + ' ' + Atlas.me.y + ')' }, meG);
    el('circle', { r: 11, fill: '#1b6fe0', stroke: '#fff', 'stroke-width': 3 }, meMark);
    el('circle', { r: 4, fill: '#fff' }, meMark);
    var t = el('text', { x: 15, y: 5, fill: '#fff', stroke: '#000', 'stroke-width': 3, 'paint-order': 'stroke', 'font-size': 14, 'font-weight': 700 }, meMark);
    t.textContent = 'You';
    var ti = el('title', {}, meMark); ti.textContent = 'You (simulated position)';
  }
  drawMe();
  Atlas.registerLayer({ id: 'me', label: 'You (simulated position)', group: 'Simulation', color: '#1b6fe0', node: meG, on: true });
  // the layer checkbox works: it hides only the marker (Atlas.me and the tab keep running)
  Atlas.bus.on('layer:changed', function (e) { if (e && e.id === 'me' && ui) refreshSuit(Atlas.now().getTime()); });

  /* "Move here" / "Jump": exclusive map pick through the shell (Atlas.pick), so it cannot fire together with the planner or mission picks */
  function startPick(teleport) {
    var label = teleport ? 'jump there (simulated demo)' : 'walk there (simulated)';
    Atlas.pick({ owner: 'suit', label: label }, function (ev) {
      if (!ev) return;
      if (teleport) tpArmed = true;
      moveTo(ev.x, ev.y);
      if (ui) refreshSuit(Atlas.now().getTime());
    });
  }
  Atlas.bus.on('pick:changed', function (e) { setMoveMode(!!(e && e.owner === 'suit')); });

  /* ================= UI: Suit tab ================= */
  var ICON = { nominal: '●', caution: '▲', critical: '■', danger: '■' };   // plain status shapes (shape + word, never colour alone)
  var WORD = { nominal: 'Nominal', caution: 'Caution', critical: 'Critical', danger: 'Critical' };

  function setMoveMode(on) {
    moveMode = !!on;
    if (ui) {
      ui.moveBtn.setAttribute('aria-pressed', moveMode ? 'true' : 'false');
      ui.moveBtn.textContent = moveMode ? 'Click the map… (Esc or click again cancels)' : 'Move here (pick a point on the map)';
    }
  }

  function gauge(label, id) {
    var fill = h('div', { class: 'su-fill' });
    var val = h('span', { class: 'su-val' });
    var icon = h('span', { class: 'su-ic', attrs: { 'aria-hidden': 'true' } });
    var track = h('div', { class: 'su-track', attrs: { role: 'meter', 'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0 } }, fill);
    var row = h('div', { class: 'su-g', 'data-g': id }, [
      h('div', { class: 'su-gh' }, [h('span', { class: 'su-lbl', text: label }), h('span', { class: 'su-gv' }, [icon, val])]), track
    ]);
    return { row: row, fill: fill, val: val, icon: icon, track: track };
  }

  function renderSuit(box) {
    box.classList.add('suit-tab');
    var banner = h('div', { class: 'su-banner ok', attrs: { role: 'status', 'aria-live': 'polite' } }, [h('span', { class: 'su-bi', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'su-bt' })]);
    var cond = h('div', { class: 'su-cond' }, [h('span', { class: 'su-ci', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'su-ct' })]);
    var gO = gauge('Oxygen', 'o2'), gB = gauge('Battery', 'bat');
    // radiation meter with the caution / danger thresholds marked
    var rFill = h('div', { class: 'su-fill' });
    var tC = h('div', { class: 'su-tick c' }), tD = h('div', { class: 'su-tick d' });
    var rTrack = h('div', { class: 'su-track su-rtrack', attrs: { role: 'meter', 'aria-label': 'Radiation now (simulated)', 'aria-valuemin': 0, 'aria-valuenow': 0 } }, [rFill, tC, tD]);
    var rVal = h('span', { class: 'su-val' }), rIc = h('span', { class: 'su-ic', attrs: { 'aria-hidden': 'true' } });
    var rLegend = h('div', { class: 'su-legend' });
    var rad = h('div', { class: 'su-g' }, [h('div', { class: 'su-gh' }, [h('span', { class: 'su-lbl', text: 'Radiation now' }), h('span', { class: 'su-gv' }, [rIc, rVal])]), rTrack, rLegend]);
    var stats = h('dl', { class: 'su-dl' });
    function stat(k) { var dd = h('dd'); stats.appendChild(h('dt', { text: k })); stats.appendChild(dd); return dd; }
    var sDose = stat('Accumulated dose'), sRem = stat('Hours remaining'), sAct = stat('Activity'), sPos = stat('Position');
    var moveBtn = h('button', { type: 'button', class: 'su-btn primary', text: 'Move here (pick a point on the map)', attrs: { 'aria-pressed': 'false' }, onclick: function () { if (moveMode) Atlas.pick.cancel('suit'); else startPick(false); } });
    var stopBtn = h('button', { type: 'button', class: 'su-btn', text: 'Stop', onclick: function () { stop(); } });
    var tpBtn = h('button', { type: 'button', class: 'su-btn', text: 'Jump to a point (demo)', attrs: { title: 'Teleports to the next point you click on the map instead of walking' },
      onclick: function () { startPick(true); } });
    var workCb = h('input', { type: 'checkbox', checked: working, onchange: function () { Atlas.suit.setWorking(workCb.checked); tick(); } });
    var resupply = h('button', { type: 'button', class: 'su-btn', text: 'Resupply oxygen and battery (simulated)', onclick: function () { Atlas.suit.resupply(); Atlas.toast('Suit resupplied (simulated)', 'info'); } });
    var note = h('p', { class: 'su-note', text: 'Simulated telemetry: there is no real suit feed. Values follow the mission clock (speed x' + Atlas.clock.speed + ') and your activity.' });
    var walkInfo = h('p', { class: 'su-note su-walk' });
    var startNote = h('p', { class: 'su-note su-start' }), markerNote = h('p', { class: 'su-note su-marker' });
    box.appendChild(h('div', { class: 'su-wrap' }, [banner, cond, gO.row, gB.row, rad, stats,
      h('div', { class: 'su-row' }, [moveBtn, stopBtn]), h('div', { class: 'su-row' }, [h('label', { class: 'su-chk' }, [workCb, ' I am working (uses more oxygen and battery)'])]),
      walkInfo, startNote, markerNote, h('div', { class: 'su-row' }, [tpBtn, resupply]), note]));
    ui = { banner: banner, cond: cond, gO: gO, gB: gB, rFill: rFill, rTrack: rTrack, tC: tC, tD: tD, rVal: rVal, rIc: rIc, rLegend: rLegend, rad: rad,
      sDose: sDose, sRem: sRem, sAct: sAct, sPos: sPos, moveBtn: moveBtn, walkInfo: walkInfo, startNote: startNote, markerNote: markerNote, workCb: workCb, note: note };
    refreshSuit(Atlas.now().getTime());
  }

  function setGauge(g, pct, level) {
    var p = clamp(num(pct, 0), 0, 100);
    g.fill.style.width = p + '%';
    g.fill.className = 'su-fill ' + (level === 'danger' ? 'bad' : level === 'caution' ? 'warn' : 'ok');
    g.val.textContent = Math.round(p) + '%  ' + WORD[level === 'danger' ? 'critical' : level];
    g.icon.textContent = ICON[level];
    g.track.setAttribute('aria-valuenow', Math.round(p));
    g.track.setAttribute('aria-valuetext', Math.round(p) + ' percent, ' + WORD[level === 'danger' ? 'critical' : level]);
  }

  function refreshSuit(nowMs) {
    if (!ui) return;
    setGauge(ui.gO, S.oxygenPct, levels.oxygen);
    setGauge(ui.gB, S.batteryPct, levels.battery);
    var c = condition(levels);
    ui.cond.className = 'su-cond ' + (c === 'critical' ? 'bad' : c === 'caution' ? 'warn' : 'ok');
    ui.cond.lastChild.textContent = 'Suit condition: ' + WORD[c] + ' (simulated)';
    ui.cond.firstChild.textContent = ICON[c];
    var t = radThresholds(limits()), u = (radiation() && radiation().unit) || 'µSv/h';
    if (radNow === null || !t) {
      ui.rad.classList.add('nodata');
      ui.rVal.textContent = radiation() ? 'no reading here' : 'no radiation data';
      ui.rIc.textContent = '–';
      ui.rLegend.textContent = radiation() ? 'The radiation layer has no limits yet.' : 'The radiation layer is not loaded, so dose is not accumulated.';
      ui.rTrack.hidden = true;
    } else {
      ui.rad.classList.remove('nodata'); ui.rTrack.hidden = false;
      var max = t.danger * 1.5, lv = levels.radiation;
      ui.rFill.style.width = clamp(radNow / max * 100, 0, 100) + '%';
      ui.rFill.className = 'su-fill ' + (lv === 'danger' ? 'bad' : lv === 'caution' ? 'warn' : 'ok');
      ui.tC.style.left = (t.caution / max * 100) + '%'; ui.tD.style.left = (t.danger / max * 100) + '%';
      ui.rVal.textContent = radNow.toFixed(1) + ' ' + u + '  ' + (lv === 'danger' ? 'ABOVE limit' : lv === 'caution' ? 'Near limit' : 'Nominal');
      ui.rIc.textContent = ICON[lv];
      ui.rTrack.setAttribute('aria-valuemax', max.toFixed(1)); ui.rTrack.setAttribute('aria-valuenow', radNow.toFixed(1));
      ui.rTrack.setAttribute('aria-valuetext', ui.rVal.textContent);
      ui.rLegend.textContent = 'Caution at ' + t.caution.toFixed(1) + ', suit resistance (danger) at ' + t.danger.toFixed(1) + ' ' + u + ' (simulated)';
    }
    ui.sDose.textContent = S.doseMSv.toFixed(3) + ' mSv (simulated)';
    var rem = hoursRemaining(S, activity);
    ui.sRem.textContent = rem.hours < 0.05 ? 'Depleted (' + rem.limiting + ')' : rem.hours.toFixed(1) + ' h, limited by ' + rem.limiting + ' at "' + activity + '"';
    ui.sAct.textContent = activity + (walk ? ' (' + walk.note + ')' : '');
    var ll = Atlas.ll(Atlas.me.x, Atlas.me.y);
    ui.sPos.textContent = ll[1].toFixed(4) + '°N, ' + ll[0].toFixed(4) + '°E';
    // banner: persistent worst state
    var worst = 'nominal', msg = 'All suit systems nominal (simulated).';
    ['radiation', 'oxygen', 'battery'].forEach(function (k) {
      if (RANK[levels[k]] > RANK[worst]) {
        worst = levels[k];
        var v = k === 'radiation' ? radNow : k === 'oxygen' ? S.oxygenPct : S.batteryPct;
        msg = alertText(k, levels[k], num(v, 0));
      }
    });
    ui.banner.className = 'su-banner ' + (worst === 'danger' ? 'bad' : worst === 'caution' ? 'warn' : 'ok');
    ui.banner.firstChild.textContent = ICON[worst];
    ui.banner.lastChild.textContent = msg;
    // honest notes: start position is not the real landing site; marker may be hidden by the layer checkbox
    var atStart = Math.hypot(Atlas.me.x - START.x, Atlas.me.y - START.y) < 1;
    var L = Atlas.landing;
    if (atStart && L && !L.onMap) {
      var km = Math.hypot(L.x - START.x, L.y - START.y) * MPP / 1000;
      ui.startNote.textContent = 'Start position: nearest map edge to the landing site, which lies about ' + km.toFixed(1) + ' km east of this map (simulated).';
    } else ui.startNote.textContent = '';
    ui.markerNote.textContent = Atlas.layers.isOn('me') ? '' : 'Your marker is hidden on the map (layer "You" is off). Your position is still tracked.';
    if (walk) {
      var rest = 0, px = Atlas.me.x, py = Atlas.me.y;
      for (var i = walk.i; i < walk.pts.length; i++) { rest += Math.hypot(walk.pts[i][0] - px, walk.pts[i][1] - py); px = walk.pts[i][0]; py = walk.pts[i][1]; }
      var m = rest * MPP;
      ui.walkInfo.textContent = 'Walking: ' + Math.round(m) + ' m to go, about ' + Math.ceil(m / C.WALK_MPS / 60) + ' min of mission time at ' + C.WALK_MPS + ' m/s.';
    } else ui.walkInfo.textContent = '';
  }

  Atlas.registerTab({ id: 'suit', title: 'Suit', icon: 'suit', order: 40, render: renderSuit });

  /* ================= UI: Personal tab ================= */
  function renderPersonal(box) {
    box.classList.add('suit-tab');
    var vals = {};
    var grid = h('div', { class: 'pe-grid' });
    [['hr', 'Heart rate'], ['spo2', 'SpO2'], ['temp', 'Body temp'], ['fat', 'Fatigue'], ['hyd', 'Hydration'], ['sleep', 'Sleep (last 24 h)']].forEach(function (k) {
      var v = h('div', { class: 'pe-v' }), f = h('div', { class: 'pe-f' });
      grid.appendChild(h('div', { class: 'pe-c' }, [h('div', { class: 'pe-k', text: k[1] }), v, f]));
      vals[k[0]] = { v: v, f: f, c: grid.lastChild };
    });
    var src = h('p', { class: 'su-note' });
    var lastBody = h('div', { class: 'pe-last' });
    var spark = h('div', { class: 'pe-spark' });
    var hist = h('ol', { class: 'pe-hist', attrs: { 'aria-label': 'Health check history' } });
    var runBtn = h('button', { type: 'button', class: 'su-btn primary', text: 'Run health check now', onclick: function () { healthRun(); } });
    box.appendChild(h('div', { class: 'su-wrap' }, [
      h('h3', { class: 'su-h', text: 'Now (simulated)' }), grid, src,
      h('h3', { class: 'su-h', text: 'Last health check' }), lastBody, h('div', { class: 'su-row' }, [runBtn]),
      h('h3', { class: 'su-h', text: 'Heart rate history' }), spark, hist,
      h('p', { class: 'su-note', text: 'Simulated vitals: not medical data. ' + (Atlas.health.enabled ? 'The planner schedules a health check every ' + Atlas.health.intervalHours + ' h (planner config).' : 'Scheduled health checks are switched off in the planner config; use the button.') })
    ]));
    pui = { vals: vals, src: src, lastBody: lastBody, spark: spark, hist: hist };
    refreshPersonal(Atlas.now().getTime());
  }

  /* local time, same style as the planner (pad2 numbers, 24 h): 2026-11-15 15:53 */
  function fmtTime(iso) {
    var d = new Date(iso); if (!isFinite(d)) return '?';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function drawSpark(box, recs) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var svg = el('svg', { viewBox: '0 0 220 56', class: 'pe-svg', role: 'img', 'aria-label': recs.length ? 'Heart rate of the last ' + recs.length + ' health checks, from ' + recs[0].heartRate + ' to ' + recs[recs.length - 1].heartRate + ' bpm' : 'No health checks yet' }, box);
    if (!recs.length) { var t0 = el('text', { x: 6, y: 32, class: 'pe-st' }, svg); t0.textContent = 'No checks yet'; return; }
    var hrs = recs.map(function (r) { return r.heartRate; }), lo = Math.min.apply(null, hrs) - 5, hi = Math.max.apply(null, hrs) + 5;
    var px = function (i) { return recs.length === 1 ? 110 : 8 + i * (204 / (recs.length - 1)); }, py = function (v) { return 48 - (v - lo) / (hi - lo) * 40; };
    el('line', { x1: 8, x2: 212, y1: py(100), y2: py(100), class: 'pe-lim' }, svg);
    el('polyline', { points: recs.map(function (r, i) { return px(i).toFixed(1) + ',' + py(r.heartRate).toFixed(1); }).join(' '), fill: 'none', class: 'pe-line' }, svg);
    recs.forEach(function (r, i) {
      var c = el('circle', { cx: px(i).toFixed(1), cy: py(r.heartRate).toFixed(1), r: 3, class: r.heartRate > 100 || r.heartRate < 50 ? 'pe-dot bad' : 'pe-dot' }, svg);
      var ti = el('title', {}, c); ti.textContent = fmtTime(r.time) + ': ' + r.heartRate + ' bpm';
    });
  }

  function refreshPersonal(nowMs) {
    if (!pui) return;
    var ctx = context(nowMs), v = vitals(nowMs, ctx, 0), f = flags(v);
    function put(k, text, bad, why) {
      var o = pui.vals[k]; o.v.textContent = text; o.f.textContent = bad ? '▲ ' + why : '● normal';
      o.c.classList.toggle('abn', !!bad);
    }
    put('hr', v.heartRate + ' bpm', v.heartRate > 100 || v.heartRate < 50, v.heartRate > 100 ? 'high' : 'low');
    put('spo2', v.spo2 + ' %', v.spo2 < 95, 'low');
    put('temp', v.temperatureC.toFixed(1) + ' °C', v.temperatureC > 37.8 || v.temperatureC < 36, v.temperatureC > 37.8 ? 'high' : 'low');
    put('fat', v.fatigue.toFixed(1) + ' / 10', v.fatigue >= 7, 'high');
    put('hyd', v.hydration + ' %', v.hydration < 60, 'low');
    put('sleep', v.sleepHours.toFixed(1) + ' h', v.sleepHours < 6, 'short');
    pui.src.textContent = 'Simulated vitals for activity "' + activity + '"; sleep and meals ' + (ctx.source === 'schedule' ? 'derived from your planner schedule.' : 'follow a plausible daily rhythm (no schedule yet).');
    var last = Atlas.health.last(), b = pui.lastBody;
    while (b.firstChild) b.removeChild(b.firstChild);
    if (!last) b.appendChild(h('p', { class: 'su-note', text: 'No health check yet. Run one below.' }));
    else {
      var ago = SuitModel.fmtAgo(nowMs - Date.parse(last.time));
      b.appendChild(h('div', { class: 'pe-lh' }, [h('strong', { text: ago }), h('span', { text: ' · ' + fmtTime(last.time) + ' local (simulated)' })]));
      b.appendChild(h('ul', { class: 'pe-lv' }, [
        h('li', { text: 'Heart rate ' + last.heartRate + ' bpm' }), h('li', { text: 'SpO2 ' + last.spo2 + ' %' }),
        h('li', { text: 'Body temp ' + last.temperatureC + ' °C' }), h('li', { text: 'Fatigue ' + last.fatigue + ' / 10' }),
        h('li', { text: 'Hydration ' + last.hydration + ' %' }), h('li', { text: 'Sleep ' + last.sleepHours + ' h' })
      ]));
      var ab = last.abnormal || [];
      b.appendChild(h('p', { class: ab.length ? 'pe-note abn' : 'pe-note', text: (ab.length ? '▲ ' : '● ') + last.notes }));
    }
    var key = history.length + ':' + (last ? last.time : '');
    if (pui.key !== key) {
      pui.key = key;
      drawSpark(pui.spark, history);
      while (pui.hist.firstChild) pui.hist.removeChild(pui.hist.firstChild);
      history.slice().reverse().forEach(function (r) {
        pui.hist.appendChild(h('li', { text: fmtTime(r.time) + ': ' + r.heartRate + ' bpm, SpO2 ' + r.spo2 + '%, ' + r.temperatureC + ' °C' + ((r.abnormal || []).length ? ' (flagged)' : '') }));
      });
    }
  }

  Atlas.registerTab({ id: 'personal', title: 'Personal', icon: 'personal', order: 50, render: renderPersonal });

  /* ---- start ---- */
  setInterval(tick, 1000);
  tick();
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
