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
    };
  }

  function createFallbackSeedRecipes() {
    return [
      {
        id: 'rec-everyday-honey-avocado',
        name: 'Everyday Honey & Avocado Oil Loaf',
        updatedAt: '2026-11-19T15:20:00.000Z',
        ...createDefaultDough()
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

  async function init() {
    const local = readLocalCollection();
    if (local) {
      cachedRecipes = local;
      return { recipes: getRecipes() };
    }

    // First visit: seed from static recipes/recipes.json (on GitHub Pages),
    // falling back to embedded defaults if opened via file://
    const seeded = await fetchStaticRecipesJson();
    cachedRecipes = seeded || createFallbackSeedRecipes().map(sanitizeRecipe);
    writeLocalCollection(cachedRecipes);
    return { recipes: getRecipes() };
  }

  async function persistCollection() {
    writeLocalCollection(cachedRecipes);
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

    await persistCollection();
    return clone(saved);
  }

  async function deleteRecipe(id) {
    cachedRecipes = cachedRecipes.filter((r) => r.id !== id);
    await persistCollection();
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
    await persistCollection();
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

    await persistCollection();
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
    badgeEl.className = 'storage-status is-live';
    badgeEl.innerHTML =
      '<span class="status-dot" aria-hidden="true"></span><span>Saved locally in this browser &middot; Export JSON anytime</span>';
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
    getRecipes,
    getRecipeById,
    saveRecipe,
    deleteRecipe,
    duplicateRecipe,
    importFromJsonText,
    downloadCollectionJson,
    loadDraft,
    saveDraft,
    renderNavStatus
  };
})();
