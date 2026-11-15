/* Atlas shell: builds window.Atlas (contract in docs/ARCHITECTURE.md).
   Loaded after atlas-map.js (window.AtlasMapCore) and before every feature script.
   Provides: core helpers, store, bus, clock, toast, tabs + dock, layer selector, SOS button and dialog. */
(function () {
  'use strict';
  var core = window.AtlasMapCore;
  if (!core) { throw new Error('atlas-shell.js needs atlas-map.js to be loaded first'); }

  /* ---------- DOM helper (never use innerHTML with data) ---------- */
  var PROPS = { value: 1, checked: 1, selected: 1, disabled: 1, hidden: 1, indeterminate: 1 };
  function h(tag, props, children) {
    var e = document.createElement(tag);
    props = props || {};
    Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v === undefined || v === null || v === false) { if (PROPS[k]) e[k] = false; return; }
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'attrs') Object.keys(v).forEach(function (a) { if (v[a] !== null && v[a] !== undefined) e.setAttribute(a, v[a]); });
      else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS[k]) e[k] = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    if (children !== undefined && children !== null) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        e.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
      });
    }
    return e;
  }

  /* ---------- store (localStorage, prefix "jda.", in-memory fallback) ---------- */
  var mem = {};
  var store = {
    get: function (key, fallback) {
      try {
        var raw = window.localStorage.getItem('jda.' + key);
        if (raw !== null) return JSON.parse(raw);
      } catch (e) { /* blocked or corrupt: fall through */ }
      return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : fallback;
    },
    set: function (key, value) {
      mem[key] = value;
      try { window.localStorage.setItem('jda.' + key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };

  /* ---------- bus ---------- */
  var handlers = {};
  var bus = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    off: function (name, fn) { handlers[name] = (handlers[name] || []).filter(function (f) { return f !== fn; }); },
    emit: function (name, payload) {
      (handlers[name] || []).slice().forEach(function (f) {
        try { f(payload); } catch (e) { if (window.console) console.error('Atlas.bus handler for "' + name + '" failed', e); }
      });
    }
  };

  /* ---------- simulated mission clock ---------- */
  var clk = { speed: 1, realBase: Date.now(), simBase: Date.now() };
  var clock = {
    now: function () { return new Date(clk.simBase + (Date.now() - clk.realBase) * clk.speed); },
    setSpeed: function (n) {
      n = Number(n); if (!isFinite(n) || n <= 0) n = 1;
      clk.simBase = clock.now().getTime(); clk.realBase = Date.now(); clk.speed = n; clock.speed = n;
    },
    speed: 1
  };

  /* ---------- icon set: monochrome line icons (inline SVG, inherit text colour) ---------- */
  var ICONS = {
    map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z M9 4v14 M15 6v14',
    mission: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 11.2a.8.8 0 1 0 0 1.6.8.8 0 0 0 0-1.6z',
    planner: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z M4 10h16 M9 3v4 M15 3v4',
    team: 'M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M3 20c0-3 2.7-5 6-5s6 2 6 5 M17 6.5a2.5 2.5 0 1 1 0 5 M17.5 15c2.2.4 4 2 4 5',
    suit: 'M5 13a7 7 0 0 1 14 0v4a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z M8.5 11.5h7v4h-7z',
    personal: 'M3 12h4l2-6 4 12 2-6h6',
    close: 'M6 6l12 12 M18 6L6 18',
    layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
    chat: 'M4 5h16v11H9l-5 4z',
    check: 'M5 12.5l5 5 9-10',
    sleep: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    meal: 'M7 3v8 M4.5 3v5a2.5 2.5 0 0 0 5 0V3 M7 11v10 M17 3c-2.2 2-2.2 6.5 0 8.5V21',
    recreation: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M12 7v5l3 2',
    task: 'M7 4h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M9.5 9h5 M9.5 13h5 M9.5 17h3',
    health: 'M3 12h4l2-6 4 12 2-6h6',
    flag: 'M5 21V4 M5 4h12l-2.5 4L17 12H5',
    warn: 'M12 3l10 18H2z M12 10v5 M12 18v.5',
    critical: 'M8 3h8l5 5v8l-5 5H8l-5-5V8z M12 8v5 M12 16v.5',
    star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'
  };
  function icon(name, size) {
    var d = ICONS[name]; if (!d) return null;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', size || 18); svg.setAttribute('height', size || 18);
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false'); svg.setAttribute('class', 'icon icon-' + name);
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.appendChild(path);
    return svg;
  }

  /* ---------- Atlas object ---------- */
  var Atlas = window.Atlas = {
    W: core.W, H: core.H,
    ll: core.ll, xy: core.xy, el: core.el, h: h, icon: icon,
    setInfo: core.setInfo,   // also opens the Map tab through core.onInfo (set below)
    focus: core.focus,
    mapData: core.mapData, store: store, bus: bus, clock: clock, now: clock.now
  };

  // The landing site lies just east of this map (see the note in atlas-map.js), so for the start position of the
  // user we take the nearest point on the map, 24 px inside the edge. Atlas.landing keeps the true page point.
  Atlas.landing = { x: core.landing[0], y: core.landing[1], onMap: core.landing[0] >= 0 && core.landing[0] <= core.W && core.landing[1] >= 0 && core.landing[1] <= core.H };
  Atlas.me = {
    x: Math.min(core.W - 24, Math.max(24, core.landing[0])),
    y: Math.min(core.H - 24, Math.max(24, core.landing[1]))
  };

  /* map clicks that were not drags */
  var clickFns = [];
  var swallow = false;   // true for the instant after a pick consumed a click, so the pin under the cursor does not also fire
  core.busy = function () { return !!activePick || swallow; };
  core.onClick = function (ev) {
    if (activePick) {
      var p = activePick; activePick = null; swallow = true; setTimeout(function () { swallow = false; }, 0);
      pickUI();
      try { p.fn(ev); } catch (e) { console.error(e); }
      return;
    }
    clickFns.slice().forEach(function (f) { try { f(ev); } catch (e) { console.error(e); } });
  };
  Atlas.onMapClick = function (fn) {
    clickFns.push(fn);
    return function () { clickFns = clickFns.filter(function (f) { return f !== fn; }); };
  };

  /* ---------- exclusive map picking ---------- */
  // Atlas.pick({owner,label,onCancel}, fn): the next non-drag map click goes ONLY to fn(ev). Pin/crater clicks do nothing
  // while a pick is active (core.busy), so a pick never opens other UI.
  var activePick = null, pickBar;
  function pickUI() {
    var o = activePick ? activePick.owner : null;
    core.map.classList.toggle('picking', !!o);
    if (pickBar) {
      pickBar.hidden = !o;
      if (o) pickBar.querySelector('.pk-t').textContent = 'Click the map: ' + (activePick.label || o) + ' (Esc cancels)';
    }
    bus.emit('pick:changed', { owner: o });
  }
  function cancelPick(owner) {
    var p = activePick;
    if (!p || (owner && p.owner !== owner)) return;
    activePick = null; pickUI();
    if (p.onCancel) { try { p.onCancel(); } catch (e) { console.error(e); } }
  }
  Atlas.pick = function (opts, fn) {
    opts = opts || {};
    if (typeof fn !== 'function') throw new Error('Atlas.pick needs a callback');
    var prev = activePick;
    activePick = null;
    if (prev && prev.onCancel) { try { prev.onCancel(); } catch (e) { console.error(e); } }
    var me = activePick = { owner: opts.owner || 'unknown', label: opts.label, onCancel: opts.onCancel, fn: fn };
    pickUI();
    return function () { if (activePick === me) cancelPick(); };
  };
  Atlas.pick.cancel = cancelPick;
  Atlas.pick.busy = core.busy;
  Atlas.picking = function () { return activePick ? activePick.owner : null; };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && activePick && (!sosBack || sosBack.hidden)) { e.preventDefault(); cancelPick(); }
  });

  /* ---------- toast ---------- */
  var toasts = h('div', { id: 'toasts', class: 'ui', attrs: { role: 'status', 'aria-live': 'polite' } });
  Atlas.toast = function (text, level) {
    var t = h('div', { class: 'toast ' + (level === 'warn' || level === 'danger' ? level : 'info'), text: String(text) });
    if (level === 'danger') t.setAttribute('role', 'alert');
    toasts.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, level === 'danger' ? 7000 : 4500);
  };

  /* ---------- tabs and dock ---------- */
  var dock = h('div', { id: 'dock', class: 'ui', attrs: { role: 'toolbar', 'aria-label': 'Tabs' } });
  var panelsEl = h('div', { id: 'panels', class: 'ui' });
  var tabs = {};                                  // id -> {def, btn, panel, body, rendered}
  var openState = store.get('tabs.open', null);   // {id: bool}; null on the very first visit
  var firstVisit = openState === null;
  if (firstVisit) openState = {};
  var phone = window.matchMedia ? window.matchMedia('(max-width:640px)') : { matches: false };

  var sosBtn;   // created below; kept right after the Mission tab button

  function layoutDock() {
    var list = Object.keys(tabs).map(function (k) { return tabs[k]; })
      .sort(function (a, b) { return (a.def.order || 0) - (b.def.order || 0); });
    list.forEach(function (t) { dock.appendChild(t.btn); panelsEl.appendChild(t.panel); });
    // SOS sits right beside the Mission tab; with no Mission tab (yet) it leads the dock
    if (sosBtn) {
      var m = tabs.mission;
      if (m && m.btn.parentNode === dock) dock.insertBefore(sosBtn, m.btn.nextSibling);
      else dock.insertBefore(sosBtn, dock.firstChild);
    }
  }

  function openTab(id, open) {
    var t = tabs[id]; if (!t) return;
    if (open === undefined) open = t.panel.hidden;
    if (open && phone.matches) Object.keys(tabs).forEach(function (k) { if (k !== id) setOpen(k, false); });
    setOpen(id, open);
  }
  function setOpen(id, open) {
    var t = tabs[id]; if (!t) return;
    open = !!open;
    if (open && !t.rendered) {
      t.rendered = true;
      try { t.def.render(t.body); }
      catch (e) { console.error('Tab "' + id + '" failed to render', e); t.body.appendChild(h('p', { text: 'This tab failed to load.' })); }
    }
    t.panel.hidden = !open;
    t.btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    openState[id] = open;
    store.set('tabs.open', openState);
    bus.emit('tab:toggled', { id: id, open: open });
  }

  Atlas.openTab = function (id, open) { openTab(id, open); };
  Atlas.closeTab = function (id) { openTab(id, false); };
  Atlas.registerTab = function (def) {
    if (!def || !def.id || typeof def.render !== 'function') throw new Error('registerTab needs {id, title, render}');
    if (tabs[def.id]) return;
    var body = h('div', { class: 'tp-body' });
    var panel = h('section', { class: 'tabpanel', hidden: true, attrs: { 'aria-labelledby': 'tp-h-' + def.id, 'data-tab': def.id } }, [
      h('div', { class: 'tp-head' }, [
        h('h2', { id: 'tp-h-' + def.id, text: def.title }),
        h('button', { type: 'button', class: 'tp-x', attrs: { 'aria-label': 'Hide ' + def.title + ' tab' }, onclick: function () { setOpen(def.id, false); btn.focus(); } }, [icon('close', 14)])
      ]),
      body
    ]);
    panel.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !e.defaultPrevented) { setOpen(def.id, false); btn.focus(); } });
    var btn = h('button', { type: 'button', class: 'dock-tab', attrs: { 'aria-pressed': 'false', 'aria-label': def.title + ' tab' }, onclick: function () { openTab(def.id); } }, [
      h('span', { class: 'ic', attrs: { 'aria-hidden': 'true' } }, [icon(def.icon, 18) || (def.icon || '')]),
      h('span', { class: 'tt', text: def.title })
    ]);
    tabs[def.id] = { def: def, btn: btn, panel: panel, body: body, rendered: false };
    layoutDock();
    var want = Object.prototype.hasOwnProperty.call(openState, def.id) ? openState[def.id] : (firstVisit && def.id === 'map' && !phone.matches);
    if (want) setOpen(def.id, true);
  };

  /* ---------- layers ---------- */
  var layerStore = store.get('layers', {});       // {id: {on, opacity}}
  var layers = {};                                // id -> {def, raster, cb, op}
  var groupOrder = [];
  var stage = core.stage, ov = document.getElementById('ov');
  var lsMenu, lsBody;

  function saveLayers() {
    var o = store.get('layers', {}); if (!o || typeof o !== 'object') o = {};
    Object.keys(layers).forEach(function (id) { o[id] = { on: layers[id].on, opacity: layers[id].opacity }; });
    store.set('layers', o);
  }
  function applyLayer(L) {
    var node = L.raster ? L.def.canvas : L.def.node;
    if (node) node.style.display = L.on ? '' : 'none';
    if (L.raster && node) node.style.opacity = L.opacity;
    if (L.cb) L.cb.checked = L.on;
    if (L.slider) { L.slider.value = Math.round(L.opacity * 100); L.slider.disabled = !L.on; }
  }
  function addLayer(def, raster) {
    if (!def || !def.id) throw new Error('layer needs an id');
    if (layers[def.id]) return;
    var saved = layerStore[def.id] || {};
    var L = layers[def.id] = {
      def: def, raster: raster,
      on: saved.on !== undefined ? !!saved.on : !!def.on,
      opacity: saved.opacity !== undefined ? saved.opacity : (def.opacity !== undefined ? def.opacity : 0.7)
    };
    if (raster) {
      var c = def.canvas;
      c.classList.add('rl'); c.setAttribute('data-layer', def.id);
      c.setAttribute('aria-hidden', 'true');
      c.style.cssText += ';position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;-webkit-user-drag:none';
      stage.insertBefore(c, ov);                   // registration order: later layers draw above earlier ones, all below the SVG marks
    }
    var g = def.group || 'Other';
    if (groupOrder.indexOf(g) < 0) groupOrder.push(g);
    renderLayerMenu();
    applyLayer(L);
    bus.emit('layer:changed', { id: def.id, on: L.on, opacity: L.opacity });
  }
  Atlas.registerLayer = function (def) { addLayer(def, false); };
  Atlas.registerRasterLayer = function (def) { addLayer(def, true); };
  Atlas.layers = {
    setOn: function (id, on) {
      var L = layers[id]; if (!L) return; L.on = !!on; applyLayer(L); saveLayers();
      bus.emit('layer:changed', { id: id, on: L.on, opacity: L.opacity });
    },
    isOn: function (id) { return !!(layers[id] && layers[id].on); },
    setOpacity: function (id, v) {
      var L = layers[id]; if (!L) return; v = Math.min(1, Math.max(0, Number(v)));
      if (!isFinite(v)) return; L.opacity = v; applyLayer(L); saveLayers();
      bus.emit('layer:changed', { id: id, on: L.on, opacity: L.opacity });
    }
  };

  function renderLayerMenu() {
    if (!lsBody) return;
    while (lsBody.firstChild) lsBody.removeChild(lsBody.firstChild);
    groupOrder.forEach(function (g) {
      lsBody.appendChild(h('h4', { text: g }));
      Object.keys(layers).forEach(function (id) {
        var L = layers[id]; if ((L.def.group || 'Other') !== g) return;
        var dot = h('span', { class: 'dot' }); dot.style.borderColor = L.def.color || '#999';
        L.cb = h('input', { type: 'checkbox', checked: L.on, onchange: function () { Atlas.layers.setOn(id, L.cb.checked); } });
        var row = h('div', { class: 'ls-row' }, [
          h('label', { class: 'ls-chk' }, [L.cb, h('span', { class: 'box' }), dot, h('span', { text: L.def.label || id }),
            h('span', { class: 'n', text: L.def.count !== undefined && L.def.count !== null ? String(L.def.count) : '' })])
        ]);
        if (L.raster) {
          L.slider = h('input', { type: 'range', min: 0, max: 100, step: 1, attrs: { 'aria-label': 'Opacity of ' + (L.def.label || id) }, oninput: function () { Atlas.layers.setOpacity(id, L.slider.value / 100); } });
          row.appendChild(h('div', { class: 'ls-op' }, [h('span', { text: 'Opacity' }), L.slider]));
        }
        lsBody.appendChild(row);
        applyLayer(L);
      });
    });
  }

  function buildLayerSelector() {
    lsBody = h('div');
    var btn = h('button', { type: 'button', class: 'ls-btn', attrs: { 'aria-expanded': 'false', 'aria-controls': 'ls-menu' }, onclick: function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false'); lsMenu.hidden = !open; store.set('layers.open', open);
    } }, [h('span', { attrs: { 'aria-hidden': 'true' } }, [icon('layers', 16)]), 'Layers']);
    lsMenu = h('div', { id: 'ls-menu', class: 'ls-menu', hidden: true, attrs: { role: 'group', 'aria-label': 'Map layers' } }, lsBody);
    lsMenu.addEventListener('keydown', function (e) { if (e.key === 'Escape') { lsMenu.hidden = true; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    var wrap = h('div', { id: 'layersel', class: 'ui' }, [lsMenu, btn]);
    document.body.appendChild(wrap);
    if (store.get('layers.open', false)) { lsMenu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  }

  /* ---------- SOS ---------- */
  var sosBack, sosPrev;
  function sosPayload() {
    var ll = Atlas.ll(Atlas.me.x, Atlas.me.y);
    return { time: Atlas.now().toISOString(), x: Atlas.me.x, y: Atlas.me.y, lat: ll[1], lon: ll[0] };
  }
  function focusables() {
    return Array.prototype.slice.call(sosBack.querySelectorAll('button:not([disabled])'));
  }
  function closeSos() {
    sosBack.hidden = true;
    document.removeEventListener('keydown', sosKey, true);
    if (sosPrev && sosPrev.focus) sosPrev.focus();
  }
  function sosKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSos(); return; }
    if (e.key === 'Tab') {
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !sosBack.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !sosBack.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }
  function openSos() {
    var p = sosPayload();
    sosPrev = document.activeElement;
    sosBack.querySelector('.sos-pos').textContent = 'Your position (simulated): ' + p.lat.toFixed(4) + '°N, ' + p.lon.toFixed(4) + '°E';
    sosBack.hidden = false;
    document.addEventListener('keydown', sosKey, true);
    sosBack.querySelector('.sos-cancel').focus();   // safe default: Cancel
  }
  function sendSos() {
    var p = sosPayload();
    var log = store.get('sos.log', []); if (!Array.isArray(log)) log = [];
    log.push(p); store.set('sos.log', log.slice(-50));
    bus.emit('sos:send', p);
    sosPrev = sosBtn;
    closeSos();
    Atlas.toast('SOS sent to Earth (simulated)', 'danger');
  }
  function buildSos() {
    sosBtn = h('button', { type: 'button', class: 'sos-btn', text: 'SOS', attrs: { 'aria-label': 'SOS emergency button, opens a confirmation', 'aria-haspopup': 'dialog' }, onclick: openSos });
    sosBack = h('div', { id: 'sos-back', class: 'ui', hidden: true }, [
      h('div', { class: 'sos-dlg', attrs: { role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'sos-t', 'aria-describedby': 'sos-d' } }, [
        h('h2', { id: 'sos-t', text: 'Send SOS?' }),
        h('p', { id: 'sos-d', text: 'This sends an emergency call with your position to Earth. This is a simulation: nothing real is transmitted.' }),
        h('p', { class: 'sos-pos' }),
        h('div', { class: 'sos-act' }, [
          h('button', { type: 'button', class: 'sos-cancel', text: 'Cancel', onclick: closeSos }),
          h('button', { type: 'button', class: 'sos-go', text: 'Send SOS', onclick: sendSos })
        ])
      ])
    ]);
    sosBack.addEventListener('mousedown', function (e) { if (e.target === sosBack) closeSos(); });
    document.body.appendChild(sosBack);
  }

  /* ---------- mount ---------- */
  buildSos();
  document.body.appendChild(dock);
  document.body.appendChild(panelsEl);
  document.body.appendChild(toasts);
  pickBar = h('div', { id: 'pickbar', class: 'ui', hidden: true, attrs: { role: 'status' } }, [
    h('span', { class: 'pk-t' }),
    h('button', { type: 'button', text: 'Cancel', onclick: function () { cancelPick(); } })
  ]);
  document.body.appendChild(pickBar);
  buildLayerSelector();
  layoutDock();

  // layers of atlas-map.js (craters, delta, channel, route, samples, places, grid)
  core.layers.forEach(function (l) { Atlas.registerLayer(l); });

  // Map tab: route planner, selected card, sample list. atlas-map.js bound to their ids at load time, so we move the nodes.
  Atlas.registerTab({
    id: 'map', title: 'Map', icon: 'map', order: 5,
    render: function (container) {
      var src = document.getElementById('map-tab-src');
      while (src.firstChild) container.appendChild(src.firstChild);
      if (src.parentNode) src.parentNode.removeChild(src);
    }
  });
  core.onInfo = function () { var t = tabs.map; if (t && t.panel.hidden) openTab('map', true); };
})();
