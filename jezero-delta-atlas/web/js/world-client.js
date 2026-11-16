/* world-client.js: window.JdaWorld, the only way crew pages read crew data (contract: docs/MULTIPAGE.md).
   Uses the shared 'world' state of JdaLink (published by the control page). If no fresh world arrives for 4 s, it runs a local
   JdaSim for this page's crew so the page never looks dead, and switches back as soon as a world arrives again.
   JdaLink / JdaSim may be missing (the page then simply has no data, or only the local one). */
(function (root) {
  'use strict';
  var STALE_MS = 4000, LOCAL_TICK_MS = 200;
  var DEFAULT_CREW = [{ id: 'jayesh', name: 'Jayesh' }, { id: 'juhyeok', name: 'Juhyeok' }];

  var listeners = [], world = null, lastAuthMs = 0, source = 'local';
  var local = null, localTimer = null, lastLocalMs = 0, meOverride = null, offState = null, offLink = null, lastLinkRoom = null;

  function emit() {
    listeners.slice().forEach(function (fn) { try { fn(world); } catch (e) { if (root.console) console.error('JdaWorld listener failed', e); } });
  }
  function validWorld(w) {
    if (!w || typeof w !== 'object' || w.v !== 1 || !w.crew || typeof w.crew !== 'object' || typeof w.t !== 'string') return false;
    return isFinite(Date.parse(w.t));
  }

  function meId() {
    if (meOverride) return meOverride;
    var L = root.JdaLink;
    if (L && L.room && L.room.id && ['crew', 'helmet', 'tablet'].indexOf(L.room.role) >= 0) return String(L.room.id).toLowerCase();
    try {
      var m = /[?&#]crew=([a-z0-9-]+)/i.exec(root.location.search + root.location.hash);
      if (m) return m[1].toLowerCase();
    } catch (e) { /* no location */ }
    return DEFAULT_CREW[0].id;
  }

  /* ---- local fallback ---- */
  function localCrewList() {
    var id = meId(), list = [];
    var mine = DEFAULT_CREW.filter(function (c) { return c.id === id; })[0] || { id: id, name: id.charAt(0).toUpperCase() + id.slice(1) };
    list.push(mine);
    DEFAULT_CREW.forEach(function (c) { if (c.id !== mine.id) list.push(c); });
    return list;
  }
  function startLocal() {
    if (!root.JdaSim) return;
    if (!local) {
      local = root.JdaSim.create({ crew: localCrewList(), seed: 4242 });
      if (world) local.load(world);   // continue from the last world we saw
    }
    lastLocalMs = Date.now();
    if (!localTimer) localTimer = setInterval(localTick, LOCAL_TICK_MS);
  }
  function stopLocal() {
    if (localTimer) { clearInterval(localTimer); localTimer = null; }
    local = null;   // dropped so a later fallback restarts from the last authority world
  }
  function localTick() {
    var now = Date.now();
    if (now - lastAuthMs < STALE_MS) { stopLocal(); return; }
    source = 'local';
    local.tick(now - lastLocalMs); lastLocalMs = now;
    world = local.world();
    emit();
  }

  function onWorldState(value) {
    if (!validWorld(value)) return;
    world = value;
    if (value.stale) {   // the authority announced it is going away: fall back at once, continuing from this world
      lastAuthMs = 0; source = 'local';
      if (localTimer) stopLocal();
      startLocal(); emit();
      return;
    }
    lastAuthMs = Date.now(); source = 'authority';
    if (localTimer) stopLocal();
    emit();
  }

  /* ---- watchdog: also (re)subscribes once JdaLink has joined a room ---- */
  function watch() {
    var L = root.JdaLink;
    if (L && L.room && lastLinkRoom !== L.room.code && typeof L.onState === 'function') {
      lastLinkRoom = L.room.code;
      if (offState) { try { offState(); } catch (e) { /* ignore */ } }
      offState = L.onState('world', function (v) { onWorldState(v); });
      if (L.getState) { var cur = L.getState('world'); if (cur && cur.value) onWorldState(cur.value); }
    }
    if (Date.now() - lastAuthMs >= STALE_MS && !localTimer) { source = 'local'; startLocal(); }
  }
  setInterval(watch, 500);
  watch();

  root.JdaWorld = {
    get source() { return source; },
    me: function () { var w = world; return (w && w.crew && w.crew[meId()]) || null; },
    crew: function () {
      var w = world; if (!w || !w.crew) return [];
      var id = meId(), out = Object.keys(w.crew).map(function (k) { return w.crew[k]; });
      out.sort(function (a, b) { return (b.id === id) - (a.id === id); });
      return out;
    },
    time: function () { return world ? new Date(world.t) : new Date(); },
    world: function () { return world; },
    id: meId,
    setMe: function (id) {
      meOverride = id ? String(id).toLowerCase() : null;
      if (local && meOverride && local.crewIds().indexOf(meOverride) < 0) local.addCrew({ id: meOverride, name: meOverride.charAt(0).toUpperCase() + meOverride.slice(1) });
    },
    /* hh:mm local mean solar time at the current world time (same value as the control page) */
    localMarsTime: function () {
      var t = this.time();
      if (root.JdaSim && root.JdaSim.localMarsTime) return root.JdaSim.localMarsTime(t);
      return '--:--';
    },
    on: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      if (world) { try { fn(world); } catch (e) { /* ignore */ } }
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    /* Send a simulation command: to the authority when one is live, otherwise to the local engine. */
    command: function (cmd) {
      if (!cmd) return { ok: false, error: 'no command' };
      if (source === 'authority' && root.JdaLink && root.JdaLink.send) {
        root.JdaLink.send({ type: 'cmd', cmd: cmd.cmd, crew: cmd.crew || meId(), to: cmd.to, heading: cmd.heading, path: cmd.path, mps: cmd.mps, n: cmd.n, field: cmd.field, value: cmd.value, solar: cmd.solar, dust: cmd.dust, speed: cmd.speed });
        return { ok: true, sent: true };
      }
      if (local) { var c = {}; for (var k in cmd) c[k] = cmd[k]; if (!c.crew) c.crew = meId(); return local.command(c); }
      return { ok: false, error: 'no simulation available' };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
