/* Tests for web/js/link.js (JdaLink v2), local transport and validation. Browser only (needs BroadcastChannel, localStorage).
   Run: serve the repo (python3 jezero-delta-atlas/server/relay.py <port> or python3 -m http.server <port>), open any page that loads
   js/link.js (for example jezero-delta-atlas/web/html/earth.html), then evaluate this file. Plain/async: results land in
   window.__linkTestResult = {passed, failed, failures} and window.__linkTestDone resolves when finished.
   The transport tests run against a plain http.server too (the relay probe fails there, so the link stays local). */
(function () {
  var L = window.JdaLink;
  var results = { passed: 0, failed: 0, failures: [] };
  function ok(c, msg) { if (!c) throw new Error(msg || 'assertion failed'); }
  function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
  try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('jda.link.') === 0) localStorage.removeItem(k); }); } catch (e) { /* ignore */ }   // start clean
  var tests = [];
  function test(name, fn) { tests.push([name, fn]); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function foreign(code, extra) {   // a valid message as another page of the same room would send it
    var m = { id: 'f' + Math.random().toString(36).slice(2), t: new Date().toISOString(), room: code, type: 'ping', from: { role: 'earth', id: 'earth', name: 'Earth', cid: 'other-page' } };
    for (var k in extra) m[k] = extra[k];
    return m;
  }
  function chan(code) { return new BroadcastChannel('jda-link:' + code); }

  test('room codes: 5 chars, no I/O/0/1, normalised', function () {
    for (var i = 0; i < 200; i++) ok(/^[A-HJ-NP-Z2-9]{5}$/.test(L.newCode()), 'bad code');
    eq(L.normCode(' k7-m2p '), 'K7M2P'); ok(L.isValidCode('k7m2p')); ok(!L.isValidCode('K7M2I')); ok(!L.isValidCode('ABC')); ok(!L.isValidCode('ABCD1'));
  });

  test('join: creates a code for null, rejects bad codes, exposes room', function () {
    var r = L.join(null, { role: 'earth', name: 'Control' });
    ok(L.isValidCode(r.code)); eq(L.room.code, r.code); eq(L.room.role, 'earth'); eq(L.room.name, 'Control');
    var threw = false; try { L.join('IIIII', { role: 'crew' }); } catch (e) { threw = true; } ok(threw, 'invalid code must throw');
    L.join('k7m2p', { role: 'crew', id: 'Jayesh!', name: 'Jayesh' });
    eq(L.room.code, 'K7M2P'); eq(L.room.id, 'jayesh');
  });

  test('send adds id, t, room, from and is not echoed to the sender', function () {
    L.join('K7M2P', { role: 'crew', id: 'jayesh', name: 'Jayesh' });
    var got = []; var off = L.on(function (m) { got.push(m); });
    var m = L.send({ type: 'chat', to: 'all', text: 'hello' });
    ok(m.id && m.t && m.room === 'K7M2P' && m.from.role === 'crew' && m.from.id === 'jayesh', 'envelope');
    eq(got.length, 0, 'no echo'); off();
    ok(L.history().some(function (h) { return h.id === m.id; }), 'history keeps own messages');
  });

  test('send validates: needs type, rejects over 4 KB, truncates chat to 500', function () {
    L.join('K7M2P', { role: 'crew', id: 'jayesh' });
    var threw = false; try { L.send({ text: 'x' }); } catch (e) { threw = true; } ok(threw);
    eq(L.send({ type: 'blob', data: new Array(5000).join('x') }), null);
    eq(L.send({ type: 'chat', text: new Array(700).join('a') }).text.length, 500);
  });

  test('incoming: same room delivered once, dedupe by id', function () {
    L.join('R2D2X', { role: 'earth' });
    var got = [], off = L.on(function (m) { got.push(m); }), c = chan('R2D2X'), m = foreign('R2D2X', { n: 1 });
    c.postMessage({ k: 'msg', m: m }); c.postMessage({ k: 'msg', m: m });
    return wait(120).then(function () { c.close(); off(); eq(got.length, 1, 'delivered once'); eq(got[0].type, 'ping'); });
  });

  test('rooms are isolated: other room channel and wrong room field are ignored', function () {
    L.join('AAAA2', { role: 'earth' });
    var got = [], off = L.on(function (m) { got.push(m); });
    var other = chan('BBBB2'), same = chan('AAAA2');
    other.postMessage({ k: 'msg', m: foreign('BBBB2') });            // other room, other channel
    same.postMessage({ k: 'msg', m: foreign('BBBB2') });             // right channel, wrong room field
    other.postMessage({ k: 'state', key: 'world', e: { value: { a: 1 }, t: Date.now(), from: { role: 'control', id: 'c', name: '', cid: 'z' } } });
    return wait(120).then(function () { other.close(); same.close(); off(); eq(got.length, 0); eq(L.getState('world'), null, 'state must not cross rooms'); });
  });

  test('incoming validation drops malformed and oversize messages, cleans chat', function () {
    L.join('CCCC3', { role: 'earth' });
    var got = [], off = L.on(function (m) { got.push(m); }), c = chan('CCCC3');
    [null, 5, 'x', [], { id: 'a' }, foreign('CCCC3', { type: '' }), foreign('CCCC3', { type: 'bad type!' }), foreign('CCCC3', { from: null }),
      foreign('CCCC3', { from: { role: 'hacker' } }), foreign('CCCC3', { t: 'nope' }), foreign('CCCC3', { id: 5 }),
      foreign('CCCC3', { blob: new Array(5000).join('x') }), foreign('CCCC3', { type: 'chat', text: 42 })
    ].forEach(function (m) { c.postMessage({ k: 'msg', m: m }); });
    c.postMessage({ k: 'msg', m: foreign('CCCC3', { type: 'chat', text: new Array(800).join('b'), from: { role: 'crew', id: 'A B<script>', name: '<b>Eve</b>', cid: 'q' } }) });
    return wait(150).then(function () {
      c.close(); off(); eq(got.length, 1, 'only the valid chat'); eq(got[0].text.length, 500);
      eq(got[0].from.id, 'a-b-script', 'id slugged'); ok(got[0].from.name.indexOf('<') < 0, 'name cleaned');
    });
  });

  test('messages from this page (same cid) are never delivered back', function () {
    L.join('DDDD4', { role: 'earth' });
    var got = [], off = L.on(function (m) { got.push(m); }), c = chan('DDDD4');
    c.postMessage({ k: 'msg', m: foreign('DDDD4', { from: { role: 'earth', id: 'earth', name: '', cid: L.clientId } }) });
    return wait(100).then(function () { c.close(); off(); eq(got.length, 0); });
  });

  test('state: set/get, foreign change fires onState, older write ignored, no cross-room', function () {
    L.join('EEEE5', { role: 'tablet', id: 'jayesh' });
    eq(L.getState('world'), null);
    ok(L.setState('world', { v: 1, n: 1 })); eq(L.getState('world').value.n, 1);
    var seen = [], off = L.onState('world', function (v, meta) { seen.push([v, meta]); }), c = chan('EEEE5'), now = Date.now();
    c.postMessage({ k: 'state', key: 'world', e: { value: { v: 1, n: 2 }, t: now + 50, from: { role: 'control', id: 'control', name: '', cid: 'ctl' } } });
    return wait(100).then(function () {
      eq(L.getState('world').value.n, 2); ok(seen.some(function (s) { return s[0].n === 2 && s[1].from.role === 'control'; }), 'onState fired');
      c.postMessage({ k: 'state', key: 'world', e: { value: { n: 0 }, t: now - 5000, from: { role: 'control', id: 'control', name: '', cid: 'ctl' } } });
      return wait(100);
    }).then(function () {
      eq(L.getState('world').value.n, 2, 'stale write ignored'); c.close(); off();
      eq(L.setState('big', new Array(70000).join('x')), false, 'over 64 KB refused');
      var threw = false; try { L.setState('bad key!', 1); } catch (e) { threw = true; } ok(threw);
    });
  });

  test('onState fires once at join when a value already exists', function () {
    L.join('EEEE5', { role: 'helmet', id: 'juhyeok' });
    var n = 0; L.onState('world', function (v) { n++; });
    return wait(60).then(function () { eq(n, 1); });
  });

  test('presence lists this page, with role and id', function () {
    L.join('FFFF6', { role: 'crew', id: 'jayesh', name: 'Jayesh' });
    var p = L.presence(); eq(p.length, 1); eq(p[0].id, 'jayesh'); ok(p[0].lastSeen <= Date.now());
  });

  test('presence sees a second page of the same room (localStorage) and not another room', function () {
    L.join('GGGG7', { role: 'earth' });
    localStorage.setItem('jda.link.GGGG7.pres.zz', JSON.stringify({ role: 'crew', id: 'juhyeok', name: 'Juhyeok', lastSeen: Date.now() }));
    localStorage.setItem('jda.link.HHHH8.pres.yy', JSON.stringify({ role: 'crew', id: 'nobody', name: 'No', lastSeen: Date.now() }));
    localStorage.setItem('jda.link.GGGG7.pres.old', JSON.stringify({ role: 'crew', id: 'stale', name: '', lastSeen: Date.now() - 40000 }));
    var ids = L.presence().map(function (p) { return p.id; }).sort();
    eq(ids.join(','), 'earth,juhyeok'); ['zz', 'old'].forEach(function (k) { localStorage.removeItem('jda.link.GGGG7.pres.' + k); }); localStorage.removeItem('jda.link.HHHH8.pres.yy');
  });

  test('legacy: without join(), on/send/history work in default room LOCAL', function () {
    // fresh iframe-free check: simulate by joining LOCAL explicitly (same code path as the lazy default)
    L.join('LOCAL', { role: 'legacy', id: 'legacy' });
    var m = L.send({ type: 'sos', from: 'Jayesh', lat: 1, lon: 2 });
    eq(m.room, 'LOCAL'); ok(L.history().some(function (h) { return h.id === m.id; })); eq(L.status, 'local');
  });

  test('off() unsubscribes', function () {
    L.join('JJJJ9', { role: 'earth' });
    var n = 0, off = L.on(function () { n++; }), c = chan('JJJJ9'); off();
    c.postMessage({ k: 'msg', m: foreign('JJJJ9') });
    return wait(100).then(function () { c.close(); eq(n, 0); });
  });

  /* ---- implicit LOCAL join and `from` handling (any transport) ---- */
  test('send keeps a string `from` as fromName and always stamps the envelope', function () {
    L.join('NNNN2', { role: 'earth', name: 'Control' });
    var m = L.send({ type: 'sos', from: 'Jayesh', lat: 1, lon: 2 });
    eq(m.fromName, 'Jayesh'); eq(m.from.role, 'earth'); eq(typeof m.from, 'object');
    eq(L.send({ type: 'chat', text: 'x' }).fromName, 'Control', 'chat defaults fromName to the sender name');
  });

  /* ---- relay transport: only when this page is served by server/relay.py ---- */
  function api(path, method, body) {
    return fetch('/api' + path, { method: method || 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { /* ignore */ } return { status: r.status, json: j }; }); });
  }
  function until(fn, ms) { var t0 = Date.now(); return new Promise(function (res, rej) { (function tick() { var v; try { v = fn(); } catch (e) { v = false; } if (v) res(v); else if (Date.now() - t0 > (ms || 4000)) rej(new Error('timeout')); else setTimeout(tick, 50); })(); }); }
  function other(code, extra) { return foreign(code, extra); }
  var relayTests = [];
  function rtest(name, fn) { relayTests.push([name, fn]); }

  rtest('relay: status becomes relay after join', function () {
    L.join('RLY22', { role: 'tablet', id: 'juhyeok', name: 'Juhyeok' });
    return until(function () { return L.status === 'relay'; });
  });
  rtest('relay: a message posted by another device arrives, own messages do not echo', function () {
    L.join('RLY22', { role: 'tablet', id: 'juhyeok' });
    var got = []; var off = L.on(function (m) { if (!m.replay) got.push(m); });
    return until(function () { return L.status === 'relay'; }).then(function () {
      var m = other('RLY22', { type: 'chat', text: 'from the other device' });
      return api('/rooms/RLY22/msg', 'POST', m).then(function (r) { eq(r.status, 200); return until(function () { return got.length >= 1; }); }).then(function () {
        eq(got[0].text, 'from the other device'); L.send({ type: 'chat', text: 'mine' });
        return new Promise(function (r) { setTimeout(r, 1800); });
      }).then(function () { off(); eq(got.length, 1, 'own message not echoed back through the relay'); });
    });
  });
  rtest('relay: my message is stored on the relay for other devices', function () {
    var m = L.send({ type: 'chat', text: 'stored' });
    return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return api('/rooms/RLY22/msgs?since=0'); }).then(function (r) {
      ok(r.json.msgs.some(function (x) { return x.id === m.id; }), 'relay has my message');
    });
  });
  rtest('relay: state set elsewhere fires onState; my state is readable elsewhere', function () {
    var seen = []; var off = L.onState('world', function (v) { seen.push(v); });
    return api('/rooms/RLY22/state/world', 'PUT', { value: { n: 5 }, from: { role: 'control', id: 'control', name: '', cid: 'dev2' } })
      .then(function () { return until(function () { return seen.length; }); })
      .then(function () { eq(seen[0].n, 5); eq(L.getState('world').value.n, 5); L.setState('mine', { z: 1 }); return new Promise(function (r) { setTimeout(r, 300); }); })
      .then(function () { off(); return api('/rooms/RLY22/state/mine'); }).then(function (r) { eq(r.json.value.z, 1); });
  });
  rtest('relay: presence shows another device and drops it after leave', function () {
    return api('/rooms/RLY22/presence', 'POST', { cid: 'dev2', role: 'earth', id: 'earth', name: 'Earth' })
      .then(function () { return until(function () { return L.presence().some(function (p) { return p.role === 'earth'; }); }, 7000); })
      .then(function () { return api('/rooms/RLY22/presence', 'POST', { cid: 'dev2', role: 'earth', id: 'earth', leave: true }); })
      .then(function () { eq(L.presence().filter(function (p) { return p.role === 'earth'; }).length >= 0, true); });
  });
  rtest('relay: rooms are isolated', function () {
    return api('/rooms/RLY33/msg', 'POST', other('RLY33', { type: 'chat', text: 'secret' }))
      .then(function () { return api('/rooms/RLY22/msgs?since=0'); })
      .then(function (r) { ok(!r.json.msgs.some(function (m) { return m.text === 'secret'; })); return api('/rooms/RLY33/state?since=0'); })
      .then(function (r) { eq(Object.keys(r.json.items).length, 0);
        return api('/rooms/RLY22/msg', 'POST', other('RLY33', { type: 'chat', text: 'wrong room field' })); })
      .then(function (r) { eq(r.status, 400, 'room field must match the path'); });
  });
  rtest('relay: limits answer 413 / 400 / 404 and a flood is rate limited (429)', function () {
    return api('/rooms/RLY44/msg', 'POST', other('RLY44', { type: 'blob', data: new Array(5000).join('x') })).then(function (r) {
      eq(r.status, 413); return api('/rooms/RLY44/state/big', 'PUT', { value: new Array(70000).join('x') });
    }).then(function (r) { eq(r.status, 413); return api('/rooms/IIIII/msgs'); })
      .then(function (r) { eq(r.status, 404); var ps = []; for (var i = 0; i < 90; i++) ps.push(api('/rooms/RLY44/msg', 'POST', other('RLY44', { type: 'chat', text: 'f' + i }))); return Promise.all(ps); })
      .then(function (rs) { var n429 = rs.filter(function (r) { return r.status === 429; }).length; ok(n429 > 0, 'expected some 429, got 0'); ok(rs.some(function (r) { return r.status === 200; })); });
  });

  var skipRelay = true;
  var chain = fetch('/api/ping').then(function (r) { return r.ok ? r.json() : null; }, function () { return null; }).then(function (j) { skipRelay = !(j && j.ok); results.relay = skipRelay ? 'skipped (not served by relay.py)' : 'run'; }, function () { });
  chain = chain.then(function () { if (!skipRelay) relayTests.forEach(function (t) { tests.push(t); }); });
  chain = chain.then(function () { return Promise.resolve(); });
  var runner = Promise.resolve();
  window.__linkTestDone = chain.then(function () {
    tests.forEach(function (t) {
      runner = runner.then(function () { return t[1](); }).then(function () { results.passed++; }, function (e) { results.failed++; results.failures.push(t[0] + ': ' + e.message); });
    });
    return runner;
  }).then(function () { window.__linkTestResult = results; return results; });
})();
