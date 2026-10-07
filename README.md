# FoodieMatch

Many cravings. One table.

**Logo:** two overlapping sage plate rings, for two tastes meeting at one table. It sits beside the name in the header, large on the welcome screen, and is the browser-tab icon.

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

0. **Sessions and privacy**: guests get the original session model. Everything works for one visit, but nothing is saved after the tab closes, and nothing goes into the shared store unless they tap **Get a code**; guest codes expire after 12 hours. Without a login, the app always opens on the welcome screen. Logged-in accounts keep their profile on the device, saved under the account; **Sign Out** ends the session and returns to welcome, and logging back in restores it (same code digits). Friends and shared profile cards are for logged-in accounts. Signing in mid-session carries the guest's work into the account. Opening the app while logged out clears anything an earlier session left in the shared store.
1. **Welcome → Log in / Create account, or Continue as guest**: guests can do everything except save favorites; tapping Save as favorite as a guest asks you to log in. **The login, account and two-factor screens are a clickable prototype for user testing.** Nothing is sent anywhere, passwords are never stored, and the 2FA step shows a test code on screen. Real accounts need an auth service, such as Supabase with authenticator-app 2FA. "Delete session" clears everything on this device. **Test account (previews only):** the Log in page shows `test@foodiematch.app` / `tastetest1` with a "Use the test account" button. It opens a ready-made profile, taste_tester, with favorites, ratings, a review and a bio. Its email is never claimed in the shared store, and it can't be used to sign up.
   Logging in or signing up mid-quiz keeps your answers and returns you to the same question, and Back on the Log in page does too. Answers are saved on the device as you go, so a reload picks up where you left off. **Start over** (tap twice) clears the answers.
2. **Your taste quiz** (`js/quiz.js`): one question per screen:
   1. What food genre are you craving today? (up to 3)
   2. Stick to favorites · Try something new (logged-in users only; guests and people added on this phone are set to "something new")
   3. Ideal noise level? Quiet · Light buzz · High energy
   4. Instant dealbreaker? (up to 2) Messy · No parking · Rude service · Too pricey · Too loud
   5. How long will you wait for a table?
   6. Who are you dining with today?
   7. *(optional, up to 2)* What makes a place feel special? Views, design & lighting, patio, live music…
   8. Where are you eating? (ZIP code; asked of the session owner only)
3. **Who's joining you?** Your profile is always at the table. Add people by having them take the quiz on your phone, or by pasting their share code (`FOODIE1:…`) from their own phone. You can also tap "Just me". There is no "nearby" list: people join the same match session only with a join code. Friends on other phones share a 6-digit **join code**, which everyone gets, guests included, shown right under "Who's joining you?". In the shared artifact it points to their profile in the page's store, and each person can write only their own entry. Without that store, as in the standalone app, the share screen falls back to a long self-contained code. People at your table show as one short line, such as "Thai, Japanese & sushi · Quiet".
3a. **Join a group**: the welcome screen has **Join a group**, and the table screen has **Join a friend's table**. Both open *Join a table*, where you type the host's 6-digit join code. Someone new then chooses **Login/Sign Up** or **Continue as guest** (handy when they're in a hurry; they can log in later and keep their answers and seat), picks a username and takes the quiz, then they're seated. An account that already has a profile is seated right after logging in. Joining puts both people at the same table on both phones: the joiner writes `joins/<their id>` (only they can) with the host's code and their taste answers, and the host's phone adds them ("ben joined your table"). Retaking the quiz updates the host's copy. A join lasts 12 hours and is cleared on Sign Out or Delete session. **Demo (previews only):** the Join page shows the code **012 345**, which seats you at a simulated table with the test users priya_eats, marcus_r and jules.tacos, and the table screen has "let sam_noodles join with your code" to show the host's side. Real codes are 100000–999999, so the demo code never matches a person.
4. **Location**: always the ZIP from the quiz (update it with Update on your profile). Eating alone goes straight to picks; groups see table harmony first, then See picks.
5. **Accounts**: the header has FoodieMatch on the left and one **Login/Sign Up** button plus the person icon on the right, on every screen (**Sign Out** once you're signed in). It opens the Log in page, which has a toggle (and a "Sign up instead" link) to switch to Sign up. Each email can have only one profile: signing up with a used email says so and offers "Log in instead", and logging in with an unknown email offers "Sign up instead". Usernames are unique, ignoring capitalization. In the shared store each person has `accounts/<id>`, which only they can write, holding their lowercased username and a one-way hash of their email; the email itself is never stored. Delete session frees both.
5. **Friends**: connect with Connect on someone's profile (open it from your table). They see a friend request, with a dot on the person icon and a note on the main screen, and can Accept or Decline. Friends are listed on your profile (Profile, Remove) and under "Who's joining you?" with one-tap Add. In the shared store, each person keeps one list at `links/<id>` that only they can write. Two people on each other's lists are friends, and being on someone's list without them on yours is a request. Previews include a request from the test user priya_eats (other test users: marcus_r, jules.tacos, sam_noodles), and test users accept right away.
5. **Profile and settings**: the person icon at the top right is on every screen, with **Sign in** beside it until you're signed in. You can sign in at any step and land back where you were. The profile has a header image, a profile photo in front of it, a short bio, an optional phone number, and favorites with star ratings, written reviews and up to 3 photos each. **Settings** has your username ("Don't use your full name"), phone number, email, password and two-factor authentication on/off (signed-in prototype; passwords are never stored). It also sets who can see your profile: **Private** (default; only your taste answers travel with your code, for matching), **Friends** (people with your code) or **Public** (anyone who finds you can see it). Any section can be hidden, and the phone number is hidden from others until you turn it on. "See what friends see" previews the result.
5. **Results**: each card has a **Vibe** line describing the room, so you know the environment before you go, and says what kind of place it is (sit-down, casual, café, pub) and why it fits, e.g. "Your Seafood craving", "Patio seating", "Sit-down tables for a group". Swipe a card left or right (or press Delete) to hide it for this session. Similar places (same cuisine) then rank a little lower, with Undo and "Show hidden". A ranked list with a group match %, *why* it fits (and for whom), concerns, how each person feels about it, and a "ruled out" list with reasons.
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
- **Saved Greater Sacramento list:** `js/region-data.js` has 84 real restaurants across Folsom, Sacramento (Downtown and Midtown), Roseville, Rocklin, Elk Grove, El Dorado Hills, Davis, Rancho Cordova, Citrus Heights and Fair Oaks. They were compiled from public listings (Tripadvisor, Yelp, OpenTable, Yellow Pages, Visit Folsom) in October 2026: name, cuisine, street address, and listed features such as a patio or lake view. Each place also has a short **Vibe** line describing the room (for example "Garden patio with olive trees, waterfalls and a fireplace"), summarized from reviews, listings and local press (OpenTable, Visit Placer, Inside Sacramento, Sacramento News & Review, Michelin); places without a reliable description show the venue type and listed features instead. Places that turned out to be closed or couldn't be confirmed were removed. It also maps 55 area ZIP codes to the middle of their town or neighborhood. Coordinates are approximate. Ratings, waits, parking and price are left unknown, and hours are filled in only where a listing gave them. The app uses this list in previews that can't reach the map service, or when a live lookup inside the region fails. It shows places within about 10 miles.
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
