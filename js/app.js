/*
 * Foodie UI. Plain JS, no build step.
 *
 * Flow: Welcome → Your name → Your quiz → Your table (add people: quiz on
 *       this phone or paste their code) → Group (harmony + combined profile +
 *       location) → Results
 *
 * Your session and profiles live in localStorage on this device. Friends on
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
  const AUTH_KEY = 'foodie.auth.v1'; // prototype sign-in state: email + 2FA flag, never a password
  const HIDDEN_KEY = 'foodie.hidden'; // places swiped away this session
  const PASSED_KEY = 'foodie.passed'; // their cuisines, which lower similar matches this session
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
    auth: loadJSON('localStorage', AUTH_KEY), // null = not chosen yet; {guest: true} or {email, twoFactor}
    hidden: new Set(loadJSON('sessionStorage', HIDDEN_KEY) || []),
    passed: loadJSON('sessionStorage', PASSED_KEY) || {}, // cuisine → swipes this session
    authFlow: null, // { mode: 'login'|'signup', step: 'form'|'code', email, code, twoFactor, next }
  };
  state.profiles.forEach((p) => state.selected.add(p.id));
  if (state.profiles.some((p) => p.owner)) {
    state.view = 'table';
    if (!state.auth) state.auth = { guest: true };
  }

  // ---------------------------------------------------------------------------
  // Storage & share codes
  // ---------------------------------------------------------------------------

  function loadProfiles() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(raw)) return [];
      // Dealbreakers can be retired between versions; drop any we no longer offer.
      return raw.map((p) => ({ ...p, dealbreakers: arr(p.dealbreakers).filter((d) => d in LABELS.dealbreaker) }));
    } catch {
      return [];
    }
  }

  // `store` is 'localStorage' or 'sessionStorage'; touching either can throw in locked-down browsers.
  function loadJSON(store, key) {
    try {
      return JSON.parse(window[store].getItem(key));
    } catch {
      return null;
    }
  }

  function saveJSON(store, key, value) {
    try {
      if (value == null) window[store].removeItem(key);
      else window[store].setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked: keep going for this visit */
    }
  }

  const signedIn = () => !!state.auth?.email;

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
    const profile = normalizeShared(data);
    if (!profile) throw new Error('That code is missing a name.');
    return { ...profile, id: newId() };
  }

  /** Clean up a profile that came from someone else (a code or a nearby diner). */
  function normalizeShared(data) {
    if (!data || typeof data.name !== 'string' || !data.name.trim()) return null;
    const pick = (v, allowed) => (allowed.includes(v) ? v : undefined);
    return {
      name: data.name.trim().slice(0, 40),
      cuisines: arr(data.cuisines).slice(0, 3),
      novelty: pick(data.novelty, ['favorites', 'new']),
      noise: pick(data.noise, ['quiet', 'buzz', 'high']),
      dealbreakers: arr(data.dealbreakers).filter((d) => d in LABELS.dealbreaker).slice(0, 2),
      maxWait: Number.isFinite(data.maxWait) ? data.maxWait : undefined,
      diningWith: pick(data.diningWith, ['solo', 'partner', 'friends', 'family', 'coworkers']),
      vibes: arr(data.vibes).slice(0, 2),
      favorites: arr(data.favorites).slice(0, 50),
      visited: [],
    };
  }

  const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
  const newId = () => 'p-' + Math.random().toString(36).slice(2, 10);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function toast(text, action) {
    const el = document.getElementById('toast');
    el.innerHTML = `<span>${esc(text)}</span>${action ? `<button class="toast-btn" data-action="toast-action">${esc(action.label)}</button>` : ''}`;
    toast.action = action?.run || null;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (el.hidden = true), action ? 5000 : 2400);
  }

  const pct = (x) => Math.round(x * 100);
  const VENUE_WORD = { restaurant: 'Sit-down', casual: 'Casual', cafe: 'Café', pub: 'Pub' };
  const scoreClass = (x) => (x >= 0.7 ? 'score-good' : x >= 0.5 ? 'score-ok' : 'score-bad');
  const names = (list) => (list.length <= 2 ? list.join(' & ') : `${list.slice(0, -1).join(', ')} & ${list.at(-1)}`);
  const owner = () => state.profiles.find((p) => p.owner);
  const homeView = () => (owner() ? 'table' : 'welcome');
  // You're always at your own table; friends are opt-in.
  const selectedProfiles = () => state.profiles.filter((p) => p.owner || state.selected.has(p.id));

  function profileFacts(p) {
    const row = (k, v) => (v ? `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>` : '');
    const list = (vals, labels) => arr(vals).map((v) => labels[v] || v).join(', ');
    const usual = Match.topGenres(p);
    const craving = list(p.cuisines, LABELS.cuisine);
    // Today's craving counts once in history; "something different" means it hasn't been picked before.
    const counts = p.history?.cuisines || {};
    const fresh = (p.history?.sessions || 0) > 1 && arr(p.cuisines).some((c) => c !== 'any' && (counts[c] || 0) <= 1);
    return [
      row('Craving', craving && fresh ? `${craving} (something different)` : craving),
      row('Near', p.zip ? `${zipTown(p.zip)} (${p.zip})` : ''),
      row('Mood', p.novelty === 'new' ? 'Something new' : p.novelty ? 'My favorites' : ''),
      row('Noise', LABELS.noise[p.noise]),
      row('Wait', LABELS.wait[p.maxWait]),
      row('With', LABELS.company[p.diningWith]),
      row('I love', list(p.vibes, LABELS.vibe)),
      row('Dealbreakers', list(p.dealbreakers, LABELS.dealbreaker) || 'None'),
      row('Usually', usual.map((c) => LABELS.cuisine[c] || c).join(', ')),
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
      <div class="actionbar stacked">
        <button class="primary block" data-action="auth-start" data-mode="signup">Log in or create account</button>
        <button class="ghost block" data-action="continue-guest">Continue as guest</button>
      </div>`;
  }

  // Login / create account / two-factor: a clickable PROTOTYPE for user testing.
  // Nothing is sent anywhere and passwords are never stored or read back.
  function renderAuth() {
    const f = state.authFlow;
    const badge = '<p class="proto">Prototype · nothing is saved or sent</p>';
    if (f.step === 'code') {
      $app.innerHTML = `
        <form id="code-form" class="stack" novalidate>
          ${badge}
          <h1><label for="auth-code">${f.mode === 'signup' ? 'Set up two-factor' : 'Enter your code'}</label></h1>
          <p class="muted">${f.mode === 'signup' ? 'Add Foodie to your authenticator app, then enter the 6-digit code.' : 'Open your authenticator app and enter the 6-digit code.'}</p>
          <p class="testcode">Test code: <strong>${f.code}</strong></p>
          <input type="text" id="auth-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
          <p id="auth-error" class="notice error" hidden></p>
          <div class="actionbar">
            <button class="ghost" type="button" data-action="auth-back">← Back</button>
            <button class="primary" type="submit">Verify</button>
          </div>
        </form>`;
      document.getElementById('auth-code').focus();
      document.getElementById('code-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const typed = document.getElementById('auth-code').value.trim();
        if (typed !== f.code) {
          const err = document.getElementById('auth-error');
          err.textContent = 'That code doesn’t match. Try the test code above.';
          err.hidden = false;
          return;
        }
        finishAuth();
      });
      return;
    }
    const signup = f.mode === 'signup';
    $app.innerHTML = `
      <form id="auth-form" class="stack" novalidate>
        ${badge}
        <div class="tabs" role="tablist">
          <button type="button" role="tab" aria-selected="${!signup}" data-action="auth-mode" data-mode="login">Log in</button>
          <button type="button" role="tab" aria-selected="${signup}" data-action="auth-mode" data-mode="signup">Create account</button>
        </div>
        <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
        <div class="field"><label for="auth-email">Email</label>
          <input type="email" id="auth-email" autocomplete="username" value="${esc(f.email || '')}" /></div>
        <div class="field"><label for="auth-pass">Password</label>
          <input type="password" id="auth-pass" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="Use a test password" /></div>
        ${signup ? `<label class="check"><input type="checkbox" id="auth-2fa" ${f.twoFactor !== false ? 'checked' : ''} /> Turn on two-factor authentication</label>` : ''}
        <p id="auth-error" class="notice error" hidden></p>
        <div class="actionbar">
          <button class="ghost" type="button" data-action="auth-cancel">← Back</button>
          <button class="primary" type="submit">${signup ? 'Create account' : 'Log in'}</button>
        </div>
      </form>`;
    document.getElementById('auth-email').focus();
    document.getElementById('auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const pass = document.getElementById('auth-pass');
      const err = document.getElementById('auth-error');
      const fail = (msg) => {
        err.textContent = msg;
        err.hidden = false;
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Add an email address to continue.');
      if (pass.value.length < 8) return fail('Use at least 8 characters.');
      pass.value = ''; // the prototype never keeps a password
      f.email = email;
      f.twoFactor = signup ? document.getElementById('auth-2fa').checked : state.auth?.twoFactor ?? true;
      if (f.twoFactor) {
        f.code = String(Math.floor(100000 + Math.random() * 900000));
        f.step = 'code';
        return render();
      }
      finishAuth();
    });
  }

  function startAuth(mode, next) {
    state.authFlow = { mode, step: 'form', email: '', twoFactor: true, next };
    go('auth');
  }

  function finishAuth() {
    const f = state.authFlow;
    state.auth = { email: f.email, twoFactor: f.twoFactor, prototype: true };
    saveJSON('localStorage', AUTH_KEY, state.auth);
    state.authFlow = null;
    toast(f.twoFactor ? 'Signed in with two-factor on' : 'Signed in');
    if (f.next) return f.next();
    go(owner() ? 'table' : 'account');
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

  const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L10 14.6l-5.1 2.8 1.1-5.7L1.8 7.8l5.7-.7z"/></svg>';

  function favoritesCard(me) {
    if (!signedIn()) {
      return `<section class="card stack">
        <h2>Your favorites</h2>
        <p class="small muted">Log in to save places and rate them.</p>
        <div><button class="small" data-action="auth-start" data-mode="login">Log in</button></div>
      </section>`;
    }
    const saved = me.saved || {};
    const ids = arr(me.favorites).filter((id) => saved[id]);
    if (!ids.length) {
      return `<section class="card stack"><h2>Your favorites</h2>
        <p class="small muted">Tap Save on a pick and it shows up here to rate.</p></section>`;
    }
    const stars = (id) => {
      const current = (me.ratings || {})[id] || 0;
      return `<div class="stars" role="group" aria-label="Rate ${esc(saved[id].name)}">${[1, 2, 3, 4, 5]
        .map((n) => `<button class="star ${n <= current ? 'on' : ''}" data-action="rate" data-rid="${esc(id)}" data-stars="${n}"
          aria-label="${n} of 5" aria-pressed="${n === current}">${STAR}</button>`)
        .join('')}</div>`;
    };
    return `<section class="card stack">
      <h2>Your favorites</h2>
      <div class="favs">${ids
        .map((id) => `<div class="fav">
          <div class="who"><strong>${esc(saved[id].name)}</strong>
            <div class="small muted">${esc([saved[id].cuisine.map((c) => LABELS.cuisine[c] || c).join(', '), saved[id].town].filter(Boolean).join(' · '))}</div></div>
          ${stars(id)}
          <button class="ghost small" data-action="unfavorite" data-rid="${esc(id)}" aria-label="Remove ${esc(saved[id].name)}">Remove</button>
        </div>`)
        .join('')}</div>
      <p class="small muted">Your ratings shape future picks.</p>
    </section>`;
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

      ${favoritesCard(me)}
      <section class="stack">
        <div>
          <h2>Who’s joining you?</h2>
        </div>
        ${friends.length ? `<div class="card list">${friends.map(dinerRow).join('')}</div>` : ''}
        <div id="nearby" class="stack" hidden></div>
        <div class="add-grid">
          <button data-action="add-here">Add someone here<span class="hint">They take the quiz on this phone</span></button>
          <button data-action="show-import">Paste a friend’s code<span class="hint">From their own phone</span></button>
        </div>
        <div id="import" class="card stack" hidden>
          <label for="import-code"><strong>Paste a friend’s Foodie code</strong></label>
          <textarea id="import-code" rows="3" placeholder="FOODIE1:…"></textarea>
          <div class="row"><button class="primary" data-action="import">Add to the table</button></div>
        </div>
      </section>

      <section class="row">
        ${signedIn()
          ? `<span class="small muted">${esc(state.auth.email)}${state.auth.twoFactor ? ' · 2FA on' : ''}</span>
             <button class="ghost small" data-action="log-out">Log out</button>`
          : `<button class="ghost small" data-action="auth-start" data-mode="login">Log in to save favorites</button>`}
        <button class="ghost small" data-action="share" data-id="${me.id}">Share my code</button>
        <button class="ghost small" data-action="reset">${state.confirmRemove === 'reset' ? 'Tap again to delete session' : 'Delete session'}</button>
      </section>
      <div class="actionbar">
        <button class="primary block" data-action="to-group">
          ${joining.length ? `Find a table for ${joining.length + 1}` : 'Just me. Show my picks'}
        </button>
      </div>`;
    renderNearby();
  }

  function renderQuiz() {
    const { step, answers, steps } = state.quiz;
    const q = steps[step];
    const value = answers[q.id];
    const progress = `<div class="progress" aria-hidden="true"><span style="width:${pct((step + 1) / steps.length)}%"></span></div>`;
    let body;
    if (q.type === 'text' || q.type === 'zip') {
      const zip = q.type === 'zip';
      body = `<input type="text" id="q-text" maxlength="${zip ? 5 : 40}" placeholder="${esc(q.placeholder)}" value="${esc(value || '')}"
        ${zip ? 'inputmode="numeric" autocomplete="postal-code"' : 'autocomplete="given-name"'} />
        ${zip ? `<p id="zip-note" class="small muted" ${zipValid(value) || !value ? 'hidden' : ''}>${esc(zipNote(value))}</p>` : ''}`;
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
    const answered =
      q.type === 'multi' ? arr(value).length > 0
        : q.type === 'zip' ? zipValid(value)
          : q.type === 'text' ? !!(value || '').trim()
            : value !== undefined;
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
    if (q.type === 'text' || q.type === 'zip') {
      const input = document.getElementById('q-text');
      const ok = () => (q.type === 'zip' ? zipValid(input.value) : !!input.value.trim());
      input.focus();
      input.addEventListener('input', () => {
        answers[q.id] = input.value.trim();
        $app.querySelector('[data-action="quiz-next"]').disabled = !ok();
        const note = document.getElementById('zip-note');
        if (note) {
          note.hidden = ok() || input.value.trim().length < 5;
          note.textContent = zipNote(input.value);
        }
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && ok()) quizNext();
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
      ${status}
      <section><button class="ghost" data-action="home">← Change who’s joining</button></section>
      <div class="actionbar"><button class="primary block" data-action="see-picks">See picks</button></div>`;
  }

  function renderResults() {
    const group = selectedProfiles();
    const { results, excluded } = state.outcome;
    const visible = results.filter((r) => !state.hidden.has(r.restaurant.id));
    const top = visible.slice(0, 10);
    const loc = state.location;
    const estimatedNote = '';

    const card = (res, i) => {
      const r = res.restaurant;
      const price = r.price ? '$'.repeat(r.price) : '';
      const meta = [
        VENUE_WORD[r.venue] || '',
        r.cuisine.map((c) => LABELS.cuisine[c] || c).join(', '),
        price,
        r.distanceKm != null ? `${loc.saved ? '~' : ''}${(r.distanceKm * 0.621).toFixed(1)} mi` : '',
        r.waitMinutes != null ? `~${r.waitMinutes} min wait` : '',
      ].filter(Boolean);
      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.lat},${r.lon}`)}`;
      const who = (h) =>
        group.length < 2 ? '' : ` <span class="muted">(${h.who.length === group.length ? 'everyone' : esc(names(h.who))})</span>`;
      return `
      <article class="card result swipe" tabindex="0" data-rid="${esc(r.id)}" aria-label="${esc(r.name)}. Swipe or press Delete to hide.">
        ${r.photo?.verified && r.photo.url ? `<figure class="photo"><img src="${esc(r.photo.url)}" alt="${esc(r.name)}" loading="lazy" /><figcaption>${esc(r.photo.credit || '')}</figcaption></figure>` : ''}
        <div class="spread">
          <div>
            <span class="rank">#${i + 1}</span> <h3 style="display:inline">${esc(r.name)}</h3>
            <div class="small muted">${esc(meta.join(' · '))}</div>
            ${r.address ? `<div class="small muted">${esc(r.address)}</div>` : ''}
            ${r.blurb ? `<div class="small">${esc(r.blurb)}</div>` : ''}
          </div>
          <div class="match"><strong>${pct(res.score)}%</strong><span class="small muted">match</span></div>
        </div>
        ${res.highlights.length ? `<ul class="why">${res.highlights.slice(0, 3).map((h) => `<li>${esc(h.text)}${who(h)}</li>`).join('')}</ul>` : ''}
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
          <button class="small" data-action="loved" data-rid="${esc(r.id)}">${signedIn() && arr(owner()?.favorites).includes(r.id) ? 'Saved' : 'Save as favorite'}</button>
        </div>
      </article>`;
    };

    $app.innerHTML = `
      <section>
        <h1>${group.length === 1 ? 'Your top picks' : group.length > 3 ? `Top picks for your table of ${group.length}` : `Top picks for ${esc(names(group.map((p) => p.name)))}`}</h1>
        <p class="muted">Near ${esc(loc.label)} · ${visible.length} places to enjoy</p>
        ${estimatedNote}
        <p class="small muted">Swipe a card away to hide it for this session.${state.hidden.size ? ` <button class="linkish" data-action="unhide">Show ${state.hidden.size} hidden</button>` : ''}</p>
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
        <button class="ghost" data-action="home">← Change who’s joining</button>
      </section>`;
  }

  function render() {
    const views = {
      welcome: renderWelcome,
      account: renderAccount,
      auth: renderAuth,
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

  // ZIP codes: the saved Sacramento list in previews; any 5-digit US ZIP in the full app.
  const zipValid = (v) => /^\d{5}$/.test(v || '') && (!DEMO_ONLY || !!REGION.zips[v]);
  const zipNote = (v) => (/^\d{5}$/.test(v || '') ? 'We’re starting with the Sacramento area. Try 95630 or 95816.' : '');
  const zipTown = (zip) => (REGION.zips[zip] ? REGION.zips[zip][2] : zip);

  function startQuiz(existing, { skipName = false, isNew = false } = {}) {
    const answers = existing ? structuredClone(existing) : { cuisines: [], dealbreakers: [], vibes: [] };
    const isOwner = !!answers.owner;
    const steps = QUIZ.filter((q) => (q.id !== 'name' || !(skipName || isOwner)) && (!q.ownerOnly || isOwner));
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
    if (profile.owner) {
      // Track top genres over time. Today's craving still wins in matching; history only
      // steers "Surprise me" days.
      const counts = { ...(profile.history?.cuisines || {}) };
      for (const c of arr(profile.cuisines)) if (c !== 'any') counts[c] = (counts[c] || 0) + 1;
      profile.history = { cuisines: counts, sessions: (profile.history?.sessions || 0) + 1 };
      if (profile.zip) state.myTown = zipTown(profile.zip);
    }
    const i = state.profiles.findIndex((p) => p.id === profile.id);
    if (i >= 0) state.profiles[i] = profile;
    else state.profiles.push(profile);
    state.selected.add(profile.id);
    saveProfiles();
    const wasNewOwner = state.quiz.owner && state.quiz.isNew;
    const wasNewFriend = !state.quiz.owner && !state.quiz.editingId;
    state.quiz = null;
    state.accountDraft = null;
    syncPresence();
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
      state.lastRestaurants = restaurants;
      rescore();
      state.status = null;
      go('results');
    } catch (err) {
      state.status = { kind: 'error', text: err.message || String(err) };
      go('group');
    }
  }

  function rescore() {
    state.outcome = Match.recommend(state.lastRestaurants || [], selectedProfiles(), { now: new Date(), passedCuisines: state.passed });
  }

  function zipLocation(zip) {
    const [lat, lon, town] = REGION.zips[zip];
    state.myTown = town;
    syncPresence();
    return { lat, lon, label: `${town} (${zip})` };
  }

  /** Picks always use the ZIP from your quiz. No ZIP yet (an older profile): ask that one question. */
  async function seePicks() {
    const me = owner();
    const zip = me?.zip;
    if (zip && REGION.zips[zip]) return findAt(zipLocation(zip));
    if (zip && !DEMO_ONLY) {
      try {
        return findAt({ ...(await Places.geocode(`${zip}, USA`)), label: zip });
      } catch (err) {
        state.status = { kind: 'error', text: err.message };
        return go('group');
      }
    }
    startQuiz(me);
    state.quiz.step = state.quiz.steps.length - 1;
    render();
  }


  // ---------------------------------------------------------------------------
  // Nearby with the app open (live presence, where the host offers a shared room)
  // ---------------------------------------------------------------------------

  const live = { room: null, peers: [] };

  // What others see: your first name, taste answers and last ZIP town. Never coordinates.
  function myPresence() {
    const me = owner();
    if (!me) return { profile: null, town: null };
    const { favorites, ...profile } = Object.fromEntries(SHARE_FIELDS.map((k) => [k, me[k] ?? null]));
    return { profile, town: state.myTown || null };
  }

  function syncPresence() {
    live.room?.presence(myPresence()).catch(() => {});
  }

  async function connectRoom() {
    if (!window.claude?.use) return; // running as a plain web page: no shared room
    const room = await window.claude.use('room').catch(() => null);
    if (!room) return;
    live.room = room;
    syncPresence();
    room.onPeers(
      ({ peers }) => {
        live.peers = peers
          .filter((p) => !p.isMe && p.kind === 'viewer')
          .map((p) => ({ peer: p.peer, town: typeof p.presence?.town === 'string' ? p.presence.town.slice(0, 40) : null, profile: normalizeShared(p.presence?.profile) }))
          .filter((p) => p.profile);
        refreshLinkedFriends();
        renderNearby();
      },
      () => {
        live.room = null;
        live.peers = [];
        renderNearby();
      },
    );
  }

  /** Keep added nearby diners current if they update their answers. */
  function refreshLinkedFriends() {
    let changed = false;
    for (const p of live.peers) {
      const friend = state.profiles.find((f) => f.peer === p.peer);
      if (!friend) continue;
      const next = { ...friend, ...p.profile, id: friend.id, peer: p.peer, favorites: friend.favorites, visited: friend.visited };
      if (JSON.stringify(next) !== JSON.stringify(friend)) {
        Object.assign(friend, next);
        changed = true;
      }
    }
    if (changed) {
      saveProfiles();
      if (state.view === 'table') render();
    }
  }

  function renderNearby() {
    const el = document.getElementById('nearby');
    if (!el) return;
    const examples = exampleNearby();
    if ((!live.room && !examples.length) || !owner()) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const myTown = state.myTown;
    const byTown = (a, b) => (b.town === myTown) - (a.town === myTown) || a.profile.name.localeCompare(b.profile.name);
    const peers = [...[...live.peers].sort(byTown), ...examples];
    const row = (p) => {
      const added = state.profiles.some((f) => f.peer === p.peer);
      return `
        <div class="diner">
          <span class="dot" aria-hidden="true"></span>
          <div class="who">
            <strong>${esc(p.profile.name)}</strong>${p.town ? ` <span class="small muted">· ${esc(p.town)}</span>` : ''}
            <div>${profileChips(p.profile)}</div>
          </div>
          ${added
            ? '<span class="small muted joined">Joining</span>'
            : `<button class="small" data-action="add-nearby" data-peer="${esc(p.peer)}">Add</button>`}
        </div>`;
    };
    el.innerHTML = `
      <h3 class="eyebrow">Nearby with the app open</h3>
      ${peers.length
        ? `<div class="card list">${peers.map(row).join('')}</div>`
        : '<p class="small muted">No one else here yet. Share Foodie and they’ll show up.</p>'}`;
  }

  /** Example test users shown under Nearby in previews, so group picks can be tried alone. */
  function exampleNearby() {
    if (!DEMO_ONLY) return [];
    return (REGION.testUsers || []).map((t) => ({ peer: t.peer, town: t.town, example: true, profile: normalizeShared(t.profile) }));
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
    'continue-guest': () => {
      state.auth = { guest: true };
      saveJSON('localStorage', AUTH_KEY, state.auth);
      go('account');
    },
    'auth-start': (el) => startAuth(el.dataset.mode, owner() ? () => go(state.returnView || 'table') : null),
    'auth-mode': (el) => {
      state.authFlow.mode = el.dataset.mode;
      render();
    },
    'auth-back': () => {
      state.authFlow.step = 'form';
      render();
    },
    'auth-cancel': () => {
      state.authFlow = null;
      go(owner() ? 'table' : 'welcome');
    },
    'log-out': () => {
      state.auth = { guest: true };
      saveJSON('localStorage', AUTH_KEY, state.auth);
      toast('Logged out');
      render();
    },
    rate: (el) => {
      const me = owner();
      if (!me) return;
      const stars = Number(el.dataset.stars);
      me.ratings = { ...(me.ratings || {}), [el.dataset.rid]: stars };
      saveProfiles();
      render();
    },
    unfavorite: (el) => {
      const me = owner();
      if (!me) return;
      const rid = el.dataset.rid;
      me.favorites = arr(me.favorites).filter((x) => x !== rid);
      const { [rid]: _, ...rest } = me.saved || {};
      me.saved = rest;
      saveProfiles();
      render();
    },
    'toast-action': () => {
      document.getElementById('toast').hidden = true;
      toast.action?.();
    },
    unhide: () => {
      state.hidden.clear();
      state.passed = {};
      saveJSON('sessionStorage', HIDDEN_KEY, null);
      saveJSON('sessionStorage', PASSED_KEY, null);
      rescore();
      render();
    },
    'add-here': () => startQuiz(null),
    'add-nearby': (el) => {
      const p = [...live.peers, ...exampleNearby()].find((x) => x.peer === el.dataset.peer);
      if (!p || state.profiles.some((f) => f.peer === p.peer)) return;
      const friend = { ...p.profile, id: newId(), peer: p.peer };
      state.profiles.push(friend);
      state.selected.add(friend.id);
      saveProfiles();
      toast(`${friend.name} is joining you`);
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
      state.auth = null;
      state.hidden.clear();
      state.passed = {};
      saveJSON('localStorage', AUTH_KEY, null);
      saveJSON('sessionStorage', HIDDEN_KEY, null);
      saveJSON('sessionStorage', PASSED_KEY, null);
      saveProfiles();
      syncPresence();
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
      if (selectedProfiles().length > 1) return go('group');
      seePicks();
    },
    'see-picks': () => seePicks(),
    loved: (el) => {
      const rid = el.dataset.rid;
      if (!signedIn()) {
        toast('Log in or create an account to save favorites.', {
          label: 'Log in',
          run: () => {
            state.returnView = 'results';
            startAuth('login', () => go('results'));
          },
        });
        return;
      }
      for (const p of selectedProfiles()) {
        p.favorites = [...new Set([...arr(p.favorites), rid])];
        p.visited = [...new Set([...arr(p.visited), rid])];
      }
      const r = (state.lastRestaurants || []).find((x) => x.id === rid);
      const me = owner();
      if (r && me) me.saved = { ...(me.saved || {}), [rid]: { name: r.name, town: r.town || '', cuisine: arr(r.cuisine) } };
      saveProfiles();
      el.disabled = true;
      el.textContent = 'Saved';
      toast('Saved to your favorites. Rate it from your profile.');
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

  // Swipe a result card left or right to hide it for this session.
  function hidePlace(card, direction) {
    const rid = card.dataset.rid;
    const name = card.getAttribute('aria-label').split('.')[0];
    card.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
    card.style.transform = `translateX(${direction * 110}%)`;
    card.style.opacity = '0';
    const cuisines = arr((state.lastRestaurants || []).find((r) => r.id === rid)?.cuisine);
    const savePass = () => {
      saveJSON('sessionStorage', HIDDEN_KEY, [...state.hidden]);
      saveJSON('sessionStorage', PASSED_KEY, state.passed);
      rescore();
      render();
    };
    setTimeout(() => {
      state.hidden.add(rid);
      for (const c of cuisines) state.passed[c] = (state.passed[c] || 0) + 1;
      savePass();
      toast(`${name} hidden. Similar places rank a little lower.`, {
        label: 'Undo',
        run: () => {
          state.hidden.delete(rid);
          for (const c of cuisines) if (state.passed[c]) state.passed[c] -= 1;
          savePass();
        },
      });
    }, 200);
  }

  let drag = null;
  document.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.swipe');
    if (!card || e.target.closest('button, a, summary, input')) return;
    drag = { card, x: e.clientX, y: e.clientY, dx: 0, active: false };
  });
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    drag.dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.active && Math.abs(drag.dx) > 12 && Math.abs(drag.dx) > Math.abs(dy)) drag.active = true;
    if (!drag.active) return;
    drag.card.style.transition = 'none';
    drag.card.style.transform = `translateX(${drag.dx}px) rotate(${drag.dx / 40}deg)`;
    drag.card.style.opacity = String(Math.max(0.3, 1 - Math.abs(drag.dx) / 300));
  });
  const endDrag = () => {
    if (!drag) return;
    const { card, dx, active } = drag;
    drag = null;
    if (!active) return;
    if (Math.abs(dx) > Math.min(120, card.offsetWidth * 0.3)) return hidePlace(card, Math.sign(dx));
    card.style.transition = 'transform 0.2s ease, opacity 0.2s ease';
    card.style.transform = '';
    card.style.opacity = '';
  };
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  document.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.swipe');
    if (card && e.target === card && (e.key === 'Delete' || e.key === 'Backspace')) hidePlace(card, 1);
  });

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
  connectRoom();
})();
