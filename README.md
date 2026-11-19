# Sourdough Baking Calculator

A clean, static multi-page sourdough baker's percentage calculator and recipe library built for **GitHub Pages** (and structured to plug into Firebase later).

https://ammoser93.github.io/SourdoughBakingCalculator/

## Project Structure

```text
SourdoughBakingCalculator/
├── index.html               # Calculator page (root entry point for GitHub Pages)
├── manifest.webmanifest     # PWA manifest (Home Screen install metadata)
├── .nojekyll                # Serve static files directly on GitHub Pages
├── pages/
│   └── recipes.html         # Saved Recipes library & JSON viewer
├── css/
│   └── styles.css           # Shared styles
├── js/
│   ├── storage.js           # Data & persistence layer (ready for Firebase)
│   ├── app.js               # Calculator page logic
│   └── recipes-page.js      # Saved Recipes page logic
├── data/
│   └── recipes.json         # Default / seed recipes JSON
└── assets/
    └── icons/               # App & favicon icons
```

## Features

- **Calculator (`index.html`):**
  - Bidirectional editing across **Total Flour (g)**, **Baker's (%)**, **Weight (g)**, and **Total Weight (g)**.
  - Dynamic **Flours** (primary flour auto-balances to `100%`) and **Inclusions**, plus quick `×½` / `×2` scaling and baking notes.
  - **Open Saved Recipe** dropdown and **Save Recipe / Save Changes / Save as New** controls.
- **Saved Recipes (`pages/recipes.html`):**
  - Scannable recipe cards showing flour weight, hydration %, starter %, total dough weight, full ingredient breakdowns, and notes.
  - Search, sort, **Open in Calculator**, copy, duplicate, delete, **View JSON**, and **Import / Export `recipes.json`**.

## Deploying to GitHub Pages

1. Commit and push all files in this repo to GitHub (`main`).
2. In your GitHub repo, open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**, choose `main` and `/ (root)`, and click **Save**.
4. Your site will be live at `https://<your-username>.github.io/<repo-name>/`.
