# Image credits

## web/images/mars-surface.jpg (helmet view background)
- Source URL: https://images-assets.nasa.gov/image/PIA23727/PIA23727~orig.jpg (NASA Image and Video Library record PIA23727: https://images.nasa.gov/details/PIA23727)
- Title: Perseverance's Mastcam-Z First High-Resolution Panorama (PIA23727)
- Mission / instrument: Mars 2020 Perseverance rover, Mastcam-Z right-eye 110 mm zoom mosaic, Jezero Crater; images taken Sol 4 (22 Feb 2021); released 2 Mar 2021
- Credit: NASA/JPL-Caltech/ASU/MSSS
- Processing: cropped to remove the black mosaic border, resized to 2000 px wide, recompressed as JPEG (about 270 KB). Downloaded 15 Nov 2026.

## web/images/mars-global.jpg (tablet global map)
- Source: Wikimedia Commons file "Mars Viking MDIM21 ClrMosaic 1km.jpg" (https://commons.wikimedia.org/wiki/File:Mars_Viking_MDIM21_ClrMosaic_1km.jpg), downloaded as the 3840 px server-side thumbnail https://upload.wikimedia.org/wikipedia/commons/thumb/1/1f/Mars_Viking_MDIM21_ClrMosaic_1km.jpg/3840px-Mars_Viking_MDIM21_ClrMosaic_1km.jpg (original 21339 x 10670 px, 1 km/pixel). The USGS Astropedia host (astropedia.astrogeology.usgs.gov) was not reachable from the build machine, so the Commons copy of the same USGS product was used.
- Original product: Viking Colorized Mars Digital Image Model (MDIM) 2.1, NASA Ames / USGS Astrogeology Science Center (https://astrogeology.usgs.gov/search/details/Mars/Viking/MDIM21/Mars_Viking_MDIM21_ClrMosaic_global_232m/cub). Commons metadata: credit NASA / Jet Propulsion Lab / USGS, licence public domain, dated 2014-03-06.
- Extent convention (checked visually against Olympus Mons, Valles Marineris, Hellas and Syrtis Major): full globe, simple cylindrical (equirectangular), left edge 180 deg W, right edge 180 deg E, centre meridian 0 deg, top 90 N, bottom 90 S, east-positive longitude in -180..+180. Pixel x = (lon + 180) / 360 * width, y = (90 - lat) / 180 * height. Jezero (77.45 E, 18.44 N) falls at 71.5 % across, 39.7 % down.
- Processing: downscaled to 2400 x 1200 px (Lanczos), recompressed as progressive JPEG quality 80 (about 700 KB). Downloaded 15 Nov 2026.

## web/images/stops/*.jpg (stop pictures, version 5)
Real Mars 2020 (Perseverance) raw images of the areas near the stops, from the public raw-images archive of https://mars.nasa.gov/mars2020/multimedia/raw-images/ (found through its JSON feed https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&sol=N, reachable on the access date). Credit: NASA/JPL-Caltech (public domain). Processing: the 1200 px browse JPEG was resized to 800 px wide and recompressed (JPEG quality 80, 14-73 KB each); base.jpg is also cropped to the ground and horizon. Rover positions per sol were not looked up: matches are by sol, date and what the picture shows, so each is an image of the area, not an exact view of the stop. All accessed 15 Nov 2026.

| Stop | File | Sol (date) | Camera | Original URL | Match quality |
|---|---|---|---|---|---|
| 1 Three Forks sample depot | stop-1.jpg | 695 (2 Feb 2023) | Left Navcam, NLF_0695_0728644425_176ECM | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00695/ids/edr/browse/ncam/NLF_0695_0728644425_176ECM_N0330000NCAM12695_01_195J01_1200.jpg | Same area (Three Forks), days after the depot was completed; exact spot unchecked |
| 2 Delta front mudstone | stop-2.jpg | 510 (27 Jul 2022) | Left Navcam (B&W), NLG_0510_0712219622_190ECM | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00510/ids/edr/browse/ncam/NLG_0510_0712219622_190ECM_N0261222NCAM00500_00_2I4J01_1200.jpg | Representative of the delta front; not matched to the metre |
| 3 Delta top boulders | stop-3.jpg | 420 (26 Apr 2022) | Left Navcam, NLF_0420_0704213098_508ECM | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00420/ids/edr/browse/ncam/NLF_0420_0704213098_508ECM_N0232532NCAM13419_01_195J01_1200.jpg | Representative of boulder-strewn delta ground; distance not measured |
| 4 Western delta clay beds | stop-4.jpg | 800 (21 May 2023) | Left Navcam, NLF_0800_0737945822_612ECM (frame _01_195J) | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00800/ids/edr/browse/ncam/NLF_0800_0737945822_612ECM_N0391170NCAM02799_01_195J01_1200.jpg | Representative of the upper delta; not the clay beds themselves |
| 5 Western Breach and Bright Angel | stop-5.jpg | 1215 (21 Jul 2024) | Left Navcam, NLF_1215_0774814981_145ECM | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01215/ids/edr/browse/ncam/NLF_1215_0774814981_145ECM_N0560000NCAM00709_02_095J01_1200.jpg | Neretva Vallis channel, the Cheyava Falls week; position unchecked |
| Base camp | base.jpg | 690 (28 Jan 2023) | Left Navcam, NLF_0690_0728189040_534ECM (cropped) | https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00690/ids/edr/browse/ncam/NLF_0690_0728189040_534ECM_N0321184NCAM00501_01_295J01_1200.jpg | Representative of the flat Three Forks floor |
