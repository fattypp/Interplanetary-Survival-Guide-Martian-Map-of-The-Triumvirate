/* earth.js: Earth control view. Shows SOS alerts sent by the Mars base page through JdaLink.
   All text is written with textContent (messages are untrusted). Everything here is simulated. */
(function () {
  'use strict';
  var alerts = {};   // sos id -> {id, from, lat, lon, t, ackAt}
  var order = [];
  var list = document.getElementById('alerts'), empty = document.getElementById('empty'),
      banner = document.getElementById('banner'), conn = document.getElementById('conn');
  conn.textContent = window.JdaLink.mode === 'online' ? '● online link' : '● same-browser link';

  function name(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, 24) || 'Crew member'; }
  function num(v) { v = Number(v); return isFinite(v) ? v : null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function when(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  function render() {
    empty.hidden = order.length > 0;
    list.textContent = '';
    order.slice().reverse().forEach(function (id) {
      var a = alerts[id], li = el('li', 'alert' + (a.ackAt ? ' acked' : ''));
      var h = el('h3'); h.appendChild(el('span', 'status', a.ackAt ? '■ ACKNOWLEDGED' : '▲ ACTIVE'));
      h.appendChild(document.createTextNode(a.from + ' pressed SOS'));
      li.appendChild(h);
      li.appendChild(el('div', 'meta', 'received ' + when(a.t) + (a.lat !== null ? ' · position (simulated) ' + a.lat.toFixed(4) + '°N, ' + a.lon.toFixed(4) + '°E' : '')));
      if (!a.ackAt) {
        var b = el('button', '', 'Acknowledge'); b.type = 'button';
        b.addEventListener('click', function () { a.ackAt = new Date().toISOString(); window.JdaLink.send({ type: 'ack', sosId: id, by: 'Earth control' }); render(); });
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    var active = order.filter(function (id) { return !alerts[id].ackAt; });
    banner.hidden = !active.length;
    if (active.length) {
      var a = alerts[active[active.length - 1]];
      banner.textContent = '▲ ' + a.from + ' pressed SOS';
      banner.appendChild(el('small', '', active.length > 1 ? active.length + ' active alerts' : 'Simulated alert from the Mars base page'));
      document.title = '▲ SOS: ' + a.from + ' · Earth Mission Control';
    } else document.title = 'Earth Mission Control';
  }

  function handle(m) {
    if (m.type === 'sos') {
      if (alerts[m.id]) return;
      alerts[m.id] = { id: m.id, from: name(m.from), lat: num(m.lat), lon: num(m.lon), t: m.t, ackAt: null };
      order.push(m.id);
    } else if (m.type === 'ack' && alerts[m.sosId]) {
      alerts[m.sosId].ackAt = m.t;
    } else return;
    render();
  }

  window.JdaLink.history().forEach(handle);   // alerts sent before this page was opened
  window.JdaLink.on(handle);
  render();
})();
