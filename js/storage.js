(() => {
  'use strict';

  const COLLECTION_KEY = 'sourdoughRecipesCollection_v1';
  const DRAFT_KEY = 'sourdoughCalcDraft_v1';
  const CORE_ORDER = ['water', 'salt', 'starter'];
  const SEED_JSON_URL =
    document.currentScript && document.currentScript.src
      ? new URL('../data/recipes.json', document.currentScript.src).href
      : './data/recipes.json';

  let cachedRecipes = [];
  let firebaseEnabled = false;
  let auth = null;
  let db = null;
  let currentUser = null;
  let syncState = 'local'; // 'local' | 'connecting' | 'synced' | 'denied' | 'error'
  let syncMessage = '';
  let unsubscribeRecipes = null;
  let seedingInProgress = false;
  const listeners = new Set();

  function makeId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function clampNonNegative(num) {
    return Number.isFinite(num) && num >= 0 ? num : 0;
  }

  function formatNumber(num, maxDecimals) {
    if (!Number.isFinite(num)) return '0';
    const rounded = Number(num.toFixed(maxDecimals));
    return Object.is(rounded, -0) ? '0' : String(rounded);
  }

  function formatPct(pct) {
    return formatNumber(pct, 2);
  }

  function formatGrams(grams) {
    return formatNumber(grams, 1);
  }

  function parseInput(raw) {
    if (raw === '' || raw === null || raw === undefined) return 0;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function createDefaultDough() {
    return {
      totalFlour: 0,
      flours: [
        { id: 'flour-primary', name: 'Flour', pct: 100, isPrimary: true }
      ],
      core: {
        water: { name: 'Water', pct: 60 },
        salt: { name: 'Salt', pct: 2 },
        starter: { name: 'Starter', pct: 10 }
      },
      inclusions: [
        { id: 'inc-honey', name: 'Honey', pct: 5 }
      ],
      notes: ''
    };
  }

  function createFallbackSeedRecipes() {
    return [
      {
        id: 'rec-everyday-honey-avocado',
        name: 'Everyday Honey & Avocado Oil Loaf',
        updatedAt: '2026-11-19T15:20:00.000Z',
        totalFlour: 1000,
        flours: [
          { id: 'flour-primary', name: 'Flour', pct: 100, isPrimary: true }
        ],
        core: {
          water: { name: 'Water', pct: 60 },
          salt: { name: 'Salt', pct: 2 },
          starter: { name: 'Starter', pct: 25 }
        },
        inclusions: [
          { id: 'inc-1', name: 'Milk powder', pct: 0 },
          { id: 'inc-2', name: 'Avocado oil / butter', pct: 4 },
          { id: 'inc-3', name: 'Honey / maple syrup', pct: 5 }
        ],
        notes: 'Oven at 425\nCovered for 45+ minutes'
      },
      {
        id: 'rec-sheet-classic',
        name: 'Classic Honey Sourdough (70% Hydration)',
        updatedAt: '2026-11-19T15:19:00.000Z',
        totalFlour: 500,
        flours: [
          { id: 'flour-primary', name: 'Flour', pct: 100, isPrimary: true }
        ],
        core: {
          water: { name: 'Water', pct: 70 },
          salt: { name: 'Salt', pct: 1.8 },
          starter: { name: 'Starter', pct: 12 }
        },
        inclusions: [
          { id: 'inc-honey', name: 'Honey', pct: 5 }
        ],
        notes: '10h fridge, 12h counter. 3 stretch and folds, preheated oven, good oven rise.'
      },
      {
        id: 'rec-sheet-fluffy',
        name: 'Fluffy Honey Olive Oil Loaf',
        updatedAt: '2026-11-19T15:18:00.000Z',
        totalFlour: 500,
        flours: [
          { id: 'flour-primary', name: 'Flour', pct: 100, isPrimary: true }
        ],
        core: {
          water: { name: 'Water', pct: 60 },
          salt: { name: 'Salt', pct: 2.4 },
          starter: { name: 'Starter', pct: 20 }
        },
        inclusions: [
          { id: 'inc-honey', name: 'Honey', pct: 8 },
          { id: 'inc-oil', name: 'Olive oil', pct: 4 }
        ],
        notes: '10h fridge, 12h counter. Made double, 1 stretch and fold, preheated oven, great oven rise.'
      }
    ];
  }

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getPrimaryFlour(dough) {
    return dough.flours.find((f) => f.isPrimary) || dough.flours[0];
  }

  function getSecondaryFloursPct(dough) {
    return dough.flours
      .filter((f) => !f.isPrimary)
      .reduce((sum, f) => sum + f.pct, 0);
  }

  function rebalancePrimaryFlour(dough) {
    const primary = getPrimaryFlour(dough);
    if (!primary) return;
    const secondarySum = getSecondaryFloursPct(dough);
    primary.pct = Math.max(0, 100 - secondarySum);
  }

  function sanitizeDough(raw) {
    const defaults = createDefaultDough();
    if (!raw || typeof raw !== 'object') return defaults;

    const totalFlour = clampNonNegative(Number(raw.totalFlour));

    let flours = Array.isArray(raw.flours)
      ? raw.flours
          .filter((f) => f && typeof f === 'object')
          .map((f, idx) => ({
            id: typeof f.id === 'string' && f.id ? f.id : makeId('flour'),
            name: typeof f.name === 'string' ? f.name : `Flour ${idx + 1}`,
            pct: clampNonNegative(Number(f.pct)),
            isPrimary: Boolean(f.isPrimary)
          }))
      : defaults.flours;

    if (flours.length === 0) {
      flours = defaults.flours;
    } else if (!flours.some((f) => f.isPrimary)) {
      flours[0].isPrimary = true;
    } else {
      let seen = false;
      flours.forEach((f) => {
        if (f.isPrimary) {
          if (seen) f.isPrimary = false;
          seen = true;
        }
      });
    }

    const core = {};
    CORE_ORDER.forEach((key) => {
      const src = raw.core && raw.core[key];
      core[key] = {
        name: defaults.core[key].name,
        pct: src ? clampNonNegative(Number(src.pct)) : defaults.core[key].pct
      };
    });

    const inclusions = Array.isArray(raw.inclusions)
      ? raw.inclusions
          .filter((item) => item && typeof item === 'object')
          .map((item) => ({
            id: typeof item.id === 'string' && item.id ? item.id : makeId('inc'),
            name: typeof item.name === 'string' ? item.name : '',
            pct: clampNonNegative(Number(item.pct))
          }))
      : [];

    const notes = typeof raw.notes === 'string' ? raw.notes : '';

    const sanitized = { totalFlour, flours, core, inclusions, notes };
    rebalancePrimaryFlour(sanitized);
    return sanitized;
  }

  function sanitizeRecipe(raw) {
    const dough = sanitizeDough(raw);
    const id =
      raw && typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : makeId('rec');
    const name =
      raw && typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : 'Untitled Recipe';
    const updatedAt =
      raw && typeof raw.updatedAt === 'string' && !Number.isNaN(Date.parse(raw.updatedAt))
        ? raw.updatedAt
        : new Date().toISOString();

    return {
      id,
      name,
      updatedAt,
      ...dough
    };
  }

  function pctToGrams(pct, totalFlour) {
    return (totalFlour * pct) / 100;
  }

  function computeMetrics(dough) {
    const flourTotalPct = dough.flours.reduce((sum, f) => sum + f.pct, 0);
    const secondaryFloursPct = getSecondaryFloursPct(dough);
    const corePct = CORE_ORDER.reduce((sum, key) => sum + dough.core[key].pct, 0);
    const incPct = dough.inclusions.reduce((sum, item) => sum + item.pct, 0);
    const totalPct = flourTotalPct + corePct + incPct;
    const totalWeight = pctToGrams(totalPct, dough.totalFlour);

    return {
      totalFlour: dough.totalFlour,
      flourTotalPct,
      secondaryFloursPct,
      hydrationPct: dough.core.water.pct,
      saltPct: dough.core.salt.pct,
      starterPct: dough.core.starter.pct,
      totalPct,
      totalWeight
    };
  }

  function formatDate(isoString) {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }

  function buildRecipeSummaryText(dough, recipeName) {
    const metrics = computeMetrics(dough);
    const lines = [
      recipeName ? `Sourdough Recipe: ${recipeName}` : 'Sourdough Main Dough',
      `Total Flour: ${formatGrams(dough.totalFlour)} g`,
      ''
    ];

    dough.flours.forEach((f) => {
      if (f.pct > 0 || f.isPrimary) {
        lines.push(
          `${f.name || 'Flour'}: ${formatGrams(pctToGrams(f.pct, dough.totalFlour))} g (${formatPct(f.pct)}%)`
        );
      }
    });

    CORE_ORDER.forEach((key) => {
      const item = dough.core[key];
      lines.push(
        `${item.name}: ${formatGrams(pctToGrams(item.pct, dough.totalFlour))} g (${formatPct(item.pct)}%)`
      );
    });

    dough.inclusions.forEach((inc) => {
      if (inc.pct > 0) {
        lines.push(
          `${inc.name || 'Inclusion'}: ${formatGrams(pctToGrams(inc.pct, dough.totalFlour))} g (${formatPct(inc.pct)}%)`
        );
      }
    });

    lines.push('');
    lines.push(
      `Total Dough Weight: ${formatGrams(metrics.totalWeight)} g (${formatPct(metrics.totalPct)}%)`
    );

    const trimmedNotes = (dough.notes || '').trim();
    if (trimmedNotes) {
      lines.push('');
      lines.push('Notes:');
      lines.push(trimmedNotes);
    }

    return lines.join('\n');
  }

  function buildCollectionPayload(recipes) {
    return {
      version: 1,
      updatedAt: new Date().toISOString(),
      recipes
    };
  }

  function exportCollectionJson(recipes = cachedRecipes) {
    return JSON.stringify(buildCollectionPayload(recipes), null, 2) + '\n';
  }

  function readLocalCollection() {
    try {
      const raw = localStorage.getItem(COLLECTION_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed && parsed.recipes;
      if (!Array.isArray(list)) return null;
      return list.map(sanitizeRecipe);
    } catch {
      return null;
    }
  }

  function writeLocalCollection(recipes) {
    try {
      localStorage.setItem(COLLECTION_KEY, JSON.stringify(buildCollectionPayload(recipes)));
    } catch {
      // Ignore storage quota / privacy mode errors
    }
  }

  function notifyListeners() {
    const snapshot = {
      recipes: getRecipes(),
      user: getUser(),
      syncState,
      syncMessage
    };
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        // Isolate subscriber errors
      }
    });
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  async function fetchStaticRecipesJson() {
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') {
      return null;
    }
    try {
      const res = await fetch(SEED_JSON_URL, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const list = Array.isArray(data) ? data : data && data.recipes;
      if (!Array.isArray(list)) return null;
      return list.map(sanitizeRecipe);
    } catch {
      return null;
    }
  }

  async function loadLocalFallbackRecipes() {
    const local = readLocalCollection();
    if (local) {
      cachedRecipes = local;
      return;
    }
    const seeded = await fetchStaticRecipesJson();
    cachedRecipes = seeded || createFallbackSeedRecipes().map(sanitizeRecipe);
    writeLocalCollection(cachedRecipes);
  }

  function isCloudWritable() {
    return Boolean(firebaseEnabled && db && currentUser && syncState === 'synced');
  }

  function stopFirestoreSubscription() {
    if (unsubscribeRecipes) {
      try {
        unsubscribeRecipes();
      } catch {
        // Ignore
      }
      unsubscribeRecipes = null;
    }
  }

  async function seedFirestoreOnceIfNeeded() {
    if (!db || !currentUser || seedingInProgress) return;
    seedingInProgress = true;
    try {
      const metaRef = db.collection('meta').doc('init');
      const metaSnap = await metaRef.get();
      if (metaSnap.exists) return;

      const seedList =
        (await fetchStaticRecipesJson()) ||
        readLocalCollection() ||
        createFallbackSeedRecipes().map(sanitizeRecipe);

      const batch = db.batch();
      seedList.forEach((rec) => {
        const clean = sanitizeRecipe(rec);
        batch.set(db.collection('recipes').doc(clean.id), clean);
      });
      batch.set(metaRef, {
        seeded: true,
        seededAt: new Date().toISOString(),
        seededBy: currentUser.email || ''
      });
      await batch.commit();
    } catch {
      // If rules reject or offline, ignore cleanly
    } finally {
      seedingInProgress = false;
    }
  }

  function startFirestoreSubscription(resolveInitial) {
    stopFirestoreSubscription();
    if (!db || !currentUser) {
      if (resolveInitial) resolveInitial();
      return;
    }

    syncState = 'connecting';
    syncMessage = 'Connecting to family recipe book...';
    notifyListeners();

    let resolved = false;
    const finishInit = () => {
      if (!resolved && resolveInitial) {
        resolved = true;
        resolveInitial();
      }
    };

    unsubscribeRecipes = db.collection('recipes').onSnapshot(
      async (snapshot) => {
        const docs = [];
        snapshot.forEach((doc) => {
          docs.push(sanitizeRecipe({ id: doc.id, ...doc.data() }));
        });
        docs.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

        syncState = 'synced';
        syncMessage = '';

        if (docs.length === 0) {
          await seedFirestoreOnceIfNeeded();
        } else {
          cachedRecipes = docs;
          writeLocalCollection(cachedRecipes);
        }

        notifyListeners();
        finishInit();
      },
      (err) => {
        stopFirestoreSubscription();
        if (err && err.code === 'permission-denied') {
          syncState = 'denied';
          syncMessage = `${currentUser.email} is not on the family allowlist yet.`;
        } else {
          syncState = 'error';
          syncMessage = 'Offline or unable to reach Firebase. Using local cache.';
        }
        notifyListeners();
        finishInit();
      }
    );
  }

  function setupFirebase() {
    const isHttp =
      window.location.protocol === 'http:' || window.location.protocol === 'https:';
    if (!isHttp) return false;
    if (typeof window.firebase === 'undefined' || !window.FIREBASE_CONFIG) return false;

    try {
      if (!window.firebase.apps.length) {
        window.firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      auth = window.firebase.auth();
      db = window.firebase.firestore();
      firebaseEnabled = true;

      // Finish any redirect-based sign-in gracefully
      auth.getRedirectResult().catch(() => {});
      return true;
    } catch {
      firebaseEnabled = false;
      return false;
    }
  }

  async function init() {
    await loadLocalFallbackRecipes();

    if (!setupFirebase()) {
      syncState = 'local';
      notifyListeners();
      return { recipes: getRecipes(), user: null, syncState };
    }

    await new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      const timeout = setTimeout(done, 2800);

      auth.onAuthStateChanged((user) => {
        currentUser = user || null;
        if (currentUser) {
          startFirestoreSubscription(() => {
            clearTimeout(timeout);
            done();
          });
        } else {
          stopFirestoreSubscription();
          syncState = 'local';
          syncMessage = '';
          loadLocalFallbackRecipes().then(() => {
            notifyListeners();
            clearTimeout(timeout);
            done();
          });
        }
      });
    });

    return { recipes: getRecipes(), user: getUser(), syncState };
  }

  async function signInWithGoogle() {
    if (!firebaseEnabled || !auth) {
      throw new Error('Firebase sign-in requires opening this site over HTTPS (e.g. GitHub Pages).');
    }
    const provider = new window.firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await auth.signInWithPopup(provider);
    } catch (err) {
      if (
        err &&
        (err.code === 'auth/popup-blocked' ||
          err.code === 'auth/operation-not-supported-in-this-environment')
      ) {
        await auth.signInWithRedirect(provider);
      } else if (err && err.code === 'auth/popup-closed-by-user') {
        return;
      } else {
        throw err;
      }
    }
  }

  async function signOut() {
    if (!auth) return;
    stopFirestoreSubscription();
    await auth.signOut();
  }

  function getUser() {
    if (!currentUser) return null;
    return {
      uid: currentUser.uid,
      email: currentUser.email || '',
      displayName: currentUser.displayName || currentUser.email || ''
    };
  }

  function getSyncStatus() {
    return {
      firebaseEnabled,
      syncState,
      syncMessage,
      isCloudWritable: isCloudWritable()
    };
  }

  function getRecipes() {
    return clone(cachedRecipes);
  }

  function getRecipeById(id) {
    const found = cachedRecipes.find((r) => r.id === id);
    return found ? clone(found) : null;
  }

  async function saveRecipe({ id = null, name, dough, saveAsNew = false }) {
    const cleanName = (name || '').trim();
    if (!cleanName) {
      throw new Error('Please enter a recipe name before saving.');
    }

    const sanitizedDough = sanitizeDough(dough);
    const now = new Date().toISOString();

    let existingIndex = -1;
    if (!saveAsNew && id) {
      existingIndex = cachedRecipes.findIndex((r) => r.id === id);
    }
    if (!saveAsNew && existingIndex === -1) {
      existingIndex = cachedRecipes.findIndex(
        (r) => r.name.toLowerCase() === cleanName.toLowerCase()
      );
    }

    let saved;
    if (existingIndex !== -1) {
      saved = {
        id: cachedRecipes[existingIndex].id,
        name: cleanName,
        updatedAt: now,
        ...sanitizedDough
      };
      cachedRecipes[existingIndex] = saved;
    } else {
      saved = {
        id: makeId('rec'),
        name: cleanName,
        updatedAt: now,
        ...sanitizedDough
      };
      cachedRecipes.unshift(saved);
    }

    writeLocalCollection(cachedRecipes);

    if (isCloudWritable()) {
      await db.collection('recipes').doc(saved.id).set(saved);
    } else {
      notifyListeners();
    }

    return clone(saved);
  }

  async function deleteRecipe(id) {
    cachedRecipes = cachedRecipes.filter((r) => r.id !== id);
    writeLocalCollection(cachedRecipes);

    if (isCloudWritable()) {
      await db.collection('recipes').doc(id).delete();
    } else {
      notifyListeners();
    }

    return getRecipes();
  }

  async function duplicateRecipe(id) {
    const original = cachedRecipes.find((r) => r.id === id);
    if (!original) return null;

    const copy = sanitizeRecipe({
      ...clone(original),
      id: makeId('rec'),
      name: `${original.name} (Copy)`,
      updatedAt: new Date().toISOString()
    });
    cachedRecipes.unshift(copy);
    writeLocalCollection(cachedRecipes);

    if (isCloudWritable()) {
      await db.collection('recipes').doc(copy.id).set(copy);
    } else {
      notifyListeners();
    }

    return clone(copy);
  }

  async function importFromJsonText(jsonText, { merge = true } = {}) {
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error('That file is not valid JSON.');
    }

    let rawList;
    if (Array.isArray(parsed)) {
      rawList = parsed;
    } else if (parsed && Array.isArray(parsed.recipes)) {
      rawList = parsed.recipes;
    } else if (parsed && typeof parsed === 'object' && 'totalFlour' in parsed) {
      rawList = [parsed];
    } else {
      throw new Error('JSON must contain a "recipes" array or a recipe object.');
    }

    const imported = rawList.map(sanitizeRecipe);

    if (merge) {
      const byId = new Map(cachedRecipes.map((r) => [r.id, r]));
      imported.forEach((rec) => {
        byId.set(rec.id, rec);
      });
      cachedRecipes = Array.from(byId.values());
    } else {
      cachedRecipes = imported;
    }

    writeLocalCollection(cachedRecipes);

    if (isCloudWritable()) {
      const batch = db.batch();
      imported.forEach((rec) => {
        batch.set(db.collection('recipes').doc(rec.id), rec);
      });
      await batch.commit();
    } else {
      notifyListeners();
    }

    return { importedCount: imported.length, recipes: getRecipes() };
  }

  function downloadCollectionJson(filename = 'recipes.json') {
    const content = exportCollectionJson(cachedRecipes);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        recipeId: typeof parsed.recipeId === 'string' ? parsed.recipeId : null,
        name: typeof parsed.name === 'string' ? parsed.name : '',
        dough: sanitizeDough(parsed.dough)
      };
    } catch {
      return null;
    }
  }

  function saveDraft(draft) {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // Ignore storage errors
    }
  }

  function renderNavStatus(badgeEl, countEl) {
    if (countEl) {
      countEl.textContent = String(cachedRecipes.length);
    }
    if (!badgeEl) return;

    if (syncState === 'synced' && currentUser) {
      badgeEl.className = 'storage-status is-live';
      badgeEl.innerHTML =
        `<span class="status-dot" aria-hidden="true"></span><span>Synced to Family Recipe Book (${escapeHtml(currentUser.email)})</span>`;
    } else if (syncState === 'connecting') {
      badgeEl.className = 'storage-status is-local';
      badgeEl.innerHTML =
        '<span class="status-dot" aria-hidden="true"></span><span>Connecting to Family Recipe Book...</span>';
    } else if (syncState === 'denied' && currentUser) {
      badgeEl.className = 'storage-status is-warn';
      badgeEl.innerHTML =
        `<span class="status-dot" aria-hidden="true"></span><span>${escapeHtml(currentUser.email)} is not in family allowlist &middot; Saving locally</span>`;
    } else if (syncState === 'error') {
      badgeEl.className = 'storage-status is-warn';
      badgeEl.innerHTML =
        '<span class="status-dot" aria-hidden="true"></span><span>Firebase unavailable &middot; Saving locally</span>';
    } else if (firebaseEnabled) {
      badgeEl.className = 'storage-status is-local';
      badgeEl.innerHTML =
        '<span class="status-dot" aria-hidden="true"></span><span>Local browser mode &middot; Sign in to sync family recipes</span>';
    } else {
      badgeEl.className = 'storage-status is-local';
      badgeEl.innerHTML =
        '<span class="status-dot" aria-hidden="true"></span><span>Local file mode &middot; Open via GitHub Pages for Firebase sync</span>';
    }
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderAuthControls(containerEl) {
    if (!containerEl) return;
    if (!firebaseEnabled) {
      containerEl.innerHTML = '';
      return;
    }

    if (currentUser) {
      const label = currentUser.displayName
        ? currentUser.displayName.split(' ')[0]
        : currentUser.email;
      containerEl.innerHTML = `
        <span class="auth-user-pill" title="${escapeHtml(currentUser.email)}">${escapeHtml(label)}</span>
        <button type="button" class="nav-auth-btn" data-action="signout">Sign out</button>
      `;
      const btn = containerEl.querySelector('[data-action="signout"]');
      btn.addEventListener('click', () => {
        signOut().catch(() => {});
      });
    } else {
      containerEl.innerHTML = `
        <button type="button" class="nav-auth-btn nav-auth-signin" data-action="signin">
          <svg class="google-icon" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/>
            <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/>
          </svg>
          <span>Sign in</span>
        </button>
      `;
      const btn = containerEl.querySelector('[data-action="signin"]');
      btn.addEventListener('click', () => {
        signInWithGoogle().catch((err) => {
          syncState = 'error';
          syncMessage = (err && err.message) || 'Sign-in failed.';
          notifyListeners();
        });
      });
    }
  }

  window.SourdoughStore = {
    CORE_ORDER,
    makeId,
    clampNonNegative,
    formatNumber,
    formatPct,
    formatGrams,
    parseInput,
    pctToGrams,
    createDefaultDough,
    rebalancePrimaryFlour,
    sanitizeDough,
    sanitizeRecipe,
    computeMetrics,
    formatDate,
    buildRecipeSummaryText,
    exportCollectionJson,
    init,
    onChange,
    signInWithGoogle,
    signOut,
    getUser,
    getSyncStatus,
    getRecipes,
    getRecipeById,
    saveRecipe,
    deleteRecipe,
    duplicateRecipe,
    importFromJsonText,
    downloadCollectionJson,
    loadDraft,
    saveDraft,
    renderNavStatus,
    renderAuthControls
  };
})();
