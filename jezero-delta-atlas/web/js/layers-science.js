/* Science layers: SIMULATED / DERIVED radiation, spectral (texture class) and topographic (relative relief) layers,
   plus the Atlas.radiation API. Data comes from model/science_layers.py (web/data/science-layers-data.js).
   None of it is measured data; every UI label says so. See docs/ARCHITECTURE.md. */
(function () {
  'use strict';
  var Atlas = window.Atlas, D = window.JEZERO_SCIENCE;
  if (!Atlas || !D || !D.radiation) { console.warn('layers-science: Atlas or JEZERO_SCIENCE missing'); return; }
  var GROUP = 'Science (simulated)', SIM = 'simulated / derived, not measured data';
  var W = Atlas.W, H = Atlas.H;

  function decode(b64) {
    var bin = atob(b64), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  function hex(c) { return [parseInt(c.substr(1, 2), 16), parseInt(c.substr(3, 2), 16), parseInt(c.substr(5, 2), 16)]; }
  /* piecewise-linear colour ramp, stops = ['#rrggbb', ...] evenly spaced; t in 0..1 */
  function ramp(stops, t) {
    t = Math.min(1, Math.max(0, t)); var n = stops.length - 1, p = t * n, i = Math.min(n - 1, Math.floor(p)), f = p - i;
    var a = hex(stops[i]), b = hex(stops[i + 1]);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  function cssRamp(stops) { return 'linear-gradient(to right,' + stops.join(',') + ')'; }
  /* colour-blind safe: inferno-like sequential for dose, blue-white-orange diverging for relief, Okabe-Ito for classes */
  var DOSE_STOPS = ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'];
  var TOPO_STOPS = ['#2c5f9e', '#74add1', '#f1f1e6', '#e0a458', '#8c510a'];

  /* ---------- grids ---------- */
  function Grid(obj) {
    this.w = obj.w; this.h = obj.h; this.q = decode(obj.grid);
    if (this.q.length !== this.w * this.h) throw new Error('science grid size mismatch');
  }
  /* bilinear sample of the quantised grid at page px, clamped outside the map; returns 0..255 */
  Grid.prototype.sample = function (x, y) {
    var w = this.w, h = this.h;
    var gx = Math.min(w - 1, Math.max(0, x / W * w - 0.5)), gy = Math.min(h - 1, Math.max(0, y / H * h - 0.5));
    var x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = gx - x0, fy = gy - y0, q = this.q;
    var top = q[y0 * w + x0] * (1 - fx) + q[y0 * w + x1] * fx, bot = q[y1 * w + x0] * (1 - fx) + q[y1 * w + x1] * fx;
    return top * (1 - fy) + bot * fy;
  };
  Grid.prototype.nearest = function (x, y) {
    var i = Math.min(this.w - 1, Math.max(0, Math.floor(x / W * this.w))), j = Math.min(this.h - 1, Math.max(0, Math.floor(y / H * this.h)));
    return this.q[j * this.w + i];
  };

  var R = D.radiation, gRad = new Grid(R), gTopo = new Grid(D.topo), gSpec = new Grid(D.spectral);
  var spe = { on: false, mult: (R.spe && R.spe.multiplier) || 2.5 };

  /* ---------- Atlas.radiation ---------- */
  function doseAt(x, y) {
    x = Number(x); y = Number(y); if (!isFinite(x) || !isFinite(y)) return NaN;
    var v = R.min + gRad.sample(x, y) / 255 * (R.max - R.min);
    return spe.on ? v * spe.mult : v;
  }
  Atlas.radiation = {
    at: doseAt,
    unit: R.unit,
    limits: { caution: R.limits.caution, danger: R.limits.danger },
    baseline: R.baseline,
    simulated: true,
    solarEvent: function (on) {
      if (on === undefined) return spe.on;
      on = !!on; if (on === spe.on) return spe.on;
      spe.on = on; drawRadiation(); updateLegend();
      Atlas.bus.emit('radiation:changed', { solarEvent: on, multiplier: on ? spe.mult : 1 });
      return spe.on;
    },
    solarEventOn: function () { return spe.on; },
    multiplier: function () { return spe.on ? spe.mult : 1; },
    range: function () { return { min: R.min * (spe.on ? spe.mult : 1), max: R.max * (spe.on ? spe.mult : 1) }; }
  };

  /* ---------- canvases ---------- */
  function mkCanvas(g) { var c = document.createElement('canvas'); c.width = g.w; c.height = g.h; return c; }
  var cRad = mkCanvas(gRad), cTop = mkCanvas(gTopo), cSpec = mkCanvas(gSpec);

  function paint(canvas, g, colorOf) {
    var ctx = canvas.getContext('2d'), im = ctx.createImageData(g.w, g.h), d = im.data;
    for (var i = 0; i < g.q.length; i++) { var c = colorOf(g.q[i]); d[4 * i] = c[0]; d[4 * i + 1] = c[1]; d[4 * i + 2] = c[2]; d[4 * i + 3] = 255; }
    ctx.putImageData(im, 0, 0);
  }
  function drawRadiation() {
    var m = spe.on ? spe.mult : 1, lo = R.min * m, hi = R.max * m;
    paint(cRad, gRad, function (q) { return ramp(DOSE_STOPS, ((R.min + q / 255 * (R.max - R.min)) * m - lo) / (hi - lo)); });
  }
  drawRadiation();
  paint(cTop, gTopo, function (q) { return ramp(TOPO_STOPS, q / 255); });
  var classes = D.spectral.classes, specRGB = classes.map(function (c) { return hex(c.color); });
  paint(cSpec, gSpec, function (q) { return specRGB[q] || [0, 0, 0]; });

  /* ---------- topographic contours (marching squares on the relief grid, SVG layer) ---------- */
  function contours() {
    var w = gTopo.w, h = gTopo.h, q = gTopo.q, step = D.topo.contour_interval / 100 * 255, parts = [], major = [];
    var s = new Float32Array(w * h), i, j;
    for (j = 0; j < h; j++) for (i = 0; i < w; i++) {      // 3x3 mean to keep contours calm
      var sum = 0, n = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) { var ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < w && jj < h) { sum += q[jj * w + ii]; n++; } }
      s[j * w + i] = sum / n;
    }
    function px(i, j) { return [(i + 0.5) * W / w, (j + 0.5) * H / h]; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    for (var lv = step, k = 1; lv < 255; lv += step, k++) {
      var d = [];
      for (j = 0; j < h - 1; j++) for (i = 0; i < w - 1; i++) {
        var v = [s[j * w + i], s[j * w + i + 1], s[(j + 1) * w + i + 1], s[(j + 1) * w + i]], c = 0;
        if (v[0] >= lv) c |= 1; if (v[1] >= lv) c |= 2; if (v[2] >= lv) c |= 4; if (v[3] >= lv) c |= 8;
        if (c === 0 || c === 15) continue;
        // edge crossings: 0 top, 1 right, 2 bottom, 3 left
        var p0 = px(i, j), p1 = px(i + 1, j), p2 = px(i + 1, j + 1), p3 = px(i, j + 1);
        var e = [
          [lerp(p0[0], p1[0], (lv - v[0]) / (v[1] - v[0])), p0[1]],
          [p1[0], lerp(p1[1], p2[1], (lv - v[1]) / (v[2] - v[1]))],
          [lerp(p3[0], p2[0], (lv - v[3]) / (v[2] - v[3])), p2[1]],
          [p0[0], lerp(p0[1], p3[1], (lv - v[0]) / (v[3] - v[0]))]
        ];
        var segs = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]],
          8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] }[c];
        segs.forEach(function (sg) { var a = e[sg[0]], b = e[sg[1]]; d.push('M' + a[0].toFixed(1) + ' ' + a[1].toFixed(1) + 'L' + b[0].toFixed(1) + ' ' + b[1].toFixed(1)); });
      }
      (k % 5 === 0 ? major : parts).push(d.join(''));
    }
    return { minor: parts.join(''), major: major.join('') };
  }
  var cg = document.createElementNS('http://www.w3.org/2000/svg', 'g'); cg.setAttribute('data-layer', 'topo-contours');
  cg.setAttribute('aria-hidden', 'true'); cg.style.pointerEvents = 'none';
  var ct = contours();
  [['minor', 0.7, 0.55], ['major', 1.4, 0.9]].forEach(function (a) {
    Atlas.el('path', { d: ct[a[0]], fill: 'none', stroke: '#3a1f00', 'stroke-width': a[1], 'stroke-opacity': a[2], 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }, cg);
  });

  document.getElementById('ov').appendChild(cg);

  /* ---------- register ---------- */
  Atlas.registerRasterLayer({ id: 'radiation', label: 'Radiation (simulated)', group: GROUP, color: '#dd513a', canvas: cRad, opacity: 0.6, on: false });
  Atlas.registerRasterLayer({ id: 'spectral', label: 'Spectral (texture classes, simulated)', group: GROUP, color: '#009E73', canvas: cSpec, opacity: 0.6, on: false });
  Atlas.registerRasterLayer({ id: 'topo', label: 'Relative relief (simulated)', group: GROUP, color: '#74add1', canvas: cTop, opacity: 0.6, on: false });
  Atlas.registerLayer({ id: 'topo-contours', label: 'Relief contours (simulated)', group: GROUP, color: '#8c510a', node: cg, on: false });

  /* ---------- legend + readout ---------- */
  var h = Atlas.h;
  var phone = window.matchMedia ? window.matchMedia('(max-width: 640px)') : { matches: false };
  var collapsed = Atlas.store.get('sci.legendCollapsed', null);
  if (collapsed === null) collapsed = !!phone.matches;
  var legendBody = h('div', { class: 'sci-body' });
  var legendBtn = h('button', { type: 'button', class: 'sci-toggle', attrs: { 'aria-expanded': String(!collapsed), 'aria-controls': 'sci-legend-body' }, onclick: function () {
    collapsed = !collapsed; Atlas.store.set('sci.legendCollapsed', collapsed); applyCollapsed();
  } });
  legendBody.id = 'sci-legend-body';
  var legend = h('div', { class: 'sci-legend', attrs: { 'aria-label': 'Science layer legend (simulated data)' } }, [legendBtn, legendBody]);
  document.body.appendChild(legend);
  function applyCollapsed() {
    legendBody.hidden = collapsed;
    legendBtn.setAttribute('aria-expanded', String(!collapsed));
    legendBtn.textContent = (collapsed ? '▸ ' : '▾ ') + 'Science legend (simulated)';
  }
  applyCollapsed();
  var readout = {}, clickOut = {}, clickPt = null, lastHover = null, speCb = null;

  function fmt(v) { return v.toFixed(1); }
  function specClass(x, y) { var c = classes[gSpec.nearest(x, y)]; return c || classes[0]; }
  function topoIndex(x, y) { return gTopo.sample(x, y) / 255 * 100; }
  var IDS = ['radiation', 'topo', 'spectral'];

  function describe(id, x, y) {
    if (id === 'radiation') { var v = doseAt(x, y), L = Atlas.radiation.limits, lvl = v >= L.danger ? 'above danger threshold' : v >= L.caution ? 'above caution threshold' : 'below caution threshold'; return fmt(v) + ' ' + R.unit + ' (simulated), ' + lvl; }
    if (id === 'topo') return 'relative relief ' + Math.round(topoIndex(x, y)) + ' / 100 (simulated, not metres)';
    var c = specClass(x, y); return 'texture class ' + (c.id + 1) + ' of ' + classes.length + ' (simulated, not mineralogy)';
  }
  function showValues() {
    IDS.forEach(function (id) {
      if (!readout[id]) return;
      readout[id].textContent = lastHover ? 'Under pointer: ' + describe(id, lastHover.x, lastHover.y) : 'Hover the map for a value.';
      clickOut[id].textContent = clickPt ? 'At clicked point: ' + describe(id, clickPt.x, clickPt.y) : 'Click the map to pin a value.';
    });
  }
  function card(id, title, bodyNodes) {
    readout[id] = h('div', { class: 'sci-val' });
    clickOut[id] = h('div', { class: 'sci-val sci-click' });
    return h('section', { class: 'sci-card', attrs: { 'data-for': id } },
      [h('h4', { text: title }), h('div', { class: 'sci-sim', text: SIM })].concat(bodyNodes, [readout[id], clickOut[id]]));
  }
  function updateLegend() {
    var hadFocus = speCb && document.activeElement === speCb;
    while (legendBody.firstChild) legendBody.removeChild(legendBody.firstChild);
    readout = {}; clickOut = {}; speCb = null;
    var any = false;
    if (Atlas.layers.isOn('radiation')) {
      any = true;
      var rg = Atlas.radiation.range(), L = Atlas.radiation.limits;
      var bar = h('div', { class: 'sci-bar', attrs: { 'aria-hidden': 'true' } }); bar.style.background = cssRamp(DOSE_STOPS);
      [['caution', L.caution], ['danger', L.danger]].forEach(function (m) {
        if (m[1] > rg.min && m[1] < rg.max) { var t = h('i', { class: 'sci-tick', attrs: { title: m[0] + ' ' + m[1] } }); t.style.left = ((m[1] - rg.min) / (rg.max - rg.min) * 100) + '%'; bar.appendChild(t); }
      });
      speCb = h('input', { type: 'checkbox', checked: spe.on, onchange: function () { Atlas.radiation.solarEvent(speCb.checked); } });
      legendBody.appendChild(card('radiation', 'Radiation dose rate' + (spe.on ? ' (solar event ×' + spe.mult + ')' : ''), [
        bar, h('div', { class: 'sci-scale' }, [h('span', { text: fmt(rg.min) }), h('span', { text: R.unit }), h('span', { text: fmt(rg.max) })]),
        h('label', { class: 'sci-spe' }, [speCb, h('span', { text: 'Simulate solar particle event (×' + spe.mult + ', scenario)' })]),
        h('div', { class: 'sci-note', text: 'Caution ' + L.caution + ' / danger ' + L.danger + ' ' + R.unit + ' are scenario thresholds for this simulation, not regulatory limits. Baseline ' + R.baseline + ' ' + R.unit + ' (MSL/RAD, Gale).' })]));
      if (hadFocus) speCb.focus();
    }
    if (Atlas.layers.isOn('topo')) {
      any = true;
      var tb = h('div', { class: 'sci-bar', attrs: { 'aria-hidden': 'true' } }); tb.style.background = cssRamp(TOPO_STOPS);
      legendBody.appendChild(card('topo', 'Relative relief', [tb,
        h('div', { class: 'sci-scale' }, [h('span', { text: 'low 0' }), h('span', { text: 'index' }), h('span', { text: '100 high' })]),
        h('div', { class: 'sci-note', text: 'From image shading + crater bowls. Not metres, not a DEM. Contour every ' + D.topo.contour_interval + ' index units.' })]));
    }
    if (Atlas.layers.isOn('spectral')) {
      any = true;
      var sw = classes.map(function (c) {
        var s = h('i', { class: 'sci-sw' }); s.style.background = c.color;
        return h('li', {}, [s, h('span', { text: 'Class ' + (c.id + 1) + (c.id === 0 ? ' (darkest)' : c.id === classes.length - 1 ? ' (brightest)' : '') + ', ' + Math.round(c.share * 100) + '%' })]);
      });
      legendBody.appendChild(card('spectral', 'Spectral (texture classes)', [h('ul', { class: 'sci-list' }, sw),
        h('div', { class: 'sci-note', text: 'Clusters of image brightness and texture. NOT mineralogy: no spectral data exist in this atlas.' })]));
    }
    if (!any && Atlas.layers.isOn('topo-contours')) {
      any = true;
      legendBody.appendChild(h('div', { class: 'sci-card' }, [h('h4', { text: 'Relief contours' }), h('div', { class: 'sci-sim', text: SIM })]));
    }
    legend.hidden = !any;
    showValues();
  }
  updateLegend();
  Atlas.bus.on('layer:changed', updateLegend);

  var stage = document.getElementById('stage');
  function pageXY(e) {
    var r = stage.getBoundingClientRect(); if (!r.width) return null;
    var x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
    return (x < 0 || y < 0 || x > W || y > H) ? null : { x: x, y: y };
  }
  var raf = 0, last = null;
  var mapEl = document.getElementById('map');
  if (mapEl) mapEl.addEventListener('pointermove', function (e) {
    last = e; if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = 0; var p = pageXY(last); if (!p) return;
      lastHover = p;
      IDS.forEach(function (id) { if (readout[id]) readout[id].textContent = 'Under pointer: ' + describe(id, p.x, p.y); });
    });
  });
  /* click only pins a value in the legend; it never calls Atlas.setInfo and ignores exclusive map picks */
  Atlas.onMapClick(function (ev) {
    if (Atlas.picking && Atlas.picking()) return;
    clickPt = { x: ev.x, y: ev.y };
    IDS.forEach(function (id) { if (clickOut[id]) clickOut[id].textContent = 'At clicked point: ' + describe(id, ev.x, ev.y); });
  });
})();
