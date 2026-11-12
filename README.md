# Versatilo Tool

Admin-panel style tool. The Daily Report opens first (`index.html`); the sidebar links every tool:

- **Daily Report** (`index.html`) – daily task assignment & performance report (CSV import, GitHub commits, Google Doc fetch, Gemini, PDF / DOCX export, save PDFs to Google Drive + history)
- **History** (`history.html`) – the report PDFs / DOCX files saved in your own Google Drive; download any earlier date
- **Edit Document** (`editor.html`) – open a PDF or DOCX report you already made, edit its text in place (click to edit, find & replace) and download it again in the same format. Runs fully in the browser; PDF editing loads pdf.js + pdf-lib from cdnjs.
- **Icon Generator** (`icons.html`) – logo + background (solid / gradient / transparent) + padding → ZIP with every Android launcher icon (mipmap mdpi–xxxhdpi, round, adaptive layers, Play Store 512) and an iOS `AppIcon.appiconset` (RGB PNGs + Contents.json). Offline.
- **Image Converter** (`convert.html`) – convert images between PNG, JPG, WebP and AVIF (input: anything the browser opens – PNG/JPG/WebP/AVIF/GIF/BMP/SVG/ICO). Many files at once, quality slider, JPG background fill, optional resize; one file or a ZIP. Offline.
- **Image Resizer** (`resize.html`) – resize by percentage, exact pixels or presets (Full HD, Instagram, YouTube, passport …) with keep-ratio / crop / pad / stretch, don’t-enlarge option, output format, and a max file size in KB (lowers JPG / WebP quality until it fits). Offline.
- **Image Compressor** (`compress.html`) – make JPG / PNG / WebP / AVIF files smaller at the same pixel size: quality slider (Light / Balanced / Strong / Smallest) or a target size in KB per image (best quality that fits, scales down only if needed), optional longest-side limit, output format. PNGs are reduced to a colour palette (indexed PNG, transparency kept); the original is kept when it would not get smaller. Offline.
- **Video Compressor** (`video.html`) – re-encode MP4 / MOV / WebM / MKV to a smaller MP4 (H.264 + AAC) or WebM (VP9 + Opus): quality preset or target size in MB (8 / 16 / 25 …), resolution 1080p–360p, frame rate, remove sound; progress + cancel. Uses the browser’s WebCodecs encoder via Mediabunny (loaded from jsdelivr on first use); the video never leaves the browser.
- **Image to Text** (`ocr.html`) – OCR for screenshots, photos and scans: drop, choose or paste (Ctrl+V) images; English, Bangla or both. Offline engine = Tesseract.js (script + language data from jsdelivr on first use, image stays in the browser); optional Gemini AI engine with your own key for photos / handwriting. Editable result, keep lines or join paragraphs, copy or download .txt.

Open `index.html` (the Daily Report) in a browser – no build step.

## Structure

```
index.html            Daily Report page (opens first)
history.html          History page – saved reports from Google Drive
editor.html           Edit Document page
icons.html            Icon Generator page
convert.html          Image Converter page
resize.html           Image Resizer page
compress.html         Image Compressor page
video.html            Video Compressor page
ocr.html              Image to Text (OCR) page
policy.html           Privacy Policy (incl. Google API Limited Use disclosure)
service.html          Terms of Service
favicon.svg           site icon (wrench)
css/
  base.css            design tokens (light/dark), reset, forms, buttons
  layout.css          admin shell: sidebar, top bar, page header, responsive
  components.css      cards, tables, dialogs, toolbar, toast
  report.css          Daily Report page
  editor.css          Edit Document page
  icons.css           Icon Generator page
<<<<<<< HEAD
  convert.css         Image Converter, Resizer, Compressor + Video Compressor pages (uses icons.css layout)
=======
  convert.css         Image Converter, Resizer, Video Compressor + Image to Text pages (uses icons.css layout)
>>>>>>> 1507402 (feat: add Image to Text (OCR) functionality with UI and backend support)
  print.css           print styles
js/                   (classic scripts – load order matters)
  version.js          APP_VERSION + asset loader (never cached)
  layout.js           shared sidebar, top bar, Settings dialog (one TOOLS list)
  common.js           shared helpers ($, today, setBusy, storage keys)
  signature.js        embedded supervisor signature        (Daily Report)
  docx-builder.js     offline DOCX / ZIP builder
  report-form.js      report form state, rows, undo, autosave (Daily Report)
  report-csv.js       CSV import / template                 (Daily Report)
  gemini.js           Google Gemini helpers
  github.js           GitHub commit fetching
  report-actions.js   toolbar actions, DOCX / PDF export    (Daily Report)
  google-auth.js      Google sign-in shared by Docs fetch + Drive
  gdocs.js            "Fetch Google Doc" → report rows       (Daily Report)
  drive.js            Drive copies of downloads + listing   (Daily Report, History)
  history.js          saved reports list, search, download  (History)
  ui.js               settings dialog, status toast
  doc-editor.js       open / edit / re-save PDF & DOCX      (Edit Document)
  icon-gen.js         launcher icon rendering + ZIP         (Icon Generator)
  img-convert.js      PNG/JPG/WebP/AVIF conversion + ZIP    (Image Converter)
  img-resize.js       resize / crop / pad + KB limit + ZIP  (Image Resizer)
  img-compress.js     quality / KB target + palette PNG + ZIP (Image Compressor)
  video-compress.js   WebCodecs re-encode via Mediabunny    (Video Compressor)
  img-ocr.js          OCR via Tesseract.js or Gemini       (Image to Text)
  shell.js            mobile menu, theme, version badge, user card
```

## Fetch Google Doc

Only for **SQA Engineers**: the **⬇ Fetch Google Doc** button and the *Google Docs & Sheets* section of ⚙ Settings appear when
**Designation** (a select: Software Developer – the default – or SQA Engineer) is set to *SQA Engineer*.

Each person pastes the links of their own work Google Docs and/or Google Sheets in ⚙ Settings (one per line). **⬇ Fetch Google Doc** signs in with Google
(read-only `documents.readonly` + `spreadsheets.readonly`, plus `drive.file` for the Drive feature – token kept in this browser for ~1 hour), reads every doc and takes the part for the Reporting Date:

1. **Dated (best):** in a doc, every line / heading with that date (`09/11/2026`, `2026-11-09`, `9 Nov 2026`, …) up to the next date;
   in a sheet, every row with that date in a cell (with the column names). Sheets in a US locale read `11/09/2026` as MM/DD.
2. **No dates:** what was added or changed since the last fetch on an earlier day (a copy of the doc is kept in this browser).
3. **First fetch of an undated doc:** the end of the doc – Gemini guesses the latest work.

Gemini then writes the rows in one go (Work Source = the doc's title). Fetching again for the same day replaces those rows.

## Google Drive copies / History

When **⚙ Settings → Google Drive → Save downloads to Google Drive** is on (the default), **Download PDF** and **Download DOCX**
download the file as usual *and* save a copy in the user's **own** Google Drive, in a folder **Versatilo Daily Reports** that the
app creates. One file per Reporting Date and format: downloading the same date again replaces that copy. Switch it off to
download only.

The **History** page (sidebar) lists every saved report: newest date first, grouped by month, searchable, PDF / DOCX filter,
with **⬇ Download** and **Open in Drive**. If the Google sign-in from the last hour is still valid the list loads by itself,
otherwise click **Sign in with Google**.

Scope `drive.file`: the app can only see the files and folder it created, nothing else in the Drive. Files are found by
their `appProperties` tag (`versatilo=report`, `repDate=YYYY-MM-DD`, `format=pdf|docx`), so renaming or moving the folder in Drive is fine.

### One-time Google Cloud setup (admin)

The OAuth Client ID is `GOOGLE_CLIENT_ID` at the top of `js/google-auth.js`.

1. [console.cloud.google.com](https://console.cloud.google.com) → the project → **APIs & Services → Library** → enable **Google Docs API**, **Google Sheets API** and **Google Drive API**.
2. **OAuth consent screen**: User type *External*, app name, support email. Scopes: `.../auth/documents.readonly`, `.../auth/spreadsheets.readonly` and `.../auth/drive.file`.
   Publishing status *Testing* → add every team member's Google account under **Test users** (max 100).
3. **Credentials → OAuth client ID (Web application)** → Authorized JavaScript origins: `https://mostafizurmaruf.github.io`
   (add `http://localhost:8000` too for local testing). No redirect URI needed.

## Version / cache busting

The version is set in **one place** – `js/version.js`:

```js
window.APP_VERSION = '1.11.0';
```

Every page loads `js/version.js` with a fresh `?t=…` (so it is never cached), and every other CSS/JS file is loaded through `loadAssets()` with `?v=<APP_VERSION>`. The sidebar shows the same number next to the app name.
After changing any CSS/JS, bump `APP_VERSION` so browsers load the new files without Ctrl+F5.
To add a new CSS/JS file, add its path to the `loadAssets([...])` list in the page(s) that need it.
