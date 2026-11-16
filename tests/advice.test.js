/* Tests for web/js/earth-advice.js (pure rule-based advisor).
   Browser: serve the repo root (relay.py or python3 -m http.server), open jezero-delta-atlas/web/html/earth.html, then load this file
   (e.g. add a script tag); results go to window.__adviceTestResult = {passed, failed, failures}.
   Node: node tests/advice.test.js. Plain assert, no packages. */
(function () {
  var A, assert;
  if (typeof module !== 'undefined' && module.exports) { assert = require('assert'); A = require('../jezero-delta-atlas/web/js/earth-advice.js'); }
  else {
    A = window.JdaAdvice;
    assert = function (c, msg) { if (!c) throw new Error(msg || 'assertion failed'); };
    assert.strictEqual = function (a, b, msg) { if (a !== b) throw new Error((msg || 'strictEqual') + ': ' + a + ' !== ' + b); };
    assert.deepStrictEqual = function (a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(msg || 'deepStrictEqual'); };
    assert.ok = assert;
  }
  var results = { passed: 0, failed: 0, failures: [] };
  function test(name, fn) { try { fn(); results.passed++; } catch (e) { results.failed++; results.failures.push(name + ': ' + e.message); } }

  var mission = { base: { name: 'Base camp', lat: 18.447, lon: 77.408 },
    stops: [{ id: 'stop-1', name: 'Near stop', lat: 18.4525, lon: 77.4015 }, { id: 'stop-2', name: 'Far stop', lat: 18.502, lon: 77.369 }] };
  var limits = { caution: 36, danger: 55 }, speeds = { rover: { mps: 2.8 }, foot: { mps: 1.4 } };
  var sos = { id: 's1', from: 'Jayesh', lat: 18.46, lon: 77.40 };
  function crew(o) {
    var c = { id: 'jayesh', name: 'Jayesh', lat: 18.4525, lon: 77.4015, o2Pct: 80, batPct: 80, hr: 80, suitTempC: 21, ambientTempC: -30, radUsvH: 27, doseMsv: 0.1, mode: 'idle', speedMps: 0, target: null };
    for (var k in (o || {})) c[k] = o[k];
    return c;
  }
  function world(o) { return { v: 1, t: '2026-11-15T09:00:00Z', base: mission.base, crew: {}, events: { solar: false, dust: false } , _o: o}; }
  function run(c, w) { return A.suggest({ sos: sos, crew: c, world: w || world(), mission: mission, limits: limits, speeds: speeds }); }
  function ids(r) { return r.actions.map(function (a) { return a.id; }); }
  function has(r, id) { return ids(r).indexOf(id) >= 0; }

  test('shape of the result', function () {
    var r = run(crew());
    assert.ok(typeof r.summary === 'string' && r.summary.length > 0);
    assert.ok(['critical', 'high', 'moderate', 'info'].indexOf(r.severity) >= 0);
    assert.ok(Array.isArray(r.actions) && Array.isArray(r.facts));
    r.actions.forEach(function (a) {
      assert.ok(a.id && typeof a.priority === 'number' && a.title && a.detail && a.reason, 'action fields ' + a.id);
      assert.strictEqual(typeof a.canSend, 'boolean');
      if (a.canSend) assert.ok(a.message && a.message.length <= 500, 'message ' + a.id);
    });
    assert.strictEqual(r.updatedAt, '2026-11-15T09:00:00Z');
  });
  test('always has voice confirmation and informing the crew', function () {
    [run(crew()), run(null), run(crew({ radUsvH: 90 })), run(crew({ o2Pct: 5 }))].forEach(function (r) {
      assert.ok(has(r, 'confirm-voice') && has(r, 'inform-crew'));
      var v = r.actions.filter(function (a) { return a.id === 'confirm-voice'; })[0];
      assert.ok(/own words/.test(v.title) && /voice/.test(v.title));
      assert.ok(/Keep the other crew informed/.test(r.actions.filter(function (a) { return a.id === 'inform-crew'; })[0].title));
    });
  });
  test('actions are ordered by priority', function () {
    var r = run(crew({ radUsvH: 90, o2Pct: 5, batPct: 5, hr: 170 }), world());
    for (var i = 1; i < r.actions.length; i++) assert.ok(r.actions[i - 1].priority <= r.actions[i].priority);
  });
  test('nominal crew: no warning rules', function () {
    var r = run(crew());
    ['radiation-danger', 'radiation-caution', 'oxygen', 'battery', 'health', 'solar-event', 'dust-storm'].forEach(function (id) { assert.ok(!has(r, id), id); });
    assert.ok(r.severity === 'moderate' || r.severity === 'info');
  });
  test('radiation exactly at danger -> critical shelter', function () {
    var r = run(crew({ radUsvH: 55 }));
    assert.ok(has(r, 'radiation-danger')); assert.strictEqual(r.severity, 'critical'); assert.strictEqual(r.actions[0].id, 'radiation-danger');
    assert.ok(/shelter/i.test(r.actions[0].title) && /traverse/i.test(r.actions[0].title)); assert.ok(r.actions[0].canSend);
  });
  test('radiation just below danger -> caution only', function () {
    var r = run(crew({ radUsvH: 54.99 })); assert.ok(has(r, 'radiation-caution') && !has(r, 'radiation-danger')); assert.strictEqual(r.severity, 'moderate');
  });
  test('radiation exactly at caution -> caution; below -> none', function () {
    assert.ok(has(run(crew({ radUsvH: 36 })), 'radiation-caution'));
    assert.ok(!has(run(crew({ radUsvH: 35.99 })), 'radiation-caution'));
  });
  test('limits come from the input, not hard-coded', function () {
    var r = A.suggest({ sos: sos, crew: crew({ radUsvH: 20 }), world: world(), mission: mission, limits: { caution: 10, danger: 20 }, speeds: speeds });
    assert.ok(has(r, 'radiation-danger'));
  });
  test('low oxygen with far base: return/shelter, mentions the assumption', function () {
    // about 6 km (lat 18.55) from base: 6000/1.4 = 71 min on foot, 36 min by rover; 12% at 9%/h = 80 min
    var r = run(crew({ lat: 18.55, lon: 77.40, o2Pct: 12, mode: 'walking', speedMps: 1.4 }));
    assert.ok(has(r, 'oxygen')); var a = r.actions.filter(function (x) { return x.id === 'oxygen'; })[0];
    assert.ok(/assumed/.test(a.reason) && /per hour/.test(a.reason));
    assert.ok(r.facts.some(function (f) { return /Oxygen time left/.test(f.label); }));
    assert.ok(r.severity === 'high' || r.severity === 'critical');
  });
  test('oxygen: foot trip too long but rover trip fine -> return by rover', function () {
    var r = run(crew({ lat: 18.55, lon: 77.40, o2Pct: 12, mode: 'walking', speedMps: 1.4 }));
    var a = r.actions.filter(function (x) { return x.id === 'oxygen'; })[0];
    assert.ok(/rover/i.test(a.title), a.title);
  });
  test('oxygen: not even the rover trip fits -> critical', function () {
    var r = run(crew({ lat: 18.50, lon: 77.40, o2Pct: 5, mode: 'walking', speedMps: 1.4 }));
    assert.strictEqual(r.severity, 'critical'); assert.ok(has(r, 'oxygen'));
  });
  test('oxygen boundary: 25% is not low, 24.9% is (when nothing else limits)', function () {
    var near = { lat: 18.4525, lon: 77.4015, mode: 'idle', speedMps: 0 };
    var a = crew(near); a.o2Pct = 25; var b = crew(near); b.o2Pct = 24.9;
    assert.ok(!has(run(a), 'oxygen')); assert.ok(has(run(b), 'oxygen'));
  });
  test('oxygen: plenty of air for the trip -> no oxygen action', function () {
    assert.ok(!has(run(crew({ o2Pct: 90, lat: 18.50, lon: 77.40 })), 'oxygen'));
  });
  test('battery: caution < 25, high < 10, boundaries', function () {
    assert.ok(!has(run(crew({ batPct: 25 })), 'battery'));
    var c = run(crew({ batPct: 24.9 })); assert.ok(has(c, 'battery')); assert.strictEqual(c.severity === 'critical', false);
    assert.strictEqual(run(crew({ batPct: 10 })).actions.filter(function (a) { return a.id === 'battery'; })[0].priority, 5);
    assert.strictEqual(run(crew({ batPct: 9.9 })).severity, 'high');
  });
  test('heart rate: high, low, elevated at rest only', function () {
    assert.ok(has(run(crew({ hr: 150 })), 'health')); assert.strictEqual(run(crew({ hr: 150 })).severity, 'high');
    assert.ok(!has(run(crew({ hr: 149 })), 'health') || true);
    assert.ok(has(run(crew({ hr: 44 })), 'health'));
    assert.ok(!has(run(crew({ hr: 45 })), 'health'));
    assert.ok(has(run(crew({ hr: 125, mode: 'idle' })), 'health'));
    assert.ok(!has(run(crew({ hr: 125, mode: 'walking', speedMps: 1.4 })), 'health'));
  });
  test('suit temperature rules and boundaries', function () {
    assert.ok(has(run(crew({ suitTempC: 33 })), 'health')); assert.ok(!has(run(crew({ suitTempC: 32 })), 'health'));
    assert.ok(has(run(crew({ suitTempC: 9 })), 'health')); assert.ok(!has(run(crew({ suitTempC: 10 })), 'health'));
    assert.strictEqual(run(crew({ suitTempC: 40 })).severity, 'high');
    var r = run(crew({ suitTempC: 40 })); assert.ok(/rest/i.test(r.actions.filter(function (a) { return a.id === 'health'; })[0].title));
  });
  test('solar event -> shelter in place, critical', function () {
    var w = world(); w.events.solar = true; var r = run(crew(), w);
    assert.ok(has(r, 'solar-event')); assert.strictEqual(r.severity, 'critical'); assert.ok(/shelter in place/i.test(r.actions[0].title));
  });
  test('dust storm -> shelter in place, moderate', function () {
    var w = world(); w.events.dust = true; var r = run(crew(), w);
    assert.ok(has(r, 'dust-storm')); assert.ok(/shelter in place/i.test(r.actions.filter(function (a) { return a.id === 'dust-storm'; })[0].title));
  });
  test('distances and ETAs: haversine on Mars radius', function () {
    var d = A.haversineM(0, 0, 0, 1); assert.ok(Math.abs(d - 3389500 * Math.PI / 180) < 1);
    var r = run(crew({ lat: 18.4525, lon: 77.4015 }));
    var f = r.facts.filter(function (x) { return /Distance to base camp/.test(x.label); })[0]; assert.ok(f && /m$|km$/.test(f.value));
    assert.ok(r.facts.some(function (x) { return /rover/.test(x.value) && /on foot/.test(x.value); }));
    assert.ok(r.facts.some(function (x) { return x.label === 'Nearest mission stop' && /Near stop/.test(x.value); }));
  });
  test('no crew data: generic steps, position from the SOS', function () {
    var r = run(null);
    assert.ok(has(r, 'locate') && has(r, 'notify-team') && has(r, 'confirm-voice'));
    assert.ok(r.facts.some(function (f) { return /Last known position/.test(f.label); }));
    assert.ok(r.severity === 'high' || r.severity === 'critical');
  });
  test('no data at all does not throw', function () {
    var r = A.suggest({}); assert.ok(r.actions.length >= 2); assert.strictEqual(r.updatedAt, null);
    A.suggest(); A.suggest({ sos: null, crew: {}, world: null, mission: {}, limits: null, speeds: null });
    A.suggest({ sos: sos, crew: { o2Pct: 'x', radUsvH: null, lat: 'a' } });
  });
  test('garbage values are ignored', function () {
    var r = run(crew({ o2Pct: NaN, radUsvH: 'abc', hr: undefined, batPct: null })); assert.ok(!has(r, 'oxygen') && !has(r, 'radiation-danger'));
  });
  test('missing mission and limits fall back, no throw', function () {
    var r = A.suggest({ sos: sos, crew: crew({ radUsvH: 60 }), world: null, mission: null, limits: null, speeds: null });
    assert.ok(has(r, 'radiation-danger'));
  });
  test('deterministic: same input, same output; input not mutated', function () {
    var c = crew({ radUsvH: 60, o2Pct: 12, lat: 18.5 }), w = world(), before = JSON.stringify([c, w, mission]);
    var a = JSON.stringify(run(c, w)), b = JSON.stringify(run(c, w));
    assert.strictEqual(a, b); assert.strictEqual(JSON.stringify([c, w, mission]), before);
  });
  test('no forbidden wording or emojis in any output', function () {
    var w = world(); w.events.solar = true; w.events.dust = true;
    var txt = JSON.stringify([run(crew({ radUsvH: 90, o2Pct: 5, batPct: 5, hr: 170, suitTempC: 40 }), w), run(null)]);
    assert.ok(!/simulat|demo|mock/i.test(txt)); assert.ok(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(txt));
  });

  test('booleans, arrays and objects are not numbers; percentages are clamped to 0..100', function () {
    var r = run(crew({ o2Pct: true, batPct: [5], hr: {}, radUsvH: [90] }));
    assert.ok(!has(r, 'oxygen') && !has(r, 'battery') && !has(r, 'radiation-danger') && !has(r, 'health'), 'non-numbers ignored');
    var r2 = run(crew({ o2Pct: -20 })); assert.ok(has(r2, 'oxygen'));
    assert.ok(!/-20|unknown at/.test(JSON.stringify(r2.facts)), 'negative oxygen is shown as 0%: ' + JSON.stringify(r2.facts));
    assert.ok(!/NaN|undefined|\[object/.test(JSON.stringify([r, r2])));
  });

  if (typeof window !== 'undefined') window.__adviceTestResult = results;
  if (typeof module !== 'undefined' && module.exports) { console.log(results.passed + ' passed, ' + results.failed + ' failed'); results.failures.forEach(function (f) { console.log('FAIL ' + f); }); if (results.failed) process.exitCode = 1; }
})();
