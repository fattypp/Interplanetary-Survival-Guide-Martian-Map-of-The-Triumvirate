/* chat-ui.js: reusable person-to-person chat. window.JdaChat.mount(container, opts) -> api.
   Messages travel through JdaLink (docs/MULTIPAGE.md): {type:'chat', to:'all'|<crewId>|'earth', text, fromName}.
   There are NO automatic replies here: every message shown was typed by a person (or comes from the host page via api.addLocal).
   PRIVACY NOTE: a direct message ('to' = one person) is NOT private. Every message goes through the room-wide link (relay log, local
   storage, online table), so anyone who has the room code, or reads the relay log, can read it. The UI only shows a message to its
   sender and recipient. Do not put secrets in chat.
   All text is written with textContent; everything received is untrusted. */
(function () {
  'use strict';
  var MAX = 500, KEEP = 300;
  var seq = 0;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function clock(iso) { var d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function clean(s, n) { return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').slice(0, n); }
  function slug(s) { return String(s == null ? '' : s).slice(0, 40); }

  function mount(container, opts) {
    opts = opts || {};
    var link = opts.link || window.JdaLink || null;
    var meId = slug(opts.meId || (link && link.room && link.room.id) || 'me');
    var meName = clean(opts.meName || (link && link.room && link.room.name) || 'Crew member', 24).replace(/\s+/g, ' ').trim() || 'Crew member';
    var allowEarth = opts.allowEarth !== false;
    var meIsEarth = meId === 'earth';
    var uid = 'jc' + (++seq);

    var msgs = [];          // {id, conv, mine, fromName, fromId, text, t, local, auto}
    var byId = {};          // dedupe
    var convs = {};         // conv id -> {id, name, unread}
    var order = [];
    var active = opts.initial || 'all';
    var unreadFns = [], sendFns = [], offLink = null, offStatus = null, timer = null, destroyed = false;

    /* ---------- DOM ---------- */
    var root = el('section', 'jc');
    root.setAttribute('aria-label', 'Chat');
    var bar = el('div', 'jc-bar'); bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Conversations');
    var head = el('div', 'jc-head');
    var title = el('h3', 'jc-title'); title.id = uid + '-t';
    var state = el('span', 'jc-state');
    head.appendChild(title); head.appendChild(state);
    var log = el('div', 'jc-log'); log.setAttribute('role', 'log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-relevant', 'additions'); log.tabIndex = 0;
    var form = el('form', 'jc-form');
    var label = el('label', 'jc-sr', 'Message'); label.htmlFor = uid + '-in';
    var input = el('textarea', 'jc-input'); input.id = uid + '-in'; input.rows = 1; input.maxLength = MAX; input.autocomplete = 'off';
    var send = el('button', 'jc-send', 'Send'); send.type = 'submit';
    var row = el('div', 'jc-row'); row.appendChild(input); row.appendChild(send);
    var count = el('span', 'jc-count'); count.setAttribute('aria-hidden', 'true');
    form.appendChild(label); form.appendChild(row); form.appendChild(count);
    root.appendChild(bar); root.appendChild(head); root.appendChild(log); root.appendChild(form);
    container.appendChild(root);

    /* ---------- conversations ---------- */
    function peerList() {
      var p = typeof opts.peers === 'function' ? opts.peers() : opts.peers;
      return Array.isArray(p) ? p : [];
    }
    function ensure(id, name) {
      id = slug(id); if (!id) return null;
      var c = convs[id];
      if (!c) { c = convs[id] = { id: id, name: clean(name || id, 24), unread: 0 }; order.push(id); }
      else if (name && (c.name === c.id || c.name === 'Crew member')) c.name = clean(name, 24);
      return c;
    }
    function syncConvs() {
      ensure('all', 'All crew');
      if (allowEarth && !meIsEarth) ensure('earth', 'Earth control');
      peerList().forEach(function (p) { if (p && p.id && p.role !== 'legacy' && slug(p.id) !== meId) ensure(p.id, p.name); });
      if (meIsEarth && convs.earth) { delete convs.earth; order.splice(order.indexOf('earth'), 1); }
      order = order.filter(function (id) { return convs[id]; });
    }
    function online(id) {
      try {
        var pr = link && link.room && link.presence ? link.presence() : [];
        return pr.some(function (p) { return p && (id === 'earth' ? p.role === 'earth' : p.id === id); });
      } catch (e) { return false; }
    }
    function roomOk() { return !!(link && link.room && link.send); }

    function renderBar() {
      syncConvs();
      bar.textContent = '';
      order.forEach(function (id) {
        var c = convs[id];
        var b = el('button', 'jc-conv' + (id === active ? ' on' : ''));
        b.type = 'button'; b.setAttribute('aria-pressed', id === active ? 'true' : 'false');
        var dot = el('span', 'jc-dot' + (id === 'all' || online(id) ? ' up' : '')); dot.setAttribute('aria-hidden', 'true');
        b.appendChild(dot);
        b.appendChild(el('span', 'jc-cn', c.name));
        if (c.unread) b.appendChild(el('span', 'jc-badge', c.unread > 9 ? '9+' : String(c.unread)));
        b.setAttribute('aria-label', 'Chat with ' + c.name + (id !== 'all' && online(id) ? ', online' : '') + (c.unread ? ', ' + c.unread + ' unread' : ''));
        b.addEventListener('click', function () { select(id); input.focus(); });
        bar.appendChild(b);
      });
    }
    function renderHead() {
      var c = convs[active];
      title.textContent = c ? (active === 'all' ? 'All crew' : 'Chat with ' + c.name) : 'Chat';
      if (!roomOk()) state.textContent = 'Not connected to a room';
      else state.textContent = active === 'all' ? 'Everyone in room ' + link.room.code : (online(active) ? 'Online' : 'Not online right now, they will see this when they return');
      log.setAttribute('aria-label', 'Messages: ' + (c ? c.name : 'chat'));
      input.setAttribute('aria-label', 'Message to ' + (c ? c.name : 'chat'));
    }
    function updateForm() {
      var ok = roomOk();
      input.disabled = !ok; input.placeholder = ok ? 'Type a message, Enter to send' : 'Join a room to chat';
      send.disabled = !ok || !clean(input.value, MAX).trim();
      count.textContent = input.value.length + '/' + MAX;
    }

    /* ---------- messages ---------- */
    function visible() { return !document.hidden && container.offsetParent !== null && root.offsetParent !== null; }
    function renderMsg(m) {
      var d = el('div', 'jc-msg ' + (m.mine ? 'me' : 'them') + (m.auto ? ' auto' : ''));
      var meta = el('div', 'jc-meta', (m.mine ? 'You' : m.fromName) + (active === 'all' && !m.mine ? '' : '') + ' · ' + clock(m.t));
      if (m.auto) meta.appendChild(el('span', 'jc-auto', 'automatic reply, nobody else is online'));
      d.appendChild(meta);
      d.appendChild(el('p', 'jc-text', m.text));
      return d;
    }
    function renderLog() {
      log.textContent = '';
      log.setAttribute('aria-live', 'off');   // switching conversation must not make a screen reader read the whole history
      setTimeout(function () { log.setAttribute('aria-live', 'polite'); }, 100);
      var list = msgs.filter(function (m) { return m.conv === active; });
      if (!list.length) log.appendChild(el('p', 'jc-empty', roomOk() ? 'No messages yet.' : 'Join a room to chat with the crew and Earth control.'));
      list.forEach(function (m) { log.appendChild(renderMsg(m)); });
      log.scrollTop = log.scrollHeight;
    }
    function totals() { var o = {}, n = 0; order.forEach(function (id) { if (convs[id].unread) { o[id] = convs[id].unread; n += convs[id].unread; } }); return { total: n, by: o }; }
    function fireUnread() { var t = totals(); unreadFns.slice().forEach(function (fn) { try { fn(t.total, t.by); } catch (e) { /* host bug */ } }); }

    // Which conversation does a chat message belong to for me? null = not for me.
    function isMine(from) {
      if (!from || typeof from !== 'object') return false;
      return meIsEarth ? from.role === 'earth' : (from.role !== 'earth' && slug(from.id) === meId);
    }
    function convOf(m) {
      var to = slug(m.to), from = m.from && typeof m.from === 'object' ? m.from : {};
      if (isMine(from)) return to || 'all';
      if (to === 'all') return 'all';
      if (to === meId || (meIsEarth && to === 'earth')) return from.role === 'earth' ? 'earth' : slug(from.id);
      return null;
    }
    function add(rec, fresh) {
      if (byId[rec.id]) return false;
      byId[rec.id] = rec;
      ensure(rec.conv, rec.conv === 'earth' ? 'Earth control' : (rec.mine ? null : rec.fromName));
      msgs.push(rec);
      if (msgs.length > KEEP) { var old = msgs.shift(); delete byId[old.id]; }
      var cv = convs[rec.conv];
      if (fresh && !rec.mine && cv && (rec.conv !== active || !visible())) { cv.unread++; renderBar(); fireUnread(); }
      else if (rec.conv !== active || !convs[rec.conv]) renderBar();
      if (rec.conv === active) {
        var e = log.querySelector('.jc-empty'); if (e) log.removeChild(e);
        var stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 40 || rec.mine;
        log.appendChild(renderMsg(rec));
        while (log.children.length > KEEP) log.removeChild(log.firstChild);
        if (stick) log.scrollTop = log.scrollHeight;
      }
      return true;
    }
    function fromLink(m, fresh) {
      if (!m || m.type !== 'chat' || typeof m.id !== 'string' || typeof m.text !== 'string') return;
      var conv = convOf(m); if (!conv) return;
      var from = m.from && typeof m.from === 'object' ? m.from : {};
      var mine = isMine(from);
      add({ id: m.id, conv: conv, mine: mine, fromId: slug(from.id || from.role), t: typeof m.t === 'string' ? m.t : new Date().toISOString(),
        fromName: clean(m.fromName || from.name || from.id || 'Crew member', 24).replace(/\s+/g, ' ').trim() || 'Crew member',
        text: clean(m.text, MAX) }, fresh);
    }

    function select(id) {
      syncConvs();
      if (!convs[id]) return false;
      active = id; convs[id].unread = 0;
      renderBar(); renderHead(); renderLog(); fireUnread();
      return true;
    }

    function submit() {
      var text = clean(input.value, MAX).trim();
      if (!text || !roomOk()) { updateForm(); return false; }
      var to = active;
      var out = { type: 'chat', to: to, text: text, fromName: meName }, sent = null;
      try { sent = link.send(out); } catch (e) { sent = null; }
      if (!sent) { state.textContent = 'Message not sent (too large or the link is not ready). Your text is kept, try again.'; return false; }
      var id = sent && typeof sent.id === 'string' ? sent.id : 'loc' + Date.now().toString(36) + (++seq);
      add({ id: id, conv: to, mine: true, fromId: meId, fromName: meName, text: text, t: (sent && sent.t) || new Date().toISOString() }, false);
      input.value = ''; autosize(); updateForm();
      sendFns.slice().forEach(function (fn) { try { fn({ to: to, text: text, id: id }); } catch (e) { /* host bug */ } });
      return true;
    }
    function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 96) + 'px'; }

    form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
    input.addEventListener('input', function () { autosize(); updateForm(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(); }
    });

    /* ---------- wiring to the link ---------- */
    var loadedFor = null;
    function roomKey() { return link && link.room ? link.room.code + '|' + link.room.role + '|' + link.room.id : null; }
    function loadHistory() {
      loadedFor = roomKey();
      if (!loadedFor || !link || !link.history) return;
      var h = [];
      try { h = link.history(KEEP) || []; } catch (e) { h = []; }
      h.slice().sort(function (a, b) { return String(a && a.t).localeCompare(String(b && b.t)); }).forEach(function (m) { fromLink(m, false); });
    }
    if (link && link.on) {
      var off = link.on(function (m) { if (!destroyed) fromLink(m, !(m && m.replay)); });
      offLink = typeof off === 'function' ? off : null;
    }
    syncConvs();
    loadHistory();
    renderBar(); renderHead(); renderLog(); updateForm();
    // peers appear and disappear (presence); refresh the bar and header every few seconds
    var tk = 0;
    timer = setInterval(function () {
      if (destroyed) return;
      if (roomKey() !== loadedFor) {          // joined (or switched) a room after mount: start from that room's history
        msgs.length = 0; byId = {}; convs = {}; order = []; active = 'all'; syncConvs();
        loadHistory(); renderBar(); renderHead(); renderLog(); updateForm(); fireUnread(); return;
      }
      if (++tk % 3) return;
      renderBar(); renderHead(); updateForm();
      if (convs[active] && convs[active].unread && visible()) { convs[active].unread = 0; renderBar(); fireUnread(); }
    }, 1000);
    document.addEventListener('visibilitychange', onVis);
    function onVis() { if (!document.hidden && visible() && convs[active] && convs[active].unread) { convs[active].unread = 0; renderBar(); fireUnread(); } }

    return {
      el: root,
      select: select,
      active: function () { return active; },
      unread: function () { return totals().total; },
      onUnread: function (fn) { if (typeof fn === 'function') unreadFns.push(fn); },
      onSend: function (fn) { if (typeof fn === 'function') sendFns.push(fn); },
      refresh: function () { renderBar(); renderHead(); updateForm(); },
      focus: function () { input.focus(); },
      markRead: function () { if (convs[active] && convs[active].unread) { convs[active].unread = 0; renderBar(); fireUnread(); } },
      // Host-supplied line (not sent through the link). Used by a host for an explicitly labelled automatic reply.
      addLocal: function (o) {
        if (!o || !o.conv || typeof o.text !== 'string') return false;
        return add({ id: 'loc' + Date.now().toString(36) + (++seq), conv: slug(o.conv), mine: false, fromId: slug(o.conv), fromName: clean(o.fromName || o.conv, 24),
          text: clean(o.text, MAX), t: new Date().toISOString(), auto: !!o.auto }, true);
      },
      destroy: function () {
        destroyed = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVis);
        if (offLink) offLink(); if (root.parentNode) root.parentNode.removeChild(root);
      }
    };
  }

  window.JdaChat = { mount: mount, MAX: MAX };
})();
