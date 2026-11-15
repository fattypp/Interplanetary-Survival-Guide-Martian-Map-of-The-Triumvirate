# Interplanetary Survival Guide: Martian Map — The Triumvirate

Our project for the **NASA Space Apps Challenge 2026**, challenge
[Interplanetary Survival Guide: Martian Map](https://www.spaceappschallenge.org/2026/challenges/interplanetary-survival-guide-martian-map/).

## What it does

A machine-learning model looks at satellite images of Mars (the Jezero Crater delta) and finds obstacles
that would be dangerous to walk over. For each one it gives the **exact coordinates** and a **guess of what it is**
(right now: craters). The results are shown on an interactive map.

> ⚠️ The model learns from example obstacles, so the examples must be checked carefully. Bad examples make it
> invent obstacles that aren't there, or miss real ones.

## Quick start (nothing to install)

Double-click **`jezero-delta-atlas/dist/jezero-delta-atlas.html`**. It opens the map in your browser.
Drag to move, scroll to zoom, use the *Layers* menu to show or hide crater marks.

## What's in this repo

| Folder / file | What it is |
|---|---|
| `jezero-delta-atlas/` | **The main project:** the map, the crater-detection model and its data. Has its own README with all the details. |
| `pages/mission-intro.html` | Intro page with the mission story and map. Its videos live in `pages/assets/`. |
| `pages/rover-sandstorm-simulator.html` | Prototype: Mars rover path and sandstorm simulator. |
| `docs/mission-guide.md` | The mission objectives. |
| `docs/to-do.md` | What the team still has to do. |

## Inside `jezero-delta-atlas/`

| Folder | What it is |
|---|---|
| `dist/` | The finished map as one single file. Open this one. |
| `web/` | The map's source: page (`html/`), styles (`css/`), code (`js/`), data, images. |
| `model/` | The crater-detection model (Python). |
| `integration/` | Scripts that download the Mars image and connect the model to the web page. |
| `archive/` | Old versions kept for reference. Not used by the current map. |
| `craters.csv` | Table of every crater found (opens in Excel / Sheets). |

See [`jezero-delta-atlas/README.md`](jezero-delta-atlas/README.md) for how to re-run the model.

## Live demo

- Intro page: https://fattypp.github.io/Interplanetary-Survival-Guide-Martian-Map-of-The-Triumvirate/pages/mission-intro.html
- Atlas: https://fattypp.github.io/Interplanetary-Survival-Guide-Martian-Map-of-The-Triumvirate/jezero-delta-atlas/dist/jezero-delta-atlas.html

![Jezero Delta Atlas](docs/atlas-screenshot.jpg)

## Route planner

The atlas has a **Route planner** panel. Click *Pick start and destination*, then click two points on the map. It finds the fastest route that avoids the detected craters (A* search on a grid of about 17 m cells) and reports the distance in km or m and the travel time for a rover (0.042 m/s) or an astronaut on foot (1.4 m/s). Craters with detector confidence 0.6 or higher are blocked; weaker marks only slow the route down. The code is in `jezero-delta-atlas/web/js/route-planner.js`. Slope, rocks and dunes are not modelled yet, because the repo has no elevation data fine enough for that.

## Team

The Triumvirate:

- Jayesh Araja
- Jose Perez-Carreño
- Juhyeok Ahn

## License and credits

Code is released under the [MIT License](LICENSE). Basemap imagery comes from the
Murray Lab CTX global mosaic and NASA MOLA data; the intro and simulator pages use
NASA Trek tiles. Those remain under their providers' terms. Credit NASA/JPL/Caltech/Murray Lab
when reusing them.
