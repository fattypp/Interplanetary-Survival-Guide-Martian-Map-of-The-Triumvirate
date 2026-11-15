# Schedule settings: where every number lives

All numbers of the automatic schedule are in **one object**: `window.JEZERO_SCHEDULE_CONFIG` in
`jezero-delta-atlas/web/data/schedule-config.js` (every key has a comment there too).

To change a number: edit that file, save, reload the page. There is no build step.
Saved to-do items are kept. Press **Rebuild** in the Planner tab (Schedule view).
If a value is missing, not a number or outside the safe range, the engine silently uses the nearest safe value
(`normalizeConfig` in `web/js/schedule-engine.js`), so a typo cannot break the page. It does not warn you, so check the schedule after editing.

Times are 24-hour `"HH:MM"` strings. Durations are in minutes unless the key says hours.

## Day length (ordinary day or Martian sol)

| Key | Default | Meaning | Safe range |
|---|---|---|---|
| `days` | `7` | How many days ahead are planned. | 1 to 30 |
| `sol` | `false` | `false`: days are 24 h, as on the computer clock. `true`: every day of the schedule is 24 h 39.6 min (one Martian sol), counted from midnight of today, so "22:00" means "22 hours after the start of that sol" and bedtime drifts against the wall clock by 39.6 min per day. | `true` / `false` |

## Sleep, rest, food, health (never moved or shortened by tasks)

| Key | Default | Meaning | Safe range |
|---|---|---|---|
| `sleep.hours` | `8` | Sleep per day. | 4 to 12 (decimals ok) |
| `sleep.start` | `"22:00"` | Bedtime. Wake-up is start plus hours. | any HH:MM |
| `recreation.minutes` | `60` | Mental break per day. `0` turns it off. | 0 to 240 |
| `recreation.start` | `"19:00"` | Preferred start; it slides later (5 min steps, up to 6 h) if a fixed block is in the way. | any HH:MM |
| `meals` | 3 entries | List of `{ title, start, minutes }`. Add, remove or edit entries. Defaults: Breakfast 07:00, Lunch 12:00, Dinner 18:00, 30 min each. | minutes 5 to 120 |
| `health.enabled` | `true` | Turns the recurring health check on or off. | true / false |
| `health.start` | `"08:00"` | Time of the first check each day. | any HH:MM |
| `health.intervalHours` | `24` | 24 = daily, 12 = twice a day (08:00 and 20:00), 6 = every 6 h within the day, 48 = every second day. This is the single source of truth: the suit/Personal tab reads this value (via `ScheduleEngine.normalizeConfig`), so change it only here. | 1 to 720 |
| `health.minutes` | `15` | Length of the block. | 5 to 120 |

Priority when fixed blocks collide: sleep, then meals, then health, then recreation. A later one slides to the next free slot.

## Work (your goals and the mission objectives)

| Key | Default | Meaning | Safe range |
|---|---|---|---|
| `work.maxBlockMinutes` | `90` | Longest single work block. Longer jobs are split. | 15 to 240 |
| `work.breakMinutes` | `10` | Rest left after a block when the same job continues. | 0 to 60 |
| `work.minPieceMinutes` | `15` | A job is not squeezed into a gap shorter than this (except its last remainder). | 5 to 60 |
| `work.defaultTaskMinutes` | `30` | Used when a task has no valid estimate (also the default in the form). | 5 to 480 |
| `work.missionObjectiveMinutes` | `60` | Time given to each mission objective. | 5 to 480 |
| `work.missionObjectiveImportance` | `3` | Importance (1 to 5) given to mission objectives. | 1 to 5 |
| `urgentWithinHours` | `24` | A task due within this many hours gets the urgency boost when ranking. | 0 to 720 |
| `urgentBoost` | `2` | Extra importance points for urgent tasks. 0 = rank by importance only. | 0 to 4 |

How tasks are ordered: rank = importance + urgency boost, ties broken by earlier deadline. Tasks are placed in the earliest free time, never overlapping anything,
never after their deadline. A job that fits one block goes into the earliest gap that holds it whole, otherwise it is split across gaps.
If a task would miss its deadline it is moved to the front of the queue; if it still does not fit, the least important conflicting task is dropped
and listed under "Could not schedule" with the reason.

## Reminders, adapting, reporting to Earth

| Key | Default | Meaning | Safe range |
|---|---|---|---|
| `checkEverySeconds` | `30` | How often (simulated seconds) the monitor looks at the schedule. | 5 to 600 |
| `remindAtStart` | `true` | A small notice when a task, objective or health block starts. | true / false |
| `reminderAfterEndMinutes` | `[0, 5]` | Reminders sent this many minutes after a block should have ended without being ticked. The later ones are more urgent. Only values below `graceMinutes` fire. | list of numbers >= 0 |
| `graceMinutes` | `10` | Minutes after the block end after which it is **missed**: the schedule is adapted and the miss is counted. | 1 to 240 |
| `staleAfterHours` | `12` | A saved schedule older than this is rebuilt when the page loads. Before that, task, objective and health blocks that expired while the page was closed count as misses (at most `escalateAfterMisses` are counted per load), the schedule is adapted, and the normal Earth rule applies. | 1 to 336 |
| `escalateAfterMisses` | `3` | Missed blocks before a report is put in the Earth outbox. The counter then restarts. | 1 to 20 |

Only tasks, mission objectives and health checks are watched for misses. Sleep, meals and recreation are never "missed" or moved.
The Earth link is **simulated**: the report is only stored in this browser (outbox in the Planner tab). Nothing is transmitted.

## Testing reminders quickly

In the Planner tab, Schedule view, use "Demo clock" (real time, 60x, 600x, 3600x), or in the console `Atlas.clock.setSpeed(600)`.
Do not tick a block done and wait: reminders, the "missed" notice, the schedule change reasons and (after 3 misses) the Earth report appear.
`Atlas.clock.setSpeed(1)` restores real time. Planner data lives in localStorage keys starting with `jda.planner.`; remove them to start from scratch.

## Related files

- `web/js/schedule-engine.js`: the pure scheduling logic (`buildSchedule`, `reschedule`).
- `web/js/planner.js`: the tab, the to-do list, the monitor.
- `tests/planner.test.js`: tests for the engine (see the header of that file for how to run them).
