# 🍽️ Foodie: find a spot the whole table will love

> **Job to be done:** *When selecting a new restaurant, I want to know if there is an environment that aligns with mine and others' needs and interests, so that I can have an enjoyable experience with the group I'm dining with.*

Everyone takes a 60-second taste quiz. Foodie then merges the profiles of the people eating together, checks how well they match, and ranks nearby restaurants for the whole table.

## Run it

No build step and no API keys.

```bash
npm start          # serves on http://localhost:8000 (python3 -m http.server)
npm test           # matching engine tests (Node 18+)
```

You can also double-click `index.html`. Location features work best over `http://localhost`.

## How it works

1. **Welcome → your name**: no email or password for now. The account is saved on this device.
2. **Your taste quiz** (`js/quiz.js`): one question per screen:
   1. What food genre are you craving today? (up to 2)
   2. Stick to favorites · Try something new
   3. Ideal noise level? Quiet · Light buzz · High energy
   4. Instant dealbreaker? (up to 2) Messy · No parking · Rude service · Too pricey · Too loud
   5. How long will you wait for a table?
   6. Who are you dining with today?
   7. *(optional, up to 2)* What makes a place feel special? Views, design & lighting, patio, live music…
3. **Who's joining you?** Your profile is always at the table. Add people by having them take the quiz on your phone, or by pasting their share code (`FOODIE1:…`) from their own phone. You can also tap "Just me".
4. **Location**: use your location, type a city, or try the Folsom demo data.
5. **Results**: a ranked list with a group match %, *why* it fits (and for whom), concerns, how each person feels about it, and a "ruled out" list with reasons.
6. **❤️ We loved it** saves the place to everyone's favorites, so "Stick to favorites" ranks it higher next time.

## How the research shaped the algorithm (`js/matching.js`)

| Research finding | What the code does |
|---|---|
| **Environment matters more than the food** (pretty spaces, views, lighting, furniture) | `environment` is the largest weight (30%), ahead of cuisine (25%). The optional "vibes" question feeds it. |
| **Some chaos (popularity) is good; too much drives people away** (the brewery looked hip, then "messy… screaming children") | Popularity is scored on a **sweet-spot curve**, not "more is better". The ideal level depends on each person's noise preference. Popular *and* messy is flagged as "busy and chaotic". |
| **Dining is socially driven**; one interviewee wouldn't eat out alone at all | The group score is **60% average + 40% least-happy person**, so nobody gets dragged somewhere they'd hate. With 2+ diners, the occasion comes from the group. Solo diners get scored on "quick & clean". |
| **Dealbreakers** | Hard vetoes: if one person can't do loud, the place is out for everyone, and the results show who vetoed it and why. |
| **The group's AI assistant recommended a closed restaurant** | Opening hours are parsed (`js/hours.js`). Closed places are ruled out, and unknown hours are flagged rather than guessed. |
| **Word of mouth / popularity draws people in** | Popular places get a "good buzz" highlight. Favorites are remembered. |

Weights are constants at the top of `js/matching.js` (`WEIGHTS`, `GROUP_BLEND`, `POPULARITY_SWEET_SPOT`), so they're easy to tune after user testing.

### Profile ↔ profile matching

`compatibility(a, b)` scores two diners from 0 to 1 on shared cravings, noise preference, vibes, wait tolerance and mood, minus clashes such as one person's "too loud" dealbreaker against another's "high energy". `groupHarmony()` averages all pairs and shows the group as *Easy match / Some compromise / Tough crowd*, listing what they share and where they'll clash.

## Data sources (`js/places.js`)

- **Live:** OpenStreetMap via the Overpass API (free, no key). OSM gives cuisine, venue type, hours, outdoor seating and live music, but **not** cleanliness, service, wait or parking. Those fields stay `null`. They never trigger a dealbreaker and appear as "unverified" on the card. Noise is estimated from the venue type (pub > restaurant > café).
- **Saved Folsom list:** `js/demo-data.js` has 31 real Folsom restaurants compiled from public listings (Tripadvisor, Yelp, OpenTable, Yellow Pages) in October 2026: name, cuisine, street address, and listed features such as a patio or lake view. Coordinates are approximate, placed by street or shopping center. Ratings, waits, parking and price are left unknown, and hours are filled in only where a listing gave them. Previews that can't reach the map service use this list.
- **To go further:** fill the same fields from a source with reviews (Google Places, Yelp Fusion, Foursquare). `cleanliness`, `service` and `popularity` map naturally to review sentiment and counts.

## Files

```
index.html          page shell
styles.css          mobile-first styles, light + dark
js/quiz.js          quiz questions + labels
js/matching.js      scoring, group recommendation, profile compatibility (pure functions)
js/hours.js         opening_hours parser
js/places.js        OpenStreetMap + geocoding
js/demo-data.js     fictional demo restaurants
js/app.js           UI
tests/              node:test suite for the engine
```
