# Safe route (JdaRoute)

Files: `web/js/mission-route.js` (`window.JdaRoute`, pure, deterministic, no DOM), `web/js/route-planner.js` (crater grid, owned by the same agent),
`tests/route.test.js`. Inputs: `JEZERO_CRATERS` (crater detections), `JEZERO_SCIENCE.radiation` (generated radiation grid and limits), `JEZERO_MISSION`
(base camp, 5 stops, tasks), `JEZERO_SPEEDS`. It works on the tablet, control and atlas pages (all of them load the data files).

## API
`JdaRoute.plan({objective:1|2|'both', optimizeOrder:false, order:[stopIds], hazards:{solar,dust}, obstacles:[{x,y,r}]})` returns
`{order, legs[{id,fromId,toId,points[{x,y,lat,lon}],lengthM,straightM,risk,notes,blocked,detourM,etaRoverS,etaFootS,metrics}], waypoints[{x,y,lat,lon,kind,stopId?}],
totalM, straightM, detourM, etaRoverS, etaFootS, etaMissionS, risk, avoided{craters,radiationM}, blocked[legIds], hazardNotes[], stops[{id,evaMin,tasks}],
evaTotalMin, taskCount, cost{guideM,chosenM,savedM}, optimized, computeMs}`. `JdaRoute.leg(fromXY, toXY, {hazards})` plans one leg between any two
page-px points (the simulation uses it to re-plan from the current position). `warm`, `costAt`, `radiationAt`, `limits`, `clearCache`, `params` are helpers.
Coordinates are atlas page px (1990 x 1390); metres use the atlas scale (about 5.55 m per px). Results are cached per
(solar, dust, objective, order mode, obstacles): recomputed only when the hazards change.

## Cost model
The grid has 4 px cells (about 22 m). A cell costs at least 1 (open ground = 1 m of effort per metre) and is the sum of:
- **Craters (obstacle).** Detections with confidence >= 0.6 are blocked out to 1.25 x their radius (1.6 x in a dust storm). Detections below 0.6 are passable at cost 4.
- **Safety halo.** Up to 60 m outside the blocked radius a cost of 1.2 fading to 0 (x1.8 in dust), so the route keeps a margin from rims instead of grazing them.
- **Radiation.** Dose rate from the same grid and bilinear sampling as the atlas radiation layer; with a solar event the dose is x2.5 (the layer's multiplier).
  Below caution (36 uSv/h): 0.6 x (dose/36)^2 (a mild preference for low-dose ground). Between caution and danger (55): 0.6 + 4 x fraction. At or above danger:
  29.6 + 0.5 per uSv/h over the limit (near-blocked but never impassable, so a plan exists even when a whole area is over the limit).
- **Dust.** +0.15 on every cell (reduced visibility) plus the wider crater margin and halo above.
Search: A* on 8-connected moves (diagonal sqrt 2, no corner cutting), octile heuristic (admissible since every cell costs >= 1), binary heap, scratch arrays reused,
deterministic tie-breaking (insertion order). The grid path is smoothed by string pulling: collinear points are dropped, then each point jumps to the farthest
later point reachable in a straight line whose weighted cost is at most 1.04 x the grid path cost and that crosses no blocked cell (sampled every 1 px). Result: a few
straight segments, no staircase, and the preference for straight lines never trades away the margin because the halo and radiation are part of the cost.

## Order optimisation
`optimizeOrder:true` evaluates all 120 permutations of the 5 stops with base camp fixed first and last, summing leg costs from a cached 7-node cost matrix
(`cost.guideM` guide order, `cost.chosenM` chosen, in hazard-weighted metres). The guide order wins ties; the result is never costlier than the guide order.
Without a solar event the saving is tiny (about 0.1 %: mostly the same loop in reverse); with an event the order can change a lot. The default keeps guide order.

## Risk, notes, blocked legs
`risk` (0..1) per leg = share of the path length that is either in radiation at or above the caution limit (with the active solar multiplier) or within 50 m of a
confident crater rim (including inside it). Intrusion rule: a leg that runs inside a blocked crater margin (`insideM` >= 5 m, e.g. the two legs touching stop 3, about 250 m inside crater 19) is never low risk:
`risk = max(share-based risk, 0.7 + 0.3 x min(1, 2 x insideM/lengthM))`, so at least 0.7. Every leg has `riskLevel` ('low' < 0.2, 'medium' < 0.5, 'high'). `plan.meanRisk` is the length-weighted mean;
`plan.risk` is the mean, raised to the worst leg's risk when any leg has an intrusion or is blocked, with `plan.riskLevel`; `plan.worst = {legId, index, risk, riskLevel, reason}` names the worst leg
(reason e.g. "inside a detected crater safety margin for 247 m"). UIs must show `plan.riskLevel` / `worst`, not a mean-based "low". `avoided.craters` counts craters the direct line would have crossed on legs that
detour; `avoided.radiationM` is the metres of caution-level radiation the direct line would cross and the route does not. `hazardNotes` are plain sentences
(e.g. "Leg 4 (...): detours 688 m (43 %) around 1 crater"). If no path exists the leg is `blocked:true`, `risk:1`, its line is a direct line for reference only and the
notes and `blocked` say so: it is never presented as safe. A stop or base camp that lies inside a blocked margin is reached through the blocked cells within at most
700 m of it (cost 8 per cell) and the leg is flagged "WARNING ... inside a detected crater safety margin". This happens in the real data: stop 3 lies inside a detected crater of
confidence 0.77 (probably a bowl-like landform; the data and the detector disagree, we do not know which is right).

## Simulation
"Run mission" (`sim-core.js`) plans the order with `JdaRoute.plan` and drives each leg with `JdaRoute.leg` from the crew's current position, so the crew follows the
waypoints by rover; at a stop it is on foot for the sum of `estMin` of the chosen objective's tasks (objective from `JdaObjective.get(id)`, else shared state
`objective:<id>`, else both; progress total = number of chosen tasks). A solar or dust toggle during a drive or the drive home re-plans from the current position to the same
destination (during an EVA the next leg is planned with the new hazards). World record fields `route` and `progress`. Without `JdaRoute` on the page the run uses straight lines as before.
The control page has an "Optimize stop order" toggle and a route summary per crew.

## Honest limits
- No slope data, rocks, sand dunes or soil trafficability exist in the repo, so none is modelled. A route is "clear of detected craters and generated radiation", not "drivable".
- Craters come from the image detector with its confidence: false positives block good ground, misses leave real craters in the way. Confidence below 0.6 is only a soft cost.
- Radiation is the generated layer (baseline MSL/RAD GCR x terrain shielding x scenario zones), not measured. With a solar event (x2.5) the baseline itself (about 67 uSv/h) is above the danger
  limit almost everywhere, so a plan warns that the whole route is over the limit instead of finding a safe path.
- Costs are relative weights, not time or dose: the ETA uses plain speeds (rover 2.8, foot 1.4 m/s) over the path length, dust does not slow it.
- Positions use a flat local approximation; page px to metres uses the atlas scale bar (0.2 % different from the simulation's sphere constant).
- The 4 px grid (22 m) limits detail; narrow gaps between craters under about two cells are treated as closed.

## World record while a run is active (authoritative for the tablet)
`route = {order, remainingOrder, current, remainingM, riskAhead, optimized, replans, blockedLegs}`. `order` is the COMPLETE stop order of the running mission and stays authoritative:
a solar/dust re-plan re-routes the legs from the current position but never reorders the stops, so a UI draws exactly what is driven from `order` (run `JdaRoute.plan({order: world.route.order, hazards})`).
`remainingOrder` is the part not finished yet (the current stop first), `current` the stop being driven to or worked at (`'base'` on the way home). The shared option `route:options` is read by the
engine when a run starts; the control page and the tablet mirror it (one truth).

## Task progress
`progress = {done, total, doneIds}`: `doneIds` lists every task actually performed in this run (a task counts only when its EVA time has fully elapsed at its stop), whatever the objective choice is now;
`done` and `total` count the CHOSEN objective's tasks (done = chosen tasks found in `doneIds`). When the choice changes mid-run, `doneIds` is kept and the remaining EVA at the current and later stops is
re-computed from the chosen tasks not yet done (a stop with nothing left is skipped; partial time on the task in progress is lost). A new run resets `doneIds`.
