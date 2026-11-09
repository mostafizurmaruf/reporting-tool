/* =====================================================================
   App shell (every page): mobile menu, theme switch, version badge
   and sidebar user card. The markup itself comes from layout.js.
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

  /* ---------- App version (set once in js/version.js as APP_VERSION) ---------- */
  if (window.APP_VERSION) $('appVer').textContent = 'v' + APP_VERSION; else $('appVer').remove();

  /* ---------- Today chip ---------- */
  if ($('todayChip')) $('todayChip').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });

  /* ---------- Sidebar user card (Employee Name / Designation; saved values on other pages) ---------- */
  const syncUser = () => {
    const saved = savedEmployee();
    const name = $('empName') ? $('empName').value.trim() : saved.name, role = $('designation') ? $('designation').value.trim() : saved.role;
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
  ['input', 'change'].forEach(ev => document.addEventListener(ev, refresh));
  if ($('tasks')) new MutationObserver(refresh).observe($('tasks'), { childList: true });   // e.g. after CSV import / load
  refresh();
})();
