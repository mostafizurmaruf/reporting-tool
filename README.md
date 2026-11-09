# Versatilo Tool

Admin-panel style tool. The home page (`index.html`) shows every tool as a large card; the sidebar links them too:

- **Daily Report** (`report.html`) – daily task assignment & performance report (CSV import, GitHub commits, Google Doc fetch, Gemini, PDF / DOCX export)
- **Edit Document** (`editor.html`) – open a PDF or DOCX report you already made, edit its text in place (click to edit, find & replace) and download it again in the same format. Runs fully in the browser; PDF editing loads pdf.js + pdf-lib from cdnjs.
- **Icon Generator** (`icons.html`) – logo + background (solid / gradient / transparent) + padding → ZIP with every Android launcher icon (mipmap mdpi–xxxhdpi, round, adaptive layers, Play Store 512) and an iOS `AppIcon.appiconset` (RGB PNGs + Contents.json). Offline.

Open `index.html` in a browser – no build step.

## Structure

```
index.html            Home page – tool cards grid
report.html           Daily Report page
editor.html           Edit Document page
icons.html            Icon Generator page
favicon.svg           site icon (wrench)
css/
  home.css            Home page cards
  base.css            design tokens (light/dark), reset, forms, buttons
  layout.css          admin shell: sidebar, top bar, page header, responsive
  components.css      cards, tables, dialogs, toolbar, toast
  report.css          Daily Report page
  editor.css          Edit Document page
  icons.css           Icon Generator page
  print.css           print styles
js/                   (classic scripts – load order matters)
  version.js          APP_VERSION + asset loader (never cached)
  layout.js           shared sidebar, top bar, Settings dialog, Home cards (one TOOLS list)
  common.js           shared helpers ($, today, setBusy, storage keys)
  signature.js        embedded supervisor signature        (Daily Report)
  docx-builder.js     offline DOCX / ZIP builder
  report-form.js      report form state, rows, undo, autosave (Daily Report)
  report-csv.js       CSV import / template                 (Daily Report)
  gemini.js           Google Gemini helpers
  github.js           GitHub commit fetching
  report-actions.js   toolbar actions, DOCX / PDF export    (Daily Report)
  gdocs.js            "Fetch Google Doc" → report rows       (Daily Report)
  ui.js               settings dialog, status toast
  doc-editor.js       open / edit / re-save PDF & DOCX      (Edit Document)
  icon-gen.js         launcher icon rendering + ZIP         (Icon Generator)
  shell.js            mobile menu, theme, version badge, user card
```

## Fetch Google Doc

Each person pastes the links of their own work docs in ⚙ Settings → Google Docs (one per line). **⬇ Fetch Google Doc** signs in with Google
(read-only `documents.readonly` scope, token kept in this browser for ~1 hour), reads every doc and takes the part for the Reporting Date:

1. **Dated doc (best):** every line / heading with that date (`09/11/2026`, `2026-11-09`, `9 Nov 2026`, …) up to the next date.
2. **No dates:** what was added or changed since the last fetch on an earlier day (a copy of the doc is kept in this browser).
3. **First fetch of an undated doc:** the end of the doc – Gemini guesses the latest work.

Gemini then writes the rows in one go (Work Source = the doc's title). Fetching again for the same day replaces those rows.

### One-time Google Cloud setup (admin)

The OAuth Client ID is `GOOGLE_CLIENT_ID` at the top of `js/gdocs.js`.

1. [console.cloud.google.com](https://console.cloud.google.com) → the project → **APIs & Services → Library** → enable **Google Docs API**.
2. **OAuth consent screen**: User type *External*, app name, support email. Scope: `.../auth/documents.readonly`.
   Publishing status *Testing* → add every team member's Google account under **Test users** (max 100).
3. **Credentials → OAuth client ID (Web application)** → Authorized JavaScript origins: `https://mostafizurmaruf.github.io`
   (add `http://localhost:8000` too for local testing). No redirect URI needed.

## Version / cache busting

The version is set in **one place** – `js/version.js`:

```js
window.APP_VERSION = '1.6.1';
```

Every page loads `js/version.js` with a fresh `?t=…` (so it is never cached), and every other CSS/JS file is loaded through `loadAssets()` with `?v=<APP_VERSION>`. The sidebar shows the same number next to the app name.
After changing any CSS/JS, bump `APP_VERSION` so browsers load the new files without Ctrl+F5.
To add a new CSS/JS file, add its path to the `loadAssets([...])` list in the page(s) that need it.
