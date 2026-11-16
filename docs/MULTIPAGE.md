# Multi-page system contract (v2)

Pages (source in `jezero-delta-atlas/web/html/`, single-file builds in `jezero-delta-atlas/dist/`):

| Source page | dist file | Who uses it |
|---|---|---|
| `index.html` | `jezero-delta-atlas.html` | crew, detailed Jezero map (existing atlas) |
| `earth.html` | `earth-control.html` | Earth mission control (SOS alerts, chat) |
| `helmet.html` | `astronaut-helmet.html` | crew: helmet HUD over a Mars surface view (sketch: `docs/sketches/sketch-1.png`) |
| `tablet.html` | `astronaut-tablet.html` | crew: tablet with global Mars map (sketch: `docs/sketches/sketch-2.png`) |
| `control.html` | `simulation-control.html` | director/demo operator: drives the simulation (walk, speed, vitals, events) |

All pages are plain browser JS, no build tools, no ES modules, each must work as ONE html file (`web_bridge.py bundle` inlines
`../css/*.css`, `../js/*.js`, `../data/*.js`, `../images/*`). The bundler picks up every `web/html/*.html` automatically.
Keep inlined images small (each under ~1.5 MB; compress as JPEG/WebP). Never build HTML from data with innerHTML: use textContent or `Atlas.h`/own helpers.
Pages must be responsive and keyboard accessible, with visible focus. No emojis (line icons / plain shapes + a word). Light/dark: the helmet and tablet are dark UIs by design.

## Rooms (so devices are not all shared)
A **room code** (5 chars, A-Z without I/O, 2-9, e.g. `K7M2P`) isolates a session. Every page asks for / shows the room code
(`#room=K7M2P` in the URL also works) and only sees messages and state of its own room. Different codes never see each other.

## `window.JdaLink` v2 (file `web/js/link.js`, owner: link agent)
```js
JdaLink.join(code|null, {role, id, name}) -> {code}    // null/'' creates a new random code. role: 'crew'|'earth'|'control'|'helmet'|'tablet'. id: crew id ('jayesh'|'juhyeok'|custom slug) for crew roles
JdaLink.room      // {code, role, id, name} or null before join
JdaLink.status    // 'relay' | 'online' | 'local' (local = same browser only); bus: JdaLink.onStatus(fn)
JdaLink.send(msg) // msg {type, ...}; adds {id, t, room, from:{role,id,name}} ; delivered to every OTHER page in the room (not echoed to the sender)
JdaLink.on(fn)    // fn(msg) for every incoming message of this room; returns off()
JdaLink.history(n?) // last n messages of the room (default 100), so a page opened later sees earlier ones
JdaLink.setState(key, value)  // last-value shared store per room (JSON, <= 64 KB), e.g. 'world'
JdaLink.getState(key) -> {value, t, from} | null
JdaLink.onState(key, fn) -> off()   // fn(value, meta) on every change (also fired once at join if a value exists)
JdaLink.presence() -> [{role,id,name,lastSeen}]   // who is online in the room (heartbeat every 5 s, online if seen < 15 s ago)
```
Transports, chosen automatically in this order: **relay** (same-origin `GET /api/ping` works: `server/relay.py`, a Python-stdlib server
that also serves the repo, run `python3 jezero-delta-atlas/server/relay.py` and open it from any device on the same Wi-Fi), **online**
(Supabase, only if `web/data/link-config.js` is filled in), **local** (BroadcastChannel + localStorage, namespaced by room code).
Relay API: `POST /api/rooms/<code>/msg`, `GET /api/rooms/<code>/msgs?since=<n>`, `PUT|GET /api/rooms/<code>/state/<key>`, `POST /api/rooms/<code>/presence`, `GET /api/ping`. Rooms live in memory and expire after 12 h idle. Validate everything received (untrusted).

## Message types
```
{type:'chat',  to:'all'|<crewId>|'earth', text, fromName}      // person-to-person chat, text <= 500 chars
{type:'sos',   from..., lat, lon}  /  {type:'ack', sosId, by}  // existing SOS flow, keep working
{type:'cmd',   cmd:'walk'|'stop'|'return'|'setSpeed'|'setClockSpeed'|'set'|'event'|'reset', crew?:<id>, ...}  // control panel -> simulation authority (see sim agent)
{type:'task',  crew:<id>, taskId, done:true|false}             // tablet toggles a task
```

## World state (`JdaLink.setState('world', ...)`, published ~1 Hz by the simulation authority)
```
{ v:1, t:<ISO simulated mission time>, clockSpeed:<n>, base:{lat,lon},
  crew:{ <id>:{ id, name, lat, lon, zM, x, y /*Jezero page px of the atlas map, may be outside the image*/, headingDeg,
                o2Pct, batPct, hr, suitTempC, ambientTempC, radUsvH, doseMsv,
                mode:'idle'|'walking'|'returning'|'resting', speedMps, target:{lat,lon,label}|null } },
  events:{ solar:bool, dust:bool } }
```
The **simulation authority** is the control page (`control.html`) via `web/js/sim-core.js` (`window.JdaSim`). If a crew page (helmet/tablet/atlas)
does not receive a fresh `world` state for 4 s, it runs its own local `JdaSim` for its crew member so it never looks dead; when a fresh
`world` arrives it switches to it. Pages read crew data ONLY through `JdaWorld` (`web/js/world-client.js`, owner: sim agent):
```js
JdaWorld.me() -> crew record of this page's crew id | null ; JdaWorld.crew() -> [records] ; JdaWorld.time() -> Date ; JdaWorld.on(fn) fn(world) each update
JdaWorld.source // 'authority' | 'local'
```
Tasks/mission progress (published by tablet, key `tasks:<crewId>`): `{ next:{title, startISO|null, kind}|null, missions:[{id,title,done}], progress:{done,total} }`. Helmet reads it for NEXT TASK.

## Ownership (a feature touches only its own files)
- link agent: `web/js/link.js`, `web/js/link-ui.js` (room join dialog + status chip, shared by all pages: `JdaLinkUI.mount({role, ask:['code','crew'|'name']})`), `web/css/link-ui.css`, `server/relay.py`, `docs/LINK.md`, `web/data/link-config.js`, `tests/link.test.js`
- sim agent: `web/js/sim-core.js`, `web/js/world-client.js`, `web/html/control.html`, `web/css/control.css`, `web/js/control.js`, `docs/SIMULATION.md`, `tests/sim.test.js`
- helmet agent: `web/html/helmet.html`, `web/css/helmet.css`, `web/js/helmet.js`, `web/images/mars-surface*.jpg`
- tablet agent: `web/html/tablet.html`, `web/css/tablet.css`, `web/js/tablet.js`, `web/images/mars-global*.jpg`, `web/data/mars-sites.js`
- chat agent: `web/js/chat-ui.js`, `web/css/chat-ui.css` (`JdaChat.mount(container, {link, meId, meName, peers})`), plus wiring of real chat into `web/js/team.js` (team tab) and `web/js/earth.js` (Earth page)
- shared files (`web_bridge.py`, `ARCHITECTURE.md`, `docs/MULTIPAGE.md`): the orchestrator only.
Need something from another owner? Use the API above, and say so in your report; do not edit their files.

## Rules for every agent
- Work in `~/work/repo` on branch `todo-implementation`. Do NOT commit, push, merge or rebuild dist (the orchestrator does that). Do not touch files you do not own.
- Serve with your own port: `python3 -m http.server <PORT>` from the repo root (your port is given in your task), or the relay server once it exists. Test in a real browser (Chrome tools): a fresh load must have no console errors. Open your own tab and close it when done. Stop your server when done.
- User-facing text must read like the real product used by an astronaut: no "simulated", "simulation", "demo", "mock", "(sim)" wording on crew-facing pages (helmet, tablet, atlas, earth, chat). Only the control page (`control.html`) may say it drives a simulation. Provenance notes belong in docs, not in the UI.
- Final report: what you built, files, what you verified in the browser (and how), what you could NOT verify, open questions. Be honest; a boss will interrogate you.

## Mission data v2 (replaces the 34 stops / samples; binding for every page)
Source of truth: `docs/mission-guide.md`, generated into `web/data/mission-data.js` (`window.JEZERO_MISSION`) by `python3 integration/web_bridge.py missiondata`.
The mission is "Jezero Pathfinder" (see `MissionGuide` at the repo root for the story and stop coordinates): a crew drives a pressurised rover from base camp, gets out on foot at FIVE stops, then drives back.
```
JEZERO_MISSION = {
  objectives: [ {id:1, title:'Find evidence of ancient microbial life', short:'Microbial life'},
                {id:2, title:'Assess whether the site can sustain human life', short:'Sustaining human life'} ],
  base:  { id:'base', name:'Base camp', lat, lon, x, y },              // start and end of the drive, INSIDE the atlas map (18.447 N, 77.408 E)
  stops: [ {id:'stop-1', n:1, name, lat, lon, x, y, description}, ... ],  // exactly 5, in visiting order
  tasks: [ {id:'task-1-1', stopId:'stop-1', objective:1|2, title, description, estMin}, ... ] // exactly 10: per stop one task for Objective 1 and one for Objective 2
}
```
x,y are atlas page px (1990x1390). There are NO sample sites, NO "places", NO per-sample sols/dates anywhere any more. Pages must not invent other stops. Base camp replaces the old landing site everywhere (Atlas.landing, world.base, BASE pin, SOS home): it is on the map, so Atlas.me is no longer clamped to the edge.
Travel speeds, single source `web/data/travel-speeds.js` (`window.JEZERO_SPEEDS = {rover:{label,mps}, foot:{label,mps}}`): the pressurised rover is FASTER than a person on foot. Nothing may hard-code 0.042 or 1.4 m/s any more.

### World additions (sim agent, round 2)
Additive fields on each crew record: `travel:'rover'|'foot'`, `stopId:<id>|null` and `taskId:<id>|null` (set while the crew is on foot at a stop during the mission run), `progress:{done,total}` (tasks finished by the run), `distM`, `etaS` (to the current target, simulated seconds). `mode` values are unchanged. `world.base` is the base camp. New cmds: `runMission {crew}`, `setTravel {crew, mode}`; `walk` accepts `travel`.

## Version 5 additions: objective choice, stop pictures, safe route (binding)
**Objective choice.** The user picks which objective to fulfil: `1` (microbial life), `2` (sustaining human life) or `'both'`. Stored per crew as shared state `JdaLink.setState('objective:<crewId>', {choice:1|2|'both', t:ISO})` (and in localStorage `jda.objective.<crewId>` or `jda.objective` when there is no room). Every page that lists or counts tasks (atlas Mission tab, planner todos, schedule, tablet pop-up, helmet NEXT TASK, sim 'Run mission', progress bars) uses only the tasks of the chosen objective(s); progress totals become 5 (one objective) or 10 (both). First run: ask the user to choose (a clear dialog or panel, not buried); the choice can be changed any time. Helper in `web/js/objective.js` (`window.JdaObjective`: `get(crewId?)`, `set(choice, crewId?)`, `tasks(mission)` filter, `on(fn)`), owned by the ATLAS agent; other pages must use it (guard if missing).
**Stop pictures.** `web/data/stop-images.js`: `window.JEZERO_STOP_IMAGES = { 'stop-1': { src:'../images/stops/stop-1.jpg', caption, sol, camera, credit, rawUrl, note }, ... }` for stops 1-5 (+ optionally 'base'); real NASA Mars 2020 (Perseverance) raw images of the area, public domain, credited NASA/JPL-Caltech; source listing page https://mars.nasa.gov/mars2020/multimedia/raw-images/ ; each picture is matched to the stop by the rover's known position at that sol and the caption says it is an image of the area near the stop, never an exact view; record details in docs/IMAGE-CREDITS.md. Owner: IMAGES agent.
**Safe route.** `web/js/mission-route.js` (`window.JdaRoute`, owner: ROUTE agent, pure, deterministic, no DOM): `JdaRoute.plan({objective, optimizeOrder:false, hazards:{solar:false, dust:false}})` -> `{order:[ids], legs:[{fromId,toId,points:[{x,y,lat,lon}],lengthM,straightM,risk:0..1,notes:[]}], waypoints:[{x,y,lat,lon,stopId?}], totalM, etaRoverS, etaFootS, avoided:{craters:n}, hazardNotes:[...], blocked:[legIds]}`. Hazards avoided: craters (A* in `web/js/route-planner.js`, which the ROUTE agent owns and may extend keeping its current API), high radiation cells (cost field from the radiation grid, limits 36/55 uSv/h from JEZERO_SCIENCE.radiation.limits) and, when events are active, solar/dust penalties. Order: base camp -> stops -> base camp in guide order by default; `optimizeOrder:true` searches all permutations of the 5 stops (120) for minimum hazard-weighted cost. The tablet draws the result and shows a summary; sim-core's 'Run mission' follows `waypoints`.
Ownership: ATLAS = index.html, mission.js/css, atlas-map.js, atlas-shell.js, planner.js, schedule-engine.js, objective.js, tests mission/planner. TABLET = tablet.*, helmet.*, mars-sites.js. ROUTE = mission-route.js, route-planner.js, sim-core.js, control.js/html/css, world-client.js, tests/route.test.js, tests/sim.test.js, docs/ROUTING.md, docs/SIMULATION.md. IMAGES = stop-images.js, images/stops/*, docs/IMAGE-CREDITS.md. Orchestrator = web_bridge.py, dist, MULTIPAGE.md.

### World additions (ROUTE agent, safe route)
Additive field on each crew record: `route: null | {order:[stopIds], remainingM, riskAhead:0..1, optimized, replans, blockedLegs}` (non-null while a mission run is active). `cmd runMission` accepts `objective:1|2|'both'` (sticks for that crew in the engine) and `optimize:bool` (stop-order optimisation); the control page also shares `JdaLink.setState('route:options', {optimizeOrder, t})`. Extra `JdaRoute` calls beyond the contract: `leg(fromXY, toXY, {hazards})`, `warm`, `costAt`, `radiationAt`, `limits`, and `plan` options `order:[ids]` and `obstacles:[{x,y,r}]`; plan outputs also `stops[{id,evaMin,tasks}]`, `evaTotalMin`, `taskCount`, `etaMissionS`, `risk`, `cost`, `optimized`. Details: `docs/ROUTING.md`.
Round 4 (ROUTE): `progress` is now `{done, total, doneIds:[taskIds actually performed in this run]}` (done/total = chosen objective only; doneIds regardless of the choice; consumers must mirror doneIds, never "the first N tasks"). While a run is active `route.order` is the complete, authoritative stop order (also `route.remainingOrder`, `route.current`); the `route:options` state is the single truth for the stop-order option (control and tablet both read and write it). `JdaRoute` legs/plan now carry `riskLevel`, `plan.worst`, `plan.meanRisk`: a leg inside a crater margin has risk >= 0.7. See `docs/ROUTING.md`.
