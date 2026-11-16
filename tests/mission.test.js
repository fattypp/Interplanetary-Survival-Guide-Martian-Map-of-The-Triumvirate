/* Tests for the mission data (data/mission-data.js, generated from docs/mission-guide.md) and Atlas.missions.
   Browser: serve the REPO ROOT (python3 -m http.server <port>), open jezero-delta-atlas/web/html/index.html, then in the console:
     var s=document.createElement('script'); s.src='/tests/mission.test.js'; document.head.appendChild(s);
     // read window.MISSION_TEST_RESULT
   The data checks also run in Node (node tests/mission.test.js) because they only read the data file. */
(function (root) {
  'use strict';
  var assert = (typeof require === 'function' && typeof module !== 'undefined') ? require('assert') : null;
  if (!assert) { assert = function (c, m) { if (!c) throw new Error(m || 'assertion failed'); }; assert.ok = assert; assert.strictEqual = function (a, b, m) { if (a !== b) throw new Error((m || 'strictEqual') + ': ' + a + ' !== ' + b); }; }
  var D;
  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') { global.window = global.window || {}; require('../jezero-delta-atlas/web/data/mission-data.js'); D = global.window.JEZERO_MISSION; }
  else D = root.JEZERO_MISSION;
  var tests = [];
  function t(name, fn) { tests.push({ name: name, fn: fn }); }
  function px(lat, lon) { return [(lon - 77.22318) / 0.19638 * 1990, (18.57188 - lat) / 0.13012 * 1390]; }

  t('2 objectives, base camp, exactly 5 stops and 10 tasks', function () {
    assert.strictEqual(D.objectives.length, 2); assert.strictEqual(D.objectives[0].id, 1); assert.strictEqual(D.objectives[1].id, 2);
    assert.strictEqual(D.stops.length, 5); assert.strictEqual(D.tasks.length, 10); assert.strictEqual(D.base.id, 'base');
    D.stops.forEach(function (s, i) { assert.strictEqual(s.id, 'stop-' + (i + 1)); assert.strictEqual(s.n, i + 1); });
  });
  t('each stop has exactly one task per objective, ids task-<n>-<objective>, estMin 20 to 60, in stop order', function () {
    D.stops.forEach(function (s, i) {
      var ts = D.tasks.filter(function (x) { return x.stopId === s.id; });
      assert.strictEqual(ts.length, 2); assert.strictEqual(ts[0].objective, 1); assert.strictEqual(ts[1].objective, 2);
      assert.strictEqual(D.tasks[i * 2].id, ts[0].id);
      ts.forEach(function (x) { assert.strictEqual(x.id, 'task-' + s.n + '-' + x.objective); assert.ok(x.estMin >= 20 && x.estMin <= 60); assert.ok(x.title && x.description); });
    });
  });
  t('x,y match the atlas formula and lie inside the 1990 x 1390 map', function () {
    [D.base].concat(D.stops).forEach(function (s) {
      var p = px(s.lat, s.lon); assert.ok(Math.abs(p[0] - s.x) < 0.06 && Math.abs(p[1] - s.y) < 0.06, s.id);
      assert.ok(s.x >= 0 && s.x <= 1990 && s.y >= 0 && s.y <= 1390, s.id + ' inside map');
    });
  });
  t('no leftovers of the old samples and places', function () {
    var txt = JSON.stringify(D).toLowerCase();
    ['swift run', 'coulette', 'hawksbill', 'witch hazel', 'sample-1"', 'place-'].forEach(function (w) { assert.ok(txt.indexOf(w) < 0, w); });
  });
  t('travel speeds: the rover is faster than a person on foot', function () {
    var S = root.JEZERO_SPEEDS; if (!S) return;
    assert.ok(S.rover.mps > S.foot.mps);
  });
  t('Atlas.missions: objectives, stops, tasks and custom missions keep their kinds; stop done = both tasks done', function () {
    var A = root.Atlas; if (!A || !A.missions) return;
    var l = A.missions.list(), k = function (x) { return l.filter(function (m) { return m.kind === x; }); };
    assert.strictEqual(k('objective').length, 2); assert.strictEqual(k('stop').length, 5); assert.strictEqual(k('task').length, 10);
    assert.strictEqual(A.missions.stops().length, 5); assert.strictEqual(A.missions.base().id, 'base');
    var OB = root.JdaObjective, wasObj = OB ? OB.get() : null; if (OB) OB.set('both');   // stop done = its tasks of the chosen objective(s)
    var was1 = A.missions.isDone('task-1-1'), was2 = A.missions.isDone('task-1-2');
    A.missions.setDone('task-1-1', false); A.missions.setDone('task-1-2', false);   // a live world run may already have ticked them
    A.missions.setDone('task-1-1', true); assert.ok(!A.missions.isDone('stop-1')); A.missions.setDone('task-1-2', true); assert.ok(A.missions.isDone('stop-1'));
    A.missions.setDone('task-1-1', was1); A.missions.setDone('task-1-2', was2);
    if (OB && wasObj !== null) OB.set(wasObj);
    var c = A.missions.add({ title: 'Test mission' }); assert.ok(c && c.kind === 'custom'); assert.ok(A.missions.remove(c.id));
  });
  t('objective choice: scopedTasks 5 or 10 in stop order, done tasks stay done when the choice changes, a stop is done when its chosen tasks are', function () {
    var A = root.Atlas, OB = root.JdaObjective; if (!A || !A.missions || !OB) return;
    var was = OB.get(), d = {}; D.tasks.forEach(function (x) { d[x.id] = A.missions.isDone(x.id); A.missions.setDone(x.id, false); });
    OB.set(1); var s1 = A.missions.scopedTasks(); assert.strictEqual(s1.length, 5); assert.ok(s1.every(function (x) { return x.objective === 1 && x.inScope; }));
    assert.strictEqual(A.missions.tasks().length, 10);
    A.missions.setDone('task-1-1', true); assert.ok(A.missions.isDone('stop-1'), 'one task is enough for objective 1');
    OB.set(2); assert.strictEqual(A.missions.scopedTasks().length, 5); assert.ok(!A.missions.isDone('stop-1')); assert.ok(A.missions.isDone('task-1-1'), 'done stays done');
    OB.set('both'); assert.strictEqual(A.missions.scopedTasks().length, 10); assert.ok(!A.missions.isDone('stop-1'));
    D.tasks.forEach(function (x) { A.missions.setDone(x.id, d[x.id]); }); if (was !== null) OB.set(was);
  });
  t('world run progress counts the chosen tasks in order', function () {
    var A = root.Atlas, OB = root.JdaObjective; if (!A || !A.missions || !A.missions._applyRun || !OB) return;
    var was = OB.get(), ids = D.tasks.map(function (x) { return x.id; }), before = {}; ids.forEach(function (i) { before[i] = A.missions.isDone(i); A.missions.setDone(i, false); });
    OB.set(2); A.missions._applyRun(0); A.missions._applyRun(2);
    assert.ok(A.missions.isDone('task-1-2') && A.missions.isDone('task-2-2') && !A.missions.isDone('task-3-2') && !A.missions.isDone('task-1-1'));
    A.missions._applyRun(0); ids.forEach(function (i) { A.missions.setDone(i, before[i]); }); if (was !== null) OB.set(was);
  });
  t('world run progress is mirrored once, manual un-tick sticks, a restart re-opens run-marked tasks', function () {
    var A = root.Atlas; if (!A || !A.missions || !A.missions._applyRun) return;
    var OB2 = root.JdaObjective, was2 = OB2 ? OB2.get() : null; if (OB2) OB2.set('both');
    var ids = D.tasks.map(function (x) { return x.id; }), before = {};
    ids.forEach(function (i) { before[i] = A.missions.isDone(i); A.missions.setDone(i, false); });
    A.missions._applyRun(0); A.missions._applyRun(3);
    assert.ok(A.missions.isDone(ids[0]) && A.missions.isDone(ids[1]) && A.missions.isDone(ids[2]) && !A.missions.isDone(ids[3]));
    assert.ok(A.missions.isDone('stop-1'));
    A.missions.setDone(ids[0], false); A.missions._applyRun(3); A.missions._applyRun(4);
    assert.ok(!A.missions.isDone(ids[0]), 'manual un-tick must not be overridden again');
    assert.ok(A.missions.isDone(ids[3]));
    A.missions.setDone(ids[9], true);            // ticked by hand, not by the run
    A.missions._applyRun(0);                      // run restarted
    assert.ok(!A.missions.isDone(ids[1]) && !A.missions.isDone(ids[2]) && !A.missions.isDone(ids[3]), 'run-marked tasks re-opened');
    assert.ok(A.missions.isDone(ids[9]), 'hand-ticked task kept');
    ids.forEach(function (i) { A.missions.setDone(i, before[i]); }); if (OB2 && was2 !== null) OB2.set(was2);
  });
  t('world progress.doneIds is mirrored exactly (finish objective 1, switch to both; mid-run objective switch)', function () {
    var A = root.Atlas, OB = root.JdaObjective; if (!A || !A.missions || !A.missions._applyRunIds || !OB) return;
    var was = OB.get(), ids = D.tasks.map(function (x) { return x.id; }), before = {}; ids.forEach(function (i) { before[i] = A.missions.isDone(i); A.missions.setDone(i, false); });
    function doneSet() { return ids.filter(function (i) { return A.missions.isDone(i); }).join(','); }
    A.missions._applyRunIds([]); OB.set(1);
    A.missions._applyRunIds(['task-1-1', 'task-2-1', 'task-3-1', 'task-4-1', 'task-5-1']);
    OB.set('both'); A.missions._applyRunIds(['task-1-1', 'task-2-1', 'task-3-1', 'task-4-1', 'task-5-1']);
    assert.strictEqual(doneSet(), 'task-1-1,task-2-1,task-3-1,task-4-1,task-5-1', 'only what the run did');
    A.missions.setDone('task-1-2', true);                                   // by hand
    A.missions._applyRunIds([]);                                            // restart: run ticks re-opened, hand tick kept
    assert.strictEqual(doneSet(), 'task-1-2');
    A.missions.setDone('task-1-2', false);
    OB.set(2); A.missions._applyRunIds(['task-1-2', 'task-2-2']);           // mid-run 2 -> 1: the run did the objective 2 tasks
    OB.set(1); A.missions._applyRunIds(['task-1-2', 'task-2-2']);
    assert.ok(A.missions.isDone('task-1-2') && A.missions.isDone('task-2-2') && !A.missions.isDone('task-1-1') && !A.missions.isDone('task-2-1'));
    A.missions.setDone('task-1-2', false); A.missions._applyRunIds(['task-1-2', 'task-2-2']); assert.ok(!A.missions.isDone('task-1-2'), 'manual un-tick sticks');
    A.missions._applyRunIds([]); ids.forEach(function (i) { A.missions.setDone(i, before[i]); }); if (was !== null) OB.set(was);
  });
  t('stop card: picture or placeholder, both tasks, credit and raw images link; strip and pins always present', function () {
    var A = root.Atlas; if (!A || !A.missions || !A.missions.open || typeof document === 'undefined') return;
    A.missions.open('stop-2'); var c = document.getElementById('ms-card'); assert.ok(c && !c.hidden);
    assert.strictEqual(c.querySelectorAll('.ms-ctask').length, 2);
    var im = c.querySelector('img.ms-pic'), ph = c.querySelector('.ms-nopic'); assert.ok(im || ph, 'picture or placeholder');
    if (im) { assert.ok(im.alt.length > 5 && im.getAttribute('loading') === 'lazy'); assert.ok(/NASA\/JPL-Caltech, Perseverance sol \d+/.test(c.textContent)); }
    else assert.ok(/Picture not available yet/.test(c.textContent));
    var a = c.querySelector('a[href="https://mars.nasa.gov/mars2020/multimedia/raw-images/"]'); if (im) assert.ok(a && a.target === '_blank' && /noopener/.test(a.rel));
    assert.strictEqual(document.querySelectorAll('#ms-strip .ms-chip').length, 6); assert.strictEqual(document.querySelectorAll('#ov-top .ms-pin.ms-core').length, 6);
    assert.ok(A.layers.isOn('mission-stops')); A.layers.setOn('mission-stops', false); assert.ok(A.layers.isOn('mission-stops'), 'locked on');
    A.missions.closeCard(); assert.ok(c.hidden);
  });
  t('Atlas.me starts at base camp, not clamped; Atlas.mapData has base and 5 stops only', function () {
    var A = root.Atlas; if (!A || !A.mapData) return;
    assert.strictEqual(A.mapData.stops.length, 5); assert.ok(!A.mapData.samples && !A.mapData.places);
    assert.ok(A.landing.onMap && A.base.x === D.base.x);
  });

  function runMissionTests() {
    var results = [], failed = 0;
    tests.forEach(function (x) { try { x.fn(); results.push('PASS ' + x.name); } catch (e) { failed++; results.push('FAIL ' + x.name + ' -> ' + (e && e.message)); } });
    var summary = { total: tests.length, passed: tests.length - failed, failed: failed, results: results };
    root.MISSION_TEST_RESULT = summary;
    if (typeof console !== 'undefined') console.log(results.join('\n') + '\n' + summary.passed + '/' + summary.total + ' passed');
    return summary;
  }
  /* Browser only, async: the atlas must still load every tab when a saved jda.* value is corrupt or from an older version.
     Loads index.html into a hidden same-origin iframe per case (srcdoc, with an error collector) and returns a Promise of
     {total, passed, failed, results}; also stored in window.CORRUPT_STORE_TEST_RESULT. */
  function runCorruptStoreTests() {
    var base = location.href.replace(/[#?].*$/, '').replace(/[^\/]*$/, '');
    var now = new Date().toISOString();
    var cases = [['tabs.open', '"x"'], ['layers', 'null'], ['layers', '{"grid":null,"delta":{"on":"yes","opacity":"zz"}}'],
      ['planner.todos', '[null,1,{"id":"y","title":"t","deadline":"junk","importance":"9","estMin":"abc"}]'],
      ['planner.sched', '{"blocks":[null,{"id":"c","type":"task","title":"t","start":"x","end":"y"}],"unsched":[1],"reasons":[null],"blockDone":{"a":null},"misses":"zz","builtAt":"bad"}'],
      ['planner.outbox', '[null,{"id":1}]'], ['suit.me', '{"x":"5","y":"7"}'], ['suit.me', '{"x":10,"y":10}'], ['suit.state', '"x"'], ['health.history', '[null,1]'],
      ['team.state', '{"v":2,"members":[null,1,{"id":"jayesh","x":"a"}]}'], ['team.unread', '{"jayesh":"abc"}'],
      ['mission.custom', '[null,{"id":"custom-1","title":"a","x":"5"},{"id":"custom-1","title":"dup"},{"id":"custom-9","title":"t","description":5,"x":1e9,"y":1}]'],
      ['mission.done', '[1]'], ['mission.seq', '"abc"'], ['mission.run', '{"handled":[1],"marked":"x","last":"q"}']];
    var results = [], failed = 0;
    function one(c) {
      return fetch(base + 'index.html').then(function (r) { return r.text(); }).then(function (html) {
        var inj = '<base href="' + base + '"><script>window.__E=[];window.onerror=function(m,s,l){__E.push(m+" @"+l)};var ce=console.error;console.error=function(){__E.push([].slice.call(arguments).join(" "));ce.apply(console,arguments)};<\/script>';
        var keep = localStorage.getItem('jda.' + c[0]);
        localStorage.setItem('jda.' + c[0], c[1]);
        var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:700px;opacity:0;pointer-events:none';
        f.srcdoc = html.replace('<head>', '<head>' + inj); document.body.appendChild(f);
        return new Promise(function (res) { setTimeout(res, 1500); }).then(function () {
          var d = f.contentDocument, errs = f.contentWindow.__E.slice(), bad = '';
          [].forEach.call(d.querySelectorAll('.dock-tab'), function (b) { b.click(); });
          errs = f.contentWindow.__E.slice();
          bad = (d.body.innerText.match(/NaN|undefined|Infinity|\[object/g) || []).join(',');
          f.remove(); if (keep === null) localStorage.removeItem('jda.' + c[0]); else localStorage.setItem('jda.' + c[0], keep);
          var label = c[0] + '=' + c[1].slice(0, 40);
          if (errs.length || bad) { failed++; results.push('FAIL ' + label + ' -> ' + (errs[0] || bad)); } else results.push('PASS ' + label);
        });
      });
    }
    return cases.reduce(function (p, c) { return p.then(function () { return one(c); }); }, Promise.resolve()).then(function () {
      var sum = { total: cases.length, passed: cases.length - failed, failed: failed, results: results };
      root.CORRUPT_STORE_TEST_RESULT = sum; if (typeof console !== 'undefined') console.log(results.join('\n')); return sum;
    });
  }
  root.runCorruptStoreTests = runCorruptStoreTests;
  root.runMissionTests = runMissionTests;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { runMissionTests: runMissionTests }; if (require.main === module) { var s = runMissionTests(); process.exit(s.failed ? 1 : 0); } }
  else { runMissionTests(); if (root.Atlas && typeof document !== 'undefined') runCorruptStoreTests(); }
})(typeof window !== 'undefined' ? window : globalThis);
