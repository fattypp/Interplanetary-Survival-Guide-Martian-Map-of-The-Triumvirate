/* Tests for web/js/sim-core.js (JdaSim). No packages.
   Node:    node tests/sim.test.js
   Browser: serve the repo root, open jezero-delta-atlas/web/html/control.html (window.JdaSim exists), load this file with a <script> tag;
            result in window.SIM_TEST_RESULT = {passed, failed, failures}. */
(function (root) {
  var isNode = typeof module !== 'undefined' && module.exports;
  if (isNode) { globalThis.window = globalThis; require('../jezero-delta-atlas/web/data/mission-data.js'); require('../jezero-delta-atlas/web/data/travel-speeds.js'); }   // the data files assign to window.*
  var S = isNode ? require('../jezero-delta-atlas/web/js/sim-core.js') : root.JdaSim;
  var MI = S.missionInfo(), SP = S.speeds(), BASE = MI.base, STOPS = MI.stops;
  var res = { passed: 0, failed: 0, failures: [] };
  function ok(c, m) { if (!c) throw new Error(m || 'not ok'); }
  function near(a, b, t, m) { if (!(Math.abs(a - b) <= t)) throw new Error((m || 'near') + ': expected ~' + b + ' got ' + a); }
  function test(n, f) { try { f(); res.passed++; } catch (e) { res.failed++; res.failures.push(n + ' -> ' + e.message); } }
  function mk(seed) { return S.create({ seed: seed || 1, crew: [{ id: 'jayesh', name: 'Jayesh' }, { id: 'juhyeok', name: 'Juhyeok' }] }); }
  function window_has() { return !!(globalThis.window || root).JEZERO_MISSION; }
  function window_mission() { return (globalThis.window || root).JEZERO_MISSION; }
  function window_speeds() { return (globalThis.window || root).JEZERO_SPEEDS; }
  function run(sim, ms, step) { for (var t = 0; t < ms; t += step || 100) sim.tick(step || 100); }
  var HAWKS = { lat: STOPS[1].lat, lon: STOPS[1].lon, label: STOPS[1].name };   // stop 2, about 0.8 km from base
  function stopPath() { return STOPS.slice(2).map(function (p) { return { lat: p.lat, lon: p.lon, label: p.name }; }); }

  test('world schema', function () {
    var w = mk().world(), c = w.crew.jayesh;
    ok(w.v === 1 && typeof w.t === 'string' && w.clockSpeed === 1 && w.base.lat && w.events.solar === false && w.events.dust === false);
    ['id','name','lat','lon','zM','x','y','headingDeg','o2Pct','batPct','hr','suitTempC','ambientTempC','radUsvH','doseMsv','mode','speedMps','target','travel','stopId','taskId','progress','distM','etaS'].forEach(function (k) { ok(k in c, 'missing ' + k); });
    ok(c.travel === 'foot' && c.stopId === null && c.taskId === null && c.progress.done === 0 && c.progress.total === MI.tasks.filter(function (t) { var ch = S.objectiveOf('jayesh'); return ch === 'both' || t.objective === ch; }).length);
    ok(c.mode === 'idle' && c.target === null);
  });
  test('deterministic with the same seed and inputs', function () {
    var a = mk(5), b = mk(5);
    [a, b].forEach(function (s) { s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); run(s, 3000); });
    ok(JSON.stringify(a.world()) === JSON.stringify(b.world()));
  });
  test('walking moves toward target at speed (x1)', function () {
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS });
    var d0 = S.distM(s.world().crew.jayesh, HAWKS); run(s, 10000);
    var d1 = S.distM(s.world().crew.jayesh, HAWKS), w = s.world().crew.jayesh;
    near(d0 - d1, 10 * SP.foot, 0.5, 'moved 10 s at the foot speed'); ok(w.mode === 'walking' && w.speedMps === SP.foot && w.target.label === HAWKS.label);
  });
  test('clock x60 moves 60 times as far', function () {
    var a = mk(), b = mk();
    a.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); b.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); b.command({ cmd: 'setClockSpeed', n: 60 });
    run(a, 2000); run(b, 2000);
    var st = mk().world().crew.jayesh, da = S.distM(a.world().crew.jayesh, st), db = S.distM(b.world().crew.jayesh, st);
    near(db / da, 60, 6, 'ratio'); near(Date.parse(b.world().t) - Date.parse(a.world().t), 118 * 1000, 1000, 'mission time');
  });
  test('arrival ends in idle, return ends in resting at base', function () {
    var s = mk(); s.command({ cmd: 'setClockSpeed', n: 3600 }); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS });
    run(s, 20000); var c = s.world().crew.jayesh; ok(c.mode === 'idle', c.mode); near(S.distM(c, HAWKS), 0, 1);
    s.command({ cmd: 'return', crew: 'jayesh' }); ok(s.world().crew.jayesh.mode === 'returning'); run(s, 30000);
    c = s.world().crew.jayesh; ok(c.mode === 'resting', c.mode); near(S.distM(c, BASE), 0, 1);
  });
  test('stop, heading walk, multi-waypoint path with thenReturn', function () {
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', heading: 90 }); run(s, 5000);
    var c = s.world().crew.jayesh; near(c.headingDeg, 90, 0.1); ok(c.lon > BASE.lon);
    s.command({ cmd: 'stop', crew: 'jayesh' }); ok(s.world().crew.jayesh.mode === 'idle' && s.world().crew.jayesh.speedMps === 0);
    s.command({ cmd: 'setClockSpeed', n: 3600 }); s.command({ cmd: 'walk', crew: 'juhyeok', to: HAWKS, path: stopPath(), thenReturn: true });
    var seen = {}; for (var i = 0; i < 600; i++) { s.tick(100); var t = s.world().crew.juhyeok.target; if (t && t.label) seen[t.label] = 1; }
    ok(Object.keys(seen).length >= STOPS.length, 'stops seen: ' + Object.keys(seen)); ok(s.world().crew.juhyeok.mode === 'resting', s.world().crew.juhyeok.mode);
  });
  test('walking drains oxygen and battery faster than standing', function () {
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', to: { lat: BASE.lat + 0.5, lon: BASE.lon } }); s.command({ cmd: 'setClockSpeed', n: 3600 }); run(s, 1000);
    var w = s.world(), a = 100 - w.crew.jayesh.o2Pct, b = 100 - w.crew.juhyeok.o2Pct;
    ok(a > b * 1.8 && b > 0, a + ' vs ' + b); ok(100 - w.crew.jayesh.batPct > 100 - w.crew.juhyeok.batPct);
  });
  test('base is the mission base camp (inside the map); speeds come from JEZERO_SPEEDS', function () {
    var w = mk().world();
    ok(window_has(), 'mission data'); near(w.base.lat, window_mission().base.lat, 1e-9); near(w.base.lon, window_mission().base.lon, 1e-9);
    ok(S.distM(w.crew.jayesh, BASE) < 30 && w.crew.jayesh.x > 0 && w.crew.jayesh.x < 1990 && w.crew.jayesh.y > 0 && w.crew.jayesh.y < 1390, 'crew starts at base, on the map');
    near(SP.foot, window_speeds().foot.mps, 1e-9); near(SP.rover, window_speeds().rover.mps, 1e-9); ok(SP.rover > SP.foot);
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS, travel: 'rover' }); run(s, 1000);
    var c = s.world().crew.jayesh; ok(c.travel === 'rover' && c.speedMps === SP.rover, 'rover speed ' + c.speedMps);
    s.command({ cmd: 'setTravel', crew: 'jayesh', mode: 'foot' }); run(s, 1000); ok(s.world().crew.jayesh.speedMps === SP.foot);
    ok(!s.command({ cmd: 'setTravel', crew: 'jayesh', mode: 'boat' }).ok);
    s.command({ cmd: 'return', crew: 'jayesh' }); s.command({ cmd: 'setClockSpeed', n: 3600 }); run(s, 20000); near(S.distM(s.world().crew.jayesh, BASE), 0, 1);
  });
  test('oxygen: rover uses cabin air, on foot (EVA) drains much more', function () {
    var s = mk(); s.command({ cmd: 'setClockSpeed', n: 3600 });
    s.command({ cmd: 'walk', crew: 'jayesh', to: { lat: BASE.lat + 0.5, lon: BASE.lon }, travel: 'rover' });
    s.command({ cmd: 'walk', crew: 'juhyeok', to: { lat: BASE.lat + 0.5, lon: BASE.lon }, travel: 'foot' });
    run(s, 1000); var w = s.world(), r = w.crew.jayesh, f = w.crew.juhyeok;
    ok(r.o2Pct === 100, 'rover o2 ' + r.o2Pct); ok(f.o2Pct < 95, 'foot o2 ' + f.o2Pct);
    ok(100 - r.batPct < (100 - f.batPct) / 3, 'battery ' + r.batPct + ' vs ' + f.batPct); ok(r.hr < f.hr - 15, 'hr ' + r.hr + ' vs ' + f.hr);
  });
  test('run mission: base -> 5 stops by rover, EVA at each, back to base', function () {
    var s = mk(); ok(STOPS.length === 5 && MI.tasks.length === 10, 'mission data: ' + STOPS.length + ' stops, ' + MI.tasks.length + ' tasks');
    ok(s.command({ cmd: 'setClockSpeed', n: 600 }).ok && s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false, objective: 'both' }).ok);
    var visited = [], tasksSeen = {}, modes = {}, prevDone = 0, evaO2 = [], lastO2 = 100;
    for (var i = 0; i < 60000 && s.world().crew.jayesh.mode !== 'resting'; i++) {
      s.tick(100); var c = s.world().crew.jayesh;
      if (c.stopId && visited[visited.length - 1] !== c.stopId) visited.push(c.stopId);
      if (c.taskId) tasksSeen[c.taskId] = 1;
      modes[c.travel + ':' + (c.stopId ? 'eva' : 'drive')] = 1;
      if (c.stopId) ok(c.travel === 'foot', 'on foot at a stop'); else if (c.mode !== 'resting') ok(c.travel === 'rover', 'rover between stops');
      ok(c.progress.done >= prevDone && c.progress.done <= c.progress.total); prevDone = c.progress.done;
    }
    var c = s.world().crew.jayesh;
    ok(visited.join() === STOPS.map(function (p) { return p.id; }).join(), 'order ' + visited);
    ok(Object.keys(tasksSeen).length === MI.tasks.length, 'tasks seen ' + Object.keys(tasksSeen).length);
    ok(c.mode === 'resting' && S.distM(c, BASE) < 1 && c.progress.done === c.progress.total && c.stopId === null && c.travel === 'foot', JSON.stringify(c));
    ok(modes['rover:drive'] && modes['foot:eva']);
    ok(c.o2Pct > 0 && c.o2Pct < 100, 'oxygen used only on foot: ' + c.o2Pct);
    var j = s.world().crew.juhyeok; ok(j.mode === 'idle' && j.progress.done === 0, 'the other crew member is not affected');
  });
  test('run mission: EVA time is the sum of the stop tasks, drive time uses the rover speed', function () {
    var s = mk(), tot = 0; MI.tasks.forEach(function (t) { tot += t.estMin * 60; });
    var legs = 0, p = BASE; STOPS.concat([BASE]).forEach(function (q) { legs += S.distM(p, q); p = q; });
    var RT = (globalThis.window || root).JdaRoute; if (RT && RT.plan) legs = RT.plan({}).totalM;   // the run follows the safe route, not the straight lines
    s.command({ cmd: 'setClockSpeed', n: 100 }); s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false, objective: 'both' });
    var t0 = Date.parse(s.world().t); for (var i = 0; i < 200000 && s.world().crew.jayesh.mode !== 'resting'; i++) s.tick(100);
    var sim = (Date.parse(s.world().t) - t0) / 1000, expect = tot + legs / SP.rover + 0;
    near(sim, expect, expect * 0.02 + 120, 'mission duration s');
  });
  test('manual stop cancels a mission run; mission run is deterministic', function () {
    var a = mk(3), b = mk(3);
    [a, b].forEach(function (s) { s.command({ cmd: 'setClockSpeed', n: 300 }); s.command({ cmd: 'runMission', crew: 'all', optimize: false, objective: 'both' }); run(s, 8000); });
    ok(JSON.stringify(a.world()) === JSON.stringify(b.world()));
    a.command({ cmd: 'stop', crew: 'jayesh' }); var c = a.world().crew.jayesh; ok(c.mode === 'idle' && c.stopId === null); run(a, 2000); ok(a.world().crew.jayesh.mode === 'idle');
  });
  test('speed command changes pace, clamps', function () {
    var s = mk(); s.command({ cmd: 'setSpeed', crew: 'jayesh', mps: 5 }); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS });
    ok(s.world().crew.jayesh.speedMps === 0); run(s, 1000); ok(s.world().crew.jayesh.speedMps === 5);
    s.command({ cmd: 'setSpeed', crew: 'jayesh', mps: 999 }); run(s, 100); ok(s.world().crew.jayesh.speedMps === S.C.MAX_MPS);
  });
  test('radiation: baseline-ish, solar event x2.5, dose accumulates', function () {
    var s = mk(); var r0 = s.world().crew.jayesh.radUsvH; ok(r0 > 5 && r0 < 60, 'rad ' + r0);
    s.command({ cmd: 'event', solar: true }); near(s.world().crew.jayesh.radUsvH / r0, 2.5, 0.05);
    var d0 = s.world().crew.jayesh.doseMsv; s.command({ cmd: 'setClockSpeed', n: 3600 }); run(s, 1000);
    var d1 = s.world().crew.jayesh.doseMsv; near(d1 - d0, r0 * 2.5 / 1000, r0 * 2.5 / 1000 * 0.05, 'dose (1 simulated hour)');
  });
  test('ambient temperature follows the day, dust narrows the swing', function () {
    ok(Math.abs(S.ambientC(0, false) - S.ambientC(S.C.SOL_S * 1000, false)) < 0.1, 'one sol period');
    var t = [], d = []; for (var h = 0; h < 24; h += 0.5) { var ms = (h - S.C.START_LOCAL_H) * 3600 * 1000 * S.C.SOL_S / 86400; t.push(S.ambientC(ms, false)); d.push(S.ambientC(ms, true)); }
    var range = function (a) { return Math.max.apply(null, a) - Math.min.apply(null, a); };
    ok(range(d) < range(t) * 0.7 && range(t) > 60);
  });
  test('set, event and error handling', function () {
    var s = mk(); ok(s.command({ cmd: 'set', crew: 'jayesh', field: 'o2Pct', value: 15 }).ok); near(s.world().crew.jayesh.o2Pct, 15, 0.01);
    s.command({ cmd: 'set', crew: 'jayesh', field: 'o2Pct', value: 500 }); ok(s.world().crew.jayesh.o2Pct === 100);
    s.command({ cmd: 'set', crew: 'jayesh', field: 'hr', value: 150 }); run(s, 1000); near(s.world().crew.jayesh.hr, 150, 3);
    ok(!s.command({ cmd: 'set', crew: 'jayesh', field: 'bogus', value: 1 }).ok); ok(!s.command({ cmd: 'walk', crew: 'nobody', to: HAWKS }).ok);
    ok(!s.command({ cmd: 'walk', crew: 'jayesh', to: { lat: 'x', lon: 1 } }).ok); ok(!s.command({ cmd: 'explode' }).ok); ok(!s.command(null).ok);
    ok(!s.command({ cmd: 'setClockSpeed', n: -3 }).ok);
  });
  test('o2 never below 0; oxygen out raises heart rate', function () {
    var s = mk(); s.command({ cmd: 'set', crew: 'jayesh', field: 'o2Pct', value: 1 }); s.command({ cmd: 'setClockSpeed', n: 3600 }); run(s, 3000);
    var c = s.world().crew.jayesh; ok(c.o2Pct === 0 && c.hr > 85, c.o2Pct + ' ' + c.hr);
  });
  test('walking heart rate above resting', function () {
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); s.command({ cmd: 'setClockSpeed', n: 60 }); run(s, 5000);
    var w = s.world(); ok(w.crew.jayesh.hr > w.crew.juhyeok.hr + 15);
  });
  test('projection matches the atlas math and round-trips', function () {
    var p = S.xy(18.5, 77.3), q = S.ll(p[0], p[1]); near(q.lat, 18.5, 1e-9); near(q.lon, 77.3, 1e-9);
    var w = mk().world().crew.jayesh; var p2 = S.xy(w.lat, w.lon); near(w.x, p2[0], 0.2); near(w.y, p2[1], 0.2);
  });
  test('reset restores the initial state; addCrew; load', function () {
    var s = mk(); s.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); s.command({ cmd: 'event', dust: true }); s.command({ cmd: 'setClockSpeed', n: 600 }); run(s, 2000);
    var before = JSON.stringify(mk().world()); s.command({ cmd: 'reset' }); ok(JSON.stringify(s.world()) === before);
    ok(s.addCrew({ name: 'Ana' }).ok && s.world().crew.ana);
    var w = mk(); w.command({ cmd: 'walk', crew: 'jayesh', to: HAWKS }); run(w, 3000);
    var t = mk(9); ok(t.load(w.world())); near(t.world().crew.jayesh.lat, w.world().crew.jayesh.lat, 1e-5);
  });
  test('localMarsTime: hh:mm, starts at 09:00, advances with a sol', function () {
    ok(S.localMarsTime(S.C.START_ISO) === '09:00', S.localMarsTime(S.C.START_ISO));
    var t0 = Date.parse(S.C.START_ISO);
    ok(S.localMarsTime(t0 + 3600 * 1000 * S.C.SOL_S / 86400 * 2) === '11:00');
    ok(S.localMarsTime(new Date(t0 + S.C.SOL_S * 1000)) === '09:00', 'one sol later');
    ok(S.localMarsTime(t0 - 3600 * 1000 * S.C.SOL_S / 86400 * 10) === '23:00', 'before the start wraps');
    ok(S.localMarsTime('garbage') === '--:--');
    var s = mk(); s.command({ cmd: 'setClockSpeed', n: 3600 }); run(s, 3000); ok(/^\d\d:\d\d$/.test(S.localMarsTime(s.world().t)));
    if (root.JdaWorld) ok(/^\d\d:\d\d$|^--:--$/.test(root.JdaWorld.localMarsTime()));
  });
  test('huge dt is bounded and finite', function () {
    var s = mk(); s.command({ cmd: 'setClockSpeed', n: 100000 }); s.command({ cmd: 'walk', crew: 'jayesh', heading: 45 }); s.tick(1e9);
    var c = s.world().crew.jayesh; ok(isFinite(c.lat) && isFinite(c.lon) && isFinite(c.o2Pct));
  });

  test('operator set: lon wraps, dose is capped, reserved crew ids are renamed', function () {
    var s = mk();
    ok(s.command({ cmd: 'set', crew: 'jayesh', field: 'lon', value: -540 }).ok); near(s.world().crew.jayesh.lon, -180, 1e-6, 'lon -540 wraps to -180');
    ok(s.command({ cmd: 'set', crew: 'jayesh', field: 'lon', value: 1e9 }).ok); var lo = s.world().crew.jayesh.lon; ok(lo >= -180 && lo < 180, 'lon in range: ' + lo);
    ok(s.command({ cmd: 'set', crew: 'jayesh', field: 'doseMsv', value: 1e12 }).ok); ok(s.world().crew.jayesh.doseMsv <= 1e5);
    ['all', 'earth', 'control', 'me'].forEach(function (id) { var r = s.addCrew({ id: id, name: id }); ok(r.ok && r.id !== id && !!s.world().crew[r.id], 'reserved id ' + id + ' -> ' + r.id); });
    ok(!s.world().crew.all);
  });

  /* ---- safe route: the run follows JdaRoute waypoints, honours the objective, re-plans on events (needs JdaRoute on the page) ---- */
  var RT = function () { return (globalThis.window || root).JdaRoute; };
  function toM(p) { return { e: (p.lon - BASE.lon) * S.M_PER_DEG * Math.cos(BASE.lat * Math.PI / 180), n: (p.lat - BASE.lat) * S.M_PER_DEG }; }
  function distToPoly(c, pts) {
    var p = toM(c), best = Infinity;
    for (var i = 1; i < pts.length; i++) {
      var a = toM(pts[i - 1]), b = toM(pts[i]), dx = b.e - a.e, dn = b.n - a.n, l2 = dx * dx + dn * dn, t = l2 ? Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dn) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.e - (a.e + t * dx), p.n - (a.n + t * dn)));
    }
    return best;
  }
  test('run mission follows the JdaRoute waypoints (rover stays on the polyline) and reports route', function () {
    if (!RT()) return;
    var s = mk(), plan = RT().plan({}), poly = plan.waypoints.map(function (w) { return { lat: w.lat, lon: w.lon }; });
    ok(s.world().crew.jayesh.route === null, 'no route while idle');
    s.command({ cmd: 'setClockSpeed', n: 60 }); s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false, objective: 'both' });
    var maxOff = 0, detoured = false, rem0 = null, lastRem = Infinity, n = 0;
    for (var i = 0; i < 60000 && s.world().crew.jayesh.mode !== 'resting'; i++) {
      s.tick(100); var c = s.world().crew.jayesh;
      if (c.route) { if (rem0 === null) rem0 = c.route.remainingM; ok(c.route.order.join() === STOPS.map(function (p) { return p.id; }).join() && c.route.riskAhead >= 0 && c.route.riskAhead <= 1); }
      if (c.travel === 'rover' && c.mode !== 'resting') { var d = distToPoly(c, poly); if (d > maxOff) maxOff = d; n++; }
    }
    ok(n > 100, 'driving samples ' + n); ok(maxOff < 8, 'max distance from the planned route ' + maxOff.toFixed(1) + ' m');
    ok(rem0 > plan.totalM * 0.95 && rem0 < plan.totalM * 1.05, 'remaining at start ' + rem0 + ' vs ' + plan.totalM);
    ok(plan.legs.some(function (l) { return l.lengthM > l.straightM * 1.2; }), 'plan has a detour leg');
    var c2 = s.world().crew.jayesh; ok(c2.mode === 'resting' && S.distM(c2, BASE) < 1 && c2.route === null);
  });
  test('run mission honours the chosen objective: tasks, EVA time, progress total', function () {
    [1, 2, 'both'].forEach(function (ob) {
      var s = mk(), mine = MI.tasks.filter(function (t) { return ob === 'both' || t.objective === ob; }), seen = {};
      s.command({ cmd: 'setClockSpeed', n: 100 }); s.command({ cmd: 'runMission', crew: 'jayesh', objective: ob, optimize: false });
      ok(s.world().crew.jayesh.progress.total === mine.length, 'total ' + s.world().crew.jayesh.progress.total);
      var t0 = Date.parse(s.world().t); for (var i = 0; i < 200000 && s.world().crew.jayesh.mode !== 'resting'; i++) { s.tick(100); var tk = s.world().crew.jayesh.taskId; if (tk) seen[tk] = 1; }
      var c = s.world().crew.jayesh, sim = (Date.parse(s.world().t) - t0) / 1000, eva = 0; mine.forEach(function (t) { eva += t.estMin * 60; });
      var drive = RT() ? RT().plan({ objective: ob }).totalM : 0; if (!drive) { var p = BASE; STOPS.concat([BASE]).forEach(function (q) { drive += S.distM(p, q); p = q; }); }
      ok(Object.keys(seen).sort().join() === mine.map(function (t) { return t.id; }).sort().join(), 'tasks ' + Object.keys(seen));
      ok(c.progress.done === mine.length && c.progress.total === mine.length, JSON.stringify(c.progress));
      near(sim, eva + drive / SP.rover, (eva + drive / SP.rover) * 0.02 + 120, 'duration for objective ' + ob);
    });
    var s2 = mk(); if (S.objectiveOf('jayesh') === 'both') ok(s2.world().crew.jayesh.progress.total === MI.tasks.length, 'default both');   // a joined room may already hold a choice
  });
  function withObjective(get, f) {   // stub window.JdaObjective for the test (restored afterwards)
    var W = globalThis.window || root, old = W.JdaObjective; W.JdaObjective = { get: get };
    try { f(); } finally { if (old === undefined) delete W.JdaObjective; else W.JdaObjective = old; }
  }
  function idsOf(ob) { return MI.tasks.filter(function (t) { return t.objective === ob; }).map(function (t) { return t.id; }); }
  test('progress.doneIds is the set of tasks really performed: objective 1 run, then switch to both -> 5 of 10, same 5 ids', function () {
    var cur = 1;
    withObjective(function () { return cur; }, function () {
      var s = mk(); s.command({ cmd: 'setClockSpeed', n: 300 }); s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false });
      for (var i = 0; i < 100000 && s.world().crew.jayesh.mode !== 'resting'; i++) s.tick(100);
      var p = s.world().crew.jayesh.progress;
      ok(p.done === 5 && p.total === 5 && p.doneIds.slice().sort().join() === idsOf(1).sort().join(), JSON.stringify(p));
      cur = 'both'; s.tick(100); p = s.world().crew.jayesh.progress;
      ok(p.done === 5 && p.total === 10 && p.doneIds.slice().sort().join() === idsOf(1).sort().join(), 'after switching to both: ' + JSON.stringify(p));
      cur = 2; s.tick(100); p = s.world().crew.jayesh.progress; ok(p.done === 0 && p.total === 5 && p.doneIds.length === 5, 'objective 2 view: ' + JSON.stringify(p));
      s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false }); ok(s.world().crew.jayesh.progress.doneIds.length === 0, 'a new run resets doneIds');
    });
  });
  test('objective 2 started, switched to 1 at stop 2: doneIds keeps what was performed, remaining EVA comes from the chosen tasks not yet done', function () {
    var cur = 2;
    withObjective(function () { return cur; }, function () {
      var s = mk(); s.command({ cmd: 'setClockSpeed', n: 300 }); s.command({ cmd: 'runMission', crew: 'jayesh', optimize: false });
      var switched = false, c;
      for (var i = 0; i < 100000 && s.world().crew.jayesh.mode !== 'resting'; i++) {
        s.tick(100); c = s.world().crew.jayesh;
        if (!switched && c.stopId === STOPS[1].id) { ok(c.progress.doneIds.join() === idsOf(2).slice(0, 1).join(), 'before the switch ' + c.progress.doneIds); cur = 1; switched = true; }
      }
      ok(switched, 'reached stop 2');
      var exp = idsOf(2).slice(0, 1).concat(idsOf(1).slice(1)), p = s.world().crew.jayesh.progress;
      ok(p.doneIds.slice().sort().join() === exp.slice().sort().join(), 'doneIds ' + p.doneIds + ' expected ' + exp);
      ok(p.done === 4 && p.total === 5, JSON.stringify(p));
    });
  });
  test('optimised stop order is followed and a solar/dust event mid-run re-plans from the current position', function () {
    if (!RT()) return;
    var s = mk(); s.command({ cmd: 'setClockSpeed', n: 600 }); s.command({ cmd: 'event', solar: true });
    s.command({ cmd: 'runMission', crew: 'jayesh', optimize: true });
    var ord = RT().plan({ optimizeOrder: true, hazards: { solar: true } }).order, c = s.world().crew.jayesh;
    ok(c.route.order.join() === ord.join() && c.route.optimized === true && c.route.remainingOrder.join() === ord.join() && c.route.current === ord[0], 'order ' + c.route.order);
    var visited = [], toggled = false, replans = 0;
    for (var i = 0; i < 80000 && s.world().crew.jayesh.mode !== 'resting'; i++) {
      s.tick(100); c = s.world().crew.jayesh;
      if (c.stopId && visited[visited.length - 1] !== c.stopId) visited.push(c.stopId);
      if (!toggled && c.travel === 'rover' && c.distM > 100 && c.target && c.target.label && i > 20) { toggled = true; var before = c.route.remainingM; s.command({ cmd: 'event', solar: false }); var after = s.world().crew.jayesh.route; replans = after.replans; ok(after.order.join() === ord.join() && after.remainingOrder.length >= 1 && after.replans === 1 && Math.abs(after.remainingM - before) < before * 0.5 + 5000, 're-plan record'); }
    }
    ok(toggled && replans === 1, 'event toggled mid-run'); ok(visited.join() === ord.join(), 'visited ' + visited);
    c = s.world().crew.jayesh; ok(c.mode === 'resting' && S.distM(c, BASE) < 1 && c.progress.done === c.progress.total);
  });
  test('without JdaRoute-free inputs the world record still has the route key (null when idle)', function () { ok('route' in mk().world().crew.jayesh); });

  test('world-client fallback: in a joined room only this crew (plus known crew), stand-alone keeps the defaults', function () {
    var W = root.JdaWorld, L = root.JdaLink; if (!W || !W._localCrewList) return;   // browser pages that load world-client.js only
    var ids = W._localCrewList().map(function (c) { return c.id; });
    ok(ids[0] === W.id(), 'own crew first');
    if (L && L.room && !L.room.implicit && L.room.code !== 'LOCAL' && L.room.role !== 'legacy') {
      var known = {}; ((W.world() && W.world().crew && Object.keys(W.world().crew)) || []).forEach(function (k) { known[k] = 1; });
      ((L.presence && L.presence()) || []).forEach(function (p) { known[String(p.id).toLowerCase()] = 1; });
      ids.forEach(function (i) { ok(i === W.id() || known[i], 'invented teammate ' + i); });
    } else ok(ids.indexOf('jayesh') >= 0 && ids.indexOf('juhyeok') >= 0, 'stand-alone defaults');
  });

  if (typeof module !== 'undefined' && module.exports) {
    console.log(res.passed + ' passed, ' + res.failed + ' failed'); res.failures.forEach(function (f) { console.log('FAIL ' + f); }); process.exit(res.failed ? 1 : 0);
  } else root.SIM_TEST_RESULT = res;
})(typeof window !== 'undefined' ? window : globalThis);
