/* Tests for JdaObjective (web/js/objective.js), the objective choice. Pure helpers run in Node too.
   Browser: serve the REPO ROOT, open jezero-delta-atlas/web/html/index.html, then in the console:
     var s=document.createElement('script'); s.src='/tests/objective.test.js'; document.head.appendChild(s);  // read window.OBJECTIVE_TEST_RESULT
   The state-touching tests restore the choice that was stored before. */
(function (root) {
  'use strict';
  var assert = (typeof require === 'function' && typeof module !== 'undefined') ? require('assert') : null;
  if (!assert) { assert = function (c, m) { if (!c) throw new Error(m || 'assertion failed'); }; assert.ok = assert; assert.strictEqual = function (a, b, m) { if (a !== b) throw new Error((m || 'strictEqual') + ': ' + a + ' !== ' + b); }; }
  var OB = (typeof module !== 'undefined' && module.exports && typeof require === 'function') ? require('../jezero-delta-atlas/web/js/objective.js') : root.JdaObjective;
  var tasks = []; for (var n = 1; n <= 5; n++) [1, 2].forEach(function (o) { tasks.push({ id: 'task-' + n + '-' + o, objective: o }); });
  var tests = [];
  function t(name, fn) { tests.push({ name: name, fn: fn }); }
  var browser = typeof document !== 'undefined' && root.JdaObjective && root.JdaObjective.get;

  t('norm accepts 1, 2, both (also as strings) and rejects the rest', function () {
    assert.strictEqual(OB.norm(1), 1); assert.strictEqual(OB.norm('2'), 2); assert.strictEqual(OB.norm('both'), 'both');
    [0, 3, null, undefined, '', 'all', {}, [], true].forEach(function (x) { assert.strictEqual(OB.norm(x), null, String(x)); });
  });
  t('filter: 1 -> 5 tasks of objective 1, 2 -> 5 of objective 2, both -> 10 in order, none -> all; accepts {tasks}', function () {
    assert.strictEqual(OB.filter(tasks, 1).length, 5); assert.ok(OB.filter(tasks, 1).every(function (x) { return x.objective === 1; }));
    assert.strictEqual(OB.filter(tasks, 2).length, 5); assert.ok(OB.filter(tasks, 2).every(function (x) { return x.objective === 2; }));
    var b = OB.filter({ tasks: tasks }, 'both'); assert.strictEqual(b.length, 10); assert.strictEqual(b[0].id, 'task-1-1'); assert.strictEqual(b[9].id, 'task-5-2');
    assert.strictEqual(OB.filter(tasks, null).length, 10); assert.strictEqual(OB.filter(null, 1).length, 0); assert.ok(OB.filter(tasks, 'both') !== tasks);
  });
  t('labels', function () { assert.ok(/microbial/.test(OB.label(1))); assert.ok(/human life/.test(OB.label(2))); assert.strictEqual(OB.label('both'), 'Both objectives'); assert.strictEqual(OB.label(null), 'Not chosen'); });
  t('set / get / has persist per crew in localStorage and reject bad values (browser)', function () {
    if (!browser) return;
    var id = 'tcrew' + Date.now() % 1000, k = 'jda.objective.' + id;
    assert.strictEqual(OB.get(id), null); assert.ok(!OB.has(id));
    assert.ok(!OB.set('nope', id)); assert.strictEqual(OB.get(id), null);
    assert.ok(OB.set(2, id)); assert.strictEqual(OB.get(id), 2);
    var raw = JSON.parse(localStorage.getItem(k)); assert.strictEqual(raw.choice, 2); assert.ok(isFinite(Date.parse(raw.t)));
    OB.set('both', id); assert.strictEqual(OB.get(id), 'both'); assert.ok(Date.parse(JSON.parse(localStorage.getItem(k)).t) >= Date.parse(raw.t));
    localStorage.removeItem(k);
  });
  t('corrupt stored value is ignored (browser)', function () {
    if (!browser) return;
    var id = 'tbad', k = 'jda.objective.' + id; localStorage.setItem(k, '{"choice":"zz"}'); assert.strictEqual(OB.get(id), null);
    localStorage.setItem(k, 'not json'); assert.strictEqual(OB.get(id), null); localStorage.setItem(k, '1'); assert.strictEqual(OB.get(id), 1); localStorage.removeItem(k);
  });
  t('on() fires for a change of the current crew only, off() stops it; tasks/includes/count follow the choice (browser)', function () {
    if (!browser) return;
    var was = OB.get(), seen = [], off = OB.on(function (c, i) { seen.push(c + ':' + i.source); });
    OB.set(1); OB.set('both'); OB.set(2, 'someone-else-xyz'); localStorage.removeItem('jda.objective.someone-else-xyz');
    assert.strictEqual(seen.join(','), '1:local,both:local');
    OB.set(1); assert.strictEqual(OB.tasks(tasks).length, 5); assert.ok(OB.includes(1) && !OB.includes(2)); assert.strictEqual(OB.count({ tasks: tasks }), 5);
    OB.set('both'); assert.strictEqual(OB.tasks(tasks).length, 10); assert.ok(OB.includes(1) && OB.includes(2));
    off(); var n = seen.length; OB.set(2); assert.strictEqual(seen.length, n);
    if (was !== null) OB.set(was); else { try { localStorage.removeItem('jda.objective.' + OB.crewId()); localStorage.removeItem('jda.objective'); } catch (e) { /* ignore */ } }
  });
  t('crewId is the room crew id when joined, else local (browser)', function () {
    if (!browser) return;
    var L = root.JdaLink, r = L && L.room; var id = OB.crewId();
    if (r && !r.implicit && r.id) assert.strictEqual(id, String(r.id).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 32)); else assert.strictEqual(id, 'local');
  });

  function runObjectiveTests() {
    var results = [], failed = 0;
    tests.forEach(function (x) { try { x.fn(); results.push('PASS ' + x.name); } catch (e) { failed++; results.push('FAIL ' + x.name + ' -> ' + (e && e.message)); } });
    var summary = { total: tests.length, passed: tests.length - failed, failed: failed, results: results };
    root.OBJECTIVE_TEST_RESULT = summary;
    if (typeof console !== 'undefined') console.log(results.join('\n') + '\n' + summary.passed + '/' + summary.total + ' passed');
    return summary;
  }
  /* Browser only, async: load index.html (srcdoc) with no stored choice for the room crew -> the 'Choose your objective' dialog opens and cannot be
     dismissed with Escape; answering it stores the choice. Promise of {ok, detail}. */
  function runObjectiveDialogTest() {
    var p = location.pathname, i0 = p.indexOf('/web/html/'), j0 = p.indexOf('/dist/');
    var prefix = i0 >= 0 ? p.slice(0, i0) : j0 >= 0 ? p.slice(0, j0) : p.indexOf('/jezero-delta-atlas/') >= 0 ? p.slice(0, p.indexOf('/jezero-delta-atlas/')) + '/jezero-delta-atlas' : '/jezero-delta-atlas';
    var base = location.origin + prefix + '/web/html/';   // always the source atlas page, whichever page runs the test
    var keys = ['jda.objective', 'jda.objective.jayesh'], keep = keys.map(function (k) { return localStorage.getItem(k); });
    keys.forEach(function (k) { localStorage.removeItem(k); });
    var f = document.createElement('iframe'); f.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:700px;opacity:0;pointer-events:none';
    var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', code = ''; for (var i = 0; i < 5; i++) code += A.charAt(Math.floor(Math.random() * A.length));   // a fresh room: nothing shared there yet
    f.src = base + 'index.html#room=' + code + '&crew=jayesh'; document.body.appendChild(f);
    function waitFor(fn, ms) { return new Promise(function (res) { var t0 = Date.now(); (function tick() { var v = false; try { v = fn(); } catch (e) { v = false; } if (v || Date.now() - t0 > ms) res(!!v); else setTimeout(tick, 150); })(); }); }
    // wait for the page to initialise: the dialog appears once the room dialog is gone and the first checks ran (up to 15 s on a slow machine)
    return waitFor(function () { return f.contentDocument && f.contentDocument.getElementById('ms-ob-back'); }, 15000).then(function () {
      var d = f.contentDocument, w = f.contentWindow, res = { ok: false, detail: '' };
      var dlg = d.getElementById('ms-ob-back');
      if (!dlg) res.detail = 'no dialog after 15 s (room dialog open: ' + !!d.querySelector('.lu-back') + ', pending: ' + (w.JdaObjective && w.JdaObjective.pending()) + ')'; else {
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        var still = !!d.getElementById('ms-ob-back'), cards = d.querySelectorAll('.ms-ob-card').length;
        d.querySelector('[data-choice="2"]').click();
        var gone = !d.getElementById('ms-ob-back'), got = w.JdaObjective.get();
        res.ok = still && cards === 3 && gone && got === 2; res.detail = 'esc kept open=' + still + ' cards=' + cards + ' closed after answer=' + gone + ' choice=' + got;
      }
      f.remove(); keys.forEach(function (k, i) { if (keep[i] === null) localStorage.removeItem(k); else localStorage.setItem(k, keep[i]); });
      root.OBJECTIVE_DIALOG_RESULT = res; if (typeof console !== 'undefined') console.log('dialog: ' + (res.ok ? 'PASS ' : 'FAIL ') + res.detail);
      return res;
    });
  }
  root.runObjectiveTests = runObjectiveTests; root.runObjectiveDialogTest = runObjectiveDialogTest;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { runObjectiveTests: runObjectiveTests }; if (require.main === module) { var s = runObjectiveTests(); process.exit(s.failed ? 1 : 0); } }
  else {
    var base0 = runObjectiveTests();
    if (browser && root.Atlas) runObjectiveDialogTest().then(function (r) {   // the async dialog check is part of the summary
      var line = (r.ok ? 'PASS ' : 'FAIL ') + 'first-run dialog: Escape keeps it open, answering stores the choice -> ' + r.detail;
      root.OBJECTIVE_TEST_RESULT = { total: base0.total + 1, passed: base0.passed + (r.ok ? 1 : 0), failed: base0.failed + (r.ok ? 0 : 1), results: base0.results.concat([line]), done: true };
      if (typeof console !== 'undefined') console.log(line + '\n' + root.OBJECTIVE_TEST_RESULT.passed + '/' + root.OBJECTIVE_TEST_RESULT.total + ' passed');
    });
  }
})(typeof window !== 'undefined' ? window : globalThis);
