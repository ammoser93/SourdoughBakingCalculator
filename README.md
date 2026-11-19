# Sourdough Baking Calculator

A static multi-page sourdough baker's percentage calculator and shared family recipe book hosted on **GitHub Pages** and synced via **Firebase Firestore + Google Sign-In**.

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
│   ├── firebase-config.js   # Public Firebase Web App config
│   ├── storage.js           # Firebase Auth + Firestore live sync + local fallback
│   ├── app.js               # Calculator page logic
│   └── recipes-page.js      # Saved Recipes page logic
├── data/
│   └── recipes.json         # Default / starter seed recipes
└── assets/
    └── icons/               # App & favicon icons
```

## Features

- **Calculator (`index.html`):**
  - Bidirectional editing across **Total Flour (g)**, **Baker's (%)**, **Weight (g)**, and **Total Weight (g)**.
  - Dynamic **Flours** (primary flour auto-balances to `100%`) and **Inclusions**, plus quick `×½` / `×2` scaling and baking notes.
  - **Open Saved Recipe** dropdown and **Save Recipe / Save Changes / Save as New** controls.
- **Saved Recipes (`pages/recipes.html`):**
  - Live-synced family recipe cards showing flour weight, hydration %, starter %, total dough weight, ingredient breakdowns, and notes.
  - Search, sort, **Open in Calculator**, copy, duplicate, delete, **View JSON**, and **Import / Export `recipes.json`**.
- **Shared Family Sync (Firebase):**
  - Sign in with Google to sync recipes in real time across phones and computers.
  - Automatically seeds your Firestore database from `data/recipes.json` on first sign-in.
  - Works offline / signed-out using local browser storage (`localStorage`).

## Firebase Firestore Rules (Family Allowlist)

Paste these rules into **Firebase Console → Firestore Database → Rules** and add your family email addresses (all lowercase):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isFamily() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.lower() in [
          'your-email@gmail.com'
        ];
    }

    match /recipes/{recipeId} {
      allow read, write: if isFamily();
    }

    match /meta/{docId} {
      allow read, write: if isFamily();
    }
  }
}
```

Also ensure `ammoser93.github.io` is added under **Firebase Console → Authentication → Settings → Authorized domains**.
