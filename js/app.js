/*
 * FoodieMatch UI. Plain JS, no build step.
 *
 * Flow: Welcome → Your name → Your quiz → Your table (add people: quiz on
 *       this phone or paste their code) → Group (harmony + combined profile +
 *       location) → Results
 *
 * Your session and profiles live in localStorage on this device. Friends on
 * other phones share a 6-digit code, looked up in the artifact's shared store,
 * or, where there's no store, a long self-contained code ("FOODIE1:…").
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
  const GUEST_KEY = 'foodie.guest.v1'; // "continue as guest", for this tab only
  const GUEST_CODE_HOURS = 12; // a guest's code stops working after this
  const HIDDEN_KEY = 'foodie.hidden'; // places swiped away this session
  const QUIZ_KEY = 'foodie.quizdraft.v1'; // quiz answers in progress, so nothing is lost mid-quiz
  const PASSED_KEY = 'foodie.passed'; // their cuisines, which lower similar matches this session
  const CODE_PREFIX = 'FOODIE1:';
  const $app = document.getElementById('app');

  const state = {
    view: 'welcome',
    profiles: [], // loaded below, from this account's storage or this tab's guest session
    selected: new Set(),
    quiz: null, // { step, answers, editingId }
    location: null, // { lat, lon, label, demo }
    status: null, // { kind: 'loading'|'error', text }
    outcome: null, // recommend() result
    confirmRemove: null, // profile id (or 'reset') awaiting a second tap
    accountDraft: null,
    shareId: null,
    justFinished: null,
    // Accounts stay logged in on this device; guests last only as long as this tab.
    auth: (() => {
      const saved = loadJSON('localStorage', AUTH_KEY);
      return saved?.email ? saved : loadJSON('sessionStorage', GUEST_KEY);
    })(),
    hidden: new Set(loadJSON('sessionStorage', HIDDEN_KEY) || []),
    passed: loadJSON('sessionStorage', PASSED_KEY) || {}, // cuisine → swipes this session
    authFlow: null, // { mode: 'login'|'signup', step: 'form'|'code', email, code, twoFactor, next }
  };
  // Older versions kept every profile on the device, logged in or not. Move an account's
  // profile under its account; drop anything left over from guests.
  (() => {
    let legacy = null;
    try {
      legacy = JSON.parse(localStorage.getItem(STORAGE_KEY));
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(QUIZ_KEY);
    } catch {
      /* storage blocked */
    }
    if (state.auth?.email && Array.isArray(legacy) && !loadJSON('localStorage', profileKey())) {
      saveJSON('localStorage', profileKey(), legacy);
    }
  })();
  state.profiles = loadProfiles();
  state.profiles.forEach((p) => state.selected.add(p.id));
  if (state.profiles.some((p) => p.owner)) state.view = 'table';
  // Pick up a quiz that was in progress (after a reload, or coming back later).
  (() => {
    const draft = loadJSON(profileStore(), quizKey());
    if (!draft || !Array.isArray(draft.stepIds) || !draft.answers) return;
    const steps = draft.stepIds.map((id) => QUIZ.find((q) => q.id === id)).filter(Boolean);
    if (!steps.length) return;
    const { stepIds, ...rest } = draft;
    state.quiz = { ...rest, steps, step: Math.min(Math.max(0, draft.step | 0), steps.length - 1), resumed: true };
    state.view = 'quiz';
  })();

  // ---------------------------------------------------------------------------
  // Storage & share codes
  // ---------------------------------------------------------------------------

  // Where this person's data lives: under their account on this device, or (guests) this tab only.
  function profileStore() {
    return state?.auth?.email ? 'localStorage' : 'sessionStorage';
  }
  function profileKey() {
    return state?.auth?.email ? `${STORAGE_KEY}:${state.auth.email.toLowerCase()}` : `${STORAGE_KEY}:guest`;
  }
  function quizKey() {
    return state?.auth?.email ? `${QUIZ_KEY}:${state.auth.email.toLowerCase()}` : `${QUIZ_KEY}:guest`;
  }

  function loadProfiles() {
    try {
      const raw = loadJSON(profileStore(), profileKey());
      if (!Array.isArray(raw)) return [];
      // Dealbreakers can be retired between versions; drop any we no longer offer.
      // (Runs before the helpers below exist, so no arr() here.)
      return raw.map((p) => ({
        ...p,
        dealbreakers: (Array.isArray(p.dealbreakers) ? p.dealbreakers : []).filter((d) => typeof d === 'string' && d in LABELS.dealbreaker),
      }));
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

  /** Returns false when storage refused the write (full, or blocked). */
  function saveProfiles() {
    try {
      window[profileStore()].setItem(profileKey(), JSON.stringify(state.profiles));
      return true;
    } catch {
      return false; // private mode etc.: app still works for this session
    }
  }

  const SHARE_FIELDS = ['name', 'cuisines', 'novelty', 'noise', 'dealbreakers', 'maxWait', 'diningWith', 'vibes', 'favorites'];

  function toCode(p) {
    const data = Object.fromEntries(SHARE_FIELDS.map((k) => [k, p[k]]));
    return CODE_PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  }

  function fromCode(code) {
    const trimmed = code.trim();
    if (!trimmed.startsWith(CODE_PREFIX)) throw new Error('That doesn’t look like a FoodieMatch code.');
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
      row('Mood', !signedIn() ? '' : p.novelty === 'new' ? 'Something new' : p.novelty ? 'My favorites' : ''),
      row('Noise', LABELS.noise[p.noise]),
      row('Wait', LABELS.wait[p.maxWait]),
      row('With', LABELS.company[p.diningWith]),
      row('I love', list(p.vibes, LABELS.vibe)),
      row('Dealbreakers', list(p.dealbreakers, LABELS.dealbreaker) || 'None'),
      row('Usually', usual.map((c) => LABELS.cuisine[c] || c).join(', ')),
    ].join('');
  }

  /** One short line: cravings and noise, e.g. "Mexican, Italian · High energy". */
  function profileSummary(p) {
    const cravings = arr(p.cuisines).map((c) => LABELS.cuisine[c] || c).join(', ');
    return [cravings, LABELS.noise[p.noise]].filter(Boolean).join(' · ');
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
    if (view !== 'table') state.justFinished = null;
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
        <h1>Many cravings. One table.</h1>
      </section>
      <div class="actionbar stacked">
        <button class="primary block" data-action="auth-start" data-mode="login">Login/Sign Up</button>
        <button class="ghost block" data-action="continue-guest">Continue as guest</button>
      </div>`;
  }

  // Login / create account / two-factor: a clickable PROTOTYPE for user testing.
  // Nothing is sent anywhere and passwords are never stored or read back.
  // ---------------------------------------------------------------------------
  // One account per email, one person per username. In the shared store each person has
  // accounts/<their id> (only they can write it) holding their lowercased username and a
  // one-way hash of their email; the email itself is never stored. Without a store, the
  // same check runs on this device.
  // ---------------------------------------------------------------------------

  const REGISTRY_KEY = 'foodie.registry.v1';
  const usernameKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const myRegistryId = () => shared.uid || 'this-device';

  async function emailHash(email) {
    const data = new TextEncoder().encode(`foodiematch:${email.trim().toLowerCase()}`);
    try {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      let h = 2166136261; // fallback where SubtleCrypto is unavailable
      for (const c of data) h = Math.imul(h ^ c, 16777619) >>> 0;
      return `f${h.toString(16)}`;
    }
  }

  /** Who holds this username key or email hash: an id, or null. */
  async function registryOwner(field, value) {
    if (!value) return null;
    try {
      if (shared.db) {
        const snap = await shared.db.collection('accounts').where(field, '==', value).limit(5).get();
        const other = snap.docs.find((d) => d.id !== shared.uid);
        return other ? other.id : snap.docs.length ? shared.uid : null;
      }
    } catch {
      return null; // can't check right now: don't block the person
    }
    const reg = loadJSON('localStorage', REGISTRY_KEY) || {};
    return (reg[field] || {})[value] || null;
  }

  /** Record (or clear, with null) your username key and email hash. Saves run one at a time,
   *  so two quick updates can't overwrite each other. */
  let registryQueue = Promise.resolve();
  function registerSelf(patch) {
    registryQueue = registryQueue.then(() => writeRegistry(patch));
    return registryQueue;
  }

  async function writeRegistry(patch) {
    try {
      if (shared.db) {
        const ref = shared.db.doc(`accounts/${shared.uid}`);
        const cur = await ref.get();
        const d = cur.exists ? cur.data() : {};
        await ref.set({ usernameKey: d.usernameKey ?? null, emailHash: d.emailHash ?? null, ...patch, updatedAt: Date.now() });
        return;
      }
    } catch {
      return;
    }
    const reg = loadJSON('localStorage', REGISTRY_KEY) || {};
    for (const [field, value] of Object.entries(patch)) {
      reg[field] = reg[field] || {};
      for (const k of Object.keys(reg[field])) if (reg[field][k] === myRegistryId()) delete reg[field][k];
      if (value) reg[field][value] = myRegistryId();
    }
    saveJSON('localStorage', REGISTRY_KEY, reg);
  }

  async function usernameTaken(name) {
    const holder = await registryOwner('usernameKey', usernameKey(name));
    return !!holder && holder !== myRegistryId();
  }

  function renderAuth() {
    const f = state.authFlow;
    const badge = '<p class="proto">Prototype · nothing is saved or sent</p>';
    if (f.step === 'code') {
      $app.innerHTML = `
        <form id="code-form" class="stack" novalidate>
          ${badge}
          <h1><label for="auth-code">${f.mode === 'signup' ? 'Set up two-factor' : 'Enter your code'}</label></h1>
          <p class="muted">${f.mode === 'signup' ? 'Add FoodieMatch to your authenticator app, then enter the 6-digit code.' : 'Open your authenticator app and enter the 6-digit code.'}</p>
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
          <button type="button" role="tab" aria-selected="${signup}" data-action="auth-mode" data-mode="signup">Sign up</button>
        </div>
        <h1>${signup ? 'Create your account' : 'Welcome back'}</h1>
        <div class="field"><label for="auth-email">Email</label>
          <input type="email" id="auth-email" autocomplete="username" value="${esc(f.email || '')}" /></div>
        <div class="field"><label for="auth-pass">Password</label>
          <input type="password" id="auth-pass" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="Use a test password" /></div>
        ${signup ? `<label class="check"><input type="checkbox" id="auth-2fa" ${f.twoFactor !== false ? 'checked' : ''} /> Turn on two-factor authentication</label>` : ''}
        <p id="auth-error" class="notice error" hidden></p>
        <p class="small muted auth-toggle">${signup
          ? 'Already have an account? <button type="button" class="linkish" data-action="auth-mode" data-mode="login">Log in</button>'
          : 'New to FoodieMatch? <button type="button" class="linkish" data-action="auth-mode" data-mode="signup">Sign up instead</button>'}</p>
        <div class="actionbar">
          <button class="ghost" type="button" data-action="auth-cancel">← Back</button>
          <button class="primary" type="submit">${signup ? 'Create account' : 'Log in'}</button>
        </div>
      </form>`;
    document.getElementById('auth-email').focus();
    document.getElementById('auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('auth-email').value.trim();
      const pass = document.getElementById('auth-pass');
      const err = document.getElementById('auth-error');
      const fail = (msg, switchTo) => {
        err.innerHTML = esc(msg) + (switchTo
          ? ` <button type="button" class="linkish" data-action="auth-switch" data-mode="${switchTo}">${switchTo === 'login' ? 'Log in instead' : 'Sign up instead'}</button>`
          : '');
        err.hidden = false;
      };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Add an email address to continue.');
      if (pass.value.length < 8) return fail('Use at least 8 characters.');
      const hash = await emailHash(email);
      const holder = await registryOwner('emailHash', hash);
      if (signup && holder) return fail('That email already has a profile.', 'login');
      if (!signup && !holder && shared.db) return fail('No profile uses that email yet.', 'signup');
      pass.value = ''; // the prototype never keeps a password
      f.email = email;
      f.hash = hash;
      f.claim = !holder || holder === myRegistryId(); // never take over someone else's email
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
    const guestProfiles = state.profiles;
    const guestQuiz = state.quiz;
    saveJSON('sessionStorage', `${STORAGE_KEY}:guest`, null); // the guest session ends here
    saveJSON('sessionStorage', `${QUIZ_KEY}:guest`, null);
    saveJSON('sessionStorage', GUEST_KEY, null);
    state.auth = { email: f.email, twoFactor: f.twoFactor, prototype: true };
    saveJSON('localStorage', AUTH_KEY, state.auth);
    const saved = loadProfiles();
    const savedOwner = saved.find((p) => p.owner);
    if (savedOwner) {
      // This account already has a profile: open it, and keep friends added this session.
      state.profiles = [...saved, ...guestProfiles.filter((p) => !p.owner && !saved.some((s) => s.id === p.id))];
      if (guestQuiz?.owner) {
        // Answers in progress now update the account's profile instead of making a second one.
        guestQuiz.editingId = savedOwner.id;
        guestQuiz.isNew = false;
        guestQuiz.answers = { ...savedOwner, ...guestQuiz.answers, id: savedOwner.id, name: savedOwner.name, owner: true };
      }
    } else {
      state.profiles = guestProfiles; // a new account starts from what you did as a guest
    }
    state.selected = new Set(state.profiles.map((p) => p.id));
    saveProfiles();
    registerSelf({
      ...(f.claim ? { emailHash: f.hash } : {}),
      ...(owner() ? { usernameKey: usernameKey(owner().name) } : {}),
    });
    shared.code = owner()?.shortCode || null;
    publishShortCode();
    startSocial();
    syncPresence();
    state.authFlow = null;
    const msg = `${f.mode === 'signup' ? 'Account created' : 'Logged in'}${f.twoFactor ? ' with two-factor on' : ''}`;
    if (f.next) {
      f.next();
      if (state.view === 'quiz' && state.quiz) toast(`${msg}. Your answers are saved.`, { label: 'Start over', run: restartQuiz });
      else toast(msg);
      return;
    }
    toast(msg);
    go(owner() ? 'table' : 'account');
  }

  function renderAccount() {
    const draft = state.accountDraft || {};
    $app.innerHTML = `
      <form id="account-form" class="stack" novalidate>
        <h1><label for="acct-name">Choose a username</label></h1>
        <input type="text" id="acct-name" maxlength="40" autocomplete="username" placeholder="Username" aria-describedby="acct-note" value="${esc(draft.name || '')}" />
        <p id="acct-note" class="small muted">Don’t use your full name.</p>
        <p id="acct-error" class="notice error" hidden></p>
        <div class="actionbar">
          <button class="ghost" type="button" data-action="home">← Back</button>
          <button class="primary" type="submit">Continue</button>
        </div>
      </form>`;
    document.getElementById('acct-name').focus();
    document.getElementById('account-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('acct-name').value.trim();
      state.accountDraft = { name };
      if (!name) {
        const error = document.getElementById('acct-error');
        error.textContent = 'Add a username to continue.';
        error.hidden = false;
        return;
      }
      if (await usernameTaken(name)) {
        const error = document.getElementById('acct-error');
        error.textContent = 'That username is taken. Try another.';
        error.hidden = false;
        return;
      }
      if (signedIn()) registerSelf({ usernameKey: usernameKey(name) });
      startQuiz({ id: newId(), owner: true, name, cuisines: [], dealbreakers: [], vibes: [], favorites: [], visited: [] }, { skipName: true, isNew: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Profile: photo, header, sections, and who can see them
  // ---------------------------------------------------------------------------

  const SECTIONS = [
    ['photo', 'Profile photo'],
    ['header', 'Header image'],
    ['bio', 'Bio'],
    ['phone', 'Phone number'],
    ['favorites', 'Favorites'],
    ['ratings', 'Ratings'],
    ['reviews', 'Reviews and photos'],
  ];
  const VISIBILITY = {
    private: ['Private', 'Only you can see your profile. Friends with your code still get your taste answers for matching.'],
    friends: ['Friends', 'Friends you connect with, and people you share your code with, can see your profile.'],
    public: ['Public', 'You show up under Nearby, and anyone with the app open can see your profile.'],
  };
  const visibility = (p) => (VISIBILITY[p?.visibility] ? p.visibility : 'private'); // private by default
  // Phone numbers stay hidden from others until someone chooses to show theirs.
  const HIDDEN_BY_DEFAULT = { phone: true };
  const isHidden = (p, key) => {
    const set = p?.hiddenSections || {};
    return key in set ? !!set[key] : !!HIDDEN_BY_DEFAULT[key];
  };
  const IMAGE_URL = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const MAX_REVIEW_PHOTOS = 3;
  const CARD_PHOTO_BUDGET = 150000; // characters of review photos a shared card may carry

  const PERSON_ICON = '<svg class="person-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 19.5c1.2-3.3 4-5 7-5s5.8 1.7 7 5"/></svg>';
  const GEAR_ICON = '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5"/></svg>';

  const formatPhone = (digits) =>
    digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : `+${digits}`;

  /** What others may see of a profile: null when it's private. Hidden sections are left out. */
  function publicCard(me, { images = true, maxFavorites = 12, reviewChars = 500 } = {}) {
    if (!me || visibility(me) === 'private') return null;
    const card = { name: me.name, visibility: visibility(me) };
    if (images && me.avatar && !isHidden(me, 'photo')) card.avatar = me.avatar;
    if (images && me.header && !isHidden(me, 'header')) card.header = me.header;
    if (me.bio && !isHidden(me, 'bio')) card.bio = me.bio;
    if (me.phone && !isHidden(me, 'phone')) card.phone = me.phone;
    if (!isHidden(me, 'favorites')) {
      const saved = me.saved || {};
      let budget = CARD_PHOTO_BUDGET;
      card.favorites = arr(me.favorites)
        .filter((id) => saved[id])
        .slice(0, maxFavorites)
        .map((id) => {
          const f = { name: saved[id].name, town: saved[id].town || '', cuisine: arr(saved[id].cuisine) };
          if (!isHidden(me, 'ratings')) f.stars = (me.ratings || {})[id] || 0;
          const r = (me.reviews || {})[id];
          if (r && !isHidden(me, 'reviews')) {
            if (r.text) f.review = r.text.slice(0, reviewChars);
            if (images) {
              f.photos = arr(r.photos).filter((ph) => {
                if (ph.length > budget) return false;
                budget -= ph.length;
                return true;
              });
            }
          }
          return f;
        });
    }
    return card;
  }

  /** Clean up a profile card that came from someone else. */
  function normalizeCard(c) {
    if (!c || typeof c !== 'object' || typeof c.name !== 'string') return null;
    const str = (v, n = 60) => (typeof v === 'string' ? v.slice(0, n) : '');
    const img = (v, max) => typeof v === 'string' && v.length < max && IMAGE_URL.test(v);
    const out = { name: str(c.name, 40), visibility: VISIBILITY[c.visibility] ? c.visibility : 'friends' };
    if (img(c.avatar, 120000)) out.avatar = c.avatar;
    if (img(c.header, 200000)) out.header = c.header;
    if (c.bio) out.bio = str(c.bio, 160);
    if (typeof c.phone === 'string' && /^\d{7,15}$/.test(c.phone)) out.phone = c.phone;
    if (Array.isArray(c.favorites)) {
      out.favorites = c.favorites
        .filter((f) => f && typeof f.name === 'string')
        .slice(0, 12)
        .map((f) => ({
          name: str(f.name),
          town: str(f.town, 40),
          cuisine: arr(f.cuisine).filter((x) => x in LABELS.cuisine),
          ...(Number.isInteger(f.stars) && f.stars >= 0 && f.stars <= 5 ? { stars: f.stars } : {}),
          ...(f.review ? { review: str(f.review, 500) } : {}),
          ...(Array.isArray(f.photos) ? { photos: f.photos.filter((ph) => img(ph, 90000)).slice(0, MAX_REVIEW_PHOTOS) } : {}),
        }));
    }
    return out;
  }

  function avatarHtml(p, size) {
    const img = p && IMAGE_URL.test(p.avatar || '') ? p.avatar : null;
    if (img) return `<img class="avatar ${size}" src="${esc(img)}" alt="" />`;
    return `<span class="avatar ${size}" aria-hidden="true">${esc((p?.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>`;
  }

  function bannerHtml(header) {
    if (header && IMAGE_URL.test(header)) return `<img class="banner-img" src="${esc(header)}" alt="" />`;
    return `<svg class="banner-default" viewBox="0 0 480 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <circle cx="392" cy="80" r="58" /><circle cx="392" cy="80" r="38" /></svg>`;
  }

  const starRow = (n) => `<span class="stars-static" aria-label="${n} of 5">${[1, 2, 3, 4, 5]
    .map((i) => `<span class="star-static ${i <= n ? 'on' : ''}">${STAR}</span>`).join('')}</span>`;

  const photoGrid = (photos, removeFor) =>
    photos.length
      ? `<div class="review-photos">${photos
          .map((ph, i) => `<figure><img src="${esc(ph)}" alt="Review photo ${i + 1}" loading="lazy" />${removeFor
            ? `<button class="small on-image" data-action="remove-review-photo" data-rid="${esc(removeFor)}" data-i="${i}" aria-label="Remove photo ${i + 1}">Remove</button>`
            : ''}</figure>`)
          .join('')}</div>`
      : '';

  /** Read-only view of a profile card: what friends (or the public) see. */
  function cardSections(card) {
    if (!card.favorites?.length) return '<p class="muted">No favorites shared yet.</p>';
    return `<section class="card stack"><h2>Favorites</h2><div class="favs">${card.favorites
      .map((f) => `<div class="fav">
        <div class="who"><strong>${esc(f.name)}</strong>
          <div class="small muted">${esc([f.cuisine.map((c) => LABELS.cuisine[c]).join(', '), f.town].filter(Boolean).join(' · '))}</div></div>
        ${f.stars ? starRow(f.stars) : ''}
        ${f.review ? `<p class="review">${esc(f.review)}</p>` : ''}
        ${photoGrid(f.photos || [])}
      </div>`).join('')}</div></section>`;
  }

  function personHtml(card, fallbackName, backLabel, uid) {
    if (!card) {
      return `<section class="stack">
        <h1>${esc(fallbackName)}</h1>
        <p class="muted">${esc(fallbackName)} keeps their profile private.</p>
        ${connectControl(uid, fallbackName)}
      </section>
      <section><button class="ghost" data-action="${backLabel[0]}">← ${esc(backLabel[1])}</button></section>`;
    }
    return `<section class="profile-head">
        <div class="banner">${bannerHtml(card.header)}</div>
        <div class="profile-id">${avatarHtml(card, 'lg')}</div>
        <h1>${esc(card.name)}</h1>
        ${card.bio ? `<p class="bio">${esc(card.bio)}</p>` : ''}
        ${card.phone ? `<p class="small">${esc(formatPhone(card.phone))}</p>` : ''}
        <p class="small muted">${esc(VISIBILITY[card.visibility][0])} profile</p>
        ${connectControl(uid, card.name)}
      </section>
      ${cardSections(card)}
      <section><button class="ghost" data-action="${backLabel[0]}">← ${esc(backLabel[1])}</button></section>`;
  }

  function renderProfile() {
    const me = owner();
    if (!me) return go('welcome');
    const vis = visibility(me);
    const hiddenTag = (key) => (isHidden(me, key) ? '<span class="chip">Hidden from others</span>' : '');
    const bio = state.editingBio
      ? `<form class="stack" data-form="bio" novalidate>
          <label class="sr-only" for="set-bio">Bio</label>
          <textarea id="set-bio" class="text-area" rows="3" maxlength="160" placeholder="A line about how you like to eat">${esc(me.bio || '')}</textarea>
          <div class="row"><button class="primary small" type="submit">Save bio</button><button class="ghost small" type="button" data-action="cancel-bio">Cancel</button></div>
        </form>`
      : me.bio
        ? `<div class="bio-row"><p class="bio">${esc(me.bio)}</p><div class="row">${hiddenTag('bio')}<button class="ghost small" data-action="edit-bio">Edit bio</button></div></div>`
        : '<div><button class="ghost small" data-action="edit-bio">Add a bio</button></div>';
    $app.innerHTML = `
      <section class="profile-head">
        <div class="banner">
          ${bannerHtml(me.header)}
          <div class="banner-tools">
            ${hiddenTag('header')}
            <label class="btn small on-image" for="pick-header">${me.header ? 'Change header' : 'Add header'}</label>
            ${me.header ? '<button class="small on-image" data-action="remove-image" data-kind="header">Remove</button>' : ''}
          </div>
        </div>
        <div class="profile-id">
          ${avatarHtml(me, 'lg')}
          <div class="row">
            <label class="btn small" for="pick-avatar">${me.avatar ? 'Change photo' : 'Add photo'}</label>
            ${me.avatar ? '<button class="ghost small" data-action="remove-image" data-kind="avatar">Remove</button>' : ''}
            ${hiddenTag('photo')}
          </div>
        </div>
        <input type="file" id="pick-header" class="file-pick" data-kind="header" accept="image/*" hidden />
        <input type="file" id="pick-avatar" class="file-pick" data-kind="avatar" accept="image/*" hidden />
        <h1>${esc(me.name)}</h1>
        ${bio}
        ${me.phone ? `<p class="small">${esc(formatPhone(me.phone))} ${hiddenTag('phone')}</p>` : ''}
        <p class="small muted"><span class="vis-pill">${esc(VISIBILITY[vis][0])}</span> ${esc(VISIBILITY[vis][1])}</p>
        <div class="row">
          <button data-action="open-settings">${GEAR_ICON}Settings</button>
          <button class="ghost small" data-action="preview-profile">See what friends see</button>
        </div>
      </section>

      ${friendsCard()}

      ${favoritesCard(me, {
        tags: [
          hiddenTag('favorites'),
          isHidden(me, 'ratings') ? '<span class="chip">Ratings hidden from others</span>' : '',
          isHidden(me, 'reviews') ? '<span class="chip">Reviews hidden from others</span>' : '',
        ].join(''),
      })}

      <section><button class="ghost" data-action="home">← Back to my table</button></section>`;
  }

  function renderPreview() {
    const me = owner();
    if (!me) return go('welcome');
    $app.innerHTML = `
      <p class="notice">${{
        private: 'Your profile is private, so no one else sees it.',
        friends: 'This is what friends with your code see.',
        public: 'This is what anyone with the app open sees.',
      }[visibility(me)]}</p>
      ${personHtml(publicCard(me), me.name, ['open-profile', 'Back to my profile'])}`;
  }

  function renderPerson() {
    if (state.personLive) {
      $app.innerHTML = personHtml(state.personLive.card, state.personLive.name, state.personLive.back || ['home', 'Back to my table'], state.personLive.uid);
      return;
    }
    const f = state.profiles.find((p) => p.id === state.personId);
    if (!f) return go('table');
    $app.innerHTML = personHtml(f.card, f.name, ['home', 'Back to my table'], f.uid);
  }

  function renderSettings() {
    const me = owner();
    if (!me) return go('welcome');
    const vis = visibility(me);
    const twoFa = state.twoFaSetup;
    const sw = (on, action, label, extra = '') =>
      `<button class="switch" role="switch" aria-checked="${on}" data-action="${action}" ${extra}><span>${esc(label)}</span><span class="knob" aria-hidden="true"></span></button>`;
    const account = signedIn()
      ? `<p class="proto">Prototype · passwords are never saved or sent</p>
        <form class="stack" data-form="email" novalidate>
          <div class="field"><label for="set-email">Email</label>
            <input type="email" id="set-email" autocomplete="email" value="${esc(state.auth.email)}" /></div>
          <div><button class="small" type="submit">Save email</button></div>
        </form>
        <form class="stack" data-form="password" novalidate>
          <div class="field"><label for="set-pass">New password</label>
            <input type="password" id="set-pass" autocomplete="new-password" placeholder="At least 8 characters" /></div>
          <div class="field"><label for="set-pass2">Confirm new password</label>
            <input type="password" id="set-pass2" autocomplete="new-password" /></div>
          <div><button class="small" type="submit">Change password</button></div>
        </form>
        ${sw(!!state.auth.twoFactor || !!twoFa, 'toggle-2fa', 'Two-factor authentication')}
        ${twoFa
          ? `<form class="stack" data-form="twofa" novalidate>
              <p class="small muted">Add FoodieMatch to your authenticator app, then enter the 6-digit code.</p>
              <p class="testcode">Test code: <strong>${twoFa.code}</strong></p>
              <input type="text" id="set-2fa" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" />
              <div class="row"><button class="primary small" type="submit">Turn on</button><button class="ghost small" type="button" data-action="cancel-2fa">Cancel</button></div>
            </form>`
          : ''}`
      : `<p class="small muted">Sign up or log in to add an email, a password and two-factor authentication.</p>
        <div><button class="small" data-action="auth-start" data-mode="login">Login/Sign Up</button></div>`;
    $app.innerHTML = `
      <section><h1>Settings</h1></section>

      <section class="card stack">
        <h2>Account</h2>
        <form class="stack" data-form="username" novalidate>
          <div class="field"><label for="set-name">Username</label>
            <input type="text" id="set-name" maxlength="40" autocomplete="username" aria-describedby="set-name-note" value="${esc(me.name)}" />
            <span id="set-name-note" class="small muted">Don’t use your full name.</span></div>
          <div><button class="small" type="submit">Save username</button></div>
        </form>
        <form class="stack" data-form="phone" novalidate>
          <div class="field"><label for="set-phone">Phone number <span class="muted">(optional)</span></label>
            <input type="tel" id="set-phone" autocomplete="tel" placeholder="(916) 555-0123" value="${esc(me.phone ? formatPhone(me.phone) : '')}" aria-describedby="set-phone-note" />
            <span id="set-phone-note" class="small muted">Hidden from others unless you turn it on below.</span></div>
          <div class="row"><button class="small" type="submit">Save phone</button>${me.phone ? '<button class="ghost small" type="button" data-action="remove-phone">Remove</button>' : ''}</div>
        </form>
        ${account}
      </section>

      <section class="card stack">
        <h2>Who can see your profile</h2>
        <div class="options" role="radiogroup" aria-label="Profile visibility">
          ${Object.entries(VISIBILITY).map(([k, [label, hint]]) => `
            <button class="option" role="radio" aria-checked="${vis === k}" aria-pressed="${vis === k}" data-action="set-visibility" data-vis="${k}">
              <span class="tick"></span><span>${label}${k === 'private' ? ' (default)' : ''}<span class="hint">${esc(hint)}</span></span>
            </button>`).join('')}
        </div>
      </section>

      <section class="card stack">
        <h2>Show on your profile</h2>
        <div class="switches">
          ${SECTIONS.map(([key, label]) => sw(!isHidden(me, key), 'toggle-section', label, `data-key="${key}"`)).join('')}
        </div>
        <p class="small muted">Hidden sections stay visible to you. Ratings show next to favorites.</p>
      </section>

      <section class="card stack">
        <h2>Session</h2>
        <div class="row">
          ${signedIn() ? `<span class="small muted">${esc(state.auth.email)}</span><button class="ghost small" data-action="log-out">Sign out</button>` : ''}
          <button class="ghost small" data-action="reset">${state.confirmRemove === 'reset' ? 'Tap again to delete session' : 'Delete session'}</button>
        </div>
      </section>

      <section><button class="ghost" data-action="open-profile">← Back to my profile</button></section>`;
  }

  /** Crop and shrink a picked image so it fits comfortably in storage. */
  function resizeImage(file, kind) {
    const [w, h] = { avatar: [192, 192], header: [960, 320], review: [480, 360] }[kind];
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
        const sw = w / scale;
        const sh = h / scale;
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', { avatar: 0.82, header: 0.78, review: 0.72 }[kind]));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('That file couldn’t be opened as an image. Try a JPEG or PNG.'));
      };
      img.src = url;
    });
  }

  /** Something others might see changed: update Nearby and your code's card. */
  function profileChanged(message) {
    const ok = saveProfiles();
    syncPresence();
    publishShortCode();
    render();
    if (!ok) toast('Couldn’t save that on this device. Try a smaller image.');
    else if (message) toast(message);
  }

  /** The same person icon on every screen; one "Login/Sign Up" button beside it until you're logged in. */
  function renderTopbar() {
    const area = document.getElementById('me-area');
    if (!area) return;
    const current = ['profile', 'settings', 'preview'].includes(state.view) ? 'aria-current="page"' : '';
    const requests = shared.uid && signedIn() ? socialLists().incoming.length : 0;
    const profileBtn = `<button class="me-btn" data-action="open-profile" aria-label="Your profile${requests ? `, ${requests} friend request${requests > 1 ? 's' : ''}` : ''}" ${current}>${PERSON_ICON}${requests ? '<span class="req-dot" aria-hidden="true"></span>' : ''}</button>`;
    if (signedIn()) {
      area.innerHTML = `<button class="signin-link" data-action="log-out">Sign Out</button>${profileBtn}`;
      return;
    }
    const icon = owner() ? profileBtn : `<button class="me-btn" data-action="sign-in" data-mode="login" aria-label="Sign up or log in">${PERSON_ICON}</button>`;
    area.innerHTML = `<button class="signin-link" data-action="sign-in" data-mode="login">Login/Sign Up</button>${icon}`;
  }

  function dinerRow(p) {
    return `
      <div class="diner">
        <input type="checkbox" id="sel-${p.id}" data-action="toggle" data-id="${p.id}" ${state.selected.has(p.id) ? 'checked' : ''}
          aria-label="${esc(p.name)} is joining" />
        <div class="who">
          <label for="sel-${p.id}"><strong>${esc(p.name)}</strong></label>
          <div class="small muted">${esc(profileSummary(p))}</div>
        </div>
        <div class="actions">
          ${p.card || p.code ? `<button class="ghost small" data-action="view-person" data-id="${p.id}">Profile</button>` : ''}
          ${p.code || p.peer ? '' : `<button class="ghost small" data-action="retake" data-id="${p.id}">Edit</button>`}
          <button class="ghost small" data-action="share" data-id="${p.id}">Code</button>
          <button class="ghost small" data-action="remove" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">${state.confirmRemove === p.id ? 'Tap to remove' : 'Remove'}</button>
        </div>
      </div>`;
  }

  const STAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l2.5 5.3 5.7.7-4.2 3.9 1.1 5.7L10 14.6l-5.1 2.8 1.1-5.7L1.8 7.8l5.7-.7z"/></svg>';

  function favoritesCard(me, { tags = '' } = {}) {
    if (!signedIn()) {
      return `<section class="card stack">
        <h2>Your favorites</h2>
        <p class="small muted">Sign up or log in to save places, rate them and write reviews.</p>
        <div><button class="small" data-action="auth-start" data-mode="login">Login/Sign Up</button></div>
      </section>`;
    }
    const saved = me.saved || {};
    const ids = arr(me.favorites).filter((id) => saved[id]);
    if (!ids.length) {
      return `<section class="card stack"><h2>Your favorites</h2>${tags ? `<div>${tags}</div>` : ''}
        <p class="small muted">Tap Save on a pick and it shows up here to rate and review.</p></section>`;
    }
    const stars = (id) => {
      const current = (me.ratings || {})[id] || 0;
      return `<div class="stars" role="group" aria-label="Rate ${esc(saved[id].name)}">${[1, 2, 3, 4, 5]
        .map((n) => `<button class="star ${n <= current ? 'on' : ''}" data-action="rate" data-rid="${esc(id)}" data-stars="${n}"
          aria-label="${n} of 5" aria-pressed="${n === current}">${STAR}</button>`)
        .join('')}</div>`;
    };
    const review = (id) => {
      const r = (me.reviews || {})[id] || {};
      const photos = arr(r.photos);
      const addPhoto = photos.length < MAX_REVIEW_PHOTOS
        ? `<label class="btn small" for="pick-review-${esc(id)}">Add photo</label>
           <input type="file" id="pick-review-${esc(id)}" class="file-pick" data-kind="review" data-rid="${esc(id)}" accept="image/*" hidden />`
        : '';
      if (state.editingReview === id) {
        return `<form class="stack review-form" data-form="review" data-rid="${esc(id)}" novalidate>
          <label class="sr-only" for="review-${esc(id)}">Review of ${esc(saved[id].name)}</label>
          <textarea id="review-${esc(id)}" class="text-area" rows="4" maxlength="500" placeholder="What did you love?">${esc(r.text || '')}</textarea>
          <div class="row"><button class="primary small" type="submit">Save review</button><button class="ghost small" type="button" data-action="cancel-review">Cancel</button></div>
        </form>
        ${photoGrid(photos, id)}<div class="row">${addPhoto}</div>`;
      }
      return `${r.text ? `<p class="review">${esc(r.text)}</p>` : ''}
        ${photoGrid(photos, id)}
        <div class="row"><button class="ghost small" data-action="edit-review" data-rid="${esc(id)}">${r.text ? 'Edit review' : 'Write a review'}</button>${addPhoto}</div>`;
    };
    return `<section class="card stack">
      <h2>Your favorites</h2>
      ${tags ? `<div>${tags}</div>` : ''}
      <div class="favs">${ids
        .map((id) => `<div class="fav">
          <div class="who"><strong>${esc(saved[id].name)}</strong>
            <div class="small muted">${esc([saved[id].cuisine.map((c) => LABELS.cuisine[c] || c).join(', '), saved[id].town].filter(Boolean).join(' · '))}</div></div>
          <button class="ghost small" data-action="unfavorite" data-rid="${esc(id)}" aria-label="Remove ${esc(saved[id].name)}">Remove</button>
          ${stars(id)}
          <div class="fav-review">${review(id)}</div>
        </div>`)
        .join('')}</div>
      <p class="small muted">Your ratings shape future picks.</p>
    </section>`;
  }

  /** Your code, front and center, so anyone (guests too) can share it with the group. */
  function myCodeRow(me) {
    if (!signedIn() && shared.db && !shared.code) {
      return `<div class="mycode"><span class="small muted">Share a code so friends can join you. Guest codes last ${GUEST_CODE_HOURS} hours.</span>
        <button class="small" data-action="get-code">Get a code</button></div>`;
    }
    if (shared.code) {
      return `<div class="mycode">
        <span class="small muted">Your code</span>
        <strong id="share-code-text">${esc(shared.code.slice(0, 3))} ${esc(shared.code.slice(3))}</strong>
        <button class="small" data-action="copy-code" data-id="${me.id}">Copy</button>
      </div>`;
    }
    return `<div><button class="small" data-action="share" data-id="${me.id}">Share my code</button></div>`;
  }

  function renderTable() {
    const me = owner();
    if (!me) return go('welcome');
    const friends = state.profiles.filter((p) => !p.owner);
    const joining = friends.filter((p) => state.selected.has(p.id));
    const fresh = state.justFinished === me.id; // cleared when you leave this screen

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
        </div>
        ${myCodeRow(me)}
        ${tableFriendsHtml()}
        ${friends.length ? `<div class="card list">${friends.map(dinerRow).join('')}</div>` : ''}
        <div id="nearby" class="stack" hidden></div>
        <div class="add-grid">
          <button data-action="add-here">Add someone here<span class="hint">They take the quiz on this phone</span></button>
          <button data-action="show-import">Enter a friend’s code<span class="hint">From their own phone</span></button>
        </div>
        <div id="import" class="card stack" hidden>
          <label for="import-code"><strong>Friend’s code</strong></label>
          <input type="text" id="import-code" inputmode="numeric" autocomplete="off" placeholder="6-digit code" />
          <div class="row"><button class="primary" data-action="import">Add to the table</button></div>
        </div>
      </section>

      <div class="actionbar">
        <button class="primary block" data-action="to-group">
          ${joining.length ? `Find a table for ${joining.length + 1}` : 'Just me. Show my picks'}
        </button>
      </div>`;
    renderNearby();
  }

  function saveQuizDraft() {
    const q = state.quiz;
    if (!q) return saveJSON(profileStore(), quizKey(), null);
    const { steps, advancing, resumed, ...rest } = q;
    saveJSON(profileStore(), quizKey(), { ...rest, stepIds: steps.map((x) => x.id) });
  }

  const QUIZ_FIELDS = ['cuisines', 'novelty', 'noise', 'dealbreakers', 'maxWait', 'diningWith', 'vibes', 'zip'];

  /** Clear the quiz answers (keeping who you are) and go back to the first question. */
  function restartQuiz() {
    const q = state.quiz;
    if (!q) return;
    const answers = Object.fromEntries(Object.entries(q.answers).filter(([k]) => !QUIZ_FIELDS.includes(k)));
    Object.assign(answers, { cuisines: [], dealbreakers: [], vibes: [] });
    if (!q.steps.some((x) => x.id === 'novelty')) answers.novelty = 'new';
    state.quiz = { ...q, step: 0, answers, resumed: false, advancing: false };
    state.confirmRemove = null;
    go('quiz');
    toast('Starting over');
  }

  function renderQuiz() {
    saveQuizDraft();
    const { step, answers, steps } = state.quiz;
    const q = steps[step];
    const value = answers[q.id];
    const progress = `<div class="progress" aria-hidden="true"><span style="width:${pct((step + 1) / steps.length)}%"></span></div>`;
    let body;
    if (q.type === 'text' || q.type === 'zip') {
      const zip = q.type === 'zip';
      body = `<input type="text" id="q-text" maxlength="${zip ? 5 : 40}" placeholder="${esc(q.placeholder)}" value="${esc(value || '')}"
        ${zip ? 'inputmode="numeric" autocomplete="postal-code"' : 'autocomplete="off"'} />
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
      <div class="spread quiz-top">
        <p class="eyebrow">${state.quiz.owner ? 'Your taste profile' : answers.name ? `${esc(answers.name)}’s taste profile` : 'New diner'} · ${step + 1} of ${steps.length}</p>
        ${step > 0 || state.quiz.resumed
          ? `<button class="ghost small" data-action="quiz-restart">${state.confirmRemove === 'quiz-restart' ? 'Tap again to start over' : 'Start over'}</button>`
          : ''}
      </div>
      ${state.quiz.resumed ? '<p class="notice">Picking up where you left off. Your answers are saved.</p>' : ''}
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
    const short = p.owner && shared.code;
    $app.innerHTML = `
      <section class="stack">
        <h1>${p.owner ? 'Your code' : `${esc(p.name)}’s code`}</h1>
        <p class="muted">Friends enter it under “Enter a friend’s code”.</p>
        <div class="card stack">
          ${short
            ? `<p class="bigcode" id="share-code-text">${esc(short.slice(0, 3))} ${esc(short.slice(3))}</p>`
            : `<textarea readonly rows="4" id="share-code">${esc(toCode(p))}</textarea>`}
          <div class="row"><button class="primary" data-action="copy-code" data-id="${p.id}">Copy code</button></div>
        </div>
        <button class="ghost" data-action="home">← Back to my table</button>
      </section>`;
    if (p.owner && !shared.code && shared.db) publishShortCode().then(() => state.view === 'share' && render());
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
      profile: renderProfile,
      settings: renderSettings,
      preview: renderPreview,
      person: renderPerson,
    };
    views[state.view]();
    renderTopbar();
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
    // "Favorites or something new?" only makes sense with saved favorites, so it's for logged-in owners.
    // Guests, and people added on this phone, are set to "something new".
    const asksNovelty = isOwner && signedIn();
    if (!asksNovelty) answers.novelty = 'new';
    const steps = QUIZ.filter(
      (q) => (q.id !== 'name' || !(skipName || isOwner)) && (!q.ownerOnly || isOwner) && (q.id !== 'novelty' || asksNovelty),
    );
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
    if (state.quiz) state.quiz.resumed = false;
    if (state.view !== 'quiz') return;
    if (state.quiz.step < state.quiz.steps.length - 1) {
      state.quiz.step++;
      render();
    } else {
      finishQuiz();
    }
  }

  function quizBack() {
    if (state.quiz.step === 0) {
      const toAccount = state.quiz.owner && state.quiz.isNew;
      state.quiz = null; // leaving the quiz on purpose: drop the draft
      saveQuizDraft();
      return go(toAccount ? 'account' : homeView());
    }
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
    saveQuizDraft();
    state.accountDraft = null;
    syncPresence();
    publishShortCode();
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
  // Short friend codes: 6 digits pointing at your profile in the artifact's shared store.
  // Each person can only write their own entry (codes/<their id>); everyone signed in can look one up.
  // ---------------------------------------------------------------------------

  const shared = { db: null, uid: null, code: null };

  async function connectStore() {
    if (!window.claude?.use) return;
    const [db, user] = await Promise.all([window.claude.use('db').catch(() => null), window.claude.use('user').catch(() => null)]);
    const uid = user ? await user.id().catch(() => null) : null;
    if (!db || !uid) return;
    shared.db = db;
    shared.uid = uid;
    try {
      const mine = await db.doc(`codes/${uid}`).get();
      if (mine.exists && typeof mine.data().code === 'string') shared.code = mine.data().code;
      if (shared.code && state.view === 'table') render();
    } catch {
      /* lookups still work; publishing will retry */
    }
    if (signedIn()) {
      if (owner()) publishShortCode();
      startSocial();
    } else {
      unpublishShortCode(); // signed out: clear anything an earlier session left shared
    }
  }

  /** Take your profile out of the shared store (signing out, deleting, or a stale guest entry). */
  async function unpublishShortCode() {
    shared.code = null;
    shared.guestCodeOk = false;
    if (!shared.db || !shared.uid) return;
    try {
      const mine = await shared.db.doc(`codes/${shared.uid}`).get();
      if (mine.exists && mine.data().profile) {
        await shared.db.doc(`codes/${shared.uid}`).set({ code: null, profile: null, card: null, updatedAt: Date.now() });
      }
    } catch {
      /* try again next time */
    }
  }

  /** Save (or refresh) your profile under your 6-digit code. */
  async function publishShortCode() {
    const me = owner();
    if (!shared.db || !me) return;
    // Guests share nothing unless they ask for a code; accounts keep theirs.
    if (!signedIn() && !shared.guestCodeOk) return;
    const { favorites, ...profile } = Object.fromEntries(SHARE_FIELDS.map((k) => [k, me[k] ?? null]));
    try {
      let code = shared.code;
      for (let tries = 0; !code && tries < 6; tries++) {
        const candidate = String(Math.floor(100000 + Math.random() * 900000));
        const taken = await shared.db.collection('codes').where('code', '==', candidate).limit(1).get();
        if (!taken.docs.length) code = candidate;
      }
      if (!code) return;
      const guest = !signedIn();
      await shared.db.doc(`codes/${shared.uid}`).set({ code, profile, card: guest ? null : publicCard(me), guest, updatedAt: Date.now() });
      shared.code = code;
      if (!guest && me.shortCode !== code) {
        me.shortCode = code; // keep the same digits across sign-ins
        saveProfiles();
      }
      if (state.view === 'table' && !document.activeElement?.matches('input, textarea')) render();
    } catch {
      shared.code = null; // e.g. view-only access: fall back to the long code
    }
  }

  async function lookupShortCode(code) {
    if (!shared.db) throw new Error('Short codes work in the shared FoodieMatch link. Ask your friend for their long code.');
    let snap;
    try {
      snap = await shared.db.collection('codes').where('code', '==', code).limit(1).get();
    } catch {
      throw new Error('Couldn’t look that up just now. Try again in a moment.');
    }
    const doc = snap.docs[0];
    if (!doc || !doc.data().profile) throw new Error('No one has that code yet. Check the digits with your friend.');
    if (doc.data().guest && Date.now() - (doc.data().updatedAt || 0) > GUEST_CODE_HOURS * 3600000) {
      throw new Error('That code has expired. Ask your friend for a new one.');
    }
    if (doc.id === shared.uid) throw new Error('That’s your own code.');
    const profile = normalizeShared(doc.data().profile);
    if (!profile) throw new Error('That code is missing a profile.');
    return { ...profile, id: newId(), code, uid: doc.id, card: normalizeCard(doc.data().card) };
  }

  // ---------------------------------------------------------------------------
  // Friends: connections between people. Each person keeps one list in links/<their id>
  // (only they can write it). Both on each other's lists = friends; on theirs but not
  // yours = a request for you.
  // ---------------------------------------------------------------------------

  const social = {
    started: false,
    mine: { uids: [], declined: [] },
    listsMe: new Set(),
    // Previews only: Priya (test) has sent you a request, and test users accept yours.
    testListsMe: new Set(DEMO_ONLY ? ['test-priya'] : []),
    people: {},
  };
  const TEST_IDS = new Set((REGION.testUsers || []).map((t) => t.peer));
  const listsMe = (uid) => social.listsMe.has(uid) || social.testListsMe.has(uid);

  function friendState(uid) {
    if (!uid || uid === shared.uid) return 'self';
    const mine = social.mine.uids.includes(uid);
    if (mine && listsMe(uid)) return 'friends';
    if (mine) return 'sent';
    if (listsMe(uid) && !social.mine.declined.includes(uid)) return 'incoming';
    return 'none';
  }

  function socialLists() {
    const all = [...new Set([...social.mine.uids, ...social.listsMe, ...social.testListsMe])];
    const by = (st) => all.filter((u) => friendState(u) === st);
    return { friends: by('friends'), incoming: by('incoming'), sent: by('sent') };
  }

  function startSocial() {
    if (social.started || !shared.db || !shared.uid || !signedIn()) return;
    social.started = true;
    shared.db.doc(`links/${shared.uid}`).onSnapshot(
      (snap) => {
        const d = snap.exists ? snap.data() : {};
        social.mine = { uids: arr(d.uids), declined: arr(d.declined) };
        loadPeople();
        socialChanged();
      },
      () => {},
    );
    shared.db
      .collection('links')
      .where('uids', 'array-contains', shared.uid)
      .onSnapshot(
        (snap) => {
          social.listsMe = new Set(snap.docs.map((d) => d.id));
          loadPeople();
          socialChanged();
        },
        () => {},
      );
  }

  /** Names and profile cards for everyone in your lists, from their code entry. */
  async function loadPeople() {
    const uids = [...new Set([...social.mine.uids, ...social.listsMe, ...social.testListsMe])];
    for (const uid of uids) {
      if (social.people[uid]?.fetched || social.people[uid]?.loading) continue;
      const test = (REGION.testUsers || []).find((t) => t.peer === uid);
      if (test) {
        social.people[uid] = { name: test.profile.name, profile: normalizeShared(test.profile), card: normalizeCard(test.card), fetched: true };
        continue;
      }
      social.people[uid] = { name: social.people[uid]?.name || 'Someone', loading: true };
      try {
        const doc = await shared.db.doc(`codes/${uid}`).get();
        const v = doc.exists ? doc.data() : {};
        const profile = normalizeShared(v.profile);
        social.people[uid] = { name: profile?.name || 'Someone', profile, card: normalizeCard(v.card), code: v.code, fetched: true };
      } catch {
        social.people[uid] = { name: social.people[uid]?.name || 'Someone' }; // try again on the next change
      }
      socialChanged();
    }
  }

  function socialChanged() {
    renderTopbar();
    if (document.activeElement?.matches('input, textarea')) return; // don't disturb typing
    if (['table', 'profile', 'person'].includes(state.view)) render();
  }

  async function saveLinks(next, message) {
    if (!shared.db || !shared.uid) return toast('Friend connections work in the shared FoodieMatch link.');
    const before = social.mine;
    social.mine = next;
    socialChanged();
    try {
      await shared.db.doc(`links/${shared.uid}`).set({ uids: next.uids, declined: next.declined, updatedAt: Date.now() });
      if (message) toast(message);
    } catch {
      social.mine = before;
      socialChanged();
      toast('Couldn’t update your friends just now. Try again in a moment.');
    }
  }

  const personName = (uid) => social.people[uid]?.name || 'Someone';

  function connect(uid, name) {
    if (!uid || uid === shared.uid) return;
    social.people[uid] = social.people[uid] || { name: name || 'Someone' };
    const next = { uids: [...new Set([...social.mine.uids, uid])], declined: social.mine.declined.filter((u) => u !== uid) };
    const accepting = listsMe(uid);
    saveLinks(next, accepting ? `You and ${personName(uid)} are now friends` : `Friend request sent to ${personName(uid)}`);
    if (TEST_IDS.has(uid) && !accepting) {
      setTimeout(() => {
        social.testListsMe.add(uid); // test users accept right away
        socialChanged();
        toast(`${personName(uid)} accepted your request`);
      }, 1200);
    }
    loadPeople();
  }

  /** The button(s) on someone's profile: Connect, Request sent, Accept, or Friends. */
  function connectControl(uid, name) {
    if (!uid || !shared.db || !signedIn()) return '';
    const st = friendState(uid);
    const n = esc(name || personName(uid));
    if (st === 'self') return '';
    if (st === 'friends') {
      return `<div class="row"><span class="chip good">Friends</span><button class="small" data-action="friend-to-table" data-uid="${esc(uid)}">Add to table</button></div>`;
    }
    if (st === 'sent') {
      return `<div class="row"><span class="small muted">Request sent</span><button class="ghost small" data-action="cancel-request" data-uid="${esc(uid)}">Cancel</button></div>`;
    }
    if (st === 'incoming') {
      return `<div class="row"><span class="small muted">${n} wants to connect</span>
        <button class="primary small" data-action="accept-friend" data-uid="${esc(uid)}">Accept</button>
        <button class="ghost small" data-action="decline-friend" data-uid="${esc(uid)}">Decline</button></div>`;
    }
    return `<div><button class="primary small" data-action="connect" data-uid="${esc(uid)}" data-name="${n}">Connect</button></div>`;
  }

  function friendRow(uid, kind) {
    const p = social.people[uid] || { name: 'Someone' };
    const avatarSrc = p.card || { name: p.name };
    const summary = p.profile ? profileSummary(p.profile) : '';
    const buttons = {
      incoming: `<button class="primary small" data-action="accept-friend" data-uid="${esc(uid)}">Accept</button>
        <button class="ghost small" data-action="decline-friend" data-uid="${esc(uid)}">Decline</button>`,
      friends: `<button class="ghost small" data-action="view-friend" data-uid="${esc(uid)}">Profile</button>
        <button class="ghost small" data-action="unfriend" data-uid="${esc(uid)}">${state.confirmRemove === `unfriend:${uid}` ? 'Tap to remove' : 'Remove'}</button>`,
      sent: `<button class="ghost small" data-action="cancel-request" data-uid="${esc(uid)}">Cancel</button>`,
    }[kind];
    return `<div class="friend">
      ${avatarHtml(avatarSrc, 'sm')}
      <div class="who"><strong>${esc(p.name)}</strong>${summary ? `<div class="small muted">${esc(summary)}</div>` : ''}</div>
      <div class="friend-actions">${buttons}</div>
    </div>`;
  }

  function friendsCard() {
    if (!signedIn()) {
      return `<section class="card stack" id="friends"><h2>Friends</h2>
        <p class="small muted">Log in to connect with friends and see their profiles.</p>
        <div><button class="small" data-action="auth-start" data-mode="login">Login/Sign Up</button></div></section>`;
    }
    if (!shared.db || !shared.uid) {
      return `<section class="card stack" id="friends"><h2>Friends</h2>
        <p class="small muted">Friend connections work in the shared FoodieMatch link.</p></section>`;
    }
    const { friends, incoming, sent } = socialLists();
    const group = (title, list, kind) =>
      list.length ? `<div class="stack"><p class="eyebrow">${title}</p><div class="friends">${list.map((u) => friendRow(u, kind)).join('')}</div></div>` : '';
    return `<section class="card stack" id="friends">
      <h2>Friends${friends.length ? ` <span class="count">${friends.length}</span>` : ''}</h2>
      ${group('Friend requests', incoming, 'incoming')}
      ${group('Your friends', friends, 'friends')}
      ${group('Requests sent', sent, 'sent')}
      ${!friends.length && !incoming.length && !sent.length
        ? '<p class="small muted">Connect with friends to see their profiles and bring them to your table in one tap.</p>'
        : ''}
      <form class="row connect-form" data-form="connect-code" novalidate>
        <label class="sr-only" for="friend-code">Friend’s code</label>
        <input type="text" id="friend-code" inputmode="numeric" autocomplete="off" placeholder="6-digit code" />
        <button class="small" type="submit">Connect</button>
      </form>
    </section>`;
  }

  /** On the table screen: requests waiting for you, and friends you can bring along in one tap. */
  function tableFriendsHtml() {
    if (!shared.db || !shared.uid || !signedIn()) return '';
    const { friends, incoming } = socialLists();
    const atTable = new Set(state.profiles.map((p) => p.uid).filter(Boolean));
    const free = friends.filter((u) => !atTable.has(u));
    const requests = incoming.length
      ? `<button class="notice request-note" data-action="open-friends">${incoming.length === 1
        ? `${esc(personName(incoming[0]))} wants to connect`
        : `${incoming.length} friend requests`} · <span class="linkish">View</span></button>`
      : '';
    const list = free.length
      ? `<p class="eyebrow">Your friends</p><div class="card list">${free.map((uid) => {
          const p = social.people[uid] || { name: 'Someone' };
          return `<div class="diner">${avatarHtml(p.card || { name: p.name }, 'sm')}
            <div class="who"><strong>${esc(p.name)}</strong>${p.profile ? `<div class="small muted">${esc(profileSummary(p.profile))}</div>` : ''}</div>
            <button class="small" data-action="friend-to-table" data-uid="${esc(uid)}">Add</button></div>`;
        }).join('')}</div>`
      : '';
    return requests + list;
  }

  // ---------------------------------------------------------------------------
  // Nearby with the app open (live presence, where the host offers a shared room)
  // ---------------------------------------------------------------------------

  const live = { room: null, peers: [] };

  // Only public profiles appear under Nearby: first name, taste answers, last ZIP town and the
  // visible parts of the profile card (no images). Never coordinates.
  function myPresence() {
    const me = owner();
    if (!me || !signedIn() || visibility(me) !== 'public') return { profile: null, town: null, card: null };
    const { favorites, ...profile } = Object.fromEntries(SHARE_FIELDS.map((k) => [k, me[k] ?? null]));
    return { profile, town: state.myTown || null, card: publicCard(me, { images: false, maxFavorites: 6 }) };
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
          .map((p) => ({
            peer: p.peer,
            uid: p.by || null,
            town: typeof p.presence?.town === 'string' ? p.presence.town.slice(0, 40) : null,
            profile: normalizeShared(p.presence?.profile),
            card: normalizeCard(p.presence?.card),
          }))
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
      const next = { ...friend, ...p.profile, id: friend.id, peer: p.peer, card: p.card, favorites: friend.favorites, visited: friend.visited };
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
            <div class="small muted">${esc(profileSummary(p.profile))}</div>
          </div>
          <div class="actions">
            ${p.card ? `<button class="ghost small" data-action="view-nearby" data-peer="${esc(p.peer)}">Profile</button>` : ''}
            ${added
              ? '<span class="small muted joined">Joining</span>'
              : `<button class="small" data-action="add-nearby" data-peer="${esc(p.peer)}">Add</button>`}
          </div>
        </div>`;
    };
    el.innerHTML = `
      <h3 class="eyebrow">Nearby with the app open</h3>
      ${peers.length
        ? `<div class="card list">${peers.map(row).join('')}</div>`
        : '<p class="small muted">No one else here yet. Share FoodieMatch and they’ll show up.</p>'}`;
  }

  /** Example test users shown under Nearby in previews, so group picks can be tried alone. */
  function exampleNearby() {
    if (!DEMO_ONLY) return [];
    return (REGION.testUsers || []).map((t) => ({
      peer: t.peer, uid: t.peer, town: t.town, example: true, profile: normalizeShared(t.profile), card: normalizeCard(t.card),
    }));
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
      saveJSON('sessionStorage', GUEST_KEY, state.auth);
      go('account');
    },
    'auth-start': (el) => startAuth(el.dataset.mode, owner() ? () => go(state.returnView || 'table') : null),
    'auth-mode': (el) => {
      state.authFlow.email = document.getElementById('auth-email')?.value.trim() || state.authFlow.email;
      state.authFlow.mode = el.dataset.mode;
      render();
    },
    'auth-back': () => {
      state.authFlow.step = 'form';
      render();
    },
    'auth-cancel': () => {
      const f = state.authFlow;
      state.authFlow = null;
      if (f?.next) return f.next(); // back to the step you were on
      go(owner() ? 'table' : 'welcome');
    },
    'log-out': () => {
      saveProfiles(); // kept under the account for next time
      saveQuizDraft();
      state.twoFaSetup = null;
      state.auth = null;
      saveJSON('localStorage', AUTH_KEY, null);
      state.profiles = [];
      state.selected = new Set();
      state.quiz = null;
      state.outcome = null;
      unpublishShortCode(); // nothing about you stays shared while you're signed out
      syncPresence();
      go('welcome');
      toast('Signed out');
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
      if (me.reviews) delete me.reviews[rid];
      saveProfiles();
      render();
    },
    'open-profile': () => (owner() ? go('profile') : signedIn() ? go('account') : actions['sign-in']()),
    // Sign up or log in from any step, then come back to it.
    'sign-in': (el) => {
      const mode = el?.dataset?.mode === 'signup' ? 'signup' : 'login';
      if (state.view === 'auth') {
        state.authFlow.mode = mode; // already here: just flip the toggle
        return render();
      }
      const back = state.view;
      startAuth(mode, back === 'welcome' ? null : () => go(back));
    },
    'auth-switch': (el) => {
      state.authFlow.email = document.getElementById('auth-email')?.value.trim() || state.authFlow.email;
      state.authFlow.mode = el.dataset.mode;
      render();
    },
    'open-settings': () => go('settings'),
    'preview-profile': () => go('preview'),
    'view-person': async (el) => {
      const f = state.profiles.find((p) => p.id === el.dataset.id);
      if (!f) return;
      state.personId = f.id;
      state.personLive = null;
      go('person');
      if (f.code && shared.db) {
        // Fetch their latest card: they may have changed what they show.
        try {
          const snap = await shared.db.collection('codes').where('code', '==', f.code).limit(1).get();
          const doc = snap.docs[0];
          f.card = doc ? normalizeCard(doc.data().card) : null;
          saveProfiles();
          if (state.view === 'person' && state.personId === f.id) render();
        } catch {
          /* show what we have */
        }
      }
    },
    'view-nearby': (el) => {
      const p = [...live.peers, ...exampleNearby()].find((x) => x.peer === el.dataset.peer);
      if (!p) return;
      state.personId = null;
      state.personLive = { card: p.card, name: p.profile.name, uid: p.uid || null };
      go('person');
    },
    'remove-image': (el) => {
      const me = owner();
      if (!me) return;
      delete me[el.dataset.kind];
      profileChanged(el.dataset.kind === 'avatar' ? 'Photo removed' : 'Header removed');
    },
    connect: (el) => connect(el.dataset.uid, el.dataset.name),
    'accept-friend': (el) => connect(el.dataset.uid),
    'decline-friend': (el) => {
      const uid = el.dataset.uid;
      saveLinks({ uids: social.mine.uids.filter((u) => u !== uid), declined: [...new Set([...social.mine.declined, uid])] }, 'Request declined');
    },
    'cancel-request': (el) => {
      const uid = el.dataset.uid;
      social.testListsMe.delete(uid);
      saveLinks({ uids: social.mine.uids.filter((u) => u !== uid), declined: social.mine.declined }, 'Request canceled');
    },
    unfriend: (el) => {
      const uid = el.dataset.uid;
      if (state.confirmRemove !== `unfriend:${uid}`) {
        state.confirmRemove = `unfriend:${uid}`;
        return render();
      }
      state.confirmRemove = null;
      social.testListsMe.delete(uid);
      saveLinks(
        { uids: social.mine.uids.filter((u) => u !== uid), declined: [...new Set([...social.mine.declined, uid])] },
        `${personName(uid)} removed from your friends`,
      );
    },
    'view-friend': (el) => {
      const uid = el.dataset.uid;
      const p = social.people[uid] || { name: 'Someone' };
      state.personId = null;
      state.personLive = { card: p.card, name: p.name, uid, back: ['open-profile', 'Back to my profile'] };
      go('person');
    },
    'friend-to-table': (el) => {
      const uid = el.dataset.uid;
      const p = social.people[uid];
      if (!p?.profile) return toast(`${personName(uid)} hasn’t finished their taste quiz yet.`);
      if (state.profiles.some((f) => f.uid === uid)) return toast(`${p.name} is already at your table`);
      const friend = { ...p.profile, id: newId(), uid, code: p.code, card: p.card };
      state.profiles.push(friend);
      state.selected.add(friend.id);
      saveProfiles();
      toast(`${p.name} is joining you`);
      render();
    },
    'open-friends': () => {
      go('profile');
      document.getElementById('friends')?.scrollIntoView({ block: 'start' });
    },
    'get-code': async () => {
      shared.guestCodeOk = true;
      await publishShortCode();
      if (!shared.code) toast('Couldn’t make a code just now. Try again in a moment.');
    },
    'quiz-restart': () => {
      if (state.confirmRemove !== 'quiz-restart') {
        state.confirmRemove = 'quiz-restart';
        return render();
      }
      restartQuiz();
    },
    'edit-bio': () => {
      state.editingBio = true;
      render();
      document.getElementById('set-bio')?.focus();
    },
    'cancel-bio': () => {
      state.editingBio = false;
      render();
    },
    'edit-review': (el) => {
      state.editingReview = el.dataset.rid;
      render();
      document.getElementById(`review-${el.dataset.rid}`)?.focus();
    },
    'cancel-review': () => {
      state.editingReview = null;
      render();
    },
    'remove-review-photo': (el) => {
      const me = owner();
      const r = me?.reviews?.[el.dataset.rid];
      if (!r) return;
      r.photos = arr(r.photos).filter((_, i) => i !== Number(el.dataset.i));
      profileChanged('Photo removed');
    },
    'remove-phone': () => {
      const me = owner();
      if (!me) return;
      delete me.phone;
      profileChanged('Phone number removed');
    },
    'set-visibility': (el) => {
      const me = owner();
      if (!me) return;
      me.visibility = el.dataset.vis;
      profileChanged(`Your profile is now ${VISIBILITY[me.visibility][0].toLowerCase()}`);
    },
    'toggle-section': (el) => {
      const me = owner();
      if (!me) return;
      const key = el.dataset.key;
      me.hiddenSections = { ...(me.hiddenSections || {}), [key]: !isHidden(me, key) };
      const label = SECTIONS.find(([k]) => k === key)[1];
      profileChanged(isHidden(me, key) ? `${label} hidden from others` : `${label} shown`);
    },
    'toggle-2fa': () => {
      if (!signedIn()) return;
      if (state.twoFaSetup) {
        state.twoFaSetup = null;
        return render();
      }
      if (state.auth.twoFactor) {
        state.auth = { ...state.auth, twoFactor: false };
        saveJSON('localStorage', AUTH_KEY, state.auth);
        render();
        return toast('Two-factor authentication is off');
      }
      state.twoFaSetup = { code: String(Math.floor(100000 + Math.random() * 900000)) };
      render();
      document.getElementById('set-2fa')?.focus();
    },
    'cancel-2fa': () => {
      state.twoFaSetup = null;
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
      const friend = { ...p.profile, id: newId(), peer: p.peer, card: p.card };
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
      // Delete this person's saved data wherever it lives (account on this device, or the tab).
      saveJSON(profileStore(), profileKey(), null);
      saveJSON(profileStore(), quizKey(), null);
      state.profiles = [];
      state.selected.clear();
      state.auth = null;
      state.hidden.clear();
      state.passed = {};
      saveJSON('localStorage', AUTH_KEY, null);
      saveJSON('sessionStorage', GUEST_KEY, null);
      registerSelf({ usernameKey: null, emailHash: null });
      unpublishShortCode();
      state.quiz = null;
      saveQuizDraft();
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
    import: async () => {
      const raw = document.getElementById('import-code').value.replace(/\s+/g, '');
      try {
        const p = /^\d{6}$/.test(raw) ? await lookupShortCode(raw) : fromCode(raw);
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
        toast('Sign up or log in to save favorites.', {
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
    const code = p.owner && shared.code ? shared.code : toCode(p);
    try {
      await navigator.clipboard.writeText(code);
      toast(`Copied ${p.owner ? 'your' : `${p.name}’s`} code`);
    } catch {
      const box = document.getElementById('share-code') || document.getElementById('share-code-text');
      if (box?.select) box.select();
      else if (box) window.getSelection().selectAllChildren(box);
      toast('Code selected. Copy it with your keyboard or long-press.');
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
    if (!['remove', 'reset', 'unfriend', 'quiz-restart'].includes(el.dataset.action) && state.confirmRemove) state.confirmRemove = null;
    const fn = actions[el.dataset.action];
    if (fn) fn(el);
  });
  const FORMS = {
    'connect-code': async () => {
      const raw = document.getElementById('friend-code').value.replace(/\s+/g, '');
      if (!/^\d{6}$/.test(raw)) return toast('Enter the 6 digits of your friend’s code.');
      try {
        const p = await lookupShortCode(raw);
        social.people[p.uid] = { name: p.name, profile: normalizeShared(p), card: p.card, code: p.code, fetched: true };
        document.getElementById('friend-code').blur();
        connect(p.uid, p.name);
      } catch (err) {
        toast(err.message);
      }
    },
    bio: () => {
      const me = owner();
      me.bio = document.getElementById('set-bio').value.trim().slice(0, 160);
      if (!me.bio) delete me.bio;
      state.editingBio = false;
      profileChanged(me.bio ? 'Bio saved' : 'Bio removed');
    },
    review: (form) => {
      const me = owner();
      const rid = form.dataset.rid;
      const text = form.querySelector('textarea').value.trim().slice(0, 500);
      me.reviews = { ...(me.reviews || {}) };
      me.reviews[rid] = { ...(me.reviews[rid] || {}), text };
      state.editingReview = null;
      profileChanged(text ? 'Review saved' : 'Review cleared');
    },
    phone: () => {
      const me = owner();
      const digits = document.getElementById('set-phone').value.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) return toast('Add a full phone number, like (916) 555-0123.');
      me.phone = digits;
      profileChanged('Phone number saved');
    },
    username: async () => {
      const me = owner();
      const name = document.getElementById('set-name').value.trim().slice(0, 40);
      if (!name) return toast('Add a username to save.');
      if (usernameKey(name) !== usernameKey(me.name) && (await usernameTaken(name))) return toast('That username is taken. Try another.');
      me.name = name;
      if (signedIn()) registerSelf({ usernameKey: usernameKey(name) });
      profileChanged('Username saved');
    },
    email: async () => {
      const email = document.getElementById('set-email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Add a full email address, like you@example.com.');
      const hash = await emailHash(email);
      const holder = await registryOwner('emailHash', hash);
      if (holder && holder !== myRegistryId()) return toast('That email already has a profile.');
      registerSelf({ emailHash: hash });
      state.auth = { ...state.auth, email };
      saveJSON('localStorage', AUTH_KEY, state.auth);
      render();
      toast('Email saved');
    },
    password: () => {
      const a = document.getElementById('set-pass');
      const b = document.getElementById('set-pass2');
      if (a.value.length < 8) return toast('Use at least 8 characters.');
      if (a.value !== b.value) return toast('The two passwords don’t match yet.');
      a.value = '';
      b.value = ''; // the prototype never keeps a password
      toast('Password changed');
    },
    twofa: () => {
      const typed = document.getElementById('set-2fa').value.trim();
      if (typed !== state.twoFaSetup?.code) return toast('That code doesn’t match. Try the test code above.');
      state.twoFaSetup = null;
      state.auth = { ...state.auth, twoFactor: true };
      saveJSON('localStorage', AUTH_KEY, state.auth);
      render();
      toast('Two-factor authentication is on');
    },
  };
  document.addEventListener('submit', (e) => {
    const handler = FORMS[e.target.dataset?.form];
    if (!handler) return;
    e.preventDefault();
    handler(e.target);
  });

  document.addEventListener('change', async (e) => {
    const input = e.target;
    if (!input.matches?.('.file-pick') || !input.files?.[0]) return;
    const me = owner();
    if (!me) return;
    try {
      const kind = input.dataset.kind;
      const image = await resizeImage(input.files[0], kind);
      if (kind === 'review') {
        const rid = input.dataset.rid;
        me.reviews = { ...(me.reviews || {}) };
        const r = { ...(me.reviews[rid] || {}) };
        r.photos = [...arr(r.photos), image].slice(0, MAX_REVIEW_PHOTOS);
        me.reviews[rid] = r;
        return profileChanged('Photo added');
      }
      me[kind] = image;
      profileChanged(kind === 'avatar' ? 'Photo updated' : 'Header updated');
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('input[data-action="toggle"]')) actions.toggle(el);
  });

  render();
  connectRoom();
  connectStore();
})();
