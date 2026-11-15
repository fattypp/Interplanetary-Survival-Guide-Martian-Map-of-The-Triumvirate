/* Tests for the pure logic in jezero-delta-atlas/web/js/team.js.
   Node: node tests/team.test.js   Browser: load team.js (any page that has it), then load this file; results go to
   window.__teamTestResult = {passed, failed, failures}. Plain assert, no packages. */
(function () {
  var L, assert;
  if (typeof module !== 'undefined' && module.exports) {
    assert = require('assert'); L = require('../jezero-delta-atlas/web/js/team.js');
  } else {
    L = window.TeamLogic;
    assert = function (c, msg) { if (!c) throw new Error(msg || 'assertion failed'); };
    assert.strictEqual = function (a, b, msg) { if (a !== b) throw new Error((msg || 'strictEqual') + ': ' + a + ' !== ' + b); };
    assert.ok = assert;
  }
  var results = { passed: 0, failed: 0, failures: [] };
  function test(name, fn) {
    try { fn(); results.passed++; } catch (e) { results.failed++; results.failures.push(name + ': ' + e.message); }
  }
  var W = 1990, H = 1390;
  var craters = (typeof window !== 'undefined' && window.JEZERO_CRATERS) || {
    craters: [{ confidence: 0.9, page: [300, 300, 40] }, { confidence: 0.7, page: [330, 330, 30] }, { confidence: 0.3, page: [600, 600, 50] }]
  };
  var blocks = L.blockedCraters(craters, 0.6);
  var ctx = { W: W, H: H, blocks: blocks, margin: 12, pad: 6, home: { x: 1960, y: 700 } };
  function mk(seed, x, y) {
    var p = L.freePoint(x, y, ctx);
    return { id: 't', name: 'T', rs: seed, x: p.x, y: p.y, heading: 1, speed: 0.22, o2: 80, bat: 80, hr: 70, restHr: 70, mode: 'explore', pause: 0 };
  }

  test('blockedCraters keeps only confidence >= 0.6', function () {
    var all = (craters.craters || []);
    var expected = all.filter(function (c) { return c.confidence >= 0.6; }).length;
    assert.strictEqual(blocks.length, expected);
    assert.ok(blocks.length > 0);
  });

  test('rand is deterministic and in [0,1)', function () {
    var a = { rs: 5 }, b = { rs: 5 };
    for (var i = 0; i < 200; i++) { var x = L.rand(a), y = L.rand(b); assert.strictEqual(x, y); assert.ok(x >= 0 && x < 1); }
  });

  test('walk stays on the map and out of confident craters (3 seeds x 20000 s)', function () {
    [1, 77, 4242].forEach(function (seed) {
      var m = mk(seed, 1000, 700);
      for (var i = 0; i < 4000; i++) {
        L.stepMember(m, 5, ctx);
        assert.ok(!L.isBlocked(m.x, m.y, ctx), 'blocked at step ' + i + ' pos ' + m.x + ',' + m.y);
      }
    });
  });

  test('walk is reproducible for the same seed', function () {
    var a = mk(9, 1000, 700), b = mk(9, 1000, 700);
    for (var i = 0; i < 300; i++) { L.stepMember(a, 3, ctx); L.stepMember(b, 3, ctx); }
    assert.strictEqual(a.x, b.x); assert.strictEqual(a.y, b.y);
  });

  test('walk starting next to the map edge does not leave it', function () {
    var m = mk(3, 14, 14);
    for (var i = 0; i < 3000; i++) { L.stepMember(m, 5, ctx); assert.ok(m.x >= 0 && m.x <= W && m.y >= 0 && m.y <= H); }
  });

  test('a huge dt does not teleport through a crater', function () {
    var m = mk(5, 1000, 700);
    L.stepMember(m, 1200, ctx);
    assert.ok(!L.isBlocked(m.x, m.y, ctx));
  });

  test('vitals stay in range and only drain', function () {
    var m = mk(11, 1000, 700), prev = m.o2;
    m.mode = 'explore';
    for (var i = 0; i < 20000; i++) {
      L.stepMember(m, 5, ctx); L.stepVitals(m, 5, { home: { x: -9999, y: -9999 } });   // home unreachable: no resupply
      assert.ok(m.o2 >= 0 && m.o2 <= 100 && m.bat >= 0 && m.bat <= 100, 'percent out of range');
      assert.ok(m.hr >= L.HR_MIN && m.hr <= L.HR_MAX, 'hr ' + m.hr);
      assert.ok(m.o2 <= prev + 1e-9); prev = m.o2;
    }
    assert.strictEqual(m.o2, 0);
  });

  test('plausible heart rate while walking', function () {
    var m = mk(12, 1000, 700), lo = 999, hi = 0;
    for (var i = 0; i < 2000; i++) { L.stepMember(m, 5, ctx); L.stepVitals(m, 5, { home: { x: -9999, y: -9999 } }); if (i > 50) { lo = Math.min(lo, m.hr); hi = Math.max(hi, m.hr); } }
    assert.ok(lo > 55 && hi < 130, lo + '..' + hi);
  });

  test('low oxygen sends the member back and the resupply resets it', function () {
    var m = mk(13, 1500, 700); m.o2 = 19.9;
    L.stepVitals(m, 1, ctx);
    assert.strictEqual(m.mode, 'return');
    var resup = false;
    for (var i = 0; i < 20000 && !resup; i++) { L.stepMember(m, 5, ctx); L.stepVitals(m, 5, ctx); resup = m.resupplied; }
    assert.ok(resup, 'never reached home from ' + m.x + ',' + m.y);
    assert.strictEqual(m.o2, 100); assert.strictEqual(m.mode, 'explore');
  });

  test('flags: thresholds and wording', function () {
    var f = function (o, b, h) { return L.flags({ oxygenPct: o, batteryPct: b, heartRate: h }); };
    assert.strictEqual(f(80, 80, 70).length, 0);
    assert.strictEqual(f(24, 80, 70)[0].level, 'low');
    assert.strictEqual(f(9, 80, 70)[0].level, 'critical');
    assert.strictEqual(f(80, 20, 70)[0].key, 'battery');
    assert.strictEqual(f(80, 80, 125)[0].level, 'high');
    assert.strictEqual(f(80, 80, 40)[0].level, 'low');
    f(9, 9, 160).forEach(function (x) { assert.ok(x.icon && x.text); });
  });

  test('distance and bearing', function () {
    var n = L.distBearing(100, 100, 100, 0, 10);   // 100 px up = north
    assert.strictEqual(Math.round(n.m), 1000); assert.strictEqual(n.dir, 'N');
    assert.strictEqual(L.distBearing(0, 0, 10, 0, 1).dir, 'E');
    assert.strictEqual(L.distBearing(0, 0, 0, 10, 1).dir, 'S');
    assert.strictEqual(L.distBearing(0, 0, -10, -10, 1).dir, 'NW');
    assert.strictEqual(L.fmtDist(1234), '1.2 km'); assert.strictEqual(L.fmtDist(340), '340 m');
  });

  test('cleanText trims, collapses and limits length', function () {
    assert.strictEqual(L.cleanText('   '), '');
    assert.strictEqual(L.cleanText('  hi   there \n'), 'hi there');
    assert.strictEqual(L.cleanText(new Array(500).join('a')).length, L.MAX_LEN);
    assert.strictEqual(L.cleanText(null), '');
  });

  test('replies are context aware', function () {
    var r = function () { return 0.1; };
    var base = { name: 'T', oxygenPct: 80, batteryPct: 17, heartRate: 70, mode: 'explore', distanceM: 1500, dir: 'NE' };
    assert.ok(/17%/.test(L.replyFor('What is your battery?', base, r)));
    assert.ok(/low/.test(L.replyFor('What is your battery?', base, r)));
    assert.ok(/heading back/.test(L.replyFor('oxygen?', { name: 'T', oxygenPct: 15, batteryPct: 50, heartRate: 70, mode: 'return', distanceM: null, dir: '' }, r)));
    assert.ok(/1\.5 km NE/.test(L.replyFor('where are you', base, r)));
    assert.ok(/Already heading back/.test(L.replyFor('come back to base', { name: 'T', oxygenPct: 15, batteryPct: 50, heartRate: 70, mode: 'return' }, r)));
    assert.ok(/heading back to base/.test(L.replyFor('blah blah', { name: 'T', oxygenPct: 15, batteryPct: 50, heartRate: 70, mode: 'return' }, r)));
    assert.ok(L.replyFor('???', base, r).length > 0);
    assert.ok(L.replyFor('<img src=x onerror=alert(1)>', base, r).length > 0);
  });

  test('chat store round trip, filtering of corrupt entries and 100 cap', function () {
    var mem = {};
    var store = { get: function (k, f) { return Object.prototype.hasOwnProperty.call(mem, k) ? JSON.parse(mem[k]) : f; }, set: function (k, v) { mem[k] = JSON.stringify(v); } };
    assert.strictEqual(L.loadChat(store, 'a').length, 0);
    var list = [{ t: '2026-01-01T00:00:00.000Z', from: 'me', text: '<img src=x onerror=alert(1)>', sim: false }];
    L.saveChat(store, 'a', list);
    var back = L.loadChat(store, 'a');
    assert.strictEqual(back.length, 1); assert.strictEqual(back[0].text, '<img src=x onerror=alert(1)>');
    store.set('team.chat.b', [null, 5, { text: 1 }, { t: 'x', from: 'me', text: 'ok' }]);
    assert.strictEqual(L.loadChat(store, 'b').length, 1);
    store.set('team.chat.c', 'garbage');
    assert.strictEqual(L.loadChat(store, 'c').length, 0);
    var big = []; for (var i = 0; i < 150; i++) big.push({ t: 'x', from: 'me', text: 'm' + i });
    L.saveChat(store, 'd', big);
    var d = L.loadChat(store, 'd'); assert.strictEqual(d.length, 100); assert.strictEqual(d[99].text, 'm149');
  });

  test('makeMembers places everyone on a free spot away from the right edge', function () {
    L.makeMembers(ctx).forEach(function (m) { assert.ok(!L.isBlocked(m.x, m.y, ctx)); assert.ok(m.x < W * 0.6 && m.x > W * 0.2); });
  });

  test('metersPerPx matches suit.js / route-planner formula (5.4-5.7 for the real meta)', function () {
    var meta = (typeof window !== 'undefined' && window.JEZERO_CRATERS && window.JEZERO_CRATERS.meta) ||
      { bbox: { lon0: 77.22318, lon1: 77.41956, lat0: 18.44176, lat1: 18.57188 }, page: [1990, 1390] };
    var s = L.metersPerPx(meta);
    assert.ok(s > 5.4 && s < 5.7, 'scale ' + s);
    assert.ok(Math.abs(L.metersPerPx({}) - 5.55) < 1e-9);
  });

  test('walking speeds are about 1 to 1.3 m/s at the real scale', function () {
    L.DEFAULTS.forEach(function (d) { var mps = d.speed * 5.55; assert.ok(mps >= 0.9 && mps <= 1.3, d.id + ' ' + mps); });
  });

  if (typeof window !== 'undefined') window.__teamTestResult = results;
  else { console.log(results.passed + ' passed, ' + results.failed + ' failed'); results.failures.forEach(function (f) { console.log('FAIL ' + f); }); process.exit(results.failed ? 1 : 0); }
})();
