/* Unit tests for the pure suit model (web/js/suit.js). No packages.
   Node:    node tests/suit.test.js   (from the repo root)
   Browser: serve the REPO ROOT (python3 -m http.server <port>), open jezero-delta-atlas/web/html/index.html (window.SuitModel exists),
            then load ../../../tests/suit.test.js with a <script> tag from the javascript_tool;
            result in window.SUIT_TEST_RESULT = {passed, failed, failures}. */
(function (root) {
  var M = typeof module !== 'undefined' && module.exports ? require('../jezero-delta-atlas/web/js/suit.js') : root.SuitModel;
  var results = { passed: 0, failed: 0, failures: [] };
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': expected ' + b + ' got ' + a); }
  function ok(c, msg) { if (!c) throw new Error(msg || 'not ok'); }
  function near(a, b, tol, msg) { if (!(Math.abs(a - b) <= tol)) throw new Error((msg || 'near') + ': expected ~' + b + ' got ' + a); }
  function test(name, fn) { try { fn(); results.passed++; } catch (e) { results.failed++; results.failures.push(name + ' -> ' + e.message); } }
  var C = M.C;

  test('consumption per activity matches constants within jitter', function () {
    ['resting', 'walking', 'working'].forEach(function (a) {
      var s = M.step(M.freshState(1), 1, { activity: a });
      near(100 - s.oxygenPct, C.O2_PER_H[a], C.O2_PER_H[a] * C.JITTER / 2 + 1e-9, 'o2 ' + a);
      near(100 - s.batteryPct, C.BAT_PER_H[a], C.BAT_PER_H[a] * C.JITTER / 2 + 1e-9, 'bat ' + a);
    });
  });
  test('working uses more than walking, walking more than resting', function () {
    var d = function (a) { return 100 - M.step(M.freshState(5), 1, { activity: a }).oxygenPct; };
    ok(d('working') > d('walking') && d('walking') > d('resting'));
  });
  test('deterministic with the same seed, differs with another', function () {
    var a = M.step(M.freshState(7), 0.5, { activity: 'walking' }), b = M.step(M.freshState(7), 0.5, { activity: 'walking' });
    eq(JSON.stringify(a), JSON.stringify(b));
    var c = M.step(M.freshState(8), 0.5, { activity: 'walking' });
    ok(c.oxygenPct !== a.oxygenPct);
  });
  test('step does not mutate its input', function () {
    var s = M.freshState(3), copy = JSON.stringify(s); M.step(s, 1, { activity: 'working', radiation: 10 }); eq(JSON.stringify(s), copy);
  });
  test('depletion clamps at 0 and stays there', function () {
    var s = M.freshState(2);
    for (var i = 0; i < 100; i++) s = M.step(s, 1, { activity: 'working' });
    eq(s.oxygenPct, 0); eq(s.batteryPct, 0);
    s = M.step(s, 5, { activity: 'working' }); eq(s.oxygenPct, 0); eq(s.batteryPct, 0);
    eq(M.hoursRemaining(s, 'working').hours, 0);
  });
  test('hours remaining: limiting resource and value', function () {
    var r = M.hoursRemaining({ oxygenPct: 100, batteryPct: 100 }, 'working');
    eq(r.limiting, 'oxygen'); near(r.hours, 100 / C.O2_PER_H.working, 1e-9);   // 8.3 h of oxygen < 12.5 h of battery
    r = M.hoursRemaining({ oxygenPct: 100, batteryPct: 20 }, 'working'); eq(r.limiting, 'battery'); near(r.hours, 20 / C.BAT_PER_H.working, 1e-9);
    r = M.hoursRemaining({ oxygenPct: 10, batteryPct: 100 }, 'resting'); eq(r.limiting, 'oxygen'); near(r.hours, 10 / C.O2_PER_H.resting, 1e-9);
  });
  test('dose accumulates: uSv/h x h / 1000 = mSv, only grows', function () {
    var s = M.step(M.freshState(1), 2, { activity: 'resting', radiation: 500 }); near(s.doseMSv, 1.0, 1e-9);
    s = M.step(s, 1, { activity: 'resting', radiation: 250 }); near(s.doseMSv, 1.25, 1e-9);
    var t = M.step(s, 1, { activity: 'resting', radiation: -5 }); eq(t.doseMSv, s.doseMSv, 'negative rate ignored');
    t = M.step(s, 1, { activity: 'resting', radiation: null }); eq(t.doseMSv, s.doseMSv, 'null rate = no data');
  });
  test('speed change: same simulated span gives same result however it is split', function () {
    var one = M.step(M.freshState(9), 2, { activity: 'walking' }).oxygenPct;
    var fast = M.step(M.freshState(9), 2, { activity: 'walking' }).oxygenPct;   // x1 over 2 h vs x3600 over 2 s: both are 2 simulated hours
    eq(one, fast);
    var s = M.freshState(9); for (var i = 0; i < 4; i++) s = M.step(s, 0.5, { activity: 'walking' });
    near(s.oxygenPct, one, 100 * C.JITTER, 'split steps stay within the jitter band');
    near(100 - M.step(M.freshState(9), 10, { activity: 'walking' }).oxygenPct, 10 * (100 - one) / 2, 10 * C.O2_PER_H.walking * C.JITTER, 'linear in simulated time');
  });
  test('NaN / garbage safety', function () {
    var s = M.step({ oxygenPct: NaN, batteryPct: 'x', doseMSv: undefined, seed: NaN }, NaN, { activity: 'flying', radiation: NaN });
    ok(isFinite(s.oxygenPct) && isFinite(s.batteryPct) && isFinite(s.doseMSv) && isFinite(s.seed));
    s = M.step(null, -3, null); ok(s.oxygenPct === 100 && s.batteryPct === 100);
    eq(M.radLevel(NaN, 'danger', { caution: 1, danger: 2 }), 'nominal'); eq(M.radLevel(5, 'nominal', null), 'nominal'); eq(M.radLevel(5, 'nominal', { danger: NaN }), 'nominal');
    eq(M.pctLevel(NaN, 'caution'), 'nominal'); eq(M.shouldAlert('nominal', 'danger', NaN, NaN, NaN), true);
    var v = M.vitals(NaN, { activity: null, oxygenPct: NaN, sleepHours: NaN }, NaN);
    Object.keys(v).forEach(function (k) { ok(isFinite(v[k]), k); });
    eq(M.fmtAgo(NaN), 'just now'); ok(M.metersPerPx(null) > 0); ok(M.advance({ x: 0, y: 0 }, { pts: [[10, 0]], i: 0 }, NaN, 0).x === 0);
  });
  test('radiation thresholds: danger is resistance, caution used if valid else 80%', function () {
    var t = M.radThresholds({ caution: 60, danger: 100 }); eq(t.caution, 60); eq(t.danger, 100);
    t = M.radThresholds({ caution: 150, danger: 100 }); near(t.caution, 80, 1e-9);
    eq(M.radThresholds({}), null); eq(M.radThresholds(null), null);
  });
  test('radiation level crossings and hysteresis', function () {
    var L = { caution: 80, danger: 100 };
    eq(M.radLevel(50, 'nominal', L), 'nominal'); eq(M.radLevel(80, 'nominal', L), 'caution'); eq(M.radLevel(100, 'nominal', L), 'danger');
    eq(M.radLevel(95, 'danger', L), 'danger', 'stays danger just under the limit'); eq(M.radLevel(91, 'danger', L), 'danger');
    eq(M.radLevel(89, 'danger', L), 'caution', 'falls to caution below 90% of danger');
    eq(M.radLevel(75, 'caution', L), 'caution', 'stays caution just under'); eq(M.radLevel(73, 'caution', L), 'caution');
    eq(M.radLevel(70, 'caution', L), 'nominal', 'nominal below 90% of caution (72)');
    eq(M.radLevel(10, 'danger', L), 'nominal', 'big drop skips caution');
  });
  test('oxygen/battery levels and hysteresis', function () {
    eq(M.pctLevel(50, 'nominal'), 'nominal'); eq(M.pctLevel(24.9, 'nominal'), 'caution'); eq(M.pctLevel(9.9, 'nominal'), 'danger');
    eq(M.pctLevel(26, 'caution'), 'caution'); eq(M.pctLevel(28, 'caution'), 'nominal');
    eq(M.pctLevel(11, 'danger'), 'danger'); eq(M.pctLevel(14, 'danger'), 'caution');
  });
  test('alerts fire on entry / level change, not every tick, repeat after N minutes', function () {
    var rep = C.REPEAT_MIN * 60000;
    eq(M.shouldAlert('nominal', 'nominal', -Infinity, 0, rep), false);
    eq(M.shouldAlert('nominal', 'caution', -Infinity, 0, rep), true);
    eq(M.shouldAlert('caution', 'caution', 0, 1000, rep), false, 'no spam');
    eq(M.shouldAlert('caution', 'caution', 0, rep - 1, rep), false);
    eq(M.shouldAlert('caution', 'caution', 0, rep, rep), true, 'repeat');
    eq(M.shouldAlert('caution', 'danger', 0, 10, rep), true, 'escalation');
    eq(M.shouldAlert('danger', 'caution', 0, 10, rep), true, 'de-escalation to caution is still a change');
    eq(M.shouldAlert('danger', 'nominal', 0, 10, rep), false);
  });
  test('jittering around the threshold does not re-alert (full loop)', function () {
    var L = { caution: 80, danger: 100 }, lvl = 'nominal', fired = 0, last = -Infinity, t = 0;
    [95, 101, 99, 102, 98, 100.5, 97, 101].forEach(function (x) {
      var n = M.radLevel(x, lvl, L); if (M.shouldAlert(lvl, n, last, t, 15 * 60000)) { fired++; last = t; } lvl = n; t += 60000;
    });
    eq(fired, 2, 'caution then danger only (95 caution, 101 danger)');
  });
  test('condition = worst of the levels', function () {
    eq(M.condition({ radiation: 'nominal', oxygen: 'nominal', battery: 'nominal' }), 'nominal');
    eq(M.condition({ radiation: 'caution', oxygen: 'nominal', battery: 'nominal' }), 'caution');
    eq(M.condition({ radiation: 'caution', oxygen: 'danger', battery: 'nominal' }), 'critical');
    eq(M.condition(null), 'nominal');
  });
  test('walking: 1.4 m/s over metres-per-pixel, clamps at the end, follows waypoints', function () {
    var mpp = 5, r = M.advance({ x: 0, y: 0 }, { pts: [[100, 0]], i: 0 }, C.WALK_MPS * 100, mpp); near(r.x, 28, 1e-9); eq(r.done, false);
    r = M.advance({ x: 0, y: 0 }, { pts: [[10, 0], [10, 10]], i: 0 }, 75, mpp); eq(r.x, 10); near(r.y, 5, 1e-9); eq(r.i, 1);
    r = M.advance({ x: 0, y: 0 }, { pts: [[10, 0]], i: 0 }, 1e6, mpp); eq(r.x, 10); eq(r.done, true);
    var meta = { bbox: { lon0: 77.22318, lon1: 77.41956, lat0: 18.44176, lat1: 18.57188 }, page: [1990, 1390], m_per_px: 9.7 };
    near(M.metersPerPx(meta), 5.55, 0.1, 'scale from bbox/page, same as the scale bar');
    eq(M.metersPerPx({ m_per_px: 9.7 }), 9.7);
  });
  test('vitals deterministic, flags and schedule derivation', function () {
    var ctx = { activity: 'walking', oxygenPct: 80, sleepHours: 7, hoursAwake: 6, hoursSinceMeal: 2 };
    eq(JSON.stringify(M.vitals(1e12, ctx, 1)), JSON.stringify(M.vitals(1e12, ctx, 1)));
    ok(JSON.stringify(M.vitals(1e12, ctx, 1)) !== JSON.stringify(M.vitals(1e12, ctx, 2)), 'salt varies');
    ok(M.vitals(1e12, { activity: 'working', hoursAwake: 20, sleepHours: 4 }, 0).heartRate > M.vitals(1e12, { activity: 'resting', hoursAwake: 2, sleepHours: 8 }, 0).heartRate);
    eq(M.flags({ heartRate: 72, spo2: 98, temperatureC: 36.7, fatigue: 2, hydration: 90, sleepHours: 7 }).length, 0);
    ok(M.flags({ heartRate: 120, spo2: 90, temperatureC: 38.5, fatigue: 8, hydration: 40, sleepHours: 4 }).length === 6);
    var now = Date.parse('2026-03-01T12:00:00Z'), iso = function (h) { return new Date(now + h * 3600000).toISOString(); };
    var sc = M.fromSchedule([{ type: 'sleep', start: iso(-14), end: iso(-6.5) }, { type: 'meal', start: iso(-3.5), end: iso(-3) }], now);
    eq(sc.source, 'schedule'); near(sc.sleepHours, 7.5, 1e-9); near(sc.hoursAwake, 6.5, 1e-9); near(sc.hoursSinceMeal, 3, 1e-9);
    eq(M.fromSchedule([], now).source, 'model'); eq(M.fromSchedule(null, now).source, 'model');
  });
  test('rhythm uses the explicit offset (local clock), default UTC', function () {
    var t = Date.parse('2026-03-01T12:00:00Z');          // 12:00 UTC: last meal was 07:00
    near(M.rhythm(t).hoursSinceMeal, 5, 1e-9); near(M.rhythm(t).hoursAwake, 5.5, 1e-9);
    near(M.rhythm(t, 120).hoursSinceMeal, 1, 1e-9, '+02:00 local is 14:00, last meal 13:00');
    near(M.rhythm(t, 120).hoursAwake, 7.5, 1e-9);
    near(M.rhythm(t, -300).hoursAwake, 0.5, 1e-9, '-05:00 local is 07:00');
    eq(JSON.stringify(M.rhythm(t, 60)), JSON.stringify(M.rhythm(t, 60)));
    eq(M.fromSchedule(null, t, 120).hoursSinceMeal, M.rhythm(t, 120).hoursSinceMeal, 'fromSchedule passes the offset');
    ok(isFinite(M.rhythm(NaN, NaN).hoursAwake));
  });
  test('fmtAgo', function () { eq(M.fmtAgo(30000), 'just now'); eq(M.fmtAgo(5 * 60000), '5 min ago'); eq(M.fmtAgo(90 * 60000), '1 h 30 min ago'); eq(M.fmtAgo(26 * 3600000), '1 d 2 h ago'); });

  root.SUIT_TEST_RESULT = results;
  if (typeof module !== 'undefined' && module.exports) {
    console.log(results.passed + ' passed, ' + results.failed + ' failed'); results.failures.forEach(function (f) { console.log('FAIL ' + f); });
    if (results.failed) process.exit(1);
  }
})(typeof window !== 'undefined' ? window : globalThis);
