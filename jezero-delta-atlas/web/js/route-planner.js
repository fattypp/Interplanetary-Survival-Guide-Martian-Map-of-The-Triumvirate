/* Route planner: A* over a cost grid built from the detected craters.
   Works in the atlas "page" pixel space (meta.page, e.g. 1990 x 1390) and converts to real
   metres with the same scale the atlas scale bar uses. Exposes window.RoutePlanner.

   Cost model (cost = how many times slower than open ground a cell is):
   - crater with confidence >= minConf: blocked out to rim radius * margin
   - lower-confidence mark: passable but costs lowConfPenalty x inside its radius
   - everything else: 1
   Not modelled yet: slope, rocks and dunes (the repo has no elevation data fine enough). */
(function (root) {
  var KM_PER_DEG = 59.27;   // same constant as the atlas scale bar (Mars, equatorial)
  var DEFAULTS = { cell: 3, margin: 1.25, minConf: 0.6, lowConfPenalty: 4 };

  function metersPerPx(meta) {
    var b = meta.bbox;
    return (b.lon1 - b.lon0) * KM_PER_DEG * 1000 * Math.cos(((b.lat0 + b.lat1) / 2) * Math.PI / 180) / meta.page[0];
  }

  function buildGrid(craters, meta, opt) {
    opt = Object.assign({}, DEFAULTS, opt || {});
    var cell = opt.cell, nx = Math.ceil(meta.page[0] / cell), ny = Math.ceil(meta.page[1] / cell);
    var cost = new Float32Array(nx * ny).fill(1);
    craters.forEach(function (c) {
      var x = c.page[0], y = c.page[1], r = c.page[2], solid = c.confidence >= opt.minConf;
      var R = r * (solid ? opt.margin : 1.1);
      var i0 = Math.max(0, Math.floor((x - R) / cell)), i1 = Math.min(nx - 1, Math.floor((x + R) / cell));
      var j0 = Math.max(0, Math.floor((y - R) / cell)), j1 = Math.min(ny - 1, Math.floor((y + R) / cell));
      for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
        var dx = (i + 0.5) * cell - x, dy = (j + 0.5) * cell - y;
        if (dx * dx + dy * dy > R * R) continue;
        var k = j * nx + i;
        cost[k] = solid ? Infinity : Math.max(cost[k], opt.lowConfPenalty);
      }
    });
    return { cell: cell, nx: nx, ny: ny, cost: cost, mpp: metersPerPx(meta), W: meta.page[0], H: meta.page[1] };
  }

  /* Binary min-heap of [priority, node] kept in two parallel arrays. */
  function Heap() { this.p = []; this.n = []; }
  Heap.prototype.push = function (pri, node) {
    var p = this.p, n = this.n, i = p.length; p.push(pri); n.push(node);
    while (i > 0) { var up = (i - 1) >> 1; if (p[up] <= p[i]) break; swap(p, n, i, up); i = up; }
  };
  Heap.prototype.pop = function () {
    var p = this.p, n = this.n, top = n[0], lastP = p.pop(), lastN = n.pop();
    if (p.length) {
      p[0] = lastP; n[0] = lastN;
      var i = 0, len = p.length;
      for (;;) {
        var l = 2 * i + 1, r = l + 1, m = i;
        if (l < len && p[l] < p[m]) m = l;
        if (r < len && p[r] < p[m]) m = r;
        if (m === i) break; swap(p, n, i, m); i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.p.length; };
  function swap(p, n, a, b) { var t = p[a]; p[a] = p[b]; p[b] = t; t = n[a]; n[a] = n[b]; n[b] = t; }

  function cellOf(grid, x, y) {
    var i = Math.min(grid.nx - 1, Math.max(0, Math.floor(x / grid.cell)));
    var j = Math.min(grid.ny - 1, Math.max(0, Math.floor(y / grid.cell)));
    return j * grid.nx + i;
  }

  /* A*: 8 directions, diagonals cost sqrt(2), no cutting corners of blocked cells. */
  function astar(grid, s, g) {
    var nx = grid.nx, N = nx * grid.ny, cost = grid.cost;
    var gx = g % nx, gy = (g / nx) | 0, SQ2 = Math.SQRT2;
    var dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    function h(k) { var dx = Math.abs((k % nx) - gx), dy = Math.abs(((k / nx) | 0) - gy); return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy); }
    var heap = new Heap(); dist[s] = 0; heap.push(h(s), s);
    while (heap.size()) {
      var k = heap.pop(); if (done[k]) continue; done[k] = 1;
      if (k === g) break;
      var x = k % nx, y = (k / nx) | 0;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        var xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= nx || yy >= grid.ny) continue;
        var q = yy * nx + xx; if (done[q] || cost[q] === Infinity) continue;
        if (dx && dy && (cost[y * nx + xx] === Infinity || cost[yy * nx + x] === Infinity)) continue;
        var nd = dist[k] + (dx && dy ? SQ2 : 1) * (cost[k] + cost[q]) / 2;
        if (nd < dist[q]) { dist[q] = nd; prev[q] = k; heap.push(nd + h(q), q); }
      }
    }
    if (dist[g] === Infinity) return null;
    var path = []; for (var c = g; c !== -1; c = prev[c]) path.push(c);
    return { cells: path.reverse(), dist: dist };
  }

  /* Weighted length (in page px) of the straight segment a->b, or Infinity if it crosses a blocked cell. */
  function lineCost(grid, a, b) {
    var len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len === 0) return 0;
    var steps = Math.max(1, Math.ceil(len / (grid.cell * 0.5))), total = 0;
    for (var t = 0; t < steps; t++) {
      var f = (t + 0.5) / steps, c = grid.cost[cellOf(grid, a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)];
      if (c === Infinity) return Infinity;
      total += c * len / steps;
    }
    return total;
  }

  /* Shortcut the staircase: jump to the farthest waypoint reachable in a straight line that is no costlier. */
  function smooth(grid, pts, cum) {
    var out = [pts[0]], i = 0;
    while (i < pts.length - 1) {
      var best = i + 1;
      for (var j = pts.length - 1; j > i + 1; j--) {
        var lc = lineCost(grid, pts[i], pts[j]);
        if (lc !== Infinity && lc <= (cum[j] - cum[i]) * grid.cell * 1.02) { best = j; break; }
      }
      out.push(pts[best]); i = best;
    }
    return out;
  }

  /* plan(grid, start, goal, speed_m_per_s): start/goal are [x, y] in page px. */
  function plan(grid, start, goal, speed) {
    var s = cellOf(grid, start[0], start[1]), g = cellOf(grid, goal[0], goal[1]);
    if (grid.cost[s] === Infinity) return { error: 'The start point is inside a crater hazard. Pick open ground.' };
    if (grid.cost[g] === Infinity) return { error: 'The destination is inside a crater hazard. Pick open ground.' };
    var res = astar(grid, s, g);
    if (!res) return { error: 'No safe route found between these points.' };
    var pts = res.cells.map(function (k) { return [((k % grid.nx) + 0.5) * grid.cell, (((k / grid.nx) | 0) + 0.5) * grid.cell]; });
    pts[0] = start.slice(); pts[pts.length - 1] = goal.slice();
    var path = smooth(grid, pts, res.cells.map(function (k) { return res.dist[k]; }));
    var px = 0, weighted = 0;
    for (var i = 1; i < path.length; i++) {
      px += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      weighted += lineCost(grid, path[i - 1], path[i]);
    }
    var straight = Math.hypot(goal[0] - start[0], goal[1] - start[1]) * grid.mpp;
    return { points: path, distance_m: px * grid.mpp, straight_m: straight,
             time_s: speed ? weighted * grid.mpp / speed : null };
  }

  root.RoutePlanner = { buildGrid: buildGrid, plan: plan, metersPerPx: metersPerPx, DEFAULTS: DEFAULTS };
})(window);
