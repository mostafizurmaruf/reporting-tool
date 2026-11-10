/* =====================================================================
   Google Drive copies of the reports (Daily Report + History pages).
   - Daily Report: "Download PDF" / "Download DOCX" also save the file in
     the user's OWN Google Drive (⚙ Settings → "Save downloads to Google
     Drive"), in a folder "Versatilo Daily Reports" that this app creates.
     One file per Reporting Date and format – saving again replaces it.
   - History page (history.html / history.js): lists the saved reports.
   Scope drive.file: the app sees only the files it made, nothing else.
   ===================================================================== */
const Drive = (() => {
  const API = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const FOLDER = 'Versatilo Daily Reports', FOLDER_MIME = 'application/vnd.google-apps.folder';
  const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  const api = (url, tok, opts, raw) => GoogleAuth.api(url, tok, 'Drive', opts, raw);
  const q = s => encodeURIComponent(s);
  const again = e => { if (e.expired) e.message += ' Click again to sign in.'; return e; };
  const fmtOf = f => f.appProperties?.format || 'pdf';   // files saved before DOCX support are PDFs

  // Load the sign-in library early, so the popup opens right inside the click
  GoogleAuth.load().catch(() => {});

  /* ---------- Save ---------- */
  // Folder is found by its app tag, so renaming / moving it in Drive is fine
  async function folderId(tok) {
    const found = await api(`${API}?q=${q(`appProperties has { key='versatilo' and value='reports' } and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id)&pageSize=1`, tok);
    if (found.files?.length) return found.files[0].id;
    const made = await api(`${API}?fields=id`, tok, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_MIME, appProperties: { versatilo: 'reports' } }) });
    return made.id;
  }
  // Multipart upload: metadata + file in one request
  function upload(url, method, meta, blob, mime, tok) {
    const b = 'vrs' + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${b}--`]);
    return api(`${url}?uploadType=multipart&fields=id`, tok, { method, headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  }
  // tokP must come from GoogleAuth.token() called inside the click. Resolves to true when an older copy was replaced.
  async function save(tokP, blob, name, repDate, format) {
    const tok = await tokP, folder = await folderId(tok), mime = MIME[format];
    const same = await api(`${API}?q=${q(`'${folder}' in parents and appProperties has { key='repDate' and value='${repDate}' } and trashed=false`)}&fields=files(id,appProperties)`, tok);
    const old = (same.files || []).find(f => fmtOf(f) === format);
    const props = { versatilo: 'report', repDate, format };
    if (old) { await upload(`${UPLOAD}/${old.id}`, 'PATCH', { name, mimeType: mime, appProperties: props }, blob, mime, tok); return true; }
    await upload(UPLOAD, 'POST', { name, mimeType: mime, parents: [folder], appProperties: props }, blob, mime, tok);
    return false;
  }
  // Used by the download buttons: start sign-in now (inside the click) when the setting is on, else null
  const begin = () => driveStore.get() ? GoogleAuth.token() : null;
  // After a download: save the copy and report the result in the status bar
  function copy(tokP, blob, name, repDate, format) {
    if (!tokP) return;
    $('status').textContent = `Downloaded ${name} – saving a copy to Google Drive…`;
    save(tokP, blob, name, repDate, format)
      .then(replaced => { $('status').textContent = `Downloaded ${name} and ${replaced ? 'updated' : 'saved'} it in Google Drive → “${FOLDER}”.`; })
      .catch(e => { console.error(e); $('status').textContent = `Downloaded ${name}, but it was not saved to Google Drive: ${again(e).message}`; });
  }

  /* ---------- Used by the History page ---------- */
  // Every saved report, newest Reporting Date first
  async function list(tok) {
    const out = []; let page = '';
    do {
      const r = await api(`${API}?q=${q(`appProperties has { key='versatilo' and value='report' } and trashed=false`)}&fields=nextPageToken,files(id,name,modifiedTime,webViewLink,appProperties)&pageSize=200${page ? '&pageToken=' + q(page) : ''}`, tok);
      out.push(...(r.files || [])); page = r.nextPageToken || '';
    } while (page);
    return out.map(f => ({ ...f, repDate: f.appProperties?.repDate || '', format: fmtOf(f) }))
      .sort((a, b) => b.repDate.localeCompare(a.repDate) || b.format.localeCompare(a.format));   // PDF before DOCX
  }
  // One saved file → Blob
  const file = (tok, id) => api(`${API}/${id}?alt=media`, tok, {}, true).then(r => r.blob());

  return { FOLDER, begin, copy, list, file, again };

})();
