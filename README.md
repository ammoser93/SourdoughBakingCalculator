# Sourdough Baking Calculator

A clean, static multi-page sourdough baker's percentage calculator and recipe library built for **GitHub Pages** (and ready to wire up to Firebase later).

## Features

- **Calculator (`index.html`):**
  - Bidirectional editing across **Total Flour (g)**, **Baker's (%)**, **Weight (g)**, and **Total Weight (g)**.
  - Dynamic **Flours** (primary flour auto-balances to `100%`) and **Inclusions**, plus quick `×½` / `×2` scaling and baking notes.
  - **Open Saved Recipe** dropdown and **Save Recipe / Save Changes / Save as New** controls.
- **Saved Recipes (`recipes.html`):**
  - Scannable recipe cards showing flour weight, hydration %, starter %, total dough weight, full ingredient breakdowns, and notes.
  - Search, sort, **Open in Calculator**, copy, duplicate, delete, **View JSON**, and **Import / Export `recipes.json`**.
- **Installable on Phone:** Includes `manifest.webmanifest` and app icons so you can **Add to Home Screen** from Safari or Chrome.

## Storage (Current Setup)

- On first visit on GitHub Pages, the app seeds your recipe list from `recipes/recipes.json`.
- Changes you make are saved locally in your browser (`localStorage`), with **Import JSON** and **Export JSON** available on the **Saved Recipes** page.
- All persistence lives in `storage.js`, making it straightforward to connect Firebase Firestore for cross-device sync next.

## Deploying to GitHub Pages

1. Commit and push all files in this repo to GitHub.
2. Open your repository on GitHub and go to **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, pick `main` and `/ (root)`, and click **Save**.
4. After ~1 minute, your site will be live at `https://<your-username>.github.io/<repo-name>/`.
