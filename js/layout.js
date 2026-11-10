/* =====================================================================
   Shared page chrome for every page:
   sidebar, top bar and the Settings dialog. Each page (index.html = Daily Report, history.html, editor.html, icons.html) writes them in place with
   <script>Layout.sidebar('report')</script> etc., so the markup lives in one file.
   ===================================================================== */
const Layout = (() => {
  const PAGES = { report: 'Daily Report', history: 'History', editor: 'Edit Document', icons: 'Icon Generator' };
  const w = html => document.write(html);

  /* Workspace tools – the sidebar links are built from this list */
  const TOOLS = [
    { page: 'report', id: 'navReport', href: 'index.html', title: 'Daily Report', sub: 'Task &amp; performance',
      svg: '<path d="M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z"/><path d="M16 5h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2"/><path d="m9 13 2 2 4-4"/>' },
    { page: 'history', id: 'navHistory', href: 'history.html', title: 'History', sub: 'Saved reports in Drive',
      svg: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>' },
    { page: 'editor', id: 'navEditor', href: 'editor.html', title: 'Edit Document', sub: 'Upload PDF / DOCX &amp; edit',
      svg: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4"/><path d="M14 3v5h5v3"/><path d="M18.4 13.6a1.9 1.9 0 0 1 2.7 2.7L16 21.4l-3.4.7.7-3.4z"/>' },
    { page: 'icons', id: 'navIcons', href: 'icons.html', title: 'Icon Generator', sub: 'Android &amp; iOS app icons',
      svg: '<rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="12" cy="12" r="3.5"/>' },
  ];

  function sidebar(page) {
    const cur = p => p === page ? ' aria-current="page"' : '';
    w(`
  <aside class="sidebar" id="sidebar" aria-label="Main navigation">
    <a class="brand" href="index.html" title="Daily Report">
      <span class="logo" aria-hidden="true">V</span>
      <div><b>Versatilo <span class="ver" id="appVer"></span></b><small>Versatilo Tool</small></div>
    </a>

    <nav class="side-nav">
      <div class="nav-label">Workspace</div>
${TOOLS.map(t => `      <a class="nav-item" href="${t.href}" id="${t.id}"${cur(t.page)}>
        <svg viewBox="0 0 24 24" aria-hidden="true">${t.svg}</svg><span><b>${t.title}</b><small>${t.sub}</small></span>
      </a>`).join('\n')}

      <div class="nav-label">Preferences</div>
      <button type="button" class="nav-item" id="navSettings"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg><span><b>Settings</b><small>GitHub, Gemini, Docs &amp; Drive</small></span><span class="live" id="navDot" aria-label="Settings status">NULL</span></button>
      <button type="button" class="nav-item" id="themeBtn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg><span><b>Theme</b><small id="themeLabel">System</small></span></button>
    </nav>

    <div class="side-foot">
      <span class="avatar" id="sideAvatar" aria-hidden="true">?</span>
      <div><b id="sideName">Your name</b><small id="sideRole">Software Developer</small></div>
    </div>
  </aside>
  <div class="scrim" id="scrim" hidden></div>
`);
  }

  function topbar(page) {
    w(`
    <div class="topbar">
      <button type="button" class="menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>
      <div class="crumbs"><span>Versatilo Group</span><i aria-hidden="true">/</i><b id="crumbPage">${PAGES[page]}</b></div>
      <div class="top-right"><span class="chip"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg><span id="todayChip"></span></span></div>
    </div>
`);
  }

  function dialogs() {
    w(`
<dialog class="settings" id="settings" aria-labelledby="setTitle">
  <div class="set-head"><h3 id="setTitle">Settings</h3><button type="button" id="setClose" aria-label="Close">×</button></div>
  <div class="set-body">
    <div class="set-sec">
      <h4><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.6 22.4c.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.4 11.4 0 0 1 6 0C17.6 4.7 18.6 5 18.6 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.2c0 .3.2.7.8.6A11.5 11.5 0 0 0 12 .5z"/></svg>GitHub</h4>
      <div><label for="ghUser">GitHub username</label><input id="ghUser" autocomplete="off" placeholder="optional – read from token"></div>
      <div><label for="ghToken">GitHub token (<a href="https://github.com/settings/tokens/new?scopes=repo&amp;description=Daily%20Task%20Report" target="_blank" rel="noopener">create one</a> – needs <b>repo</b> scope for private repos)</label><input id="ghToken" type="password" autocomplete="off" placeholder="ghp_… – kept only in this browser"></div>
      <div class="hint">All repos the token can see, commits from every branch; merge commits skipped, duplicates removed. Without a token only each repo’s default branch is searched.</div>
    </div>
    <div class="set-sec">
      <h4><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1c.6 5.6 5.4 10.4 11 11-5.6.6-10.4 5.4-11 11-.6-5.6-5.4-10.4-11-11 5.6-.6 10.4-5.4 11-11z"/></svg>Google Gemini</h4>
      <div><label for="aiKey">Gemini API key (free: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>)</label><input id="aiKey" type="password" autocomplete="off" placeholder="Paste your key once – it is kept only in this browser"></div>
    </div>
    <div class="set-sec sqa-only">
      <h4><svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm-1 1.5L18.5 9H13zM8 13h8v1.5H8zm0 3h8v1.5H8zm0-6h4v1.5H8z"/></svg>Google Docs &amp; Sheets</h4>
      <div><label for="gdocUrl">Your work docs / sheets (Google Docs or Sheets links – one per line)</label><textarea id="gdocUrl" rows="3" autocomplete="off" spellcheck="false" placeholder="https://docs.google.com/document/d/…&#10;https://docs.google.com/spreadsheets/d/…"></textarea></div>
      <div class="hint">⬇ Fetch Google Doc signs in with Google once (read-only) and takes the part written on the Reporting Date – in a doc, under a date heading like 09/11/2026; in a sheet, the rows with that date in a Date column.</div>
    </div>
    <div class="set-sec">
      <h4><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.3 3h7.4l7 12-3.7 6.4H4.9L1.3 15zm.9 1.6L3.2 15l2.6 4.5L11.8 9zm6 0h-5.2l6.9 12h5.2zM7.6 19.8h11.6l-2.6-4.5H10.2z"/></svg>Google Drive</h4>
      <label class="check"><input type="checkbox" id="drvAuto"> Save downloads to Google Drive</label>
      <div class="hint">When on, Download PDF / Download DOCX also save the file in your own Google Drive (folder “Versatilo Daily Reports”, one file per Reporting Date). The History page lists them so you can download any earlier date. The app can only see the files it saved.</div>
    </div>
  </div>
  <div class="set-foot"><span class="msg" id="setMsg">Saved only in this browser.</span><button type="button" class="primary" id="setSave">Save</button></div>
</dialog>
<div class="toast" id="toast" aria-hidden="true"></div>
`);
  }

  return { PAGES, TOOLS, sidebar, topbar, dialogs };
})();
