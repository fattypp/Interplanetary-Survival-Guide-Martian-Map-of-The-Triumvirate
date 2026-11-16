# Mission Guide: Jezero Pathfinder

Source of truth for the mission shown in the atlas (Mission tab, pins, planner, automated schedule), the tablet and the helmet.
`jezero-delta-atlas/web/data/mission-data.js` (`window.JEZERO_MISSION`) is generated from the tables below with
`python3 integration/web_bridge.py missiondata`. The story, the stop positions and their accuracy are in the repo-root file `MissionGuide`.

**Status of the wording.** The stop names, coordinates and the "What the crew does" text of the five stops come from `MissionGuide`.
The task titles and descriptions below are editorial: for each stop the main objective uses the MissionGuide text, and the task for the
other objective is a short, plausible complementary task written by the development team. They need the science owner's confirmation
before they are treated as the official task list. Estimated minutes are rough planning values (20 to 60) and need the same confirmation.

**Story.** A crew drives a pressurised rover west from flat ground at the foot of the delta, up and across the old river delta, to the
ravine where the river once entered the crater. They get out on foot at five stops, then drive back. One day, about 15 km round trip.

The rules of the format (checked by the generator, which refuses to write bad data):
exactly 2 objectives, a base camp, exactly 5 stops and exactly 10 tasks (per stop one task for Objective 1 and one for Objective 2).
Cells are separated by `|` (do not use the pipe character inside a cell). Positions are degrees and must lie inside the atlas map
(18.44176 to 18.57188 N, 77.22318 to 77.41956 E). Page pixels are computed from them: `x = (lon - 77.22318) / 0.19638 * 1990`,
`y = (18.57188 - lat) / 0.13012 * 1390`.

## Mission Objectives

| Id | Title | Short |
|---|---|---|
| 1 | Find evidence of ancient microbial life | Microbial life |
| 2 | Assess whether the site can sustain human life | Sustaining human life |

Objective 2 means: water, shelter from radiation, and safe ground.

## Mission Stops

The first row (`base`) is Base camp, the start and end of the drive; it is not a stop. The next five rows are the stops, in visiting order.

| Id | Name | Lat | Lon | Description |
|---|---|---|---|---|
| base | Base camp | 18.4470 | 77.4080 | Three Forks floor. Start and end of the drive. Confirm the ground is flat and rock-free enough to live on. |
| stop-1 | Three Forks sample depot | 18.4525 | 77.4015 | Level ground close to the foot of the delta where the 10 sample tubes were left. |
| stop-2 | Delta front mudstone | 18.4580 | 77.3970 | Fine-grained layers at the front of the delta, laid down in still water. |
| stop-3 | Delta top boulders | 18.4800 | 77.3850 | Boulders on top of the delta that the river carried in. |
| stop-4 | Western delta clay beds | 18.5020 | 77.3690 | Clay-rich beds in the western part of the delta. |
| stop-5 | Western Breach and Bright Angel | 18.4930 | 77.2930 | The ravine where the river entered the crater, near the Bright Angel outcrops and the Cheyava Falls find. |

## Mission Tasks

One task per stop and objective. Task id = `task-<stop number>-<objective>`.

| Id | Stop | Objective | Title | Description | Est. min |
|---|---|---|---|---|---|
| task-1-1 | stop-1 | 1 | Recover the sample tubes | Recover the 10 sample tubes: photograph, check seal, log, stow. | 45 |
| task-1-2 | stop-1 | 2 | Check ground and shelter at the depot | Check how firm and how level the ground is around the depot, and note rock overhangs or hollows that could shelter people from radiation. | 25 |
| task-2-1 | stop-2 | 1 | Sample the finest mud layers | Find the finest mud layers, look for colour spots or rings, sample below the surface. | 60 |
| task-2-2 | stop-2 | 2 | Look for water-bearing minerals in the mudstone | Check the mudstone for minerals that hold water, as a possible water source, and log whether the slope is stable enough to walk on. | 30 |
| task-3-1 | stop-3 | 1 | Photograph and sample the boulders | Photograph and sample boulders the river carried in. | 40 |
| task-3-2 | stop-3 | 2 | Judge boulder spacing for safe ground | Measure the size and spacing of the boulders to judge where the rover can drive safely and where a shelter could be placed. | 30 |
| task-4-1 | stop-4 | 1 | Sample one intact clay layer | Photograph the layering and sample one intact clay layer; seal and log it. | 45 |
| task-4-2 | stop-4 | 2 | Test how much water the clay holds | Test how much water the clay holds, as a possible water source for the crew. | 40 |
| task-5-1 | stop-5 | 1 | Photograph the ravine walls and sample the channel floor | Photograph the ravine walls; sample channel-floor mudstone near the Cheyava Falls find. | 60 |
| task-5-2 | stop-5 | 2 | Check shelter and safe passage in the ravine | Record how well the ravine walls shelter people from radiation and wind, and check whether the channel floor is safe to cross. | 30 |

## Travel speeds

Not part of this table format: `web/data/travel-speeds.js` (`window.JEZERO_SPEEDS`) is the single source. The pressurised rover
drives at 2.8 m/s (about 10 km/h); a person on foot walks at 1.4 m/s (about 5 km/h).
