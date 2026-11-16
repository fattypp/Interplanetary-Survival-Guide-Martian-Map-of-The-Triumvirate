/* Reference data for the tablet global map (web/js/tablet.js).
   Landing sites: published lat / lon of the mission landing points (planetographic latitude, east-positive longitude).
   Map image: web/images/mars-global.jpg, equirectangular, -180..+180 E, 90 N at the top (see docs/IMAGE-CREDITS.md). */
window.MARS_SITES = {
  radiusKm: 3389.5,
  image: { src: '../images/mars-global.jpg', lonMin: -180, lonMax: 180, latMin: -90, latMax: 90 },
  /* Jezero CTX mosaic (web/images/jezero-ctx-mosaic.jpg): north up, extent = bbox of web/data/craters-data.js (meta.bbox), same as the atlas map */
  ctx: { src: '../images/jezero-ctx-mosaic.jpg', lon0: 77.22318, lon1: 77.41956, lat0: 18.44176, lat1: 18.57188 },
  /* Landing sites: published landing coordinates, planetographic latitude, EAST-positive longitude (west values converted: 360 - W).
     Sources: NASA/JPL mission fact sheets and USGS Gazetteer of Planetary Nomenclature landing-site entries.
       Phoenix      68.22 N, 125.75 W (234.25 E)   Viking 1   22.48 N, 47.97 W (312.03 E)
       Viking 2     47.97 N, 225.74 W (134.26 E)   Pathfinder 19.13 N, 33.22 W (326.78 E)
       Opportunity   1.95 S,   5.53 W (354.47 E)   Spirit     14.57 S, 175.47 E
       Curiosity     4.59 S, 137.44 E               InSight     4.50 N, 135.62 E
       Perseverance 18.44 N,  77.45 E (landing 18.4446 N, 77.4509 E)
     Viking 2 is in Utopia Planitia on the EAST side of the map (+134.26 E). Values are accurate to about 0.1 degree. */
  sites: [
    { id: 'phoenix', name: 'Phoenix', lat: 68.22, lon: -125.75 },
    { id: 'viking1', name: 'Viking 1', lat: 22.48, lon: -47.97 },
    { id: 'viking2', name: 'Viking 2', lat: 47.97, lon: 134.26 },
    { id: 'pathfinder', name: 'Pathfinder', lat: 19.13, lon: -33.22 },
    { id: 'opportunity', name: 'Opportunity', lat: -1.95, lon: -5.53 },
    { id: 'spirit', name: 'Spirit', lat: -14.57, lon: 175.47 },
    { id: 'curiosity', name: 'Curiosity', lat: -4.59, lon: 137.44 },
    { id: 'insight', name: 'InSight', lat: 4.5, lon: 135.62 },
    { id: 'perseverance', name: 'Perseverance', lat: 18.4446, lon: 77.4509 }
  ],
  /* Jezero crater region used when a mission task is selected */
  jezero: { lat: 18.485, lon: 77.355, ppd: 2800 },
  /* lat, lon of the stops in docs/mission-guide.md (landing exact; the others are positions drawn on the detailed Jezero map, approximate) */
  stopPos: {
    "sample-1": [18.426, 77.4607],
    "sample-2": [18.3998, 77.4325],
    "sample-3": [18.3877, 77.4346],
    "sample-4": [18.4029, 77.4078],
    "sample-5": [18.4061, 77.396],
    "sample-6": [18.3983, 77.4096],
    "sample-7": [18.4118, 77.3959],
    "sample-8": [18.4491, 77.4506],
    "sample-9": [18.4381, 77.4558],
    "sample-10": [18.4642, 77.4271],
    "sample-11": [18.464, 77.4149],
    "sample-12": [18.4603, 77.4301],
    "sample-13": [18.4694, 77.4132],
    "sample-14": [18.454, 77.4298],
    "sample-15": [18.476, 77.4158],
    "sample-16": [18.4478, 77.4248],
    "sample-17": [18.4809, 77.4231],
    "sample-18": [18.445, 77.4156],
    "sample-19": [18.5167, 77.3419],
    "sample-20": [18.5219, 77.3529],
    "sample-21": [18.519, 77.3375],
    "sample-22": [18.4159, 77.2939],
    "sample-23": [18.4091, 77.2837],
    "sample-24": [18.4142, 77.2985],
    "sample-25": [18.556, 77.2479],
    "sample-26": [18.3919, 77.2548],
    "sample-27": [18.3886, 77.2666],
    "sample-28": [18.3965, 77.253],
    "place-landing": [18.4446, 77.4509],
    "place-hawksbill-gap": [18.4785, 77.399],
    "place-three-forks": [18.4468, 77.4278],
    "place-neretva-vallis": [18.5847, 77.2513],
    "place-witch-hazel-hill": [18.3965, 77.2601],
    "place-seitah": [18.4071, 77.4131]
  }
};
