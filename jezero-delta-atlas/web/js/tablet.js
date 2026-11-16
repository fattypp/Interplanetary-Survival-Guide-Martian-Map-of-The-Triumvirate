/* Astronaut tablet: global Mars map, BASE (base camp) / YOU pins, five numbered stops with the route, mission task pop-up, Add Location, distance, SOS.
   Needs data/mars-sites.js and data/mission-data.js. Uses JdaLink, JdaLinkUI and JdaWorld when present (all guarded). */
(function () {
  'use strict';
  var SITES = window.MARS_SITES, MD = window.JEZERO_MISSION || { objectives: [], stops: [], tasks: [], base: null };
  if (!SITES) { if (window.console) console.error('tablet.js needs data/mars-sites.js'); return; }
  var RK = SITES.radiusKm, D2R = Math.PI / 180, MAX_PPD = 9000, JZ_PPD_MIN = 400;

  function $(id) { return document.getElementById(id); }
  function el(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
      else if (k === 'attrs') Object.keys(v).forEach(function (a) { e.setAttribute(a, v[a]); });
      else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v); else e[k] = v;
    });
    (kids || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function lsGet(k, f) { try { var v = localStorage.getItem('jda.' + k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } }
  function lsSet(k, v) { try { localStorage.setItem('jda.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  function link() { return window.JdaLink || null; }
  function normLon(l) { l = ((l + 180) % 360 + 360) % 360 - 180; l = Math.round(l * 1e6) / 1e6; return l === 0 ? 0 : l; }   // rounded so 77.4 stays 77.4 (no 77.39999999999998), never -0

  /* ---------- identity and world ---------- */
  var lastWorld = null;
  function me() { try { return (window.JdaWorld && window.JdaWorld.me && window.JdaWorld.me()) || null; } catch (e) { return null; } }
  function isJoined() { var l = link(), r = l && l.room; return !!(r && r.role === 'tablet' && r.id); }   // legacy / implicit rooms do not count
  function crewId() { var l = link(), r = l && l.room, m = me(); return (isJoined() && r.id) || (m && m.id) || 'crew'; }
  function crewName() { var l = link(), r = l && l.room, m = me(); return (m && m.name) || (isJoined() && r.name) || crewId(); }
  function baseLL() {
    if (MD.base && isFinite(MD.base.lat) && isFinite(MD.base.lon)) return { lat: +MD.base.lat, lon: +MD.base.lon };
    var w = lastWorld;
    if (!w && link() && link().getState) { try { var s = link().getState('world'); w = s && s.value; } catch (e) { /* ignore */ } }
    if (w && w.base && isFinite(w.base.lat) && isFinite(w.base.lon)) return { lat: +w.base.lat, lon: +w.base.lon };
    return MD.base && isFinite(MD.base.lat) ? { lat: +MD.base.lat, lon: +MD.base.lon } : { lat: SITES.jezero.lat, lon: SITES.jezero.lon };
  }
  function youLL() {
    var m = me();
    if (m && isFinite(m.lat) && isFinite(m.lon)) return { lat: +m.lat, lon: +m.lon, z: isFinite(m.zM) ? +m.zM : null };
    var b = baseLL(); return { lat: b.lat, lon: b.lon, z: null };
  }

  /* ---------- geometry ---------- */
  function haversineKm(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R, dp = p2 - p1, dl = (b.lon - a.lon) * D2R;
    var s = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * RK * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  function fmtDeg(v, pos, neg) { var r = Math.abs(v).toFixed(4); return r + ' ' + (v < 0 && Number(r) !== 0 ? neg : pos); }   // a value that rounds to zero is never shown as S or W
  function fmtLat(v) { return fmtDeg(v, 'N', 'S'); }
  function fmtLon(v) { return fmtDeg(normLon(v), 'E', 'W'); }

  /* ---------- map view ---------- */
  var map = $('map'), cv = $('cv'), pinsEl = $('pins'), screen = $('screen'), ctx = cv.getContext('2d');
  var img = new Image(), imgOk = false;
  var SC = 1, W = 800, H = 400, dpr = 1, minPpd = 1;
  var view = { lon: 0, lat: 0, ppd: 1 };
  var anim = null, drawQueued = false;

  img.onload = function () { imgOk = true; queueDraw(); };
  img.src = SITES.image.src;
  var cimg = new Image(), cimgOk = false, CTX = SITES.ctx;   // Jezero CTX mosaic, shown instead of the global image when zoomed in
  if (CTX) { cimg.onload = function () { cimgOk = true; queueDraw(); }; cimg.src = CTX.src; }

  function clampView() {
    view.ppd = clamp(view.ppd, minPpd, MAX_PPD);
    view.lon = clamp(view.lon, -180, 180); view.lat = clamp(view.lat, -90, 90);
  }
  function project(lon, lat) { return { x: W / 2 + (lon - view.lon) * view.ppd, y: H / 2 - (lat - view.lat) * view.ppd }; }
  function unproject(x, y) { return { lon: view.lon + (x - W / 2) / view.ppd, lat: view.lat - (y - H / 2) / view.ppd }; }
  function homeView() { return { lon: (W * 0.55 < H) ? 77 : 0, lat: 0, ppd: minPpd }; }
  function resize() {
    var r = map.getBoundingClientRect(); if (!r.width || !r.height) return;
    SC = r.width / map.offsetWidth || 1;   // CSS pixels per layout pixel (1 unless the page is scaled by an embedding frame)
    var first = !W || W === 800 && H === 400 && !resize.done;
    W = map.offsetWidth; H = map.offsetHeight; dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    minPpd = Math.max(W / 360, H / 180);
    if (first) { var hv = homeView(); view.lon = hv.lon; view.lat = hv.lat; view.ppd = hv.ppd; }
    resize.done = true; clampView(); queueDraw();
  }
  function queueDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(function () { drawQueued = false; draw(); }); } }

  var STEPS = [30, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01, 0.005];
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);
    var hw = W / 2 / view.ppd, hh = H / 2 / view.ppd;
    var l0 = Math.max(-180, view.lon - hw), l1 = Math.min(180, view.lon + hw);
    var t0 = Math.min(90, view.lat + hh), b0 = Math.max(-90, view.lat - hh);
    var gA = clamp(1 - (view.ppd - 60) / 300, 0.1, 1), cA = clamp((view.ppd - 60) / 240, 0, 1);
    if (imgOk && l1 > l0 && t0 > b0) {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.globalAlpha = gA;
      ctx.drawImage(img, (l0 + 180) / 360 * iw, (90 - t0) / 180 * ih, (l1 - l0) / 360 * iw, (t0 - b0) / 180 * ih,
        W / 2 + (l0 - view.lon) * view.ppd, H / 2 - (t0 - view.lat) * view.ppd, (l1 - l0) * view.ppd, (t0 - b0) * view.ppd);
    }
    ctx.globalAlpha = 1;
    if (CTX && cimgOk && cA > 0) {
      var cx0 = W / 2 + (CTX.lon0 - view.lon) * view.ppd, cy0 = H / 2 - (CTX.lat1 - view.lat) * view.ppd, cw = (CTX.lon1 - CTX.lon0) * view.ppd, ch = (CTX.lat1 - CTX.lat0) * view.ppd;
      if (cx0 < W && cy0 < H && cx0 + cw > 0 && cy0 + ch > 0) { ctx.globalAlpha = cA; ctx.drawImage(cimg, cx0, cy0, cw, ch); ctx.globalAlpha = 1; }
    }
    drawRoute();
    // graticule
    var raw = 120 / view.ppd, step = STEPS[0], i;
    for (i = 0; i < STEPS.length; i++) if (STEPS[i] >= raw) step = STEPS[i];
    for (i = STEPS.length - 1; i >= 0; i--) if (STEPS[i] >= raw) { step = STEPS[i]; break; }
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '12px system-ui,sans-serif';
    var dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3, v, p;
    ctx.beginPath();
    for (v = Math.ceil(l0 / step) * step; v <= l1 + 1e-9; v += step) { p = W / 2 + (v - view.lon) * view.ppd; ctx.moveTo(Math.round(p) + .5, 0); ctx.lineTo(Math.round(p) + .5, H); }
    for (v = Math.ceil(b0 / step) * step; v <= t0 + 1e-9; v += step) { p = H / 2 - (v - view.lat) * view.ppd; ctx.moveTo(0, Math.round(p) + .5); ctx.lineTo(W, Math.round(p) + .5); }
    ctx.stroke();
    ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    ctx.textAlign = 'left';
    for (v = Math.ceil(l0 / step) * step; v <= l1 + 1e-9; v += step) { p = W / 2 + (v - view.lon) * view.ppd; ctx.fillText(Math.abs(v).toFixed(dec) + (v < 0 ? 'W' : 'E'), p + 4, 100); }
    ctx.textAlign = 'right';
    for (v = Math.ceil(b0 / step) * step; v <= t0 + 1e-9; v += step) { p = H / 2 - (v - view.lat) * view.ppd; ctx.fillText(Math.abs(v).toFixed(dec) + (v < 0 ? 'S' : 'N'), W - 8, p - 4); }
    ctx.shadowBlur = 0;
    placePins();
    updateNote();
  }

  /* stop points of the mission (base camp, stops 1..5, base camp), used to fit the view; the drawn route comes from JdaRoute below */
  function routePts() {
    var pts = [], b = MD.base;
    if (!b || !isFinite(b.lat) || !(MD.stops || []).length) return pts;
    pts.push(b); (MD.stops || []).forEach(function (s) { if (isFinite(s.lat) && isFinite(s.lon)) pts.push(s); }); pts.push(b);
    return pts;
  }
  /* ---------- safe route (JdaRoute) ---------- */
  var RISK_COL = { low: '#6fe39b', medium: '#ffd23f', high: '#ff5a4d' };
  var runKey = '', plan = null, planBase = null, planErr = '', optimizeOn = false, path = null, routeProg = null, routeLastDone = 0, planKey = '', lastEvents = null;
  var zones = null;
  function JR() { return window.JdaRoute && typeof window.JdaRoute.plan === 'function' ? window.JdaRoute : null; }
  function riskClass(r) { r = +r; return r >= 0.67 ? 'high' : r >= 0.34 ? 'medium' : 'low'; }
  function riskWord(c) { return c === 'high' ? 'high risk' : c === 'medium' ? 'medium risk' : 'low risk'; }
  function flatM(a, b) { var dy = (b.lat - a.lat) * 59160, dx = (b.lon - a.lon) * 59160 * Math.cos((a.lat + b.lat) / 2 * D2R); return Math.hypot(dx, dy); }
  function hazards() {
    var w = null; try { w = window.JdaWorld && window.JdaWorld.world ? window.JdaWorld.world() : null; } catch (e) { w = null; }
    w = w || lastWorld; var ev = (w && w.events) || {};
    return { solar: !!ev.solar, dust: !!ev.dust };
  }
  /* crater danger zones: the craters the planner treats as blocked (confidence >= minConf), out to rim radius x margin */
  function buildZones(dust) {
    zones = [];
    var C = window.JEZERO_CRATERS, RP = window.RoutePlanner, d = (RP && RP.DEFAULTS) || { margin: 1.25, minConf: 0.6 };
    var PP = JR() && window.JdaRoute.params && typeof window.JdaRoute.params === 'object' ? window.JdaRoute.params : null;
    if (PP && isFinite(PP.margin)) d = { margin: dust && isFinite(PP.dustMargin) ? PP.dustMargin : PP.margin, minConf: isFinite(PP.minConf) ? PP.minConf : d.minConf };
    if (!C || !C.craters || !C.meta) return;
    var b = C.meta.bbox, pw = C.meta.page[0], ph = C.meta.page[1], lonPx = (b.lon1 - b.lon0) / pw, latPx = (b.lat1 - b.lat0) / ph;
    var mpp = RP && RP.metersPerPx ? RP.metersPerPx(C.meta) : 5.55;
    C.craters.forEach(function (c) {
      if (!(c.confidence >= d.minConf) || !c.page) return;
      var R = c.page[2] * d.margin;
      zones.push({ lat: b.lat1 - c.page[1] * latPx, lon: b.lon0 + c.page[0] * lonPx, rLon: R * lonPx, rLat: R * latPx, rM: R * mpp, id: c.id });
    });
  }
  function legBlocked(l, i) {
    var bl = plan && plan.blocked || [];
    return l.blocked === true || bl.some(function (b) { return b === i || b === l.id || (typeof b === 'string' && l.fromId && l.toId && b.indexOf(String(l.fromId)) >= 0 && b.indexOf(String(l.toId)) >= 0); });
  }
  function validPlan(p) { return p && Array.isArray(p.legs) && p.legs.length && p.legs.every(function (l) { return l && Array.isArray(l.points) && l.points.length > 1; }); }
  function stopLabel(id) {
    if (id === 'base') return 'base camp';
    var s = stopList.filter(function (x) { return x.id === id; })[0]; return s ? 'stop ' + s.no : String(id);
  }
  function buildPath() {
    path = null; if (!validPlan(plan)) return;
    var s = 0; path = { legs: [], total: 0 };
    plan.legs.forEach(function (l) {
      var pts = l.points.filter(function (q) { return isFinite(q.lat) && isFinite(q.lon); }), cum = [0];
      for (var i = 1; i < pts.length; i++) cum.push(cum[i - 1] + flatM(pts[i - 1], pts[i]));
      path.legs.push({ pts: pts, cum: cum, s0: s, s1: s + cum[cum.length - 1] }); s += cum[cum.length - 1];
    });
    path.total = s;
  }
  function runOrder() {   // the order the running mission follows (authoritative), or null
    var m = me(), r = m && m.route;
    return r && Array.isArray(r.order) && r.order.length ? r.order.filter(function (x) { return typeof x === 'string'; }) : null;
  }
  function computePlan() {
    var R = JR(); plan = null; planBase = null; planErr = '';
    if (!R) { planErr = 'The route planner is not available.'; path = null; routeProg = null; renderRoute(); queueDraw(); return; }
    var o = objChoice() || 'both', h = hazards();
    try {
      var ro = runOrder();
      planBase = R.plan({ objective: o, optimizeOrder: false, hazards: h });
      plan = ro ? R.plan({ objective: o, order: ro, optimizeOrder: false, hazards: h }) : optimizeOn ? R.plan({ objective: o, optimizeOrder: true, hazards: h }) : planBase;
      runKey = ro ? ro.join(',') : '';
      if (!validPlan(plan)) { plan = null; planErr = 'No route could be calculated.'; }
    } catch (e) { plan = null; planErr = 'The route could not be calculated.'; if (window.console) console.warn('route plan failed', e); }
    buildZones(h.dust); radCells = null; lastEvents = h; routeLastDone = 0; routeProg = null; buildPath(); updateRouteProgress(true); renderRoute(); queueDraw();
  }
  /* where the crew is along the route: nearest point at or after the previous position (the route starts and ends at base camp) */
  function updateRouteProgress(reset) {
    if (!path) { routeProg = null; return; }
    var y = youLL(), m = me(), done = m && m.progress && isFinite(m.progress.done) ? +m.progress.done : 0;
    if (reset || done < routeLastDone) routeProg = null; routeLastDone = done;
    var from = routeProg ? Math.max(0, routeProg.s - 30) : 0, best = null, la = Math.cos(y.lat * D2R);
    path.legs.forEach(function (L, li) {
      for (var i = 1; i < L.pts.length; i++) {
        var a = L.pts[i - 1], b = L.pts[i];
        if (L.s0 + L.cum[i] < from) continue;
        var ax = (a.lon - y.lon) * la * 59160, ay = (a.lat - y.lat) * 59160, bx = (b.lon - y.lon) * la * 59160, by = (b.lat - y.lat) * 59160;
        var dx = bx - ax, dy = by - ay, LL = dx * dx + dy * dy, t = LL ? clamp(-(ax * dx + ay * dy) / LL, 0, 1) : 0;
        var d = Math.hypot(ax + dx * t, ay + dy * t), s = L.s0 + L.cum[i - 1] + (L.cum[i] - L.cum[i - 1]) * t;
        if (s < from) s = from;
        if (!best || d < best.off - 20 || (d <= best.off + 20 && s < best.s)) best = { s: s, off: d, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
      }
    });
    if (!best) { best = routeProg || { s: 0, off: 0, lat: y.lat, lon: y.lon }; }
    var idx = path.legs.length - 1;
    for (var k = 0; k < path.legs.length; k++) if (path.legs[k].s1 - best.s > 10) { idx = k; break; }
    best.leg = idx; best.atEnd = best.s >= path.total - 10;
    var changed = !routeProg || routeProg.leg !== idx || Math.abs(routeProg.s - best.s) > 5 || routeProg.off !== best.off;
    routeProg = best; if (changed) { refreshRouteLive(); }
  }

  function strokePoly(pts, w, col, alpha, dash) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.stroke();
  }
  function arrowAt(x, y, ang, sz) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(sz, 0); ctx.lineTo(-sz * .7, -sz * .75); ctx.lineTo(-sz * .35, 0); ctx.lineTo(-sz * .7, sz * .75); ctx.closePath(); ctx.stroke(); ctx.fill(); ctx.restore();
  }
  function labelAt(x, y, text, col) {
    ctx.save(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.font = '700 11px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.fillStyle = col || '#fff';
    ctx.strokeText(text, x, y); ctx.fillText(text, x, y); ctx.restore();
  }
  var radCells = null;
  /* areas above the radiation caution limit in normal conditions (JdaRoute.radiationAt on the same grid the planner uses) */
  function buildRadCells() {
    radCells = []; var R = JR(), C = window.JEZERO_CRATERS;
    if (!R || !R.radiationAt || !C || !C.meta || !plan || !plan.limits || !plan.limits.radiationData) return;
    var b = C.meta.bbox, pw = C.meta.page[0], ph = C.meta.page[1], st = 16, lonPx = (b.lon1 - b.lon0) / pw, latPx = (b.lat1 - b.lat0) / ph, cau = plan.limits.caution, dan = plan.limits.danger;
    for (var y = 0; y < ph; y += st) for (var x = 0; x < pw; x += st) {
      var v = R.radiationAt(x + st / 2, y + st / 2, { solar: false });
      if (v >= cau) radCells.push({ lon: b.lon0 + x * lonPx, lat: b.lat1 - y * latPx, w: st * lonPx, h: st * latPx, danger: v >= dan });
    }
  }
  function drawZones() {
    if (!zones) buildZones();
    if (!radCells) buildRadCells();
    ctx.save();
    radCells.forEach(function (c) {
      var p = project(c.lon, c.lat), w = c.w * view.ppd + .6, h = c.h * view.ppd + .6;
      if (p.x + w < 0 || p.x > W || p.y + h < 0 || p.y > H) return;
      ctx.fillStyle = c.danger ? 'rgba(190,60,255,.28)' : 'rgba(255,190,40,.22)'; ctx.fillRect(p.x, p.y, w, h);
    });
    ctx.restore();
    ctx.save(); ctx.setLineDash([5, 4]);
    zones.forEach(function (z) {
      var p = project(z.lon, z.lat), rx = z.rLon * view.ppd, ry = z.rLat * view.ppd;
      if (p.x + rx < 0 || p.x - rx > W || p.y + ry < 0 || p.y - ry > H) return;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rx, ry, 0, 0, 6.2832); ctx.fillStyle = 'rgba(255,70,60,.17)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,140,120,.9)'; ctx.stroke();
    });
    ctx.restore();
  }
  function drawRoute() {
    if (view.ppd < 150) return;
    if (!plan || !path) {
      if (JR()) { drawZones(); return; }
      // no planner on this page: plain straight line through the stops
      var pts = routePts(); if (pts.length < 3) return;
      ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([9, 7]);
      [['#000', 5], ['#ffd23f', 2.5]].forEach(function (st) {
        ctx.strokeStyle = st[0]; ctx.lineWidth = st[1]; ctx.beginPath();
        pts.forEach(function (q, i) { var p = project(q.lon, q.lat); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
        ctx.stroke();
      });
      ctx.restore(); return;
    }
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    drawZones();
    // straight-line comparison, thin and faint
    plan.legs.forEach(function (l) {
      var a = l.points[0], b = l.points[l.points.length - 1], pa = project(a.lon, a.lat), pb = project(b.lon, b.lat);
      strokePoly([pa, pb], 1.3, '#ffffff', .5, [3, 6]);
    });
    var cur = routeProg ? routeProg.leg : 0, sNow = routeProg ? routeProg.s : 0;
    path.legs.forEach(function (L, li) {
      var meta = plan.legs[li], blocked = legBlocked(meta, li), cls = riskClass(meta.risk), col = blocked ? '#ff3b30' : RISK_COL[cls];
      var sp = L.pts.map(function (q) { return project(q.lon, q.lat); }), hi = li === cur && !(routeProg && routeProg.atEnd);
      var wCol = hi ? 5 : 3.5, dash = blocked ? [10, 8] : null;
      if (hi) strokePoly(sp, wCol + 6, '#ffffff', .35);
      strokePoly(sp, wCol + 3, '#000', li < cur ? .35 : .85, dash);
      // part already driven is dimmed
      var split = 0, i; for (i = 1; i < L.pts.length; i++) if (L.s0 + L.cum[i] <= sNow) split = i;
      if (li < cur) strokePoly(sp, wCol, col, .3, dash);
      else if (li > cur) strokePoly(sp, wCol, col, 1, dash);
      else {
        if (split > 0) strokePoly(sp.slice(0, split + 1), wCol, col, .3, dash);
        strokePoly(sp.slice(split), wCol, col, 1, dash);
      }
      // arrows every ~140 px of screen length, and one at least
      var acc = 0, next = 60, total = 0, k;
      for (k = 1; k < sp.length; k++) total += Math.hypot(sp[k].x - sp[k - 1].x, sp[k].y - sp[k - 1].y);
      if (total > 40) for (k = 1; k < sp.length; k++) {
        var sg = Math.hypot(sp[k].x - sp[k - 1].x, sp[k].y - sp[k - 1].y);
        while (acc + sg >= next && next < total) {
          var f = (next - acc) / (sg || 1), x = sp[k - 1].x + (sp[k].x - sp[k - 1].x) * f, y = sp[k - 1].y + (sp[k].y - sp[k - 1].y) * f;
          if (x > -20 && x < W + 20 && y > -20 && y < H + 20) { ctx.globalAlpha = li < cur ? .4 : 1; arrowAt(x, y, Math.atan2(sp[k].y - sp[k - 1].y, sp[k].x - sp[k - 1].x), hi ? 7 : 6); }
          next += 140;
        }
        acc += sg;
      }
      if (total > 110) {   // leg label with its risk in words (colour is never the only cue)
        var half = total / 2; acc = 0;
        for (k = 1; k < sp.length; k++) {
          var sg2 = Math.hypot(sp[k].x - sp[k - 1].x, sp[k].y - sp[k - 1].y);
          if (acc + sg2 >= half) { var f2 = (half - acc) / (sg2 || 1); labelAt(sp[k - 1].x + (sp[k].x - sp[k - 1].x) * f2 + 18, sp[k - 1].y + (sp[k].y - sp[k - 1].y) * f2 - 12, (blocked ? 'LEG ' + (li + 1) + ' BLOCKED' : 'Leg ' + (li + 1) + ' ' + cls), col); break; }
          acc += sg2;
        }
      }
    });
    if (routeProg) {   // you on the route
      var rp = project(routeProg.lon, routeProg.lat), yl = youLL(), yp = project(yl.lon, yl.lat);
      if (routeProg.off > 40) strokePoly([rp, yp], 1.5, '#5ee0ff', .9, [2, 4]);
      ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(rp.x, rp.y, 7, 0, 6.2832); ctx.lineWidth = 3; ctx.strokeStyle = '#5ee0ff'; ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------- route panel ---------- */
  var routePanel = $('route'), rEls = {};
  function fmtM(m) { return m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m'; }
  function fmtDur(s) { if (!isFinite(s)) return 'n/a'; var m = Math.round(s / 60), h = Math.floor(m / 60); return h ? h + ' h ' + (m % 60 < 10 ? '0' : '') + (m % 60) + ' min' : m + ' min'; }
  function orderText(p) { return (p && p.order || []).map(function (id) { return String(id).replace(/^stop-/, ''); }).join(' ').replace('base', 'B'); }
  function legendSvg(col, dash, w) {
    var NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), l = document.createElementNS(NS, 'line');
    s.setAttribute('viewBox', '0 0 46 12'); s.setAttribute('aria-hidden', 'true');
    l.setAttribute('x1', '2'); l.setAttribute('x2', '44'); l.setAttribute('y1', '6'); l.setAttribute('y2', '6'); l.setAttribute('stroke', col); l.setAttribute('stroke-width', String(w || 4)); if (dash) l.setAttribute('stroke-dasharray', dash);
    s.appendChild(l); return s;
  }
  function renderRoute() {
    var b = $('route-body'); b.textContent = ''; rEls = {};
    var h = hazards();
    if (!plan || !path) {
      b.appendChild(el('p', { class: 'rwarn', attrs: { role: 'alert' }, text: planErr || 'No route available.' }));
      b.appendChild(el('div', { class: 'opt' }, [el('button', { type: 'button', text: 'Recalculate', onclick: function () { computePlan(); toast(plan ? 'Route recalculated.' : 'Route not available.', plan ? 'info' : 'warn'); } })]));
      $('route-cnt').textContent = ''; return;
    }
    var total = plan.totalM, straight = 0; plan.legs.forEach(function (l) { straight += +l.straightM || 0; });
    var maxRisk = plan.legs.reduce(function (m, l) { return Math.max(m, +l.risk || 0); }, 0), cls = riskClass(maxRisk), blockedAny = (plan.blocked || []).length > 0;
    $('route-cnt').textContent = fmtM(total);
    var rs = JEZERO_SPEEDS_safe();
    b.appendChild(el('p', { class: 'sum' }, [document.createTextNode('Route ' + fmtM(total)), el('span', { class: 'dim', text: straight ? ' (straight line ' + fmtM(straight) + (total > straight ? ', +' + Math.round((total / straight - 1) * 100) + '%' : '') + ')' : '' })]));
    b.appendChild(el('p', {}, [document.createTextNode('Risk: '), el('span', { class: 'rbadge ' + cls, text: cls })]));
    b.appendChild(el('p', { text: 'Estimated time: ' + fmtDur(isFinite(plan.etaRoverS) ? plan.etaRoverS : total / rs.rover) + ' by rover, ' + fmtDur(isFinite(plan.etaFootS) ? plan.etaFootS : total / rs.foot) + ' on foot.' }));
    if (plan.avoided && isFinite(plan.avoided.craters)) b.appendChild(el('p', { class: 'dim', text: 'Avoids ' + plan.avoided.craters + ' crater' + (plan.avoided.craters === 1 ? '' : 's') + ' on the way.' }));
    rEls.prog = el('p', { class: 'prog' }); b.appendChild(rEls.prog);
    if (blockedAny) b.appendChild(el('p', { class: 'rwarn', attrs: { role: 'alert' }, text: 'Warning: no safe path was found for ' + (plan.blocked.length === 1 ? 'one leg' : plan.blocked.length + ' legs') + ' (marked BLOCKED on the map). The line drawn there is not safe. Choose another stop order or wait for conditions to change.' }));
    if (h.solar || h.dust) b.appendChild(el('p', { class: 'rnote', text: (h.solar && h.dust ? 'A solar particle event and a dust storm are active.' : h.solar ? 'A solar particle event is active.' : 'A dust storm is active.') + ' The route was recalculated for these conditions.' }));
    if (runKey) b.appendChild(el('p', { class: 'rnote', text: 'The running mission sets the stop order: ' + orderText(plan) + '.' }));
    var opt = el('div', { class: 'opt' });
    rEls.optBtn = el('button', { type: 'button', text: 'Optimize stop order', attrs: { 'aria-pressed': optimizeOn ? 'true' : 'false' }, onclick: function () {
      optimizeOn = !optimizeOn; lsSet('tablet.optimize.' + crewId(), optimizeOn); publishRouteOpts(); computePlan();
      toast(runKey ? 'A mission is running: the next run uses this setting.' : optimizeOn ? 'Stop order optimized.' : 'Guide stop order restored.', 'info');
      var nb = $('route-body').querySelector('.optbtn'); if (nb) nb.focus({ preventScroll: true });
    } });
    rEls.optBtn.classList.add('optbtn');
    opt.appendChild(rEls.optBtn);
    opt.appendChild(el('button', { type: 'button', text: 'Recalculate', onclick: function () { computePlan(); toast('Route recalculated.', 'info'); var nb = $('route-body').querySelector('.opt button:nth-child(2)'); if (nb) nb.focus({ preventScroll: true }); } }));
    b.appendChild(opt);
    if (planBase && validPlan(planBase)) {
      var same = orderText(planBase) === orderText(plan);
      b.appendChild(el('p', { class: 'dim', text: optimizeOn && !runKey
        ? (same ? 'Guide order ' + orderText(planBase) + ' is already the best order (' + fmtM(planBase.totalM) + ').' : 'Guide order ' + orderText(planBase) + ': ' + fmtM(planBase.totalM) + '. Optimized order ' + orderText(plan) + ': ' + fmtM(plan.totalM) + ' (' + (plan.totalM <= planBase.totalM ? '' : '+') + Math.round((plan.totalM / planBase.totalM - 1) * 100) + '%)' + (plan.cost && isFinite(plan.cost.guideM) && isFinite(plan.cost.chosenM) ? '; hazard-weighted cost ' + fmtM(plan.cost.guideM) + ' to ' + fmtM(plan.cost.chosenM) : '') + '.')
        : 'Stop order ' + orderText(plan) + '.' }));
    }
    b.appendChild(el('h3', { text: 'Legs' }));
    var ul = el('ul'); rEls.legs = [];
    plan.legs.forEach(function (l, i) {
      var c = riskClass(l.risk), blocked = legBlocked(l, i), det = isFinite(l.detourM) ? +l.detourM : (+l.lengthM || 0) - (+l.straightM || 0), n = isFinite(l.craterHits) ? l.craterHits : 0;
      var li = el('li', { class: blocked ? 'blocked' : '' }), t = 'Leg ' + (i + 1) + ': ' + stopLabel(l.fromId) + ' to ' + stopLabel(l.toId) + ', ' + fmtM(l.lengthM) + ', ' + (blocked ? 'BLOCKED' : riskWord(c));
      li.appendChild(el('b', { text: t }));
      if (det >= 20) li.appendChild(el('div', { text: 'Leg ' + (i + 1) + ' detours ' + Math.round(det) + ' m' + (n ? ' around ' + n + ' crater' + (n === 1 ? '' : 's') : '') + '.' }));
      else li.appendChild(el('div', { class: 'dim', text: 'Almost straight.' }));
      (l.notes || []).filter(function (nt) { return !/^Detours/.test(String(nt)); }).forEach(function (nt) { li.appendChild(el('div', { class: 'dim', text: String(nt) })); });
      ul.appendChild(li); rEls.legs.push(li);
    });
    b.appendChild(ul);
    if ((plan.hazardNotes || []).length) {
      b.appendChild(el('h3', { text: 'Hazard notes' }));
      var hn = el('ul'); plan.hazardNotes.forEach(function (n) { hn.appendChild(el('li', { text: String(n) })); }); b.appendChild(hn);
    }
    b.appendChild(el('h3', { text: 'Key' }));
    [['low', null, 'Low risk (solid, green)'], ['medium', null, 'Medium risk (solid, amber, labelled)'], ['high', null, 'High risk (solid, red, labelled)']].forEach(function (k) {
      b.appendChild(el('div', { class: 'rleg' }, [legendSvg(RISK_COL[k[0]], null, 4), el('span', { text: k[2] })]));
    });
    b.appendChild(el('div', { class: 'rleg' }, [legendSvg('#ff3b30', '8 6', 4), el('span', { text: 'Blocked leg (dashed red)' })]));
    b.appendChild(el('div', { class: 'rleg' }, [legendSvg('#ffffff', '3 6', 1.5), el('span', { text: 'Straight line, for comparison' })]));
    b.appendChild(el('div', { class: 'rleg' }, [legendSvg('rgba(255,140,120,.9)', '5 4', 4), el('span', { text: 'Crater to avoid, with safety margin' })]));
    if (!radCells) buildRadCells();
    if (radCells && radCells.length) b.appendChild(el('div', { class: 'rleg' }, [legendSvg('rgba(255,190,40,.55)', null, 10), el('span', { text: 'Radiation above the caution limit (' + plan.limits.caution + ' uSv/h)' })]));
    b.appendChild(el('p', { class: 'dim', text: 'Arrows show the driving direction. The part already driven is dimmed and the next leg is thicker.' }));
    refreshRouteLive();
  }
  function JEZERO_SPEEDS_safe() { var S = window.JEZERO_SPEEDS || {}; return { rover: (S.rover && S.rover.mps) || 2.8, foot: (S.foot && S.foot.mps) || 1.4 }; }
  function refreshRouteLive() {
    if (!rEls.prog || !path || !routeProg) return;
    var p = routeProg, k = plan.totalM && path.total ? plan.totalM / path.total : 1, left = Math.max(0, path.total - p.s) * k, lg = plan.legs[p.leg], rs = JEZERO_SPEEDS_safe(), txt;
    if (p.atEnd) txt = 'Route complete: you are back at base camp.';
    else txt = 'Driven ' + fmtM(p.s * k) + ' of ' + fmtM(plan.totalM) + '. Next: leg ' + (p.leg + 1) + ' to ' + stopLabel(lg.toId) + ', ' + fmtM(Math.max(0, path.legs[p.leg].s1 - p.s) * k) + ' to go, about ' + fmtDur(left / rs.rover) + ' for the rest by rover.';
    if (p.off > 150) txt += ' You are ' + fmtM(p.off * k) + ' off the route.';
    rEls.prog.textContent = txt;
    (rEls.legs || []).forEach(function (li, i) { li.classList.toggle('cur', i === p.leg && !p.atEnd); li.classList.toggle('past', i < p.leg || p.atEnd); });
  }
  /* the stop-order option is shared with the control page ('route:options'), so the run follows the route shown here */
  var roOff = null, roKey = null;
  function publishRouteOpts() { try { var l = link(); if (l && isJoined() && l.setState) l.setState('route:options', { optimizeOrder: optimizeOn, t: new Date().toISOString() }); } catch (e) { /* link not ready */ } }
  function watchRouteOpts() {
    var l = link(); if (!l || !isJoined() || !l.onState) return;
    var key = l.room.code; if (roKey === key) return; roKey = key;
    if (roOff) { try { roOff(); } catch (e) { /* ignore */ } }
    roOff = l.onState('route:options', function (v) {
      if (!v || typeof v !== 'object' || typeof v.optimizeOrder !== 'boolean' || v.optimizeOrder === optimizeOn) return;
      optimizeOn = v.optimizeOrder; lsSet('tablet.optimize.' + crewId(), optimizeOn); if (rEls.optBtn) rEls.optBtn.setAttribute('aria-pressed', optimizeOn ? 'true' : 'false'); computePlan();
    });
    try { if (!l.getState('route:options') && optimizeOn) publishRouteOpts(); } catch (e) { /* ignore */ }
  }
  function eventsKey(h) { return (h.solar ? 's' : '') + (h.dust ? 'd' : ''); }
  function checkEvents() {
    if (!JR()) return;
    var h = hazards(), ro = runOrder();
    if (lastEvents && (ro ? ro.join(',') : '') !== runKey) { computePlan(); toast(ro ? 'Route follows the order of the running mission.' : 'Route recalculated.', 'info'); return; }
    if (lastEvents && eventsKey(h) !== eventsKey(lastEvents)) {
      var was = lastEvents; computePlan();
      var on = (h.solar && !was.solar ? 'Solar particle event' : h.dust && !was.dust ? 'Dust storm' : null);
      toast(on ? on + ' active: route recalculated.' : 'Conditions cleared: route recalculated.', on ? 'warn' : 'info');
    }
  }

  /* ---------- objective choice (shared state 'objective:<crewId>', helper JdaObjective when present) ---------- */
  var objCache = null;
  function normChoice(v) {
    if (v && typeof v === 'object') v = v.choice;
    if (v === 'both' || v === 1 || v === 2) return v;
    if (v === '1' || v === '2') return +v;
    return null;
  }
  function objChoice() {
    var id = crewId(), v = null, JO = window.JdaObjective;
    if (JO && typeof JO.get === 'function') { try { v = normChoice(JO.get(id)); } catch (e) { v = null; } if (v) return v; }
    try { var l = link(), st = l && isJoined() && l.getState ? l.getState('objective:' + id) : null; v = normChoice(st && st.value); } catch (e) { v = null; }
    return v || normChoice(lsGet('objective.' + id, null)) || normChoice(lsGet('objective', null));
  }
  function setObjective(c) {
    var id = crewId(), JO = window.JdaObjective, done = false;
    if (JO && typeof JO.set === 'function') { try { JO.set(c, id); done = true; } catch (e) { done = false; } }
    if (!done) {
      var rec = { choice: c, t: new Date().toISOString() }; lsSet('objective.' + id, rec);
      try { var l = link(); if (l && isJoined() && l.setState) l.setState('objective:' + id, rec); } catch (e) { /* link not ready */ }
    }
    onObjChange(true);
  }
  function objFilter(list) {
    var c = objChoice();
    return c === 1 || c === 2 ? list.filter(function (t) { return t.objective === c; }) : list;
  }
  function objLabel(c) {
    if (c === 'both') return 'Both objectives';
    return c ? objShort(c) : 'not chosen';
  }
  function updateObjUi() {
    var c = objChoice();
    $('obj-txt').textContent = 'Objective: ' + objLabel(c);
    $('obj-change').textContent = c ? 'Change' : 'Choose';
    $('obj-change').setAttribute('aria-label', c ? 'Change objective, now ' + objLabel(c) : 'Choose your objective');
  }
  function onObjChange(force) {
    var c = objChoice(), key = String(c);
    if (!force && key === objCache) return;
    objCache = key; if (c && !$('obj-back').hidden && !objManual) closeObjDlg();
    buildTasks(); renderList(); updateProgress(); renderDetail(); refreshStopDots(); updateTaskPin(); updateObjUi(); publish(); computePlan();
  }
  var objAsked = false, objReturn = null, objOff = [], objWatched = null;
  function watchObjective() {
    var id = crewId(); if (objWatched === id + '|' + (isJoined() ? 1 : 0)) return; objWatched = id + '|' + (isJoined() ? 1 : 0);
    objOff.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } }); objOff = [];
    try { var JO = window.JdaObjective; if (JO && typeof JO.on === 'function') { var o = JO.on(function () { onObjChange(false); }); if (typeof o === 'function') objOff.push(o); } } catch (e) { /* ignore */ }
    try { var l = link(); if (l && isJoined() && l.onState) objOff.push(l.onState('objective:' + id, function () { onObjChange(false); })); } catch (e) { /* ignore */ }
  }
  var objManual = false;
  function openObjDlg(first) {
    objManual = !first;
    var box = $('obj-opts'), cur = objChoice() || (first ? null : 'both'); box.textContent = '';
    var opts = [[1, objShort(1), (MD.objectives[0] || {}).title], [2, objShort(2), (MD.objectives[1] || {}).title], ['both', 'Both objectives', 'All ten tasks, two at each stop.']];
    opts.forEach(function (o) {
      var inp = el('input', { type: 'radio', name: 'obj', value: String(o[0]), checked: String(cur) === String(o[0]) });
      var lab = el('label', { class: String(cur) === String(o[0]) ? 'on' : '' }, [inp, el('span', {}, [el('b', { text: o[1] }), el('small', { text: o[2] || '' })])]);
      inp.addEventListener('change', function () { Array.prototype.forEach.call(box.children, function (x) { x.classList.remove('on'); }); lab.classList.add('on'); $('obj-ok').disabled = false; });
      box.appendChild(lab);
    });
    $('obj-ok').disabled = !box.querySelector('input:checked');
    $('obj-cancel').hidden = !!first; $('obj-cancel').textContent = 'Cancel';
    objReturn = document.activeElement; $('obj-back').hidden = false;
    var ch = box.querySelector('input:checked'); (ch || box.querySelector('input')).focus();
  }
  function closeObjDlg() { $('obj-back').hidden = true; if (objReturn && objReturn.focus && document.contains(objReturn)) { try { objReturn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } } }
  function confirmObj() {
    var r = $('obj-opts').querySelector('input:checked'); if (!r) return;
    var v = r.value === 'both' ? 'both' : +r.value; closeObjDlg(); setObjective(v);
  }
  $('obj-ok').addEventListener('click', confirmObj);
  $('obj-cancel').addEventListener('click', closeObjDlg);
  $('obj-change').addEventListener('click', function () { openObjDlg(!objChoice()); });
  $('obj-back').addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { e.stopPropagation(); if (objManual) closeObjDlg(); return; }
    if (e.key !== 'Tab') return;
    var f = Array.prototype.slice.call($('obj-back').querySelectorAll('input,button')).filter(function (x) { return !x.hidden && !x.disabled && (x.type !== 'radio' || x.checked); }), i = f.indexOf(document.activeElement);
    if (!f.length) return;
    if (e.shiftKey && i <= 0) { f[f.length - 1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === f.length - 1) { f[0].focus(); e.preventDefault(); }
  });
  function askObjectiveOnce() { if (objAsked || objChoice() || !$('obj-back').hidden) return; objAsked = true; openObjDlg(true); }

  /* ---------- stop pictures ---------- */
  var RAW_URL = 'https://mars.nasa.gov/mars2020/multimedia/raw-images/';
  function stopPicture(st) {
    var all = window.JEZERO_STOP_IMAGES, im = all && st ? all[st.id] : null, fig = el('figure', { class: 'pic' }), fr = el('div', { class: 'frame' });
    fig.style.margin = '';
    var cap = el('figcaption');
    function none() { fr.textContent = ''; fr.appendChild(el('span', { class: 'none', text: 'Picture not available yet' })); }
    if (!im || typeof im.src !== 'string' || !im.src) { none(); }
    else {
      var pic = new Image(); pic.alt = (typeof im.caption === 'string' && im.caption) || 'Picture of the area near ' + st.name; pic.decoding = 'async';
      pic.addEventListener('error', function () { none(); cap.textContent = ''; });
      pic.addEventListener('load', function () { layoutSoon(); });
      pic.src = im.src; fr.appendChild(pic);
      cap.appendChild(el('span', { text: 'NASA/JPL-Caltech, Perseverance' + (im.sol != null ? ' sol ' + String(im.sol).slice(0, 8) : '') + (im.camera ? ', ' + String(im.camera).slice(0, 60) : '') + '. ' }));
      cap.appendChild(el('a', { href: RAW_URL, target: '_blank', rel: 'noopener', text: 'NASA raw images' }));
      if (typeof im.caption === 'string' && im.caption) cap.appendChild(el('div', { text: im.caption.slice(0, 200) }));
    }
    fig.appendChild(fr); fig.appendChild(cap); return fig;
  }
  var layoutT = null;
  function layoutSoon() { clearTimeout(layoutT); layoutT = setTimeout(function () { applyLayout(); ensureVisible(0); }, 30); }

  /* view that shows base camp and all five stops inside the free part of the screen */
  function jezeroView() {
    var pts = routePts(), j = SITES.jezero; if (!pts.length) return { lat: j.lat, lon: j.lon, ppd: j.ppd };
    var la = pts.map(function (q) { return q.lat; }), lo = pts.map(function (q) { return q.lon; });
    var la0 = Math.min.apply(null, la), la1 = Math.max.apply(null, la), lo0 = Math.min.apply(null, lo), lo1 = Math.max.apply(null, lo);
    var a = bestFree() || { w: W, h: H }, ppd = Math.min(MAX_PPD, Math.max(JZ_PPD_MIN, Math.min((a.w - 320) / Math.max(1e-6, lo1 - lo0), (a.h - 300) / Math.max(1e-6, la1 - la0))));
    return { lat: (la0 + la1) / 2, lon: (lo0 + lo1) / 2, ppd: ppd };
  }

  function animateTo(t, ms) {
    var from = { lon: view.lon, lat: view.lat, lp: Math.log(view.ppd) }, to = { lon: t.lon, lat: t.lat, lp: Math.log(clamp(t.ppd, minPpd, MAX_PPD)) };
    var t0 = performance.now(); ms = ms == null ? 500 : ms;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ms = 0;
    var my = anim = { id: ++animateTo.n };
    function step(now) {
      if (anim !== my) return;
      var k = clamp((now - t0) / ms, 0, 1), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      view.lon = from.lon + (to.lon - from.lon) * e; view.lat = from.lat + (to.lat - from.lat) * e; view.ppd = Math.exp(from.lp + (to.lp - from.lp) * e);
      clampView(); draw();
      if (k < 1) requestAnimationFrame(step); else anim = null;
    }
    if (ms <= 0) { view.lon = to.lon; view.lat = to.lat; view.ppd = Math.exp(to.lp); clampView(); anim = null; queueDraw(); return; }
    requestAnimationFrame(step);
  }
  animateTo.n = 0;
  function stopAnim() { anim = null; }
  function zoomAt(px, py, f) {
    stopAnim();
    var before = unproject(px, py);
    view.ppd = clamp(view.ppd * f, minPpd, MAX_PPD);
    view.lon = before.lon - (px - W / 2) / view.ppd; view.lat = before.lat + (py - H / 2) / view.ppd;
    clampView(); queueDraw();
  }
  function panBy(dx, dy) { stopAnim(); view.lon -= dx / view.ppd; view.lat += dy / view.ppd; clampView(); queueDraw(); }

  /* ---------- pointer input on the map ---------- */
  var ptrs = {}, dragMoved = 0, suppress = false;
  function ptrList() { return Object.keys(ptrs).map(function (k) { return ptrs[k]; }); }
  map.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var r = map.getBoundingClientRect();
    ptrs[e.pointerId] = { x: (e.clientX - r.left) / SC, y: (e.clientY - r.top) / SC, ox: e.clientX / SC, oy: e.clientY / SC };
    if (ptrList().length === 1) dragMoved = 0;
    stopAnim(); map.classList.add('drag');
    if (document.activeElement !== map && !e.target.closest('.pin')) map.focus({ preventScroll: true });
  });
  window.addEventListener('pointermove', function (e) {
    var p = ptrs[e.pointerId]; if (!p) return;
    var r = map.getBoundingClientRect(), x = (e.clientX - r.left) / SC, y = (e.clientY - r.top) / SC, ps = ptrList();
    if (ps.length >= 2) {
      var o = ps[0] === p ? ps[1] : ps[0], d0 = Math.hypot(p.x - o.x, p.y - o.y), d1 = Math.hypot(x - o.x, y - o.y);
      var mx0 = (p.x + o.x) / 2, my0 = (p.y + o.y) / 2, mx1 = (x + o.x) / 2, my1 = (y + o.y) / 2;
      if (d0 > 8) zoomAt(mx1, my1, d1 / d0);
      panBy(mx1 - mx0, my1 - my0); dragMoved = 99;
    } else {
      dragMoved = Math.max(dragMoved, Math.hypot(e.clientX / SC - p.ox, e.clientY / SC - p.oy));
      if (dragMoved > 5) panBy(x - p.x, y - p.y);
    }
    p.x = x; p.y = y;
  });
  function endPtr(e) {
    var p = ptrs[e.pointerId]; if (!p) return;
    delete ptrs[e.pointerId];
    if (!ptrList().length) map.classList.remove('drag');
    if (dragMoved > 5) { suppress = true; setTimeout(function () { suppress = false; }, 0); }
    else if (e.type === 'pointerup' && ptrList().length === 0 && !(e.target.closest && e.target.closest('.pin'))) mapClick(p.x, p.y);
  }
  window.addEventListener('pointerup', endPtr);
  window.addEventListener('pointercancel', endPtr);
  map.addEventListener('wheel', function (e) {
    e.preventDefault();
    var d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY, r = map.getBoundingClientRect();
    zoomAt((e.clientX - r.left) / SC, (e.clientY - r.top) / SC, Math.exp(-d * 0.0016));
  }, { passive: false });
  map.addEventListener('keydown', function (e) {
    if (e.target !== map) return;
    var k = e.key, s = 0.12;
    if (k === 'ArrowLeft') panBy(W * s, 0); else if (k === 'ArrowRight') panBy(-W * s, 0);
    else if (k === 'ArrowUp') panBy(0, H * s); else if (k === 'ArrowDown') panBy(0, -H * s);
    else if (k === '+' || k === '=') zoomAt(W / 2, H / 2, 1.5); else if (k === '-' || k === '_') zoomAt(W / 2, H / 2, 1 / 1.5);
    else if (k === '0' || k === 'Home') goGlobal(); else return;
    e.preventDefault();
  });
  $('z-in').addEventListener('click', function () { zoomAt(W / 2, H / 2, 1.6); });
  $('z-out').addEventListener('click', function () { zoomAt(W / 2, H / 2, 1 / 1.6); });

  /* centre a point in the free part of the screen (the part not under the pop-up) */
  function viewCenteredOn(lat, lon, ppd, area) {
    var cx = area ? area.x + area.w / 2 : W / 2, cy = area ? area.y + area.h / 2 + 14 : H / 2;
    return { lon: lon - (cx - W / 2) / ppd, lat: lat + (cy - H / 2) / ppd, ppd: ppd };
  }
  function goGlobal() { var hv = homeView(); animateTo(hv, 450); }
  function goJezero() { var j = jezeroView(); animateTo(viewCenteredOn(j.lat, j.lon, j.ppd, bestFree()), 600); }
  function goMe() { var y = youLL(); animateTo(viewCenteredOn(y.lat, y.lon, Math.max(view.ppd, 300), bestFree()), 500); }
  $('v-global').addEventListener('click', goGlobal);
  $('v-jezero').addEventListener('click', goJezero);
  $('v-me').addEventListener('click', goMe);

  /* ---------- toast ---------- */
  var toastT = null;
  function toast(text, level) {
    var t = $('toast'); t.textContent = text; t.className = 'toast' + (level ? ' ' + level : ''); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, 5200);
  }

  /* ---------- tasks ---------- */
  var tasks = [], byId = {}, doneMap = {}, ownTasks = [], locs = [], sel = null, chosen = null, boundCrew = null;
  var stopList = [], mtasks = [], groupBy = lsGet('tablet.group', 'stop') === 'objective' ? 'objective' : 'stop';
  function objShort(n) { var o = (MD.objectives || []).filter(function (x) { return x.id === n; })[0]; return o ? (o.short || o.title) : 'Objective ' + n; }
  /* what the shared world says is already done (by the crew's current task or its progress count); a manual check always wins */
  function worldDoneSet() {
    var m = me(), set = {}; if (!m) return set;
    var full = (MD.tasks || []), pos = {}, i, idx = -1;
    if (m.progress && Array.isArray(m.progress.doneIds)) {   // every task the run actually finished, independent of the chosen objective
      m.progress.doneIds.forEach(function (id) { if (typeof id === 'string') set[id] = true; });
      return set;
    }
    full.forEach(function (t, k) { pos[t.id] = k; });
    var ref = -1;   // position in the full ordered list: tasks of the chosen objective before it count as done
    if (m.taskId && pos[m.taskId] != null) ref = pos[m.taskId];
    else if (m.stopId) { for (i = 0; i < full.length; i++) if (full[i].stopId === m.stopId) { ref = i; break; } }
    if (ref >= 0) { for (i = 0; i < mtasks.length; i++) if (pos[mtasks[i].id] < ref) set[mtasks[i].id] = true; return set; }
    var n = m.progress && isFinite(m.progress.done) ? Math.max(0, Math.min(mtasks.length, +m.progress.done)) : 0;
    for (i = 0; i < n; i++) set[mtasks[i].id] = true;
    return set;
  }
  var wDone = {};
  function isDone(t) {
    if (Object.prototype.hasOwnProperty.call(doneMap, t.id)) return !!doneMap[t.id];
    return t.kind === 'mtask' ? !!wDone[t.id] : !!t.seedDone;
  }
  function buildTasks() {
    var out = [];
    stopList = (MD.stops || []).filter(function (s) { return s && isFinite(s.lat) && isFinite(s.lon); }).map(function (s) {
      return { id: s.id, kind: 'stop', no: s.n, name: s.name, title: s.name, sub: 'Stop ' + s.n, desc: s.description || '', lat: +s.lat, lon: +s.lon };
    });
    var stopBy = {}; stopList.forEach(function (s) { stopBy[s.id] = s; });
    mtasks = objFilter((MD.tasks || []).filter(function (t) { return t && stopBy[t.stopId]; })).map(function (t) {
      var st = stopBy[t.stopId];
      return { id: t.id, kind: 'mtask', stop: st, stopId: t.stopId, obj: t.objective, tag: objShort(t.objective), title: t.title, desc: t.description || '', estMin: t.estMin, lat: st.lat, lon: st.lon };
    });
    wDone = worldDoneSet();
    ownTasks.forEach(function (c) {
      out.push({ id: c.id, title: c.title, sub: 'My task', kind: 'task', desc: '', lat: c.lat == null ? null : c.lat, lon: c.lon == null ? null : c.lon, own: true });
    });
    var td = lsGet('planner.todos', []);
    if (Array.isArray(td)) td.slice(0, 60).forEach(function (t) {
      if (t && typeof t.title === 'string' && t.title && t.id != null) out.push({ id: 'todo-' + String(t.id).slice(0, 40), title: t.title.slice(0, 80), sub: 'Planner to-do',
        kind: 'task', desc: typeof t.description === 'string' ? t.description.slice(0, 300) : '', lat: null, lon: null, seedDone: !!t.done });
    });
    tasks = out; byId = {}; stopList.concat(mtasks, out).forEach(function (t) { byId[t.id] = t; });
    if (sel && !byId[sel.id]) sel = null; else if (sel) sel = byId[sel.id];
  }
  function loadCrewData() {
    var c = crewId(); boundCrew = c;
    var d = lsGet('tablet.done.' + c, {}); doneMap = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
    var o = lsGet('tablet.tasks.' + c, []); ownTasks = Array.isArray(o) ? o.filter(function (x) { return x && typeof x.id === 'string' && typeof x.title === 'string'; }) : [];
    var l = lsGet('tablet.locs.' + c, []); locs = Array.isArray(l) ? l.filter(function (x) { return x && isFinite(x.lat) && isFinite(x.lon) && typeof x.name === 'string'; }) : [];
    optimizeOn = lsGet('tablet.optimize.' + c, false) === true;
    buildTasks();
  }
  function allDoneIds() {   // done tasks of every objective: manual checks first, then what the run finished
    var out = [], w = worldDoneSet();
    (MD.tasks || []).forEach(function (t) {
      var d = Object.prototype.hasOwnProperty.call(doneMap, t.id) ? !!doneMap[t.id] : !!w[t.id];
      if (d) out.push(t.id);
    });
    return out;
  }
  function progress() { var d = 0; mtasks.forEach(function (t) { if (isDone(t)) d++; }); return { done: d, total: mtasks.length }; }
  function updateProgress() {
    var p = progress(), pct = p.total ? Math.round(p.done / p.total * 100) : 0;
    $('bar-fill').style.width = pct + '%'; $('bar-txt').textContent = 'MISSION PROGRESS ' + p.done + ' / ' + p.total;
    var b = $('bar'); b.setAttribute('aria-valuenow', String(pct)); b.setAttribute('aria-valuetext', p.done + ' of ' + p.total + ' tasks done');
    $('pop-cnt').textContent = p.done + ' of ' + p.total + ' done';
  }
  function refreshWorldDone() {
    var n = worldDoneSet(), ch = Object.keys(n).sort().join() !== Object.keys(wDone).sort().join();
    if (!ch) return; wDone = n; updateProgress(); mtasks.forEach(refreshRow); refreshStopDots(); publish();
  }
  var pubT = null;
  function publish() {
    clearTimeout(pubT);
    pubT = setTimeout(function () {
      var l = link(); if (!isJoined() || !l.setState) return;
      var next = null;
      for (var i = 0; i < mtasks.length; i++) if (!isDone(mtasks[i])) {
        var t = mtasks[i]; next = { title: t.title.slice(0, 80), startISO: null, kind: 'task', taskId: t.id, stopId: t.stopId, stopName: t.stop.name.slice(0, 60), objective: t.obj, estMin: t.estMin == null ? null : t.estMin }; break;
      }
      try {
        l.setState('tasks:' + crewId(), { next: next, missions: mtasks.map(function (t) { return { id: t.id, title: t.title.slice(0, 80), done: isDone(t), stopId: t.stopId, objective: t.obj }; }), progress: progress(), objective: objChoice(), doneIds: allDoneIds() });
      } catch (e) { if (window.console) console.warn('tasks state not published', e); }
    }, 120);
  }
  function setDone(t, flag) {
    doneMap[t.id] = !!flag; lsSet('tablet.done.' + crewId(), doneMap);
    updateProgress(); refreshRow(t); if (sel && sel.id === t.id) renderDetail(); refreshStopDots();
    if (t.kind === 'mtask') try { var l = link(); if (l && isJoined()) l.send({ type: 'task', crew: crewId(), taskId: t.id, done: !!flag }); } catch (e) { /* link not ready */ }
    publish();
  }

  /* ---------- pop-up ---------- */
  var pop = $('pop'), listEl = $('pop-list'), rows = {}, heads = {}, userPlaced = false, dock = 'left';
  function atlasHref() { return /\/web\/html\//.test(location.pathname) ? 'index.html' : 'jezero-delta-atlas.html'; }
  function isSheet() { return W < 640 || (H > W * 1.2 && W < 900); }
  function setGroup(g) {
    groupBy = g; lsSet('tablet.group', g); renderList();
    ['stop', 'objective'].forEach(function (k) { var b = $('grp-' + k); b.setAttribute('aria-pressed', k === g ? 'true' : 'false'); });
  }
  function renderList() {
    var keep = listEl.scrollTop; listEl.textContent = ''; rows = {}; heads = {};
    function list(items) { var ul = el('ul'); items.forEach(function (t) { ul.appendChild(makeRow(t)); }); listEl.appendChild(ul); }
    if (groupBy === 'objective') {
      (MD.objectives || []).forEach(function (o) {
        var its = mtasks.filter(function (t) { return t.obj === o.id; }); if (!its.length) return;
        listEl.appendChild(el('h3', { text: o.title })); list(its);
      });
    } else {
      stopList.forEach(function (st) {
        var h = el('button', { type: 'button', class: 'grp', attrs: { 'aria-pressed': 'false' } }, [el('b', { text: String(st.no) }), el('span', { text: st.name })]);
        h.addEventListener('click', function () { selectTask(st.id); });
        heads[st.id] = h; listEl.appendChild(el('h3', { class: 'stop-h' }, [h]));
        list(mtasks.filter(function (t) { return t.stopId === st.id; }));
      });
    }
    listEl.appendChild(el('h3', { text: 'My tasks' }));
    if (!tasks.length) listEl.appendChild(el('p', { class: 'hint', text: 'None yet. Add one below.', attrs: { style: 'margin:2px 12px' } })); else list(tasks);
    Object.keys(heads).forEach(refreshHead);
    listEl.scrollTop = keep; updateProgress();
  }
  function rowSub(t) {
    if (t.kind !== 'mtask') return t.sub;
    return groupBy === 'objective' ? 'Stop ' + t.stop.no + ': ' + t.stop.name : t.tag + (t.estMin ? ' - about ' + t.estMin + ' min' : '');
  }
  function makeRow(t) {
    var cb = el('input', { type: 'checkbox', checked: isDone(t), attrs: { 'aria-label': 'Done: ' + t.title } });
    cb.addEventListener('change', function () { setDone(t, cb.checked); });
    var subKids = [];
    if (t.kind === 'mtask' && groupBy === 'stop') subKids.push(el('i', { class: 'tag o' + t.obj, text: t.tag }), el('span', { text: t.estMin ? ' about ' + t.estMin + ' min' : '' }));
    else subKids.push(el('span', { text: rowSub(t) }));
    var ttl = el('button', { type: 'button', class: 'ttl', attrs: { 'aria-pressed': 'false' } }, [el('span', { text: t.title }), el('small', {}, subKids)]);
    ttl.addEventListener('click', function () { selectTask(t.id); });
    var li = el('li', { class: 'task' }, [el('label', {}, [cb]), ttl]);
    rows[t.id] = { li: li, cb: cb, ttl: ttl }; refreshRow(t); return li;
  }
  function refreshHead(id) {
    var h = heads[id]; if (!h) return; var s = !!(sel && (sel.id === id || sel.stopId === id));
    h.classList.toggle('sel', s); h.setAttribute('aria-pressed', sel && sel.id === id ? 'true' : 'false');
  }
  function refreshRow(t) {
    var r = rows[t.id]; if (!r) return;
    var d = isDone(t); r.cb.checked = d; r.li.classList.toggle('done', d);
    var s = !!(sel && sel.id === t.id); r.li.classList.toggle('sel', s); r.ttl.setAttribute('aria-pressed', s ? 'true' : 'false');
    r.li.classList.toggle('grp', !!(sel && sel.kind === 'stop' && t.stopId === sel.id));
  }
  function renderDetail() {
    var d = $('pop-detail');
    if (!sel) { d.hidden = true; return; }
    d.hidden = false; d.textContent = '';
    var t = sel, acts = el('div', { class: 'acts' }), st = t.kind === 'mtask' ? t.stop : t.kind === 'stop' ? t : null;
    if (st) d.appendChild(stopPicture(st));
    d.appendChild(el('h3', { text: t.title }));
    d.appendChild(el('p', { text: t.kind === 'mtask' ? 'Stop ' + st.no + ': ' + st.name + ' - ' + t.tag + (t.estMin ? ' - about ' + t.estMin + ' min' : '') : t.kind === 'stop' ? 'Stop ' + t.no + ' of ' + stopList.length + ': tasks below are highlighted' : t.sub }));
    if (t.desc) d.appendChild(el('p', { text: t.desc }));
    if (t.lat != null) d.appendChild(el('p', { text: fmtLat(t.lat) + ', ' + fmtLon(t.lon) }));
    else d.appendChild(el('p', { text: 'No map location.' }));
    if (t.lat != null) acts.appendChild(el('button', { type: 'button', text: 'Show on map', onclick: function () { focusTask(t, true); } }));
    if (t.kind !== 'stop') acts.appendChild(el('button', { type: 'button', text: isDone(t) ? 'Mark not done' : 'Mark done', onclick: function () { setDone(t, !isDone(t)); } }));
    if (st) acts.appendChild(el('a', { class: 'lnk', href: atlasHref(), text: 'Open detailed Jezero map', target: '_blank', rel: 'noopener' }));
    d.appendChild(acts);
  }
  /* ---------- side panels (mission pop-up and chat): adaptive docking ---------- */
  var chatPanel = $('chat'), chatPlaced = false, chatPref = 'right', lastOpened = 'mission';
  var panels = [
    { name: 'mission', el: pop, hd: $('pop-hd'), get placed() { return userPlaced; }, set placed(v) { userPlaced = v; } },
    { name: 'chat', el: chatPanel, hd: $('chat-hd'), get placed() { return chatPlaced; }, set placed(v) { chatPlaced = v; } },
    { name: 'route', el: routePanel, hd: $('route-hd'), get placed() { return routePlaced; }, set placed(v) { routePlaced = v; } }
  ];
  var routePlaced = false, routePref = 'right', openSeq = 0;
  function pvis(p) { return !p.el.hidden; }
  function relRect(node) {
    var r = node.getBoundingClientRect(), s = screen.getBoundingClientRect();
    return { x: (r.left - s.left) / SC, y: (r.top - s.top) / SC, w: r.width / SC, h: r.height / SC };
  }
  function popTop() { var m = $('tl').getBoundingClientRect(), s = screen.getBoundingClientRect(); return Math.round((m.bottom - s.top) / SC + 10); }
  function resetBox(el_) { ['left', 'top', 'width', 'height', 'right', 'bottom'].forEach(function (k) { el_.style.removeProperty(k); }); }
  function applyLayout() {
    var vis = panels.filter(pvis);
    var sheet = isSheet(), cap = $('coords'), br = document.querySelector('.br');
    screen.classList.toggle('sheet-open', sheet && vis.length > 0);
    if (!vis.length) return;
    screen.style.setProperty('--sheet-h', Math.round(Math.min(H * 0.44, 440)) + 'px');
    if (sheet) { vis.forEach(function (p) { resetBox(p.el); p.el.dataset.dock = 'sheet'; }); return; }
    // keep the readouts (coordinates, distance) visible: docked panels end above them
    var rl = relRect(cap), rr = relRect(br);
    screen.style.setProperty('--pop-top', popTop() + 'px');
    screen.style.setProperty('--rd-l', Math.max(12, Math.round(H - rl.y + 10)) + 'px');
    screen.style.setProperty('--rd-r', Math.max(12, Math.round(H - rr.y + 10)) + 'px');
    vis.forEach(function (p) {
      if (p.placed) { p.el.dataset.dock = 'free'; clampFree(p); return; }
      resetBox(p.el);
      p.el.dataset.dock = sideOf(p);
    });
  }
  function prefOf(p) { return p === panels[0] ? dock : p === panels[1] ? chatPref : routePref; }
  /* anchor order mission, chat, route: the first docked panel takes its preferred side, the next one the opposite side */
  function sideOf(p) {
    var docked = panels.filter(function (q) { return pvis(q) && !q.placed; }), i = docked.indexOf(p);
    if (i <= 0) return prefOf(p);
    var first = docked[0], fs = prefOf(first);
    return i === 1 ? (fs === 'left' ? 'right' : 'left') : prefOf(p);
  }
  function clampFree(p) {
    var e = p.el, w = e.offsetWidth, h = e.offsetHeight, l = parseFloat(e.style.left) || 0, t = parseFloat(e.style.top) || 0;
    l = clamp(l, 4, Math.max(4, W - w - 4)); t = clamp(t, 4, Math.max(4, H - h - 4));
    [relRect($('coords')), relRect(document.querySelector('.br'))].forEach(function (r) {
      if (l < r.x + r.w && l + w > r.x && t + h > r.y - 8 && t < r.y + r.h) {
        t = Math.max(4, r.y - 8 - h); if (t + h > r.y - 8) { h = Math.max(200, r.y - 8 - t); e.style.height = h + 'px'; }
      }
    });
    e.style.left = l + 'px'; e.style.top = t + 'px';
  }
  function occluders() {
    var o = [];
    panels.forEach(function (p) { if (pvis(p)) o.push(relRect(p.el)); });
    if (o.length && isSheet()) { o.push(relRect($('coords'))); o.push(relRect(document.querySelector('.br'))); }
    return o;
  }
  /* rectangles of the map not covered by a panel, each at least 140 px both ways */
  function freeRects() {
    var pad = 12, full = { x: pad, y: pad, w: W - 2 * pad, h: H - 2 * pad }, o = occluders();
    if (!o.length) return [full];
    var iv = o.map(function (r) { return [r.x, r.x + r.w]; }).sort(function (a, b) { return a[0] - b[0]; }), merged = [];
    iv.forEach(function (v) { var l = merged[merged.length - 1]; if (l && v[0] <= l[1]) l[1] = Math.max(l[1], v[1]); else merged.push([v[0], v[1]]); });
    var c = [], cur = 0;
    merged.forEach(function (m) { c.push({ x: cur + pad, y: pad, w: m[0] - cur - 2 * pad, h: H - 2 * pad }); cur = m[1]; });
    c.push({ x: cur + pad, y: pad, w: W - cur - 2 * pad, h: H - 2 * pad });
    var minY = Math.min.apply(null, o.map(function (r) { return r.y; })), maxY = Math.max.apply(null, o.map(function (r) { return r.y + r.h; }));
    c.push({ x: pad, y: pad, w: W - 2 * pad, h: minY - 2 * pad });
    c.push({ x: pad, y: maxY + pad, w: W - 2 * pad, h: H - maxY - 2 * pad });
    return c.filter(function (r) { return r.w >= 140 && r.h >= 140; });
  }
  function bestFree() {
    var c = freeRects(), best = null, ba = -1;
    c.forEach(function (r) { var a = r.w * r.h; if (a > ba) { ba = a; best = r; } });
    return best;
  }
  /* the always-visible controls at the top (mission box and chat button at the left, map buttons): a pin must not sit under them */
  function hudRects() { return [relRect($('tl')), relRect(document.querySelector('.zoom'))]; }
  function pinBox(x, y) { return { x: x - 20, y: y - 66, w: 40, h: 66 }; }   // marker body and label above its tip
  function boxHits(b, r) { return b.x < r.x + r.w + 6 && b.x + b.w > r.x - 6 && b.y < r.y + r.h + 6 && b.y + b.h > r.y - 6; }
  function boxHitsHud(b) { return hudRects().some(function (r) { return boxHits(b, r); }); }
  /* view that puts the point in the free area, moved down when the marker would sit under the top controls */
  /* bottom sheet (phones): the only free band for a marker lies between the top controls and the readouts that ride above the sheet */
  function sheetBand() {
    if (!isSheet()) return null;
    var tl = relRect($('tl')), rd = [relRect($('coords')), relRect(document.querySelector('.br'))];
    return { top: tl.y + tl.h + 6, bot: Math.min.apply(null, rd.map(function (r) { return r.y; })) - 6 };
  }
  function centeredClear(lat, lon, ppd) {
    var band = sheetBand();
    if (band && pop_visible_any()) {
      var ty = Math.max(band.top + 66, Math.min(band.bot, (band.top + band.bot) / 2 + 33));
      return { lon: lon, lat: lat + (ty - H / 2) / ppd, ppd: ppd };
    }
    var v = viewCenteredOn(lat, lon, ppd, bestFree()), x = W / 2 + (lon - v.lon) * ppd, y = H / 2 - (lat - v.lat) * ppd, dy = 0;
    hudRects().forEach(function (r) {
      if (boxHits(pinBox(x, y), r)) dy = Math.max(dy, r.y + r.h + 12 + 66 - y);
    });
    if (dy > 0) v.lat += dy / ppd;
    return v;
  }
  function pop_visible_any() { return panels.some(pvis); }
  function pinVisibleInFree(pos) {
    if (boxHitsHud(pinBox(pos.x, pos.y))) return false;
    var band = sheetBand();
    if (band) return pos.y <= band.bot + 1 && pos.y - 66 >= band.top - 1 && pos.x >= 24 && pos.x <= W - 24;
    return freeRects().some(function (r) { return pos.x >= r.x + 36 && pos.x <= r.x + r.w - 36 && pos.y >= r.y + 56 && pos.y <= r.y + r.h - 16; });
  }
  /* keep the selected task's pin visible and away from every panel */
  function ensureVisible(ms) {
    var t = sel; if (!t || t.lat == null) return;
    var pos = project(t.lon, t.lat);
    if (!anim && view.ppd >= JZ_PPD_MIN && pinVisibleInFree(pos)) return;
    var ppd = view.ppd >= JZ_PPD_MIN ? view.ppd : jezeroView().ppd;
    animateTo(centeredClear(t.lat, t.lon, ppd), ms == null ? 600 : ms);
  }
  function focusTask(t, force) {
    if (!t || t.lat == null) return;
    if (!force) { ensureVisible(); return; }
    animateTo(centeredClear(t.lat, t.lon, Math.max(view.ppd, jezeroView().ppd)), 600);
  }
  function selectTask(id) {
    var t = byId[id]; if (!t) return;
    var prev = sel; sel = t;
    if (pop.hidden) openPop(true);
    if (prev && prev.kind !== 'stop') refreshRow(prev);
    refreshRow(t); Object.keys(heads).forEach(refreshHead); mtasks.forEach(refreshRow); renderDetail(); updateTaskPin();
    if (t.lat != null) {
      setChosen({ kind: 'task', id: t.id, name: t.kind === 'mtask' ? t.stop.name : t.title, lat: t.lat, lon: t.lon });
      if (!userPlaced && !isSheet() && view.ppd >= JZ_PPD_MIN) { var s = project(t.lon, t.lat); dock = s.x > W / 2 ? 'left' : 'right'; }
      applyLayout(); ensureVisible();
    } else { applyLayout(); }
    var r = rows[t.id] || { li: heads[t.id] }; if (r.li && r.li.scrollIntoView) r.li.scrollIntoView({ block: 'nearest' });
  }
  function setExpanded() {
    var m = !pop.hidden, c = !chatPanel.hidden;
    $('btn-mission').setAttribute('aria-expanded', m ? 'true' : 'false'); $('mbox').setAttribute('aria-expanded', m ? 'true' : 'false');
    $('btn-chat').setAttribute('aria-expanded', c ? 'true' : 'false'); $('btn-route').setAttribute('aria-expanded', !routePanel.hidden ? 'true' : 'false');
  }
  function openPanel(p) {
    var others = panels.filter(function (q) { return q !== p && pvis(q); });
    if (isSheet() || W < 1000) others.forEach(function (q) { q.el.hidden = true; });     // one panel at a time on small screens
    else if (others.length >= 2) { others.sort(function (a, b) { return (a.opened || 0) - (b.opened || 0); })[0].el.hidden = true; }   // at most two side by side
    p.el.hidden = false; p.opened = ++openSeq; lastOpened = p.name; setExpanded();
  }
  function openPop(noFocus) {
    openPanel(panels[0]);
    if (!listEl.firstChild) renderList();
    renderDetail(); applyLayout();
    if (sel) ensureVisible();
    if (!noFocus) { var f = pop.querySelector('.ttl'); if (f) f.focus({ preventScroll: true }); }
  }
  function closePop() {
    var had = pop.contains(document.activeElement);
    pop.hidden = true; setExpanded(); applyLayout();
    if (had) $('mbox').focus({ preventScroll: true });
  }
  $('mbox').addEventListener('click', function () { if (pop.hidden) openPop(); else closePop(); });
  $('pop-x').addEventListener('click', closePop);
  $('dock-l').addEventListener('click', function () { dock = 'left'; userPlaced = false; applyLayout(); ensureVisible(); });
  $('dock-r').addEventListener('click', function () { dock = 'right'; userPlaced = false; applyLayout(); ensureVisible(); });

  /* ---------- chat panel ---------- */
  var chat = null, chatKey = null, chatUnread = 0;
  function peersList() {
    var me_ = crewId(), list = [], l = link();
    try { (window.JdaWorld && window.JdaWorld.crew ? window.JdaWorld.crew() : []).forEach(function (c) { if (c && c.id && c.id !== me_) list.push({ id: c.id, name: c.name || c.id }); }); } catch (e) { /* world not ready */ }
    try {
      ((l && l.presence && l.presence()) || []).forEach(function (p) {
        if (p && p.id && p.role !== 'earth' && p.role !== 'control' && p.role !== 'legacy' && p.id !== me_ && !list.some(function (q) { return q.id === p.id; })) list.push({ id: p.id, name: p.name || p.id });
      });
    } catch (e) { /* no presence yet */ }
    return list;
  }
  function mountChat() {
    var l = link(), r = l && l.room; if (!r || r.role !== 'tablet' || !window.JdaChat) return;
    var key = r.code + '|' + r.id; if (chat && chatKey === key) return;
    if (chat) { chat.destroy(); chat = null; }
    var body = $('chat-body'); body.textContent = ''; chatKey = key;
    chat = window.JdaChat.mount(body, { link: l, meId: r.id, meName: r.name || crewName(), peers: peersList, allowEarth: true });
    chat.onUnread(function (total) { chatUnread = total; var b = $('chat-badge'); b.textContent = total > 99 ? '99+' : String(total); b.hidden = !total; $('btn-chat').setAttribute('aria-label', total ? 'Chat, ' + total + ' unread' : 'Chat'); $('chat-cnt').textContent = total ? total + ' unread' : ''; });
  }
  function openChat() { openPanel(panels[1]); mountChat(); applyLayout(); if (sel) ensureVisible(); if (chat) chat.focus(); }
  function closeChat() { var had = chatPanel.contains(document.activeElement); chatPanel.hidden = true; setExpanded(); applyLayout(); if (had) $('btn-chat').focus({ preventScroll: true }); }
  $('btn-chat').addEventListener('click', function () { if (chatPanel.hidden) openChat(); else closeChat(); });
  $('chat-x').addEventListener('click', closeChat);
  $('cdock-l').addEventListener('click', function () { chatPref = 'left'; chatPlaced = false; if (pvis(panels[0]) && !userPlaced) dock = 'right'; applyLayout(); ensureVisible(); });
  $('cdock-r').addEventListener('click', function () { chatPref = 'right'; chatPlaced = false; if (pvis(panels[0]) && !userPlaced) dock = 'left'; applyLayout(); ensureVisible(); });
  function openRoute() { openPanel(panels[2]); applyLayout(); if (sel) ensureVisible(); var f = routePanel.querySelector('button'); if (f) f.focus({ preventScroll: true }); }
  function closeRoute() { var had = routePanel.contains(document.activeElement); routePanel.hidden = true; setExpanded(); applyLayout(); if (had) $('btn-route').focus({ preventScroll: true }); }
  $('btn-route').addEventListener('click', function () { if (routePanel.hidden) openRoute(); else closeRoute(); });
  $('route-x').addEventListener('click', closeRoute);
  function dockRoute(side) {
    routePref = side; routePlaced = false;
    var opp = side === 'left' ? 'right' : 'left';
    if (pvis(panels[0]) && !userPlaced) dock = opp; else if (pvis(panels[1]) && !chatPlaced) chatPref = opp;
    applyLayout(); ensureVisible();
  }
  $('rdock-l').addEventListener('click', function () { dockRoute('left'); });
  $('rdock-r').addEventListener('click', function () { dockRoute('right'); });
  function incomingChat(m) {
    var l = link(), r = l && l.room; if (!r || m.type !== 'chat' || typeof m.text !== 'string') return;
    var from = m.from && typeof m.from === 'object' ? m.from : {};
    if (from.role === r.role && from.id === r.id) return;     // our own
    if (m.to !== 'all' && m.to !== r.id) return;
    if (!chatPanel.hidden) return;
    var who = String(m.fromName || from.name || from.id || 'Crew member').slice(0, 24);
    toast(who + ': ' + m.text.slice(0, 80), 'info');
  }

  // drag a panel by its header
  panels.forEach(function (p) {
    var hd = p.hd, d = null, e0 = p.el;
    hd.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || isSheet() || (e.pointerType === 'mouse' && e.button !== 0)) return;
      var r = e0.getBoundingClientRect(), s = screen.getBoundingClientRect();
      d = { id: e.pointerId, dx: (e.clientX - r.left) / SC, dy: (e.clientY - r.top) / SC, moved: false };
      e0.style.left = ((r.left - s.left) / SC) + 'px'; e0.style.top = ((r.top - s.top) / SC) + 'px'; e0.style.width = (r.width / SC) + 'px'; e0.style.height = (r.height / SC) + 'px';
      e0.style.right = 'auto'; e0.style.bottom = 'auto'; e0.dataset.dock = 'free'; p.placed = true;
      try { hd.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      e.preventDefault();
    });
    hd.addEventListener('pointermove', function (e) {
      if (!d || d.id !== e.pointerId) return;
      var s = screen.getBoundingClientRect(), w = e0.offsetWidth, h = e0.offsetHeight;
      e0.style.left = clamp((e.clientX - s.left) / SC - d.dx, 4, Math.max(4, W - w - 4)) + 'px';
      e0.style.top = clamp((e.clientY - s.top) / SC - d.dy, 4, Math.max(4, H - h - 4)) + 'px'; d.moved = true;
    });
    function up(e) { if (!d || d.id !== e.pointerId) return; var m = d.moved; d = null; if (m) { clampFree(p); ensureVisible(450); } }
    hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  });

  // own tasks
  $('pop-add').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('task-new'), title = inp.value.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!title) { inp.focus(); return; }
    if (ownTasks.length >= 100) { toast('Too many tasks. Remove some first.', 'warn'); return; }
    var c = { id: 'my-' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), title: title, lat: null, lon: null };
    if ($('task-loc').checked && chosen) { c.lat = chosen.lat; c.lon = chosen.lon; }
    ownTasks.push(c); lsSet('tablet.tasks.' + crewId(), ownTasks);
    inp.value = ''; buildTasks(); renderList(); refreshStopDots(); publish();
    toast('Task added' + (c.lat != null ? ' at ' + chosen.name : ''), 'info');
  });

  /* ---------- pins ---------- */
  var items = [], stopDots = {}, taskPin = null, pendingPin = null, nearOn = false;
  function addItem(it) { items.push(it); pinsEl.appendChild(it.el); return it; }
  function makeSite(s) {
    var b = el('button', { type: 'button', class: 'pin site', attrs: { 'aria-label': s.name + ' landing site' } }, [el('span', { class: 'lab', text: s.name })]);
    var it = { kind: 'site', id: 'site-' + s.id, name: s.name, lat: s.lat, lon: s.lon, el: b };
    b.addEventListener('click', function () { if (!suppress) setChosen(it); });
    return addItem(it);
  }
  function makeMarker(kind, name, lat, lon, label) {
    var b = el('button', { type: 'button', class: 'pin mk ' + kind, attrs: { 'aria-label': label || name } },
      [el('span', { class: 'drop' }), el('span', { class: 'lab', text: name })]);
    var it = { kind: kind, id: kind + '-' + name, name: name, lat: lat, lon: lon, el: b };
    b.addEventListener('click', function () { if (!suppress) setChosen(it); });
    return addItem(it);
  }
  var baseItem, youItem;
  function buildPins() {
    items = []; pinsEl.textContent = ''; stopDots = {}; taskPin = null; pendingPin = null; nearOn = false;
    SITES.sites.forEach(makeSite);
    stopList.forEach(function (t) {
      var b = el('button', { type: 'button', class: 'pin stopdot', text: String(t.no), attrs: { 'aria-label': 'Stop ' + t.no + ': ' + t.name } }, [el('span', { class: 'lab', text: t.name })]);
      var it = { kind: 'stop', id: t.id, name: t.name, lat: t.lat, lon: t.lon, el: b, task: t, dot: true };
      b.addEventListener('click', function () { if (!suppress) selectTask(t.id); });
      stopDots[t.id] = it; addItem(it);
    });
    locs.forEach(addLocPin);
    var bl = baseLL(), yl = youLL();
    baseItem = makeMarker('base', 'BASE', bl.lat, bl.lon, 'Base camp'); baseItem.name = 'Base camp';
    youItem = makeMarker('you', 'YOU', yl.lat, yl.lon, 'You, ' + crewName());
    refreshStopDots(); updateTaskPin(); markChosen(); queueDraw();
  }
  function addLocPin(l) {
    var it = makeMarker('loc', l.name, l.lat, l.lon, 'Saved location ' + l.name); it.loc = l; it.id = 'loc-' + l.id; return it;
  }
  function refreshStopDots() {
    Object.keys(stopDots).forEach(function (k) {
      var it = stopDots[k], ts = mtasks.filter(function (x) { return x.stopId === k; }); it.el.classList.toggle('done', ts.length > 0 && ts.every(isDone)); it.el.classList.toggle('sel', !!(sel && (sel.id === k || sel.stopId === k)));
    });
  }
  function updateTaskPin() {
    if (taskPin) { var i = items.indexOf(taskPin); if (i >= 0) items.splice(i, 1); taskPin.el.remove(); taskPin = null; }
    refreshStopDots();
    if (sel && sel.lat != null) {
      taskPin = makeMarker('task', sel.kind === 'stop' ? 'Stop ' + sel.no : sel.kind === 'mtask' ? 'Stop ' + sel.stop.no : sel.title, sel.lat, sel.lon, 'Selected: ' + sel.title); taskPin.isTask = true;
      taskPin.el.style.zIndex = '3';
    }
    queueDraw();
  }
  function setChosen(it) {
    chosen = { kind: it.kind, id: it.id, name: it.name, lat: it.lat, lon: it.lon, loc: it.loc || null };
    markChosen(); updateDist();
  }
  function markChosen() {
    items.forEach(function (it) { it.el.classList.toggle('chosen', !!(chosen && !it.isTask && it.id === chosen.id)); });
  }
  function placePins() {
    var x, y, p, vis;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.dot && view.ppd < 150 && !(sel && sel.id === it.id)) { if (!it.hid) { it.el.style.display = 'none'; it.hid = true; } continue; }
      p = project(it.lon, it.lat); x = p.x; y = p.y;
      vis = x > -80 && x < W + 80 && y > -60 && y < H + 100;
      if (!vis) { if (!it.hid) { it.el.style.display = 'none'; it.hid = true; } continue; }
      if (it.hid) { it.el.style.display = ''; it.hid = false; }
      it.el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
    }
    if (baseItem && youItem) {
      var a = project(baseItem.lon, baseItem.lat), b = project(youItem.lon, youItem.lat), near = Math.hypot(a.x - b.x, a.y - b.y) < 36;
      if (near !== nearOn) { nearOn = near; baseItem.el.classList.toggle('near', near); youItem.el.classList.toggle('near', near); }
    }
    if (pendingPin) { /* positioned like any item */ }
  }
  function updateNote() {
    var n = $('screen').querySelector('.note');
    if (view.ppd > 60) {
      if (!n) { n = el('p', { class: 'note' }, ['Orbital imagery (Jezero CTX) where available. ', el('a', { href: atlasHref(), text: 'Open detailed Jezero map', target: '_blank', rel: 'noopener' })]); screen.appendChild(n); }
    } else if (n) n.remove();
  }

  /* ---------- coordinates and distance ---------- */
  var unit = lsGet('tablet.unit', 'mi') === 'km' ? 'km' : 'mi';
  function updateCoords() {
    var y = youLL();
    $('coords-v').textContent = fmtLat(y.lat) + ', ' + fmtLon(y.lon) + ', z ' + (y.z == null ? 'n/a' : Math.round(y.z).toLocaleString('en-US') + ' m');
    if (youItem) { youItem.lat = y.lat; youItem.lon = y.lon; }
    if (baseItem) { var b = baseLL(); baseItem.lat = b.lat; baseItem.lon = b.lon; }
    updateDist(); updateRouteProgress(false); queueDraw();
  }
  function fmtDist(v) { return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US'); }
  var rmBtn = null;
  function updateDist() {
    $('unit').textContent = unit === 'mi' ? 'Show km' : 'Show miles'; $('unit').setAttribute('aria-label', 'Show distance in ' + (unit === 'mi' ? 'kilometres' : 'miles'));
    if (!chosen) { $('dist-k').textContent = 'Distance from chosen location:'; $('dist-v').textContent = 'choose a pin'; }
    else {
      var km = haversineKm(youLL(), chosen), v = unit === 'mi' ? km * 0.621371 : km;
      $('dist-k').textContent = 'Distance from ' + chosen.name + ':'; $('dist-v').textContent = fmtDist(v) + (unit === 'mi' ? ' miles' : ' km');
    }
    var removable = chosen && chosen.loc;
    if (removable && !rmBtn) {
      rmBtn = el('button', { type: 'button', class: 'unit', text: 'Remove', attrs: { 'aria-label': 'Remove this saved location' } });
      rmBtn.addEventListener('click', removeChosenLoc); $('unit').parentNode.appendChild(rmBtn);
    } else if (!removable && rmBtn) { rmBtn.remove(); rmBtn = null; }
  }
  $('unit').addEventListener('click', function () { unit = unit === 'mi' ? 'km' : 'mi'; lsSet('tablet.unit', unit); updateDist(); });

  /* ---------- Add Location ---------- */
  var addOpen = false;
  function publishLocs() { try { if (isJoined() && link().setState) link().setState('locations:' + crewId(), locs.map(function (l) { return { id: l.id, name: l.name, lat: l.lat, lon: l.lon }; })); } catch (e) { /* ignore */ } }
  function setAddOpen(o) {
    addOpen = o; $('addpanel').hidden = !o; $('btn-add').setAttribute('aria-expanded', o ? 'true' : 'false'); $('add-err').textContent = '';
    if (o) { $('add-name').value = ''; $('add-lat').value = ''; $('add-lon').value = ''; $('add-name').focus(); }
    else if (pendingPin) { var i = items.indexOf(pendingPin); if (i >= 0) items.splice(i, 1); pendingPin.el.remove(); pendingPin = null; }
  }
  function previewAdd(lat, lon) {
    $('add-lat').value = lat.toFixed(4); $('add-lon').value = normLon(lon).toFixed(4);
    if (!pendingPin) pendingPin = makeMarker('loc', 'New', lat, lon, 'New location preview');
    pendingPin.lat = lat; pendingPin.lon = lon; pendingPin.el.tabIndex = -1; queueDraw();
  }
  function mapClick(x, y) {
    if (!addOpen) return;
    var p = unproject(x, y); if (Math.abs(p.lat) > 90) return;
    previewAdd(p.lat, normLon(p.lon));
  }
  function num(s) { s = String(s).trim().replace(',', '.'); return /^[-+]?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN; }
  function saveLoc() {
    var lat = num($('add-lat').value), lon = num($('add-lon').value), name = $('add-name').value.replace(/\s+/g, ' ').trim().slice(0, 40), err = $('add-err');
    if (!isFinite(lat) || Math.abs(lat) > 90) { err.textContent = 'Latitude must be a number from -90 to 90.'; $('add-lat').focus(); return; }
    if (!isFinite(lon) || lon < -180 || lon > 360) { err.textContent = 'Longitude must be a number from -180 to 360 (east).'; $('add-lon').focus(); return; }
    if (locs.length >= 50) { err.textContent = 'Too many saved locations. Remove some first.'; return; }
    if (!name) name = 'Location ' + (locs.length + 1);
    var l = { id: Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36), name: name, lat: lat, lon: normLon(lon) };
    locs.push(l); lsSet('tablet.locs.' + crewId(), locs); publishLocs();
    setAddOpen(false); var it = addLocPin(l); setChosen(it); queueDraw();
    toast('Saved ' + name, 'info');
  }
  function removeChosenLoc() {
    if (!chosen || !chosen.loc) return;
    if (rmBtn && rmBtn.textContent !== 'Tap again to remove') {
      rmBtn.textContent = 'Tap again to remove';
      setTimeout(function () { if (rmBtn) rmBtn.textContent = 'Remove'; }, 3000); return;
    }
    var id = chosen.loc.id; locs = locs.filter(function (l) { return l.id !== id; }); lsSet('tablet.locs.' + crewId(), locs); publishLocs();
    var it = items.filter(function (x) { return x.loc && x.loc.id === id; })[0];
    if (it) { items.splice(items.indexOf(it), 1); it.el.remove(); }
    chosen = null; updateDist(); queueDraw(); $('btn-add').focus();
  }
  $('btn-add').addEventListener('click', function () { setAddOpen(!addOpen); });
  $('add-cancel').addEventListener('click', function () { setAddOpen(false); $('btn-add').focus(); });
  $('add-save').addEventListener('click', saveLoc);
  $('add-me').addEventListener('click', function () { var y = youLL(); previewAdd(y.lat, y.lon); });
  $('addpanel').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); saveLoc(); } });
  ['add-lat', 'add-lon'].forEach(function (id) {
    $(id).addEventListener('input', function () {
      var lat = num($('add-lat').value), lon = num($('add-lon').value);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && lon >= -180 && lon <= 360) {
        if (!pendingPin) pendingPin = makeMarker('loc', 'New', lat, lon, 'New location preview');
        pendingPin.lat = lat; pendingPin.lon = normLon(lon); pendingPin.el.tabIndex = -1; queueDraw();
      }
    });
  });

  /* ---------- side buttons ---------- */
  (function () {
    var b = $('btn-mission'), t0 = 0, wasOpen = false, ptr = false;
    b.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      ptr = true; t0 = performance.now(); wasOpen = !pop.hidden; b.classList.add('pressed');
      if (!wasOpen) openPop(true);
    });
    function release() {
      if (!ptr) return; ptr = false; b.classList.remove('pressed');
      var held = performance.now() - t0 > 550;
      if (wasOpen || held) closePop();
    }
    window.addEventListener('pointerup', release); window.addEventListener('pointercancel', release);
    b.addEventListener('click', function (e) { if (e.detail === 0) { if (pop.hidden) openPop(); else closePop(); } });
    b.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') b.classList.add('pressed'); });
    b.addEventListener('keyup', function () { b.classList.remove('pressed'); });
  })();

  var sosBack = $('sos-back'), sosSent = {};
  function openSos() {
    var y = youLL(); $('sos-pos').textContent = crewName() + ' at ' + fmtLat(y.lat) + ', ' + fmtLon(y.lon);
    sosBack.hidden = false; $('sos-cancel').focus();
  }
  function closeSos() { sosBack.hidden = true; $('btn-sos').focus(); }
  function sendSos() {
    var y = youLL(), l = link(), sent = null;
    try { sent = l && isJoined() ? l.send({ type: 'sos', name: crewName(), lat: y.lat, lon: y.lon }) : null; } catch (e) { sent = null; }
    sosBack.hidden = true; $('btn-sos').focus();
    if (sent) { sosSent[sent.id] = 1; toast('SOS sent to Earth control. Waiting for acknowledgement.', 'danger'); }
    else toast(isJoined() ? 'SOS could not be sent.' : 'SOS not sent: join a room first (Room chip above the tablet).', 'warn');
  }
  $('btn-sos').addEventListener('click', openSos);
  $('sos-cancel').addEventListener('click', closeSos);
  $('sos-go').addEventListener('click', sendSos);
  sosBack.addEventListener('mousedown', function (e) { if (e.target === sosBack) closeSos(); });
  sosBack.addEventListener('keydown', function (e) {
    if (e.key !== 'Tab') return;
    var f = [$('sos-cancel'), $('sos-go')], i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { f[1].focus(); e.preventDefault(); } else if (!e.shiftKey && i === 1) { f[0].focus(); e.preventDefault(); }
  });
  function onMsg(m) {
    if (!m) return;
    if (m.type === 'ack' && m.sosId && sosSent[m.sosId]) toast('Earth control acknowledged your SOS.', 'info');
    else if (m.type === 'chat') incomingChat(m);
  }

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('obj-back').hidden) return; if (!sosBack.hidden) closeSos(); else if (addOpen) { setAddOpen(false); $('btn-add').focus(); } else {
      var inChat = chatPanel.contains(document.activeElement), inRoute = routePanel.contains(document.activeElement);
      if (!routePanel.hidden && (inRoute || (lastOpened === 'route' && !inChat && !pop.contains(document.activeElement)))) closeRoute();
      else if (!chatPanel.hidden && (inChat || pop.hidden || lastOpened === 'chat')) closeChat(); else if (!pop.hidden) closePop();
    }
  });

  /* ---------- start ---------- */
  var ro = window.ResizeObserver ? new ResizeObserver(function () { resize(); applyLayout(); ensureVisible(0); }) : null;
  if (ro) ro.observe(map); else window.addEventListener('resize', function () { resize(); applyLayout(); ensureVisible(0); });
  var joinedKey = null, offMsg = null;
  function onJoined() {
    var r = link().room; joinedKey = r.code + '|' + r.id;
    loadCrewData(); buildPins(); renderList(); updateProgress(); updateCoords(); publish(); publishLocs(); mountChat(); setGroup(groupBy); watchObjective(); watchRouteOpts(); onObjChange(true); setTimeout(askObjectiveOnce, 1500);
    if (offMsg) { try { offMsg(); } catch (e) { /* ignore */ } offMsg = null; }
    if (link().on) offMsg = link().on(onMsg);
  }
  resize(); loadCrewData(); buildPins(); renderList(); updateProgress(); updateCoords(); updateObjUi(); computePlan(); watchObjective();
  $('grp-stop').addEventListener('click', function () { setGroup('stop'); }); $('grp-objective').addEventListener('click', function () { setGroup('objective'); });
  setGroup(groupBy);
  // mount the room dialog first; nothing is published or sent before the crew member has joined
  try {
    if (window.JdaLinkUI && window.JdaLinkUI.mount) window.JdaLinkUI.mount({ role: 'tablet', ask: ['code', 'crew'], position: 'top-right', onJoin: function () { if (isJoined()) onJoined(); } });
  } catch (e) { if (window.console) console.error('JdaLinkUI.mount failed', e); }
  try { if (window.JdaWorld && window.JdaWorld.on) window.JdaWorld.on(function (w) { lastWorld = w; updateCoords(); refreshWorldDone(); checkEvents(); }); } catch (e) { /* world not ready */ }
  setInterval(function () {
    if (isJoined() && joinedKey !== link().room.code + '|' + link().room.id) onJoined();
    updateCoords(); checkEvents();
  }, 1000);
})();
