/* sim-core.js: window.JdaSim, the crew simulation engine (pure logic, no DOM, no network).
   Contract: docs/MULTIPAGE.md (world schema, commands). Models and limits: docs/SIMULATION.md.
   Everything here is scenario data: there is no real suit, radiation or vitals feed.
   Works in a browser (window.JdaSim) and in Node (module.exports) for tests.
   Optional inputs, read if present: window.JEZERO_CRATERS (map extent), window.JEZERO_SCIENCE (radiation grid). */
(function (root) {
  'use strict';

  /* ---------------- constants ---------------- */
  var C = {
    R_MARS_M: 3389500,                 // mean radius of Mars
    SOL_S: 88775.244,                  // length of a Mars solar day in seconds
    START_ISO: '2026-11-15T08:00:00Z', // mission clock at reset (this is a scenario clock, not a real date on Mars)
    START_LOCAL_H: 9,                  // local mean solar time at the start (hours, 0..24)
    BASE: { lat: 18.4446, lon: 77.4509 },       // Octavia E. Butler landing site (from the Atlas data)
    BASELINE_USVH: 26.67,              // MSL/RAD GCR dose equivalent 0.64 mSv/day (same as the science layer)
    SPE_MULT: 2.5,                     // solar particle event multiplier (same as the science layer)
    WALK_MPS: 1.4,                     // default walking speed
    MAX_MPS: 30,                       // hard limit of the speed command
    O2_PER_H:  { rest: 4, walk: 9 },   // percent of a full tank per simulated hour (same as suit.js: resting 4, walking 9)
    BAT_PER_H: { rest: 3, walk: 6 },   // percent of a full battery per simulated hour (same as suit.js)
    EFFORT_CAP: 3,                     // effort = speed / 1.4 m/s, capped here (a faster "speed" is a vehicle, not a bigger lung)
    HR_REST: 66, HR_IDLE: 72, HR_WALK_ADD: 28, HR_TAU_S: 45,
    SUIT_NOM_C: 21, SUIT_TAU_S: 600,
    AMB_MEAN_C: -48, AMB_AMP_C: 38, AMB_PEAK_H: 14,   // clear-sky day: about -86 C at 02:00 to -10 C at 14:00 local
    DUST_AMP_FACTOR: 0.6, DUST_MEAN_SHIFT_C: 2,       // dust storm: smaller day/night swing, slightly warmer on average
    Z0_M: -2600,                       // approximate elevation of the Jezero floor (MOLA); not derived per position
    MAX_CHUNK_S: 60, MAX_CHUNKS: 400,  // physics sub-step (simulated seconds) and cap per tick
    FIELDS: ['o2Pct', 'batPct', 'hr', 'suitTempC', 'doseMsv', 'mode', 'lat', 'lon', 'headingDeg']
  };
  var M_PER_DEG = Math.PI / 180 * C.R_MARS_M;   // metres per degree of latitude (and of longitude at the equator)

  function num(v, fb) { v = Number(v); return isFinite(v) ? v : fb; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function round(v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; }
  function norm360(a) { a = a % 360; return a < 0 ? a + 360 : a; }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); }
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function rng(seed) {   // mulberry32, same as suit.js
    var a = (num(seed, 1) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- map projection (same math as atlas-map.js: core.xy / core.ll) ---------------- */
  function mapExtent() {
    var CR = root.JEZERO_CRATERS, m = (CR && CR.meta) || {}, bb = m.bbox || { lon0: 77.22318, lon1: 77.41956, lat0: 18.44176, lat1: 18.57188 };
    var pg = m.page || [1990, 1390];
    return { lon0: bb.lon0, lat1: bb.lat1, dlon: bb.lon1 - bb.lon0, dlat: bb.lat1 - bb.lat0, W: pg[0], H: pg[1] };
  }
  function xy(lat, lon) { var e = mapExtent(); return [(lon - e.lon0) / e.dlon * e.W, (e.lat1 - lat) / e.dlat * e.H]; }
  function ll(x, y) { var e = mapExtent(); return { lat: e.lat1 - y / e.H * e.dlat, lon: e.lon0 + x / e.W * e.dlon }; }

  /* ---------------- radiation grid (same data as layers-science.js, sampled by page px, clamped outside the map) ---------------- */
  var radGrid = null, radTried = false;
  function loadRad() {
    if (radTried) return radGrid; radTried = true;
    try {
      var D = root.JEZERO_SCIENCE, R = D && D.radiation;
      if (!R || !R.grid || !(R.w > 1) || !(R.h > 1)) return null;
      var bin = typeof atob === 'function' ? atob(R.grid) : Buffer.from(R.grid, 'base64').toString('binary');
      var q = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) q[i] = bin.charCodeAt(i);
      if (q.length !== R.w * R.h) return null;
      radGrid = { w: R.w, h: R.h, q: q, min: num(R.min, 0), max: num(R.max, C.BASELINE_USVH), baseline: num(R.baseline, C.BASELINE_USVH) };
    } catch (e) { radGrid = null; }
    return radGrid;
  }
  function radiationAt(x, y) {   // uSv/h without solar multiplier
    var g = loadRad();
    if (!g) return C.BASELINE_USVH;
    var e = mapExtent(), w = g.w, h = g.h;
    var gx = clamp(x / e.W * w - 0.5, 0, w - 1), gy = clamp(y / e.H * h - 0.5, 0, h - 1);
    var x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = gx - x0, fy = gy - y0, q = g.q;
    var top = q[y0 * w + x0] * (1 - fx) + q[y0 * w + x1] * fx, bot = q[y1 * w + x0] * (1 - fx) + q[y1 * w + x1] * fx;
    return g.min + (top * (1 - fy) + bot * fy) / 255 * (g.max - g.min);
  }

  /* ---------------- places and the demo path ----------------
     The atlas draws its place names on an older, larger canvas (1990 x 1848 px = 77.10-77.80 E, 18.10-18.75 N, see o2n in atlas-map.js).
     The conversion to lat/lon is replicated here. Several places lie outside the current map image; they still have valid lat/lon. */
  function o2ll(px, py) { return { lat: round(18.75 - py / 1848 * 0.65, 5), lon: round(77.1 + px / 1990 * 0.7, 5) }; }
  function place(label, px, py) { var p = o2ll(px, py); p.label = label; return p; }
  var PLACES = {
    landing: { label: 'Octavia E. Butler Landing', lat: C.BASE.lat, lon: C.BASE.lon },
    three:   place('Three Forks', 932, 862),
    hawks:   place('Hawksbill Gap', 850, 772),
    fan:     place('Upper Fan', 700, 655),
    neretva: place('Neretva Vallis', 430, 470),
    whh:     place('Witch Hazel Hill', 455, 1005),
    seitah:  place('Seitah', 890, 975)
  };
  function demoPath() {   // landing -> Three Forks -> Hawksbill Gap -> Upper Fan -> Neretva -> Witch Hazel Hill -> Seitah (then the caller sends "return")
    return ['three', 'hawks', 'fan', 'neretva', 'whh', 'seitah'].map(function (k) { var p = PLACES[k]; return { lat: p.lat, lon: p.lon, label: p.label }; });
  }

  /* ---------------- geometry on the sphere (local flat approximation, fine for kilometres) ---------------- */
  function vecM(a, b) {   // east, north metres from a to b
    var cl = Math.cos((a.lat + b.lat) / 2 * Math.PI / 180);
    return { e: (b.lon - a.lon) * M_PER_DEG * cl, n: (b.lat - a.lat) * M_PER_DEG };
  }
  function distM(a, b) { var v = vecM(a, b); return Math.sqrt(v.e * v.e + v.n * v.n); }
  function bearing(a, b) { var v = vecM(a, b); return norm360(Math.atan2(v.e, v.n) * 180 / Math.PI); }

  /* ---------------- environment ---------------- */
  function localHour(elapsedMs) { return ((C.START_LOCAL_H + elapsedMs / 1000 / C.SOL_S * 24) % 24 + 24) % 24; }
  /* hh:mm local mean solar time at a mission time (ISO string, Date or ms); the value shown on the control page and the helmet */
  function localMarsTime(t) {
    var ms = (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t)) - Date.parse(C.START_ISO);
    if (!isFinite(ms)) return '--:--';
    var lh = localHour(ms), hh = Math.floor(lh), mm = Math.floor((lh - hh) * 60);
    return (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  }
  function ambientC(elapsedMs, dust) {
    var amp = C.AMB_AMP_C * (dust ? C.DUST_AMP_FACTOR : 1), mean = C.AMB_MEAN_C + (dust ? C.DUST_MEAN_SHIFT_C : 0);
    return mean + amp * Math.cos(2 * Math.PI * (localHour(elapsedMs) - C.AMB_PEAK_H) / 24);
  }

  /* ---------------- the engine ---------------- */
  function create(opts) {
    opts = opts || {};
    var seed = (num(opts.seed, 20260101) >>> 0) || 1;
    var rand = rng(seed);
    var startMs = Date.parse(opts.startISO || C.START_ISO);
    var initCrew = (opts.crew && opts.crew.length ? opts.crew : [{ id: 'jayesh', name: 'Jayesh' }, { id: 'juhyeok', name: 'Juhyeok' }]).map(function (c) { return copyCrewInit(c); });
    var initClock = clamp(num(opts.clockSpeed, 1), 0.01, 100000);

    var elapsedMs, clock, events, crew, order;

    function copyCrewInit(c) {
      var id = slug(c.id || c.name) || 'crew';
      return { id: id, name: String(c.name || cap(id)).slice(0, 24), lat: isFinite(Number(c.lat)) && c.lat !== null && c.lat !== '' ? Number(c.lat) : null, lon: isFinite(Number(c.lon)) && c.lon !== null && c.lon !== '' ? Number(c.lon) : null };
    }
    function makeCrew(c, index) {
      // crew without a position start around the base, a few metres apart (deterministic, not random)
      var a = index * 2.4, r = 6 + 4 * index;
      var lat = c.lat !== null ? c.lat : C.BASE.lat + Math.cos(a) * r / M_PER_DEG;
      var lon = c.lon !== null ? c.lon : C.BASE.lon + Math.sin(a) * r / (M_PER_DEG * Math.cos(C.BASE.lat * Math.PI / 180));
      return {
        id: c.id, name: c.name, lat: clamp(lat, -90, 90), lon: lon, zM: C.Z0_M, headingDeg: 0,
        o2: 100, bat: 100, hr: C.HR_IDLE, hrNoise: 0, hrOverride: null, suitT: C.SUIT_NOM_C, dose: 0,
        mode: 'idle', thenReturn: false, walkSpeed: C.WALK_MPS, speed: 0, target: null, path: [], headingWalk: false, rad: C.BASELINE_USVH, amb: 0
      };
    }
    function reset() {
      elapsedMs = 0; clock = initClock; events = { solar: false, dust: false };
      rand = rng(seed);
      crew = {}; order = [];
      initCrew.forEach(function (c, i) { crew[c.id] = makeCrew(c, i); order.push(c.id); });
      refreshEnv(crew, 0);
    }

    function refreshEnv() {
      order.forEach(function (id) {
        var c = crew[id], p = xy(c.lat, c.lon);
        c.amb = ambientC(elapsedMs, events.dust);
        c.rad = radiationAt(p[0], p[1]) * (events.solar ? C.SPE_MULT : 1);
      });
    }

    function addCrew(spec) {
      var c = copyCrewInit(spec || {});
      if (crew[c.id]) { var n = 2; while (crew[c.id + '-' + n]) n++; c.id = c.id + '-' + n; }
      if (order.length >= 12) return { ok: false, error: 'crew limit (12) reached' };
      initCrew.push(c);
      crew[c.id] = makeCrew(c, order.length); order.push(c.id);
      refreshEnv();
      return { ok: true, id: c.id };
    }
    function removeCrew(id) {
      if (!crew[id]) return { ok: false, error: 'unknown crew ' + id };
      delete crew[id]; order = order.filter(function (k) { return k !== id; });
      initCrew = initCrew.filter(function (c) { return c.id !== id; });
      return { ok: true };
    }

    /* ---- one physics step of ds simulated seconds ---- */
    function stepCrew(c, ds) {
      // 1. movement
      var moving = false, remaining = 0, startLat = c.lat, startLon = c.lon;
      if (c.mode === 'walking' || c.mode === 'returning') {
        remaining = c.walkSpeed * ds;
        var guard = 0;
        while (remaining > 1e-6 && guard++ < 64) {
          if (c.headingWalk && !c.target) {
            var h = c.headingDeg * Math.PI / 180;
            c.lat = clamp(c.lat + Math.cos(h) * remaining / M_PER_DEG, -89.9, 89.9);
            c.lon += Math.sin(h) * remaining / (M_PER_DEG * Math.max(0.05, Math.cos(c.lat * Math.PI / 180)));
            remaining = 0; break;
          }
          if (!c.target) { c.mode = 'idle'; break; }
          var d = distM(c, c.target);
          if (d > 0.01) c.headingDeg = bearing(c, c.target);
          if (d <= remaining) {
            c.lat = c.target.lat; c.lon = c.target.lon; remaining -= d;
            if (c.path.length) c.target = c.path.shift();
            else if (c.thenReturn && c.mode === 'walking') {   // end of an excursion: head home
              c.thenReturn = false; c.target = { lat: C.BASE.lat, lon: C.BASE.lon, label: 'Base' }; c.mode = 'returning';
            } else {
              c.target = null;
              if (c.mode === 'returning') { c.mode = 'resting'; } else { c.mode = 'idle'; }
              break;
            }
          } else {
            var f = remaining / d;
            c.lat += (c.target.lat - c.lat) * f; c.lon += (c.target.lon - c.lon) * f;
            remaining = 0;
          }
        }
        moving = c.mode === 'walking' || c.mode === 'returning' || distM({ lat: startLat, lon: startLon }, c) > 0.01;
      }
      c.speed = moving ? c.walkSpeed : 0;
      var dH = ds / 3600;
      // 2. consumption: standing/resting uses the base rate, walking adds in proportion to speed
      var effort = moving ? Math.min(c.walkSpeed / C.WALK_MPS, C.EFFORT_CAP) : 0;
      var jitter = 1 + (rand() - 0.5) * 0.1;
      var restO2 = c.mode === 'resting' ? C.O2_PER_H.rest * 0.9 : C.O2_PER_H.rest;
      var restBat = c.mode === 'resting' ? C.BAT_PER_H.rest * 0.9 : C.BAT_PER_H.rest;
      c.o2 = clamp(c.o2 - (restO2 + (C.O2_PER_H.walk - C.O2_PER_H.rest) * effort) * jitter * dH, 0, 100);
      c.bat = clamp(c.bat - (restBat + (C.BAT_PER_H.walk - C.BAT_PER_H.rest) * effort) * jitter * dH, 0, 100);
      // 3. environment at the new position
      var p = xy(c.lat, c.lon);
      c.amb = ambientC(elapsedMs, events.dust);
      c.rad = radiationAt(p[0], p[1]) * (events.solar ? C.SPE_MULT : 1);
      c.dose += c.rad * dH / 1000;   // uSv/h * h = uSv; / 1000 = mSv
      // 4. heart rate: first-order lag towards a target (unless the operator pinned it)
      var tHr = (c.mode === 'resting' ? C.HR_REST : C.HR_IDLE) + C.HR_WALK_ADD * effort * (moving ? 1 : 0) + (c.o2 < 20 ? 10 : 0) + (c.o2 <= 0 ? 25 : 0);
      c.hr += (tHr - c.hr) * (1 - Math.exp(-ds / C.HR_TAU_S));
      c.hrNoise = (rand() - 0.5) * 4;
      // 5. suit temperature: life support holds ~21 C; walking adds heat, a cold exterior leaks a little in; with a dead battery it drifts to ambient
      var tSuit = c.bat > 0 ? C.SUIT_NOM_C + 0.8 * effort + (c.amb + 48) * 0.02 : c.amb;
      c.suitT += (tSuit - c.suitT) * (1 - Math.exp(-ds / C.SUIT_TAU_S));
    }

    function tick(dtMs) {
      dtMs = num(dtMs, 0);
      if (!(dtMs > 0)) return;
      var dtS = Math.min(dtMs, 5000) / 1000 * clock;   // a stalled page never "catches up" more than 5 real seconds
      var n = Math.min(C.MAX_CHUNKS, Math.max(1, Math.ceil(dtS / C.MAX_CHUNK_S))), ds = dtS / n;
      for (var i = 0; i < n; i++) {
        elapsedMs += ds * 1000;
        for (var k = 0; k < order.length; k++) stepCrew(crew[order[k]], ds);
      }
    }

    /* ---- commands ---- */
    function pointOf(t) {
      if (!t || typeof t !== 'object') return null;
      var lat = Number(t.lat), lon = Number(t.lon);
      if (!isFinite(lat) || !isFinite(lon) || t.lat === null || t.lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 360) return null;
      return { lat: lat, lon: lon, label: t.label ? String(t.label).slice(0, 48) : '' };
    }
    function targets(c) {
      var id = c.crew;
      if (id === 'all' || id === '*') return order.map(function (k) { return crew[k]; });
      return crew[id] ? [crew[id]] : [];
    }
    function setSpeed(c, mps) { c.walkSpeed = clamp(mps, 0.1, C.MAX_MPS); }

    function command(cmd) {
      if (!cmd || typeof cmd !== 'object') return { ok: false, error: 'no command' };
      var name = String(cmd.cmd || '');
      var list;
      switch (name) {
        case 'reset': reset(); return { ok: true };
        case 'setClockSpeed':
          var n = Number(cmd.n);
          if (!isFinite(n) || n <= 0) return { ok: false, error: 'n must be a positive number' };
          clock = clamp(n, 0.01, 100000); return { ok: true };
        case 'event':
          if (cmd.solar !== undefined) events.solar = !!cmd.solar;
          if (cmd.dust !== undefined) events.dust = !!cmd.dust;
          refreshEnv(); return { ok: true };
        case 'addCrew': return addCrew(cmd);
        case 'removeCrew': return removeCrew(String(cmd.crew || ''));
        case 'walk': case 'stop': case 'return': case 'setSpeed': case 'set':
          list = targets(cmd);
          if (!list.length) return { ok: false, error: 'unknown crew ' + cmd.crew };
          break;
        default: return { ok: false, error: 'unknown command ' + name };
      }
      var err = null;
      list.forEach(function (c) {
        if (name === 'walk') {
          var wps = [];
          if (cmd.to) { var p = pointOf(cmd.to); if (!p) { err = 'bad target'; return; } wps.push(p); }
          if (Array.isArray(cmd.path)) {   // optional extension: further waypoints, visited in order
            for (var i = 0; i < cmd.path.length && i < 64; i++) { var q = pointOf(cmd.path[i]); if (!q) { err = 'bad path point ' + i; return; } wps.push(q); }
          }
          if (cmd.speed !== undefined && isFinite(Number(cmd.speed))) setSpeed(c, Number(cmd.speed));
          if (wps.length) { c.target = wps.shift(); c.path = wps; c.headingWalk = false; c.mode = 'walking'; c.thenReturn = !!cmd.thenReturn; }
          else if (cmd.heading !== undefined && isFinite(Number(cmd.heading))) { c.headingDeg = norm360(Number(cmd.heading)); c.target = null; c.path = []; c.headingWalk = true; c.mode = 'walking'; c.thenReturn = false; }
          else err = 'walk needs to {lat,lon}, path or heading';
        } else if (name === 'stop') {
          c.target = null; c.path = []; c.headingWalk = false; c.thenReturn = false; c.mode = 'idle'; c.speed = 0;
        } else if (name === 'return') {
          c.target = { lat: C.BASE.lat, lon: C.BASE.lon, label: 'Base' }; c.path = []; c.headingWalk = false; c.thenReturn = false;
          if (distM(c, c.target) < 1) { c.target = null; c.mode = 'resting'; } else c.mode = 'returning';
        } else if (name === 'setSpeed') {
          var m = Number(cmd.mps);
          if (!isFinite(m) || m <= 0) { err = 'mps must be positive'; return; }
          setSpeed(c, m);
        } else if (name === 'set') {
          err = setField(c, String(cmd.field || ''), cmd.value);
        }
      });
      return err ? { ok: false, error: err } : { ok: true };
    }

    function setField(c, field, value) {
      if (C.FIELDS.indexOf(field) < 0) return 'cannot set ' + field;
      if (field === 'mode') {
        if (['idle', 'resting'].indexOf(value) < 0) return 'mode can be set to idle or resting';
        c.mode = value; c.target = null; c.path = []; c.headingWalk = false; c.speed = 0; return null;
      }
      if (field === 'hr' && (value === null || value === 'auto')) { c.hrOverride = null; return null; }
      var v = Number(value);
      if (value === null || value === '' || !isFinite(v)) return field + ' needs a number';
      if (field === 'o2Pct') c.o2 = clamp(v, 0, 100);
      else if (field === 'batPct') c.bat = clamp(v, 0, 100);
      else if (field === 'hr') { c.hrOverride = clamp(v, 0, 250); c.hr = c.hrOverride; }
      else if (field === 'suitTempC') c.suitT = clamp(v, -120, 80);
      else if (field === 'doseMsv') c.dose = Math.max(0, v);
      else if (field === 'headingDeg') c.headingDeg = norm360(v);
      else if (field === 'lat') { if (Math.abs(v) > 90) return 'lat out of range'; c.lat = v; }
      else if (field === 'lon') c.lon = v;
      return null;
    }

    /* ---- world snapshot (schema: docs/MULTIPAGE.md) ---- */
    function record(c) {
      var p = xy(c.lat, c.lon);
      return {
        id: c.id, name: c.name, lat: round(c.lat, 6), lon: round(c.lon, 6), zM: round(c.zM, 1), x: round(p[0], 1), y: round(p[1], 1),
        headingDeg: round(c.headingDeg, 1), o2Pct: round(c.o2, 2), batPct: round(c.bat, 2),
        hr: Math.round(c.hrOverride !== null ? c.hrOverride + c.hrNoise * 0.5 : c.hr + c.hrNoise),
        suitTempC: round(c.suitT, 1), ambientTempC: round(c.amb, 1), radUsvH: round(c.rad, 2), doseMsv: round(c.dose, 4),
        mode: c.mode, speedMps: round(c.speed, 2),
        target: c.target ? { lat: round(c.target.lat, 6), lon: round(c.target.lon, 6), label: c.target.label || '' } : null
      };
    }
    function world() {
      var out = {};
      order.forEach(function (id) { out[id] = record(crew[id]); });
      return { v: 1, t: new Date(startMs + elapsedMs).toISOString(), clockSpeed: clock, base: { lat: C.BASE.lat, lon: C.BASE.lon }, crew: out, events: { solar: events.solar, dust: events.dust } };
    }

    /* Continue from a world snapshot (used by world-client when the authority disappears). Unknown crew are added. */
    function load(w) {
      if (!w || typeof w !== 'object' || !w.crew) return false;
      var t = Date.parse(w.t);
      if (isFinite(t)) elapsedMs = t - startMs;
      clock = clamp(num(w.clockSpeed, clock), 0.01, 100000);
      if (w.events) { events.solar = !!w.events.solar; events.dust = !!w.events.dust; }
      Object.keys(w.crew).forEach(function (id) {
        var r = w.crew[id]; if (!r || typeof r !== 'object') return;
        if (!crew[id]) addCrew({ id: id, name: r.name, lat: r.lat, lon: r.lon });
        var c = crew[id]; if (!c) return;
        c.lat = num(r.lat, c.lat); c.lon = num(r.lon, c.lon); c.headingDeg = num(r.headingDeg, 0);
        c.o2 = clamp(num(r.o2Pct, 100), 0, 100); c.bat = clamp(num(r.batPct, 100), 0, 100); c.hr = num(r.hr, c.hr);
        c.suitT = num(r.suitTempC, c.suitT); c.dose = Math.max(0, num(r.doseMsv, 0)); c.speed = 0;
        c.mode = ['idle', 'walking', 'returning', 'resting'].indexOf(r.mode) >= 0 ? r.mode : 'idle';
        c.walkSpeed = clamp(num(r.speedMps, 0) || c.walkSpeed, 0.1, C.MAX_MPS);
        c.target = pointOf(r.target); c.path = [];
        if (!c.target && (c.mode === 'walking' || c.mode === 'returning')) c.mode = 'idle';
      });
      refreshEnv();
      return true;
    }

    reset();
    return { tick: tick, world: world, command: command, reset: reset, load: load, addCrew: addCrew, removeCrew: removeCrew,
             crewIds: function () { return order.slice(); }, clockSpeed: function () { return clock; } };
  }

  var api = {
    create: create, C: C, PLACES: PLACES, demoPath: demoPath, xy: xy, ll: ll, radiationAt: radiationAt, ambientC: ambientC,
    localHour: localHour, localMarsTime: localMarsTime, distM: distM, bearing: bearing, M_PER_DEG: M_PER_DEG
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JdaSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
