/*
 * Foodie matching engine: pure functions, no DOM, so it runs in the browser and in Node tests.
 *
 *   scoreMember(restaurant, profile, ctx) → how well one place fits one person (0–1)
 *   recommend(restaurants, profiles, opts) → ranked places for the whole table
 *   compatibility(a, b) / groupHarmony(profiles) → how easily these people will agree
 *   combineProfiles(profiles) → the group's merged taste profile, for display
 *
 * How the research shaped the weights:
 *   • "Environment matters more than the actual food", so environment is the
 *     biggest single weight, ahead of cuisine.
 *   • "Some chaos (popularity) is good, too much drives people away", so
 *     popularity is scored on a sweet-spot curve rather than "more is better",
 *     and popular-but-messy counts as chaos.
 *   • "Dining is socially driven", so group score blends the average with the
 *     least-happy member, so no one gets dragged somewhere they'd hate. Solo
 *     diners get "quick & clean" instead of the full sit-down experience.
 *   • Dealbreakers are vetoes: one person's dealbreaker removes the place for all.
 *
 * Restaurant shape (unknown values are null and never trigger a dealbreaker):
 *   { id, name, cuisine:[...], noise:0–2, price:1–4, parking:bool, cleanliness:0–1,
 *     service:0–1, waitMinutes, popularity:0–1, vibes:[...], goodFor:[...],
 *     quick:bool, hours:"Mo-Su 11:00-22:00", distanceKm }
 *
 * Profile shape (what the quiz produces):
 *   { id, name, cuisines:[...], novelty:'favorites'|'new', noise:'quiet'|'buzz'|'high',
 *     dealbreakers:[...], maxWait:minutes, diningWith, vibes:[...], favorites:[ids], visited:[ids] }
 */
(function (root, factory) {
  const hours = typeof module === 'object' && module.exports ? require('./hours.js') : root.FoodieHours;
  const quiz = typeof module === 'object' && module.exports ? require('./quiz.js') : root.FoodieQuiz;
  const api = factory(hours, quiz);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoodieMatch = api;
})(typeof self !== 'undefined' ? self : this, function (Hours, Quiz) {
  const L = Quiz.LABELS;

  const NOISE_LEVEL = { quiet: 0, buzz: 1, high: 2 };
  const NOISE_WORD = ['quiet', 'buzzing', 'high-energy'];

  // Ideal popularity for each noise preference: quiet people still like *some* buzz.
  const POPULARITY_SWEET_SPOT = { quiet: 0.45, buzz: 0.65, high: 0.85 };

  const WEIGHTS = {
    environment: 0.3, // noise fit, vibes, cleanliness
    cuisine: 0.25,
    occasion: 0.15, // right for who you're with
    buzz: 0.1, // popularity sweet spot
    wait: 0.1,
    novelty: 0.1, // favorites vs. something new
  };

  // Group score = 60% average happiness + 40% happiness of the least-happy person.
  const GROUP_BLEND = { average: 0.6, leastMisery: 0.4 };
  const DISTANCE_PENALTY_PER_KM = 0.01;
  const MAX_DISTANCE_PENALTY = 0.1;

  const DEALBREAKER_RULES = {
    messy: { field: 'cleanliness', hit: (r) => r.cleanliness < 0.5, reason: 'looks messy', unknown: 'cleanliness' },
    no_parking: { field: 'parking', hit: (r) => r.parking === false, reason: 'no parking', unknown: 'parking' },
    rude_service: { field: 'service', hit: (r) => r.service < 0.5, reason: 'service complaints', unknown: 'service' },
    pricey: { field: 'price', hit: (r) => r.price >= 4, reason: 'too pricey ($$$$)', unknown: 'price' },
    loud: { field: 'noise', hit: (r) => r.noise >= 1.75, reason: 'too loud', unknown: 'noise level' },
  };

  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const known = (v) => v !== null && v !== undefined;
  const list = (v) => (Array.isArray(v) ? v : []);
  const round2 = (x) => Math.round(x * 100) / 100;

  // ---------------------------------------------------------------------------
  // Hard filters
  // ---------------------------------------------------------------------------

  /** Why this person would refuse this place (empty = fine), plus what we couldn't check. */
  function vetoes(r, p) {
    const reasons = [];
    const unverified = [];
    for (const key of list(p.dealbreakers)) {
      const rule = DEALBREAKER_RULES[key];
      if (!rule) continue;
      if (!known(r[rule.field])) unverified.push(rule.unknown);
      else if (rule.hit(r)) reasons.push(rule.reason);
    }
    if (known(p.maxWait) && known(r.waitMinutes) && r.waitMinutes > p.maxWait) {
      reasons.push(`~${r.waitMinutes} min wait (max ${p.maxWait})`);
    }
    return { reasons, unverified };
  }

  // ---------------------------------------------------------------------------
  // Per-person scoring. Each part is 0–1 and may add "likes" / "concerns".
  // ---------------------------------------------------------------------------

  function cuisineFit(r, p, out) {
    const wants = list(p.cuisines);
    if (!wants.length || wants.includes('any')) return 0.6;
    const hit = list(r.cuisine).find((c) => wants.includes(c));
    if (hit) {
      out.likes.push(`${L.cuisine[hit] || hit} craving`);
      return 1;
    }
    out.concerns.push('not what they’re craving');
    return 0.15;
  }

  function environmentFit(r, p, out) {
    const pref = NOISE_LEVEL[p.noise] ?? 1;
    let noiseFit = 0.5;
    if (known(r.noise)) {
      noiseFit = 1 - Math.abs(r.noise - pref) / 2;
      if (noiseFit >= 0.85) out.likes.push(`${L.noise[p.noise] || 'Noise level'} vibe`);
      else if (noiseFit <= 0.5) out.concerns.push(r.noise > pref ? 'louder than they like' : 'quieter than they like');
    }

    const wanted = list(p.vibes);
    let vibeFit = 0.5;
    if (wanted.length) {
      const matched = wanted.filter((v) => list(r.vibes).includes(v));
      vibeFit = 0.2 + (0.8 * matched.length) / wanted.length;
      for (const v of matched) out.likes.push(L.vibe[v] || v);
    }

    const cleanFit = known(r.cleanliness) ? r.cleanliness : 0.5;
    return 0.5 * noiseFit + 0.35 * vibeFit + 0.15 * cleanFit;
  }

  function buzzFit(r, p, out) {
    if (!known(r.popularity)) return 0.5;
    const target = POPULARITY_SWEET_SPOT[p.noise] ?? 0.65;
    let fit = 1 - Math.abs(r.popularity - target) * 2;
    const chaotic = r.popularity > 0.75 && known(r.cleanliness) && r.cleanliness < 0.6;
    if (chaotic) {
      fit -= 0.3;
      out.concerns.push('busy and chaotic');
    } else if (fit >= 0.8 && r.popularity >= 0.6) {
      out.likes.push('popular, with a good buzz');
    }
    return clamp01(fit);
  }

  function waitFit(r, p) {
    if (!known(r.waitMinutes)) return 0.6;
    const max = known(p.maxWait) ? p.maxWait : 30;
    if (r.waitMinutes > max) return 0;
    if (max === 0 || max >= 999) return clamp01(1 - r.waitMinutes / 120);
    return 1 - (0.5 * r.waitMinutes) / max;
  }

  function noveltyFit(r, p, out, cuisineScore) {
    const isFavorite = list(p.favorites).includes(r.id);
    const beenHere = isFavorite || list(p.visited).includes(r.id);
    if (p.novelty === 'new') {
      if (beenHere) {
        out.concerns.push('they’ve been here already');
        return 0.15;
      }
      return 1;
    }
    if (isFavorite) {
      out.likes.push('one of their favorites');
      return 1;
    }
    if (beenHere) return 0.75;
    return cuisineScore === 1 ? 0.55 : 0.35;
  }

  function occasionFit(r, occasion, out) {
    if (occasion === 'solo') {
      // Research: alone, people want "something clean and quick", not an experience.
      const quick = r.quick ? 1 : 0.3;
      const clean = known(r.cleanliness) ? r.cleanliness : 0.5;
      if (r.quick && clean >= 0.7) out.likes.push('quick & clean for a solo bite');
      return 0.6 * quick + 0.4 * clean;
    }
    if (list(r.goodFor).includes(occasion)) {
      out.likes.push(`good with ${(L.company[occasion] || occasion).toLowerCase()}`);
      return 1;
    }
    return 0.4;
  }

  /** How well one restaurant fits one person, 0–1, with reasons. */
  function scoreMember(r, p, ctx = {}) {
    const out = { likes: [], concerns: [] };
    const cuisine = cuisineFit(r, p, out);
    const parts = {
      cuisine,
      environment: environmentFit(r, p, out),
      buzz: buzzFit(r, p, out),
      wait: waitFit(r, p),
      novelty: noveltyFit(r, p, out, cuisine),
      occasion: occasionFit(r, ctx.occasion || p.diningWith || 'friends', out),
    };
    let total = 0;
    for (const [k, w] of Object.entries(WEIGHTS)) total += w * parts[k];
    for (const k of Object.keys(parts)) parts[k] = round2(parts[k]);
    return { total: round2(total), parts, likes: out.likes, concerns: out.concerns };
  }

  // ---------------------------------------------------------------------------
  // Group logic
  // ---------------------------------------------------------------------------

  function mode(values, fallback) {
    const counts = new Map();
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
    let best = fallback;
    let bestCount = 0;
    for (const [v, c] of counts) if (c > bestCount) [best, bestCount] = [v, c];
    return best;
  }

  /** Shared context for the meal: who are we dining as? */
  function groupContext(profiles) {
    if (profiles.length === 1) return { occasion: profiles[0].diningWith || 'friends' };
    // With 2+ people at the table it isn't a solo meal, whatever someone answered.
    const social = profiles.map((p) => p.diningWith).filter((v) => v && v !== 'solo');
    return { occasion: mode(social, 'friends') };
  }

  /** Group "join" of reasons: [{text, who:[names]}] sorted by how many people share them. */
  function mergeReasons(members, key) {
    const byText = new Map();
    for (const m of members) {
      for (const text of m[key]) {
        if (!byText.has(text)) byText.set(text, []);
        const who = byText.get(text);
        if (!who.includes(m.name)) who.push(m.name);
      }
    }
    return [...byText].map(([text, who]) => ({ text, who })).sort((a, b) => b.who.length - a.who.length);
  }

  /**
   * Rank restaurants for a group.
   * @param {object[]} restaurants
   * @param {object[]} profiles  one or more quiz profiles
   * @param {{now?: Date, maxDistanceKm?: number}} opts
   * @returns {{results: object[], excluded: object[], context: object}}
   */
  function recommend(restaurants, profiles, opts = {}) {
    if (!profiles.length) throw new Error('Need at least one diner profile');
    const now = opts.now || new Date();
    const ctx = groupContext(profiles);
    const results = [];
    const excluded = [];

    for (const r of restaurants) {
      if (known(opts.maxDistanceKm) && known(r.distanceKm) && r.distanceKm > opts.maxDistanceKm) continue;

      const reasons = [];
      const unverified = new Set();
      const openNow = r.hours ? Hours.isOpenAt(r.hours, now) : null;
      if (openNow === false) reasons.push('closed right now');
      if (openNow === null) unverified.add('opening hours');

      for (const p of profiles) {
        const v = vetoes(r, p);
        for (const why of v.reasons) reasons.push(profiles.length > 1 ? `${p.name}: ${why}` : why);
        v.unverified.forEach((u) => unverified.add(u));
      }
      if (reasons.length) {
        excluded.push({ restaurant: r, reasons });
        continue;
      }

      const members = profiles.map((p) => ({ id: p.id, name: p.name, ...scoreMember(r, p, ctx) }));
      const totals = members.map((m) => m.total);
      const average = totals.reduce((a, b) => a + b, 0) / totals.length;
      const leastHappy = Math.min(...totals);
      const distancePenalty = known(r.distanceKm)
        ? Math.min(MAX_DISTANCE_PENALTY, r.distanceKm * DISTANCE_PENALTY_PER_KM)
        : 0;
      const score = clamp01(GROUP_BLEND.average * average + GROUP_BLEND.leastMisery * leastHappy - distancePenalty);

      results.push({
        restaurant: r,
        score: round2(score),
        average: round2(average),
        leastHappy: members.find((m) => m.total === leastHappy),
        members,
        highlights: mergeReasons(members, 'likes'),
        concerns: mergeReasons(members, 'concerns'),
        unverified: [...unverified],
      });
    }

    results.sort((a, b) => b.score - a.score || (a.restaurant.distanceKm ?? 0) - (b.restaurant.distanceKm ?? 0));
    return { results, excluded, context: ctx };
  }

  // ---------------------------------------------------------------------------
  // Profile ↔ profile matching
  // ---------------------------------------------------------------------------

  function jaccard(a, b) {
    const A = new Set(a);
    const B = new Set(b);
    const union = new Set([...A, ...B]);
    if (!union.size) return null;
    let inter = 0;
    for (const x of A) if (B.has(x)) inter++;
    return inter / union.size;
  }

  /** How easily two diners will agree, 0–1, plus what they share and where they'll clash. */
  function compatibility(a, b) {
    const shared = [];
    const friction = [];
    const ca = list(a.cuisines);
    const cb = list(b.cuisines);

    let cuisine;
    if (ca.includes('any') || cb.includes('any')) cuisine = 0.75;
    else {
      cuisine = jaccard(ca, cb) ?? 0.5;
      const both = ca.filter((c) => cb.includes(c));
      if (both.length) shared.push(`both craving ${both.map((c) => L.cuisine[c] || c).join(', ')}`);
      else if (ca.length && cb.length) {
        friction.push(`no cravings in common (${a.name}: ${ca.map((c) => L.cuisine[c] || c).join(', ')} vs ${b.name}: ${cb.map((c) => L.cuisine[c] || c).join(', ')})`);
      }
    }

    const na = NOISE_LEVEL[a.noise] ?? 1;
    const nb = NOISE_LEVEL[b.noise] ?? 1;
    const noise = 1 - Math.abs(na - nb) / 2;
    if (na === nb) shared.push(`both want ${(L.noise[a.noise] || 'the same noise level').toLowerCase()}`);
    else if (Math.abs(na - nb) === 2) friction.push(`${a.name} wants quiet, ${b.name} wants high energy`);

    const wa = Math.min(a.maxWait ?? 30, 60);
    const wb = Math.min(b.maxWait ?? 30, 60);
    const wait = 1 - Math.abs(wa - wb) / 60;

    const vibe = jaccard(list(a.vibes), list(b.vibes));
    const vibesBoth = list(a.vibes).filter((v) => list(b.vibes).includes(v));
    if (vibesBoth.length) shared.push(`both love ${vibesBoth.map((v) => (L.vibe[v] || v).toLowerCase()).join(', ')}`);

    const novelty = a.novelty === b.novelty ? 1 : 0.5;
    if (a.novelty && a.novelty !== b.novelty) friction.push('one wants favorites, the other wants something new');

    let score = 0.35 * cuisine + 0.25 * noise + 0.15 * (vibe ?? 0.5) + 0.15 * wait + 0.1 * novelty;

    // One person's dealbreaker clashing with the other's preference.
    const clash = (x, y) => {
      if (list(x.dealbreakers).includes('loud') && y.noise === 'high') {
        friction.push(`${x.name} can't do loud, ${y.name} wants high energy`);
        score -= 0.15;
      }
    };
    clash(a, b);
    clash(b, a);

    score = clamp01(score);
    return { score: round2(score), label: harmonyLabel(score), shared, friction };
  }

  function harmonyLabel(score) {
    if (score >= 0.75) return 'Easy match';
    if (score >= 0.5) return 'Some compromise';
    return 'Tough crowd';
  }

  /** Average pairwise compatibility for the whole table. */
  function groupHarmony(profiles) {
    if (profiles.length < 2) return null;
    const pairs = [];
    for (let i = 0; i < profiles.length; i++) {
      for (let j = i + 1; j < profiles.length; j++) {
        pairs.push({ a: profiles[i].name, b: profiles[j].name, ...compatibility(profiles[i], profiles[j]) });
      }
    }
    const score = round2(pairs.reduce((s, p) => s + p.score, 0) / pairs.length);
    return {
      score,
      label: harmonyLabel(score),
      pairs,
      friction: [...new Set(pairs.flatMap((p) => p.friction))],
    };
  }

  /** The group's merged taste profile, for showing "here's what we're optimizing for". */
  function combineProfiles(profiles) {
    const tally = (key) => {
      const counts = {};
      for (const p of profiles) for (const v of list(p[key])) (counts[v] = counts[v] || []).push(p.name);
      return Object.entries(counts)
        .map(([value, who]) => ({ value, who }))
        .sort((a, b) => b.who.length - a.who.length);
    };
    const noiseAvg = profiles.reduce((s, p) => s + (NOISE_LEVEL[p.noise] ?? 1), 0) / profiles.length;
    const newVotes = profiles.filter((p) => p.novelty === 'new').length;
    return {
      cuisines: tally('cuisines'),
      vibes: tally('vibes'),
      dealbreakers: tally('dealbreakers'),
      noise: NOISE_WORD[Math.round(noiseAvg)],
      maxWait: Math.min(...profiles.map((p) => p.maxWait ?? 30)),
      novelty: newVotes > profiles.length / 2 ? 'new' : newVotes === profiles.length / 2 ? 'mixed' : 'favorites',
      occasion: groupContext(profiles).occasion,
    };
  }

  return {
    WEIGHTS,
    GROUP_BLEND,
    scoreMember,
    vetoes,
    recommend,
    compatibility,
    groupHarmony,
    combineProfiles,
    groupContext,
  };
});
