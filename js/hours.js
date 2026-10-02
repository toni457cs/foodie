/*
 * Minimal OpenStreetMap `opening_hours` reader.
 *
 * In the field test the group's AI assistant recommended a restaurant that was
 * closed, and they gave up on it. So we never recommend a place we know is
 * closed, and we say so when we can't tell.
 *
 * Handles the common forms: "24/7", "Mo-Fr 11:00-22:00; Sa,Su 10:00-23:00",
 * split shifts "11:00-14:00,17:00-22:00", past-midnight "18:00-02:00" and
 * "Mo off". Anything fancier returns null (= unknown), never a guess.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FoodieHours = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DAY_INDEX = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
  const DAY_TOKEN = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
  const DAY_SPEC = new RegExp(`^${DAY_TOKEN}(?:-${DAY_TOKEN})?(?:,${DAY_TOKEN}(?:-${DAY_TOKEN})?)*$`);
  const TIME_RANGE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})\+?$/;

  function parseDays(spec) {
    const days = new Set();
    for (const part of spec.split(',')) {
      const [a, b] = part.split('-');
      const start = DAY_INDEX[a];
      const end = b ? DAY_INDEX[b] : start;
      for (let d = start; ; d = (d + 1) % 7) {
        days.add(d);
        if (d === end) break;
      }
    }
    return days;
  }

  function parseTimes(spec) {
    if (/^(off|closed)$/i.test(spec)) return [];
    const ranges = [];
    for (const part of spec.split(',')) {
      const m = part.trim().match(TIME_RANGE);
      if (!m) return null;
      ranges.push([+m[1] * 60 + +m[2], +m[3] * 60 + +m[4]]);
    }
    return ranges;
  }

  /** Returns [{days:Set, ranges:[[startMin,endMin]]}] or null if unparseable. */
  function parse(hours) {
    if (typeof hours !== 'string' || !hours.trim()) return null;
    const text = hours.trim();
    if (text === '24/7') return [{ days: parseDays('Mo-Su'), ranges: [[0, 24 * 60]] }];
    const rules = [];
    for (const raw of text.split(';')) {
      const rule = raw.trim();
      if (!rule) continue;
      if (/^PH\b/.test(rule)) continue; // public-holiday rules: ignore rather than fail
      const space = rule.indexOf(' ');
      const head = space === -1 ? rule : rule.slice(0, space);
      let days;
      let timeSpec;
      if (DAY_SPEC.test(head)) {
        days = parseDays(head);
        timeSpec = space === -1 ? '' : rule.slice(space + 1).trim();
      } else {
        days = parseDays('Mo-Su');
        timeSpec = rule;
      }
      const ranges = parseTimes(timeSpec);
      if (!ranges) return null;
      rules.push({ days, ranges });
    }
    return rules.length ? rules : null;
  }

  /** Later rules override earlier ones for the same day (OSM semantics). */
  function rangesFor(rules, day) {
    let ranges = [];
    for (const r of rules) if (r.days.has(day)) ranges = r.ranges;
    return ranges;
  }

  /** true = open, false = closed, null = unknown. */
  function isOpenAt(hours, date) {
    const rules = parse(hours);
    if (!rules) return null;
    const day = date.getDay();
    const mins = date.getHours() * 60 + date.getMinutes();
    for (const [start, end] of rangesFor(rules, day)) {
      if (end > start ? mins >= start && mins < end : mins >= start) return true;
    }
    // Yesterday's late-night shift spilling past midnight.
    for (const [start, end] of rangesFor(rules, (day + 6) % 7)) {
      if (end <= start && mins < end) return true;
    }
    return false;
  }

  return { parse, isOpenAt };
});
