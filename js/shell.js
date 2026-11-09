/* =====================================================================
   App shell: sidebar navigation, mobile menu, theme switch,
   breadcrumb and sidebar user card.
   Loaded last – it only reads what the other scripts render.
   ===================================================================== */
(() => {
  const body = document.body;
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} } };

  /* ---------- Mobile off-canvas sidebar ---------- */
  const menuBtn = $('menuBtn'), scrim = $('scrim');
  const setNav = open => {
    body.classList.toggle('nav-open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', open);
  };
  menuBtn.onclick = () => setNav(!body.classList.contains('nav-open'));
  scrim.onclick = () => setNav(false);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && body.classList.contains('nav-open')) setNav(false); });
  ['modeReport', 'modeDocs'].forEach(id => $(id).addEventListener('click', () => { setNav(false); scrollTo({ top: 0 }); }));

  /* ---------- Breadcrumb follows the active tool ---------- */
  const syncCrumb = () => { $('crumbPage').textContent = body.classList.contains('docmode') ? 'SQA Tool' : 'Daily Report'; };
  new MutationObserver(syncCrumb).observe(body, { attributes: true, attributeFilter: ['class'] });
  syncCrumb();

  /* ---------- Settings (sidebar item; LIVE / NULL badge is kept up to date by ui.js) ---------- */
  $('navSettings').onclick = () => { setNav(false); openSettings(); };

  /* ---------- Theme: System → Light → Dark ---------- */
  const THEME_KEY = 'versatilo-theme', ORDER = ['', 'light', 'dark'], NAME = { '': 'System', light: 'Light', dark: 'Dark' };
  const applyTheme = t => {
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    $('themeLabel').textContent = NAME[t];
  };
  let theme = ls.get(THEME_KEY) || '';
  if (!(theme in NAME)) theme = '';
  applyTheme(theme);
  $('themeBtn').onclick = () => { theme = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]; ls.set(THEME_KEY, theme); applyTheme(theme); };

  /* ---------- Today chip ---------- */
  $('todayChip').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  /* ---------- Sidebar user card (from Employee Name / Designation) ---------- */
  const syncUser = () => {
    const name = $('empName').value.trim(), role = $('designation').value.trim();
    $('sideName').textContent = name || 'Your name';
    $('sideRole').textContent = role || 'Employee';
    $('sideAvatar').textContent = name ? name.split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() : '?';
  };

  /* Refresh everything at most once per frame after any edit */
  let queued = false;
  const refresh = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; syncUser(); });
  };
  ['input', 'change', 'click', 'report:summary'].forEach(ev => document.addEventListener(ev, refresh));
  new MutationObserver(refresh).observe($('tasks'), { childList: true });
  new MutationObserver(refresh).observe($('mEditor'), { childList: true });
  refresh();
})();
