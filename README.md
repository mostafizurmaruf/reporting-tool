# Simple Reporting Tool

Admin-panel style tool with four pages in the sidebar:

- **Daily Report** (`index.html`) – daily task assignment & performance report (CSV import, GitHub commits, Gemini, PDF / DOCX export)
- **SQA Tool** (`sqa.html`) – module-by-module feature documentation (Google Docs copy, DOCX, print)
- **Edit Document** (`editor.html`) – open a PDF or DOCX report you already made, edit its text in place (click to edit, find & replace) and download it again in the same format. Runs fully in the browser; PDF editing loads pdf.js + pdf-lib from cdnjs.
- **Icon Generator** (`icons.html`) – logo + background (solid / gradient / transparent) + padding → ZIP with every Android launcher icon (mipmap mdpi–xxxhdpi, round, adaptive layers, Play Store 512) and an iOS `AppIcon.appiconset` (RGB PNGs + Contents.json). Offline.

Open `index.html` in a browser – no build step.

## Structure

```
index.html            Daily Report page
sqa.html              SQA Tool page
editor.html           Edit Document page
icons.html            Icon Generator page
css/
  base.css            design tokens (light/dark), reset, forms, buttons
  layout.css          admin shell: sidebar, top bar, page header, responsive
  components.css      cards, tables, dialogs, toolbar, toast
  report.css          Daily Report page
  sqa.css             SQA Tool page
  editor.css          Edit Document page
  icons.css           Icon Generator page
  print.css           print styles
js/                   (classic scripts – load order matters)
  version.js          APP_VERSION + asset loader (never cached)
  layout.js           shared sidebar, top bar and Settings dialog markup
  common.js           shared helpers ($, today, setBusy, storage keys)
  signature.js        embedded supervisor signature        (Daily Report)
  docx-builder.js     offline DOCX / ZIP builder
  report-form.js      report form state, rows, undo, autosave (Daily Report)
  report-csv.js       CSV import / template                 (Daily Report)
  gemini.js           Google Gemini helpers
  github.js           GitHub commit fetching
  report-actions.js   toolbar actions, DOCX / PDF export    (Daily Report)
  sqa-fetch.js        "Fetch SQA work" → report rows         (Daily Report)
  ui.js               settings dialog, status toast
  sqa.js              SQA documentation builder             (SQA Tool)
  doc-editor.js       open / edit / re-save PDF & DOCX      (Edit Document)
  icon-gen.js         launcher icon rendering + ZIP         (Icon Generator)
  shell.js            mobile menu, theme, version badge, user card
```

## Version / cache busting

The version is set in **one place** – `js/version.js`:

```js
window.APP_VERSION = '1.4.0';
```

Every page loads `js/version.js` with a fresh `?t=…` (so it is never cached), and every other CSS/JS file is loaded through `loadAssets()` with `?v=<APP_VERSION>`. The sidebar shows the same number next to the app name.
After changing any CSS/JS, bump `APP_VERSION` so browsers load the new files without Ctrl+F5.
To add a new CSS/JS file, add its path to the `loadAssets([...])` list in the page(s) that need it.
