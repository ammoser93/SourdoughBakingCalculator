(() => {
  'use strict';

  const Store = window.SourdoughStore;
  const {
    CORE_ORDER,
    makeId,
    formatPct,
    formatGrams,
    parseInput,
    pctToGrams,
    rebalancePrimaryFlour,
    computeMetrics
  } = Store;

  // DOM References
  const dom = {
    navRecipeCount: document.getElementById('navRecipeCount'),
    authControls: document.getElementById('authControls'),
    storageStatus: document.getElementById('storageStatus'),
    openRecipeSelect: document.getElementById('openRecipeSelect'),
    recipeNameInput: document.getElementById('recipeNameInput'),
    saveRecipeBtn: document.getElementById('saveRecipeBtn'),
    saveAsNewBtn: document.getElementById('saveAsNewBtn'),
    recipeFeedback: document.getElementById('recipeFeedback'),
    totalFlourInput: document.getElementById('totalFlourInput'),
    metricHydration: document.getElementById('metricHydration'),
    metricStarter: document.getElementById('metricStarter'),
    metricTotalWeight: document.getElementById('metricTotalWeight'),
    flourTotalBadge: document.getElementById('flourTotalBadge'),
    flourWarning: document.getElementById('flourWarning'),
    floursList: document.getElementById('floursList'),
    coreList: document.getElementById('coreList'),
    inclusionsList: document.getElementById('inclusionsList'),
    inclusionsEmpty: document.getElementById('inclusionsEmpty'),
    totalPctDisplay: document.getElementById('totalPctDisplay'),
    totalWeightInput: document.getElementById('totalWeightInput'),
    notesInput: document.getElementById('notesInput'),
    addFlourBtn: document.getElementById('addFlourBtn'),
    addInclusionBtn: document.getElementById('addInclusionBtn'),
    copyBtn: document.getElementById('copyBtn'),
    copyBtnLabel: document.getElementById('copyBtnLabel'),
    resetBtn: document.getElementById('resetBtn')
  };

  let activeRecipeId = null;
  let recipeName = '';
  let state = Store.createDefaultDough();
  let copyTimer = null;
  let feedbackTimer = null;

  function persistDraft() {
    Store.saveDraft({
      recipeId: activeRecipeId,
      name: recipeName,
      dough: state
    });
  }

  function showFeedback(message, type = 'success') {
    dom.recipeFeedback.textContent = message;
    dom.recipeFeedback.className = `bar-feedback is-${type}`;
    dom.recipeFeedback.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      dom.recipeFeedback.hidden = true;
    }, 3400);
  }

  function updateRecipeBarControls() {
    const recipes = Store.getRecipes();
    Store.renderNavStatus(dom.storageStatus, dom.navRecipeCount);
    Store.renderAuthControls(dom.authControls);

    // Populate Open Recipe dropdown
    const previousVal = activeRecipeId || '';
    dom.openRecipeSelect.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = recipes.length
      ? '— Choose a saved recipe —'
      : '— No saved recipes yet —';
    dom.openRecipeSelect.appendChild(placeholder);

    recipes
      .slice()
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
      .forEach((rec) => {
        const metrics = computeMetrics(rec);
        const opt = document.createElement('option');
        opt.value = rec.id;
        opt.textContent = `${rec.name} (${formatGrams(rec.totalFlour)}g · ${formatPct(metrics.hydrationPct)}%)`;
        dom.openRecipeSelect.appendChild(opt);
      });

    dom.openRecipeSelect.value =
      previousVal && recipes.some((r) => r.id === previousVal) ? previousVal : '';

    if (document.activeElement !== dom.recipeNameInput) {
      dom.recipeNameInput.value = recipeName;
    }

    if (activeRecipeId) {
      dom.saveRecipeBtn.textContent = 'Save Changes';
      dom.saveAsNewBtn.hidden = false;
    } else {
      dom.saveRecipeBtn.textContent = 'Save Recipe';
      dom.saveAsNewBtn.hidden = true;
    }
  }

  function loadRecipeIntoCalculator(recipe) {
    activeRecipeId = recipe.id;
    recipeName = recipe.name;
    state = Store.sanitizeDough(recipe);
    renderAll();
    updateRecipeBarControls();
    persistDraft();
  }

  // Helpers for building row elements
  function createUnitInput({ value, unit, ariaLabel, readonly = false, dataAttrs = {} }) {
    const wrapper = document.createElement('div');
    wrapper.className = 'unit-input' + (readonly ? ' is-readonly' : '');

    const input = document.createElement('input');
    input.type = 'number';
    input.inputMode = 'decimal';
    input.min = '0';
    input.step = 'any';
    input.value = value;
    input.setAttribute('aria-label', ariaLabel);
    if (readonly) {
      input.readOnly = true;
      input.tabIndex = -1;
    }

    Object.entries(dataAttrs).forEach(([k, v]) => {
      input.dataset[k] = v;
    });

    const suffix = document.createElement('span');
    suffix.className = 'unit-suffix';
    suffix.textContent = unit;

    wrapper.appendChild(input);
    wrapper.appendChild(suffix);
    return { wrapper, input };
  }

  function renderFlours() {
    dom.floursList.innerHTML = '';

    state.flours.forEach((flour) => {
      const row = document.createElement('div');
      row.className = 'ingredient-row';
      row.dataset.flourId = flour.id;

      // Name column
      const nameCol = document.createElement('div');
      nameCol.className = 'col-name name-cell';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'name-input';
      nameInput.value = flour.name;
      nameInput.placeholder = flour.isPrimary ? 'Primary Flour' : 'e.g. Whole Wheat, Rye...';
      nameInput.setAttribute('aria-label', 'Flour name');
      nameInput.addEventListener('input', () => {
        flour.name = nameInput.value;
        persistDraft();
      });
      nameCol.appendChild(nameInput);

      if (flour.isPrimary && state.flours.length > 1) {
        const badge = document.createElement('span');
        badge.className = 'auto-badge';
        badge.title = 'Automatically balances remaining flour percentage to 100%';
        badge.textContent = 'Auto';
        nameCol.appendChild(badge);
      }

      // Percentage column
      const pctCol = document.createElement('div');
      pctCol.className = 'col-pct';
      const pctControl = createUnitInput({
        value: formatPct(flour.pct),
        unit: '%',
        ariaLabel: `${flour.name || 'Flour'} baker's percentage`,
        readonly: flour.isPrimary,
        dataAttrs: { role: 'flour-pct', id: flour.id }
      });

      if (!flour.isPrimary) {
        pctControl.input.addEventListener('input', () => {
          flour.pct = parseInput(pctControl.input.value);
          rebalancePrimaryFlour(state);
          syncValues(pctControl.input);
          persistDraft();
        });
        pctControl.input.addEventListener('blur', () => {
          syncValues(null);
        });
      }
      pctCol.appendChild(pctControl.wrapper);

      // Weight column
      const weightCol = document.createElement('div');
      weightCol.className = 'col-weight';
      const weightControl = createUnitInput({
        value: formatGrams(pctToGrams(flour.pct, state.totalFlour)),
        unit: 'g',
        ariaLabel: `${flour.name || 'Flour'} weight in grams`,
        dataAttrs: { role: 'flour-weight', id: flour.id }
      });

      weightControl.input.addEventListener('input', () => {
        const newWeight = parseInput(weightControl.input.value);
        handleFlourWeightChange(flour, newWeight);
        syncValues(weightControl.input);
        persistDraft();
      });
      weightControl.input.addEventListener('blur', () => {
        syncValues(null);
      });
      weightCol.appendChild(weightControl.wrapper);

      // Action column
      const actionCol = document.createElement('div');
      actionCol.className = 'col-action';
      if (!flour.isPrimary) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = `Remove ${flour.name || 'flour'}`;
        removeBtn.setAttribute('aria-label', `Remove ${flour.name || 'flour'}`);
        removeBtn.addEventListener('click', () => {
          state.flours = state.flours.filter((f) => f.id !== flour.id);
          rebalancePrimaryFlour(state);
          renderFlours();
          syncValues(null);
          persistDraft();
        });
        actionCol.appendChild(removeBtn);
      }

      row.append(nameCol, pctCol, weightCol, actionCol);
      dom.floursList.appendChild(row);
    });
  }

  function handleFlourWeightChange(flour, newWeight) {
    if (flour.isPrimary) {
      const secondaryWeights = state.flours
        .filter((f) => !f.isPrimary)
        .map((f) => ({ flour: f, weight: pctToGrams(f.pct, state.totalFlour) }));

      const secWeightTotal = secondaryWeights.reduce((sum, item) => sum + item.weight, 0);
      const newTotalFlour = newWeight + secWeightTotal;
      state.totalFlour = newTotalFlour;

      if (newTotalFlour > 0) {
        secondaryWeights.forEach(({ flour: sec, weight }) => {
          sec.pct = (weight / newTotalFlour) * 100;
        });
        rebalancePrimaryFlour(state);
      } else {
        secondaryWeights.forEach(({ flour: sec }) => {
          sec.pct = 0;
        });
        flour.pct = 100;
      }
      return;
    }

    const otherSecondary = state.flours
      .filter((f) => !f.isPrimary && f.id !== flour.id)
      .map((f) => ({ flour: f, weight: pctToGrams(f.pct, state.totalFlour) }));

    const otherSecWeightTotal = otherSecondary.reduce((sum, item) => sum + item.weight, 0);

    if (state.totalFlour > 0 && newWeight + otherSecWeightTotal <= state.totalFlour) {
      flour.pct = (newWeight / state.totalFlour) * 100;
      rebalancePrimaryFlour(state);
    } else {
      const expandedTotal = newWeight + otherSecWeightTotal;
      state.totalFlour = expandedTotal;
      if (expandedTotal > 0) {
        otherSecondary.forEach(({ flour: other, weight }) => {
          other.pct = (weight / expandedTotal) * 100;
        });
        flour.pct = (newWeight / expandedTotal) * 100;
        rebalancePrimaryFlour(state);
      } else {
        otherSecondary.forEach(({ flour: other }) => {
          other.pct = 0;
        });
        flour.pct = 0;
        rebalancePrimaryFlour(state);
      }
    }
  }

  function renderCore() {
    dom.coreList.innerHTML = '';

    CORE_ORDER.forEach((key) => {
      const item = state.core[key];
      const row = document.createElement('div');
      row.className = 'ingredient-row';

      const nameCol = document.createElement('div');
      nameCol.className = 'col-name name-cell';
      const label = document.createElement('span');
      label.className = 'name-static';
      label.textContent = item.name;
      nameCol.appendChild(label);

      const pctCol = document.createElement('div');
      pctCol.className = 'col-pct';
      const pctControl = createUnitInput({
        value: formatPct(item.pct),
        unit: '%',
        ariaLabel: `${item.name} baker's percentage`,
        dataAttrs: { role: 'core-pct', id: key }
      });
      pctControl.input.addEventListener('input', () => {
        item.pct = parseInput(pctControl.input.value);
        syncValues(pctControl.input);
        persistDraft();
      });
      pctControl.input.addEventListener('blur', () => {
        syncValues(null);
      });
      pctCol.appendChild(pctControl.wrapper);

      const weightCol = document.createElement('div');
      weightCol.className = 'col-weight';
      const weightControl = createUnitInput({
        value: formatGrams(pctToGrams(item.pct, state.totalFlour)),
        unit: 'g',
        ariaLabel: `${item.name} weight in grams`,
        dataAttrs: { role: 'core-weight', id: key }
      });
      weightControl.input.addEventListener('input', () => {
        const grams = parseInput(weightControl.input.value);
        if (state.totalFlour > 0) {
          item.pct = (grams / state.totalFlour) * 100;
        }
        syncValues(weightControl.input);
        persistDraft();
      });
      weightControl.input.addEventListener('blur', () => {
        syncValues(null);
      });
      weightCol.appendChild(weightControl.wrapper);

      const actionCol = document.createElement('div');
      actionCol.className = 'col-action';

      row.append(nameCol, pctCol, weightCol, actionCol);
      dom.coreList.appendChild(row);
    });
  }

  function renderInclusions() {
    dom.inclusionsList.innerHTML = '';
    dom.inclusionsEmpty.hidden = state.inclusions.length > 0;

    state.inclusions.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'ingredient-row';
      row.dataset.inclusionId = item.id;

      const nameCol = document.createElement('div');
      nameCol.className = 'col-name name-cell';

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'name-input';
      nameInput.value = item.name;
      nameInput.placeholder = 'e.g. Honey, Olive oil, Seeds...';
      nameInput.setAttribute('aria-label', 'Inclusion name');
      nameInput.addEventListener('input', () => {
        item.name = nameInput.value;
        persistDraft();
      });
      nameCol.appendChild(nameInput);

      const pctCol = document.createElement('div');
      pctCol.className = 'col-pct';
      const pctControl = createUnitInput({
        value: formatPct(item.pct),
        unit: '%',
        ariaLabel: `${item.name || 'Inclusion'} baker's percentage`,
        dataAttrs: { role: 'inc-pct', id: item.id }
      });
      pctControl.input.addEventListener('input', () => {
        item.pct = parseInput(pctControl.input.value);
        syncValues(pctControl.input);
        persistDraft();
      });
      pctControl.input.addEventListener('blur', () => {
        syncValues(null);
      });
      pctCol.appendChild(pctControl.wrapper);

      const weightCol = document.createElement('div');
      weightCol.className = 'col-weight';
      const weightControl = createUnitInput({
        value: formatGrams(pctToGrams(item.pct, state.totalFlour)),
        unit: 'g',
        ariaLabel: `${item.name || 'Inclusion'} weight in grams`,
        dataAttrs: { role: 'inc-weight', id: item.id }
      });
      weightControl.input.addEventListener('input', () => {
        const grams = parseInput(weightControl.input.value);
        if (state.totalFlour > 0) {
          item.pct = (grams / state.totalFlour) * 100;
        }
        syncValues(weightControl.input);
        persistDraft();
      });
      weightControl.input.addEventListener('blur', () => {
        syncValues(null);
      });
      weightCol.appendChild(weightControl.wrapper);

      const actionCol = document.createElement('div');
      actionCol.className = 'col-action';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.title = `Remove ${item.name || 'inclusion'}`;
      removeBtn.setAttribute('aria-label', `Remove ${item.name || 'inclusion'}`);
      removeBtn.addEventListener('click', () => {
        state.inclusions = state.inclusions.filter((inc) => inc.id !== item.id);
        renderInclusions();
        syncValues(null);
        persistDraft();
      });
      actionCol.appendChild(removeBtn);

      row.append(nameCol, pctCol, weightCol, actionCol);
      dom.inclusionsList.appendChild(row);
    });
  }

  function syncValues(skipInput) {
    const setIfNotSkipped = (el, val) => {
      if (el && el !== skipInput) {
        el.value = val;
      }
    };

    setIfNotSkipped(dom.totalFlourInput, formatGrams(state.totalFlour));

    state.flours.forEach((flour) => {
      const pctInput = dom.floursList.querySelector(
        `input[data-role="flour-pct"][data-id="${CSS.escape(flour.id)}"]`
      );
      const weightInput = dom.floursList.querySelector(
        `input[data-role="flour-weight"][data-id="${CSS.escape(flour.id)}"]`
      );
      setIfNotSkipped(pctInput, formatPct(flour.pct));
      setIfNotSkipped(weightInput, formatGrams(pctToGrams(flour.pct, state.totalFlour)));
    });

    CORE_ORDER.forEach((key) => {
      const item = state.core[key];
      const pctInput = dom.coreList.querySelector(
        `input[data-role="core-pct"][data-id="${key}"]`
      );
      const weightInput = dom.coreList.querySelector(
        `input[data-role="core-weight"][data-id="${key}"]`
      );
      setIfNotSkipped(pctInput, formatPct(item.pct));
      setIfNotSkipped(weightInput, formatGrams(pctToGrams(item.pct, state.totalFlour)));
    });

    state.inclusions.forEach((item) => {
      const pctInput = dom.inclusionsList.querySelector(
        `input[data-role="inc-pct"][data-id="${CSS.escape(item.id)}"]`
      );
      const weightInput = dom.inclusionsList.querySelector(
        `input[data-role="inc-weight"][data-id="${CSS.escape(item.id)}"]`
      );
      setIfNotSkipped(pctInput, formatPct(item.pct));
      setIfNotSkipped(weightInput, formatGrams(pctToGrams(item.pct, state.totalFlour)));
    });

    const metrics = computeMetrics(state);
    const isOver = metrics.secondaryFloursPct > 100.001;
    dom.flourTotalBadge.textContent = `${formatPct(metrics.flourTotalPct)}%`;
    dom.flourTotalBadge.classList.toggle('warn', isOver);
    dom.flourWarning.hidden = !isOver;

    dom.totalPctDisplay.textContent = `${formatPct(metrics.totalPct)}%`;
    setIfNotSkipped(dom.totalWeightInput, formatGrams(metrics.totalWeight));

    dom.metricHydration.textContent = `${formatPct(metrics.hydrationPct)}%`;
    dom.metricStarter.textContent = `${formatPct(metrics.starterPct)}%`;
    dom.metricTotalWeight.textContent = `${formatGrams(metrics.totalWeight)} g`;
  }

  async function handleSave(saveAsNew) {
    const trimmed = dom.recipeNameInput.value.trim();
    if (!trimmed) {
      showFeedback('Enter a recipe name before saving.', 'error');
      dom.recipeNameInput.focus();
      return;
    }

    try {
      const saved = await Store.saveRecipe({
        id: saveAsNew ? null : activeRecipeId,
        name: trimmed,
        dough: state,
        saveAsNew
      });
      activeRecipeId = saved.id;
      recipeName = saved.name;
      updateRecipeBarControls();
      persistDraft();

      const status = Store.getSyncStatus();
      const dest = status.isCloudWritable
        ? 'Family Recipe Book'
        : 'this browser (sign in to sync)';
      showFeedback(`Saved "${saved.name}" to ${dest}.`, 'success');
    } catch (err) {
      showFeedback(err.message || 'Could not save recipe.', 'error');
    }
  }

  async function copyRecipeToClipboard() {
    const text = Store.buildRecipeSummaryText(state, recipeName.trim());
    let success = false;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch {
        success = false;
      }
    }

    if (!success) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        success = document.execCommand('copy');
      } catch {
        success = false;
      }
      document.body.removeChild(ta);
    }

    if (success) {
      dom.copyBtn.classList.add('copied');
      dom.copyBtnLabel.textContent = 'Copied!';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => {
        dom.copyBtn.classList.remove('copied');
        dom.copyBtnLabel.textContent = 'Copy';
      }, 1800);
    }
  }

  function renderAll() {
    renderFlours();
    renderCore();
    renderInclusions();
    dom.notesInput.value = state.notes;
    syncValues(null);
  }

  // Event Wiring
  dom.openRecipeSelect.addEventListener('change', () => {
    const selectedId = dom.openRecipeSelect.value;
    if (!selectedId) return;
    const found = Store.getRecipeById(selectedId);
    if (found) {
      loadRecipeIntoCalculator(found);
      showFeedback(`Opened "${found.name}".`, 'info');
    }
  });

  dom.recipeNameInput.addEventListener('input', () => {
    recipeName = dom.recipeNameInput.value;
    persistDraft();
  });

  dom.recipeNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave(false);
    }
  });

  dom.saveRecipeBtn.addEventListener('click', () => handleSave(false));
  dom.saveAsNewBtn.addEventListener('click', () => handleSave(true));

  dom.totalFlourInput.addEventListener('input', () => {
    state.totalFlour = parseInput(dom.totalFlourInput.value);
    syncValues(dom.totalFlourInput);
    persistDraft();
  });
  dom.totalFlourInput.addEventListener('blur', () => syncValues(null));

  document.querySelectorAll('.chip-btn[data-scale]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const factor = parseFloat(btn.dataset.scale);
      if (Number.isFinite(factor) && factor > 0) {
        state.totalFlour = Number((state.totalFlour * factor).toFixed(1));
        syncValues(null);
        persistDraft();
      }
    });
  });

  dom.totalWeightInput.addEventListener('input', () => {
    const targetWeight = parseInput(dom.totalWeightInput.value);
    const metrics = computeMetrics(state);
    if (metrics.totalPct > 0) {
      state.totalFlour = targetWeight / (metrics.totalPct / 100);
    }
    syncValues(dom.totalWeightInput);
    persistDraft();
  });
  dom.totalWeightInput.addEventListener('blur', () => syncValues(null));

  dom.addFlourBtn.addEventListener('click', () => {
    const newFlour = {
      id: makeId('flour'),
      name: `Flour ${state.flours.length + 1}`,
      pct: 0,
      isPrimary: false
    };
    state.flours.push(newFlour);
    renderFlours();
    syncValues(null);
    persistDraft();

    const row = dom.floursList.querySelector(`[data-flour-id="${CSS.escape(newFlour.id)}"]`);
    const nameInput = row && row.querySelector('.name-input');
    if (nameInput) {
      nameInput.focus();
      nameInput.select();
    }
  });

  dom.addInclusionBtn.addEventListener('click', () => {
    const newInc = {
      id: makeId('inc'),
      name: '',
      pct: 0
    };
    state.inclusions.push(newInc);
    renderInclusions();
    syncValues(null);
    persistDraft();

    const row = dom.inclusionsList.querySelector(`[data-inclusion-id="${CSS.escape(newInc.id)}"]`);
    const nameInput = row && row.querySelector('.name-input');
    if (nameInput) {
      nameInput.focus();
    }
  });

  dom.notesInput.addEventListener('input', () => {
    state.notes = dom.notesInput.value;
    persistDraft();
  });

  dom.copyBtn.addEventListener('click', copyRecipeToClipboard);

  dom.resetBtn.addEventListener('click', () => {
    activeRecipeId = null;
    recipeName = '';
    state = Store.createDefaultDough();
    renderAll();
    updateRecipeBarControls();
    persistDraft();
    showFeedback('Started a fresh recipe with default values.', 'info');
  });

  // Boot
  async function boot() {
    Store.onChange(() => {
      if (activeRecipeId && !Store.getRecipeById(activeRecipeId)) {
        activeRecipeId = null;
      }
      updateRecipeBarControls();
    });

    await Store.init();

    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get('recipe');
    const startNew = params.get('new') === '1';

    if (startNew) {
      activeRecipeId = null;
      recipeName = '';
      state = Store.createDefaultDough();
      persistDraft();
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } else if (requestedId) {
      const found = Store.getRecipeById(requestedId);
      if (found) {
        activeRecipeId = found.id;
        recipeName = found.name;
        state = Store.sanitizeDough(found);
        persistDraft();
        showFeedback(`Opened "${found.name}".`, 'info');
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, '', window.location.pathname);
      }
    } else {
      const draft = Store.loadDraft();
      if (draft) {
        activeRecipeId =
          draft.recipeId && Store.getRecipeById(draft.recipeId) ? draft.recipeId : null;
        recipeName = draft.name || '';
        state = draft.dough;
      }
    }

    renderAll();
    updateRecipeBarControls();
  }

  boot();
})();
