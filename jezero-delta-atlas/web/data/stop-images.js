/* Real Mars 2020 Perseverance raw images of the areas near the stops. Public domain, credit NASA/JPL-Caltech.
   Source listing: https://mars.nasa.gov/mars2020/multimedia/raw-images/ . Details: docs/IMAGE-CREDITS.md.
   Each picture is near the stop, never an exact view of it. */
window.JEZERO_STOP_IMAGES = {
  'stop-1': {
    src: '../images/stops/stop-1.jpg',
    caption: 'Flat ground with the delta edge on the horizon, a few days after the Three Forks sample depot was finished. Perseverance, sol 695, Left Navcam, near Three Forks.',
    sol: 695, camera: 'Left Navigation Camera (Navcam)', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00695/ids/edr/browse/ncam/NLF_0695_0728644425_176ECM_N0330000NCAM12695_01_195J01_1200.jpg',
    note: 'Taken in the Three Forks area at the foot of the delta, 2 Feb 2023, days after the depot was completed. Exact rover position was not checked against the stop, so it is the area, not this exact spot.'
  },
  'stop-2': {
    src: '../images/stops/stop-2.jpg',
    caption: 'Layered rocky ridges on the slope of the delta front. Perseverance, sol 510, Left Navcam, near the delta front.',
    sol: 510, camera: 'Left Navigation Camera (Navcam), black and white', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00510/ids/edr/browse/ncam/NLG_0510_0712219622_190ECM_N0261222NCAM00500_00_2I4J01_1200.jpg',
    note: 'Representative image of the delta front, taken 27 Jul 2022 while the rover worked along the delta front. It was not matched to the stop to the metre.'
  },
  'stop-3': {
    src: '../images/stops/stop-3.jpg',
    caption: 'Boulders and rocks scattered over the ground on the way up onto the delta. Perseverance, sol 420, Left Navcam, near the delta top.',
    sol: 420, camera: 'Left Navigation Camera (Navcam)', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00420/ids/edr/browse/ncam/NLF_0420_0704213098_508ECM_N0232532NCAM13419_01_195J01_1200.jpg',
    note: 'Representative image of boulder-strewn delta ground, taken 26 Apr 2022. Its distance from the stop was not measured.'
  },
  'stop-4': {
    src: '../images/stops/stop-4.jpg',
    caption: 'Stones and rock slabs on a slope of the delta, with a high ridge behind. Perseverance, sol 800, Left Navcam, on the upper delta.',
    sol: 800, camera: 'Left Navigation Camera (Navcam)', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00800/ids/edr/browse/ncam/NLF_0800_0737945822_612ECM_N0391170NCAM02799_01_195J01_1200.jpg',
    note: 'Representative image of the upper delta, taken 21 May 2023. It is not a view of the clay beds themselves, and its distance from the stop was not measured.'
  },
  'stop-5': {
    src: '../images/stops/stop-5.jpg',
    caption: 'Layered rock slabs and wind ripples in the Neretva Vallis channel. Perseverance, sol 1215, Left Navcam, near Bright Angel.',
    sol: 1215, camera: 'Left Navigation Camera (Navcam)', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/01215/ids/edr/browse/ncam/NLF_1215_0774814981_145ECM_N0560000NCAM00709_02_095J01_1200.jpg',
    note: 'Taken 21 Jul 2024 in the Neretva Vallis channel, the day before the Cheyava Falls rock was announced as found. Rover position was not checked against the stop. The camera was pointed steeply down (mast elevation about -45 degrees), so it is a close-range view of the ground beside the rover.'
  },
  'base': {
    src: '../images/stops/base.jpg',
    caption: 'Flat, open ground and a low rise at the foot of the delta. Perseverance, sol 690, Left Navcam, near Three Forks.',
    sol: 690, camera: 'Left Navigation Camera (Navcam), cropped', credit: 'NASA/JPL-Caltech',
    rawUrl: 'https://mars.nasa.gov/mars2020-raw-images/pub/ods/surface/sol/00690/ids/edr/browse/ncam/NLF_0690_0728189040_534ECM_N0321184NCAM00501_01_295J01_1200.jpg',
    note: 'Representative of the flat Three Forks floor, taken 28 Jan 2023 during depot work. Cropped to remove the sky and the rover deck.'
  }
};
