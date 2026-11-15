/* Planner tab: your own to-do list, mission objectives (read-only), automatic schedule, reminders, simulated link to Earth.
   Owned by the planner feature (contract: docs/ARCHITECTURE.md). Numbers: web/data/schedule-config.js, explained in docs/SCHEDULE.md.
   Exposes Atlas.todos and Atlas.schedule. Pure scheduling logic lives in schedule-engine.js. */
(function () {
  'use strict';
  var Atlas = window.Atlas, E = window.ScheduleEngine;
  if (!Atlas || !E) { if (window.console) console.error('planner.js needs atlas-shell.js and schedule-engine.js'); return; }
  var h = Atlas.h, MIN = 60000;
  var CFG = E.normalizeConfig(window.JEZERO_SCHEDULE_CONFIG);
  var RAW = window.JEZERO_SCHEDULE_CONFIG || {};

  /* ---------------- persisted state ---------------- */
  var todos = arr(Atlas.store.get('planner.todos', []));
  var missionDone = obj(Atlas.store.get('planner.missionDone', {}));
  var outbox = arr(Atlas.store.get('planner.outbox', []));
  var S = obj(Atlas.store.get('planner.sched', {}));
  S.blocks = arr(S.blocks); S.unsched = arr(S.unsched); S.reasons = arr(S.reasons);
  S.blockDone = obj(S.blockDone); S.missedLog = arr(S.missedLog); S.reminded = obj(S.reminded);
  S.started = obj(S.started); S.misses = S.misses || 0; S.builtAt = S.builtAt || null;

  function arr(v) { return Array.isArray(v) ? v : []; }
  function obj(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  function nowMs() { return Atlas.now().getTime(); }
  function saveTodos() { Atlas.store.set('planner.todos', todos); }
  function saveS() { Atlas.store.set('planner.sched', S); }
  function ms(iso) { var t = new Date(iso).getTime(); return isFinite(t) ? t : null; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function hhmm(t) { var d = new Date(t); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function when(t) { return E.fmt(t); }
  function dur(minutes) {
    minutes = Math.round(minutes);
    if (minutes < 60) return minutes + ' min';
    var hrs = Math.floor(minutes / 60), m = minutes % 60;
    if (hrs >= 48) return Math.round(hrs / 24) + ' days';
    return hrs + ' h' + (m ? ' ' + m + ' min' : '');
  }
  function toLocalInput(iso) {
    var t = ms(iso); if (t === null) return '';
    var d = new Date(t);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function uid() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

  /* ---------------- validation ---------------- */
  function validate(input, opts) {
    opts = opts || {};
    input = input || {};
    var errors = {}, v = {};
    var title = String(input.title === undefined || input.title === null ? '' : input.title).trim();
    if (!title) errors.title = 'Give the goal a title.';
    else if (title.length > 80) errors.title = 'Title is too long (80 characters at most).';
    v.title = title;
    var desc = String(input.description === undefined || input.description === null ? '' : input.description).trim();
    if (desc.length > 500) errors.description = 'Description is too long (500 characters at most).';
    v.description = desc;
    var imp = Number(input.importance === undefined || input.importance === '' ? 3 : input.importance);
    if (!isFinite(imp) || Math.floor(imp) !== imp || imp < 1 || imp > 5) errors.importance = 'Importance must be a whole number from 1 to 5.';
    v.importance = imp;
    var est = Number(input.estMin === undefined || input.estMin === '' ? CFG.work.defaultTaskMinutes : input.estMin);
    if (!isFinite(est) || Math.floor(est) !== est || est < 5 || est > 1440) errors.estMin = 'Estimated time must be a whole number of minutes from 5 to 1440.';
    v.estMin = est;
    var dl = input.deadline;
    if (dl === undefined || dl === null || dl === '') v.deadline = null;
    else {
      var t = new Date(dl).getTime();
      if (!isFinite(t)) errors.deadline = 'That deadline is not a valid date and time.';
      else if (t > nowMs() + 366 * 86400000) errors.deadline = 'Deadline is more than a year away.';
      else if (t <= nowMs() && !(opts.keepDeadline && opts.keepDeadline === new Date(t).toISOString())) errors.deadline = 'Deadline is in the past. Pick a time that has not happened yet.';
      v.deadline = isFinite(t) ? new Date(t).toISOString() : null;
    }
    return { ok: Object.keys(errors).length === 0, errors: errors, value: v };
  }

  /* ---------------- Atlas.todos ---------------- */
  function findTodo(id) { for (var i = 0; i < todos.length; i++) if (todos[i].id === id) return todos[i]; return null; }
  function userItem(t) {
    return { id: t.id, title: t.title, description: t.description, deadline: t.deadline, importance: t.importance, estMin: t.estMin, done: !!t.done, missionId: null, kind: 'task' };
  }
  function objectives() {
    var l = [];
    try { if (Atlas.missions && Atlas.missions.list) l = arr(Atlas.missions.list()).filter(function (m) { return m && m.kind === 'objective'; }); } catch (e) { l = []; }
    return l;
  }
  function nextHealthBlock() {
    var best = null;
    S.blocks.forEach(function (b) { if (b.type === 'health' && !S.blockDone[b.id] && (!best || ms(b.start) < ms(best.start))) best = b; });
    return best;
  }
  function healthItem() {
    var b = nextHealthBlock(); if (!b) return null;
    return { id: 'health-next', title: 'Health check', description: 'Scheduled health check (simulated sensors).', deadline: b.start, importance: 5, estMin: Math.round((ms(b.end) - ms(b.start)) / MIN), done: false, missionId: null, kind: 'health', blockId: b.id };
  }
  function missionItems() {
    return objectives().map(function (m) {
      return { id: 'mission:' + m.id, title: m.title, description: m.description || '', deadline: null, importance: CFG.work.missionObjectiveImportance, estMin: CFG.work.missionObjectiveMinutes,
        done: !!missionDone[m.id], missionId: m.id, kind: 'mission' };
    });
  }
  function sortTodos(list) {
    return list.slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      var da = a.deadline ? ms(a.deadline) : Infinity, db = b.deadline ? ms(b.deadline) : Infinity;
      if (da !== db) return da < db ? -1 : 1;
      if (a.importance !== b.importance) return b.importance - a.importance;
      return a.title < b.title ? -1 : 1;
    });
  }
  var todosApi = Atlas.todos = {
    list: function () {
      var l = sortTodos(todos.map(userItem)), hi = healthItem();
      return (hi ? [hi] : []).concat(l, missionItems());
    },
    validate: validate,
    add: function (input) {
      var r = validate(input); if (!r.ok) return r;
      var t = { id: uid(), title: r.value.title, description: r.value.description, deadline: r.value.deadline, importance: r.value.importance, estMin: r.value.estMin, done: false, created: Atlas.now().toISOString() };
      todos.push(t); saveTodos(); changed(); r.todo = userItem(t); return r;
    },
    update: function (id, patch) {
      var t = findTodo(id); if (!t) return { ok: false, errors: { id: 'No such goal.' } };
      var merged = { title: t.title, description: t.description, deadline: t.deadline, importance: t.importance, estMin: t.estMin };
      Object.keys(patch || {}).forEach(function (k) { if (k in merged) merged[k] = patch[k]; });
      var r = validate(merged, { keepDeadline: t.deadline }); if (!r.ok) return r;
      t.title = r.value.title; t.description = r.value.description; t.deadline = r.value.deadline; t.importance = r.value.importance; t.estMin = r.value.estMin;
      saveTodos(); changed(); r.todo = userItem(t); return r;
    },
    remove: function (id) {
      var n = todos.length; todos = todos.filter(function (t) { return t.id !== id; });
      if (todos.length === n) return false;
      saveTodos(); changed(); return true;
    },
    complete: function (id, done) {
      done = done === undefined ? true : !!done;
      if (id === 'health-next') { var hb = nextHealthBlock(); if (hb && done) scheduleApi.markDone(hb.id, true); return !!hb; }
      if (String(id).indexOf('mission:') === 0) { var mid = String(id).slice(8); if (done) missionDone[mid] = true; else delete missionDone[mid]; Atlas.store.set('planner.missionDone', missionDone); changed(); return true; }
      var t = findTodo(id); if (!t) return false;
      t.done = done; saveTodos(); changed(); return true;
    }
  };

  /* ---------------- schedule state ---------------- */
  function doneMinutes(excludeIds) {
    var m = {};
    Object.keys(S.blockDone).forEach(function (id) {
      var d = S.blockDone[id]; if (!d || (d.type !== 'task' && d.type !== 'mission')) return;
      m[d.type + ':' + d.refId] = (m[d.type + ':' + d.refId] || 0) + d.min;
    });
    inflight(excludeIds).forEach(function (b) { var k = b.type + ':' + b.refId; m[k] = (m[k] || 0) + (ms(b.end) - ms(b.start)) / MIN; });
    return m;
  }
  /* work blocks that have started and are not ticked yet but are not missed yet: they keep their place and count as in progress */
  function inflight(excludeIds) {
    var n = nowMs(), g = CFG.graceMinutes * MIN;
    return S.blocks.filter(function (b) {
      return (b.type === 'task' || b.type === 'mission') && !S.blockDone[b.id] && ms(b.start) <= n && ms(b.end) + g > n && !(excludeIds && excludeIds.indexOf(b.id) >= 0);
    });
  }
  function busyList(excludeIds) {
    var out = [], n = nowMs();
    Object.keys(S.blockDone).forEach(function (id) { var d = S.blockDone[id]; if (d && (d.type === 'task' || d.type === 'mission') && ms(d.end) > n) out.push({ start: d.start, end: d.end }); });
    inflight(excludeIds).forEach(function (b) { out.push({ start: b.start, end: b.end }); });
    return out;
  }
  function engineInputs() {
    var td = todos.filter(function (t) { return !t.done; }).map(userItem);
    var ob = objectives().filter(function (m) { return !missionDone[m.id]; });
    return { todos: td, objectives: ob };
  }
  function keepDoneBlocks(list, n) {
    /* ticked work blocks stay visible today (the engine only plans the future) */
    var start = E.dayStart(RAW, n, 0), shown = list.slice();
    Object.keys(S.blockDone).forEach(function (id) {
      var d = S.blockDone[id];
      if (d && (d.type === 'task' || d.type === 'mission') && ms(d.end) > start && !shown.some(function (b) { return b.id === id; }))
        shown.push({ id: id, start: d.start, end: d.end, type: d.type, title: d.title, refId: d.refId });
    });
    return shown.sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : (a.id < b.id ? -1 : 1); });
  }
  function pruneDone(n) {
    var cut = E.dayStart(RAW, n, -2);
    Object.keys(S.blockDone).forEach(function (id) { if (ms(S.blockDone[id].end) < cut) delete S.blockDone[id]; });
    Object.keys(S.reminded).forEach(function (id) { if (!S.blocks.some(function (b) { return b.id === id; })) { delete S.reminded[id]; delete S.started[id]; } });
  }
  function setResult(res, extraReasons, n) {
    var kept = res.__inflight || [];
    var list = res.blocks.slice();
    kept.forEach(function (b) { if (!list.some(function (x) { return x.id === b.id; })) list.push(b); });
    S.blocks = keepDoneBlocks(list, n);
    S.unsched = res.unschedulable.map(function (u) { return { id: u.todo && u.todo.id, title: u.todo && u.todo.title, reason: u.reason }; });
    S.builtAt = new Date(n).toISOString();
    if (extraReasons && extraReasons.length) {
      extraReasons.forEach(function (r) { S.reasons.unshift({ at: new Date(n).toISOString(), text: r }); });
      S.reasons = S.reasons.slice(0, 40);
    }
    pruneDone(n); saveS();
  }

  function rebuild(why) {
    var n = nowMs(), inp = engineInputs();
    var keep = inflight();                                    // taken before the schedule is replaced
    var res = E.buildSchedule(RAW, inp.todos, inp.objectives, n, { done: doneMinutes(), busy: busyList() });
    res.__inflight = keep;
    setResult(res, why ? [why] : [], n);
    Atlas.bus.emit('schedule:changed', { reason: why || 'rebuild' });
    return S.blocks;
  }
  function adapt(missedIds) {
    var n = nowMs(), inp = engineInputs();
    var keep = inflight(missedIds);
    var res = E.reschedule(RAW, { todos: inp.todos, objectives: inp.objectives, blocks: S.blocks.filter(function (b) { return !S.blockDone[b.id]; }), missed: missedIds, done: doneMinutes(missedIds), busy: busyList(missedIds) }, n);
    res.__inflight = keep;
    setResult(res, res.reasons, n);
    Atlas.bus.emit('schedule:changed', { reason: 'missed', missed: missedIds });
  }
  function changed() {
    Atlas.bus.emit('todos:changed', {});
    rebuild();
  }

  var scheduleApi = Atlas.schedule = {
    get: function () {
      return S.blocks.map(function (b) { return { id: b.id, start: b.start, end: b.end, type: b.type, title: b.title, refId: b.refId, done: !!S.blockDone[b.id] }; });
    },
    rebuild: function () { return rebuild('Schedule rebuilt by you.'); },
    unschedulable: function () { return S.unsched.slice(); },
    reasons: function () { return S.reasons.slice(); },
    outbox: function () { return outbox.slice(); },
    config: function () { return JSON.parse(JSON.stringify(RAW)); },
    checkNow: function () { return check(); },
    missesSinceReport: function () { return S.misses; },
    markDone: function (id, done) {
      var b = null; S.blocks.forEach(function (x) { if (x.id === id) b = x; });
      if (!b) return false;
      done = done !== false;
      if (done) {
        if (S.blockDone[id]) return true;
        S.blockDone[id] = { type: b.type, refId: b.refId, start: b.start, end: b.end, title: b.title, min: Math.round((ms(b.end) - ms(b.start)) / MIN) };
        if (b.type === 'health') runHealth();
        if (b.type === 'task' || b.type === 'mission') autoFinish(b);
      } else {
        delete S.blockDone[id];
        if (b.type === 'task' || b.type === 'mission') autoReopen(b);
      }
      saveS(); Atlas.bus.emit('schedule:changed', { reason: 'done' }); return true;
    }
  };
  function remainingFor(type, refId) {
    var est = 0, found = false;
    if (type === 'task') { var t = findTodo(refId); if (t) { est = t.estMin; found = true; } }
    else { objectives().forEach(function (m) { if (String(m.id) === String(refId)) { est = CFG.work.missionObjectiveMinutes; found = true; } }); }
    if (!found) return null;
    var done = 0; Object.keys(S.blockDone).forEach(function (id) { var d = S.blockDone[id]; if (d.type === type && String(d.refId) === String(refId)) done += d.min; });
    return est - done;
  }
  function autoFinish(b) {
    var rem = remainingFor(b.type, b.refId);
    if (rem !== null && rem <= 0) {
      if (b.type === 'task') { var t = findTodo(b.refId); if (t) { t.done = true; saveTodos(); } }
      else { missionDone[b.refId] = true; Atlas.store.set('planner.missionDone', missionDone); }
      Atlas.bus.emit('todos:changed', {});
      S.blocks = S.blocks.filter(function (x) { return x.refId !== b.refId || x.type !== b.type || S.blockDone[x.id]; });
    }
  }
  function autoReopen(b) {
    var rem = remainingFor(b.type, b.refId);
    if (rem !== null && rem > 0) {
      if (b.type === 'task') { var t = findTodo(b.refId); if (t && t.done) { t.done = false; saveTodos(); rebuild('Re-opened "' + t.title + '".'); } }
      else if (missionDone[b.refId]) { delete missionDone[b.refId]; Atlas.store.set('planner.missionDone', missionDone); rebuild('Re-opened a mission objective.'); }
    }
  }
  var healthGuard = false;
  function runHealth() {
    if (!Atlas.health || typeof Atlas.health.run !== 'function') return;
    healthGuard = true;
    try { Atlas.health.run(); } catch (e) { if (window.console) console.error('Atlas.health.run failed', e); }
    healthGuard = false;
  }
  Atlas.bus.on('health:done', function () {
    if (healthGuard) return;
    var n = nowMs(), best = null;
    S.blocks.forEach(function (b) { if (b.type === 'health' && !S.blockDone[b.id] && ms(b.start) <= n + 30 * MIN && (!best || ms(b.start) < ms(best.start))) best = b; });
    if (best) { S.blockDone[best.id] = { type: 'health', refId: 'health', start: best.start, end: best.end, title: best.title, min: 0 }; saveS(); Atlas.bus.emit('schedule:changed', { reason: 'health' }); }
  });
  Atlas.bus.on('missions:changed', function () { rebuild(); });

  /* ---------------- monitor: reminders, misses, adaptation, report to Earth ---------------- */
  var lastCheck = 0, lastSig = '';
  var MONITORED = { task: 1, mission: 1, health: 1 };
  function check(onLoad) {
    var n = nowMs(), g = CFG.graceMinutes * MIN, newly = [];
    lastCheck = n;
    S.blocks.forEach(function (b) {
      if (!MONITORED[b.type] || S.blockDone[b.id]) return;
      var s = ms(b.start), e = ms(b.end);
      if (!onLoad && CFG.remindAtStart && n >= s && n < e && !S.started[b.id]) {
        S.started[b.id] = true; Atlas.toast('Now: ' + b.title + ' (until ' + hhmm(e) + '). Tick it done when finished.', 'info');
      }
      if (n >= e) {
        var offs = CFG.reminderAfterEndMinutes, idx = S.reminded[b.id] === undefined ? 0 : S.reminded[b.id];
        while (!onLoad && idx < offs.length && n >= e + offs[idx] * MIN && offs[idx] * MIN < g) {
          var last = idx === offs.length - 1;
          Atlas.toast('Reminder ' + (idx + 1) + ': "' + b.title + '" was due at ' + hhmm(e) + ' and is not marked done. It will be rescheduled in ' + Math.max(1, Math.round((e + g - n) / MIN)) + ' min.', last && idx > 0 ? 'danger' : 'warn');
          idx++;
        }
        S.reminded[b.id] = idx;
        if (n >= e + g) newly.push(b);
      }
    });
    if (newly.length) {
      var all = newly.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      var counted = onLoad ? all.slice(0, CFG.escalateAfterMisses) : all;   // after a long absence count at most one report's worth
      counted.forEach(function (b) {
        S.misses++; S.missedLog.push({ id: b.id, title: b.title, type: b.type, planned: b.start, at: new Date(n).toISOString() });
        Atlas.bus.emit('schedule:missed', { block: { id: b.id, start: b.start, end: b.end, type: b.type, title: b.title, refId: b.refId } });
      });
      S.missedLog = S.missedLog.slice(-50);
      if (onLoad) Atlas.toast('While the page was closed ' + all.length + ' scheduled block' + (all.length > 1 ? 's were' : ' was') + ' not marked done; ' + counted.length + ' counted as missed. The schedule was adapted.', 'warn');
      else Atlas.toast(newly.length + ' scheduled block' + (newly.length > 1 ? 's' : '') + ' missed. The schedule was adapted: see "Why the schedule changed".', 'warn');
      adapt(all.map(function (b) { return b.id; }));
      if (S.misses >= CFG.escalateAfterMisses) sendReport();
    }
    /* day rollover or stale plan: rebuild quietly so the horizon keeps moving */
    if (S.builtAt && E.dayIndex(RAW, ms(S.builtAt), n) >= 1) rebuild('New day: the plan was extended.');
    saveS();
    var sig = overdueSig(n);
    if (sig !== lastSig) { lastSig = sig; ui.refreshLists(); }
    ui.refreshBadges();
    return newly.length;
  }
  function overdueSig(n) {
    return todos.filter(function (t) { return !t.done && t.deadline && ms(t.deadline) <= n; }).map(function (t) { return t.id; }).join(',') + '|' + (nextHealthBlock() || {}).id + '|' + Math.floor(n / (CFG.checkEverySeconds * 1000));
  }
  Atlas.bus.on('schedule:changed', function () { if (ui && ui.ready) { ui.refreshLists(); } check(); });

  function sendReport() {
    var n = Atlas.now(), lines = [];
    lines.push('SIMULATED REPORT FOR EARTH MISSION CONTROL (nothing was transmitted)');
    lines.push('Mission time: ' + n.toISOString());
    lines.push('');
    lines.push('Crew member has missed ' + S.misses + ' scheduled block' + (S.misses > 1 ? 's' : '') + ' (limit before reporting: ' + CFG.escalateAfterMisses + '):');
    S.missedLog.slice(-S.misses).forEach(function (m) { lines.push(' - ' + m.title + ' [' + m.type + '], planned ' + when(ms(m.planned))); });
    lines.push('');
    lines.push('Schedule adaptation:');
    S.reasons.slice(0, 6).forEach(function (r) { lines.push(' - ' + r.text); });
    if (S.unsched.length) { lines.push('Could not be scheduled:'); S.unsched.slice(0, 6).forEach(function (u) { lines.push(' - ' + u.title + ': ' + u.reason); }); }
    var hl = Atlas.health && Atlas.health.last && Atlas.health.last();
    lines.push('');
    lines.push(hl ? 'Last health check (simulated): ' + hl.time + ', heart rate ' + hl.heartRate + ' bpm, SpO2 ' + hl.spo2 + '%, fatigue ' + hl.fatigue + '/10.' : 'No health check on record yet.');
    var entry = { id: 'r' + n.getTime(), at: n.toISOString(), misses: S.misses, subject: 'Schedule adherence report: ' + S.misses + ' missed blocks', body: lines.join('\n'), simulated: true };
    outbox.unshift(entry); outbox = outbox.slice(0, 30); Atlas.store.set('planner.outbox', outbox);
    S.misses = 0; S.missedLog = []; saveS();
    Atlas.bus.emit('earth:report', entry);
    Atlas.toast('Report added to the simulated Earth outbox (nothing really leaves your computer).', 'danger');
    ui.refreshBadges(); ui.refreshLists();
  }

  /* ---------------- UI ---------------- */
  var ui = { ready: false, refreshLists: function () {}, refreshBadges: function () {} };
  var TYPE_LABEL = { sleep: 'Sleep', meal: 'Meal', recreation: 'Break', mission: 'Mission', task: 'Task', health: 'Health' };
  var TYPE_ICON = { sleep: '🌙', meal: '🍽', recreation: '☕', mission: '🚀', task: '📌', health: '❤' };

  function render(container) {
    container.classList.add('planner');
    var view = 'todo', editing = null;
    var speedSel, formBox, todoBox, schedBox, earthBox, badgeTodo, badgeEarth, tabBtns = {};

    /* header note */
    var mealsTxt = CFG.meals.map(function (m) { return m.title + ' ' + hmStr(m.startMin) + ' (' + m.minutes + ' min)'; }).join(', ');
    function hmStr(x) { return pad(Math.floor(x / 60)) + ':' + pad(Math.round(x % 60)); }
    var note = h('details', { class: 'pl-howto' }, [
      h('summary', { text: 'How to change these numbers' }),
      h('p', {}, ['Edit ', h('code', { text: 'web/data/schedule-config.js' }), ', save, reload. Every key is explained in ', h('code', { text: 'docs/SCHEDULE.md' }), ' (in the repository).']),
      h('p', { text: 'Current values read from the config:' }),
      h('ul', {}, [
        h('li', { text: 'Day length: ' + (RAW.sol ? 'sol, 24 h 39.6 min' : '24 h') + ' (sol: ' + (RAW.sol ? 'true' : 'false') + '), planning ' + CFG.days + ' days' }),
        h('li', { text: 'Sleep: ' + CFG.sleep.hours + ' h from ' + hmStr(CFG.sleep.startMin) + ' (sleep.hours, sleep.start)' }),
        h('li', { text: 'Recreation: ' + CFG.recreation.minutes + ' min at ' + hmStr(CFG.recreation.startMin) + ' (recreation.minutes, recreation.start)' }),
        h('li', { text: 'Meals: ' + mealsTxt + ' (meals)' }),
        h('li', { text: 'Health check: ' + (CFG.health.enabled ? 'from ' + hmStr(CFG.health.startMin) + ', every ' + CFG.health.intervalHours + ' h, ' + CFG.health.minutes + ' min' : 'off') + ' (health.start, health.intervalHours)' }),
        h('li', { text: 'Reminders: missed after ' + CFG.graceMinutes + ' min; report to Earth after ' + CFG.escalateAfterMisses + ' misses (graceMinutes, escalateAfterMisses)' })
      ])
    ]);
    var nav = h('div', { class: 'pl-nav', attrs: { role: 'group', 'aria-label': 'Planner views' } });
    function navBtn(id, label) {
      var b = h('button', { type: 'button', class: 'pl-navbtn', attrs: { 'aria-pressed': 'false' }, onclick: function () { show(id); } }, label);
      tabBtns[id] = b; nav.appendChild(b); return b;
    }
    navBtn('todo', 'To-do'); navBtn('sched', 'Schedule'); navBtn('earth', 'Earth link');
    badgeTodo = h('span', { class: 'pl-badge bad', hidden: true }); tabBtns.todo.appendChild(badgeTodo);
    badgeEarth = h('span', { class: 'pl-badge', hidden: true }); tabBtns.earth.appendChild(badgeEarth);

    formBox = h('div', { class: 'pl-formbox' });
    todoBox = h('div', { class: 'pl-todo' });
    schedBox = h('div', { class: 'pl-sched', hidden: true });
    earthBox = h('div', { class: 'pl-earth', hidden: true });
    container.appendChild(note); container.appendChild(nav);
    container.appendChild(h('div', { class: 'pl-view', attrs: { id: 'pl-view-todo' } }, [formBox, todoBox]));
    container.appendChild(schedBox); container.appendChild(earthBox);
    var todoWrap = formBox.parentNode;

    function show(id) {
      view = id;
      Object.keys(tabBtns).forEach(function (k) { tabBtns[k].setAttribute('aria-pressed', k === id ? 'true' : 'false'); });
      todoWrap.hidden = id !== 'todo'; schedBox.hidden = id !== 'sched'; earthBox.hidden = id !== 'earth';
      refreshLists();
    }

    /* ---- form ---- */
    function field(label, input, err, id) {
      return h('div', { class: 'pl-field' }, [h('label', { for: id, text: label }), input, h('div', { class: 'pl-err', id: id + '-err', attrs: { role: 'alert' }, text: err || '' })]);
    }
    function buildForm() {
      while (formBox.firstChild) formBox.removeChild(formBox.firstChild);
      var cur = editing ? findTodo(editing) : null;
      var f = {};
      f.title = h('input', { type: 'text', id: 'pl-title', maxlength: '80', value: cur ? cur.title : '', attrs: { autocomplete: 'off', required: 'true' } });
      f.description = h('textarea', { id: 'pl-desc', maxlength: '500', rows: '2' }); f.description.value = cur ? cur.description : '';
      f.deadline = h('input', { type: 'datetime-local', id: 'pl-deadline', value: cur && cur.deadline ? toLocalInput(cur.deadline) : '' });
      f.importance = h('select', { id: 'pl-imp' }, [[1, '1 - low'], [2, '2'], [3, '3 - normal'], [4, '4'], [5, '5 - critical']].map(function (o) { return h('option', { value: String(o[0]), text: o[1] }); }));
      f.importance.value = String(cur ? cur.importance : 3);
      f.estMin = h('input', { type: 'number', id: 'pl-est', min: '5', max: '1440', step: '5', value: String(cur ? cur.estMin : CFG.work.defaultTaskMinutes) });
      var errBox = {};
      var form = h('form', { class: 'pl-form', attrs: { novalidate: 'true', 'aria-label': editing ? 'Edit goal' : 'Add a goal' }, onsubmit: function (ev) {
        ev.preventDefault();
        var data = { title: f.title.value, description: f.description.value, deadline: f.deadline.value, importance: f.importance.value, estMin: f.estMin.value };
        var r = editing ? todosApi.update(editing, data) : todosApi.add(data);
        Object.keys(f).forEach(function (k) { var el = document.getElementById('pl-' + ({ title: 'title', description: 'desc', deadline: 'deadline', importance: 'imp', estMin: 'est' })[k] + '-err'); if (el) el.textContent = r.errors && r.errors[k] ? r.errors[k] : ''; f[k].setAttribute('aria-invalid', r.errors && r.errors[k] ? 'true' : 'false'); });
        if (!r.ok) { var first = Object.keys(f).filter(function (k) { return r.errors[k]; })[0]; if (first) f[first].focus(); return; }
        editing = null; buildForm(); refreshLists(); Atlas.toast(cur ? 'Goal updated.' : 'Goal added to your to-do list.', 'info');
      } }, [
        field('Title', f.title, '', 'pl-title'),
        field('Description (optional)', f.description, '', 'pl-desc'),
        h('div', { class: 'pl-row2' }, [field('Deadline (optional)', f.deadline, '', 'pl-deadline'), field('Importance', f.importance, '', 'pl-imp')]),
        field('Estimated minutes', f.estMin, '', 'pl-est'),
        h('div', { class: 'pl-btns' }, [
          h('button', { type: 'submit', class: 'pl-primary', text: editing ? 'Save changes' : 'Add goal' }),
          editing ? h('button', { type: 'button', text: 'Cancel', onclick: function () { editing = null; buildForm(); } }) : null
        ])
      ]);
      void errBox;
      var det = h('details', { class: 'pl-add' }, [h('summary', { text: editing ? 'Editing a goal' : '+ Add your own goal' }), form]);
      if (editing || formBox.dataset.open === '1') det.open = true;
      det.addEventListener('toggle', function () { formBox.dataset.open = det.open ? '1' : '0'; });
      formBox.appendChild(det);
      if (editing) { det.open = true; f.title.focus(); }
    }

    /* ---- to-do list ---- */
    function scheduledInfo(t) {
      var bl = S.blocks.filter(function (b) { return b.type === 'task' && b.refId === t.id && !S.blockDone[b.id]; });
      var un = S.unsched.filter(function (u) { return u.id === t.id; })[0];
      if (un) return { cls: 'bad', text: 'Not scheduled: ' + un.reason };
      if (bl.length) return { cls: '', text: 'Scheduled from ' + when(ms(bl[0].start)) + (bl.length > 1 ? ' (' + bl.length + ' blocks)' : '') };
      return null;
    }
    function deadlineChip(t, n) {
      if (!t.deadline) return h('span', { class: 'pl-chip', text: 'No deadline' });
      var d = ms(t.deadline), over = d <= n && !t.done;
      if (over) return h('span', { class: 'pl-chip overdue', text: '⚠ OVERDUE by ' + dur((n - d) / MIN) + ' (was due ' + when(d) + ')' });
      return h('span', { class: 'pl-chip' + (d - n < 6 * 3600000 ? ' soon' : ''), text: 'Due ' + when(d) + ' (in ' + dur((d - n) / MIN) + ')' });
    }
    function todoRow(t, kind) {
      var n = nowMs(), idDom = 'pl-cb-' + String(t.id).replace(/[^a-z0-9]/gi, '');
      var cb = h('input', { type: 'checkbox', id: idDom, checked: !!t.done, attrs: { 'aria-label': (kind === 'health' ? 'Do health check now: ' : 'Mark done: ') + t.title }, onchange: function () {
        if (kind === 'health') { todosApi.complete('health-next', true); Atlas.toast('Health check completed.', 'info'); }
        else todosApi.complete(t.id, cb.checked);
        refreshLists();
      } });
      var over = t.deadline && !t.done && ms(t.deadline) <= n;
      var info = kind === 'task' && !t.done ? scheduledInfo(t) : null;
      var li = h('li', { class: 'pl-item ' + kind + (t.done ? ' done' : '') + (over ? ' overdue' : '') }, [
        h('div', { class: 'pl-itop' }, [cb, h('label', { class: 'pl-title', for: idDom, text: t.title }),
          h('span', { class: 'pl-chip imp', text: '★' + t.importance, attrs: { title: 'Importance ' + t.importance + ' of 5', 'aria-label': 'Importance ' + t.importance + ' of 5' } })]),
        t.description ? h('p', { class: 'pl-desc', text: t.description }) : null,
        h('div', { class: 'pl-meta' }, [deadlineChip(t, n), h('span', { class: 'pl-chip', text: dur(t.estMin) })]),
        info ? h('p', { class: 'pl-sinfo ' + info.cls, text: info.text }) : null
      ]);
      var acts = h('div', { class: 'pl-btns small' });
      if (kind === 'task') {
        acts.appendChild(h('button', { type: 'button', text: 'Edit', attrs: { 'aria-label': 'Edit goal ' + t.title }, onclick: function () { editing = t.id; buildForm(); } }));
        var del = h('button', { type: 'button', class: 'danger', text: 'Delete', attrs: { 'aria-label': 'Delete goal ' + t.title } });
        var armed = false, tm = null;
        del.addEventListener('click', function () {
          if (!armed) { armed = true; del.textContent = 'Really delete?'; tm = setTimeout(function () { armed = false; del.textContent = 'Delete'; }, 4000); return; }
          clearTimeout(tm); todosApi.remove(t.id); if (editing === t.id) { editing = null; buildForm(); } refreshLists();
        });
        acts.appendChild(del);
      }
      if (kind === 'mission') {
        var m = null; objectives().forEach(function (x) { if (String(x.id) === String(t.missionId)) m = x; });
        if (m && typeof m.x === 'number' && typeof m.y === 'number') acts.appendChild(h('button', { type: 'button', text: 'Show on map', attrs: { 'aria-label': 'Show ' + t.title + ' on the map' }, onclick: function () { Atlas.focus(m.x, m.y, 3); } }));
      }
      if (acts.childNodes.length) li.appendChild(acts);
      return li;
    }
    function renderTodo() {
      var n = nowMs(), frag = [], all = sortTodos(todos.map(userItem));
      var open = all.filter(function (t) { return !t.done; }), doneL = all.filter(function (t) { return t.done; });
      frag.push(h('h3', { class: 'pl-h', text: 'Your goals' }));
      frag.push(open.length ? h('ul', { class: 'pl-list' }, open.map(function (t) { return todoRow(t, 'task'); })) : h('p', { class: 'pl-empty', text: 'No goals yet. Use "+ Add your own goal" to add something you want to do besides the mission.' }));
      var hi = healthItem();
      frag.push(h('h3', { class: 'pl-h', text: 'Health check' }));
      frag.push(hi ? h('ul', { class: 'pl-list' }, [todoRow(hi, 'health')]) : h('p', { class: 'pl-empty', text: CFG.health.enabled ? 'No health check in the plan yet.' : 'Health checks are switched off in schedule-config.js.' }));
      frag.push(h('h3', { class: 'pl-h' }, ['Mission objectives ', h('span', { class: 'pl-sub', text: '(from the Mission tab, read-only)' })]));
      var mi = missionItems();
      frag.push(mi.length ? h('ul', { class: 'pl-list' }, mi.map(function (t) { return todoRow(t, 'mission'); })) : h('p', { class: 'pl-empty', text: Atlas.missions ? 'The Mission tab has no objectives.' : 'Mission objectives appear here once the Mission tab has loaded.' }));
      if (doneL.length) frag.push(h('details', { class: 'pl-done' }, [h('summary', { text: 'Done (' + doneL.length + ')' }), h('ul', { class: 'pl-list' }, doneL.map(function (t) { return todoRow(t, 'task'); }))]));
      while (todoBox.firstChild) todoBox.removeChild(todoBox.firstChild);
      frag.forEach(function (x) { todoBox.appendChild(x); });
      void n;
    }

    /* ---- schedule view ---- */
    function dayLabel(first, n) {
      var idx = E.dayIndex(RAW, n, first), d = new Date(first);
      var s = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      return (idx === 0 ? 'Today' : idx === 1 ? 'Tomorrow' : s) + (idx <= 1 ? ' · ' + s : '') + (RAW.sol ? ' · sol +' + idx : '');
    }
    function blockRow(b, n) {
      var s = ms(b.start), e = ms(b.end), done = !!S.blockDone[b.id];
      var now = n >= s && n < e, late = !done && MONITORED[b.type] && n >= e;
      var cb = h('input', { type: 'checkbox', checked: done, attrs: { 'aria-label': 'Mark done: ' + b.title + ', ' + hhmm(s) + ' to ' + hhmm(e) }, onchange: function () { scheduleApi.markDone(b.id, cb.checked); } });
      return h('li', { class: 'pl-block t-' + b.type + (done ? ' done' : '') + (now ? ' now' : '') + (late ? ' late' : ''), attrs: { 'data-type': b.type, 'data-id': b.id, 'aria-current': now ? 'time' : null } }, [
        cb,
        h('span', { class: 'pl-time', text: hhmm(s) + '-' + hhmm(e) }),
        h('span', { class: 'pl-btitle' }, [h('span', { class: 'pl-ico', text: TYPE_ICON[b.type] || '•', attrs: { 'aria-hidden': 'true' } }), ' ' + b.title]),
        h('span', { class: 'pl-tag', text: TYPE_LABEL[b.type] || b.type }),
        now ? h('span', { class: 'pl-tag nowtag', text: 'now' }) : null,
        late ? h('span', { class: 'pl-tag late', text: 'not done' }) : null
      ]);
    }
    function renderSched() {
      while (schedBox.firstChild) schedBox.removeChild(schedBox.firstChild);
      var n = nowMs();
      speedSel = h('select', { id: 'pl-speed', attrs: { 'aria-label': 'Demo clock speed, for testing reminders' }, onchange: function () { Atlas.clock.setSpeed(Number(speedSel.value)); check(); } },
        [1, 60, 600, 3600].map(function (v) { return h('option', { value: String(v), text: v === 1 ? 'real time' : v + 'x faster' }); }));
      speedSel.value = String(Atlas.clock.speed || 1);
      schedBox.appendChild(h('div', { class: 'pl-toolbar' }, [
        h('button', { type: 'button', class: 'pl-primary', text: 'Rebuild', attrs: { 'aria-label': 'Rebuild the schedule now' }, onclick: function () { check(); scheduleApi.rebuild(); Atlas.toast('Schedule rebuilt.', 'info'); } }),
        h('label', { class: 'pl-speed' }, ['Demo clock: ', speedSel])
      ]));
      schedBox.appendChild(h('p', { class: 'pl-note', text: 'Simulated clock now: ' + new Date(n).toLocaleString() + (RAW.sol ? ' · sols of 24 h 39.6 min' : ' · 24-hour days') + ' · missed blocks since last report: ' + S.misses + ' of ' + CFG.escalateAfterMisses }));
      var legend = h('p', { class: 'pl-legend' }, Object.keys(TYPE_LABEL).map(function (k) { return h('span', { class: 'pl-tag t-' + k, text: (TYPE_ICON[k] || '') + ' ' + TYPE_LABEL[k] }); }));
      schedBox.appendChild(legend);
      if (S.unsched.length) {
        schedBox.appendChild(h('div', { class: 'pl-warnbox' }, [h('h4', { text: 'Could not schedule (' + S.unsched.length + ')' }),
          h('ul', {}, S.unsched.map(function (u) { return h('li', { text: (u.title || 'Item') + ': ' + u.reason }); }))]));
      }
      if (S.reasons.length) {
        schedBox.appendChild(h('details', { class: 'pl-why', open: true }, [h('summary', { text: 'Why the schedule changed (' + S.reasons.length + ')' }),
          h('ul', {}, S.reasons.slice(0, 8).map(function (r) { return h('li', {}, [h('span', { class: 'pl-when', text: when(ms(r.at)) + ' ' }), r.text]); }))]));
      }
      var days = [], byKey = {};
      S.blocks.forEach(function (b) {
        var k = E.dayIndex(RAW, ms(S.builtAt) || n, ms(b.start)); if (k < 0) k = 0;
        if (!byKey[k]) { byKey[k] = { idx: k, first: ms(b.start), blocks: [] }; days.push(byKey[k]); }
        byKey[k].blocks.push(b);
      });
      if (!days.length) schedBox.appendChild(h('p', { class: 'pl-empty', text: 'No blocks yet. Press Rebuild.' }));
      days.sort(function (a, b) { return a.idx - b.idx; }).forEach(function (d) {
        schedBox.appendChild(h('details', { class: 'pl-day', open: d.idx <= 1 }, [h('summary', { text: dayLabel(d.first, ms(S.builtAt) || n) + ' (' + d.blocks.length + ' blocks)' }),
          h('ol', { class: 'pl-blocks' }, d.blocks.map(function (b) { return blockRow(b, n); }))]));
      });
    }

    /* ---- Earth link ---- */
    function renderEarth() {
      while (earthBox.firstChild) earthBox.removeChild(earthBox.firstChild);
      earthBox.appendChild(h('div', { class: 'pl-earthbanner', attrs: { role: 'note' }, text: 'Simulated link to Earth: nothing actually leaves your computer.' }));
      earthBox.appendChild(h('p', { class: 'pl-note', text: 'A report is added to this outbox after ' + CFG.escalateAfterMisses + ' missed blocks (now: ' + S.misses + ' of ' + CFG.escalateAfterMisses + '). It is stored only in this browser.' }));
      if (!outbox.length) earthBox.appendChild(h('p', { class: 'pl-empty', text: 'Outbox is empty. Follow the schedule and it stays that way.' }));
      outbox.forEach(function (r) {
        earthBox.appendChild(h('details', { class: 'pl-report' }, [
          h('summary', {}, [r.subject, h('span', { class: 'pl-sub', text: ' · ' + new Date(r.at).toLocaleString() + ' · queued (simulated)' })]),
          h('pre', { text: r.body })
        ]));
      });
    }

    function refreshBadges() {
      var n = nowMs(), over = todos.filter(function (t) { return !t.done && t.deadline && ms(t.deadline) <= n; }).length;
      badgeTodo.hidden = !over; badgeTodo.textContent = over ? over + ' overdue' : '';
      badgeEarth.hidden = !outbox.length; badgeEarth.textContent = outbox.length ? String(outbox.length) : '';
    }
    function refreshLists() {
      var ae = document.activeElement, keep = ae && container.contains(ae) && ae.id ? ae.id : null;
      if (view === 'todo') renderTodo(); else if (view === 'sched') renderSched(); else renderEarth();
      refreshBadges();
      if (keep) { var again = document.getElementById(keep); if (again && again !== ae && again.focus && again.tagName !== 'BODY') try { again.focus(); } catch (e) { /* ignore */ } }
    }
    ui.refreshLists = refreshLists;
    ui.refreshBadges = refreshBadges;
    ui.ready = true;
    buildForm(); show('todo');
  }

  Atlas.registerTab({ id: 'planner', title: 'Planner', icon: '📋', order: 20, render: render });

  /* ---------------- start ---------------- */
  (function init() {
    var n = nowMs(), future = S.builtAt && ms(S.builtAt) > n + 60000;
    if (!S.builtAt || future) { S.reminded = {}; S.started = {}; rebuild(future ? 'Saved schedule was from a later clock time; a fresh one was built.' : null); }
    else check(true);                       // blocks that expired while the page was closed count as misses (capped)
    if (S.builtAt && n - ms(S.builtAt) > CFG.staleAfterHours * 3600000) rebuild('Saved schedule was old; a fresh one was built.');
    lastCheck = n;
    setInterval(function () {
      var t = nowMs();
      if (t - lastCheck >= CFG.checkEverySeconds * 1000 || t < lastCheck) check();
    }, 1000);
    check();
  })();
})();
