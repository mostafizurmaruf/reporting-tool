/* =====================================================================
   Image to Text page (OCR).
   Offline: Tesseract.js runs in a web worker in the browser – the script
   and the English / Bangla language data come from jsdelivr on first use
   (then the browser caches them); the image is never uploaded.
   Gemini: the image is sent to Google Gemini with the user's own key
   (better for handwriting, photos and mixed Bangla / English).
   ===================================================================== */
(() => {
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const SET_KEY = 'versatilo-ocr-v1';
  const say = t => { $('status').textContent = t; };
  const st = { engine: 'offline', lang: 'eng+ben', lines: 'keep' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const kb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const words = t => (t.match(/\S+/g) || []).length;

  /* ---------- Tesseract (loaded on first use, one worker kept per language set) ---------- */
  let tessLoading = null, worker = null, workerLang = '', onLog = null;
  const tess = () => window.Tesseract ? Promise.resolve(window.Tesseract) : (tessLoading ||= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: TESS_URL, async: true });
    s.onload = () => ok(window.Tesseract);
    s.onerror = () => { tessLoading = null; s.remove(); fail(new Error('Could not load the OCR library – check your internet connection.')); };
    document.head.appendChild(s);
  }));
  async function getWorker(lang) {
    if (worker && workerLang === lang) return worker;
    if (worker) { await worker.terminate().catch(() => {}); worker = null; }
    const T = await tess();
    worker = await T.createWorker(lang, 1, { logger: m => onLog?.(m) });
    workerLang = lang;
    return worker;
  }

  /* ---------- Image prep: small screenshots are upscaled (Tesseract wants ~30 px letters), huge photos shrunk ---------- */
  async function toCanvas(file, maxSide) {
    const bmp = await createImageBitmap(file).catch(() => null);
    let img = bmp;
    if (!img) {   // e.g. SVG – fall back to an <img>
      img = new Image(); img.src = URL.createObjectURL(file);
      try { await img.decode(); } catch { throw new Error('This image could not be opened.'); } finally { URL.revokeObjectURL(img.src); }
    }
    const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight, big = Math.max(w, h);
    const k = big < 1200 ? Math.min(2, 2400 / big) : big > maxSide ? maxSide / big : 1;
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);   // transparent PNGs → white page
    g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    bmp?.close?.();
    return c;
  }

  // "Join paragraphs": lines inside a paragraph become one line, blank lines stay, "exam-\nple" → "example"
  const tidy = t => {
    t = t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return st.lines === 'join' ? t.split(/\n{2,}/).map(p => p.replace(/(\w)-\n(\w)/g, '$1$2').replace(/\n/g, ' ')).join('\n\n') : t;
  };

  async function readOffline(it) {
    onLog = m => {
      if (m.status === 'recognizing text') { it.p = m.progress; it.phase = ''; }
      else if (/loading|initializ/.test(m.status)) { it.phase = /language/.test(m.status) ? 'downloading language data (first time only)…' : 'starting the OCR engine…'; it.p = 0; }
      renderProgress(it);
    };
    try {
      const w = await getWorker(st.lang);
      const { data } = await w.recognize(await toCanvas(it.file, 4000));
      return { text: data.text || '', conf: Math.round(data.confidence || 0) };
    } finally { onLog = null; }
  }

  async function readGemini(it) {
    it.phase = 'Gemini is reading the image…'; it.p = 0; renderProgress(it);
    const c = await toCanvas(it.file, 2048);
    const b64 = c.toDataURL('image/jpeg', 0.92).split(',')[1];
    const prompt = `Transcribe ALL the text in this image exactly as written (OCR). It may be English, Bangla (Bengali script) or a mix – keep every word in its original language and script; do not translate, correct, summarise or add anything.
Return a JSON array of strings: one string per line of text, in natural reading order (top to bottom, columns left to right). Use an empty string "" for a blank line between paragraphs or sections. For a table, put one row per string with cells separated by " | ".
If the image has no readable text, return an empty array.`;
    const lines = await callGemini(prompt, { type: 'ARRAY', items: { type: 'STRING' } }, null, [b64]);
    return { text: lines.map(l => String(l ?? '')).join('\n'), conf: 0 };
  }

  /* ---------- Controls ---------- */
  const SEGS = [['ocEngine', 'engine'], ['ocLang', 'lang'], ['ocLines', 'lines']];
  for (const [id, key] of SEGS)
    $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { st[key] = b.dataset.v; changed(key); }; });

  const hasKey = () => !!($('aiKey').value.trim() || aiKeyMem);
  function syncUi() {
    for (const [id, key] of SEGS) $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st[key]));
    document.querySelectorAll('[data-eng]').forEach(r => { r.hidden = r.dataset.eng !== st.engine; });
    $('cvNote').textContent = st.engine === 'gemini'
      ? 'Gemini AI – best for photos, handwriting and mixed Bangla / English. The image is sent to Google Gemini with your own API key' + (hasKey() ? '.' : ' – add the key in ⚙ Settings first.')
      : 'Offline – the image stays in your browser. The first run downloads the language data (English ≈ 4 MB, Bangla ≈ 1 MB), later runs are instant. Clear, straight screenshots give the best result.';
    const busy = running, todo = items.filter(i => i.text == null && !i.err).length, done = items.filter(i => i.text != null).length;
    $('ocGo').disabled = !items.length || busy;
    $('ocGo').textContent = busy ? 'Reading…' : todo || !done ? `Extract text${items.length > 1 ? ' from all' : ''}` : 'Extract again';
    $('ocCopyAll').hidden = $('ocSaveAll').hidden = !done;
    $('ocCopyAll').textContent = done > 1 ? `Copy all (${done})` : 'Copy text';
    $('cvClear').hidden = !items.length || busy;
  }
  const changed = key => {
    save();
    // a different engine / language means the old text is stale; "Lines" is re-applied to the raw text without reading again
    if (!running) items.forEach(it => {
      if (key === 'lines') { if (it.raw != null) { it.text = tidy(it.raw); renderItem(it, true); } }
      else if (it.text != null || it.err) { it.text = it.raw = null; it.err = ''; it.p = 0; renderItem(it, true); }
    });
    syncUi();
  };

  /* ---------- Files ---------- */
  let items = [], seq = 0, running = false;   // item: {id, file, name, url, raw, text, conf, ms, err, p, phase}

  function addFiles(list) {
    const files = [...list].filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif|avif|tiff?)$/i.test(f.name || ''));
    if (!files.length) { say('Please choose image files (PNG, JPG, WebP …).'); return; }
    for (const file of files) items.push({ id: ++seq, file, name: (file.name || 'image').replace(/\.[^.]+$/, '') || 'image', url: URL.createObjectURL(file), raw: null, text: null, conf: 0, ms: 0, err: '', p: 0, phase: '' });
    renderList();
    say(`${items.length} image${items.length > 1 ? 's' : ''} ready – press Extract text.`);
    if (st.engine === 'offline') tess().catch(() => {});   // warm up the library
  }

  async function runAll() {
    if (running) return;
    if (st.engine === 'gemini' && !hasKey()) {
      openSettings(); $('setMsg').textContent = 'Add your Gemini API key to read images with Gemini, then Save.'; $('aiKey').focus();
      return;
    }
    let queue = items.filter(i => i.text == null);
    if (!queue.length) { items.forEach(i => { i.text = i.raw = null; i.err = ''; }); queue = [...items]; renderList(); }
    running = true; syncUi();
    let n = 0;
    for (const it of queue) {
      if (!items.includes(it)) continue;   // removed while waiting
      n++; say(`Reading ${n} of ${queue.length}: ${it.file.name}…`);
      it.err = ''; it.p = 0; it.phase = ''; renderItem(it, true);
      const t0 = performance.now();
      try {
        const r = st.engine === 'gemini' ? await readGemini(it) : await readOffline(it);
        it.raw = r.text; it.conf = r.conf; it.text = tidy(r.text); it.ms = performance.now() - t0;
      } catch (e) {
        it.err = e.message || String(e);
        if (st.engine === 'offline') { await worker?.terminate().catch(() => {}); worker = null; }   // a failed worker may be stuck
      }
      it.p = 0; it.phase = '';
      renderItem(it, true);
    }
    running = false;
    const ok = items.filter(i => i.text != null), empty = ok.filter(i => !i.text.trim()).length, total = ok.reduce((s, i) => s + words(i.text), 0);
    say(!ok.length ? 'No text was extracted.'
      : `Done · ${total} word${total === 1 ? '' : 's'} from ${ok.length} image${ok.length > 1 ? 's' : ''}` + (empty ? ` · no text found in ${empty}` : '') + ' – check it before using.');
    syncUi();
  }
  $('ocGo').onclick = runAll;

  /* ---------- List ---------- */
  function line(it) {
    const src = kb(it.file.size);
    if (it.err) return `<small>${src}</small><small class="err">${esc(it.err)}</small>`;
    if (it.text != null) {
      if (!it.text.trim()) return `<small>${src}</small><small class="err">No text found – try a sharper / larger image${st.engine === 'offline' ? ', the other language, or Gemini AI' : ''}.</small>`;
      const low = st.engine === 'offline' && it.conf && it.conf < 60;
      return `<small>${src} · <b>${words(it.text)} words</b>${it.conf ? ` · ${it.conf}% sure` : ''} · ${(it.ms / 1000).toFixed(1)} s</small>`
        + (low ? `<small class="err">Low confidence – the text may have mistakes. Gemini AI usually does better on photos.</small>` : '');
    }
    const active = running && (it.p || it.phase);
    return `<small>${src}${running ? '' : ' · ready'}</small>` + (active ? progressHtml(it) : '');
  }
  const progressHtml = it => it.phase
    ? `<small class="vc-pct">${esc(it.phase)}</small>`
    : `<div class="vc-bar"><i style="width:${(it.p * 100).toFixed(1)}%"></i></div><small class="vc-pct">${Math.round(it.p * 100)}%</small>`;
  function li(it) {
    const has = it.text != null && it.text.trim();
    return `<img src="${it.url}" alt="" aria-hidden="true">
      <div class="cv-info"><b title="${esc(it.file.name)}">${esc(it.file.name)}</b><div data-line>${line(it)}</div></div>
      <div class="cv-act"><button type="button" data-copy="${it.id}"${has ? '' : ' disabled'}>Copy</button><button type="button" data-dl="${it.id}"${has ? '' : ' disabled'}>.txt</button><button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}"${running ? ' disabled' : ''}>×</button></div>
      <textarea class="oc-text" data-text="${it.id}" rows="7" spellcheck="false" aria-label="Text from ${esc(it.name)}"${has ? '' : ' hidden'}>${esc(has ? it.text : '')}</textarea>`;
  }
  function renderList() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvEmpty').hidden = !!items.length;
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it, withText) {   // keeps the thumbnail; the textarea is only rebuilt when the text itself changed
    const el = $('cvList').querySelector(`li[data-id="${it.id}"]`);
    if (!el) return;
    const tmp = document.createElement('li'); tmp.innerHTML = li(it);
    el.querySelector('[data-line]').innerHTML = tmp.querySelector('[data-line]').innerHTML;
    el.querySelector('.cv-act').replaceWith(tmp.querySelector('.cv-act'));
    if (withText) el.querySelector('.oc-text').replaceWith(tmp.querySelector('.oc-text'));
    syncUi();
  }
  function renderProgress(it) {
    const el = $('cvList').querySelector(`li[data-id="${it.id}"]`);
    const bar = el?.querySelector('.vc-bar i'), pct = el?.querySelector('.vc-pct');
    if (!bar || it.phase) return renderItem(it);
    bar.style.width = (it.p * 100).toFixed(1) + '%'; pct.textContent = Math.round(it.p * 100) + '%';
  }

  // edits in the text box are kept (and used by Copy / .txt)
  $('cvList').addEventListener('input', e => {
    const ta = e.target.closest('[data-text]'); if (!ta) return;
    const it = items.find(i => i.id === +ta.dataset.text); if (it) it.text = ta.value;
  });

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); say(`${what} copied.`); }
    catch { say('Could not copy – select the text and press Ctrl+C.'); }
  }
  function download(text, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  const allText = () => {
    const ok = items.filter(i => i.text != null && i.text.trim());
    return ok.length === 1 ? ok[0].text : ok.map(i => `===== ${i.file.name} =====\n${i.text.trim()}`).join('\n\n');
  };

  $('cvList').onclick = e => {
    const cp = e.target.closest('[data-copy]'), dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    const find = b => items.find(i => i.id === +b.dataset[Object.keys(b.dataset)[0]]);
    if (cp) { const it = find(cp); if (it?.text) copy(it.text, 'Text'); }
    if (dl) { const it = find(dl); if (it?.text) download(it.text, `${it.name}.txt`); }
    if (rm && !running) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); renderList(); }
    }
  };
  $('cvClear').onclick = () => { if (running) return; items.forEach(i => URL.revokeObjectURL(i.url)); items = []; renderList(); };
  $('ocCopyAll').onclick = () => { const t = allText(); if (t) copy(t, 'All text'); };
  $('ocSaveAll').onclick = () => { const t = allText(); if (!t) return; const ok = items.filter(i => i.text?.trim()); download(t, ok.length === 1 ? `${ok[0].name}.txt` : 'image-text.txt'); };
  window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Input: picker, drag & drop, paste ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', e => {
    if (e.target.closest?.('input, textarea, [contenteditable]')) return;   // normal paste into a field
    const files = [...(e.clipboardData?.items || [])].filter(i => i.kind === 'file' && /^image\//.test(i.type)).map(i => i.getAsFile()).filter(Boolean);
    if (!files.length) return;
    e.preventDefault();
    const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, '-');
    addFiles(files.map((f, i) => new File([f], `pasted-${stamp}${files.length > 1 ? '-' + (i + 1) : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type })));
  });

  renderList();
})();
