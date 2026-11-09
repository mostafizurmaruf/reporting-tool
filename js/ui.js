/* ===== Settings modal ===== */
{
  const dlg = $('settings');
  const mark = () => $('setOpen').classList.toggle('missing', !$('ghToken').value.trim() && !$('ghUser').value.trim() || !$('aiKey').value.trim());
  $('setOpen').onclick = () => { $('setMsg').textContent = 'Saved only in this browser.'; dlg.showModal(); };
  $('setClose').onclick = $('setDone').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  ['ghSave', 'ghClear', 'aiSave', 'aiClear'].forEach(id => $(id).addEventListener('click', () => { $('setMsg').textContent = $('status').textContent; mark(); }));
  mark();
}
/* ===== Status toast: the status text stays in the bar and also pops up as a toast ===== */
{
  const src = document.getElementById('status'), el = document.getElementById('toast'); let hideT;
  const show = () => {
    const t = src.textContent.trim();
    el.textContent = t;
    if (!t) { el.classList.remove('show'); return; }
    el.classList.add('show'); clearTimeout(hideT);
    if (!t.endsWith('…')) hideT = setTimeout(() => el.classList.remove('show'), Math.min(8000, 2500 + t.length * 40));   // in-progress messages stay until replaced
  };
  new MutationObserver(show).observe(src, { childList: true, characterData: true, subtree: true });
  requestAnimationFrame(show);
}

