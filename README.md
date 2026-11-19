# Sourdough Baking Calculator

A 100% local, multi-page sourdough calculator website with JSON recipe storage and home Wi-Fi phone access. No installs or external dependencies required.

## Quick Start

Double-click **`start.bat`** to start the local server and open the website in your browser (`http://localhost:8765`).

- Reads and saves recipes directly to **`recipes/recipes.json`** in this folder.
- Keep the terminal window open while using the calculator on your PC or phone.

## Open on Your Phone (Same Wi-Fi)

1. Start **`start.bat`** on your PC. *(If Windows Firewall prompts, allow **Private networks** only — not Public networks.)*
2. Click the **Phone** button in the top navigation bar (or check the Wi-Fi URL printed in the terminal window) and scan the QR code with your phone camera.
3. Any recipe you save or edit on your phone writes directly to **`recipes/recipes.json`** on your computer.

### Install as a Home Screen App
- **iPhone (Safari):** Tap **Share** → **Add to Home Screen**.
- **Android (Chrome):** Tap **Menu (⋮)** → **Add to Home screen**.
- **Tip:** Switch to the **Hostname (`.local`)** tab in the Phone QR modal (or reserve your PC's local IP in your router) so your Home Screen shortcut keeps working even if your IP changes.

## Pages

- **Calculator (`index.html`):**
  - Open any saved recipe from the dropdown or save/update named recipes directly to `recipes/recipes.json`.
  - Bidirectional editing across **Total Flour (g)**, **Baker's (%)**, **Weight (g)**, and **Total Weight (g)**.
  - Dynamic **Flours** (primary flour auto-balances to `100%`) and **Inclusions**, plus quick `×½` / `×2` scaling and baking notes.
- **Saved Recipes (`recipes.html`):**
  - Browse all recipes stored in `recipes/recipes.json` as scannable cards with hydration, starter %, total dough weight, ingredient breakdowns, and notes.
  - Search, sort, **Open in Calculator**, duplicate, delete, import/export JSON, or toggle the **View JSON** panel.
