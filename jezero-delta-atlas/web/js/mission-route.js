/* mission-route.js: window.JdaRoute, the safe-route planner for the Jezero Pathfinder mission.
   Pure, deterministic, no DOM, no network. Needs (all optional, degrades honestly): web/js/route-planner.js (grid builder),
   web/data/craters-data.js (crater detections), web/data/science-layers-data.js (generated radiation grid),
   web/data/mission-data.js (base camp, 5 stops, tasks), web/data/travel-speeds.js (rover / foot m/s).
   Model, parameters and limits: docs/ROUTING.md. Contract: docs/MULTIPAGE.md "Version 5 additions".

   JdaRoute.plan({objective, optimizeOrder, order, hazards:{solar,dust}, obstacles:[{x,y,r}]}) -> plan (see docs/ROUTING.md)
   JdaRoute.leg(fromXY, toXY, {hazards, obstacles}) -> one leg between any two page-px points
   JdaRoute.costAt / radiationAt / warm / clearCache / stops / params                                                      */
(function (root) {
  'use strict';
  var RP = root.RoutePlanner;

  /* ---------------- parameters (documented in docs/ROUTING.md) ---------------- */
  var P = {
    cell: 4,              // cost grid cell, page px (about 22 m)
    margin: 1.25,         // blocked radius = crater radius x margin (same as the atlas planner)
    dustMargin: 1.6,      // in dust the blocked radius grows (poor visibility, keep farther from rims)
    minConf: 0.6,         // detections below this confidence are passable but cost lowConfPenalty (route-planner default)
    lowConfPenalty: 4,
    haloM: 60,            // soft safety halo outside the blocked radius, metres
    haloCost: 1.2,        // extra cost at the blocked edge, fading to 0 over haloM
    dustHaloMul: 1.8,     // halo strength in dust
    dustOpenCost: 0.15,   // extra cost everywhere in dust (reduced visibility)
    radSoft: 0.6,         // radiation preference below caution: extra cost = radSoft * (dose / caution)^2
    radCaution: 4,        // extra cost added between caution and danger (linear)
    radDanger: 25,        // extra cost at and above danger (near-blocked, still passable so the plan never fails only because of dose)
    radDangerSlope: 0.5,  // plus this per uSv/h above the danger limit
    rimRiskM: 50,         // risk metric: path closer than this to a confident crater rim counts as risky
    smoothTol: 1.04,      // string pulling accepts a straight shortcut costing at most this x the grid path cost
    approachM: 250,       // a stop or base inside a crater margin may be approached through blocked cells within this distance of it
    approachMaxM: 700,    // never open more than this around an endpoint
    approachCost: 8,      // cost of such approach cells
    evaDefaultMin: 30,    // time on foot at a stop with no tasks
    fallbackRoverMps: 2.8, fallbackFootMps: 1.4
  };

  function num(v, fb) { v = Number(v); return isFinite(v) ? v : fb; }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function r1(v) { return Math.round(v * 10) / 10; }

  /* ---------------- inputs ---------------- */
  function craterData() {
    var CR = root.JEZERO_CRATERS || {}, meta = CR.meta || {};
    var bb = meta.bbox || { lon0: 77.22318, lon1: 77.41956, lat0: 18.44176, lat1: 18.57188 };
    var pg = meta.page || [1990, 1390];
    var list = (Array.isArray(CR.craters) ? CR.craters : []).filter(function (c) { return c && c.page && isFinite(c.page[0]) && isFinite(c.page[1]) && c.page[2] > 0; });
    return { meta: { bbox: bb, page: pg }, craters: list };
  }
  var CD = null;
  function cd() { return CD || (CD = craterData()); }
  function mpp() {
    var m = cd().meta;
    return RP ? RP.metersPerPx(m) : (m.bbox.lon1 - m.bbox.lon0) * 59270 * Math.cos(((m.bbox.lat0 + m.bbox.lat1) / 2) * Math.PI / 180) / m.page[0];
  }
  function toLL(x, y) {
    var m = cd().meta, b = m.bbox;
    return { lat: b.lat1 - y / m.page[1] * (b.lat1 - b.lat0), lon: b.lon0 + x / m.page[0] * (b.lon1 - b.lon0) };
  }
  function toXY(lat, lon) {
    var m = cd().meta, b = m.bbox;
    return [(lon - b.lon0) / (b.lon1 - b.lon0) * m.page[0], (b.lat1 - lat) / (b.lat1 - b.lat0) * m.page[1]];
  }
  function speeds() {
    var S = root.JEZERO_SPEEDS || {};
    return { rover: num(S.rover && S.rover.mps, P.fallbackRoverMps), foot: num(S.foot && S.foot.mps, P.fallbackFootMps) };
  }
  function missionNodes() {
    var M = root.JEZERO_MISSION || {}, out = { base: null, stops: [] };
    function node(o, id, name, n) {
      var x = num(o.x, NaN), y = num(o.y, NaN);
      if (!isFinite(x) || !isFinite(y)) { var p = toXY(num(o.lat, NaN), num(o.lon, NaN)); x = p[0]; y = p[1]; }
      if (!isFinite(x) || !isFinite(y)) return null;
      var l = toLL(x, y);
      return { id: id, n: n, name: name, x: x, y: y, lat: num(o.lat, l.lat), lon: num(o.lon, l.lon) };
    }
    if (M.base) out.base = node(M.base, 'base', String(M.base.name || 'Base camp'), 0);
    (Array.isArray(M.stops) ? M.stops : []).forEach(function (s, i) {
      var nd = node(s, String(s.id || 'stop-' + (i + 1)), String(s.name || 'Stop ' + (i + 1)), i + 1);
      if (nd) out.stops.push(nd);
    });
    return out;
  }
  function chosen(objective) {
    var c = objective && typeof objective === 'object' ? objective.choice : objective;
    return c === 1 || c === '1' ? 1 : c === 2 || c === '2' ? 2 : 'both';
  }
  function tasksFor(stopId, choice) {
    var T = (root.JEZERO_MISSION && root.JEZERO_MISSION.tasks) || [];
    return T.filter(function (t) { return t && t.stopId === stopId && (choice === 'both' || Number(t.objective) === choice); });
  }

  /* ---------------- radiation (same grid and bilinear sampling as layers-science.js, no DOM) ---------------- */
  var RAD = null, RAD_TRIED = false;
  function radGrid() {
    if (RAD_TRIED) return RAD; RAD_TRIED = true;
    try {
      var D = root.JEZERO_SCIENCE, R = D && D.radiation;
      if (!R || !R.grid || !(R.w > 1) || !(R.h > 1)) return null;
      var bin = atob(R.grid), q = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) q[i] = bin.charCodeAt(i);
      if (q.length !== R.w * R.h) return null;
      var L = R.limits || {};
      RAD = { w: R.w, h: R.h, q: q, min: num(R.min, 0), max: num(R.max, 40), caution: num(L.caution, 36), danger: num(L.danger, 55),
              mult: num(R.spe && R.spe.multiplier, 2.5), baseline: num(R.baseline, 26.67) };
    } catch (e) { RAD = null; }
    return RAD;
  }
  function doseBase(x, y) {   // uSv/h without solar event
    var g = radGrid(); if (!g) return 26.67;
    var W = cd().meta.page[0], H = cd().meta.page[1];
    var gx = clamp(x / W * g.w - 0.5, 0, g.w - 1), gy = clamp(y / H * g.h - 0.5, 0, g.h - 1);
    var x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(g.w - 1, x0 + 1), y1 = Math.min(g.h - 1, y0 + 1), fx = gx - x0, fy = gy - y0, q = g.q;
    var top = q[y0 * g.w + x0] * (1 - fx) + q[y0 * g.w + x1] * fx, bot = q[y1 * g.w + x0] * (1 - fx) + q[y1 * g.w + x1] * fx;
    return g.min + (top * (1 - fy) + bot * fy) / 255 * (g.max - g.min);
  }
  function limits() { var g = radGrid(); return { caution: g ? g.caution : 36, danger: g ? g.danger : 55, mult: g ? g.mult : 2.5, available: !!g }; }
  function normHaz(h) { h = h || {}; return { solar: !!h.solar, dust: !!h.dust }; }
  function doseAt(x, y, haz) { return doseBase(x, y) * (haz && haz.solar ? limits().mult : 1); }
  function radPenalty(v, L) {
    if (v >= L.danger) return P.radSoft + P.radCaution + P.radDanger + P.radDangerSlope * (v - L.danger);
    if (v >= L.caution) return P.radSoft + P.radCaution * (v - L.caution) / (L.danger - L.caution);
    return P.radSoft * (v / L.caution) * (v / L.caution);
  }

  /* ---------------- cost field ---------------- */
  var CACHE = { terrain: {}, field: {}, pair: {}, plan: {} };
  var radCells = null;   // dose (no solar) at every grid cell centre
  function clearCache() { CACHE = { terrain: {}, field: {}, pair: {}, plan: {} }; radCells = null; CD = null; RAD = null; RAD_TRIED = false; }

  function obstacleKey(obs) { return obs && obs.length ? obs.map(function (o) { return [o.x, o.y, o.r].map(function (v) { return Math.round(num(v, 0) * 10) / 10; }).join(','); }).join(';') : ''; }
  function cleanObstacles(obs) {
    return (Array.isArray(obs) ? obs : []).filter(function (o) { return o && isFinite(Number(o.x)) && isFinite(Number(o.y)) && Number(o.r) > 0; })
      .slice(0, 64).map(function (o) { return { x: Number(o.x), y: Number(o.y), r: Number(o.r) }; });
  }
  /* terrain: crater obstacles + soft halo (depends on dust only through margin and halo strength) */
  function terrain(dust, obs) {
    var key = (dust ? 'd' : 'n') + '|' + obstacleKey(obs);
    if (CACHE.terrain[key]) return CACHE.terrain[key];
    var D = cd(), margin = dust ? P.dustMargin : P.margin;
    var extra = (obs || []).map(function (o) { return { id: 'obs', confidence: 1, page: [o.x, o.y, o.r / margin], diameter_m: 0 }; });   // obstacle radius is the literal blocked radius
    var grid = RP.buildGrid(D.craters.concat(extra), D.meta, { cell: P.cell, margin: margin, minConf: P.minConf, lowConfPenalty: P.lowConfPenalty });
    var halo = new Float32Array(grid.cost.length), haloPx = P.haloM / grid.mpp, cell = grid.cell, nx = grid.nx, ny = grid.ny;
    D.craters.concat(extra).forEach(function (c) {
      if (c.confidence < P.minConf) return;
      var x = c.page[0], y = c.page[1], R = c.page[2] * margin, RR = R + haloPx;
      var i0 = Math.max(0, Math.floor((x - RR) / cell)), i1 = Math.min(nx - 1, Math.floor((x + RR) / cell));
      var j0 = Math.max(0, Math.floor((y - RR) / cell)), j1 = Math.min(ny - 1, Math.floor((y + RR) / cell));
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
        var d = Math.hypot((i + 0.5) * cell - x, (j + 0.5) * cell - y);
        if (d > R && d < RR) { var v = 1 - (d - R) / haloPx, k = j * nx + i; if (v > halo[k]) halo[k] = v; }
      }
    });
    return (CACHE.terrain[key] = { grid: grid, halo: halo });
  }
  function radiationCells(grid) {
    if (radCells && radCells.length === grid.cost.length) return radCells;
    radCells = new Float32Array(grid.cost.length);
    for (var j = 0; j < grid.ny; j++) for (var i = 0; i < grid.nx; i++) radCells[j * grid.nx + i] = doseBase((i + 0.5) * grid.cell, (j + 0.5) * grid.cell);
    return radCells;
  }
  /* the full cost field for a hazard set: grid object {cell,nx,ny,cost,mpp,W,H} where cost >= 1 or Infinity */
  function field(haz, obs) {
    var key = (haz.dust ? 'd' : 'n') + (haz.solar ? 's' : 'c') + '|' + obstacleKey(obs);
    if (CACHE.field[key]) return CACHE.field[key];
    var T = terrain(haz.dust, obs), g = T.grid, L = limits(), rad = radiationCells(g), mult = haz.solar ? L.mult : 1;
    var cost = new Float32Array(g.cost.length), haloMul = haz.dust ? P.dustHaloMul : 1;
    for (var k = 0; k < cost.length; k++) {
      var c = g.cost[k];
      if (c === Infinity) { cost[k] = Infinity; continue; }
      cost[k] = c + T.halo[k] * P.haloCost * haloMul + radPenalty(rad[k] * mult, L) + (haz.dust ? P.dustOpenCost : 0);
    }
    var f = { cell: g.cell, nx: g.nx, ny: g.ny, cost: cost, mpp: g.mpp, W: g.W, H: g.H, key: key };
    return (CACHE.field[key] = f);
  }

  /* ---------------- search: A*, 8 connected, octile heuristic, scratch arrays reused ---------------- */
  var S = { n: 0, dist: null, prev: null, seen: null, done: null, gen: 0, hp: null, hn: null, hs: 0 };
  function scratch(n) {
    if (S.n !== n) { S.n = n; S.dist = new Float32Array(n); S.prev = new Int32Array(n); S.seen = new Uint32Array(n); S.done = new Uint32Array(n); S.gen = 0; S.hp = new Float64Array(1 << 16); S.hn = new Int32Array(1 << 16); }
  }
  function hpush(pri, node) {
    if (S.hs === S.hp.length) { var a = new Float64Array(S.hs * 2), b = new Int32Array(S.hs * 2); a.set(S.hp); b.set(S.hn); S.hp = a; S.hn = b; }
    var p = S.hp, n = S.hn, i = S.hs++;
    while (i > 0) { var up = (i - 1) >> 1; if (p[up] <= pri) break; p[i] = p[up]; n[i] = n[up]; i = up; }
    p[i] = pri; n[i] = node;
  }
  function hpop() {
    var p = S.hp, n = S.hn, top = n[0], lp = p[--S.hs], ln = n[S.hs], len = S.hs, i = 0;
    if (len) {
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = l;
        if (l >= len) break;
        if (r < len && p[r] < p[l]) m = r;
        if (p[m] >= lp) break;
        p[i] = p[m]; n[i] = n[m]; i = m;
      }
      p[i] = lp; n[i] = ln;
    }
    return top;
  }
  function astar(g, s, t) {
    var nx = g.nx, ny = g.ny, cost = g.cost, N = nx * ny, SQ2 = Math.SQRT2;
    scratch(N); var gen = ++S.gen, dist = S.dist, prev = S.prev, seen = S.seen, done = S.done;
    var tx = t % nx, ty = (t / nx) | 0;
    function h(k) { var dx = Math.abs((k % nx) - tx), dy = Math.abs(((k / nx) | 0) - ty); return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy); }
    S.hs = 0; seen[s] = gen; dist[s] = 0; prev[s] = -1; hpush(h(s), s);
    while (S.hs) {
      var k = hpop(); if (done[k] === gen) continue; done[k] = gen;
      if (k === t) break;
      var x = k % nx, y = (k / nx) | 0, dk = dist[k], ck = cost[k];
      for (var dy = -1; dy <= 1; dy++) {
        var yy = y + dy; if (yy < 0 || yy >= ny) continue;
        for (var dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          var xx = x + dx; if (xx < 0 || xx >= nx) continue;
          var q = yy * nx + xx; if (done[q] === gen) continue;
          var cq = cost[q]; if (cq === Infinity) continue;
          if (dx && dy && (cost[y * nx + xx] === Infinity || cost[yy * nx + x] === Infinity)) continue;
          var nd = dk + (dx && dy ? SQ2 : 1) * (ck + cq) / 2;
          if (seen[q] !== gen || nd < dist[q]) { seen[q] = gen; dist[q] = nd; prev[q] = k; hpush(nd + h(q), q); }
        }
      }
    }
    if (done[t] !== gen) return null;
    var cells = [], cum = [];
    for (var c = t; c !== -1; c = prev[c]) { cells.push(c); cum.push(dist[c]); }
    cells.reverse(); cum.reverse();
    return { cells: cells, cum: cum, cost: dist[t] };
  }

  function cellOf(g, x, y) { return clamp(Math.floor(y / g.cell), 0, g.ny - 1) * g.nx + clamp(Math.floor(x / g.cell), 0, g.nx - 1); }
  /* weighted length of a straight segment in cost-px (Infinity if it crosses a blocked cell) */
  function lineCost(g, a, b) {
    var len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len === 0) return 0;
    var steps = Math.max(1, Math.ceil(len / (g.cell * 0.25))), total = 0;
    for (var t = 0; t < steps; t++) {
      var f = (t + 0.5) / steps, c = g.cost[cellOf(g, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)];
      if (c === Infinity) return Infinity;
      total += c * len / steps;
    }
    return total;
  }
  /* string pulling: drop collinear grid points, then jump to the farthest point reachable in a straight line that costs no more than the grid path (x smoothTol) */
  function smooth(g, pts, cum) {
    var keep = [0];
    for (var i = 1; i < pts.length - 1; i++) {
      var a = pts[keep[keep.length - 1]], b = pts[i], c = pts[i + 1];
      var cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(cross) > 1e-6 || i - keep[keep.length - 1] >= 40) keep.push(i);
    }
    keep.push(pts.length - 1);
    var q = keep.map(function (i) { return pts[i]; }), qc = keep.map(function (i) { return cum[i]; });
    var out = [q[0]], i2 = 0;
    while (i2 < q.length - 1) {
      var best = i2 + 1;
      for (var j = q.length - 1; j > i2 + 1; j--) {
        var lc = lineCost(g, q[i2], q[j]);
        if (lc !== Infinity && lc <= (qc[j] - qc[i2]) * g.cell * P.smoothTol) { best = j; break; }
      }
      out.push(q[best]); i2 = best;
    }
    return out;
  }

  /* ---------------- leg geometry and metrics ---------------- */
  function riskLevel(r) { return r >= 0.5 ? 'high' : r >= 0.2 ? 'medium' : 'low'; }
  function polyLenPx(pts) { var s = 0; for (var i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }
  function distToSeg(px, py, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, t = l2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  }
  function sampleLine(pts, step) {   // [{x,y,len}] along a polyline every ~step px, each sample stands for len px
    var out = [];
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / step));
      for (var k = 0; k < n; k++) { var f = (k + 0.5) / n; out.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, len: len / n }); }
    }
    return out;
  }
  function nearRim(x, y, rimPx, obs) {   // within rimPx of a confident crater rim (or inside it)
    var list = cd().craters;
    for (var i = 0; i < list.length; i++) {
      var c = list[i]; if (c.confidence < P.minConf) continue;
      if (Math.hypot(x - c.page[0], y - c.page[1]) - c.page[2] < rimPx) return true;
    }
    for (var j = 0; j < obs.length; j++) if (Math.hypot(x - obs[j].x, y - obs[j].y) - obs[j].r < rimPx) return true;
    return false;
  }
  /* metrics of a polyline: metres in caution radiation, in danger radiation, near a rim, and risk 0..1 = fraction of the length that is in caution
     radiation (>= caution at the current hazards) or within rimRiskM of a confident crater rim */
  function metrics(pts, haz, obs) {
    var m = mpp(), L = limits(), rimPx = P.rimRiskM / m, smp = sampleLine(pts, 3), tot = 0, risky = 0, caution = 0, danger = 0, rim = 0;
    smp.forEach(function (s) {
      var v = doseAt(s.x, s.y, haz), c = v >= L.caution, d = v >= L.danger, r = nearRim(s.x, s.y, rimPx, obs);
      tot += s.len; if (c) caution += s.len; if (d) danger += s.len; if (r) rim += s.len; if (c || r) risky += s.len;
    });
    return { risk: tot ? risky / tot : 0, cautionM: caution * m, dangerM: danger * m, rimM: rim * m, lengthM: tot * m };
  }
  /* craters whose blocked circle the straight line between a and b would cross */
  function craterHits(a, b, haz, obs) {
    var margin = haz.dust ? P.dustMargin : P.margin, hits = 0;
    cd().craters.forEach(function (c) { if (c.confidence >= P.minConf && distToSeg(c.page[0], c.page[1], a, b) < c.page[2] * margin) hits++; });
    obs.forEach(function (o) { if (distToSeg(o.x, o.y, a, b) < o.r) hits++; });
    return hits;
  }
  function isInside(f, n) { return f.cost[cellOf(f, n.x, n.y)] === Infinity; }
  /* distinct craters the route passes within 2 rim radii of while the straight line would have crossed them (the ones actually avoided) */
  function pt(x, y, extra) { var l = toLL(x, y), o = { x: r1(x), y: r1(y), lat: l.lat, lon: l.lon }; if (extra) for (var k in extra) o[k] = extra[k]; return o; }

  /* temporarily open blocked cells within radiusPx of (x,y) at approachCost; returns an undo list */
  function patch(g, x, y, radiusPx, undo) {
    var i0 = Math.max(0, Math.floor((x - radiusPx) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((x + radiusPx) / g.cell));
    var j0 = Math.max(0, Math.floor((y - radiusPx) / g.cell)), j1 = Math.min(g.ny - 1, Math.floor((y + radiusPx) / g.cell));
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
      var k = j * g.nx + i;
      if (g.cost[k] === Infinity && Math.hypot((i + 0.5) * g.cell - x, (j + 0.5) * g.cell - y) <= radiusPx) { undo.push(k); g.cost[k] = P.approachCost; }
    }
  }
  /* 0 if (x,y) is on open ground, else the distance in px to the nearest open cell (ring search, 0 if none within reach) */
  function blockedDepthPx(g, x, y) {
    var k = cellOf(g, x, y); if (g.cost[k] !== Infinity) return 0;
    var cx = k % g.nx, cy = (k / g.nx) | 0, R = Math.ceil(P.approachMaxM / g.mpp / g.cell), best = Infinity;
    for (var r = 1; r <= R && r * g.cell < best + g.cell; r++)
      for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        var xx = cx + dx, yy = cy + dy; if (xx < 0 || yy < 0 || xx >= g.nx || yy >= g.ny || g.cost[yy * g.nx + xx] === Infinity) continue;
        best = Math.min(best, Math.hypot(((xx + 0.5) * g.cell) - x, ((yy + 0.5) * g.cell) - y));
      }
    return isFinite(best) ? best : 0;
  }
  /* path between two nodes: {cost, pts (smoothed page px, exact endpoints)} or null (blocked). Cached per hazard field.
     Endpoints inside a blocked crater margin are approached through that margin (patched cells, see approachM) and flagged. */
  function route(f, A, B) {
    var key = f.key + '|' + A.id + '>' + B.id, hit = CACHE.pair[key];
    if (hit !== undefined) return hit;
    var rev = CACHE.pair[f.key + '|' + B.id + '>' + A.id], res = null;
    if (rev) res = { cost: rev.cost, pts: rev.pts.slice().reverse() };
    else {
      var undo = [];
      [A, B].forEach(function (n) { var d = blockedDepthPx(f, n.x, n.y); if (d > 0) patch(f, n.x, n.y, Math.min(Math.max(P.approachM / f.mpp, d + 3 * f.cell), P.approachMaxM / f.mpp), undo); });
      var r = astar(f, cellOf(f, A.x, A.y), cellOf(f, B.x, B.y));
      if (r) {
        var g = f, pts = r.cells.map(function (k) { return [((k % g.nx) + 0.5) * g.cell, (((k / g.nx) | 0) + 0.5) * g.cell]; });
        var sm = smooth(g, pts, r.cum), mid = sm.slice(1, sm.length - 1);
        res = { cost: r.cost, pts: [[A.x, A.y]].concat(mid, [[B.x, B.y]]) };
      }
      undo.forEach(function (k) { f.cost[k] = Infinity; });
    }
    CACHE.pair[key] = res;
    return res;
  }
  function pairCost(f, A, B) { var r = route(f, A, B); return r ? r.cost * f.cell * f.mpp : Infinity; }   // hazard-weighted metres

  function buildLeg(f, A, B, haz, obs, idx) {
    var m = f.mpp, id = A.id + '>' + B.id, r = route(f, A, B), straightPx = Math.hypot(B.x - A.x, B.y - A.y), straightM = straightPx * m;
    var leg = { id: id, index: idx, fromId: A.id, toId: B.id, points: null, lengthM: 0, straightM: r1(straightM), risk: 0, notes: [], blocked: false, weightedM: 0, detourM: 0, craterHits: craterHits([A.x, A.y], [B.x, B.y], haz, obs) };
    var ptsPx, notes = leg.notes;
    if (!r) {
      leg.blocked = true; leg.risk = 1;
      ptsPx = [[A.x, A.y], [B.x, B.y]];
      notes.push('WARNING: no safe route found between ' + A.name + ' and ' + B.name + '. The line shown is a direct line for reference only and crosses hazard areas; do not drive it without a manual check.');
    } else {
      ptsPx = r.pts;
      var inside = sampleLine(ptsPx, 3).reduce(function (a, s) { return a + (f.cost[cellOf(f, s.x, s.y)] === Infinity ? s.len : 0); }, 0) * f.mpp;
      leg.insideM = r1(inside);
      if (inside >= 5) notes.push('WARNING: ' + Math.round(inside) + ' m of this leg lie inside a detected crater safety margin (' + [A, B].filter(function (n) { return n.id !== 'from' && n.id !== 'to' && n.id !== 'base' && isInside(f, n); }).map(function (n) { return n.name; }).join(' and ') + ' is located there). Slope is not known: check the approach on site.');
    }
    leg.points = ptsPx.map(function (p, i) { return pt(p[0], p[1]); });
    leg.lengthM = r1(polyLenPx(ptsPx) * m);
    leg.weightedM = r ? r1(r.cost * f.cell * m) : null;
    leg.detourM = r1(Math.max(0, leg.lengthM - leg.straightM));
    var mt = metrics(ptsPx, haz, obs), st = metrics([[A.x, A.y], [B.x, B.y]], haz, obs), L = limits();
    if (!leg.blocked) leg.risk = Math.round(mt.risk * 1000) / 1000;
    if (!leg.blocked && leg.insideM >= 5) {   // inside a blocked crater margin is never low risk: at least 0.7, up to 1 as the inside share grows
      var frac = leg.insideM / Math.max(1, leg.lengthM);
      leg.risk = Math.round(Math.max(leg.risk, 0.7 + 0.3 * Math.min(1, frac * 2)) * 1000) / 1000;
    }
    leg.riskLevel = riskLevel(leg.risk);
    leg.metrics = { cautionM: r1(mt.cautionM), dangerM: r1(mt.dangerM), rimM: r1(mt.rimM), straightCautionM: r1(st.cautionM), straightRimM: r1(st.rimM) };
    if (!leg.blocked) {
      if (leg.detourM >= 5 && leg.craterHits) notes.push('Detours ' + Math.round(leg.detourM) + ' m (' + Math.round(leg.detourM / Math.max(1, straightM) * 100) + ' %) around ' + leg.craterHits + (leg.craterHits === 1 ? ' crater' : ' craters') + '.');
      else if (leg.detourM >= 5) notes.push('Detours ' + Math.round(leg.detourM) + ' m (' + Math.round(leg.detourM / Math.max(1, straightM) * 100) + ' %) to keep clear of ' + (st.cautionM > mt.cautionM + 1 ? 'higher radiation and ' : '') + 'crater margins.');
      if (st.cautionM - mt.cautionM >= 20) notes.push('Avoids ' + Math.round(st.cautionM - mt.cautionM) + ' m of radiation above the caution limit (' + L.caution + ' uSv/h) that the direct line would cross.');
      if (mt.dangerM >= 1) notes.push('WARNING: ' + Math.round(mt.dangerM) + ' m of this leg is above the danger limit (' + L.danger + ' uSv/h); no lower-dose way was found.');
      else if (mt.cautionM >= 20) notes.push(Math.round(mt.cautionM) + ' m of this leg is above the caution limit (' + L.caution + ' uSv/h).');
      if (mt.rimM >= 20) notes.push(Math.round(mt.rimM) + ' m of this leg stays within ' + P.rimRiskM + ' m of a crater rim.');
    }
    return leg;
  }

  /* ---------------- plan ---------------- */
  function permutations(arr) {   // lexicographic by index, so the guide order is first
    var out = [];
    (function rec(cur, rest) { if (!rest.length) { out.push(cur); return; } for (var i = 0; i < rest.length; i++) rec(cur.concat(rest[i]), rest.slice(0, i).concat(rest.slice(i + 1))); })([], arr);
    return out;
  }

  function plan(opts) {
    opts = opts || {};
    var haz = normHaz(opts.hazards), obs = cleanObstacles(opts.obstacles), choice = chosen(opts.objective);
    var nodes = missionNodes();
    if (!RP || !nodes.base || !nodes.stops.length) return emptyPlan(haz, choice, 'Mission data or the route planner is missing, so no safe route can be computed.');
    var byId = {}; nodes.stops.forEach(function (s) { byId[s.id] = s; });
    var guide = nodes.stops.map(function (s) { return s.id; });
    var explicit = Array.isArray(opts.order) && opts.order.length ? opts.order.filter(function (id) { return byId[id]; }) : null;
    var key = [haz.solar ? 1 : 0, haz.dust ? 1 : 0, choice, opts.optimizeOrder ? 1 : 0, explicit ? explicit.join(',') : '', obstacleKey(obs)].join('|');
    if (CACHE.plan[key]) return CACHE.plan[key];
    var t0 = Date.now(), f = field(haz, obs), L = limits(), SP = speeds(), m = f.mpp;
    var chain = function (ord) { return [nodes.base].concat(ord.map(function (id) { return byId[id]; }), [nodes.base]); };
    function totalCost(ord) { var c = chain(ord), s = 0; for (var i = 1; i < c.length; i++) s += pairCost(f, c[i - 1], c[i]); return s; }
    var order = explicit || guide.slice(), guideCost = totalCost(guide), chosenCost, optimized = false;
    if (!explicit && opts.optimizeOrder && guide.length > 1) {
      var best = guide, bc = guideCost;
      permutations(guide).forEach(function (p) { var c = totalCost(p); if (c < bc - 1e-6) { bc = c; best = p; } });
      order = best; optimized = best.join() !== guide.join();
    }
    chosenCost = totalCost(order);
    var ch = chain(order), legs = [];
    for (var i = 1; i < ch.length; i++) legs.push(buildLeg(f, ch[i - 1], ch[i], haz, obs, i - 1));
    var out = assemble(legs, order, nodes, byId, haz, choice, L, SP, m);
    out.optimizeOrder = !!opts.optimizeOrder; out.optimized = optimized; out.guideOrder = guide;
    out.cost = { guideM: isFinite(guideCost) ? r1(guideCost) : null, chosenM: isFinite(chosenCost) ? r1(chosenCost) : null, savedM: isFinite(guideCost) && isFinite(chosenCost) ? r1(Math.max(0, guideCost - chosenCost)) : null };
    if (optimized && out.cost.savedM !== null) out.hazardNotes.unshift('Stop order changed to ' + order.map(function (id) { return byId[id].n; }).join(', ') + ' (guide order 1 to ' + guide.length + '): hazard-weighted cost drops by ' + Math.round(out.cost.savedM) + ' m-equivalent (' + (Math.round(out.cost.savedM / Math.max(1, guideCost) * 1000) / 10) + ' %).');
    else if (opts.optimizeOrder && !optimized) out.hazardNotes.unshift('Guide order is already the lowest hazard-weighted cost.');
    out.computeMs = Date.now() - t0;
    if (!obs.length || true) CACHE.plan[key] = out;
    return out;
  }

  function assemble(legs, order, nodes, byId, haz, choice, L, SP, m) {
    var nameOf = { base: nodes.base.name }; nodes.stops.forEach(function (s) { nameOf[s.id] = s.name; });
    var waypoints = [], total = 0, straight = 0, riskLen = 0, avoidedCraters = 0, avoidedRadM = 0, blocked = [], notes = [];
    legs.forEach(function (leg, li) {
      total += leg.lengthM; straight += leg.straightM; riskLen += leg.risk * leg.lengthM;
      if (leg.blocked) blocked.push(leg.id);
      else {
        if (leg.detourM >= 5) avoidedCraters += leg.craterHits;
        avoidedRadM += Math.max(0, leg.metrics.straightCautionM - leg.metrics.cautionM);
      }
      leg.points.forEach(function (p, pi) {
        if (pi === 0 && li > 0) return;   // the previous leg already ended here
        var w = { x: p.x, y: p.y, lat: p.lat, lon: p.lon, kind: 'via' };
        if (pi === 0) { w.kind = 'base'; w.stopId = undefined; }
        else if (pi === leg.points.length - 1) { if (leg.toId === 'base') w.kind = 'base'; else { w.kind = 'stop'; w.stopId = leg.toId; } }
        if (w.stopId === undefined) delete w.stopId;
        waypoints.push(w);
      });
    });
    var worst = null; legs.forEach(function (l) { if (!worst || l.risk > worst.risk) worst = l; });
    var intrusion = legs.some(function (l) { return l.blocked || l.insideM >= 5; });
    var meanRisk = total ? riskLen / total : 0, planRisk = intrusion && worst ? Math.max(meanRisk, worst.risk) : meanRisk;
    var out = { v: 1, hazards: { solar: haz.solar, dust: haz.dust }, objective: choice, order: order.slice(), legs: legs, waypoints: waypoints,
      totalM: r1(total), straightM: r1(straight), detourM: r1(Math.max(0, total - straight)), etaRoverS: Math.round(total / SP.rover), etaFootS: Math.round(total / SP.foot),
      speeds: SP, risk: Math.round(planRisk * 1000) / 1000, riskLevel: riskLevel(planRisk), meanRisk: Math.round(meanRisk * 1000) / 1000,
      worst: worst ? { legId: worst.id, index: worst.index, risk: worst.risk, riskLevel: worst.riskLevel, reason: worst.blocked ? 'no safe route' : worst.insideM >= 5 ? 'inside a detected crater safety margin for ' + Math.round(worst.insideM) + ' m' : worst.metrics.dangerM >= 1 ? 'radiation above the danger limit' : worst.metrics.cautionM >= 20 ? 'radiation above the caution limit' : worst.metrics.rimM >= 20 ? 'close to crater rims' : 'none' } : null, avoided: { craters: avoidedCraters, radiationM: Math.round(avoidedRadM) },
      blocked: blocked, hazardNotes: notes, limits: { caution: L.caution, danger: L.danger, radiationData: L.available }, nameOf: nameOf, mPerPx: m };
    out.stops = order.map(function (id) {
      var s = byId[id], tk = tasksFor(id, choice);
      return { id: id, n: s.n, name: s.name, x: s.x, y: s.y, lat: s.lat, lon: s.lon, tasks: tk.map(function (t) { return t.id; }), evaMin: tk.length ? tk.reduce(function (a, t) { return a + num(t.estMin, 20); }, 0) : P.evaDefaultMin };
    });
    out.evaTotalMin = out.stops.reduce(function (a, s) { return a + s.evaMin; }, 0);
    out.taskCount = out.stops.reduce(function (a, s) { return a + s.tasks.length; }, 0);
    out.etaMissionS = out.etaRoverS + out.evaTotalMin * 60;
    var dangerM = 0; legs.forEach(function (l) { dangerM += l.metrics ? l.metrics.dangerM : 0; });
    var allDanger = total > 0 && dangerM >= 0.9 * total;
    if (allDanger) notes.push('WARNING: ' + Math.round(dangerM / total * 100) + ' % of the route is above the danger limit (' + L.danger + ' uSv/h) and no lower-dose way exists with this event active; avoid the drive unless it is an emergency.');
    legs.forEach(function (leg) {
      leg.etaRoverS = Math.round(leg.lengthM / SP.rover); leg.etaFootS = Math.round(leg.lengthM / SP.foot);
      var lab = 'Leg ' + (leg.index + 1) + ' (' + nameOf[leg.fromId] + ' to ' + nameOf[leg.toId] + ')';
      leg.notes.forEach(function (n) { if (allDanger && /above the danger limit/.test(n)) return; if (/^(Detours|Avoids|WARNING)/.test(n) || /is above|stays within|inside a crater/.test(n)) notes.push(lab + ': ' + n.replace(/^Detours/, 'detours').replace(/^Avoids/, 'avoids').replace(/^WARNING: /, 'WARNING: ')); });
    });
    if (haz.solar) notes.push('Solar particle event active: dose rates x' + L.mult + '; the route weighs radiation more heavily.');
    if (haz.dust) notes.push('Dust storm active: crater safety margins are widened and open ground costs slightly more.');
    if (!L.available) notes.push('Radiation data is not loaded on this page, so only craters were considered.');
    if (!blocked.length && !notes.some(function (n) { return /detours|avoids/.test(n); })) notes.push('The direct line between all stops is already clear of known craters and high radiation.');
    return out;
  }
  function emptyPlan(haz, choice, why) {
    return { v: 1, hazards: haz, objective: choice, order: [], legs: [], waypoints: [], totalM: 0, straightM: 0, detourM: 0, etaRoverS: 0, etaFootS: 0, risk: 0, avoided: { craters: 0, radiationM: 0 }, blocked: [], hazardNotes: [why], stops: [], evaTotalMin: 0, taskCount: 0, etaMissionS: 0, error: why };
  }

  /* one leg between arbitrary page-px points (used by the simulation to re-plan from the current position) */
  function leg(from, to, opts) {
    opts = opts || {};
    var haz = normHaz(opts.hazards), obs = cleanObstacles(opts.obstacles);
    if (!RP) return null;
    var f = field(haz, obs), A = { id: 'from', name: String(opts.fromName || 'the current position'), x: num(from.x, 0), y: num(from.y, 0) }, B = { id: 'to', name: String(opts.toName || 'the next stop'), x: num(to.x, 0), y: num(to.y, 0) };
    var key = f.key + '|' + A.id + '>' + B.id; delete CACHE.pair[key]; delete CACHE.pair[f.key + '|' + B.id + '>' + A.id];   // ad-hoc nodes share ids: never cache them
    var lg = buildLeg(f, A, B, haz, obs, 0);
    delete CACHE.pair[key];
    return lg;
  }

  function warm(hazards, obstacles) { if (!RP) return false; var f = field(normHaz(hazards), cleanObstacles(obstacles)); return !!f; }
  function costAt(x, y, hazards, obstacles) { if (!RP) return NaN; var f = field(normHaz(hazards), cleanObstacles(obstacles)); return f.cost[cellOf(f, x, y)]; }
  function stopsList() { var n = missionNodes(); return n.base ? [n.base].concat(n.stops) : n.stops; }

  root.JdaRoute = { plan: plan, leg: leg, warm: warm, clearCache: clearCache, costAt: costAt, radiationAt: function (x, y, h) { return doseAt(x, y, normHaz(h)); },
    limits: limits, params: P, stops: stopsList, toXY: toXY, toLL: toLL, mPerPx: mpp, speeds: speeds, version: 1 };
})(typeof window !== 'undefined' ? window : globalThis);
