/*
 * Greater Sacramento restaurants, compiled from public web listings
 * (Tripadvisor, Yelp, OpenTable, Yellow Pages, Visit Folsom, restaurant sites)
 * in October 2026, plus a ZIP code lookup for the region.
 *
 * Used where the app can't reach the live map service (e.g. a sandboxed
 * preview), and as a fallback when the live lookup fails inside the region.
 *
 * Only facts the listings state are filled in: name, cuisine, street address,
 * and a few listed features (patio, lake view, historic building). Coordinates
 * are approximate, placed by street or shopping center, and ZIP codes resolve
 * to the middle of their town or neighborhood, so distances are rough.
 * Noise is estimated from venue type. Cleanliness, service, wait, popularity,
 * parking and price stay unknown (null) and never trigger a dealbreaker.
 * Hours are included only where a listing gave them.
 */
(function (root) {
  // Approximate centers for each street, center or neighborhood.
  const AREA = {
    // Folsom
    sutter: [38.6776, -121.1762, 'Folsom'],
    riley: [38.6748, -121.1725, 'Folsom'],
    greenbackBridge: [38.6893, -121.1818, 'Folsom'],
    greenbackWest: [38.6826, -121.2045, 'Folsom'],
    blueRavineEast: [38.6829, -121.1555, 'Folsom'],
    blueRavineWest: [38.6838, -121.1702, 'Folsom'],
    palladio: [38.6497, -121.1215, 'Folsom'],
    eastBidwell: [38.6552, -121.1183, 'Folsom'],
    ironPoint: [38.6445, -121.1447, 'Folsom'],
    prairieCity: [38.6551, -121.1566, 'Folsom'],
    // Sacramento
    downtown: [38.5806, -121.4944, 'Sacramento'],
    midtownJ: [38.5752, -121.4790, 'Sacramento'],
    midtownEast: [38.5733, -121.4672, 'Sacramento'],
    rStreet: [38.5712, -121.5002, 'Sacramento'],
    southside: [38.5688, -121.5048, 'Sacramento'],
    // Placer County
    rosevilleGalleria: [38.7722, -121.2682, 'Roseville'],
    rosevilleCirby: [38.7300, -121.2780, 'Roseville'],
    rosevilleDowntown: [38.7522, -121.2853, 'Roseville'],
    rosevilleWest: [38.7860, -121.3010, 'Roseville'],
    rosevilleEast: [38.7790, -121.2350, 'Roseville'],
    rocklinLonetree: [38.8085, -121.2870, 'Rocklin'],
    rocklinPacific: [38.7915, -121.2365, 'Rocklin'],
    rocklinGranite: [38.7812, -121.2620, 'Rocklin'],
    // South
    elkGroveOld: [38.4090, -121.3712, 'Elk Grove'],
    elkGroveWest: [38.4090, -121.4250, 'Elk Grove'],
    elkGroveLaguna: [38.4245, -121.4430, 'Elk Grove'],
    elkGroveEast: [38.4300, -121.3300, 'Elk Grove'],
    // East and west
    edhTownCenter: [38.6490, -121.0712, 'El Dorado Hills'],
    davisDowntown: [38.5442, -121.7405, 'Davis'],
    ranchoCordova: [38.5890, -121.3030, 'Rancho Cordova'],
    citrusHeights: [38.6900, -121.2700, 'Citrus Heights'],
    fairOaks: [38.6445, -121.2720, 'Fair Oaks'],
  };

  const VENUE = {
    restaurant: { noise: 1.0, goodFor: ['partner', 'friends', 'family', 'coworkers'], quick: false },
    casual: { noise: 1.2, goodFor: ['solo', 'friends', 'family', 'coworkers'], quick: true },
    cafe: { noise: 0.6, goodFor: ['solo', 'partner', 'friends'], quick: true },
    pub: { noise: 1.7, goodFor: ['friends', 'coworkers'], quick: false },
  };

  let n = 0;
  function place(name, cuisine, address, area, venue, extra = {}) {
    const [lat, lon, town] = AREA[area];
    const v = VENUE[venue];
    // Small offset so places in the same center don't stack exactly.
    const jitter = ((n++ % 5) - 2) * 0.0006;
    return {
      id: `${town}-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      name,
      cuisine,
      address: address ? `${address}, ${town}, CA` : `${town}, CA`,
      town,
      venue,
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

  // ZIP → approximate middle of its town or neighborhood.
  const ZIPS = {
    95630: [38.672, -121.150, 'Folsom'],
    95762: [38.680, -121.060, 'El Dorado Hills'],
    95661: [38.745, -121.250, 'Roseville'],
    95678: [38.762, -121.300, 'Roseville'],
    95747: [38.775, -121.360, 'Roseville'],
    95765: [38.820, -121.270, 'Rocklin'],
    95677: [38.790, -121.240, 'Rocklin'],
    95746: [38.750, -121.180, 'Granite Bay'],
    95650: [38.820, -121.190, 'Loomis'],
    95648: [38.890, -121.300, 'Lincoln'],
    95662: [38.680, -121.220, 'Orangevale'],
    95610: [38.700, -121.270, 'Citrus Heights'],
    95621: [38.695, -121.310, 'Citrus Heights'],
    95628: [38.650, -121.250, 'Fair Oaks'],
    95608: [38.625, -121.330, 'Carmichael'],
    95670: [38.600, -121.280, 'Rancho Cordova'],
    95742: [38.570, -121.220, 'Rancho Cordova'],
    95655: [38.555, -121.280, 'Mather'],
    95660: [38.670, -121.380, 'North Highlands'],
    95843: [38.715, -121.365, 'Antelope'],
    95673: [38.690, -121.445, 'Rio Linda'],
    95624: [38.420, -121.350, 'Elk Grove'],
    95757: [38.390, -121.430, 'Elk Grove'],
    95758: [38.420, -121.440, 'Elk Grove'],
    95632: [38.255, -121.300, 'Galt'],
    95616: [38.550, -121.750, 'Davis'],
    95618: [38.540, -121.700, 'Davis'],
    95691: [38.570, -121.560, 'West Sacramento'],
    95605: [38.590, -121.540, 'West Sacramento'],
    95811: [38.578, -121.488, 'Downtown Sacramento'],
    95814: [38.581, -121.494, 'Downtown Sacramento'],
    95815: [38.610, -121.445, 'North Sacramento'],
    95816: [38.574, -121.466, 'Midtown Sacramento'],
    95817: [38.550, -121.457, 'Oak Park'],
    95818: [38.557, -121.494, 'Land Park'],
    95819: [38.568, -121.437, 'East Sacramento'],
    95820: [38.535, -121.445, 'Tahoe Park'],
    95821: [38.625, -121.385, 'Arden'],
    95822: [38.510, -121.495, 'Greenhaven'],
    95823: [38.475, -121.440, 'South Sacramento'],
    95824: [38.518, -121.440, 'South Sacramento'],
    95825: [38.590, -121.405, 'Arden-Arcade'],
    95826: [38.545, -121.380, 'College Greens'],
    95827: [38.555, -121.325, 'Rosemont'],
    95828: [38.485, -121.400, 'Florin'],
    95829: [38.470, -121.345, 'Vineyard'],
    95831: [38.495, -121.530, 'Pocket'],
    95832: [38.465, -121.495, 'Meadowview'],
    95833: [38.618, -121.505, 'South Natomas'],
    95834: [38.640, -121.510, 'Natomas'],
    95835: [38.670, -121.525, 'North Natomas'],
    95838: [38.645, -121.445, 'Del Paso Heights'],
    95841: [38.660, -121.350, 'Foothill Farms'],
    95842: [38.685, -121.350, 'Foothill Farms'],
    95864: [38.585, -121.375, 'Arden Park'],
  };

  const REGION = {
    name: 'Greater Sacramento',
    center: { lat: 38.6, lon: -121.35, label: 'Greater Sacramento' },
    radiusKm: 80, // origins farther than this from the center are outside the saved list
    zips: ZIPS,
    // Example test users listed under "Nearby with the app open" in previews.
    testUsers: [
      { peer: 'test-priya', town: 'Folsom', profile: { name: 'priya_eats', cuisines: ['cafe', 'mediterranean'], novelty: 'new',
        noise: 'buzz', dealbreakers: [], maxWait: 30, diningWith: 'friends', vibes: ['design', 'local'] },
        card: { name: 'priya_eats', visibility: 'public', tastes: { cuisines: ['cafe', 'mediterranean'], noise: 'buzz', vibes: ['design', 'local'], diningWith: 'friends' },
        genres: ['cafe', 'mediterranean'], favorites: [{ name: "Catherine's Crêperie", town: 'Folsom', cuisine: ['cafe', 'brunch'], stars: 5 }, { name: 'Petra Greek', town: 'Folsom', cuisine: ['mediterranean'], stars: 4 }] } },
      { peer: 'test-marcus', town: 'Roseville', profile: { name: 'marcus_r', cuisines: ['any'], novelty: 'favorites',
        noise: 'buzz', dealbreakers: ['no_parking'], maxWait: 15, diningWith: 'friends', vibes: ['views', 'patio'] } },
      { peer: 'test-jules', town: 'Midtown Sacramento', profile: { name: 'jules.tacos', cuisines: ['mexican', 'steak'], novelty: 'new',
        noise: 'high', dealbreakers: [], maxWait: 30, diningWith: 'friends', vibes: ['live_music'] },
        card: { name: 'jules.tacos', visibility: 'public', tastes: { cuisines: ['mexican', 'steak'], noise: 'high', vibes: ['live_music'], diningWith: 'friends' },
        genres: ['mexican'], favorites: [{ name: 'Tank House BBQ', town: 'Sacramento', cuisine: ['steak', 'american'] }] } },
      { peer: 'test-sam', town: 'Elk Grove', profile: { name: 'sam_noodles', cuisines: ['japanese', 'thai'], novelty: 'favorites',
        noise: 'quiet', dealbreakers: ['loud', 'pricey'], maxWait: 15, diningWith: 'friends', vibes: ['cozy'] } },
    ],
    restaurants: [
      // ---- Folsom: Historic District
      place('Sutter Street Steakhouse', ['steak', 'seafood'], 'Sutter St', 'sutter', 'restaurant', {
        vibes: ['cozy', 'patio'], goodFor: ['partner', 'coworkers', 'family', 'friends'],
        blurb: 'Romantic, big wine list, patio.',
      }),
      place('Hop Sing Palace', ['chinese'], 'Sutter St', 'sutter', 'restaurant', {
        vibes: ['cozy', 'local'], blurb: 'Historic local staple since 1957.',
      }),
      place('Chicago Fire', ['italian', 'american'], 'Sutter St', 'sutter', 'restaurant', {
        noise: 1.3, goodFor: ['family', 'friends', 'coworkers'], blurb: 'Deep-dish pizza for groups.',
      }),
      place("Scott's Seafood Roundhouse", ['seafood', 'american'], 'Historic District', 'sutter', 'restaurant'),
      place("Riley's on Sutter", ['american'], 'Sutter St', 'sutter', 'restaurant'),
      place('Hacienda Del Rio', ['mexican'], 'Sutter St', 'sutter', 'restaurant'),
      place('The Fat Rabbit Public House', ['pub', 'american'], 'Sutter St', 'sutter', 'pub', {
        blurb: 'Comfortable local pub.',
      }),
      place("Samuel Horne's Tavern", ['pub', 'american'], 'Sutter St', 'sutter', 'pub', {
        vibes: ['local'], blurb: 'Local beers.',
      }),
      place("Catherine's Crêperie", ['cafe', 'brunch'], '200 Wool St', 'sutter', 'cafe', {
        blurb: 'Sweet and savory crêpes.',
      }),
      place('Nara Sushi', ['japanese'], '1125 Riley St', 'riley', 'restaurant'),
      // ---- Folsom: lake, Blue Ravine, Palladio, Iron Point
      place('Crawdads on the Lake', ['american', 'seafood'], '9900 Greenback Ln', 'greenbackBridge', 'restaurant', {
        noise: 1.2, price: 2, vibes: ['views', 'patio'], hours: 'Mo-Th,Su 11:00-20:00; Fr,Sa 11:00-21:00',
        blurb: 'Sunset views over the water.',
      }),
      place('Taj Grill Indian Cuisine', ['indian'], '9500 Greenback Ln, Ste 33', 'greenbackWest', 'restaurant'),
      place('Mexquite Mexican Cuisine', ['mexican'], '25095 Blue Ravine Rd', 'blueRavineEast', 'restaurant'),
      place('Back Wine Bar', ['american'], '25075 Blue Ravine Rd, #150', 'blueRavineEast', 'restaurant', {
        noise: 0.8, goodFor: ['partner', 'friends', 'coworkers'],
      }),
      place('Curry Club Indian Bistro', ['indian'], '196 Blue Ravine Rd', 'blueRavineWest', 'restaurant'),
      place('Back Bistro', ['american'], 'Palladio', 'palladio', 'restaurant', {
        noise: 0.8, goodFor: ['partner', 'friends', 'coworkers'],
        blurb: 'Seasonal menu, 30 wines by the glass.',
      }),
      place('Petra Greek', ['mediterranean'], '230 Palladio Pkwy, #1213', 'palladio', 'casual', {
        blurb: '',
      }),
      place('Lazy Dog Restaurant & Bar', ['american'], '300 Palladio Pkwy', 'palladio', 'restaurant', {
        noise: 1.4, goodFor: ['family', 'friends', 'coworkers'],
      }),
      place('Chops Restaurant', ['american', 'steak'], '250 Palladio Pkwy, Ste 1339', 'palladio', 'restaurant'),
      place('Mas Taco Bar', ['mexican'], '450 Palladio Pkwy', 'palladio', 'casual'),
      place('Pier 50 Sushi', ['japanese'], '330 Palladio Pkwy, #2045', 'palladio', 'restaurant'),
      place('Johnny Rockets', ['american'], '280 Palladio Pkwy', 'palladio', 'casual'),
      place("BJ's Restaurant & Brewhouse", ['pub', 'american'], '2730 E Bidwell St', 'eastBidwell', 'pub', {
        goodFor: ['friends', 'coworkers', 'family'],
      }),
      place("Fat's Asia Bistro", ['chinese', 'asian'], '2585 Iron Point Rd', 'ironPoint', 'restaurant'),
      place('Folsom Thai Cuisine', ['thai'], '2371 Iron Point Rd', 'ironPoint', 'restaurant'),
      place('Olive Garden Italian Restaurant', ['italian'], '2485 Iron Point Rd', 'ironPoint', 'restaurant', {
        goodFor: ['family', 'friends', 'coworkers'],
      }),
      place('Islands', ['american'], '2455 Iron Point Rd', 'ironPoint', 'casual'),
      place('Taqueria Los Cerros', ['mexican'], '2405 Iron Point Rd, Ste 120', 'ironPoint', 'casual'),
      place('IHOP', ['brunch', 'american'], '2525 Iron Point Rd', 'ironPoint', 'casual', { goodFor: ['solo', 'family', 'friends'] }),
      place('Mylapore', ['indian', 'vegetarian'], '1760 Prairie City Rd, Ste 160', 'prairieCity', 'casual', {
        blurb: 'South Indian vegetarian.',
      }),

      // ---- Sacramento: Downtown & Midtown
      place('Petra Greek', ['mediterranean'], '1122 16th St', 'downtown', 'casual', {
        blurb: '',
      }),
      place('Tank House BBQ', ['steak', 'american'], '1925 J St', 'midtownJ', 'pub'),
      place('Tres Hermanas', ['mexican'], '2416 K St', 'midtownEast', 'restaurant'),
      place("Paragary's", ['american', 'italian'], '1401 28th St', 'midtownEast', 'restaurant', { vibes: ['patio'] }),
      place('Centro Cocina Mexicana', ['mexican'], '2730 J St', 'midtownEast', 'restaurant'),
      place('Tapa the World', ['mediterranean'], '2115 J St', 'midtownJ', 'restaurant', { goodFor: ['partner', 'friends'] }),
      place('The Rind', ['american'], '1801 L St, #40', 'midtownJ', 'restaurant', { goodFor: ['partner', 'friends'] }),
      place('Iron Horse Tavern', ['pub', 'american'], '1800 15th St', 'midtownJ', 'pub'),
      place('Fox & Goose Public House', ['pub', 'brunch'], '1001 R St', 'rStreet', 'pub'),
      place('TableVine', ['american'], '1501 14th St', 'downtown', 'restaurant'),
      place("Vallejo's Restaurant", ['mexican'], '1900 4th St', 'southside', 'restaurant'),
      place('Ella Dining Room & Bar', ['american'], '1131 K St', 'downtown', 'restaurant', {
        noise: 0.8, vibes: ['design'], goodFor: ['partner', 'coworkers', 'friends'],
      }),
      place('Grange', ['american'], '926 J St', 'downtown', 'restaurant', { goodFor: ['partner', 'coworkers', 'friends'] }),
      place('Octopus Peru', ['seafood'], '980 9th St, Ste 170', 'downtown', 'restaurant', { blurb: 'Peruvian seafood.' }),
      place('Citizen Capitol Craft House', ['american'], '1201 J St, #111', 'downtown', 'restaurant'),

      // ---- Roseville & Rocklin
      place('Nixtaco', ['mexican'], '1805 Cirby Way, #12', 'rosevilleCirby', 'casual'),
      place('Q1227 Restaurant', ['american'], '1465 Eureka Rd, Ste 100', 'rosevilleGalleria', 'restaurant'),
      place('La Huaca', ['seafood'], '9213 Sierra College Blvd, Ste 140', 'rosevilleEast', 'restaurant', { blurb: 'Peruvian.' }),
      place("Paul Martin's American Grill", ['american'], '1455 Eureka Rd, Ste 100', 'rosevilleGalleria', 'restaurant'),
      place('Range Kitchen & Tap', ['american', 'pub'], '1420 E Roseville Pkwy', 'rosevilleEast', 'restaurant'),
      place('La Popular', ['mexican'], '234 Gibson Dr, Ste 120', 'rosevilleWest', 'casual'),
      place('The Place', ['italian'], '221 Vernon St', 'rosevilleDowntown', 'restaurant'),
      place('Four Sisters Cafe', ['brunch'], '9050 Fairway Dr, #165', 'rosevilleWest', 'cafe'),
      place("Fat's Asia Bistro", ['chinese', 'asian'], '1500 Eureka Rd', 'rosevilleGalleria', 'restaurant'),
      place('Zocalo', ['mexican'], '1182 Roseville Pkwy', 'rosevilleWest', 'restaurant'),
      place('Anatolian Table', ['mediterranean'], '6504 Lonetree Blvd', 'rocklinLonetree', 'restaurant', { blurb: 'Turkish.' }),
      place('Mezcalito Oaxacan Cuisine', ['mexican'], '5065 Pacific St', 'rocklinPacific', 'restaurant'),
      place("Rubino's Ristorante", ['italian'], '5015 Pacific St', 'rocklinPacific', 'restaurant'),
      place("The Chef's Table", ['american'], '6843 Lonetree Blvd, #103', 'rocklinLonetree', 'restaurant', {
        blurb: 'Modern comfort food.',
      }),
      place('Biryani & Chaat', ['indian'], '4800 Granite Dr, B-11', 'rocklinGranite', 'casual'),
      place('Jing Jing Chinese Cuisine', ['chinese'], '4800 Granite Dr, B2', 'rocklinGranite', 'casual'),
      place('Phở Saigon', ['asian'], '6827 Lonetree Blvd', 'rocklinLonetree', 'casual'),
      place("Lucille's Smokehouse Bar-B-Que", ['steak', 'american'], '6628 Lonetree Blvd', 'rocklinLonetree', 'restaurant', {
        goodFor: ['family', 'friends', 'coworkers'],
      }),

      // ---- Elk Grove
      place('Boulevard Bistro', ['american'], '8941 Elk Grove Blvd', 'elkGroveOld', 'restaurant', {
        goodFor: ['partner', 'friends', 'family'], blurb: 'California cooking in Old Town.',
      }),
      place('Mikuni Japanese Restaurant & Sushi Bar', ['japanese'], '8525 Bond Rd', 'elkGroveOld', 'restaurant'),
      place('Sheldon Inn', ['american', 'cafe'], '9000 Grant Line Rd', 'elkGroveEast', 'restaurant', {
        blurb: 'French, American, Portuguese.',
      }),
      place('Todo Un Poco', ['mexican', 'italian'], '9080 Laguna Main St, Ste 1A', 'elkGroveLaguna', 'restaurant'),
      place('Brick House Restaurant', ['italian', 'american'], '9027 Elk Grove Blvd, Ste 100', 'elkGroveOld', 'restaurant'),
      place('Palermo', ['italian'], '9632 Emerald Oak Dr, Ste L', 'elkGroveOld', 'restaurant', { blurb: 'Southern Italian.' }),
      place('Fujiya', ['japanese'], '9328 Elk Grove Blvd, Ste 100', 'elkGroveOld', 'restaurant'),
      place('Kobe Steak & Sushi', ['japanese', 'steak'], '9134 E Stockton Blvd', 'elkGroveWest', 'restaurant', {
        noise: 1.3, goodFor: ['family', 'friends', 'coworkers'], blurb: 'Hibachi and sushi.',
      }),
      place('Happy Garden', ['chinese'], '9081 Elk Grove Blvd', 'elkGroveOld', 'casual'),

      // ---- El Dorado Hills Town Center
      place('Milestone Restaurant & Cocktail Bar', ['american'], '4359 Town Center Blvd', 'edhTownCenter', 'restaurant'),
      place('South Fork Grille', ['american'], '4364 Town Center Blvd, Ste 124', 'edhTownCenter', 'restaurant', {
        vibes: ['views'], blurb: 'Waterfront views.',
      }),
      place("OBO' Italian Table & Bar", ['italian'], '4370 Town Center Blvd, Ste 120', 'edhTownCenter', 'restaurant'),
      place('Native + Nomad', ['american'], '4355 Town Center Blvd, #114', 'edhTownCenter', 'restaurant'),
      place('Thai Paradise', ['thai'], '4361 Town Center Blvd, #110', 'edhTownCenter', 'restaurant'),
      place("C. Knight's Steakhouse", ['steak'], '2085 Vine St', 'edhTownCenter', 'restaurant', {
        noise: 0.9, goodFor: ['partner', 'coworkers', 'family'],
      }),
      place('The Mimosa House', ['brunch', 'cafe'], 'Town Center', 'edhTownCenter', 'cafe', { vibes: ['patio'] }),

      // ---- Davis
      place('Cafe Bernardo', ['brunch', 'cafe'], '234 D St', 'davisDowntown', 'cafe'),
      place('Dumpling House', ['chinese'], '129 E St', 'davisDowntown', 'casual'),
      place('Yakitori Yuchan', ['japanese'], '109 E St', 'davisDowntown', 'restaurant', { blurb: 'Yakitori izakaya.' }),
      place("Sam's Mediterranean Cuisine", ['mediterranean'], '301 B St', 'davisDowntown', 'casual'),
      place('Bistro Thirty Three', ['cafe', 'american'], '226 F St', 'davisDowntown', 'restaurant', {
        vibes: ['patio'], blurb: 'French bistro, big patio.',
      }),
      place('Manna Korean Restaurant', ['asian'], '622 3rd St', 'davisDowntown', 'casual', { blurb: 'Stone pot bibimbap.' }),

      // ---- Rancho Cordova, Citrus Heights, Fair Oaks
      place('Formaggio Taverna & Patio', ['italian'], null, 'ranchoCordova', 'restaurant', {
        vibes: ['patio', 'cozy'], hours: 'Tu-Sa 17:00-21:00', blurb: 'Warm Italian taverna.',
      }),
      place('Black Angus Steakhouse', ['steak'], null, 'citrusHeights', 'restaurant', { goodFor: ['family', 'friends', 'coworkers', 'partner'] }),
      place('Shangri-la', ['asian'], null, 'fairOaks', 'restaurant', { vibes: ['patio'], blurb: 'Patio and cocktails.' }),
      place("Fabian's Italian Bistro", ['italian'], null, 'fairOaks', 'restaurant', { blurb: 'Half-price wine Wednesdays.' }),
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = REGION;
  else root.FOODIE_REGION = REGION;
})(typeof self !== 'undefined' ? self : this);
