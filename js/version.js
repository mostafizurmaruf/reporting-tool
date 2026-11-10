/* =====================================================================
   App version – the ONLY place to change it.
   Bump APP_VERSION after editing any CSS/JS: every file is loaded with
   ?v=<version>, so browsers fetch the new files without Ctrl+F5.
   The sidebar shows the same number.
   (Each page loads this tiny file with a fresh ?t=… so it is never cached.)
   ===================================================================== */
window.APP_VERSION = '1.12.0';

// Writes <link>/<script> tags in place (keeps order, blocks like normal tags)
window.loadAssets = files => files.forEach(f => document.write(f.endsWith('.css')
  ? `<link rel="stylesheet" href="${f}?v=${APP_VERSION}">`
  : `<script src="${f}?v=${APP_VERSION}"><\/script>`));
