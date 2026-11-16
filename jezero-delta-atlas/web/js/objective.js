/* JdaObjective: which mission objective(s) the user wants to fulfil.
   choice: 1 (microbial life), 2 (sustaining human life) or 'both'. null = not chosen yet (no silent default).
   Plain browser JS, no dependencies (uses Atlas.bus / JdaLink when they exist); the pure helpers also work under Node.

   JdaObjective.get(crewId?)          -> 1 | 2 | 'both' | null   (crewId defaults to the current one)
   JdaObjective.set(choice, crewId?)  -> true | false           stores it, publishes it to the room, tells the listeners
   JdaObjective.has(crewId?)          -> true when a choice exists
   JdaObjective.pending()             -> true when the current crew has not chosen yet
   JdaObjective.tasks(mission, crewId?) -> mission.tasks (or an array of {objective}) restricted to the chosen objective(s);
                                          all tasks while nothing is chosen, so a page never shows an empty list (check has())
   JdaObjective.filter(list, choice)  -> same, with an explicit choice (pure)
   JdaObjective.includes(objectiveId, crewId?) -> boolean
   JdaObjective.count(mission, crewId?) -> number of tasks in scope (5 or 10)
   JdaObjective.label(choice) / .short(choice) -> text for the UI
   JdaObjective.crewId()              -> JdaLink.room.id when a room is joined, else 'local'
   JdaObjective.on(fn) -> off()       fn(choice, {crewId, source:'local'|'remote'|'init'}) when the choice of the CURRENT crew changes
   Storage: localStorage 'jda.objective' (no room) or 'jda.objective.<crewId>' as {choice, t}.
   Shared: JdaLink.setState('objective:<crewId>', {choice, t}) when a room is joined; changes from other pages of the same crew are mirrored
   (never echoed back: only a newer t is taken, and only local set() publishes). */
(function (root) {
  'use strict';
  var TITLES = { 1: 'Find evidence of ancient microbial life', 2: 'Assess whether the site can sustain human life', both: 'Both objectives' };
  var SHORT = { 1: 'Objective 1: microbial life', 2: 'Objective 2: sustaining human life', both: 'Both objectives' };

  function norm(c) {
    if (c === 1 || c === '1') return 1;
    if (c === 2 || c === '2') return 2;
    if (c === 'both') return 'both';
    return null;
  }
  function filter(list, choice) {
    var arr = Array.isArray(list) ? list : (list && Array.isArray(list.tasks) ? list.tasks : []);
    var c = norm(choice);
    if (c === null || c === 'both') return arr.slice();
    return arr.filter(function (t) { return t && Number(t.objective) === c; });
  }

  var api = { norm: norm, filter: filter, label: function (c) { c = norm(c); return c === null ? 'Not chosen' : TITLES[c]; }, short: function (c) { c = norm(c); return c === null ? 'Not chosen' : SHORT[c]; } };
  api.TITLES = TITLES;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;   // Node (even with a stub window): pure helpers only

  var mem = {}, subs = [], cur = null, offState = null, watchKey = null, lastPub = {};
  function slug(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32); }
  function link() { var L = root.JdaLink; return L && L.room && !L.room.implicit ? L : null; }   // a real joined room only (never trigger the implicit legacy room)
  function crewId() { var L = link(), id = L ? slug(L.room.id) : ''; return id || 'local'; }
  function skey(id) { return id === 'local' ? 'objective' : 'objective.' + id; }
  function read(id) {
    var raw = null, k = 'jda.' + skey(id);
    try { raw = root.localStorage.getItem(k); } catch (e) { raw = null; }
    var v = null;
    if (raw !== null) { try { v = JSON.parse(raw); } catch (e) { v = null; } }
    else if (Object.prototype.hasOwnProperty.call(mem, k)) v = mem[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && norm(v.choice) !== null) return { choice: norm(v.choice), t: typeof v.t === 'string' ? v.t : '' };
    if (norm(v) !== null) return { choice: norm(v), t: '' };   // a bare value written by hand or by an older version
    return null;
  }
  function write(id, rec) {
    var k = 'jda.' + skey(id); mem[k] = rec;
    try { root.localStorage.setItem(k, JSON.stringify(rec)); } catch (e) { /* ignore */ }
  }
  function tms(s) { var n = Date.parse(s); return isFinite(n) ? n : 0; }
  function emit(id, source) {
    if (id !== crewId()) return;
    var c = api.get(id);
    subs.slice().forEach(function (fn) { try { fn(c, { crewId: id, source: source }); } catch (e) { if (root.console) console.error('JdaObjective listener failed', e); } });
    try { if (root.Atlas && root.Atlas.bus) root.Atlas.bus.emit('objective:changed', { choice: c, crewId: id, source: source }); } catch (e) { /* ignore */ }
  }
  function publish(id, rec) {
    var L = link(); if (!L || !rec) return;
    try { L.setState('objective:' + id, { choice: rec.choice, t: rec.t }); lastPub[id] = rec.t; } catch (e) { /* link not ready */ }
  }

  api.crewId = crewId;
  api.get = function (id) { var r = read(id || crewId()); return r ? r.choice : null; };
  api.has = function (id) { return api.get(id) !== null; };
  api.pending = function () { return !api.has(); };
  api.set = function (choice, id) {
    var c = norm(choice); if (c === null) return false;
    id = id ? slug(id) || 'local' : crewId();
    var before = read(id);
    var rec = { choice: c, t: new Date().toISOString() };
    if (before && before.t && tms(rec.t) <= tms(before.t)) rec.t = new Date(tms(before.t) + 1).toISOString();   // always strictly newer, so it wins
    write(id, rec); publish(id, rec);
    emit(id, 'local');
    return true;
  };
  api.tasks = function (mission, id) { return filter(mission, api.get(id)); };
  api.includes = function (objectiveId, id) { var c = api.get(id); return c === null || c === 'both' || Number(objectiveId) === c; };
  api.count = function (mission, id) { return api.tasks(mission, id).length; };
  api.on = function (fn) {
    if (typeof fn !== 'function') return function () { };
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  };

  /* ---- remote mirror ---- */
  function incoming(id, v, meta) {
    if (!v || typeof v !== 'object') return;
    var c = norm(v.choice); if (c === null) return;
    var t = typeof v.t === 'string' && isFinite(Date.parse(v.t)) ? v.t : new Date(meta && meta.t || Date.now()).toISOString();
    var mine = read(id);
    if (mine && tms(mine.t) >= tms(t)) return;   // not newer: nothing to do, so no echo loop
    write(id, { choice: c, t: t });
    if (!mine || mine.choice !== c) emit(id, 'remote');
  }
  function attach() {
    var L = link(), id = crewId(), key = L ? 'objective:' + id : null;
    if (key === watchKey) return;
    if (offState) { try { offState(); } catch (e) { /* ignore */ } offState = null; }
    watchKey = key;
    if (!L) { var now = read('local'); if (now && now.choice !== cur) { cur = now.choice; emit('local', 'remote'); } return; }
    // a choice made before joining (stored for 'local') carries over to this crew when it has none, and is shared with the room
    var mineHere = read(id), loc = id !== 'local' ? read('local') : null;
    if (!mineHere && loc) { write(id, loc); mineHere = loc; }
    try {
      var cur0 = L.getState(key);
      if (cur0 && cur0.value) incoming(id, cur0.value, cur0);
      mineHere = read(id);
      if (mineHere && (!cur0 || !cur0.value || tms(mineHere.t) > tms(cur0.value.t))) publish(id, mineHere);
      offState = L.onState(key, function (v, meta) { incoming(id, v, meta); });
    } catch (e) { /* link not ready: tried again on the next tick */ watchKey = null; }
    var after = api.get(id);
    if (after !== cur) { cur = after; emit(id, 'init'); }
  }
  cur = api.get();
  try { root.addEventListener('storage', function (e) {   // another tab of this browser changed the stored choice
    if (!e.key || e.key.indexOf('jda.objective') !== 0) return;
    var id = crewId(); if (e.key !== 'jda.' + skey(id)) return;
    var r = read(id); if (r && r.choice !== cur) { cur = r.choice; emit(id, 'remote'); }
    if (r && link()) publish(id, r);
  }); } catch (e) { /* ignore */ }
  api.on(function (c) { cur = c; });
  setInterval(attach, 700);   // a room can be joined (or changed) at any time by link-ui
  attach();
  root.JdaObjective = api;
})(typeof window !== 'undefined' ? window : globalThis);
