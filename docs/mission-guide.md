# Mission Guide

## Mission Objectives

1. **Objective 1:** Find evidence of ancient microbial life.
2. **Objective 2:** Assess whether the site can sustain life.

## Mission Stops

This section is the single source of truth for the stops shown in the atlas (the Mission tab and the pins on the map).
`web/data/mission-data.js` is generated from it with `python3 integration/web_bridge.py missiondata`.

Columns, in this order, separated by `|` (do not use the pipe character inside a cell):

- **Id**: unique, lower case, no spaces (`sample-N` or `place-name`). The pin number is the row order.
- **Name**, **Kind** (`sample` or `place`), **Area**, **Description**.
- **Sol** and **Date**: the sol and Earth date the sample was sealed; `-` for places with no single date.
- **Objectives**: the objective numbers the stop serves (`1`, `2`, `1, 2`), or `-`. This tagging is an editorial,
  simplified mapping: sedimentary and carbonate samples serve both objectives (biosignature search and habitability);
  igneous, impactite, serpentinite, regolith and atmospheric samples serve Objective 2 (what the site could sustain).
  Edit the column if the science team decides differently.
- **Lat, Lon**: optional degrees (`18.4446, 77.4509`) or `-`. Where `-`, the map places the stop with the same rule the
  sample and place layers use (samples are spread around their area, places sit at a fixed approximate position).

Stops whose position falls outside the current map are still listed and flagged "outside current map" (no pin is drawn).
The sample list (names, areas, sols, dates) comes from the sample table of the atlas map; place descriptions come from its place names.

| Id | Name | Kind | Area | Description | Sol | Date | Objectives | Lat, Lon |
|---|---|---|---|---|---|---|---|---|
| sample-1 | Roubion | sample | Polygon Valley | Atmospheric sample. Target: Roubion. | 164 | 6 Aug 2021 | 2 | - |
| sample-2 | Montdenier | sample | Artuby Ridge | Igneous sample. Target: Rochette. | 194 | 6 Sep 2021 | 2 | - |
| sample-3 | Montagnac | sample | Artuby Ridge | Igneous sample. Target: Rochette. | 196 | 8 Sep 2021 | 2 | - |
| sample-4 | Salette | sample | South Séítah | Igneous sample. Target: Brac. | 262 | 15 Nov 2021 | 2 | - |
| sample-5 | Coulettes | sample | South Séítah | Igneous sample. Target: Brac. | 271 | 24 Nov 2021 | 2 | - |
| sample-6 | Robine | sample | South Séítah | Igneous sample. Target: Issole. | 298 | 22 Dec 2021 | 2 | - |
| sample-7 | Malay | sample | South Séítah | Igneous sample. Target: Issole. | 337 | 31 Jan 2022 | 2 | - |
| sample-8 | Ha'ahóni | sample | Octavia E. Butler Landing / Ch'ał outcrop | Igneous sample. Target: Sid. | 371 | 7 Mar 2022 | 2 | - |
| sample-9 | Atsá | sample | Octavia E. Butler Landing / Ch'ał outcrop | Igneous sample. Target: Sid. | 377 | 13 Mar 2022 | 2 | - |
| sample-10 | Swift Run | sample | Delta Front | Sedimentary sample. Target: Skinner Ridge. | 490 | 7 Jul 2022 | 1, 2 | - |
| sample-11 | Skyland | sample | Delta Front | Sedimentary sample. Target: Skinner Ridge. | 495 | 12 Jul 2022 | 1, 2 | - |
| sample-12 | Hazeltop | sample | Delta Front | Sedimentary sample. Target: Wildcat Ridge. | 509 | 27 Jul 2022 | 1, 2 | - |
| sample-13 | Bearwallow | sample | Delta Front | Sedimentary sample. Target: Wildcat Ridge. | 516 | 3 Aug 2022 | 1, 2 | - |
| sample-14 | Shuyak | sample | Delta Front | Sedimentary sample. Target: Amalik. | 575 | 2 Oct 2022 | 1, 2 | - |
| sample-15 | Mageik | sample | Delta Front | Sedimentary sample. Target: Amalik. | 619 | 16 Nov 2022 | 1, 2 | - |
| sample-16 | Kukaklek | sample | Delta Front | Sedimentary sample. Target: Hidden Harbor. | 631 | 29 Nov 2022 | 1, 2 | - |
| sample-17 | Atmo Mountain | sample | Delta Front | Regolith sample. Target: Observation Mountain. | 634 | 2 Dec 2022 | 2 | - |
| sample-18 | Crosswind Lake | sample | Delta Front | Regolith sample. Target: Observation Mountain. | 639 | 7 Dec 2022 | 2 | - |
| sample-19 | Melyn | sample | Upper Fan | Sedimentary sample. Target: Berea. | 749 | 30 Mar 2023 | 1, 2 | - |
| sample-20 | Otis Peak | sample | Upper Fan | Sedimentary sample. Target: Emerald Lake. | 832 | 23 Jun 2023 | 1, 2 | - |
| sample-21 | Pilot Mountain | sample | Upper Fan | Sedimentary sample. Target: Dream Lake. | 913 | 15 Sep 2023 | 1, 2 | - |
| sample-22 | Pelican Point | sample | Margin Unit | Sedimentary sample. Target: Hans Amundsen Memorial Workspace. | 923 | 25 Sep 2023 | 1, 2 | - |
| sample-23 | Lefroy Bay | sample | Margin Unit | Sedimentary sample. Target: Turquoise Bay. | 949 | 21 Oct 2023 | 1, 2 | - |
| sample-24 | Comet Geyser | sample | Margin Unit | Silica-cemented carbonate sample. Target: Bunsen Peak. | 1088 | 12 Mar 2024 | 1, 2 | - |
| sample-25 | Sapphire Canyon | sample | Neretva Vallis | Sedimentary sample. Target: Cheyava Falls. | 1215 | 21 Jul 2024 | 1, 2 | - |
| sample-26 | Silver Mountain | sample | Crater Rim (Witch Hazel Hill) | Igneous / impactite sample. Target: Shallow Bay. | 1401 | 28 Jan 2025 | 2 | - |
| sample-27 | Green Gardens | sample | Crater Rim (Witch Hazel Hill) | Serpentinite sample. Target: Tablelands. | 1433 | 2 Mar 2025 | 2 | - |
| sample-28 | Main River | sample | Crater Rim (Witch Hazel Hill) | Igneous / impactite sample. Target: Broom Point. | 1441 | 10 Mar 2025 | 2 | - |
| place-landing | Octavia E. Butler Landing | place | Octavia E. Butler Landing / Ch'ał outcrop | Landing site of Perseverance, 18 February 2021. | 0 | 18 Feb 2021 | 1, 2 | 18.4446, 77.4509 |
| place-hawksbill-gap | Hawksbill Gap | place | Delta Front | Gap in the delta front that the rover climbed in 2022 to reach the top of the delta. Position approximate. | - | - | 1, 2 | - |
| place-three-forks | Three Forks | place | Delta Front | Staging area where three route options to the delta merge, used to start the Delta Front campaign. Position approximate. | - | - | 1, 2 | - |
| place-neretva-vallis | Neretva Vallis | place | Neretva Vallis | Ancient river channel that fed the delta from the west. Cheyava Falls, the sample 25 target, lies along it. | - | - | 1, 2 | - |
| place-witch-hazel-hill | Witch Hazel Hill | place | Crater Rim (Witch Hazel Hill) | Stop on the crater rim, where serpentinite and impact-related rocks were sampled in 2025. Position approximate. | - | - | 2 | - |
| place-seitah | Séítah | place | Séítah | Crater-floor unit of igneous rock sampled in 2021 and early 2022. Position approximate. | - | - | 2 | - |
