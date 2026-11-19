(() => {
  'use strict';

  const Store = window.SourdoughStore;
  const {
    CORE_ORDER,
    formatPct,
    formatGrams,
    pctToGrams,
    computeMetrics,
    formatDate
  } = Store;

  const dom = {
    navRecipeCount: document.getElementById('navRecipeCount'),
    authControls: document.getElementById('authControls'),
    storageStatus: document.getElementById('storageStatus'),
    toggleJsonBtn: document.getElementById('toggleJsonBtn'),
    importJsonBtn: document.getElementById('importJsonBtn'),
    importFileInput: document.getElementById('importFileInput'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    pageFeedback: document.getElementById('pageFeedback'),
    rawJsonPanel: document.getElementById('rawJsonPanel'),
    rawJsonCode: document.getElementById('rawJsonCode'),
    copyJsonBtn: document.getElementById('copyJsonBtn'),
    closeJsonBtn: document.getElementById('closeJsonBtn'),
    searchInput: document.getElementById('searchInput'),
    resultsCount: document.getElementById('resultsCount'),
    sortSelect: document.getElementById('sortSelect'),
    recipesGrid: document.getElementById('recipesGrid'),
    emptyState: document.getElementById('emptyState'),
    emptyTitle: document.getElementById('emptyTitle'),
    emptyMessage: document.getElementById('emptyMessage')
  };

  let feedbackTimer = null;
  let pendingDeleteId = null;
  let pendingDeleteTimer = null;

  function showFeedback(message, type = 'success') {
    dom.pageFeedback.textContent = message;
    dom.pageFeedback.className = `page-feedback is-${type}`;
    dom.pageFeedback.hidden = false;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => {
      dom.pageFeedback.hidden = true;
    }, 3400);
  }

  async function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Fallback below
      }
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function updateRawJsonView() {
    if (!dom.rawJsonPanel.hidden) {
      dom.rawJsonCode.textContent = Store.exportCollectionJson();
    }
  }

  function matchesSearch(recipe, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if ((recipe.name || '').toLowerCase().includes(q)) return true;
    if ((recipe.notes || '').toLowerCase().includes(q)) return true;
    if (recipe.flours.some((f) => (f.name || '').toLowerCase().includes(q))) return true;
    if (recipe.inclusions.some((i) => i.pct > 0 && (i.name || '').toLowerCase().includes(q))) {
      return true;
    }
    return false;
  }

  function sortRecipes(recipes, sortBy) {
    const list = recipes.slice();
    switch (sortBy) {
      case 'name':
        return list.sort((a, b) => a.name.localeCompare(b.name));
      case 'hydration-desc':
        return list.sort(
          (a, b) => computeMetrics(b).hydrationPct - computeMetrics(a).hydrationPct
        );
      case 'weight-desc':
        return list.sort(
          (a, b) => computeMetrics(b).totalWeight - computeMetrics(a).totalWeight
        );
      case 'recent':
      default:
        return list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    }
  }

  function buildIngredientRows(recipe) {
    const rows = [];
    recipe.flours.forEach((f) => {
      if (f.pct > 0 || f.isPrimary) {
        rows.push({
          name: f.name || 'Flour',
          pct: f.pct,
          grams: pctToGrams(f.pct, recipe.totalFlour)
        });
      }
    });
    CORE_ORDER.forEach((key) => {
      const item = recipe.core[key];
      rows.push({
        name: item.name,
        pct: item.pct,
        grams: pctToGrams(item.pct, recipe.totalFlour)
      });
    });
    recipe.inclusions.forEach((inc) => {
      if (inc.pct > 0) {
        rows.push({
          name: inc.name || 'Inclusion',
          pct: inc.pct,
          grams: pctToGrams(inc.pct, recipe.totalFlour)
        });
      }
    });
    return rows;
  }

  function createRecipeCard(recipe) {
    const metrics = computeMetrics(recipe);
    const card = document.createElement('article');
    card.className = 'recipe-card';

    // Header
    const header = document.createElement('div');
    header.className = 'recipe-card-header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'recipe-card-title-wrap';

    const title = document.createElement('h2');
    title.className = 'recipe-card-title';
    title.textContent = recipe.name;

    const meta = document.createElement('span');
    meta.className = 'recipe-card-date';
    const dateStr = formatDate(recipe.updatedAt);
    meta.textContent = dateStr ? `Updated ${dateStr}` : '';

    titleWrap.append(title, meta);
    header.appendChild(titleWrap);

    // Metric Strip
    const stats = document.createElement('div');
    stats.className = 'recipe-stats';
    const statItems = [
      { label: 'Flour', value: `${formatGrams(metrics.totalFlour)} g` },
      { label: 'Hydration', value: `${formatPct(metrics.hydrationPct)}%` },
      { label: 'Starter', value: `${formatPct(metrics.starterPct)}%` },
      { label: 'Total', value: `${formatGrams(metrics.totalWeight)} g`, accent: true }
    ];
    statItems.forEach((s) => {
      const el = document.createElement('div');
      el.className = 'recipe-stat' + (s.accent ? ' is-accent' : '');
      const lbl = document.createElement('span');
      lbl.className = 'recipe-stat-label';
      lbl.textContent = s.label;
      const val = document.createElement('span');
      val.className = 'recipe-stat-value';
      val.textContent = s.value;
      el.append(lbl, val);
      stats.appendChild(el);
    });

    // Ingredients Table
    const table = document.createElement('table');
    table.className = 'recipe-mini-table';
    const tbody = document.createElement('tbody');
    buildIngredientRows(recipe).forEach((row) => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      tdName.className = 'mini-name';
      tdName.textContent = row.name;

      const tdPct = document.createElement('td');
      tdPct.className = 'mini-pct';
      tdPct.textContent = `${formatPct(row.pct)}%`;

      const tdGrams = document.createElement('td');
      tdGrams.className = 'mini-grams';
      tdGrams.textContent = `${formatGrams(row.grams)} g`;

      tr.append(tdName, tdPct, tdGrams);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    // Optional Notes
    const notesText = (recipe.notes || '').trim();
    let notesEl = null;
    if (notesText) {
      notesEl = document.createElement('p');
      notesEl.className = 'recipe-card-notes';
      notesEl.textContent = notesText;
    }

    // Card Footer Actions
    const footer = document.createElement('div');
    footer.className = 'recipe-card-footer';

    const openLink = document.createElement('a');
    openLink.href = `../index.html?recipe=${encodeURIComponent(recipe.id)}`;
    openLink.className = 'btn btn-primary btn-sm';
    openLink.textContent = 'Open in Calculator';

    const secondaryActions = document.createElement('div');
    secondaryActions.className = 'card-secondary-actions';

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-ghost btn-sm';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(Store.buildRecipeSummaryText(recipe, recipe.name));
      if (ok) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 1400);
      }
    });

    const dupBtn = document.createElement('button');
    dupBtn.type = 'button';
    dupBtn.className = 'btn btn-ghost btn-sm';
    dupBtn.textContent = 'Duplicate';
    dupBtn.addEventListener('click', async () => {
      try {
        const copy = await Store.duplicateRecipe(recipe.id);
        if (copy) {
          renderLibrary();
          showFeedback(`Created "${copy.name}".`, 'success');
        }
      } catch (err) {
        showFeedback(err.message || 'Could not duplicate recipe.', 'error');
      }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    const isConfirming = pendingDeleteId === recipe.id;
    delBtn.className = 'btn btn-sm ' + (isConfirming ? 'btn-danger' : 'btn-ghost btn-danger-hover');
    delBtn.textContent = isConfirming ? 'Confirm Delete' : 'Delete';
    delBtn.addEventListener('click', async () => {
      if (pendingDeleteId !== recipe.id) {
        pendingDeleteId = recipe.id;
        clearTimeout(pendingDeleteTimer);
        pendingDeleteTimer = setTimeout(() => {
          pendingDeleteId = null;
          renderLibrary();
        }, 3500);
        renderLibrary();
        return;
      }

      clearTimeout(pendingDeleteTimer);
      pendingDeleteId = null;
      try {
        await Store.deleteRecipe(recipe.id);
        renderLibrary();
        showFeedback(`Deleted "${recipe.name}".`, 'info');
      } catch (err) {
        showFeedback(err.message || 'Could not delete recipe.', 'error');
      }
    });

    secondaryActions.append(copyBtn, dupBtn, delBtn);
    footer.append(openLink, secondaryActions);

    card.append(header, stats, table);
    if (notesEl) card.appendChild(notesEl);
    card.appendChild(footer);
    return card;
  }

  function renderLibrary() {
    const allRecipes = Store.getRecipes();
    Store.renderNavStatus(dom.storageStatus, dom.navRecipeCount);
    Store.renderAuthControls(dom.authControls);
    updateRawJsonView();

    const query = dom.searchInput.value.trim();
    const sortBy = dom.sortSelect.value;
    const filtered = sortRecipes(
      allRecipes.filter((r) => matchesSearch(r, query)),
      sortBy
    );

    const total = allRecipes.length;
    if (query) {
      dom.resultsCount.textContent = `${filtered.length} of ${total} ${total === 1 ? 'recipe' : 'recipes'}`;
    } else {
      dom.resultsCount.textContent = `${total} ${total === 1 ? 'recipe' : 'recipes'}`;
    }

    dom.recipesGrid.innerHTML = '';

    if (filtered.length === 0) {
      dom.emptyState.hidden = false;
      if (total === 0) {
        dom.emptyTitle.textContent = 'No saved recipes yet';
        dom.emptyMessage.textContent =
          'Save a recipe from the calculator and it will appear here automatically.';
      } else {
        dom.emptyTitle.textContent = 'No matching recipes';
        dom.emptyMessage.textContent = `Nothing matched "${query}". Try another search term.`;
      }
      return;
    }

    dom.emptyState.hidden = true;
    filtered.forEach((recipe) => {
      dom.recipesGrid.appendChild(createRecipeCard(recipe));
    });
  }

  // Event Wiring
  dom.searchInput.addEventListener('input', renderLibrary);
  dom.sortSelect.addEventListener('change', renderLibrary);

  dom.toggleJsonBtn.addEventListener('click', () => {
    const opening = dom.rawJsonPanel.hidden;
    dom.rawJsonPanel.hidden = !opening;
    dom.toggleJsonBtn.textContent = opening ? 'Hide JSON' : 'View JSON';
    if (opening) {
      updateRawJsonView();
    }
  });

  dom.closeJsonBtn.addEventListener('click', () => {
    dom.rawJsonPanel.hidden = true;
    dom.toggleJsonBtn.textContent = 'View JSON';
  });

  dom.copyJsonBtn.addEventListener('click', async () => {
    const ok = await copyText(Store.exportCollectionJson());
    if (ok) {
      dom.copyJsonBtn.textContent = 'Copied!';
      setTimeout(() => {
        dom.copyJsonBtn.textContent = 'Copy JSON';
      }, 1500);
    }
  });

  dom.exportJsonBtn.addEventListener('click', () => {
    Store.downloadCollectionJson('recipes.json');
    showFeedback('Downloaded recipes.json.', 'success');
  });

  dom.importJsonBtn.addEventListener('click', () => {
    dom.importFileInput.value = '';
    dom.importFileInput.click();
  });

  dom.importFileInput.addEventListener('change', () => {
    const file = dom.importFileInput.files && dom.importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await Store.importFromJsonText(String(reader.result || ''), {
          merge: true
        });
        renderLibrary();
        showFeedback(
          `Imported ${result.importedCount} ${result.importedCount === 1 ? 'recipe' : 'recipes'} from ${file.name}.`,
          'success'
        );
      } catch (err) {
        showFeedback(err.message || 'Could not import JSON file.', 'error');
      }
    };
    reader.readAsText(file);
  });

  async function boot() {
    Store.onChange(() => {
      renderLibrary();
    });
    await Store.init();
    renderLibrary();
  }

  boot();
})();
