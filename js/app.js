/*
 * Foodie UI. Plain JS, no build step.
 *
 * Flow: Welcome → Create account → Your quiz → Your table (add people: quiz on
 *       this phone or paste their code) → Group (harmony + combined profile +
 *       location) → Results
 *
 * The account and profiles live in localStorage on this device. Friends on
 * other phones share a profile code ("FOODIE1:…") that you paste in, so
 * profiles can be matched without a server.
 */
(function () {
  const { QUIZ, LABELS } = window.FoodieQuiz;
  const Match = window.FoodieMatch;
  const Places = window.FoodiePlaces;
  const REGION = window.FOODIE_REGION;
  // Set by builds that can't reach location or map services (e.g. a sandboxed preview).
  const DEMO_ONLY = !!window.FOODIE_DEMO_ONLY;

  const STORAGE_KEY = 'foodie.profiles.v1';
  const CODE_PREFIX = 'FOODIE1:';
  const $app = document.getElementById('app');

  const state = {
    view: 'welcome',
    profiles: loadProfiles(),
    selected: new Set(),
    quiz: null, // { step, answers, editingId }
    location: null, // { lat, lon, label, demo }
    status: null, // { kind: 'loading'|'error', text }
    outcome: null, // recommend() result
    confirmRemove: null, // profile id (or 'reset') awaiting a second tap
    accountDraft: null,
    shareId: null,
    justFinished: null,
  };
  state.profiles.forEach((p) => state.selected.add(p.id));
  if (state.profiles.some((p) => p.owner)) state.view = 'table';

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
  const owner = () => state.profiles.find((p) => p.owner);
  const homeView = () => (owner() ? 'table' : 'welcome');
  // You're always at your own table; friends are opt-in.
  const selectedProfiles = () => state.profiles.filter((p) => p.owner || state.selected.has(p.id));

  function profileFacts(p) {
    const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    const list = (vals, labels) => arr(vals).map((v) => labels[v] || v).join(', ');
    return [
      row('Craving', list(p.cuisines, LABELS.cuisine)),
      row('Mood', p.novelty === 'new' ? 'Something new' : p.novelty ? 'My favorites' : ''),
      row('Noise', LABELS.noise[p.noise]),
      row('Wait', LABELS.wait[p.maxWait]),
      row('With', LABELS.company[p.diningWith]),
      row('I love', list(p.vibes, LABELS.vibe)),
      row('Dealbreakers', list(p.dealbreakers, LABELS.dealbreaker) || 'None'),
    ].join('');
  }

  function profileChips(p) {
    const chips = [];
    const cuisines = arr(p.cuisines);
    if (p.noise) chips.push(LABELS.noise[p.noise]);
    if (p.novelty) chips.push(p.novelty === 'new' ? 'Something new' : 'Favorites');
    if (p.maxWait != null) chips.push(LABELS.wait[p.maxWait] || `${p.maxWait} min wait`);
    const crave = cuisines.map((c) => `<span class="chip saffron">${esc(LABELS.cuisine[c] || c)}</span>`);
    const deal = arr(p.dealbreakers).map((d) => `<span class="chip bad" title="Dealbreaker">${esc(LABELS.dealbreaker[d] || d)}</span>`);
    return crave.join('') + chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('') + deal.join('');
  }

  function go(view) {
    state.view = view;
    render();
    window.scrollTo({ top: 0 });
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  function renderWelcome() {
    $app.innerHTML = `
      <section class="hero">
        <svg class="setting" viewBox="0 0 220 120" aria-hidden="true">
          <path d="M38 18v30c0 7 5 11 10 11v45M48 18v28M58 18v30c0 7-5 11-10 11" />
          <circle cx="110" cy="62" r="46" /><circle cx="110" cy="62" r="31" />
          <path d="M176 104V20c11 6 14 26 14 40h-14" />
        </svg>
        <h1>Dinner, decided together.</h1>
      </section>
      <div class="actionbar"><button class="primary block" data-action="to-account">Get started</button></div>`;
  }

  function renderAccount() {
    const draft = state.accountDraft || {};
    $app.innerHTML = `
      <form id="account-form" class="stack" novalidate>
        <h1><label for="acct-name">What’s your name?</label></h1>
        <input type="text" id="acct-name" maxlength="40" autocomplete="given-name" placeholder="First name" value="${esc(draft.name || '')}" />
        <p id="acct-error" class="notice error" hidden></p>
        <div class="actionbar">
          <button class="ghost" type="button" data-action="home">← Back</button>
          <button class="primary" type="submit">Continue</button>
        </div>
      </form>`;
    document.getElementById('acct-name').focus();
    document.getElementById('account-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('acct-name').value.trim();
      state.accountDraft = { name };
      if (!name) {
        const error = document.getElementById('acct-error');
        error.textContent = 'Add your first name to continue.';
        error.hidden = false;
        return;
      }
      startQuiz({ id: newId(), owner: true, name, cuisines: [], dealbreakers: [], vibes: [], favorites: [], visited: [] }, { skipName: true, isNew: true });
    });
  }

  function dinerRow(p) {
    return `
      <div class="diner">
        <input type="checkbox" id="sel-${p.id}" data-action="toggle" data-id="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}
          aria-label="${esc(p.name)} is joining" />
        <div class="who">
          <label for="sel-${p.id}"><strong>${esc(p.name)}</strong></label>
          <div>${profileChips(p)}</div>
        </div>
        <div class="actions">
          <button class="ghost small" data-action="retake" data-id="${p.id}">Edit</button>
          <button class="ghost small" data-action="share" data-id="${p.id}">Code</button>
          <button class="ghost small" data-action="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${state.confirmRemove === p.id ? 'Tap to remove' : 'Remove'}</button>
        </div>
      </div>`;
  }

  function renderTable() {
    const me = owner();
    if (!me) return go('welcome');
    const friends = state.profiles.filter((p) => !p.owner);
    const joining = friends.filter((p) => state.selected.has(p.id));
    const fresh = state.justFinished === me.id;
    state.justFinished = null;

    $app.innerHTML = `
      <section class="stack">
        <p class="eyebrow">${fresh ? 'Your taste profile is ready' : 'Welcome back'}</p>
        <h1>${fresh ? `Nice to meet you, ${esc(me.name)}.` : `Hungry, ${esc(me.name)}?`}</h1>
        <div class="card me">
          <div class="spread">
            <h2>Today I’m feeling…</h2>
            <button class="ghost small" data-action="retake" data-id="${me.id}">Update</button>
          </div>
          <dl class="facts">${profileFacts(me)}</dl>
        </div>
      </section>

      <section class="stack">
        <div>
          <h2>Who’s joining you?</h2>
          <p class="muted small">Add the people you’re eating with. We’ll find places that work for everyone.</p>
        </div>
        ${friends.length ? `<div class="card list">${friends.map(dinerRow).join('')}</div>` : ''}
        <div class="add-grid">
          <button data-action="add-here">Add someone here<span class="hint">They take the quiz on this phone</span></button>
          <button data-action="show-import">Paste a friend’s code<span class="hint">From their own phone</span></button>
          ${DEMO_ONLY && !friends.some((p) => p.example) ? `<button data-action="add-examples">Add example friends<span class="hint">To try out group picks</span></button>` : ''}
        </div>
        <div id="import" class="card stack" hidden>
          <label for="import-code"><strong>Paste a friend’s Foodie code</strong></label>
          <textarea id="import-code" rows="3" placeholder="FOODIE1:…"></textarea>
          <div class="row"><button class="primary" data-action="import">Add to the table</button></div>
        </div>
      </section>

      <section class="row">
        <button class="ghost small" data-action="share" data-id="${me.id}">Share my code</button>
        <button class="ghost small" data-action="reset">${state.confirmRemove === 'reset' ? 'Tap again to delete my account' : 'Delete my account'}</button>
      </section>
      <div class="actionbar">
        <button class="primary block" data-action="to-group">
          ${joining.length ? `Find a table for ${joining.length + 1}` : 'Just me. Show my picks'}
        </button>
      </div>`;
  }

  function renderQuiz() {
    const { step, answers, steps } = state.quiz;
    const q = steps[step];
    const value = answers[q.id];
    const progress = `<div class="progress" aria-hidden="true"><span style="width:${pct((step + 1) / steps.length)}%"></span></div>`;
    let body;
    if (q.type === 'text') {
      body = `<input type="text" id="q-text" maxlength="40" placeholder="${esc(q.placeholder)}" value="${esc(value || '')}" autocomplete="given-name" />`;
    } else {
      const isOn = (v) => (q.type === 'multi' ? arr(value).includes(v) : value === v);
      const full = q.type === 'multi' && q.max && arr(value).filter((v) => v !== q.exclusive).length >= q.max;
      const locked = (v) => full && !isOn(v) && v !== q.exclusive;
      body = `<div class="options" role="group" aria-label="${esc(q.prompt)}">
        ${q.options
          .map(
            (o) => `<button class="option" data-action="answer" data-value="${esc(o.value)}" aria-pressed="${isOn(o.value)}" ${locked(o.value) ? 'disabled' : ''}>
              <span class="tick ${q.type === 'multi' ? 'square' : ''}" aria-hidden="true"></span>
              <span>${esc(o.label)}${o.hint ? `<span class="hint">${esc(o.hint)}</span>` : ''}</span>
            </button>`,
          )
          .join('')}
      </div>`;
    }
    const answered = q.type === 'multi' ? arr(value).length > 0 : q.type === 'text' ? !!(value || '').trim() : value !== undefined;
    const showNext = q.type !== 'single';
    const last = step === steps.length - 1;
    $app.innerHTML = `
      ${progress}
      <p class="eyebrow">${state.quiz.owner ? 'Your taste profile' : answers.name ? `${esc(answers.name)}’s taste profile` : 'New diner'} · ${step + 1} of ${steps.length}</p>
      <h1>${esc(q.prompt)}</h1>
      ${q.hint ? `<p class="muted">${esc(q.hint)}</p>` : ''}
      ${body}
      <div class="actionbar quiz-nav">
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

  function renderShare() {
    const p = state.profiles.find((x) => x.id === state.shareId);
    if (!p) return go('table');
    $app.innerHTML = `
      <section class="stack">
        <h1>${p.owner ? 'Your Foodie code' : `${esc(p.name)}’s Foodie code`}</h1>
        <p class="muted">Send this to someone eating with you. They paste it under “Paste a friend’s code” and you’re both on their table.</p>
        <div class="card stack">
          <textarea readonly rows="4" id="share-code">${esc(toCode(p))}</textarea>
          <div class="row"><button class="primary" data-action="copy-code" data-id="${p.id}">Copy code</button></div>
        </div>
        <button class="ghost" data-action="home">← Back to my table</button>
      </section>`;
  }

  function renderGroup() {
    const group = selectedProfiles();
    if (!group.length) return go(homeView());
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
          ${harmony.friction.length ? `<div>${harmony.friction.map((f) => `<span class="chip">${esc(f)}</span>`).join('')}</div>
            <p class="small muted">We’ll find places everyone can enjoy.</p>` : ''}
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
          <div><strong>We’ll skip:</strong> ${tally(combined.dealbreakers, LABELS.dealbreaker)}</div>
        </div>
      </section>
      <section class="card stack">
        <h2>Where are you eating?</h2>
        <div class="loc-grid">
          <button class="primary block" data-action="use-location">Use my location</button>
          <div class="row" style="flex-wrap:nowrap">
            <input type="text" id="town" inputmode="${DEMO_ONLY ? 'numeric' : 'text'}" autocomplete="postal-code"
              placeholder="${DEMO_ONLY ? 'ZIP code, e.g. 95630' : 'ZIP code or city'}" value="${esc(state.lastQuery || '')}" />
            <button data-action="search-town">Go</button>
          </div>
        </div>
        ${status}
      </section>
      <section><button class="ghost" data-action="home">← Change who’s joining</button></section>`;
    const town = document.getElementById('town');
    town?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchTown();
    });
  }

  function renderResults() {
    const group = selectedProfiles();
    const { results, excluded } = state.outcome;
    const top = results.slice(0, 10);
    const loc = state.location;
    const estimatedNote = '<p class="small muted">Good to call ahead for wait times.</p>';

    const card = (res, i) => {
      const r = res.restaurant;
      const price = r.price ? '$'.repeat(r.price) : '';
      const meta = [
        r.cuisine.map((c) => LABELS.cuisine[c] || c).join(', '),
        price,
        r.distanceKm != null ? `${loc.saved ? '~' : ''}${(r.distanceKm * 0.621).toFixed(1)} mi` : '',
        r.waitMinutes != null ? `~${r.waitMinutes} min wait` : '',
      ].filter(Boolean);
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.lat},${r.lon}`)}`;
      const who = (h) =>
        group.length < 2 ? '' : ` <span class="muted">(${h.who.length === group.length ? 'everyone' : esc(names(h.who))})</span>`;
      return `
      <article class="card result">
        <div class="spread">
          <div>
            <span class="rank">#${i + 1}</span> <h3 style="display:inline">${esc(r.name)}</h3>
            <div class="small muted">${esc(meta.join(' · '))}</div>
            ${r.address ? `<div class="small muted">${esc(r.address)}</div>` : ''}
            ${r.blurb ? `<div class="small">${esc(r.blurb)}</div>` : ''}
          </div>
          <div class="match"><strong>${pct(res.score)}%</strong><span class="small muted">match</span></div>
        </div>
        <ul class="small">
          ${res.highlights.slice(0, 4).map((h) => `<li class="plus">${esc(h.text)}${who(h)}</li>`).join('')}
        </ul>
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
          <button class="small" data-action="loved" data-rid="${esc(r.id)}">Save as favorite</button>
        </div>
      </article>`;
    };

    $app.innerHTML = `
      <section>
        <h1>${group.length === 1 ? 'Your top picks' : group.length > 3 ? `Top picks for your table of ${group.length}` : `Top picks for ${esc(names(group.map((p) => p.name)))}`}</h1>
        <p class="muted">Near ${esc(loc.label)} · ${results.length} places to enjoy</p>
        ${estimatedNote}
      </section>
      <section>
        ${top.length ? top.map(card).join('') : '<div class="card">Your table has very particular tastes tonight. Try another ZIP code nearby, or loosen one preference.</div>'}
      </section>
      ${excluded.length ? `<section class="card">
        <details><summary>Saved for another night (${excluded.length})</summary>
          <ul class="small">${excluded
            .slice(0, 40)
            .map((e) => `<li><strong>${esc(e.restaurant.name)}</strong>: ${esc(e.reasons.join('; '))}</li>`)
            .join('')}</ul>
        </details></section>` : ''}
      <section class="row">
        <button data-action="to-group">← Change location</button>
        <button class="ghost" data-action="home">Change who’s joining</button>
      </section>`;
  }

  function render() {
    const views = {
      welcome: renderWelcome,
      account: renderAccount,
      quiz: renderQuiz,
      table: renderTable,
      share: renderShare,
      group: renderGroup,
      results: renderResults,
    };
    views[state.view]();
  }

  // ---------------------------------------------------------------------------
  // Quiz logic
  // ---------------------------------------------------------------------------

  function startQuiz(existing, { skipName = false, isNew = false } = {}) {
    const answers = existing ? structuredClone(existing) : { cuisines: [], dealbreakers: [], vibes: [] };
    const isOwner = !!answers.owner;
    const steps = skipName || isOwner ? QUIZ.filter((q) => q.id !== 'name') : QUIZ;
    state.quiz = { step: 0, steps, answers, owner: isOwner, isNew, editingId: isNew ? null : existing?.id || null };
    go('quiz');
  }

  function answer(rawValue) {
    const q = state.quiz.steps[state.quiz.step];
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
    else {
      cur = cur.filter((v) => v !== q.exclusive);
      if (q.max && cur.length >= q.max) return; // at the limit: unpick one first
      cur = cur.concat(opt.value);
    }
    a[q.id] = cur;
    render();
  }

  function quizNext() {
    if (state.view !== 'quiz') return;
    if (state.quiz.step < state.quiz.steps.length - 1) {
      state.quiz.step++;
      render();
    } else {
      finishQuiz();
    }
  }

  function quizBack() {
    if (state.quiz.step === 0) return go(state.quiz.owner && state.quiz.isNew ? 'account' : homeView());
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
      id: state.quiz.editingId || a.id || newId(),
      updatedAt: new Date().toISOString(),
    };
    const i = state.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) state.profiles[i] = profile;
    else state.profiles.push(profile);
    state.selected.add(profile.id);
    saveProfiles();
    const wasNewOwner = state.quiz.owner && state.quiz.isNew;
    const wasNewFriend = !state.quiz.owner && !state.quiz.editingId;
    state.quiz = null;
    state.accountDraft = null;
    if (wasNewOwner) state.justFinished = profile.id;
    if (wasNewFriend) toast(`${profile.name} is joining you`);
    go('table');
  }

  // ---------------------------------------------------------------------------
  // Location → recommendations
  // ---------------------------------------------------------------------------

  const NEARBY_KM = 16; // about 10 miles
  const MIN_PICKS = 8;

  function regionPlacesNear(location) {
    const withDistance = REGION.restaurants
      .map((r) => ({ ...r, distanceKm: Math.round(Places.haversineKm(location.lat, location.lon, r.lat, r.lon) * 10) / 10 }))
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const close = withDistance.filter((r) => r.distanceKm <= NEARBY_KM);
    return close.length >= MIN_PICKS ? close : withDistance.slice(0, MIN_PICKS * 2);
  }

  const inRegion = (loc) => Places.haversineKm(loc.lat, loc.lon, REGION.center.lat, REGION.center.lon) <= REGION.radiusKm;

  async function findAt(location) {
    state.status = { kind: 'loading', text: `Finding places near ${location.label}…` };
    render();
    try {
      let restaurants = null;
      let saved = false;
      if (!DEMO_ONLY) {
        try {
          restaurants = await Places.fetchNearby(location.lat, location.lon);
        } catch (err) {
          if (!inRegion(location)) throw err;
        }
      }
      if (!restaurants || !restaurants.length) {
        if (!inRegion(location)) {
          throw new Error(`We’re starting with the Sacramento area. Try a ZIP code there, like 95630 or 95816.`);
        }
        restaurants = regionPlacesNear(location);
        saved = true;
      }
      state.location = { ...location, saved };
      state.outcome = Match.recommend(restaurants, selectedProfiles(), { now: new Date() });
      state.status = null;
      go('results');
    } catch (err) {
      state.status = { kind: 'error', text: err.message || String(err) };
      render();
    }
  }

  function useMyLocation() {
    const fallback = () => {
      state.status = { kind: 'error', text: 'We couldn’t find your location here. A ZIP code works just as well.' };
      render();
      document.getElementById('town')?.focus();
    };
    if (!navigator.geolocation) return fallback();
    state.status = { kind: 'loading', text: 'Finding you…' };
    render();
    // Some browsers never answer when the permission prompt is blocked, so don't wait forever.
    let settled = false;
    const once = (fn) => (...args) => {
      if (settled) return;
      settled = true;
      fn(...args);
    };
    setTimeout(once(fallback), 8000);
    navigator.geolocation.getCurrentPosition(
      once((pos) => findAt({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'you' })),
      once(fallback),
      { enableHighAccuracy: false, timeout: 6000, maximumAge: 300000 },
    );
  }

  async function searchTown() {
    const text = document.getElementById('town')?.value.trim();
    if (!text) return;
    state.lastQuery = text;
    const zip = text.match(/^\d{5}$/) ? REGION.zips[text] : null;
    if (zip) return findAt({ lat: zip[0], lon: zip[1], label: `${zip[2]} (${text})` });
    if (DEMO_ONLY) {
      state.status = {
        kind: 'error',
        text: /^\d{5}$/.test(text)
          ? 'We’re starting with the Sacramento area. Try a ZIP code there, like 95630 or 95816.'
          : 'Try a 5-digit ZIP code, like 95630.',
      };
      return render();
    }
    state.status = { kind: 'loading', text: `Looking up ${text}…` };
    render();
    try {
      findAt(await Places.geocode(/^\d{5}$/.test(text) ? `${text}, USA` : text));
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
      go(homeView());
    },
    'to-account': () => go('account'),
    'add-here': () => startQuiz(null),
    'add-examples': () => {
      for (const ex of REGION.sampleDiners || []) {
        const p = { ...structuredClone(ex), id: newId(), example: true };
        state.profiles.push(p);
        state.selected.add(p.id);
      }
      saveProfiles();
      render();
    },
    reset: () => {
      if (state.confirmRemove !== 'reset') {
        state.confirmRemove = 'reset';
        return render();
      }
      state.confirmRemove = null;
      state.profiles = [];
      state.selected.clear();
      saveProfiles();
      go('welcome');
    },
    toggle: (el) => {
      if (el.checked) state.selected.add(el.dataset.id);
      else state.selected.delete(el.dataset.id);
      render();
    },
    retake: (el) => startQuiz(state.profiles.find((p) => p.id === el.dataset.id)),
    remove: (el) => {
      const p = state.profiles.find((x) => x.id === el.dataset.id);
      if (!p) return;
      if (state.confirmRemove !== p.id) {
        state.confirmRemove = p.id;
        return render();
      }
      state.confirmRemove = null;
      state.profiles = state.profiles.filter((x) => x.id !== p.id);
      state.selected.delete(p.id);
      saveProfiles();
      render();
    },
    share: (el) => {
      state.shareId = el.dataset.id;
      go('share');
    },
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
        toast(`${p.name} is joining you`);
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
    loved: (el) => {
      const rid = el.dataset.rid;
      for (const p of selectedProfiles()) {
        p.favorites = [...new Set([...arr(p.favorites), rid])];
        p.visited = [...new Set([...arr(p.visited), rid])];
      }
      saveProfiles();
      el.disabled = true;
      el.textContent = 'Saved to favorites';
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
      const box = document.getElementById('share-code');
      if (box) {
        box.focus();
        box.select();
        toast('Code selected. Copy it with your keyboard or long-press.');
      }
    }
  }

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.tagName === 'INPUT') return;
    if (!['remove', 'reset'].includes(el.dataset.action) && state.confirmRemove) state.confirmRemove = null;
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[data-action="toggle"]')) actions.toggle(el);
  });

  render();
})();
