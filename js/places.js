/*
 * Where restaurants come from.
 *
 *   fetchNearby(lat, lon, radiusM) → live places from OpenStreetMap (free, no API key)
 *   geocode("Folsom, CA")          → {lat, lon, label} via OpenStreetMap Nominatim
 *   fromOsm(element, lat, lon)     → convert an OSM element to our restaurant shape
 *
 * OSM tells us cuisine, venue type, hours, outdoor seating and live music, but
 * not cleanliness, service, wait or parking. We infer only what the venue type
 * really implies (a pub is louder than a café) and leave the rest null.
 * Matching never applies a dealbreaker to a null value. It flags it as
 * "unverified" instead. To get those signals, swap in a source that has
 * reviews (Google Places, Yelp Fusion, Foursquare) and fill the same fields.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoodiePlaces = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

  // OSM cuisine tag → our quiz cuisine values.
  const CUISINE_MAP = {
    american: 'american', burger: 'american', diner: 'american', sandwich: 'american',
    chicken: 'american', hot_dog: 'american', wings: 'american', regional: 'american',
    pizza: 'italian', italian: 'italian', pasta: 'italian',
    mexican: 'mexican', 'tex-mex': 'mexican', tex_mex: 'mexican', taco: 'mexican', tacos: 'mexican', burrito: 'mexican',
    chinese: 'chinese', dim_sum: 'chinese', cantonese: 'chinese', szechuan: 'chinese',
    japanese: 'japanese', sushi: 'japanese', ramen: 'japanese',
    thai: 'thai',
    vietnamese: 'asian', korean: 'asian', asian: 'asian', filipino: 'asian', pho: 'asian', noodle: 'asian', poke: 'asian',
    indian: 'indian', nepalese: 'indian', pakistani: 'indian',
    mediterranean: 'mediterranean', greek: 'mediterranean', lebanese: 'mediterranean', turkish: 'mediterranean',
    middle_eastern: 'mediterranean', kebab: 'mediterranean', falafel: 'mediterranean', persian: 'mediterranean',
    french: 'cafe', crepe: 'cafe', crepes: 'cafe', coffee_shop: 'cafe', bakery: 'cafe', cafe: 'cafe', tea: 'cafe',
    breakfast: 'brunch', brunch: 'brunch', pancake: 'brunch', bagel: 'brunch', donut: 'brunch',
    seafood: 'seafood', fish: 'seafood', fish_and_chips: 'seafood', cajun: 'seafood', oyster: 'seafood',
    steak_house: 'steak', steakhouse: 'steak', bbq: 'steak', barbecue: 'steak',
    vegetarian: 'vegetarian', vegan: 'vegetarian', salad: 'vegetarian', juice: 'vegetarian',
  };

  // What the venue type honestly tells us.
  const VENUE_DEFAULTS = {
    restaurant: { noise: 1.0, goodFor: ['partner', 'friends', 'family', 'coworkers'], quick: false },
    cafe: { noise: 0.6, price: 1, goodFor: ['solo', 'partner', 'friends'], quick: true, cuisine: ['cafe'] },
    fast_food: { noise: 1.1, price: 1, goodFor: ['solo', 'coworkers', 'family'], quick: true, waitMinutes: 5 },
    food_court: { noise: 1.4, price: 1, goodFor: ['solo', 'family', 'coworkers'], quick: true },
    pub: { noise: 1.7, goodFor: ['friends', 'coworkers'], quick: false, cuisine: ['pub'] },
    bar: { noise: 1.8, goodFor: ['friends', 'coworkers'], quick: false, cuisine: ['pub'] },
    biergarten: { noise: 1.7, goodFor: ['friends', 'coworkers', 'family'], quick: false, cuisine: ['pub'], vibes: ['patio'] },
    brewery: { noise: 1.7, goodFor: ['friends', 'coworkers'], quick: false, cuisine: ['pub'] },
  };

  function haversineKm(lat1, lon1, lat2, lon2) {
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }

  function parseCuisines(tag) {
    if (!tag) return [];
    const out = new Set();
    for (const raw of tag.split(/[;,]/)) {
      const key = raw.trim().toLowerCase().replace(/\s+/g, '_');
      if (CUISINE_MAP[key]) out.add(CUISINE_MAP[key]);
    }
    return [...out];
  }

  function priceFromTags(t) {
    // Rare in OSM, but use it when someone has mapped it.
    const level = t['price:range'] || t.price_level || t['price'];
    if (level && /^\${1,4}$/.test(level)) return level.length;
    return null;
  }

  function parkingFromTags(t) {
    if (t.parking === 'no' || t['parking:customers'] === 'no') return false;
    if (t.parking || t['parking:customers'] === 'yes') return true;
    return null;
  }

  /** Convert an Overpass element to our restaurant shape (null if unusable). */
  function fromOsm(el, originLat, originLon) {
    const t = el.tags || {};
    if (!t.name) return null;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) return null;

    const venue = t.craft === 'brewery' || t.microbrewery === 'yes' ? 'brewery' : t.amenity;
    const d = VENUE_DEFAULTS[venue] || VENUE_DEFAULTS.restaurant;

    const cuisine = new Set([...parseCuisines(t.cuisine), ...(d.cuisine || [])]);
    const vibes = new Set(d.vibes || []);
    if (t.outdoor_seating === 'yes') vibes.add('patio');
    if (t.live_music === 'yes') vibes.add('live_music');

    let noise = d.noise;
    if (t.live_music === 'yes') noise = Math.min(2, noise + 0.3);

    return {
      id: `osm-${el.type}-${el.id}`,
      venue: { cafe: 'cafe', fast_food: 'casual', food_court: 'casual', pub: 'pub', bar: 'pub', biergarten: 'pub', brewery: 'pub' }[venue] || 'restaurant',
      name: t.name,
      cuisine: [...cuisine],
      noise,
      price: priceFromTags(t) ?? d.price ?? null,
      parking: parkingFromTags(t),
      cleanliness: null,
      service: null,
      waitMinutes: d.waitMinutes ?? null,
      popularity: null,
      vibes: [...vibes],
      goodFor: d.goodFor,
      quick: d.quick,
      hours: t.opening_hours || null,
      lat,
      lon,
      address: [t['addr:housenumber'], t['addr:street'], t['addr:city']].filter(Boolean).join(' ') || null,
      website: t.website || t['contact:website'] || null,
      distanceKm: originLat != null ? Math.round(haversineKm(originLat, originLon, lat, lon) * 10) / 10 : null,
      source: 'OpenStreetMap',
      estimated: true,
    };
  }

  async function request(url, init) {
    try {
      return await fetch(url, init);
    } catch {
      throw new Error('Couldn’t reach the map service. Check your connection, or try the demo.');
    }
  }

  async function fetchNearby(lat, lon, radiusM = 4000) {
    const around = `(around:${radiusM},${lat},${lon})`;
    const query = `[out:json][timeout:25];(
      nwr["amenity"~"^(restaurant|cafe|fast_food|pub|bar|biergarten|food_court)$"]["name"]${around};
      nwr["craft"="brewery"]["name"]${around};
    );out center tags 200;`;
    const res = await request(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`Map service error (${res.status}). Try again in a minute.`);
    const json = await res.json();
    const seen = new Set();
    return json.elements
      .map((el) => fromOsm(el, lat, lon))
      .filter((r) => r && !seen.has(r.name + r.address) && seen.add(r.name + r.address));
  }

  async function geocode(text) {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(text)}`;
    const res = await request(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Couldn't look up that place (${res.status}).`);
    const [hit] = await res.json();
    if (!hit) throw new Error(`Couldn't find “${text}”. Try a city and state.`);
    return { lat: +hit.lat, lon: +hit.lon, label: hit.display_name.split(',').slice(0, 2).join(',') };
  }

  return { fetchNearby, geocode, fromOsm, parseCuisines, haversineKm };
});
