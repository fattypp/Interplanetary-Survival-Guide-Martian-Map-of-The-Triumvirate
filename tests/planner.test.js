/* Tests for the schedule engine (pure logic). Plain asserts, no packages.
   Node:     node tests/planner.test.js           (Node is not installed on the dev machine, see below)
   Browser:  serve the REPO ROOT (python3 -m http.server 8102), open
             http://localhost:8102/jezero-delta-atlas/web/html/index.html , then in the console:
               var s=document.createElement('script'); s.src='/tests/planner.test.js'; document.head.appendChild(s);
               // then read window.PLANNER_TEST_RESULT  (or call runPlannerTests())
   The engine and the config are loaded by index.html (window.ScheduleEngine, window.JEZERO_SCHEDULE_CONFIG). */
(function (root) {
  'use strict';
  var assert = (typeof require === 'function' && typeof module !== 'undefined') ? require('assert') : null;
  if (!assert) {
    assert = function (c, m) { if (!c) throw new Error(m || 'assertion failed'); };
    assert.ok = assert;
    assert.strictEqual = function (a, b, m) { if (a !== b) throw new Error((m || 'strictEqual') + ': ' + a + ' !== ' + b); };
  }
  var E, CFG0, MIN = 60000;
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    E = require('../jezero-delta-atlas/web/js/schedule-engine.js');
    global.window = global.window || {};
    try { require('../jezero-delta-atlas/web/data/schedule-config.js'); } catch (e) { /* uses window assignment */ }
    CFG0 = (global.window && global.window.JEZERO_SCHEDULE_CONFIG) || E.DEFAULTS;
  } else { E = root.ScheduleEngine; CFG0 = root.JEZERO_SCHEDULE_CONFIG || E.DEFAULTS; }

  function cfg(over) { var c = JSON.parse(JSON.stringify(CFG0)); Object.keys(over || {}).forEach(function (k) { c[k] = over[k]; }); return c; }
  var NOW = new Date(2026, 10, 16, 9, 3).getTime();       // Mon 16 Nov 2026, 09:03 local
  function at(dayOffset, h, m) { return new Date(2026, 10, 16 + dayOffset, h, m || 0).getTime(); }
  function iso(ms) { return new Date(ms).toISOString(); }
  function task(id, over) { var t = { id: id, title: 'Task ' + id, description: '', deadline: null, importance: 3, estMin: 60, done: false, missionId: null, kind: 'task' }; Object.keys(over || {}).forEach(function (k) { t[k] = over[k]; }); return t; }
  function mins(b) { return (new Date(b.end) - new Date(b.start)) / MIN; }
  function of(blocks, type) { return blocks.filter(function (b) { return b.type === type; }); }
  function noOverlap(blocks) {
    var s = blocks.slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
    for (var i = 1; i < s.length; i++) assert.ok(new Date(s[i].start) >= new Date(s[i - 1].end) - 1, 'overlap: ' + s[i - 1].id + ' / ' + s[i].id);
  }
  function workBlocks(blocks) { return blocks.filter(function (b) { return b.type === 'task' || b.type === 'mission'; }); }

  var tests = [];
  function t(name, fn) { tests.push({ name: name, fn: fn }); }

  t('sleep is always 8 h, one per night, with the default config', function () {
    var r = E.buildSchedule(cfg(), [task('a')], [], NOW);
    var sl = of(r.blocks, 'sleep');
    assert.ok(sl.length >= 7, 'at least 7 nights, got ' + sl.length);
    sl.forEach(function (b) { assert.strictEqual(mins(b), 480, 'sleep length ' + mins(b)); });
  });
  t('sleep hours follow the config (7.5 h) and starts at the configured time', function () {
    var c = cfg(); c.sleep = { hours: 7.5, start: '23:00' };
    var sl = of(E.buildSchedule(c, [], [], NOW).blocks, 'sleep');
    sl.forEach(function (b) { assert.strictEqual(mins(b), 450); assert.strictEqual(new Date(b.start).getHours(), 23); });
  });
  t('sleep is never shrunk by a crowded to-do list', function () {
    var todos = []; for (var i = 0; i < 60; i++) todos.push(task('c' + i, { estMin: 120, importance: 5, deadline: iso(at(1, 12)) }));
    var sl = of(E.buildSchedule(cfg(), todos, [], NOW).blocks, 'sleep');
    sl.forEach(function (b) { assert.strictEqual(mins(b), 480); });
  });
  t('no two blocks overlap (30 mixed tasks + objectives)', function () {
    var todos = []; for (var i = 0; i < 30; i++) todos.push(task('n' + i, { estMin: 20 + (i * 7) % 200, importance: 1 + i % 5, deadline: i % 3 ? iso(at(1 + i % 5, 17)) : null }));
    var objs = [{ id: 'o1', title: 'Obj 1' }, { id: 'o2', title: 'Obj 2' }];
    var r = E.buildSchedule(cfg(), todos, objs, NOW);
    noOverlap(r.blocks);
    assert.ok(workBlocks(r.blocks).length > 10);
  });
  t('three 30-minute meals on every full day', function () {
    var r = E.buildSchedule(cfg(), [], [], NOW), meals = of(r.blocks, 'meal');
    for (var d = 1; d <= 6; d++) {
      var dm = meals.filter(function (b) { var s = new Date(b.start); return s.getDate() === 16 + d; });
      assert.strictEqual(dm.length, 3, 'day ' + d + ' has ' + dm.length + ' meals');
      dm.forEach(function (b) { assert.strictEqual(mins(b), 30); });
    }
  });
  t('one hour of recreation every day', function () {
    var rec = of(E.buildSchedule(cfg(), [], [], NOW).blocks, 'recreation');
    assert.ok(rec.length >= 7); rec.forEach(function (b) { assert.strictEqual(mins(b), 60); });
  });
  t('a deadline that can be met is honoured', function () {
    var r = E.buildSchedule(cfg(), [task('d', { estMin: 120, deadline: iso(at(1, 12)) })], [], NOW);
    var bl = workBlocks(r.blocks); assert.ok(bl.length >= 2, 'split into pieces <= 90 min');
    bl.forEach(function (b) { assert.ok(new Date(b.end).getTime() <= at(1, 12), 'ends after deadline: ' + b.end); });
    assert.strictEqual(bl.reduce(function (a, b) { return a + mins(b); }, 0), 120);
    assert.strictEqual(r.unschedulable.length, 0);
  });
  t('an impossible deadline is flagged and nothing is scheduled after it', function () {
    var todo = task('imp', { estMin: 600, deadline: iso(NOW + 2 * 60 * MIN) });
    var r = E.buildSchedule(cfg(), [todo], [], NOW);
    assert.strictEqual(r.unschedulable.length, 1);
    assert.strictEqual(r.unschedulable[0].todo.id, 'imp');
    assert.ok(/Not enough free time/.test(r.unschedulable[0].reason), r.unschedulable[0].reason);
    assert.strictEqual(workBlocks(r.blocks).length, 0);
  });
  t('deadlines in the past are flagged, others still scheduled', function () {
    var r = E.buildSchedule(cfg(), [task('p', { deadline: iso(NOW - 3600000) }), task('ok')], [], NOW);
    assert.strictEqual(r.unschedulable.length, 1); assert.strictEqual(r.unschedulable[0].todo.id, 'p');
    assert.ok(/already passed/.test(r.unschedulable[0].reason));
    assert.ok(workBlocks(r.blocks).some(function (b) { return b.refId === 'ok'; }));
  });
  t('higher importance is scheduled first (no deadlines)', function () {
    var r = E.buildSchedule(cfg(), [task('low', { importance: 1 }), task('high', { importance: 5 }), task('mid', { importance: 3 })], [], NOW);
    var order = workBlocks(r.blocks).map(function (b) { return b.refId; });
    assert.strictEqual(order[0], 'high'); assert.strictEqual(order[1], 'mid'); assert.strictEqual(order[2], 'low');
  });
  t('a tight deadline beats importance when both cannot fit otherwise', function () {
    var todos = [task('big', { importance: 5, estMin: 600 }), task('due', { importance: 2, estMin: 60, deadline: iso(at(0, 12)) })];
    var r = E.buildSchedule(cfg(), todos, [], NOW);
    var due = workBlocks(r.blocks).filter(function (b) { return b.refId === 'due'; });
    assert.ok(due.length === 1 && new Date(due[0].end).getTime() <= at(0, 12), 'due task must end before noon');
  });
  t('when two deadline tasks collide, the less important one is dropped and the reason says so', function () {
    var dl = iso(at(0, 12));         // about 2 h free before noon (breakfast and health in between)
    var todos = [task('A', { importance: 5, estMin: 100, deadline: dl }), task('B', { importance: 1, estMin: 100, deadline: dl })];
    var r = E.buildSchedule(cfg(), todos, [], NOW);
    assert.strictEqual(r.unschedulable.length, 1);
    assert.strictEqual(r.unschedulable[0].todo.id, 'B');
    assert.ok(workBlocks(r.blocks).some(function (b) { return b.refId === 'A'; }));
    assert.ok(!workBlocks(r.blocks).some(function (b) { return b.refId === 'B'; }));
  });
  t('mission objectives are scheduled as type "mission" with their own refId', function () {
    var r = E.buildSchedule(cfg(), [], [{ id: 'obj-1', title: 'Sample the delta' }], NOW);
    var m = of(r.blocks, 'mission'); assert.ok(m.length >= 1); assert.strictEqual(m[0].refId, 'obj-1');
    assert.strictEqual(m.reduce(function (a, b) { return a + mins(b); }, 0), 60);
  });
  t('long jobs are split into blocks no longer than the work block maximum', function () {
    var r = E.buildSchedule(cfg(), [task('long', { estMin: 400 })], [], NOW);
    var bl = workBlocks(r.blocks); assert.ok(bl.length >= 5);
    bl.forEach(function (b) { assert.ok(mins(b) <= 90 + 1e-6); });
    assert.strictEqual(bl.reduce(function (a, b) { return a + mins(b); }, 0), 400);
  });
  t('health block recurs daily by default and twice a day for a 12 h interval', function () {
    var h = of(E.buildSchedule(cfg(), [], [], NOW).blocks, 'health');
    var days = {}; h.forEach(function (b) { days[new Date(b.start).getDate()] = (days[new Date(b.start).getDate()] || 0) + 1; });
    assert.ok(Object.keys(days).length >= 6, 'one per remaining day (today 08:00 has already passed)'); Object.keys(days).forEach(function (k) { assert.strictEqual(days[k], 1); });
    var c = cfg(); c.health = { enabled: true, start: '08:00', intervalHours: 12, minutes: 15 };
    var h2 = of(E.buildSchedule(c, [], [], NOW).blocks, 'health').filter(function (b) { return new Date(b.start).getDate() === 17; });
    assert.strictEqual(h2.length, 2); assert.strictEqual(new Date(h2[0].start).getHours(), 8); assert.strictEqual(new Date(h2[1].start).getHours(), 20);
    c.health.enabled = false; assert.strictEqual(of(E.buildSchedule(c, [], [], NOW).blocks, 'health').length, 0);
  });
  t('48 h health interval gives one check every second day', function () {
    var c = cfg(); c.health.intervalHours = 48;
    var h = of(E.buildSchedule(c, [], [], NOW).blocks, 'health'); assert.ok(h.length >= 3 && h.length <= 5, 'got ' + h.length);
  });
  t('sol mode: days are 24 h 39.6 min, sleep still 8 h, no overlaps', function () {
    var c = cfg(); c.sol = true;
    assert.ok(Math.abs(E.dayLengthMinutes(c) - 1479.6) < 1e-9);
    assert.ok(Math.abs((E.dayStart(c, NOW, 1) - E.dayStart(c, NOW, 0)) / MIN - 1479.6) < 1e-6);
    var r = E.buildSchedule(c, [task('s', { estMin: 200 })], [], NOW);
    of(r.blocks, 'sleep').forEach(function (b) { assert.strictEqual(Math.round(mins(b)), 480); });
    noOverlap(r.blocks);
    var s = of(r.blocks, 'sleep'); var gap = (new Date(s[1].start) - new Date(s[0].start)) / MIN;
    assert.ok(Math.abs(gap - 1479.6) < 0.01, 'bedtimes are one sol apart: ' + gap);
    var c2 = cfg(); var g2 = (new Date(of(E.buildSchedule(c2, [], [], NOW).blocks, 'sleep')[1].start) - new Date(of(E.buildSchedule(c2, [], [], NOW).blocks, 'sleep')[0].start)) / MIN;
    assert.ok(Math.abs(g2 - 1440) < 0.01);
  });
  t('empty to-do list gives only sacred blocks and no errors', function () {
    var r = E.buildSchedule(cfg(), [], [], NOW);
    assert.strictEqual(workBlocks(r.blocks).length, 0); assert.strictEqual(r.unschedulable.length, 0);
    assert.ok(of(r.blocks, 'sleep').length && of(r.blocks, 'meal').length);
    var r2 = E.buildSchedule(cfg(), null, undefined, NOW); assert.ok(r2.blocks.length > 0);
  });
  t('200 tasks build in under 1.5 s with no overlaps', function () {
    var todos = []; for (var i = 0; i < 200; i++) todos.push(task('p' + i, { estMin: 15 + (i * 13) % 150, importance: 1 + (i * 7) % 5, deadline: i % 2 ? iso(at(1 + i % 6, 8 + i % 10)) : null }));
    var t0 = Date.now(), r = E.buildSchedule(cfg(), todos, [], NOW), ms = Date.now() - t0;
    noOverlap(r.blocks);
    assert.ok(ms < 1500, 'took ' + ms + ' ms');
    assert.ok(r.unschedulable.length > 0, 'too much work: some must be flagged');
    r.blocks.filter(function (b) { return b.type === 'task'; }).forEach(function (b) {
      var td = todos.filter(function (x) { return x.id === b.refId; })[0];
      if (td.deadline) assert.ok(new Date(b.end) <= new Date(td.deadline), 'late block ' + b.id);
    });
    t.perf = ms;
  });
  t('deterministic: same input twice gives identical output', function () {
    var todos = [task('a', { importance: 2, deadline: iso(at(2, 10)) }), task('b', { importance: 4 }), task('c', { importance: 4 })];
    assert.strictEqual(JSON.stringify(E.buildSchedule(cfg(), todos, [], NOW)), JSON.stringify(E.buildSchedule(cfg(), todos, [], NOW)));
  });
  t('done tasks are not scheduled; done minutes shorten the remaining job', function () {
    var r = E.buildSchedule(cfg(), [task('x', { done: true }), task('y', { estMin: 120 })], [], NOW, { done: { 'task:y': 60 } });
    var bl = workBlocks(r.blocks); assert.ok(bl.every(function (b) { return b.refId === 'y'; }));
    assert.strictEqual(bl.reduce(function (a, b) { return a + mins(b); }, 0), 60);
  });
  t('reschedule: a missed block is moved later, reason names it, sacred blocks are unchanged', function () {
    var todos = [task('w', { title: 'Write report', importance: 4, estMin: 60, deadline: iso(at(3, 18)) }), task('z', { title: 'Tidy', importance: 1, estMin: 60 })];
    var r0 = E.buildSchedule(cfg(), todos, [], NOW);
    var first = workBlocks(r0.blocks)[0]; assert.strictEqual(first.refId, 'w');
    var later = new Date(first.end).getTime() + 11 * MIN;      // past the 10 min grace
    var r1 = E.reschedule(cfg(), { todos: todos, objectives: [], blocks: r0.blocks, missed: [first.id], done: {} }, later);
    noOverlap(r1.blocks);
    var w = workBlocks(r1.blocks).filter(function (b) { return b.refId === 'w'; });
    assert.ok(w.length === 1 && new Date(w[0].start).getTime() >= later, 'moved after now');
    assert.ok(r1.reasons.some(function (x) { return /Write report/.test(x) && /Moved/.test(x) && /not marked done/.test(x); }), JSON.stringify(r1.reasons));
    var sacred = function (r) { return r.blocks.filter(function (b) { return new Date(b.start).getTime() >= later && b.type !== 'task' && b.type !== 'mission'; }).map(function (b) { return b.id; }).join(); };
    assert.strictEqual(sacred(r1), sacred({ blocks: r0.blocks }), 'sleep/meal/health/recreation untouched');
    assert.strictEqual(of(r1.blocks, 'sleep').length, of(r0.blocks, 'sleep').filter(function (b) { return new Date(b.end).getTime() > later; }).length);
  });
  t('reschedule: low importance work is dropped first when time runs out', function () {
    var dl = iso(at(0, 17));
    var todos = [task('hi', { importance: 5, estMin: 100, deadline: dl }), task('lo', { importance: 1, estMin: 100, deadline: dl })];
    var now = at(0, 14, 0);
    var r0 = E.buildSchedule(cfg(), [todos[0]], [], at(0, 9, 3));
    var r1 = E.reschedule(cfg(), { todos: todos, objectives: [], blocks: r0.blocks, missed: [workBlocks(r0.blocks)[0].id], done: {} }, now);
    assert.ok(r1.unschedulable.some(function (u) { return u.todo.id === 'lo'; }), 'lo dropped');
    assert.ok(workBlocks(r1.blocks).some(function (b) { return b.refId === 'hi'; }), 'hi kept');
    assert.ok(r1.reasons.some(function (x) { return /"task lo"|lo/i.test(x) && /Could not keep/.test(x); }));
  });
  t('reschedule: a missed health check gets a catch-up block', function () {
    var r0 = E.buildSchedule(cfg(), [], [], NOW);
    var hc = of(r0.blocks, 'health')[0];
    var later = new Date(hc.end).getTime() + 11 * MIN;
    var r1 = E.reschedule(cfg(), { todos: [], objectives: [], blocks: r0.blocks, missed: [hc.id], done: {} }, later);
    assert.ok(of(r1.blocks, 'health').some(function (b) { return /catch-up/.test(b.title) && new Date(b.start).getTime() >= later; }));
    noOverlap(r1.blocks);
  });
  t('normalizeConfig survives garbage and clamps numbers', function () {
    var c = E.normalizeConfig({ days: 9999, sleep: { hours: 99, start: 'banana' }, meals: 'x', escalateAfterMisses: -4, graceMinutes: 'abc' });
    assert.strictEqual(c.days, 30); assert.strictEqual(c.sleep.hours, 12); assert.strictEqual(c.sleep.startMin, 22 * 60);
    assert.strictEqual(c.escalateAfterMisses, 1); assert.strictEqual(c.graceMinutes, 10); assert.strictEqual(c.meals.length, 3);
    assert.ok(E.buildSchedule(null, null, null, NOW).blocks.length > 0);
  });
  t('the shipped config file is valid and has the documented defaults', function () {
    var c = E.normalizeConfig(CFG0);
    assert.strictEqual(c.sleep.hours, 8); assert.strictEqual(c.recreation.minutes, 60); assert.strictEqual(c.meals.length, 3);
    assert.strictEqual(c.days, 7); assert.strictEqual(c.sol, false); assert.strictEqual(c.escalateAfterMisses, 3);
  });

  function runPlannerTests() {
    var results = [], failed = 0;
    tests.forEach(function (x) {
      try { x.fn(); results.push('PASS ' + x.name); } catch (e) { failed++; results.push('FAIL ' + x.name + ' -> ' + (e && e.message)); }
    });
    var summary = { total: tests.length, passed: tests.length - failed, failed: failed, perf200ms: t.perf, results: results };
    root.PLANNER_TEST_RESULT = summary;
    if (typeof console !== 'undefined') console.log(results.join('\n') + '\n' + summary.passed + '/' + summary.total + ' passed');
    return summary;
  }
  root.runPlannerTests = runPlannerTests;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runPlannerTests: runPlannerTests };
    if (require.main === module) { var s = runPlannerTests(); process.exit(s.failed ? 1 : 0); }
  } else { runPlannerTests(); }
})(typeof window !== 'undefined' ? window : globalThis);
