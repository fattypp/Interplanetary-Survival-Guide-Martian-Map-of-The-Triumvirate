/* Reference data for the tablet global map (web/js/tablet.js).
   Landing sites of OTHER missions (context only, unrelated to the crew's five stops): published lat / lon of the mission landing points (planetographic latitude, east-positive longitude).
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
  /* Fallback view of the Jezero CTX tile (centre of the mosaic); the tablet fits the view to base camp and the stops from JEZERO_MISSION */
  jezero: { lat: 18.5068, lon: 77.3214, ppd: 2800 }
};
