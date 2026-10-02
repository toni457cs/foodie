/*
 * Real Folsom, CA restaurants, compiled from public web listings (Tripadvisor,
 * Yelp, OpenTable, Yellow Pages, restaurant sites) in October 2026.
 *
 * Used where the app can't reach the live map service (e.g. a sandboxed
 * preview). Only facts the listings state are filled in: name, cuisine,
 * street address, and a few listed features (patio, lake view, historic
 * building). Coordinates are approximate, placed by street or shopping center,
 * so distances are rough.
 *
 * Noise is estimated from venue type, as for live OpenStreetMap data.
 * Cleanliness, service, wait, popularity, parking and price are unknown
 * (null). They never trigger a dealbreaker and show as "unverified".
 * Hours are included only where a listing gave them.
 */
(function (root) {
  // Approximate centers for each part of town.
  const AREA = {
    sutter: [38.6776, -121.1762], // Historic District / Sutter St
    riley: [38.6748, -121.1725],
    greenbackBridge: [38.6893, -121.1818],
    greenbackWest: [38.6826, -121.2045],
    blueRavineEast: [38.6829, -121.1555],
    blueRavineWest: [38.6838, -121.1702],
    palladio: [38.6497, -121.1215],
    eastBidwell: [38.6552, -121.1183],
    ironPoint: [38.6445, -121.1447],
    prairieCity: [38.6551, -121.1566],
  };

  const VENUE = {
    restaurant: { noise: 1.0, goodFor: ['partner', 'friends', 'family', 'coworkers'], quick: false },
    casual: { noise: 1.2, goodFor: ['solo', 'friends', 'family', 'coworkers'], quick: true },
    cafe: { noise: 0.6, goodFor: ['solo', 'partner', 'friends'], quick: true },
    pub: { noise: 1.7, goodFor: ['friends', 'coworkers'], quick: false },
  };

  let n = 0;
  function place(name, cuisine, address, area, venue, extra = {}) {
    const [lat, lon] = AREA[area];
    const v = VENUE[venue];
    // Small offset so places in the same center don't stack exactly.
    const jitter = ((n++ % 5) - 2) * 0.0006;
    return {
      id: 'folsom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name,
      cuisine,
      address: `${address}, Folsom, CA`,
      noise: v.noise,
      price: null,
      parking: null,
      cleanliness: null,
      service: null,
      waitMinutes: null,
      popularity: null,
      vibes: [],
      goodFor: v.goodFor,
      quick: v.quick,
      hours: null,
      lat: lat + jitter,
      lon: lon - jitter,
      source: 'Web listings, Oct 2026',
      estimated: true,
      ...extra,
    };
  }

  const DEMO = {
    center: { lat: 38.6779, lon: -121.1761, label: 'Folsom, CA' },
    // Example diners offered in previews so group picks can be tried without friends.
    sampleDiners: [
      { id: 'ex-priya', name: 'Priya (example)', cuisines: ['cafe', 'mediterranean'], novelty: 'new', noise: 'buzz',
        dealbreakers: ['messy'], maxWait: 30, diningWith: 'family', vibes: ['design', 'local'], favorites: [], visited: [] },
      { id: 'ex-marcus', name: 'Marcus (example)', cuisines: ['any'], novelty: 'favorites', noise: 'buzz',
        dealbreakers: ['no_parking'], maxWait: 15, diningWith: 'family', vibes: ['views', 'design'], favorites: [], visited: [] },
      { id: 'ex-jules', name: 'Jules (example)', cuisines: ['cafe', 'steak'], novelty: 'new', noise: 'high',
        dealbreakers: [], maxWait: 30, diningWith: 'family', vibes: ['design', 'live_music'], favorites: [], visited: [] },
    ],
    restaurants: [
      // Historic District
      place('Sutter Street Steakhouse', ['steak', 'seafood'], 'Sutter St', 'sutter', 'restaurant', {
        vibes: ['cozy', 'patio'], goodFor: ['partner', 'coworkers', 'family', 'friends'],
        blurb: 'Romantic steakhouse with an extensive wine list and patio seating.',
      }),
      place('Hop Sing Palace', ['chinese'], 'Sutter St', 'sutter', 'restaurant', {
        vibes: ['cozy', 'local'], blurb: 'Neighborhood staple since 1957 in a historic Sutter Street building.',
      }),
      place('Chicago Fire', ['italian', 'american'], 'Sutter St', 'sutter', 'restaurant', {
        noise: 1.3, goodFor: ['family', 'friends', 'coworkers'], blurb: 'Deep-dish pizza, good for family night and groups.',
      }),
      place("Scott's Seafood Roundhouse", ['seafood', 'american'], 'Historic District', 'sutter', 'restaurant'),
      place("Riley's on Sutter", ['american'], 'Sutter St', 'sutter', 'restaurant'),
      place('Hacienda Del Rio', ['mexican'], 'Sutter St', 'sutter', 'restaurant'),
      place('The Fat Rabbit Public House', ['pub', 'american'], 'Sutter St', 'sutter', 'pub', {
        blurb: 'Comfortable pub, often named the best in Folsom.',
      }),
      place("Samuel Horne's Tavern", ['pub', 'american'], 'Sutter St', 'sutter', 'pub', {
        vibes: ['local'], blurb: 'Tavern focused on local beers.',
      }),
      place("Catherine's Crêperie", ['cafe', 'brunch'], '200 Wool St', 'sutter', 'cafe', {
        blurb: 'Locally owned café with sweet and savory French crêpes.',
      }),
      place('Nara Sushi', ['japanese'], '1125 Riley St', 'riley', 'restaurant'),

      // By the lake and river
      place('Crawdads on the Lake', ['american', 'seafood'], '9900 Greenback Ln', 'greenbackBridge', 'restaurant', {
        noise: 1.2, price: 2, vibes: ['views', 'patio'], hours: 'Mo-Th,Su 11:00-20:00; Fr,Sa 11:00-21:00',
        blurb: 'Above the American River near Old Town, with sunset views over the water.',
      }),
      place('Taj Grill Indian Cuisine', ['indian'], '9500 Greenback Ln, Ste 33', 'greenbackWest', 'restaurant'),

      // Blue Ravine
      place('Mexquite Mexican Cuisine', ['mexican'], '25095 Blue Ravine Rd', 'blueRavineEast', 'restaurant'),
      place('Back Wine Bar', ['american'], '25075 Blue Ravine Rd, #150', 'blueRavineEast', 'restaurant', {
        noise: 0.8, goodFor: ['partner', 'friends', 'coworkers'],
      }),
      place('Curry Club Indian Bistro', ['indian'], '196 Blue Ravine Rd', 'blueRavineWest', 'restaurant'),

      // Palladio
      place('Back Bistro', ['american'], 'Palladio', 'palladio', 'restaurant', {
        noise: 0.8, goodFor: ['partner', 'friends', 'coworkers'],
        blurb: 'Seasonal menu with 30 wines by the glass, craft cocktails and microbrews.',
      }),
      place('Lazy Dog Restaurant & Bar', ['american'], '300 Palladio Pkwy', 'palladio', 'restaurant', {
        noise: 1.4, goodFor: ['family', 'friends', 'coworkers'],
      }),
      place('Chops Restaurant', ['american', 'steak'], '250 Palladio Pkwy, Ste 1339', 'palladio', 'restaurant'),
      place('Petra Greek', ['mediterranean'], '230 Palladio Pkwy, #1213', 'palladio', 'casual'),
      place('Mas Taco Bar', ['mexican'], '450 Palladio Pkwy', 'palladio', 'casual'),
      place('Pier 50 Sushi', ['japanese'], '330 Palladio Pkwy, #2045', 'palladio', 'restaurant'),
      place('Iron Horse Tavern', ['pub', 'american'], '460 Palladio Pkwy', 'palladio', 'pub'),
      place('Johnny Rockets', ['american'], '280 Palladio Pkwy', 'palladio', 'casual'),
      place("BJ's Restaurant & Brewhouse", ['pub', 'american'], '2730 E Bidwell St', 'eastBidwell', 'pub', {
        goodFor: ['friends', 'coworkers', 'family'],
      }),

      // Iron Point / Prairie City
      place("Fat's Asia Bistro", ['chinese', 'asian'], '2585 Iron Point Rd', 'ironPoint', 'restaurant'),
      place('Folsom Thai Cuisine', ['thai'], '2371 Iron Point Rd', 'ironPoint', 'restaurant'),
      place('Olive Garden Italian Restaurant', ['italian'], '2485 Iron Point Rd', 'ironPoint', 'restaurant', {
        goodFor: ['family', 'friends', 'coworkers'],
      }),
      place('Islands', ['american'], '2455 Iron Point Rd', 'ironPoint', 'casual'),
      place('Taqueria Los Cerros', ['mexican'], '2405 Iron Point Rd, Ste 120', 'ironPoint', 'casual'),
      place('IHOP', ['brunch', 'american'], '2525 Iron Point Rd', 'ironPoint', 'casual', {
        goodFor: ['solo', 'family', 'friends'],
      }),
      place('Mylapore', ['indian', 'vegetarian'], '1760 Prairie City Rd, Ste 160', 'prairieCity', 'casual', {
        blurb: 'South Indian vegetarian.',
      }),
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = DEMO;
  else root.FOODIE_DEMO = DEMO;
})(typeof self !== 'undefined' ? self : this);
