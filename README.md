# Simple Reporting Tool

Admin-panel style tool with two pages in the sidebar:

- **Daily Report** – daily task assignment & performance report (CSV import, GitHub commits, Gemini, PDF / DOCX export)
- **SQA Tool** – module-by-module feature documentation (Google Docs copy, DOCX, print)

Open `index.html` in a browser – no build step.

## Structure

```
index.html            layout: sidebar, top bar, both pages, dialogs
css/
  base.css            design tokens (light/dark), reset, forms, buttons
  layout.css          admin shell: sidebar, top bar, page header, responsive
  components.css      cards, stat tiles, tables, dialogs, toolbar, toast
  report.css          Daily Report page
  sqa.css             SQA Tool page
  print.css           print styles
js/                   (classic scripts – load order matters)
  signature.js        embedded supervisor signature
  docx-builder.js     offline DOCX / ZIP builder
  report-form.js      report form state, rows, undo, autosave
  report-csv.js       CSV import / template
  gemini.js           Google Gemini helpers
  github.js           GitHub commit fetching
  report-actions.js   toolbar actions, DOCX / PDF export, startup
  ui.js               settings dialog, status toast
  sqa.js              SQA documentation builder + page switch
  shell.js            sidebar, mobile menu, theme, stat tiles
```
