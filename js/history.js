/* =====================================================================
   History page: the report PDFs / DOCX files saved in the user's own
   Google Drive (by drive.js when they download from the Daily Report).
   Lists them newest date first, grouped by month, with Download / Open.
   ===================================================================== */
(() => {
  const list = $('hiList'), empty = $('hiEmpty'), btn = $('hiLoad');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const p2 = n => String(n).padStart(2, '0');
  const when = t => { const x = new Date(t); return isNaN(x) ? '' : `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()} ${p2(x.getHours())}:${p2(x.getMinutes())}`; };
  const month = day => day ? new Date(day + 'T00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : 'No date';
  let files = null;

  function render() {
    if (!files) return;
    const f = $('hiFilter').value.trim().toLowerCase(), type = $('hiType').value, cur = today();
    const shown = files.filter(x => (!type || x.format === type) && (!f || `${x.repDate ? fmtDay(x.repDate) : ''} ${x.name}`.toLowerCase().includes(f)));
    let last = null;
    list.innerHTML = shown.map(x => {
      const m = month(x.repDate), head = m !== last ? `<li class="drv-month">${m}</li>` : '';
      last = m;
      return head + `<li${x.repDate === cur ? ' class="cur"' : ''}><span class="fmt ${x.format}">${x.format.toUpperCase()}</span>
        <div><b>${x.repDate ? fmtDay(x.repDate) : '—'}</b><small title="${esc(x.name)}">saved ${when(x.modifiedTime)} · ${esc(x.name)}</small></div>
        <button type="button" data-id="${esc(x.id)}" data-name="${esc(x.name)}">⬇ Download</button><a class="btn" href="${esc(x.webViewLink)}" target="_blank" rel="noopener">Open in Drive</a></li>`;
    }).join('');
    empty.hidden = shown.length > 0;
    empty.textContent = !files.length ? 'No reports saved yet. On the Daily Report, Download PDF / Download DOCX saves a copy here (⚙ Settings → Google Drive must be on).'
      : 'No saved report matches that search.';
    $('status').textContent = `${files.length} saved file${files.length === 1 ? '' : 's'} in Google Drive → “${Drive.FOLDER}”.`;
  }

  // tokP must come from GoogleAuth.token() called inside a click (or a saved token)
  function load(tokP) {
    setBusy(btn, true);
    $('status').textContent = 'Loading your saved reports…';
    tokP.then(Drive.list).then(r => { files = r; btn.textContent = '↻ Refresh'; render(); })
      .catch(e => { $('status').textContent = Drive.again(e).message; })
      .finally(() => setBusy(btn, false));
  }
  btn.onclick = () => { if (!btn.disabled) load(GoogleAuth.token()); };
  // Already signed in (token kept ~1 hour) → show the list straight away; otherwise wait for the button (the popup needs a click)
  if (GoogleAuth.hasToken()) load(GoogleAuth.token());

  $('hiFilter').oninput = render;
  $('hiType').onchange = render;
  list.addEventListener('click', e => {
    const b = e.target.closest('button[data-id]');
    if (!b || b.disabled) return;
    const tokP = GoogleAuth.token();
    setBusy(b, true);
    tokP.then(tok => Drive.file(tok, b.dataset.id)).then(blob => {
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = b.dataset.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('status').textContent = 'Downloaded ' + b.dataset.name;
    }).catch(e => { $('status').textContent = e.status === 404 ? 'That file is no longer in your Drive – click ↻ Refresh.' : Drive.again(e).message; })
      .finally(() => setBusy(b, false));
  });
})();
