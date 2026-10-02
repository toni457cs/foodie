const test = require('node:test');
const assert = require('node:assert/strict');
const Match = require('../js/matching.js');
const Hours = require('../js/hours.js');
const Places = require('../js/places.js');
const DEMO = require('../js/region-data.js');

// A Friday at 7pm: dinner time in the field test.
const FRIDAY_7PM = new Date(2026, 9, 2, 19, 0);

const profile = (overrides) => ({
  id: overrides.name,
  cuisines: ['any'],
  novelty: 'new',
  noise: 'buzz',
  dealbreakers: [],
  maxWait: 30,
  diningWith: 'friends',
  vibes: [],
  favorites: [],
  visited: [],
  ...overrides,
});

const place = (overrides) => ({
  id: overrides.name,
  cuisine: ['american'],
  noise: 1,
  price: 2,
  parking: true,
  cleanliness: 0.8,
  service: 0.8,
  waitMinutes: 10,
  popularity: 0.6,
  vibes: [],
  goodFor: ['friends', 'family', 'partner', 'coworkers'],
  quick: false,
  hours: 'Mo-Su 11:00-22:00',
  distanceKm: 1,
  ...overrides,
});

test('one person’s dealbreaker vetoes a place for the whole group', () => {
  const ana = profile({ name: 'Ana', dealbreakers: ['loud'] });
  const ben = profile({ name: 'Ben', noise: 'high' });
  const { results, excluded } = Match.recommend(
    [place({ name: 'Rowdy Pub', noise: 1.9 }), place({ name: 'Calm Bistro', noise: 0.8 })],
    [ana, ben],
    { now: FRIDAY_7PM },
  );
  assert.deepEqual(results.map((r) => r.restaurant.name), ['Calm Bistro']);
  assert.equal(excluded[0].restaurant.name, 'Rowdy Pub');
  assert.match(excluded[0].reasons[0], /^Ana: livelier than you like/);
});

test('unknown data never triggers a dealbreaker, but is flagged unverified', () => {
  const ana = profile({ name: 'Ana', dealbreakers: ['no_parking', 'messy'] });
  const { results } = Match.recommend([place({ name: 'Mystery', parking: null, cleanliness: null })], [ana], {
    now: FRIDAY_7PM,
  });
  assert.equal(results.length, 1);
  assert.deepEqual(results[0].unverified.sort(), ['cleanliness', 'parking']);
});

test('closed places are excluded (the field-test AI recommended a closed restaurant)', () => {
  const { results, excluded } = Match.recommend(
    [place({ name: 'Breakfast Only', hours: 'Mo-Su 06:00-14:00' })],
    [profile({ name: 'Ana' })],
    { now: FRIDAY_7PM },
  );
  assert.equal(results.length, 0);
  assert.deepEqual(excluded[0].reasons, ['closed at the moment']);
});

test('wait over the limit is excluded', () => {
  const { excluded } = Match.recommend([place({ name: 'Slow', waitMinutes: 45 })], [profile({ name: 'Ana', maxWait: 15 })], {
    now: FRIDAY_7PM,
  });
  assert.match(excluded[0].reasons[0], /45 min wait/);
});

test('environment and craving drive the ranking', () => {
  const cara = profile({ name: 'Cara', cuisines: ['seafood'], noise: 'quiet', vibes: ['views', 'design'] });
  const { results } = Match.recommend(
    [
      place({ name: 'Plain Seafood', cuisine: ['seafood'], noise: 1.5 }),
      place({ name: 'Lakeside Seafood', cuisine: ['seafood'], noise: 0.3, vibes: ['views', 'design'] }),
      place({ name: 'Lakeside Burgers', cuisine: ['american'], noise: 0.3, vibes: ['views', 'design'] }),
    ],
    [cara],
    { now: FRIDAY_7PM },
  );
  assert.equal(results[0].restaurant.name, 'Lakeside Seafood');
});

test('popularity has a sweet spot: popular + messy reads as chaos', () => {
  const p = profile({ name: 'Dee' });
  const buzzing = Match.scoreMember(place({ name: 'Buzzing', popularity: 0.7, cleanliness: 0.9 }), p);
  const chaos = Match.scoreMember(place({ name: 'Chaos', popularity: 0.95, cleanliness: 0.45 }), p);
  const dead = Match.scoreMember(place({ name: 'Empty', popularity: 0.05, cleanliness: 0.9 }), p);
  assert.ok(buzzing.parts.buzz > chaos.parts.buzz);
  assert.ok(buzzing.parts.buzz > dead.parts.buzz);
  assert.ok(chaos.concerns.includes('busy and chaotic'));
});

test('solo diners get quick & clean; a group overrides a solo answer', () => {
  const solo = profile({ name: 'Eli', diningWith: 'solo' });
  const quick = place({ name: 'Quick', quick: true, cleanliness: 0.95 });
  const sitDown = place({ name: 'Sit-down', quick: false, cleanliness: 0.95 });
  assert.ok(Match.scoreMember(quick, solo).parts.occasion > Match.scoreMember(sitDown, solo).parts.occasion);

  const ctx = Match.groupContext([solo, profile({ name: 'Fay', diningWith: 'family' })]);
  assert.equal(ctx.occasion, 'family');
});

test('least-misery blend prefers a place everyone is OK with over one that splits the group', () => {
  const ana = profile({ name: 'Ana', cuisines: ['mexican'], noise: 'quiet' });
  const ben = profile({ name: 'Ben', cuisines: ['mexican', 'steak'], noise: 'high' });
  const { results } = Match.recommend(
    [
      place({ name: 'Steak Party', cuisine: ['steak'], noise: 2 }),
      place({ name: 'Taqueria', cuisine: ['mexican'], noise: 1 }),
    ],
    [ana, ben],
    { now: FRIDAY_7PM },
  );
  assert.equal(results[0].restaurant.name, 'Taqueria');
  assert.equal(results[0].highlights[0].text, 'Mexican craving');
  assert.deepEqual(results[0].highlights[0].who, ['Ana', 'Ben']);
});

test('"stick to favorites" boosts favorites; "try something new" demotes visited', () => {
  const fav = place({ name: 'Usual Spot', id: 'usual' });
  const fresh = place({ name: 'New Spot', id: 'new' });
  const loyal = profile({ name: 'Gus', novelty: 'favorites', favorites: ['usual'] });
  const explorer = profile({ name: 'Hal', novelty: 'new', visited: ['usual'] });
  assert.equal(Match.recommend([fresh, fav], [loyal], { now: FRIDAY_7PM }).results[0].restaurant.id, 'usual');
  assert.equal(Match.recommend([fav, fresh], [explorer], { now: FRIDAY_7PM }).results[0].restaurant.id, 'new');
});

test('compatibility: similar diners match, a loud-vs-quiet clash is flagged', () => {
  const a = profile({ name: 'Ana', cuisines: ['thai', 'mexican'], noise: 'quiet', vibes: ['views'] });
  const b = profile({ name: 'Ben', cuisines: ['thai'], noise: 'quiet', vibes: ['views'] });
  const c = profile({ name: 'Cal', cuisines: ['steak'], noise: 'high', novelty: 'favorites', dealbreakers: [] });
  const quietA = { ...a, dealbreakers: ['loud'] };

  const ab = Match.compatibility(a, b);
  const ac = Match.compatibility(quietA, c);
  assert.ok(ab.score > ac.score);
  assert.equal(ab.label, 'Easy match');
  assert.ok(ac.friction.some((f) => f.includes('calmer spot')));

  const harmony = Match.groupHarmony([a, b, c]);
  assert.equal(harmony.pairs.length, 3);
});

test('combineProfiles merges the table into one profile', () => {
  const combined = Match.combineProfiles([
    profile({ name: 'Ana', cuisines: ['thai'], maxWait: 15, dealbreakers: ['messy'] }),
    profile({ name: 'Ben', cuisines: ['thai', 'indian'], maxWait: 60, dealbreakers: ['no_parking'] }),
  ]);
  assert.equal(combined.cuisines[0].value, 'thai');
  assert.equal(combined.maxWait, 15);
  assert.deepEqual(combined.dealbreakers.map((d) => d.value).sort(), ['messy', 'no_parking']);
});

test('real Folsom list: a views + seafood craving surfaces Crawdads; unknowns are never invented', () => {
  const diner = profile({ name: 'Dad', cuisines: ['seafood'], vibes: ['views'], dealbreakers: ['no_parking'] });
  const { results } = Match.recommend(DEMO.restaurants, [diner], { now: FRIDAY_7PM });
  assert.equal(results[0].restaurant.name, 'Crawdads on the Lake');
  assert.ok(results[0].unverified.includes('parking'));
  for (const r of DEMO.restaurants) {
    assert.equal(r.cleanliness, null, r.name);
    assert.equal(r.popularity, null, r.name);
  }
  // Listed hours: closed at 10pm on a Friday.
  const late = Match.recommend(DEMO.restaurants, [diner], { now: new Date(2026, 9, 2, 22, 0) });
  assert.ok(late.excluded.some((e) => e.restaurant.name === 'Crawdads on the Lake'));
});

test('opening hours parser', () => {
  const fri = (h, m = 0) => new Date(2026, 9, 2, h, m);
  const sat = (h, m = 0) => new Date(2026, 9, 3, h, m);
  assert.equal(Hours.isOpenAt('24/7', fri(3)), true);
  assert.equal(Hours.isOpenAt('Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00', fri(21)), true);
  assert.equal(Hours.isOpenAt('Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00', fri(22)), false);
  assert.equal(Hours.isOpenAt('Mo-Su 11:30-14:30,16:30-21:30', fri(15)), false);
  assert.equal(Hours.isOpenAt('Mo-Su 18:00-02:00', sat(1, 30)), true);
  assert.equal(Hours.isOpenAt('Mo-Su 11:00-22:00; Fr off', fri(12)), false);
  assert.equal(Hours.isOpenAt('Fr-Mo 17:00-23:00', fri(18)), true);
  assert.equal(Hours.isOpenAt('11:00-21:00', fri(12)), true);
  assert.equal(Hours.isOpenAt('sunrise-sunset', fri(12)), null);
  assert.equal(Hours.isOpenAt(null, fri(12)), null);
});

test('OpenStreetMap elements become restaurants without invented ratings', () => {
  const r = Places.fromOsm(
    {
      type: 'node', id: 42, lat: 38.68, lon: -121.17,
      tags: { amenity: 'pub', name: 'The Hop', cuisine: 'burger;pizza', outdoor_seating: 'yes', opening_hours: 'Mo-Su 11:00-23:00' },
    },
    38.6779, -121.1761,
  );
  assert.equal(r.id, 'osm-node-42');
  assert.deepEqual(r.cuisine.sort(), ['american', 'italian', 'pub']);
  assert.ok(r.vibes.includes('patio'));
  assert.ok(r.noise > 1.5);
  assert.equal(r.cleanliness, null);
  assert.equal(r.parking, null);
  assert.ok(r.distanceKm < 1);
  assert.equal(Places.fromOsm({ type: 'node', id: 1, lat: 0, lon: 0, tags: {} }), null);
});

test('region data: Petra Greek in Folsom and Midtown, ZIPs resolve inside the region', () => {
  const petra = DEMO.restaurants.filter((r) => r.name === 'Petra Greek').map((r) => r.town).sort();
  assert.deepEqual(petra, ['Folsom', 'Sacramento']);
  const ids = DEMO.restaurants.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'restaurant ids are unique');
  for (const [zip, [lat, lon]] of Object.entries(DEMO.zips)) {
    const km = Places.haversineKm(lat, lon, DEMO.center.lat, DEMO.center.lon);
    assert.ok(km <= DEMO.radiusKm, `${zip} is ${km} km out`);
  }
});
