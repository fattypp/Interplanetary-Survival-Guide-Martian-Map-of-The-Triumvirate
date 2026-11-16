/* link-ui.js: room join dialog + status chip shared by all pages. Needs js/link.js and css/link-ui.css.
   JdaLinkUI.mount({role, ask:['code','crew'|'name'], id?, name?, position?, onJoin?}) -> {ready: Promise, change()}
   The last room and crew are remembered in localStorage (key jda.linkui.last, independent of the Atlas store);
   #room=CODE in the URL wins over the remembered room. All text is written with textContent. */
(function () {
  'use strict';
  var LAST = 'jda.linkui.last';
  var CREW = [{ id: 'jayesh', name: 'Jayesh' }, { id: 'juhyeok', name: 'Juhyeok' }];
  var uid = 0;

  function el(tag, cls, text, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  function load() { try { var o = JSON.parse(localStorage.getItem(LAST) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function save(o) { try { localStorage.setItem(LAST, JSON.stringify(o)); } catch (e) { /* ignore */ } }
  function hashRaw() {   // the room text in the URL hash as typed (normalised), or null when there is none
    var m = /[#&]room=([^&]*)/.exec(location.hash || '');
    if (!m) return null;
    var raw = m[1];
    try { raw = decodeURIComponent(raw); } catch (e) { /* use as typed */ }
    return window.JdaLink.normCode(raw);
  }
  var BAD_CODE = 'Room codes have 5 letters or digits, no I or O. Check the code or create a new room.';
  function hashBad() { var r = hashRaw(); return r !== null && !window.JdaLink.isValidCode(r); }
  function hashCode() {
    var m = /[#&]room=([^&]*)/.exec(location.hash || '');
    if (!m) return '';
    var raw = m[1];
    try { raw = decodeURIComponent(raw); } catch (e) { /* malformed escape: use the text as typed */ }
    var c = window.JdaLink.normCode(raw);
    return window.JdaLink.isValidCode(c) ? c : '';
  }
  function hashCrew() {   // #room=CODE&crew=jayesh picks a known crew member without asking
    var m = /[#&]crew=([^&]*)/.exec(location.hash || '');
    if (!m) return null;
    var v = m[1];
    try { v = decodeURIComponent(v); } catch (e) { return null; }
    v = slug(v);
    for (var i = 0; i < CREW.length; i++) if (CREW[i].id === v) return CREW[i];
    // crew members added on the control page: any valid id that is not reserved
    if (v && RESERVED.indexOf(v) < 0) return { id: v, name: v.charAt(0).toUpperCase() + v.slice(1) };
    return null;
  }
  var RESERVED = ['all', 'earth', 'legacy', 'control', 'me', 'helmet', 'tablet', 'crew'];
  function linkFor(code) {
    return location.origin + location.pathname + location.search + '#room=' + code;
  }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24); }
  function focusables(root) { return [].slice.call(root.querySelectorAll('button,input,[tabindex]:not([tabindex="-1"])')).filter(function (n) { return !n.disabled && n.offsetParent !== null; }); }

  function mount(opts) {
    opts = opts || {};
    var L = window.JdaLink;
    if (!L) throw new Error('JdaLinkUI needs js/link.js');
    var role = opts.role || 'crew';
    var ask = Array.isArray(opts.ask) ? opts.ask : ['code'];
    var wantCrew = ask.indexOf('crew') >= 0, wantName = ask.indexOf('name') >= 0;
    var root = el('div', 'lu-root');
    var live = el('div', 'lu-live', '', { role: 'status', 'aria-live': 'polite' });
    root.appendChild(live);
    var chip = null, dlg = null, back = null, opener = null, resolveReady;
    var ready = new Promise(function (r) { resolveReady = r; });
    var offs = [];

    function who(saved) {
      if (wantCrew) {
        var hc2 = hashCrew() || (saved.crewId ? null : CREW.filter(function (c) { return c.id === opts.defaultCrew; })[0]);
        if (hc2 && hashCode()) return { role: role, id: hc2.id, name: hc2.name };
        return { role: role, id: saved.crewId || '', name: saved.crewName || '' };
      }
      if (wantName) return { role: role, id: opts.id || role, name: saved.name || opts.name || '' };
      return { role: role, id: opts.id || role, name: opts.name || '' };
    }
    function joinNow(code, info) {
      var r = L.join(code, info);
      var rec = load();
      rec.code = r.code;
      if (wantCrew) { rec.crewId = info.id; rec.crewName = info.name; }
      if (wantName) rec.name = info.name;
      save(rec);
      try { history.replaceState(null, '', location.pathname + location.search + '#room=' + r.code); } catch (e) { /* ignore */ }
      showChip();
      if (typeof opts.onJoin === 'function') { try { opts.onJoin({ code: r.code, role: role, id: info.id, name: info.name }); } catch (e) { if (window.console) console.error(e); } }
      resolveReady(L.room);
      return r;
    }

    /* ----- status chip: a small pill, expands on click/focus into transport, copy link, change room ----- */
    var chipCode, chipN, chipSt, copyBtn, pill, panel, tick = null;
    function joined() { var r = L.room; return !!(r && !r.implicit && r.code !== 'LOCAL' && r.role !== 'legacy'); }
    function statusText(s) { return s === 'relay' ? 'relay' : s === 'online' ? 'online' : 'this browser only'; }
    function refreshChip() {
      if (!chip || !L.room) return;
      var s = L.status, n = L.presence().length;
      chipCode.textContent = L.room.code;
      chipN.textContent = ''; chipN.appendChild(document.createTextNode(String(n))); chipN.appendChild(el('span', 'lu-w', ' online'));
      chipSt.textContent = 'Link: ' + statusText(s);
      chip.setAttribute('data-status', s);
      pill.setAttribute('aria-label', 'Room ' + L.room.code + ', ' + n + ' online, link ' + statusText(s) + '. Show room options');
    }
    function expand(on) {
      if (!chip) return;
      panel.hidden = !on;
      pill.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) refreshChip();
    }
    function showChip() {
      if (!chip) {
        chip = el('div', 'lu-chip', null, { 'data-pos': opts.position || 'top-right', role: 'group', 'aria-label': 'Room link' });
        pill = el('button', 'lu-pill', null, { type: 'button', 'aria-expanded': 'false' });
        pill.appendChild(el('span', 'lu-dot', null, { 'aria-hidden': 'true' }));
        chipCode = el('span', 'lu-code'); pill.appendChild(chipCode);
        pill.appendChild(el('span', 'lu-mute', '\u00b7', { 'aria-hidden': 'true' }));
        chipN = el('span', 'lu-mute'); pill.appendChild(chipN);
        pill.addEventListener('click', function () { expand(panel.hidden); });
        chip.appendChild(pill);
        panel = el('div', 'lu-panel', null, { hidden: 'hidden' });
        chipSt = el('div', 'lu-mute lu-st'); panel.appendChild(chipSt);
        var row = el('div', 'lu-row');
        copyBtn = el('button', 'lu-cbtn', 'Copy link', { type: 'button', 'aria-label': 'Copy link to this room' });
        copyBtn.addEventListener('click', copyLink);
        row.appendChild(copyBtn);
        var chg = el('button', 'lu-cbtn', 'Change room', { type: 'button' });
        chg.addEventListener('click', function () { expand(false); openDialog(pill); });
        row.appendChild(chg);
        panel.appendChild(row);
        chip.appendChild(panel);
        chip.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { e.stopPropagation(); expand(false); pill.focus(); } });
        document.addEventListener('mousedown', function (e) { if (panel && !panel.hidden && !chip.contains(e.target)) expand(false); });
        root.appendChild(chip);
        offs.push(L.onStatus(refreshChip), L.onPresence(refreshChip));
        tick = setInterval(refreshChip, 3000);
      }
      refreshChip();
    }
    function copyLink() {
      var url = linkFor(L.room.code);
      function done(ok) {
        copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
        live.textContent = ok ? 'Room link copied' : 'Could not copy, the link is ' + url;
        setTimeout(function () { copyBtn.textContent = 'Copy link'; }, 1800);
      }
      function fallback() {
        var ta = el('textarea', null, url, { 'aria-hidden': 'true', tabindex: '-1' });
        ta.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(ta); ta.select();
        var ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* ignore */ }
        document.body.removeChild(ta); done(ok);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { done(true); }, fallback);
      else fallback();
    }

    /* ----- dialog ----- */
    function closeDialog() {
      if (!back) return;
      document.removeEventListener('keydown', onKey, true);
      root.removeChild(back); back = dlg = null;
      if (opener && opener.focus) opener.focus();
    }
    function onKey(e) {
      if (!dlg) return;
      if (e.key === 'Escape' && joined()) { e.preventDefault(); closeDialog(); return; }   // first-run dialog stays open
      if (e.key !== 'Tab') return;
      var f = focusables(dlg);
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !dlg.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !dlg.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
    function openDialog(from) {
      if (dlg) return;
      opener = from || null;
      var saved = load(), n = ++uid, firstRun = !joined();
      var cur = joined() ? L.room : null;
      var badHash = hashBad(), codeVal = badHash ? hashRaw().slice(0, 5) : (hashCode() || (cur && cur.code) || saved.code || '');
      back = el('div', 'lu-back');
      dlg = el('div', 'lu-dlg', null, { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'lu-t' + n, 'aria-describedby': 'lu-d' + n });
      dlg.appendChild(el('h2', null, firstRun ? 'Join a room' : 'Change room', { id: 'lu-t' + n }));
      dlg.appendChild(el('p', null, 'Everyone who enters the same room code sees the same messages and mission data. Other codes see nothing of it.', { id: 'lu-d' + n }));
      var form = el('form', null, null, { novalidate: 'novalidate' });
      dlg.appendChild(form);

      form.appendChild(el('label', 'lu-lbl', 'Room code', { for: 'lu-code' + n }));
      var code = el('input', 'lu-input', null, { id: 'lu-code' + n, type: 'text', maxlength: '5', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'K7M2P', 'aria-describedby': 'lu-e' + n });
      code.value = codeVal;
      code.addEventListener('input', function () { var p = code.selectionStart; code.value = L.normCode(code.value).slice(0, 5); try { code.setSelectionRange(p, p); } catch (e) { /* ignore */ } });
      form.appendChild(code);

      var crewOther = null, crewRadios = [], nameIn = null;
      if (wantCrew) {
        var fs = el('fieldset', 'lu-fs'); fs.appendChild(el('legend', null, 'Crew member'));
        var row = el('div', 'lu-row'); fs.appendChild(row);
        var opts2 = CREW.concat([{ id: '', name: 'Other' }]);
        var sel = saved.crewId || '';
        var isCustom = !!sel && !CREW.some(function (c) { return c.id === sel; });
        opts2.forEach(function (c, i) {
          var lab = el('label', 'lu-opt'), r = el('input', null, null, { type: 'radio', name: 'lu-crew' + n, value: c.id || '__other' });
          r.checked = c.id ? c.id === sel : isCustom;
          if (!sel && i === 0) r.checked = true;
          lab.appendChild(r); lab.appendChild(el('span', null, c.name));
          row.appendChild(lab); crewRadios.push(r);
          r.addEventListener('change', syncOther);
        });
        form.appendChild(fs);
        form.appendChild(el('label', 'lu-lbl', 'Your name', { for: 'lu-other' + n, id: 'lu-otherl' + n }));
        crewOther = el('input', 'lu-input lu-text', null, { id: 'lu-other' + n, type: 'text', maxlength: '24', autocomplete: 'off', placeholder: 'Name for the crew list' });
        if (isCustom) crewOther.value = saved.crewName || '';
        form.appendChild(crewOther);
      } else if (wantName) {
        form.appendChild(el('label', 'lu-lbl', 'Your name', { for: 'lu-name' + n }));
        nameIn = el('input', 'lu-input lu-text', null, { id: 'lu-name' + n, type: 'text', maxlength: '24', autocomplete: 'off', placeholder: opts.name || 'Name' });
        nameIn.value = saved.name || opts.name || '';
        form.appendChild(nameIn);
      }
      function syncOther() {
        if (!crewOther) return;
        var other = crewRadios.some(function (r) { return r.checked && r.value === '__other'; });
        crewOther.disabled = !other;
        crewOther.parentNode.querySelector('#lu-otherl' + n).hidden = !other;
        crewOther.hidden = !other;
      }
      var err = el('p', 'lu-err', badHash ? BAD_CODE : '', { id: 'lu-e' + n, role: 'alert' });
      form.appendChild(err);
      var act = el('div', 'lu-act');
      var joinBtn = el('button', 'lu-btn lu-primary', 'Join room', { type: 'submit' });
      var newBtn = el('button', 'lu-btn', 'Create new room', { type: 'button' });
      act.appendChild(joinBtn); act.appendChild(newBtn);
      if (!firstRun) { var cancel = el('button', 'lu-btn lu-quiet', 'Cancel', { type: 'button' }); cancel.addEventListener('click', closeDialog); act.appendChild(cancel); }
      form.appendChild(act);
      syncOther();

      function identity() {
        if (wantCrew) {
          var r = crewRadios.filter(function (x) { return x.checked; })[0];
          if (!r) return { error: 'Choose who you are.' };
          if (r.value !== '__other') { var c = CREW.filter(function (x) { return x.id === r.value; })[0]; return { role: role, id: c.id, name: c.name }; }
          var nm = crewOther.value.trim().slice(0, 24), sl = slug(nm);
          if (!nm) return { error: 'Enter your name.' };
          if (!sl) return { error: 'Use at least one letter A-Z or digit in your name.' };
          if (RESERVED.indexOf(sl) >= 0) return { error: 'That name is reserved. Choose another one.' };
          return { role: role, id: sl, name: nm };
        }
        if (wantName) { var v = nameIn.value.trim().slice(0, 24); return { role: role, id: opts.id || role, name: v || opts.name || '' }; }
        return { role: role, id: opts.id || role, name: opts.name || '' };
      }
      function go(create) {
        err.textContent = '';
        var info = identity();
        if (info.error) { err.textContent = info.error; return; }
        var c = create ? '' : code.value;
        if (!create && !L.isValidCode(c)) { err.textContent = 'A room code has 5 characters, letters (not I or O) and digits 2 to 9. Check it or create a new room.'; code.focus(); return; }
        closeDialog();
        joinNow(c, info);
      }
      form.addEventListener('submit', function (e) { e.preventDefault(); go(false); });
      newBtn.addEventListener('click', function () { go(true); });

      back.appendChild(dlg);
      root.appendChild(back);
      document.addEventListener('keydown', onKey, true);
      (code.value && !badHash ? (wantCrew || wantName ? (crewRadios[0] || nameIn) : joinBtn) : code).focus();
    }

    /* ----- start ----- */
    document.body.appendChild(root);
    var saved = load(), hc = hashCode(), code = hc || saved.code || '';
    var info = who(saved);
    var identityKnown = !wantCrew || !!info.id;
    if (hashBad()) openDialog(null);   // a broken code in the URL never falls back to the remembered room
    else if (code && identityKnown && L.isValidCode(code)) joinNow(code, info);
    else openDialog(null);

    function onHash() {
      var c = hashCode();
      if (!c && hashBad() && !dlg) { openDialog(null); return; }
      if (!c || (L.room && L.room.code === c && joined())) return;
      var sv = load(), inf = who(sv);
      if (!wantCrew || inf.id) { if (dlg) closeDialog(); joinNow(c, inf); }
      else if (dlg) { var ci = dlg.querySelector('.lu-input'); if (ci) ci.value = c; }
      else openDialog(null);
    }
    window.addEventListener('hashchange', onHash);
    offs.push(function () { window.removeEventListener('hashchange', onHash); if (tick) clearInterval(tick); });
    return { ready: ready, change: function () { openDialog(null); }, destroy: function () { offs.forEach(function (f) { f(); }); if (root.parentNode) root.parentNode.removeChild(root); } };
  }

  window.JdaLinkUI = { mount: mount };
})();
