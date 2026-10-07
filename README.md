# FoodieMatch

Many cravings. One table.

> **Job to be done:** *When selecting a new restaurant, I want to know if there is an environment that aligns with mine and others' needs and interests, so that I can have an enjoyable experience with the group I'm dining with.*

Everyone takes a 60-second taste quiz. FoodieMatch then merges the profiles of the people eating together, checks how well they match, and ranks nearby restaurants for the whole table.

## Run it

No build step and no API keys.

```bash
npm start          # serves on http://localhost:8000 (python3 -m http.server)
npm test           # matching engine tests (Node 18+)
```

You can also double-click `index.html`. Location features work best over `http://localhost`.

## How it works

1. **Welcome → Log in / Create account, or Continue as guest**: guests can do everything except save favorites; tapping Save as favorite as a guest asks you to log in. **The login, account and two-factor screens are a clickable prototype for user testing.** Nothing is sent anywhere, passwords are never stored, and the 2FA step shows a test code on screen. Real accounts need an auth service, such as Supabase with authenticator-app 2FA. "Delete session" clears everything on this device.
2. **Your taste quiz** (`js/quiz.js`): one question per screen:
   1. What food genre are you craving today? (up to 3)
   2. Stick to favorites · Try something new (logged-in users only; guests and people added on this phone are set to "something new")
   3. Ideal noise level? Quiet · Light buzz · High energy
   4. Instant dealbreaker? (up to 2) Messy · No parking · Rude service · Too pricey · Too loud
   5. How long will you wait for a table?
   6. Who are you dining with today?
   7. *(optional, up to 2)* What makes a place feel special? Views, design & lighting, patio, live music…
   8. Where are you eating? (ZIP code; asked of the session owner only)
3. **Who's joining you?** Your profile is always at the table. Add people by having them take the quiz on your phone, or by pasting their share code (`FOODIE1:…`) from their own phone. You can also tap "Just me". Where the page runs as a shared Claude artifact, **Nearby with the app open** lists everyone who has it open right now. Each person shares their first name, taste answers and the town from their last ZIP search, never coordinates. Tap Add to bring them to your table. Previews also list four test users (Priya, Marcus, Jules and Sam, each marked "(test)") so group picks can be tried alone. Friends on other phones share a **6-digit code**, which everyone gets, guests included, shown right under "Who's joining you?". In the shared artifact it points to their profile in the page's store, and each person can write only their own entry. Without that store, as in the standalone app, the share screen falls back to a long self-contained code. People at your table show as one short line, such as "Thai, Japanese & sushi · Quiet".
4. **Location**: always the ZIP from the quiz (update it with Update on your profile). Eating alone goes straight to picks; groups see table harmony first, then See picks.
5. **Friends**: connect with people by entering their 6-digit code on your profile, or with Connect on their profile (from your table or Nearby). They see a friend request, with a dot on the person icon and a note on the main screen, and can Accept or Decline. Friends are listed on your profile (Profile, Remove) and under "Who's joining you?" with one-tap Add. In the shared store, each person keeps one list at `links/<id>` that only they can write. Two people on each other's lists are friends, and being on someone's list without them on yours is a request. Previews include a request from Priya (test), and test users accept right away.
5. **Profile and settings**: the person icon at the top right is on every screen, with **Sign in** beside it until you're signed in. You can sign in at any step and land back where you were. The profile has a header image, a profile photo in front of it, a short bio, an optional phone number, and favorites with star ratings, written reviews and up to 3 photos each. **Settings** has your username ("Don't use your full name"), phone number, email, password and two-factor authentication on/off (signed-in prototype; passwords are never stored). It also sets who can see your profile: **Private** (default; only your taste answers travel with your code, for matching), **Friends** (people with your code) or **Public** (you appear under Nearby). Any section can be hidden, and the phone number is hidden from others until you turn it on. "See what friends see" previews the result.
5. **Results**: each card says what kind of place it is (sit-down, casual, café, pub) and why it fits, e.g. "Your Seafood craving", "Patio seating", "Sit-down tables for a group". Swipe a card left or right (or press Delete) to hide it for this session. Similar places (same cuisine) then rank a little lower, with Undo and "Show hidden". A ranked list with a group match %, *why* it fits (and for whom), concerns, how each person feels about it, and a "ruled out" list with reasons.
6. **Favorites and ratings** (logged in): saved places appear on your profile with 1–5 stars. Ratings nudge future scores up or down (±0.06 per star from 3).
7. **Top genres over time**: each quiz adds your cravings to a history, and genres picked in 2+ sessions show as "Usually". Today's craving always wins. History only steers "Surprise me" days, and a new craving is marked "(something different)".

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
- **Saved Greater Sacramento list:** `js/region-data.js` has 89 real restaurants across Folsom, Sacramento (Downtown and Midtown), Roseville, Rocklin, Elk Grove, El Dorado Hills, Davis, Rancho Cordova, Citrus Heights and Fair Oaks. They were compiled from public listings (Tripadvisor, Yelp, OpenTable, Yellow Pages, Visit Folsom) in October 2026: name, cuisine, street address, and listed features such as a patio or lake view. It also maps 55 area ZIP codes to the middle of their town or neighborhood. Coordinates are approximate. Ratings, waits, parking and price are left unknown, and hours are filled in only where a listing gave them. The app uses this list in previews that can't reach the map service, or when a live lookup inside the region fails. It shows places within about 10 miles.
- **To go further:** fill the same fields from a source with reviews (Google Places, Yelp Fusion, Foursquare). `cleanliness`, `service` and `popularity` map naturally to review sentiment and counts.

## Files

```
index.html          page shell
styles.css          mobile-first styles, light + dark
js/quiz.js          quiz questions + labels
js/matching.js      scoring, group recommendation, profile compatibility (pure functions)
js/hours.js         opening_hours parser
js/places.js        OpenStreetMap + geocoding
js/region-data.js   Greater Sacramento restaurants + ZIP lookup
js/app.js           UI
tests/              node:test suite for the engine
```
