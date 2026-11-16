# Crew simulation

Files: `web/js/sim-core.js` (`window.JdaSim`, pure engine), `web/js/world-client.js` (`window.JdaWorld`, what crew pages read),
`web/html/control.html` + `web/js/control.js` + `web/css/control.css` (operator page, the simulation authority), `tests/sim.test.js`.
Everything is scenario data. There is no real suit, radiation or vitals feed.

## Architecture
The control page ticks `JdaSim` at about 10 Hz and publishes the world with `JdaLink.setState('world', ...)` every second. It applies
`{type:'cmd'}` messages from other pages. Crew pages call `JdaWorld`: it uses the published world, and if none arrived for 4 s it runs a
local `JdaSim` (this page's crew first, plus jayesh and juhyeok), continuing from the last world it saw. It returns to the authority's
world as soon as one arrives. `JdaWorld.command(cmd)` goes to the authority via the link, or to the local engine in fallback.
Freshness is measured with the receiving page's own clock, so clock differences between devices do not matter.
The crew id of a page is the room identity for roles crew/helmet/tablet, else `?crew=` / `#crew=`, else `jayesh`.

## Models
- Position: lat/lon, flat local approximation (1 deg latitude = 59.16 km, longitude scaled by cos(lat)). Page px x,y use the atlas
  projection (bbox of `JEZERO_CRATERS.meta`, page 1990 x 1390), replicated, not imported. Base = `JEZERO_MISSION.base` (base camp, 18.447 N, 77.408 E, inside the map; fallback to the MissionGuide values if the data file is absent). Crew without a position start a few metres around base.
- Movement: straight lines between waypoints at the travel speed from `JEZERO_SPEEDS` (rover 2.8, foot 1.4 m/s; operator override `setSpeed` 0.1 to 30; fallbacks only if the file is absent) in simulated time, so the clock multiplier scales it.
  No terrain, slopes or obstacles. Modes: idle, walking, returning, resting (after returning or set by the operator). Heading = bearing from north.
- Mission clock: starts 2026-11-15T08:00Z (a scenario label) at 09:00 local mean solar time; one sol = 88775 s. Clock speed x1..x3600 (up to 100000).
  A tick is capped at 5 s real time and sub-stepped (at most 60 s simulated per step, 400 steps).
- Oxygen and battery (percent per simulated hour, same constants as `suit.js`): standing 4 / 3, walking 9 / 6 at the foot speed, scaled linearly with
  speed up to 3x effort (a faster speed is treated as a vehicle, consumption does not grow further). Resting is 10% lower. +-5% seeded jitter.
- Travel mode (`travel`, 'rover' or 'foot', default foot; `mode` values are unchanged): in the pressurised rover (also parked) the crew breathes cabin air, so suit oxygen use is 0, the suit battery only idles (1 %/h), effort is 0, heart rate settles at 68 and suit temperature at nominal. On foot (manual walk or EVA at a stop): the walking model above; working at a stop counts as effort 1 (about 9 %/h oxygen, 6 %/h battery). Setting the travel mode clears a speed override.
- Heart rate: first-order lag (45 s) towards 66 resting, 72 standing, +28 per unit effort while walking, +10 under 20% oxygen, +25 at zero. The operator can pin it.
- Suit temperature: lag (600 s) towards 21 C plus 0.8 per unit effort plus a small leak from the cold exterior; with a dead battery it drifts to ambient.
- Ambient: cosine day/night, mean -48 C, amplitude 38 C, warmest 14:00 local (about -86 to -10 C). Dust storm: swing x0.6, mean +2 C. Plausible for Jezero, not fitted to data.
- Radiation: dose rate from the science layer grid (`JEZERO_SCIENCE.radiation`, sampled at the crew's page px, clamped outside the map, so
  beyond the map edge the nearest edge value is used); without that data file, the 26.67 uSv/h baseline. Solar event x2.5 (the layer's multiplier).
  Dust storm does not change radiation. Dose (mSv) integrates the rate over simulated time and only grows (except operator `set`).
- Elevation `zM` is a constant -2600 m, not derived from a terrain model.

## Commands (`cmd` object, `crew` = id or `all`)
`walk {to:{lat,lon,label?} | heading:deg, path?:[points], thenReturn?:bool, speed?}`, `stop`, `return`, `setSpeed {mps}`, `setClockSpeed {n}`,
`set {field,value}` (o2Pct, batPct, hr (null = automatic), suitTempC, doseMsv, mode (idle|resting), lat, lon, headingDeg), `event {solar?,dust?}`, `reset`.
Extensions beyond the contract list: `path` and `thenReturn` on walk, and local-only `addCrew {id?,name,lat?,lon?}` / `removeCrew {crew}` (not accepted from other pages).
Additional commands: `runMission {crew, speed?, objective?, optimize?}` (the mission run below), `setTravel {crew, mode:'rover'|'foot'}`, and `travel` on `walk`. Manual commands (walk, stop, return, set mode) cancel a mission run.

## Mission run ("Run mission")
Base camp, then the stops, then back to base camp. The stop order is the guide order (stops 1 to 5), or the lowest hazard-weighted order when `optimize:true` is in the command (control page toggle "Optimize stop order", or shared state `route:options`). Between points `travel:'rover'` at the rover speed (mode walking, last leg returning), and the rover FOLLOWS the safe route of `JdaRoute` (`docs/ROUTING.md`): each drive leg is planned from the crew's current position (`JdaRoute.leg`), the intermediate waypoints are targets in turn, and the final point is the stop itself. Without `JdaRoute` on the page the legs are straight lines. A solar or dust event toggled during a drive re-plans from the current position to the same stop (an EVA is not interrupted; the next leg uses the new hazards). At each stop the crew goes on foot (`travel:'foot'`, mode walking, speed 0): the world record carries `stopId` and the current `taskId`; the tasks of the CHOSEN OBJECTIVE run one after the other for their `estMin` (simulated time; a stop without chosen tasks takes 30 min), then the crew drives on. The objective is `cmd.objective` if given (it sticks for that crew in the engine), else `JdaObjective.get(id)`, else shared state `objective:<id>`, else both; it is re-read at each stop. At base camp the run ends: mode resting, travel foot. Record additions: `travel`, `stopId`, `taskId`, `progress {done,total,doneIds}` (doneIds = every task actually performed in this run; done/total count the chosen objective's tasks; see ROUTING.md), `distM` (to the current target), `etaS` (simulated seconds to the target, or to the end of the EVA), `route` (`{order, remainingM, riskAhead, optimized, replans, blockedLegs}` during a run, else null). A fallback sim loaded from a world does not continue a run (it stops at its current target).
Duration with both objectives at the data's values is about 8 h simulated (under a minute at x600); the safe route adds about 0.9 km of driving over the straight lines.

## Authority, heartbeat and helpers
- World extras published by the control page (clients ignore unknown fields): `authorId` (random per control page load), `epoch` (ms, rises on takeover), `hb` (publisher clock, ms) and `stale` (true in a last world sent on page close).
- Arbitration: after joining, a control page watches the room for 3 s. If another page's world arrives (two updates, or one with a fresh `hb`) it shows a banner (role=status), disables its controls and does not publish until the operator presses "Take over" (it then continues from the other page's world, so the clock does not jump). If it is authority and sees a world with a higher `epoch`, it yields. A blocked page takes over by itself after 8 s without updates from the other. Remote `cmd` messages are only applied by the authority.
- Background tabs: the tick runs from a Web Worker timer (not throttled) with a setInterval fallback, and integrates the real time that passed (up to 10 minutes, in 5 s sub-steps), so a returning tab catches up. A page that closes publishes `stale:true`; `JdaWorld` then falls back to its local sim at once (otherwise after 4 s without a world) and continues from the last world position and target. Waypoints after the current target are not part of the world, so a fallback walk stops at its current target.
- Resume: a control page that joins a room whose last `world` is younger than 30 minutes (by its `hb`, so also the stale world a closed control page leaves behind) and that is not blocked by a live authority continues from that world after the 3 s observation window (crew, positions, vitals, dose, clock, events) and logs it; "Reset simulation" starts over. An older world is ignored. Only the world is resumed: see the mission-run limit below.
- Fallback crew rule (`world-client.js`): stand-alone (no joined room) the local fallback simulates this page's crew plus jayesh and juhyeok. In a joined room it simulates only this page's crew plus crew that really exist there (the last authority world of the room and presence of crew/helmet/tablet pages), so no invented teammate shows up in a room without a control page.
- Reserved crew ids: `all`, `earth`, `legacy`, `control`, `me`, `helmet`, `tablet`, `crew` (same list as `link-ui.js`) would clash with message targets and roles, so `addCrew` renames them with a `-crew` suffix (`all` becomes `all-crew`). Duplicate names or ids get a numeric suffix.
- Operator `set` limits: `lon` is wrapped into [-180, 180); `doseMsv` is clamped to 0..100000 mSv (it otherwise only grows); `o2Pct` and `batPct` to 0..100; `hr` to 0..250 (the control slider offers 40..200), `null` or `auto` returns it to automatic; `suitTempC` to -120..80 C.
- `JdaWorld.localMarsTime()` returns hh:mm local mean solar time for the current world time (same function as the control page, `JdaSim.localMarsTime`, which needs sim-core.js on the page). `JdaWorld.setMe(id)` overrides the page's crew id. SOS from the control page sends `{type:'sos', name:<crew name>, lat, lon, simTime}` (the link fills `from` with the control page, so the name goes in `name`).

## Limits (honest)
A mission run is NOT part of the world state: the world carries only the current target, `stopId`/`taskId` and `progress`, not the remaining waypoints or the task timer. A control page that resumes from a world, a takeover, or a crew page that falls back to its local engine therefore stops at the current target (the crew keeps its `stopId`/`progress` values until a manual command); press Run mission again to restart the run from base camp.
Arbitration is best effort (no server lock): two pages starting within the same few seconds could briefly both publish until the epoch rule resolves it. Very long hidden periods are capped at 10 minutes of catch-up. A page reload of the control page resets the simulation (unless another authority keeps the world and this page takes over from it). Positions are not validated against terrain.
Tests: `node tests/sim.test.js`, or in a browser serve the repo root, open control.html, and load the test file with a script tag (result in `window.SIM_TEST_RESULT`).
