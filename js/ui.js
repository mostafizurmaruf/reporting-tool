/* ===== Settings modal ===== */
{
  const dlg = $('settings');
  // Sidebar badge: green LIVE when the saved settings are complete, NULL when a key is empty
  const mark = () => {
    const g = ghStore.get(), live = !!(g.token || g.user) && !!aiStore.get();
    const b = $('navDot');
    b.classList.toggle('on', live);
    b.textContent = live ? 'LIVE' : 'NULL';
  };
  // Inputs always show what is saved (unsaved edits are dropped when the dialog closes)
  const load = () => { const g = ghStore.get(); $('ghUser').value = g.user || ''; $('ghToken').value = g.token || ''; $('aiKey').value = aiStore.get(); };
  window.openSettings = () => { load(); $('setMsg').textContent = 'Saved only in this browser.'; dlg.showModal(); };
  $('setClose').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', load);
  $('setSave').onclick = () => {
    ghStore.set({ user: $('ghUser').value.trim(), token: $('ghToken').value.trim() });
    aiKeyMem = $('aiKey').value.trim(); aiStore.set(aiKeyMem);
    mark();
    $('status').textContent = 'Settings saved in this browser.';
    dlg.close();
  };
  mark();
}
/* ===== Status toast: the status text stays in the bar and also pops up as a toast ===== */
{
  const src = document.getElementById('status'), el = document.getElementById('toast'); let hideT;
  const show = () => {
    const t = src.textContent.trim();
    // Idle hints ("… saved automatically in this browser.") stay in the status bar only – no toast
    if (!t || /saved automatically in this browser\.$/.test(t)) { el.classList.remove('show'); return; }
    el.textContent = t;
    el.classList.add('show'); clearTimeout(hideT);
    if (!t.endsWith('…')) hideT = setTimeout(() => el.classList.remove('show'), Math.min(8000, 2500 + t.length * 40));   // in-progress messages stay until replaced
  };
  new MutationObserver(show).observe(src, { childList: true, characterData: true, subtree: true });
  requestAnimationFrame(show);
}

