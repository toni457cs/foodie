/*
 * Demo dataset: fictional restaurants around Folsom, CA, modeled on what came
 * up in the interviews and field test (a lakeside place with views, a French
 * crêperie with flowers and local art, a hip-but-chaotic brewery, a quick &
 * clean spot, a diner in the old train depot near the amphitheater).
 *
 * Unlike live OpenStreetMap results, every field is filled in, so the demo
 * shows the full scoring. Names and ratings are made up; this is not real
 * data about real businesses.
 */
(function (root) {
  const DEMO = {
    center: { lat: 38.6779, lon: -121.1761, label: 'Folsom, CA (demo data)' },
    restaurants: [
      {
        id: 'demo-lakeview', name: 'Lakeview Crawfish House', cuisine: ['seafood'],
        noise: 1.2, price: 3, parking: true, cleanliness: 0.85, service: 0.8, waitMinutes: 35, popularity: 0.85,
        vibes: ['views', 'patio', 'design'], goodFor: ['family', 'partner', 'friends', 'coworkers'], quick: false,
        hours: 'Mo-Th 11:00-21:00; Fr,Sa 11:00-22:00; Su 10:00-21:00', lat: 38.7052, lon: -121.1585,
        blurb: 'Sunset deck right on the lake.',
      },
      {
        id: 'demo-crepes', name: 'Petite Maison Crêperie', cuisine: ['cafe', 'brunch'],
        noise: 0.6, price: 2, parking: true, cleanliness: 0.95, service: 0.9, waitMinutes: 10, popularity: 0.7,
        vibes: ['design', 'cozy', 'local'], goodFor: ['partner', 'friends', 'family', 'solo'], quick: false,
        hours: 'Mo-Su 08:00-21:00', lat: 38.6771, lon: -121.1752,
        blurb: 'French furniture, fresh flowers, local wine & art on the walls.',
      },
      {
        id: 'demo-brewery', name: 'Railyard Brewing Co.', cuisine: ['pub', 'american'],
        noise: 1.9, price: 2, parking: false, cleanliness: 0.45, service: 0.7, waitMinutes: 20, popularity: 0.95,
        vibes: ['design', 'live_music', 'patio'], goodFor: ['friends', 'coworkers'], quick: false,
        hours: 'Mo-Su 11:00-23:00', lat: 38.6786, lon: -121.1771,
        blurb: 'Hip brick building with great lettering, often packed and rowdy.',
      },
      {
        id: 'demo-ember', name: 'Ember & Oak Steakhouse', cuisine: ['steak'],
        noise: 1.1, price: 4, parking: true, cleanliness: 0.9, service: 0.9, waitMinutes: 30, popularity: 0.8,
        vibes: ['design', 'cozy'], goodFor: ['partner', 'coworkers', 'family'], quick: false,
        hours: 'Mo-Su 16:00-22:00', lat: 38.6655, lon: -121.1452,
        blurb: 'You can smell the wood-fired grill from the parking lot.',
      },
      {
        id: 'demo-amapola', name: 'Casa Amapola', cuisine: ['mexican'],
        noise: 1.4, price: 2, parking: true, cleanliness: 0.75, service: 0.8, waitMinutes: 15, popularity: 0.7,
        vibes: ['patio', 'local'], goodFor: ['family', 'friends', 'coworkers'], quick: false,
        hours: 'Mo-Su 10:30-21:30', lat: 38.6702, lon: -121.1601,
        blurb: 'Family-run, colorful patio, big shareable plates.',
      },
      {
        id: 'demo-trattoria', name: 'Sutter Street Trattoria', cuisine: ['italian'],
        noise: 0.9, price: 3, parking: false, cleanliness: 0.9, service: 0.85, waitMinutes: 25, popularity: 0.75,
        vibes: ['design', 'cozy', 'patio'], goodFor: ['partner', 'family', 'friends'], quick: false,
        hours: 'Tu-Su 11:30-21:30; Mo off', lat: 38.6776, lon: -121.1768,
        blurb: 'Candlelit historic storefront. Street parking only.',
      },
      {
        id: 'demo-greenbowl', name: 'Green Bowl Kitchen', cuisine: ['vegetarian', 'mediterranean'],
        noise: 0.7, price: 2, parking: true, cleanliness: 0.95, service: 0.8, waitMinutes: 5, popularity: 0.5,
        vibes: ['design'], goodFor: ['solo', 'coworkers', 'friends'], quick: true,
        hours: 'Mo-Sa 10:00-20:00; Su off', lat: 38.6612, lon: -121.1555,
        blurb: 'Bright, spotless, in and out in 15 minutes.',
      },
      {
        id: 'demo-sakura', name: 'Sakura Hana Sushi', cuisine: ['japanese'],
        noise: 0.6, price: 3, parking: true, cleanliness: 0.9, service: 0.85, waitMinutes: 20, popularity: 0.65,
        vibes: ['cozy', 'design'], goodFor: ['partner', 'friends', 'coworkers'], quick: false,
        hours: 'Mo-Su 11:30-14:30,16:30-21:30', lat: 38.6589, lon: -121.1487,
        blurb: 'Quiet omakase counter with warm wood lighting.',
      },
      {
        id: 'demo-lotus', name: 'Golden Lotus', cuisine: ['chinese'],
        noise: 1.0, price: 2, parking: true, cleanliness: 0.65, service: 0.6, waitMinutes: 10, popularity: 0.55,
        vibes: [], goodFor: ['family', 'friends'], quick: false,
        hours: 'Mo-Su 11:00-21:30', lat: 38.6725, lon: -121.1499,
        blurb: 'Lazy-Susan tables built for big families.',
      },
      {
        id: 'demo-bangkok', name: 'Bangkok Garden', cuisine: ['thai'],
        noise: 0.8, price: 2, parking: true, cleanliness: 0.8, service: 0.9, waitMinutes: 10, popularity: 0.6,
        vibes: ['patio'], goodFor: ['partner', 'friends', 'family', 'coworkers'], quick: false,
        hours: 'Mo-Su 11:00-21:00', lat: 38.6801, lon: -121.1655,
        blurb: 'Garden patio strung with lights.',
      },
      {
        id: 'demo-spice', name: 'Spice Route Indian', cuisine: ['indian'],
        noise: 0.9, price: 2, parking: true, cleanliness: 0.7, service: 0.4, waitMinutes: 5, popularity: 0.45,
        vibes: [], goodFor: ['family', 'friends', 'coworkers'], quick: false,
        hours: 'Mo-Su 11:00-22:00', lat: 38.6643, lon: -121.1702,
        blurb: 'Great curry; reviews mention slow, curt service.',
      },
      {
        id: 'demo-quickfork', name: 'Quick Fork Grill', cuisine: ['american'],
        noise: 1.0, price: 1, parking: true, cleanliness: 0.9, service: 0.75, waitMinutes: 0, popularity: 0.5,
        vibes: [], goodFor: ['solo', 'coworkers', 'family'], quick: true,
        hours: 'Mo-Su 10:00-22:00', lat: 38.6688, lon: -121.1525,
        blurb: 'Clean counter-service burgers, drive-thru too.',
      },
      {
        id: 'demo-harbor', name: 'Harbor Point Oyster Bar', cuisine: ['seafood'],
        noise: 1.5, price: 4, parking: true, cleanliness: 0.85, service: 0.85, waitMinutes: 45, popularity: 0.9,
        vibes: ['views', 'patio', 'live_music'], goodFor: ['partner', 'friends'], quick: false,
        hours: 'We-Su 15:00-23:00', lat: 38.7101, lon: -121.1632,
        blurb: 'Marina views and a jazz trio on weekends.',
      },
      {
        id: 'demo-depot', name: 'Depot Diner', cuisine: ['american', 'brunch'],
        noise: 1.1, price: 1, parking: true, cleanliness: 0.7, service: 0.85, waitMinutes: 15, popularity: 0.6,
        vibes: ['local'], goodFor: ['family', 'friends', 'solo'], quick: false,
        hours: 'Mo-Su 06:30-14:30', lat: 38.6774, lon: -121.1779,
        blurb: 'Inside the old train depot. Breakfast and lunch only.',
      },
      {
        id: 'demo-tacotruck', name: 'Amphitheater Tacos', cuisine: ['mexican'],
        noise: 1.8, price: 1, parking: false, cleanliness: 0.6, service: 0.8, waitMinutes: 10, popularity: 0.8,
        vibes: ['live_music', 'patio'], goodFor: ['friends', 'solo'], quick: true,
        hours: 'Th-Su 17:00-23:00', lat: 38.6769, lon: -121.1786,
        blurb: 'Food truck next to the live-music amphitheater.',
      },
      {
        id: 'demo-olive', name: 'Olive & Fig Mezze', cuisine: ['mediterranean'],
        noise: 0.5, price: 3, parking: true, cleanliness: 0.9, service: 0.95, waitMinutes: 15, popularity: 0.55,
        vibes: ['views', 'design', 'cozy'], goodFor: ['partner', 'family', 'coworkers'], quick: false,
        hours: 'Tu-Su 11:30-21:30; Mo off', lat: 38.6934, lon: -121.1508,
        blurb: 'Hilltop dining room overlooking the valley.',
      },
      {
        id: 'demo-pho', name: 'Pho Saigon Corner', cuisine: ['asian'],
        noise: 0.9, price: 1, parking: true, cleanliness: 0.8, service: 0.7, waitMinutes: 5, popularity: 0.6,
        vibes: [], goodFor: ['solo', 'family', 'coworkers'], quick: true,
        hours: 'Mo-Su 10:00-21:00', lat: 38.6631, lon: -121.1611,
        blurb: 'Steaming bowls in under ten minutes.',
      },
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = DEMO;
  else root.FOODIE_DEMO = DEMO;
})(typeof self !== 'undefined' ? self : this);
