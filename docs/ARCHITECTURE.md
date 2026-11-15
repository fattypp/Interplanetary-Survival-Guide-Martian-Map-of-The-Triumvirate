# Atlas architecture (module contract)

The atlas page is a full-screen map with a floating tab panel. Every feature is its own script,
CSS and (optional) data file, so people can work in parallel without editing the same file.
All scripts are plain browser JS (no build tools, no ES modules, must work from `file://`),
loaded in the order listed in `web/html/index.html`; `integration/web_bridge.py bundle` inlines them
into `dist/jezero-delta-atlas.html`.

## Files and owners

| File | Owner (feature) |
|---|---|
| `web/js/atlas-map.js`, `web/js/atlas-shell.js`, `web/css/atlas-styles.css`, `web/css/atlas-shell.css`, `web/html/index.html`, `integration/web_bridge.py` | shell: map, layout, tab panel, layer selector, SOS, theme, bundler |
| `web/js/mission.js`, `web/css/mission.css`, `web/data/mission-data.js` (generated from `docs/mission-guide.md`) | missions: stops, pins, mission tab, user-added missions |
| `web/js/planner.js`, `web/css/planner.css`, `web/data/schedule-config.js`, `web/js/schedule-engine.js`, `docs/SCHEDULE.md` | planner: to-do list, schedule, reminders, send-to-Earth |
| `web/js/layers-science.js`, `web/css/layers-science.css`, `web/data/science-layers-data.js`, `model/science_layers.py` | radiation / spectral / topographic layers |
| `web/js/suit.js`, `web/css/suit.css` | own suit, radiation alerts, personal stats, health check |
| `web/js/team.js`, `web/css/team.css` | team tab: teammates, their vitals, chat |

A feature touches only its own files. Need something from another feature? Use the API below.
If the contract is missing something you need, say so in your report; do not edit another owner's file.

## The shared object: `window.Atlas`

Created by `atlas-shell.js` (loaded after `atlas-map.js`). Feature scripts load after it.

```js
Atlas.W, Atlas.H                      // map size in page pixels (1990 x 1390)
Atlas.ll(x, y)  -> [lon, lat]         // page px -> degrees
Atlas.xy(lon, lat) -> [x, y]          // degrees -> page px
Atlas.el(tag, attrs, parent)          // create SVG element (parent defaults to the overlay <svg id="ov">)
Atlas.h(tag, props, children)         // create an HTML element (props: class, text, on*, attrs; children: nodes/strings). Never use innerHTML with data.
Atlas.setInfo(title, text, meta)      // fill the "Selected" info card
Atlas.focus(x, y, zoom)               // pan/zoom to a page point
Atlas.onMapClick(fn)                  // fn({x,y,event}) for clicks that were not drags; returns an unsubscribe fn
Atlas.store.get(key, fallback) / Atlas.store.set(key, value)   // localStorage wrapped in try/catch, keys are prefixed "jda."
Atlas.bus.on(name, fn) / Atlas.bus.off(name, fn) / Atlas.bus.emit(name, payload)
Atlas.toast(text, level)              // level: "info" | "warn" | "danger"; shows a transient message
Atlas.now()                           // simulated mission clock, Date object (real time by default; Atlas.clock.setSpeed(n) multiplies it, for demos/tests)
Atlas.clock = { now(), setSpeed(n), speed }
```

### Opening tabs, picking on the map, map data (shell)

```js
Atlas.openTab(id, open?)   // open undefined = toggle, true/false = set; same behaviour as the dock button (on phones it closes the other tabs). Unknown id: ignored
Atlas.closeTab(id)
Atlas.pick({ owner, label, onCancel }, fn) -> cancel()   // exclusive map pick, see below
Atlas.pick.cancel(owner?)  // cancel the active pick (only if it belongs to owner, when given)
Atlas.pick.busy()          // true while a pick is active or just consumed a click: pin click handlers should return early
Atlas.picking()            // owner of the active pick, or null
// bus: 'pick:changed' {owner|null}
Atlas.mapData = { samples: [{n, name, area, x, y, onMap}], places: [{id, name, x, y, onMap}] }   // page px, the same values the sample / place layers draw; onMap false = outside this map
Atlas.landing = { x, y, onMap }   // true page point of the landing site (east of the map). Atlas.me starts at the nearest map-edge point instead
```
**Picking rules.** Anything that needs "click a point on the map" (route planner, mission "Pick on map", suit "Move here") must use `Atlas.pick`,
not `Atlas.onMapClick` (which stays a plain broadcast for passive listeners). While a pick is active, the next non-drag map click goes ONLY to `fn({x,y,event})`:
it is not sent to `onMapClick` subscribers, and crater / sample / place clicks do nothing (so a pick never opens other UI; pins drawn by other features should start their click handler with `if (Atlas.pick.busy()) return;`, which is true while a pick is active and for the instant after a pick consumed the click). The pick then ends.
Starting a new pick cancels the previous one (its `onCancel` runs), Esc or the banner's Cancel button cancels the active one. A banner "Click the map: <label> (Esc cancels)" is shown. To pick several points, call `Atlas.pick` again from inside `fn`.

### Tabs

```js
Atlas.registerTab({ id, title, icon, order, render(container) })
```
`icon` is a short emoji/text. `render` is called once, the first time the tab opens (and `container` is kept);
re-render by clearing the container yourself. The shell gives each tab a header with a hide button, lets the user
open/close every tab independently (state remembered in `Atlas.store`), and rounds the corners. Built-in order:
Mission 10, Planner 20, Team 30, Suit 40, Personal 50. The map is always the full screen behind the tabs.

### Layers

```js
Atlas.registerLayer({ id, label, group, color, node, on, count })       // SVG layer: node is an SVG <g> you made
Atlas.registerRasterLayer({ id, label, group, color, canvas, opacity, on })  // raster overlay (an HTMLCanvasElement the size of the map in page px, or any size: it is stretched to the map)
Atlas.layers.setOn(id, bool) / Atlas.layers.isOn(id) / Atlas.layers.setOpacity(id, 0..1)
```
Layers appear in the layer selector in the bottom-left corner of the screen. Raster layers are stackable: several can be on
at once, drawn in registration order above the basemap and below the SVG marks, each with an opacity slider in the selector.
The existing crater / reference layers are registered by the shell through the same functions.

### Position of the user (simulated)

```js
Atlas.me = { x, y }                   // page px of the user (the astronaut). Starts at the landing site. Owned by suit.js, which moves it.
Atlas.bus.emit('me:moved', {x, y})
```

### Per-feature APIs (each feature creates its own namespace and must keep it stable)

```js
// mission.js
Atlas.missions.list()   -> [{ id, title, kind:'objective'|'stop'|'custom', description, x, y, lat, lon, source }]  // objectives from docs/mission-guide.md, stops, user-added
Atlas.missions.add({ title, description, x, y })
Atlas.missions.stops()  -> stops only
// events: 'missions:changed'

// planner.js / schedule-engine.js
Atlas.todos.list()      -> [{ id, title, description, deadline (ISO string|null), importance 1..5, estMin, done, missionId|null, kind:'task'|'health'|'mission' }]
Atlas.schedule.get()    -> [{ id, start (ISO), end (ISO), type:'sleep'|'meal'|'recreation'|'mission'|'task'|'health', title, refId }]
Atlas.schedule.rebuild()
// events: 'todos:changed', 'schedule:changed', 'schedule:missed' ({block})

// layers-science.js
Atlas.radiation.at(x, y)       -> dose rate in microSv/h at a page point
Atlas.radiation.unit           -> 'µSv/h'
Atlas.radiation.limits         -> { caution: n, danger: n }   // the suit's resistance, see suit.js
// layers 'radiation', 'spectral', 'topo' (ids)

// suit.js
Atlas.suit.state()   -> { oxygenPct, batteryPct, condition:'nominal'|'caution'|'critical', radiationNow, radiationTotalmSv, suitRadiationLimit }
Atlas.health.last()  -> { time (ISO), heartRate, spo2, temperatureC, fatigue 0..10, notes } | null
Atlas.health.run()   -> runs a health check now and stores it
Atlas.health.intervalHours
// events: 'suit:alert' ({level:'caution'|'danger', text}), 'health:done'

// team.js
Atlas.team.members() -> [{ id, name, x, y, oxygenPct, batteryPct, heartRate }]
Atlas.team.open(id)  -> opens a chat with that member
```

## Rules for everyone

1. Plain ES5/ES2015 in IIFEs, no frameworks, no CDN scripts (the page must work offline and from `file://`).
2. Never build HTML from strings that contain data (no `innerHTML` with variables); use `Atlas.h` / `textContent`.
3. Everything must work with keyboard only and have `aria-label`s on icon buttons. Respect the dark/light CSS variables.
4. **Simulated data must be labelled "simulated" in the UI.** There is no real radiation, spectral, suit or team feed.
5. Do not run `web_bridge.py bundle` (the orchestrator does that once at the end so `dist/` has no merge conflicts).
6. Deterministic output only: generated data files must be byte-identical when regenerated (seeded random numbers).
7. Pure logic (scheduling, radiation maths) goes in files that also work under Node (`if (typeof module !== 'undefined') module.exports = ...`) and gets a test in `tests/<feature>.test.js` (plain `assert`, no packages). Node is NOT installed on this machine, so run such tests in the browser instead (serve `jezero-delta-atlas/` with `python3 -m http.server <your port>`, open a NEW Chrome tab with the claude-in-chrome tools, and evaluate the logic with the javascript_tool). `file://` is blocked in Chrome, always use the http server. Use only your assigned port, close your tab when done, and stop your server.
8. Syntax check JS by loading the page and reading console errors (read_console_messages) from a fresh page load.
