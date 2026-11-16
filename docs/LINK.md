# Link: pages talking to each other (JdaLink v2)

All pages (atlas, Earth control, helmet, tablet, control panel) share messages, a last-value state store and presence through
`web/js/link.js` (`window.JdaLink`). A **room code** keeps sessions apart: only pages with the same code see each other.
The API is in `docs/MULTIPAGE.md`; this file is the operations guide.

## Rooms
- A code has 5 characters: A-Z without I and O, and 2-9 (example `K7M2P`). `JdaLink.join(null, ...)` or the "Create new room" button makes one.
- Enter the same code on every page and device that should talk. `#room=K7M2P` at the end of a page URL joins directly (pages that ask who you are, atlas/helmet/tablet, show the dialog on a browser that has not chosen a crew yet; add `&crew=jayesh` or `&crew=juhyeok` to skip it, or mount with `defaultCrew:'jayesh'`) (changing the hash on an open page switches rooms); "Copy link" in the status chip copies it.
- Messages, state and presence never cross rooms (the code is part of every message, relay path, storage key and BroadcastChannel name; anything whose room field differs is dropped).
- The last room and crew choice are remembered in the browser (`localStorage` key `jda.linkui.last`).
- Backwards compatibility: if a page uses `on/send/history/...` without ever calling `join()`, it is placed in the room `LOCAL`, which never leaves that browser.
  Pages should call `JdaLinkUI.mount(...)` (or `JdaLink.join`) so they take part in real rooms.

## Transports (automatic, in this order)
1. **relay** (works between devices): `python3 jezero-delta-atlas/server/relay.py [port] [--allow-host NAME]` (default 8000, Python 3 standard library only). It serves the repository
   and the `/api` endpoints, and prints the LAN addresses, for example `http://192.168.1.20:8000/jezero-delta-atlas/dist/earth-control.html`.
   Open that address on every device on the same Wi-Fi/LAN (phone, second laptop) and use one room code. Pages must be opened from the relay
   address (same origin), not from `file://` or another server. Rooms live in memory and expire after 12 h without traffic; restarting the relay clears them.
   Limits: message 4 KB, state 64 KB, 32 state keys and 200 stored messages per room, rate limits per IP and per room (see Security). No CORS headers (same-origin only),
   dot-directories such as `.git` are not served.
2. **online** (Supabase, optional): used only when `web/data/link-config.js` has `url` and `key`; it can run next to relay or local. See below.
3. **local**: BroadcastChannel + localStorage, namespaced by room code; same browser only. This is what plain `python3 -m http.server` gives you.
`JdaLink.status` is `relay`, `online` or `local`; the status chip shows it. If the relay stops answering for three polls the status falls back to `local` and returns to `relay` when it is back.

## Security and privacy (read this)
- **A room code is not authentication.** Anyone who can reach the relay port and knows (or guesses) a code can read and write that room. Use it on a trusted LAN only, never expose the port to the internet.
- **Direct messages are not private.** A chat message with `to` set to one person still travels through the room-wide link (relay log, localStorage, online table). Anyone with the room code, or anyone reading the relay log, can read it; the chat UI only shows it to sender and recipient. Do not put secrets in chat (same note as the header of `web/js/chat-ui.js`).
- Relay protections: the `Host` header must be `localhost`, `127.0.0.1`, `::1`, one of this machine's LAN IPs or host name, or a name passed with `--allow-host NAME` (blocks DNS rebinding; others get 403); at most 20 rooms created per client address (429/503 beyond that), 300 rooms in total; at most 96 simultaneous connections (40 per client), 10 s silence timeout per connection; chunked request bodies get 411 and a missing `Content-Length` on POST/PUT gets 411; bodies over 4 KB (message) / 64 KB (state) get 413; cross-origin writes get 403.

## Sender names
`JdaLink.send` always stamps `from` as the sender envelope `{role, id, name, cid}`. Pass the display name as `fromName` (chat) or `name`; if a caller passes a string `from` it is kept as `fromName`, never lost. Chat messages without `fromName` get the sender's room name. Readers must use `m.from.name` / `m.fromName`, not treat `m.from` as a string.

## Implicit LOCAL room
Calling `send/on/history/setState` before any `join()` uses a temporary room `LOCAL` (`JdaLink.room.implicit === true`, status `local`). `JdaLinkUI` treats that as "not joined", so the first-run dialog still appears and cannot be dismissed. When the page then joins a real room, the messages sent in the last 2 minutes and the state values set while implicit are re-published into the real room; handlers registered with `on`/`onState` stay attached.

## Relay API (same origin)
`GET /api/ping`, `POST /api/rooms/<code>/msg`, `GET /api/rooms/<code>/msgs?since=<n>`, `PUT|GET /api/rooms/<code>/state/<key>`,
`GET /api/rooms/<code>/state?since=<ver>` (all keys changed since), `POST|GET /api/rooms/<code>/presence`. Responses are JSON. Messages from the first poll after joining are
delivered to `on()` handlers with `replay:true` (handlers must dedupe by `id`, as earth.js does); `history()` includes them.

## Optional Supabase (online mode)
Fill `web/data/link-config.js` (`url`, public anon `key`, `table`) and rebuild dist. Table with the room column (also holds state and presence rows):
```sql
create table link_messages (
  id text primary key,
  room text not null,
  kind text not null default 'msg',          -- 'msg' | 'state' | 'pres'
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on link_messages (room, kind, created_at desc);
alter table link_messages enable row level security;
create policy "anon read"   on link_messages for select to anon using (true);
create policy "anon insert" on link_messages for insert to anon with check (true);
create policy "anon update" on link_messages for update to anon using (true) with check (true);
```
Use only the public anon key, never a service key. These policies let anyone with the site read and write the table; the room code is the only separation, so use it for project/demo data.
If you used the older table without `room`, add the columns (`alter table link_messages add column room text not null default 'LOCAL', add column kind text not null default 'msg', add column updated_at timestamptz not null default now();`).
The Supabase transport was written against the documented REST API and has NOT been run against a real project.

## Tests
`tests/link.test.js` (browser, see the header of the file) covers codes, validation, isolation between rooms, dedupe, no echo, state and presence on the local transport.
The relay tests (status `relay`, messages, state, presence, isolation, 413/400/404/429) run automatically when the page is served by `relay.py`, otherwise they are skipped; run the file on both servers. `tests/link-harness.html` is a small page for manual two-tab / two-device checks.

## Recovery and delivery (relay)
- Messages wait in an outbox until the relay accepted them (relay restarting, 429, brief outage) and are retried on every poll; the relay and readers dedupe by id.
- The relay reports an `epoch` (new on every start). When it changes, a page re-posts its own recent messages and its own state values that the relay no longer has, and restarts its cursors. A relay that is down at load is probed again every 4 s.
- Message and state sizes are measured in UTF-8 bytes on both sides (500 emoji fit). A page keeps the last 200 messages (`history()`), the relay 200 per room.
