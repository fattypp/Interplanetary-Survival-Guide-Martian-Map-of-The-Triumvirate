#!/usr/bin/env python3
"""relay.py: tiny same-origin relay for JdaLink v2 (web/js/link.js). Python 3 standard library only.

Serves the repository root statically AND the /api endpoints below, so pages opened from any device on the same network
(http://<lan-ip>:<port>/jezero-delta-atlas/dist/...) share messages, state and presence per ROOM CODE.

    python3 jezero-delta-atlas/server/relay.py [port]        (default 8000, binds 0.0.0.0)

API (JSON, same origin only; no CORS headers are sent, cross-origin writes are refused):
    GET  /api/ping
    POST /api/rooms/<code>/msg                body: message object (<= 4 KB)
    GET  /api/rooms/<code>/msgs?since=<n>     -> {msgs:[...], next:n, reset?:true}
    PUT  /api/rooms/<code>/state/<key>        body: {value, from?} (<= 64 KB)
    GET  /api/rooms/<code>/state/<key>        -> entry or 404
    GET  /api/rooms/<code>/state?since=<n>    -> {ver:n, items:{key:entry}} (only entries changed after n)
    POST /api/rooms/<code>/presence           body: {cid, role, id, name} -> {list:[{cid,role,id,name,age}]}
    GET  /api/rooms/<code>/presence
Rooms live in memory only and expire after 12 h without any request. Room codes: 5 chars, A-Z without I/O and 2-9.
"""
import json
import os
import re
import socket
import sys
import threading
import time
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CODE_RE = re.compile(r'^[A-HJ-NP-Z2-9]{5}$')
KEY_RE = re.compile(r'^[A-Za-z0-9:_.-]{1,64}$')
TYPE_RE = re.compile(r'^[A-Za-z0-9_.-]{1,32}$')
ROLES = ('crew', 'earth', 'control', 'helmet', 'tablet', 'legacy')
MAX_MSG = 4096
MAX_STATE = 65536
MAX_BODY = MAX_STATE + 2048
IDLE_SECONDS = 12 * 3600
MAX_ROOMS = 300
MAX_BACKLOG = 200
MAX_STATE_KEYS = 32
MAX_PRESENCE = 64
PRESENCE_TTL = 60
MAX_ROOMS_PER_IP = 20     # rooms one client address may create
MAX_CONNS = 96            # simultaneous connections (threads) overall
MAX_CONNS_PER_IP = 40
CONN_TIMEOUT = 10         # seconds a connection may stay silent (slow-client guard)
ALLOWED_HOSTS = {'localhost', '127.0.0.1', '::1'}   # extended in main(): LAN IPs, host name, --allow-host
MSG_RATE = 30            # messages per second per room (burst 60)
REQ_RATE = 120           # requests per second per client IP (burst 300)

EPOCH = '%x%04x' % (int(time.time()), os.getpid() & 0xffff)   # changes on every relay start: clients detect a restart and republish
LOCK = threading.Lock()
ROOMS = {}
BUCKETS = {}


class Bucket:
    def __init__(self, rate, burst):
        self.rate, self.burst, self.tokens, self.t = rate, burst, burst, time.monotonic()

    def take(self):
        now = time.monotonic()
        self.tokens = min(self.burst, self.tokens + (now - self.t) * self.rate)
        self.t = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


class Room:
    def __init__(self):
        self.seq = 0
        self.msgs = []        # [(seq, msg)]
        self.ids = set()
        self.state = {}       # key -> entry
        self.ver = 0
        self.pres = {}        # cid -> {role,id,name,seen}
        self.last = time.time()
        self.creator = ''
        self.bucket = Bucket(MSG_RATE, MSG_RATE * 2)


def jsize(o):
    """Size of the JSON text in UTF-8 bytes (what actually travels; emoji and CJK are not inflated by \\u escapes)."""
    return len(json.dumps(o, separators=(',', ':'), ensure_ascii=False).encode('utf-8', 'replace'))


def clean(s, n):
    return re.sub(r'\s+', ' ', re.sub(r'[\x00-\x1f<>]', ' ', str(s if s is not None else ''))).strip()[:n]


def clean_from(f):
    if not isinstance(f, dict) or f.get('role') not in ROLES:
        return None
    return {'role': f['role'], 'id': re.sub(r'[^a-z0-9_-]+', '-', str(f.get('id', '')).lower()).strip('-')[:32],
            'name': clean(f.get('name'), 24), 'cid': str(f.get('cid', ''))[:40]}


def sweep():
    cut = time.time() - IDLE_SECONDS
    for c in [c for c, r in ROOMS.items() if r.last < cut]:
        del ROOMS[c]
    for ip in [ip for ip, b in BUCKETS.items() if time.monotonic() - b.t > 300]:
        del BUCKETS[ip]


def get_room(code, create, ip=''):
    r = ROOMS.get(code)
    if r is None and create:
        if len(ROOMS) >= MAX_ROOMS or sum(1 for x in ROOMS.values() if x.creator == ip) >= MAX_ROOMS_PER_IP:
            return None
        r = ROOMS[code] = Room()
        r.creator = ip
    if r:
        r.last = time.time()
    return r


def lan_ips():
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('10.255.255.255', 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            ips.add(ip)
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    timeout = CONN_TIMEOUT
    last_sweep = 0.0

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if os.environ.get('RELAY_VERBOSE'):
            super().log_message(fmt, *args)

    # ---- responses ----
    def send_json(self, code, obj):
        body = json.dumps(obj, separators=(',', ':')).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def fail(self, code, text):
        self.send_json(code, {'ok': False, 'error': text})

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    # ---- request plumbing ----
    def gate(self):
        """Host allow-list (blocks DNS rebinding), no chunked bodies, Content-Length required on writes. True = go on."""
        host = (self.headers.get('Host') or '').strip().lower()
        name = host[1:host.index(']')] if host.startswith('[') and ']' in host else host.rsplit(':', 1)[0] if host.count(':') == 1 else host
        if name not in ALLOWED_HOSTS:
            self.close_connection = True
            self.fail(HTTPStatus.FORBIDDEN, 'host not allowed (start the relay with --allow-host %s to permit it)' % (name or 'NAME'))
            return False
        if self.command in ('POST', 'PUT'):
            if self.headers.get('Transfer-Encoding'):
                self.close_connection = True
                self.fail(HTTPStatus.LENGTH_REQUIRED, 'chunked bodies are not supported, send Content-Length')
                return False
            if self.headers.get('Content-Length') is None:
                self.close_connection = True
                self.fail(HTTPStatus.LENGTH_REQUIRED, 'Content-Length required')
                return False
        return True

    def same_origin(self):
        origin = self.headers.get('Origin')
        if not origin:
            return True
        host = self.headers.get('Host', '')
        return urlparse(origin).netloc == host

    def read_payload(self):
        """Reads and parses the JSON body of POST/PUT (before any lock is taken). Returns (ok, value)."""
        try:
            n = int(self.headers.get('Content-Length') or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_BODY:
            self.close_connection = True
            self.fail(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, 'body too large')
            return False, None
        raw = self.rfile.read(n) if n else b''
        try:
            return True, json.loads(raw.decode('utf-8') or 'null')
        except (ValueError, UnicodeDecodeError, RecursionError):
            self.fail(HTTPStatus.BAD_REQUEST, 'invalid JSON')
            return False, None

    def dispatch(self):
        u = urlparse(self.path)
        parts = [unquote(p) for p in u.path.split('/') if p]
        if parts[:1] != ['api']:
            return False
        ip = self.client_address[0]
        with LOCK:
            now = time.time()
            if now - Handler.last_sweep > 60:
                Handler.last_sweep = now
                sweep()
            b = BUCKETS.setdefault(ip, Bucket(REQ_RATE, REQ_RATE * 2.5))
            ok = b.take()
        if not ok:
            self.fail(HTTPStatus.TOO_MANY_REQUESTS, 'rate limit')
            return True
        if self.command in ('POST', 'PUT') and not self.same_origin():
            self.fail(HTTPStatus.FORBIDDEN, 'cross-origin requests are not allowed')
            return True
        self.payload = None
        if self.command in ('POST', 'PUT'):
            ok, self.payload = self.read_payload()
            if not ok:
                return True
        q = parse_qs(u.query)
        try:
            since = max(0, int(q.get('since', ['0'])[0]))
        except ValueError:
            since = 0
        if parts == ['api', 'ping'] and self.command == 'GET':
            with LOCK:
                n = len(ROOMS)
            self.send_json(200, {'ok': True, 'v': 2, 'rooms': n, 'epoch': EPOCH})
            return True
        if len(parts) < 4 or parts[1] != 'rooms' or not CODE_RE.match(parts[2]):
            self.fail(HTTPStatus.NOT_FOUND, 'unknown endpoint or invalid room code')
            return True
        code, what = parts[2], parts[3]
        if what == 'msg' and self.command == 'POST' and len(parts) == 4:
            return self.h_msg(code)
        if what == 'msgs' and self.command == 'GET' and len(parts) == 4:
            return self.h_msgs(code, since)
        if what == 'state' and len(parts) == 5 and self.command == 'PUT':
            return self.h_state_put(code, parts[4])
        if what == 'state' and len(parts) == 5 and self.command == 'GET':
            return self.h_state_get(code, parts[4])
        if what == 'state' and len(parts) == 4 and self.command == 'GET':
            return self.h_state_all(code, since)
        if what == 'presence' and len(parts) == 4 and self.command in ('POST', 'GET'):
            return self.h_presence(code)
        self.fail(HTTPStatus.NOT_FOUND, 'unknown endpoint')
        return True

    # ---- handlers ----
    def h_msg(self, code):
        m = self.payload
        if not isinstance(m, dict) or jsize(m) > MAX_MSG:
            self.fail(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, 'message too large or not an object')
            return True
        if (not isinstance(m.get('id'), str) or not 0 < len(m['id']) <= 64 or not isinstance(m.get('type'), str)
                or not TYPE_RE.match(m['type']) or m.get('room') != code or clean_from(m.get('from')) is None
                or not isinstance(m.get('t'), str)):
            self.fail(HTTPStatus.BAD_REQUEST, 'invalid message (id, type, t, room, from required; room must match)')
            return True
        m['from'] = clean_from(m['from'])
        m.pop('seq', None)
        with LOCK:
            r = get_room(code, True, self.client_address[0])
            if r is None:
                self.fail(HTTPStatus.SERVICE_UNAVAILABLE, 'too many rooms (limit per client or total)')
                return True
            if m['id'] in r.ids:
                self.send_json(200, {'ok': True, 'dup': True})
                return True
            if not r.bucket.take():
                self.fail(HTTPStatus.TOO_MANY_REQUESTS, 'room message rate limit')
                return True
            r.seq += 1
            r.msgs.append((r.seq, m))
            r.ids.add(m['id'])
            if len(r.msgs) > MAX_BACKLOG:
                old = r.msgs.pop(0)
                r.ids.discard(old[1]['id'])
            seq = r.seq
        self.send_json(200, {'ok': True, 'seq': seq})
        return True

    def h_msgs(self, code, since):
        with LOCK:
            r = get_room(code, False)
            if r is None:
                self.send_json(200, {'msgs': [], 'next': 0, 'epoch': EPOCH, **({'reset': True} if since > 0 else {})})
                return True
            reset = since > r.seq
            out = [m for s, m in r.msgs if reset or s > since]
            nxt = r.seq
        d = {'msgs': out, 'next': nxt, 'epoch': EPOCH}
        if reset:
            d['reset'] = True
        self.send_json(200, d)
        return True

    def h_state_put(self, code, key):
        if not KEY_RE.match(key):
            self.fail(HTTPStatus.BAD_REQUEST, 'bad key')
            return True
        b = self.payload
        if not isinstance(b, dict) or 'value' not in b:
            self.fail(HTTPStatus.BAD_REQUEST, 'body needs a value')
            return True
        if jsize(b['value']) > MAX_STATE:
            self.fail(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, 'state too large')
            return True
        frm = clean_from(b.get('from')) or {'role': 'legacy', 'id': '', 'name': '', 'cid': ''}
        with LOCK:
            r = get_room(code, True, self.client_address[0])
            if r is None:
                self.fail(HTTPStatus.SERVICE_UNAVAILABLE, 'too many rooms (limit per client or total)')
                return True
            if key not in r.state and len(r.state) >= MAX_STATE_KEYS:
                self.fail(HTTPStatus.INSUFFICIENT_STORAGE, 'too many state keys')
                return True
            r.ver += 1
            r.state[key] = {'value': b['value'], 't': int(time.time() * 1000), 'from': frm, 'ver': r.ver}
            ver = r.ver
        self.send_json(200, {'ok': True, 'ver': ver})
        return True

    def h_state_get(self, code, key):
        with LOCK:
            r = get_room(code, False)
            e = r.state.get(key) if r else None
        if e is None:
            self.fail(HTTPStatus.NOT_FOUND, 'no such state')
        else:
            self.send_json(200, e)
        return True

    def h_state_all(self, code, since):
        with LOCK:
            r = get_room(code, False)
            if r is None:
                self.send_json(200, {'ver': 0, 'items': {}, 'epoch': EPOCH, **({'reset': True} if since > 0 else {})})
                return True
            reset = since > r.ver
            items = {k: e for k, e in r.state.items() if reset or e['ver'] > since}
            ver = r.ver
        d = {'ver': ver, 'items': items, 'epoch': EPOCH}
        if reset:
            d['reset'] = True
        self.send_json(200, d)
        return True

    def h_presence(self, code):
        now = time.time()
        with LOCK:
            r = get_room(code, self.command == 'POST', self.client_address[0])
            if r is None:
                self.send_json(200, {'list': []})
                return True
            if self.command == 'POST':
                b = self.payload
                f = clean_from(b) if isinstance(b, dict) else None
                cid = str(b.get('cid', ''))[:40] if isinstance(b, dict) else ''
                if f is None or not cid:
                    self.fail(HTTPStatus.BAD_REQUEST, 'presence needs cid and role')
                    return True
                if b.get('leave'):
                    r.pres.pop(cid, None)
                elif cid in r.pres or len(r.pres) < MAX_PRESENCE:
                    r.pres[cid] = {'role': f['role'], 'id': f['id'], 'name': f['name'], 'seen': now}
            for c in [c for c, p in r.pres.items() if now - p['seen'] > PRESENCE_TTL]:
                del r.pres[c]
            lst = [{'cid': c, 'role': p['role'], 'id': p['id'], 'name': p['name'], 'age': int((now - p['seen']) * 1000)}
                   for c, p in r.pres.items()]
        self.send_json(200, {'list': lst})
        return True

    # ---- verbs ----
    def do_GET(self):
        if not self.gate():
            return
        if self.path.split('?')[0].startswith('/api/') or self.path.split('?')[0] == '/api':
            return self.dispatch()
        if self.hidden():
            return self.fail(HTTPStatus.NOT_FOUND, 'not found')
        if self.path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/jezero-delta-atlas/dist/')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return
        return super().do_GET()

    do_HEAD = do_GET

    def do_POST(self):
        self.api_write()

    do_PUT = do_POST

    def api_write(self):
        if not self.gate():
            return
        if not self.path.startswith('/api/'):
            self.close_connection = True
            return self.fail(HTTPStatus.METHOD_NOT_ALLOWED, 'method not allowed')
        self.dispatch()

    def do_OPTIONS(self):
        if not self.gate():
            return   # CORS is off: no preflight is ever approved
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def hidden(self):
        parts = unquote(urlparse(self.path).path).split('/')
        return any(p.startswith('.') or p == '__pycache__' for p in parts if p)


class BoundedServer(ThreadingHTTPServer):
    """Threaded server with a cap on simultaneous connections (overall and per client address)."""
    daemon_threads = True
    request_queue_size = 64

    def __init__(self, *a, **kw):
        super().__init__(*a, **kw)
        self.slots = threading.BoundedSemaphore(MAX_CONNS)
        self.per_ip = {}
        self.per_ip_lock = threading.Lock()

    def process_request(self, request, client_address):
        ip = client_address[0]
        with self.per_ip_lock:
            n = self.per_ip.get(ip, 0)
            ok = n < MAX_CONNS_PER_IP and self.slots.acquire(blocking=False)
            if ok:
                self.per_ip[ip] = n + 1
        if not ok:
            try:
                request.sendall(b'HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
            except OSError:
                pass
            self.shutdown_request(request)
            return
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            with self.per_ip_lock:
                ip = client_address[0]
                self.per_ip[ip] = max(0, self.per_ip.get(ip, 1) - 1)
            self.slots.release()


def main():
    import argparse
    ap = argparse.ArgumentParser(description='JdaLink relay and static server (LAN use only, no authentication).')
    ap.add_argument('port', nargs='?', type=int, default=8000)
    ap.add_argument('--allow-host', action='append', default=[], metavar='NAME', help='extra Host header name to accept (repeatable), for example a DNS name or a tunnel')
    args = ap.parse_args()
    port = args.port
    ips = lan_ips()
    ALLOWED_HOSTS.update(ips)
    ALLOWED_HOSTS.update(h.strip().lower() for a in args.allow_host for h in a.split(',') if h.strip())
    try:
        hn = socket.gethostname().lower()
        ALLOWED_HOSTS.update({hn, hn + '.local'} if '.' not in hn else {hn})
    except OSError:
        pass
    srv = BoundedServer(('0.0.0.0', port), Handler)
    print('JdaLink relay, serving %s' % ROOT, flush=True)
    dist = os.path.join(ROOT, 'jezero-delta-atlas', 'dist')
    pages = sorted(f for f in os.listdir(dist) if f.endswith('.html')) if os.path.isdir(dist) else []
    bases = ['http://localhost:%d' % port] + ['http://%s:%d' % (ip, port) for ip in ips]
    print('Open from this computer or from any device on the same Wi-Fi / LAN:', flush=True)
    for b in bases:
        print('  ' + b + '/jezero-delta-atlas/dist/', flush=True)
        for p in pages:
            print('      ' + b + '/jezero-delta-atlas/dist/' + p, flush=True)
    print('Use the same room code on every device that should talk to each other.', flush=True)
    print('A room code is NOT a password: anyone who can reach this port and knows the code can join. LAN use only. Ctrl+C to stop.', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped', flush=True)


if __name__ == '__main__':
    main()
