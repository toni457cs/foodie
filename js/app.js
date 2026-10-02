/*
 * Foodie UI. Plain JS, no build step.
 *
 * Flow: Home (who's eating?) → Quiz (one question per screen) → Profile + share code
 *       → Group (harmony + combined profile + pick location) → Results
 *
 * Profiles live in localStorage on this device. Friends on other phones share
 * a profile code ("FOODIE1:…") that you paste in. That's how profiles get
 * matched without needing accounts or a server.
 */
(function () {
  const { QUIZ, LABELS } = window.FoodieQuiz;
  const Match = window.FoodieMatch;
  const Places = window.FoodiePlaces;
  const DEMO = window.FOODIE_DEMO;

  const STORAGE_KEY = 'foodie.profiles.v1';
  const CODE_PREFIX = 'FOODIE1:';
  const $app = document.getElementById('app');

  const state = {
    view: 'home',
    profiles: loadProfiles(),
    selected: new Set(),
    quiz: null, // { step, answers, editingId }
    lastCreatedId: null,
    location: null, // { lat, lon, label, demo }
    status: null, // { kind: 'loading'|'error', text }
    outcome: null, // recommend() result
  };
  state.profiles.forEach((p) => state.selected.add(p.id));

  // ---------------------------------------------------------------------------
  // Storage & share codes
  // ---------------------------------------------------------------------------

  function loadProfiles() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  function saveProfiles() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.profiles));
    } catch {
      /* private mode etc.: app still works for this session */
    }
  }

  const SHARE_FIELDS = ['name', 'cuisines', 'novelty', 'noise', 'dealbreakers', 'maxWait', 'diningWith', 'vibes', 'favorites'];

  function toCode(p) {
    const data = Object.fromEntries(SHARE_FIELDS.map((k) => [k, p[k]]));
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }

  function fromCode(code) {
    const trimmed = code.trim();
    if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('That doesn’t look like a Foodie code.');
    let data;
    try {
      data = JSON.parse(decodeURIComponent(escape(atob(trimmed.slice(CODE_PREFIX.length)))));
    } catch {
      throw new Error('That code is incomplete. Make sure you copied all of it.');
    }
    if (!data || typeof data.name !== 'string') throw new Error('That code is missing a name.');
    const profile = { id: newId(), visited: [] };
    for (const k of SHARE_FIELDS) profile[k] = data[k];
    profile.cuisines = arr(profile.cuisines);
    profile.dealbreakers = arr(profile.dealbreakers);
    profile.vibes = arr(profile.vibes);
    profile.favorites = arr(profile.favorites);
    profile.name = profile.name.slice(0, 40);
    return profile;
  }

  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const newId = () => 'p-' + Math.random().toString(36).slice(2, 10);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function toast(text) {
    const el = document.getElementById('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), 2400);
  }

  const pct = (x) => Math.round(x * 100);
  const scoreClass = (x) => (x >= 0.7 ? 'score-good' : x >= 0.5 ? 'score-ok' : 'score-bad');
  const names = (list) => (list.length <= 2 ? list.join(' & ') : `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`);
  const selectedProfiles = () => state.profiles.filter((p) => state.selected.has(p.id));

  function profileChips(p) {
    const chips = [];
    const cuisines = arr(p.cuisines);
    if (cuisines.length) chips.push(cuisines.map((c) => LABELS.cuisine[c] || c).join(', '));
    if (p.noise) chips.push(LABELS.noise[p.noise]);
    if (p.novelty) chips.push(p.novelty === 'new' ? 'Something new' : 'Favorites');
    if (p.diningWith) chips.push('w/ ' + LABELS.company[p.diningWith]);
    const deal = arr(p.dealbreakers).map((d) => `<span class="chip bad">✕ ${esc(LABELS.dealbreaker[d] || d)}</span>`);
    return chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('') + deal.join('');
  }

  function go(view) {
    state.view = view;
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  function renderHome() {
    const list = state.profiles
      .map(
        (p) => `
      <div class="card diner">
        <input type="checkbox" id="sel-${p.id}" data-action="toggle" data-id="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}
          aria-label="${esc(p.name)} is eating today" />
        <div class="who">
          <label for="sel-${p.id}"><strong>${esc(p.name)}</strong></label>
          <div>${profileChips(p)}</div>
        </div>
        <div class="actions">
          <button class="ghost small" data-action="retake" data-id="${p.id}" title="Update today's answers">Edit</button>
          <button class="ghost small" data-action="share" data-id="${p.id}">Share</button>
          <button class="ghost small" data-action="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button>
        </div>
      </div>`,
      )
      .join('');

    const n = state.selected.size;
    $app.innerHTML = `
      <section>
        <h1>Who’s eating?</h1>
        <p class="muted">Everyone takes a 60-second taste quiz. Then we combine your profiles and find places nearby that work for the whole table.</p>
      </section>
      <section class="stack">
        ${list || '<div class="card muted">No diners yet. Start with your own quiz.</div>'}
        <div class="row">
          <button class="primary" data-action="start-quiz">+ Take the quiz</button>
          <button data-action="show-import">Add a friend’s code</button>
        </div>
        <div id="import" class="card stack" hidden>
          <label for="import-code"><strong>Paste a friend’s Foodie code</strong></label>
          <textarea id="import-code" rows="3" placeholder="FOODIE1:…"></textarea>
          <div class="row"><button class="primary" data-action="import">Add to table</button></div>
        </div>
      </section>
      <section>
        <button class="primary block" data-action="to-group" ${n ? '' : 'disabled'}>
          ${n ? `Find a spot for ${n === 1 ? '1 diner' : `${n} diners`} →` : 'Select who’s eating'}
        </button>
      </section>`;
  }

  function renderQuiz() {
    const { step, answers } = state.quiz;
    const q = QUIZ[step];
    const value = answers[q.id];
    const progress = `<div class="progress" aria-hidden="true"><span style="width:${pct((step + 1) / QUIZ.length)}%"></span></div>`;
    let body;
    if (q.type === 'text') {
      body = `<input type="text" id="q-text" maxlength="40" placeholder="${esc(q.placeholder)}" value="${esc(value || '')}" autocomplete="given-name" />`;
    } else {
      const isOn = (v) => (q.type === 'multi' ? arr(value).includes(v) : value === v);
      body = `<div class="options" role="group" aria-label="${esc(q.prompt)}">
        ${q.options
          .map(
            (o) => `<button class="option" data-action="answer" data-value="${esc(o.value)}" aria-pressed="${isOn(o.value)}">
              <span class="emoji" aria-hidden="true">${o.emoji || ''}</span>
              <span>${esc(o.label)}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}</span>
            </button>`,
          )
          .join('')}
      </div>`;
    }
    const answered = q.type === 'multi' ? arr(value).length > 0 : q.type === 'text' ? !!(value || '').trim() : value !== undefined;
    const showNext = q.type !== 'single';
    const last = step === QUIZ.length - 1;
    $app.innerHTML = `
      ${progress}
      <p class="muted small">Question ${step + 1} of ${QUIZ.length}</p>
      <h1>${esc(q.prompt)}</h1>
      ${q.hint ? `<p class="muted">${esc(q.hint)}</p>` : ''}
      ${body}
      <div class="quiz-nav">
        <button class="ghost" data-action="quiz-back">← Back</button>
        ${showNext ? `<button class="primary" data-action="quiz-next" ${answered || q.optional ? '' : 'disabled'}>
          ${last ? 'Finish' : answered || !q.optional ? 'Next →' : 'Skip →'}</button>` : ''}
      </div>`;
    if (q.type === 'text') {
      const input = document.getElementById('q-text');
      input.focus();
      input.addEventListener('input', () => {
        answers.name = input.value;
        $app.querySelector('[data-action="quiz-next"]').disabled = !input.value.trim();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim()) quizNext();
      });
    }
  }

  function renderProfileDone() {
    const p = state.profiles.find((x) => x.id === state.lastCreatedId);
    if (!p) return go('home');
    $app.innerHTML = `
      <section class="stack">
        <h1>Nice to meet you, ${esc(p.name)}! 🎉</h1>
        <div class="card">${profileChips(p)}
          ${arr(p.vibes).length ? `<p class="small muted" style="margin-top:8px">Loves: ${esc(p.vibes.map((v) => LABELS.vibe[v]).join(', '))}</p>` : ''}
        </div>
        <div class="card stack">
          <strong>Eating with people on other phones?</strong>
          <p class="small muted">Send them this code, or have them send you theirs and paste it on the home screen.</p>
          <textarea readonly rows="3" id="share-code">${esc(toCode(p))}</textarea>
          <div class="row"><button data-action="copy-code" data-id="${p.id}">Copy my code</button></div>
        </div>
      </section>
      <section class="row">
        <button data-action="start-quiz">+ Add another diner</button>
        <button class="primary" data-action="to-group">Find our spot →</button>
      </section>`;
  }

  function renderGroup() {
    const group = selectedProfiles();
    if (!group.length) return go('home');
    const combined = Match.combineProfiles(group);
    const harmony = Match.groupHarmony(group);
    const tally = (items, labels) =>
      items.map((i) => `<span class="chip">${esc(labels[i.value] || i.value)}${group.length > 1 ? ` ×${i.who.length}` : ''}</span>`).join('') ||
      '<span class="muted small">none</span>';

    const harmonyHtml = harmony
      ? `<div class="card stack">
          <div class="spread"><h2>Table harmony</h2><strong>${pct(harmony.score)}% · ${esc(harmony.label)}</strong></div>
          <div class="meter"><span class="${scoreClass(harmony.score)}" style="width:${pct(harmony.score)}%"></span></div>
          ${harmony.pairs
            .map(
              (pr) => `<div class="small"><strong>${esc(pr.a)} + ${esc(pr.b)}</strong>: ${pct(pr.score)}%
              ${pr.shared.map((s) => `<span class="chip good">${esc(s)}</span>`).join('')}</div>`,
            )
            .join('')}
          ${harmony.friction.length ? `<div>${harmony.friction.map((f) => `<span class="chip warn">⚠ ${esc(f)}</span>`).join('')}</div>
            <p class="small muted">We’ll weight picks so nobody gets stuck somewhere they’d hate.</p>` : ''}
        </div>`
      : '';

    const status = state.status
      ? `<div class="notice ${state.status.kind === 'error' ? 'error' : ''}">${esc(state.status.text)}</div>`
      : '';

    $app.innerHTML = `
      <section>
        <h1>${esc(names(group.map((p) => p.name)))}</h1>
        <p class="muted">Here’s your combined taste profile.</p>
      </section>
      <section class="stack">
        ${harmonyHtml}
        <div class="card stack small">
          <h2>Combined profile</h2>
          <div><strong>Craving:</strong> ${tally(combined.cuisines, LABELS.cuisine)}</div>
          <div><strong>Vibe:</strong> ${esc(combined.noise)} · <strong>Wait:</strong> ${esc(LABELS.wait[combined.maxWait] || combined.maxWait + ' min')}
            · <strong>Mood:</strong> ${combined.novelty === 'new' ? 'something new' : combined.novelty === 'mixed' ? 'split: favorites vs. new' : 'favorites'}
            · <strong>Dining as:</strong> ${esc(LABELS.company[combined.occasion] || combined.occasion)}</div>
          <div><strong>Loves:</strong> ${tally(combined.vibes, LABELS.vibe)}</div>
          <div><strong>Dealbreakers (any one rules a place out):</strong> ${tally(combined.dealbreakers, LABELS.dealbreaker)}</div>
        </div>
      </section>
      <section class="card stack">
        <h2>Where are you?</h2>
        <div class="loc-grid">
          <button class="primary block" data-action="use-location">📍 Use my location</button>
          <div class="row" style="flex-wrap:nowrap">
            <input type="text" id="town" placeholder="Or type a city, e.g. Folsom, CA" />
            <button data-action="search-town">Search</button>
          </div>
          <button class="block" data-action="use-demo">Try the demo (Folsom, CA sample data)</button>
        </div>
        ${status}
      </section>
      <section><button class="ghost" data-action="home">← Change who’s eating</button></section>`;
    const town = document.getElementById('town');
    town.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchTown();
    });
  }

  function renderResults() {
    const group = selectedProfiles();
    const { results, excluded } = state.outcome;
    const top = results.slice(0, 10);
    const loc = state.location;
    const estimatedNote = loc.demo
      ? ''
      : `<div class="notice small">Live data from OpenStreetMap. It knows cuisine, venue type and hours, but not cleanliness, service, wait or parking.
         Those show as “unverified” and never trigger a dealbreaker. Worth a quick look before you go.</div>`;

    const card = (res, i) => {
      const r = res.restaurant;
      const price = r.price ? '$'.repeat(r.price) : '';
      const meta = [
        r.cuisine.map((c) => LABELS.cuisine[c] || c).join(', '),
        price,
        r.distanceKm != null ? `${(r.distanceKm * 0.621).toFixed(1)} mi` : '',
        r.waitMinutes != null ? `~${r.waitMinutes} min wait` : '',
      ].filter(Boolean);
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.lat},${r.lon}`)}`;
      const who = (h) => (group.length > 1 ? ` <span class="muted">(${esc(names(h.who))})</span>` : '');
      return `
      <article class="card result">
        <div class="spread">
          <div>
            <span class="rank">#${i + 1}</span> <h3 style="display:inline">${esc(r.name)}</h3>
            <div class="small muted">${esc(meta.join(' · '))}</div>
            ${r.blurb ? `<div class="small">${esc(r.blurb)}</div>` : ''}
          </div>
          <div class="match"><strong>${pct(res.score)}%</strong><span class="small muted">match</span></div>
        </div>
        <ul class="small">
          ${res.highlights.slice(0, 4).map((h) => `<li>✓ ${esc(h.text)}${who(h)}</li>`).join('')}
          ${res.concerns.slice(0, 2).map((h) => `<li style="color:var(--warn)">⚠ ${esc(h.text)}${who(h)}</li>`).join('')}
        </ul>
        ${res.unverified.length ? `<div>${res.unverified.map((u) => `<span class="chip">? ${esc(u)} unverified</span>`).join('')}</div>` : ''}
        ${group.length > 1 ? `<details><summary>How each person feels about it</summary>
          <div class="stack" style="margin-top:8px">${res.members
            .map(
              (m) => `<div class="member-row"><span class="name">${esc(m.name)}</span>
                <div class="meter"><span class="${scoreClass(m.total)}" style="width:${pct(m.total)}%"></span></div>
                <span>${pct(m.total)}%</span></div>`,
            )
            .join('')}</div></details>` : ''}
        <div class="row" style="margin-top:10px">
          <a class="btn small" href="${mapsUrl}" target="_blank" rel="noopener">Directions</a>
          ${r.website ? `<a class="btn small" href="${esc(r.website)}" target="_blank" rel="noopener">Website</a>` : ''}
          <button class="small" data-action="loved" data-rid="${esc(r.id)}">❤️ We loved it</button>
        </div>
      </article>`;
    };

    $app.innerHTML = `
      <section>
        <h1>Top picks for ${esc(names(group.map((p) => p.name)))}</h1>
        <p class="muted">Near ${esc(loc.label)} · ${results.length} good fits, ${excluded.length} ruled out</p>
        ${estimatedNote}
      </section>
      <section>
        ${top.length ? top.map(card).join('') : '<div class="card">Nothing passed everyone’s dealbreakers. Try relaxing a dealbreaker or the wait time, or search a bigger area.</div>'}
      </section>
      ${excluded.length ? `<section class="card">
        <details><summary>Ruled out (${excluded.length})</summary>
          <ul class="small">${excluded
            .slice(0, 40)
            .map((e) => `<li><strong>${esc(e.restaurant.name)}</strong>: ${esc(e.reasons.join('; '))}</li>`)
            .join('')}</ul>
        </details></section>` : ''}
      <section class="row">
        <button data-action="to-group">← Change location</button>
        <button class="ghost" data-action="home">Edit diners</button>
      </section>`;
  }

  function render() {
    ({ home: renderHome, quiz: renderQuiz, done: renderProfileDone, group: renderGroup, results: renderResults })[state.view]();
  }

  // ---------------------------------------------------------------------------
  // Quiz logic
  // ---------------------------------------------------------------------------

  function startQuiz(existing) {
    const answers = existing ? structuredClone(existing) : { cuisines: [], dealbreakers: [], vibes: [] };
    state.quiz = { step: 0, answers, editingId: existing?.id || null };
    go('quiz');
  }

  function answer(rawValue) {
    const q = QUIZ[state.quiz.step];
    const opt = q.options.find((o) => String(o.value) === rawValue);
    if (!opt) return;
    const a = state.quiz.answers;
    if (q.type === 'single') {
      if (state.quiz.advancing) return;
      a[q.id] = opt.value;
      state.quiz.advancing = true;
      render();
      setTimeout(() => {
        // brief visual confirmation before advancing
        if (!state.quiz) return;
        state.quiz.advancing = false;
        quizNext();
      }, 140);
      return;
    }
    let cur = arr(a[q.id]);
    if (cur.includes(opt.value)) cur = cur.filter((v) => v !== opt.value);
    else if (q.exclusive && opt.value === q.exclusive) cur = [opt.value];
    else cur = cur.filter((v) => v !== q.exclusive).concat(opt.value);
    a[q.id] = cur;
    render();
  }

  function quizNext() {
    if (state.view !== 'quiz') return;
    if (state.quiz.step < QUIZ.length - 1) {
      state.quiz.step++;
      render();
    } else {
      finishQuiz();
    }
  }

  function quizBack() {
    if (state.quiz.step === 0) return go('home');
    state.quiz.step--;
    render();
  }

  function finishQuiz() {
    const a = state.quiz.answers;
    const profile = {
      favorites: [],
      visited: [],
      ...a,
      name: a.name.trim(),
      id: state.quiz.editingId || newId(),
      updatedAt: new Date().toISOString(),
    };
    const i = state.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) state.profiles[i] = profile;
    else state.profiles.push(profile);
    state.selected.add(profile.id);
    saveProfiles();
    state.quiz = null;
    state.lastCreatedId = profile.id;
    go('done');
  }

  // ---------------------------------------------------------------------------
  // Location → recommendations
  // ---------------------------------------------------------------------------

  async function findAt(location) {
    state.location = location;
    state.status = { kind: 'loading', text: `Finding places near ${location.label}…` };
    render();
    try {
      let restaurants;
      if (location.demo) {
        restaurants = DEMO.restaurants.map((r) => ({
          ...r,
          distanceKm: Math.round(Places.haversineKm(location.lat, location.lon, r.lat, r.lon) * 10) / 10,
        }));
      } else {
        restaurants = await Places.fetchNearby(location.lat, location.lon);
        if (!restaurants.length) throw new Error('No restaurants found nearby on OpenStreetMap. Try a nearby town or the demo.');
      }
      state.outcome = Match.recommend(restaurants, selectedProfiles(), { now: new Date() });
      state.status = null;
      go('results');
    } catch (err) {
      state.status = { kind: 'error', text: err.message || String(err) };
      render();
    }
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      state.status = { kind: 'error', text: 'Your browser can’t share location. Type a city instead.' };
      return render();
    }
    state.status = { kind: 'loading', text: 'Getting your location…' };
    render();
    navigator.geolocation.getCurrentPosition(
      (pos) => findAt({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'you' }),
      () => {
        state.status = { kind: 'error', text: 'Couldn’t get your location. Type a city instead.' };
        render();
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  async function searchTown() {
    const text = document.getElementById('town')?.value.trim();
    if (!text) return;
    state.status = { kind: 'loading', text: `Looking up ${text}…` };
    render();
    try {
      findAt(await Places.geocode(text));
    } catch (err) {
      state.status = { kind: 'error', text: err.message };
      render();
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  const actions = {
    home: () => {
      state.status = null;
      go('home');
    },
    toggle: (el) => {
      if (el.checked) state.selected.add(el.dataset.id);
      else state.selected.delete(el.dataset.id);
      render();
    },
    'start-quiz': () => startQuiz(null),
    retake: (el) => startQuiz(state.profiles.find((p) => p.id === el.dataset.id)),
    remove: (el) => {
      const p = state.profiles.find((x) => x.id === el.dataset.id);
      if (!p || !confirm(`Remove ${p.name}?`)) return;
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      state.selected.delete(p.id);
      saveProfiles();
      render();
    },
    share: (el) => copyCode(el.dataset.id),
    'copy-code': (el) => copyCode(el.dataset.id),
    'show-import': () => {
      const box = document.getElementById('import');
      box.hidden = !box.hidden;
      if (!box.hidden) document.getElementById('import-code').focus();
    },
    import: () => {
      try {
        const p = fromCode(document.getElementById('import-code').value);
        state.profiles.push(p);
        state.selected.add(p.id);
        saveProfiles();
        toast(`${p.name} joined the table`);
        render();
      } catch (err) {
        toast(err.message);
      }
    },
    answer: (el) => answer(el.dataset.value),
    'quiz-next': quizNext,
    'quiz-back': quizBack,
    'to-group': () => {
      state.status = null;
      go('group');
    },
    'use-location': useMyLocation,
    'search-town': searchTown,
    'use-demo': () => findAt({ ...DEMO.center, demo: true }),
    loved: (el) => {
      const rid = el.dataset.rid;
      for (const p of selectedProfiles()) {
        p.favorites = [...new Set([...arr(p.favorites), rid])];
        p.visited = [...new Set([...arr(p.visited), rid])];
      }
      saveProfiles();
      el.disabled = true;
      el.textContent = '❤️ Saved to favorites';
      toast('Saved. “Stick to favorites” will rank it higher next time.');
    },
  };

  async function copyCode(id) {
    const p = state.profiles.find((x) => x.id === id);
    if (!p) return;
    const code = toCode(p);
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copied ${p.name}’s code`);
    } catch {
      prompt('Copy this code:', code);
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[data-action="toggle"]')) actions.toggle(el);
  });

  render();
})();
