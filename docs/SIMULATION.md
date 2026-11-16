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
  projection (bbox of `JEZERO_CRATERS.meta`, page 1990 x 1390), replicated, not imported. Base = landing site 18.4446 N, 77.4509 E, which lies
  east of the map image, so x,y near base are outside 0..W. Crew without a position start a few metres around base.
- Movement: straight lines between waypoints at `speedMps` (default 1.4, range 0.1 to 30) in simulated time, so the clock multiplier scales it.
  No terrain, slopes or obstacles. Modes: idle, walking, returning, resting (after returning or set by the operator). Heading = bearing from north.
- Mission clock: starts 2026-11-15T08:00Z (a scenario label) at 09:00 local mean solar time; one sol = 88775 s. Clock speed x1..x3600 (up to 100000).
  A tick is capped at 5 s real time and sub-stepped (at most 60 s simulated per step, 400 steps).
- Oxygen and battery (percent per simulated hour, same constants as `suit.js`): standing 4 / 3, walking 9 / 6 at 1.4 m/s, scaled linearly with
  speed up to 3x effort (a faster speed is treated as a vehicle, consumption does not grow further). Resting is 10% lower. +-5% seeded jitter.
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
The "Move now" path: Three Forks, Hawksbill Gap, Upper Fan, Neretva Vallis, Witch Hazel Hill, Seitah, then home, about 38 km, taking about 7.5 h simulated
at 1.4 m/s (7.5 min at x60, under a minute at x600). Place positions use the atlas place coordinates converted from its older 1990 x 1848 canvas; several lie off the current map image.

## Authority, heartbeat and helpers
- World extras published by the control page (clients ignore unknown fields): `authorId` (random per control page load), `epoch` (ms, rises on takeover), `hb` (publisher clock, ms) and `stale` (true in a last world sent on page close).
- Arbitration: after joining, a control page watches the room for 3 s. If another page's world arrives (two updates, or one with a fresh `hb`) it shows a banner (role=status), disables its controls and does not publish until the operator presses "Take over" (it then continues from the other page's world, so the clock does not jump). If it is authority and sees a world with a higher `epoch`, it yields. A blocked page takes over by itself after 8 s without updates from the other. Remote `cmd` messages are only applied by the authority.
- Background tabs: the tick runs from a Web Worker timer (not throttled) with a setInterval fallback, and integrates the real time that passed (up to 10 minutes, in 5 s sub-steps), so a returning tab catches up. A page that closes publishes `stale:true`; `JdaWorld` then falls back to its local sim at once (otherwise after 4 s without a world) and continues from the last world position and target. Waypoints after the current target are not part of the world, so a fallback walk stops at its current target.
- `JdaWorld.localMarsTime()` returns hh:mm local mean solar time for the current world time (same function as the control page, `JdaSim.localMarsTime`, which needs sim-core.js on the page). `JdaWorld.setMe(id)` overrides the page's crew id. SOS from the control page sends `{type:'sos', name:<crew name>, lat, lon, simTime}` (the link fills `from` with the control page, so the name goes in `name`).

## Limits (honest)
Arbitration is best effort (no server lock): two pages starting within the same few seconds could briefly both publish until the epoch rule resolves it. Very long hidden periods are capped at 10 minutes of catch-up. A page reload of the control page resets the simulation (unless another authority keeps the world and this page takes over from it). Positions are not validated against terrain.
Tests: `node tests/sim.test.js`, or in a browser serve the repo root, open control.html, and load the test file with a script tag (result in `window.SIM_TEST_RESULT`).
