/* Tests for web/js/mission-route.js (JdaRoute) and web/js/route-planner.js. No packages.
   Node:    node tests/route.test.js   (Node is optional; the suite is written for the browser)
   Browser: serve the repo root, open jezero-delta-atlas/web/html/control.html (it loads the route scripts and data), then load this
            file with a <script> tag; result in window.ROUTE_TEST_RESULT = {passed, failed, failures, info}. */
(function (root) {
  var isNode = typeof module !== 'undefined' && module.exports;
  if (isNode) {
    globalThis.window = globalThis;
    ['craters-data', 'science-layers-data', 'mission-data', 'travel-speeds'].forEach(function (f) { require('../jezero-delta-atlas/web/data/' + f + '.js'); });
    require('../jezero-delta-atlas/web/js/route-planner.js'); require('../jezero-delta-atlas/web/js/mission-route.js');
  }
  var R = root.JdaRoute, M = root.JEZERO_MISSION, CR = root.JEZERO_CRATERS, SP = root.JEZERO_SPEEDS;
  var res = { passed: 0, failed: 0, failures: [], info: {} };
  function ok(c, m) { if (!c) throw new Error(m || 'not ok'); }
  function near(a, b, t, m) { if (!(Math.abs(a - b) <= t)) throw new Error((m || 'near') + ': expected ~' + b + ' got ' + a); }
  function test(n, f) { try { f(); res.passed++; } catch (e) { res.failed++; res.failures.push(n + ' -> ' + e.message); } }
  function strip(p) { var c = JSON.parse(JSON.stringify(p)); delete c.computeMs; return c; }
  var MPP = R.mPerPx(), STOPS = M.stops.map(function (s) { return s.id; });
  var HAZ = [{}, { solar: true }, { dust: true }, { solar: true, dust: true }];
  function polyline(p) { var a = []; p.legs.forEach(function (l) { l.points.forEach(function (q, i) { if (i || !a.length) a.push([q.x, q.y]); }); }); return a; }
  function insideBlocked(x, y, dust) {   // inside the blocked circle of a confident crater
    var mg = dust ? R.params.dustMargin : R.params.margin;
    return CR.craters.some(function (c) { return c.confidence >= R.params.minConf && Math.hypot(x - c.page[0], y - c.page[1]) < c.page[2] * mg * 0.97; });
  }
  /* nodes that sit inside a crater margin by themselves (stop 3 lies inside a detected crater): their approach is allowed and flagged */
  function selfBlocked(n, dust) { return insideBlocked(n.x, n.y, dust); }

  test('plan structure: guide order, legs connect base -> stops -> base, waypoints and totals', function () {
    var p = R.plan({});
    ok(p.order.join() === STOPS.join(), 'guide order ' + p.order);
    ok(p.legs.length === 6, 'six legs');
    var chain = ['base'].concat(STOPS, ['base']);
    p.legs.forEach(function (l, i) {
      ok(l.fromId === chain[i] && l.toId === chain[i + 1], 'leg ' + i + ' ' + l.fromId + '>' + l.toId);
      ok(l.points.length >= 2 && l.lengthM >= l.straightM - 0.5 && l.risk >= 0 && l.risk <= 1 && Array.isArray(l.notes), 'leg fields');
      var a = chain[i] === 'base' ? M.base : M.stops.filter(function (s) { return s.id === chain[i]; })[0], b = chain[i + 1] === 'base' ? M.base : M.stops.filter(function (s) { return s.id === chain[i + 1]; })[0];
      near(l.points[0].x, a.x, 0.2, 'leg start x'); near(l.points[0].y, a.y, 0.2, 'leg start y');
      near(l.points[l.points.length - 1].x, b.x, 0.2, 'leg end x'); near(l.points[l.points.length - 1].y, b.y, 0.2, 'leg end y');
      ok(isFinite(l.points[0].lat) && isFinite(l.points[0].lon), 'lat/lon');
    });
    var sum = 0; p.legs.forEach(function (l) { sum += l.lengthM; }); near(p.totalM, sum, 0.6 * 6, 'total is the sum of legs');
    ok(p.waypoints.length >= 7 && p.waypoints[0].kind === 'base' && p.waypoints[p.waypoints.length - 1].kind === 'base', 'waypoints');
    ok(p.waypoints.filter(function (w) { return w.stopId; }).map(function (w) { return w.stopId; }).join() === STOPS.join(), 'stop waypoints');
    ok(Array.isArray(p.hazardNotes) && p.hazardNotes.length > 0 && p.avoided && typeof p.avoided.craters === 'number' && Array.isArray(p.blocked));
  });
  test('paths never enter blocked crater cells (all hazard sets)', function () {
    HAZ.forEach(function (h) {
      var p = R.plan({ hazards: h }), nodes = [M.base].concat(M.stops);
      p.legs.forEach(function (l) {
        if (l.blocked) return;
        for (var i = 1; i < l.points.length; i++) {
          var a = l.points[i - 1], b = l.points[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
          for (var k = 0; k <= n; k++) {
            var x = a.x + (b.x - a.x) * k / n, y = a.y + (b.y - a.y) * k / n;
            if (!insideBlocked(x, y, h.dust)) continue;
            var allowed = nodes.some(function (nd) { return selfBlocked(nd, h.dust) && Math.hypot(x - nd.x, y - nd.y) * MPP <= R.params.approachMaxM + 30; });
            ok(allowed, 'point ' + x.toFixed(1) + ',' + y.toFixed(1) + ' inside a blocked crater on ' + l.id + ' ' + JSON.stringify(h));
          }
        }
      });
    });
  });
  test('a leg detours around a crater and says so', function () {
    var p = R.plan({}), d = p.legs.filter(function (l) { return l.detourM > 100 && l.craterHits > 0; });
    ok(d.length >= 1, 'no detouring leg found');
    ok(d[0].lengthM > d[0].straightM * 1.1 && d[0].notes.some(function (n) { return /^Detours/.test(n); }), JSON.stringify(d[0].notes));
    ok(p.avoided.craters >= 1 && p.hazardNotes.some(function (n) { return /detours/.test(n); }), 'avoided count / hazard note');
    res.info.detour = { leg: d[0].id, straightM: d[0].straightM, lengthM: d[0].lengthM };
  });
  test('routes are smooth: few vertices per leg, no jitter', function () {
    var p = R.plan({}); p.legs.forEach(function (l) { ok(l.points.length <= 12, l.id + ' has ' + l.points.length + ' points'); });
  });
  test('default keeps the guide order; optimisation never costs more and visits every stop once', function () {
    HAZ.forEach(function (h) {
      var g = R.plan({ hazards: h }), o = R.plan({ hazards: h, optimizeOrder: true });
      ok(g.order.join() === STOPS.join(), 'default is the guide order');
      ok(o.order.slice().sort().join() === STOPS.slice().sort().join() && o.order.length === 5, 'permutation of the 5 stops');
      ok(o.cost.chosenM <= o.cost.guideM + 1e-6 && Math.abs(o.cost.guideM - g.cost.chosenM) < 1e-3, 'cost ' + JSON.stringify(o.cost));
      var chain = ['base'].concat(o.order, ['base']); o.legs.forEach(function (l, i) { ok(l.fromId === chain[i] && l.toId === chain[i + 1], 'optimised legs connect'); });
    });
    var s = R.plan({ hazards: { solar: true }, optimizeOrder: true }); ok(s.optimized && s.cost.savedM > 0, 'under a solar event the order changes: ' + s.order);
    ok(s.hazardNotes[0].indexOf('Stop order changed') === 0);
  });
  test('deterministic: same input, same output (also after clearing the cache)', function () {
    var a = strip(R.plan({ optimizeOrder: true, hazards: { solar: true } })); R.clearCache();
    var b = strip(R.plan({ optimizeOrder: true, hazards: { solar: true } })); ok(JSON.stringify(a) === JSON.stringify(b));
  });
  test('a solar event raises the radiation cost and risk; dust widens margins', function () {
    var n = R.plan({}), s = R.plan({ hazards: { solar: true } }), d = R.plan({ hazards: { dust: true } });
    ok(s.cost.chosenM > n.cost.chosenM * 2, 'solar cost ' + s.cost.chosenM + ' vs ' + n.cost.chosenM);
    ok(s.meanRisk > n.meanRisk + 0.3, 'solar risk ' + s.meanRisk + ' vs ' + n.meanRisk);
    ok(s.hazardNotes.some(function (t) { return /Solar particle event/.test(t); }));
    ok(d.cost.chosenM > n.cost.chosenM && d.totalM >= n.totalM, 'dust costs more');
    ok(R.costAt(900, 700, { solar: true }) > R.costAt(900, 700, {}), 'costAt');
    var L = R.limits(); ok(L.caution === 36 && L.danger === 55, 'limits from the radiation data');
    near(R.radiationAt(900, 700, { solar: true }), R.radiationAt(900, 700, {}) * L.mult, 1e-6, 'solar multiplier');
  });
  test('risk reflects crater intrusion: legs touching stop 3 are not low risk, plan.worst names the leg', function () {
    var p = R.plan({}), touching = p.legs.filter(function (l) { return l.insideM >= 5; });
    ok(touching.length >= 1, 'a leg enters a blocked crater margin (stop 3 lies inside crater 19)');
    touching.forEach(function (l) { ok(l.risk >= 0.7 && l.riskLevel === 'high' && l.notes.some(function (n) { return /inside a detected crater/.test(n); }), l.id + ' risk ' + l.risk); });
    ok(p.risk >= 0.7 && p.riskLevel === 'high' && p.worst && touching.some(function (l) { return l.id === p.worst.legId; }) && /inside a detected crater/.test(p.worst.reason), JSON.stringify(p.worst));
    ok(p.meanRisk < p.risk, 'meanRisk stays available');
    p.legs.filter(function (l) { return !l.insideM && !l.blocked && l.metrics.cautionM < 20; }).forEach(function (l) { ok(l.risk < 0.5, 'clean leg ' + l.id + ' ' + l.risk); });
  });
  test('a blocked leg is reported honestly, never silently straight', function () {
    var b = R.stops()[0], ring = []; for (var i = 0; i < 12; i++) { var a = i / 12 * 6.2832; ring.push({ x: b.x + Math.cos(a) * 30, y: b.y + Math.sin(a) * 30, r: 22 }); }
    var p = R.plan({ obstacles: ring });
    ok(p.blocked.indexOf('base>stop-1') >= 0, 'blocked ' + p.blocked);
    var l = p.legs[0]; ok(l.blocked === true && l.risk === 1 && l.notes[0].indexOf('WARNING') === 0, JSON.stringify(l.notes));
    ok(p.hazardNotes.some(function (n) { return /WARNING: no safe route/.test(n); }));
    ok(R.plan({}).blocked.length === 0, 'obstacles are not remembered');
  });
  test('ETAs match the travel speeds', function () {
    var p = R.plan({}); near(p.etaRoverS, p.totalM / SP.rover.mps, 1, 'rover'); near(p.etaFootS, p.totalM / SP.foot.mps, 1, 'foot');
    p.legs.forEach(function (l) { near(l.etaRoverS, l.lengthM / SP.rover.mps, 1, 'leg rover'); });
    ok(p.etaRoverS < p.etaFootS);
  });
  test('objective chooses the tasks: EVA minutes and counts', function () {
    var by = {}; M.tasks.forEach(function (t) { by[t.objective] = (by[t.objective] || 0) + t.estMin; });
    var p1 = R.plan({ objective: 1 }), p2 = R.plan({ objective: 2 }), pb = R.plan({ objective: 'both' }), pd = R.plan({});
    ok(p1.taskCount === 5 && p2.taskCount === 5 && pb.taskCount === 10 && pd.taskCount === 10);
    near(p1.evaTotalMin, by[1], 1e-9); near(p2.evaTotalMin, by[2], 1e-9); near(pb.evaTotalMin, by[1] + by[2], 1e-9);
    near(pb.etaMissionS, pb.etaRoverS + pb.evaTotalMin * 60, 1e-6);
    ok(R.plan({ objective: { choice: 2 } }).taskCount === 5);
  });
  test('leg() between arbitrary points starts and ends there', function () {
    var l = R.leg({ x: 1800, y: 1300 }, { x: 1500, y: 800 }, { hazards: {} });
    ok(l && l.points[0].x === 1800 && l.points[l.points.length - 1].y === 800 && l.lengthM >= l.straightM - 0.5, JSON.stringify(l && l.points[0]));
  });
  test('performance: cached plan under 300 ms, a full re-plan after a hazard change under 300 ms too', function () {
    R.warm({}); R.warm({ solar: true });   // grids cached
    var t = Date.now(); R.plan({ optimizeOrder: true, hazards: { solar: true } }); var cold = Date.now() - t;
    t = Date.now(); R.plan({ optimizeOrder: true, hazards: { solar: true } }); var hot = Date.now() - t;
    res.info.msColdPlanAfterGrid = cold; res.info.msCachedPlan = hot; ok(cold < 300, 'plan after the grid is cached took ' + cold + ' ms'); ok(hot < 50, 'cached ' + hot);
  });

  if (isNode) { console.log(res.passed + ' passed, ' + res.failed + ' failed'); res.failures.forEach(function (f) { console.log('FAIL ' + f); }); process.exit(res.failed ? 1 : 0); }
  else root.ROUTE_TEST_RESULT = res;
})(typeof window !== 'undefined' ? window : globalThis);
