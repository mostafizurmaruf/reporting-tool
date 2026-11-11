/* =====================================================================
   Image Converter page: PNG ⇄ JPG ⇄ WebP ⇄ AVIF (any image the browser
   can open goes in). Drawn on a canvas and re-encoded with toBlob, so it
   runs offline and nothing leaves the browser. Several files → one ZIP.
   ===================================================================== */
(() => {
  const SET_KEY = 'versatilo-convert-v1';
  const say = t => { $('status').textContent = t; };
  const st = { fmt: 'png', q: 90, bg: '#ffffff', scale: 100, max: 0 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };
  const LOSSY = new Set(['jpeg', 'webp', 'avif']);
  const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Which formats can this browser write? ---------- */
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const canWrite = t => probe.toDataURL('image/' + t).startsWith('data:image/' + t);
  const SUPPORTED = Object.fromEntries(Object.keys(EXT).map(f => [f, f === 'png' || canWrite(f)]));
  if (!SUPPORTED[st.fmt]) st.fmt = 'png';

  /* ---------- Controls ---------- */
  const fmtSeg = $('cvFmt');
  fmtSeg.querySelectorAll('button').forEach(b => {
    if (!SUPPORTED[b.dataset.v]) { b.disabled = true; b.title = 'Your browser cannot save this format (try Chrome)'; }
    b.onclick = () => { st.fmt = b.dataset.v; syncUi(); changed(); };
  });
  const range = (id, key, unit = '%') => {
    const el = $(id), out = $(id + 'Out');
    el.value = st[key]; out.textContent = st[key] + unit;
    el.oninput = () => { st[key] = +el.value; out.textContent = el.value + unit; changed(); };
  };
  range('cvQ', 'q'); range('cvScale', 'scale');
  $('cvBg').value = st.bg; $('cvBg').oninput = e => { st.bg = e.target.value; changed(); };
  $('cvMax').value = st.max || ''; $('cvMax').oninput = e => { st.max = Math.max(0, Math.round(+e.target.value || 0)); changed(); };

  function syncUi() {
    fmtSeg.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st.fmt));
    $('cvQRow').hidden = !LOSSY.has(st.fmt);
    $('cvBgRow').hidden = st.fmt !== 'jpeg';
    $('cvNote').textContent = st.fmt === 'png' ? 'PNG is lossless and keeps transparency – files are usually bigger.'
      : st.fmt === 'jpeg' ? 'JPG is smallest for photos. Transparent areas get the fill colour above.'
      : st.fmt === 'webp' ? 'WebP keeps transparency and is usually much smaller than PNG or JPG.'
      : 'AVIF gives the smallest files but saving is slower and older apps may not open it.';
    $('cvSave').textContent = items.length > 1 ? `Download all (ZIP) as ${EXT[st.fmt].toUpperCase()}` : `Download ${EXT[st.fmt].toUpperCase()}`;
  }

  /* ---------- Files ---------- */
  let items = [], seq = 0, timer = 0;   // {id, file, name, img, url, out: {blob, w, h} | null, err}

  async function addFiles(list) {
    const files = [...list].filter(f => /^image\//.test(f.type) || /\.(svg|ico|avif|bmp)$/i.test(f.name || ''));
    if (!files.length) { say('Please choose image files (PNG, JPG, WebP, GIF, SVG …).'); return; }
    say(`Opening ${files.length} image${files.length > 1 ? 's' : ''}…`);
    let bad = 0;
    for (const file of files) {
      const url = URL.createObjectURL(file), img = new Image();
      img.src = url;
      try { await img.decode(); }
      catch { URL.revokeObjectURL(url); bad++; continue; }
      const name = (file.name || 'pasted-image').replace(/\.[^.]+$/, '') || 'image';
      items.push({ id: ++seq, file, name, img, url, out: null, err: '' });
    }
    render();
    if (bad) say(`${bad} file${bad > 1 ? 's' : ''} could not be opened (HEIC / RAW photos are not supported by browsers).`);
    convertAll();
  }

  function targetSize(img) {
    let w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;   // SVG without a size → 1024
    const k1 = st.scale / 100, k2 = st.max ? Math.min(1, st.max / Math.max(w * k1, h * k1)) : 1;
    return [Math.max(1, Math.round(w * k1 * k2)), Math.max(1, Math.round(h * k1 * k2))];
  }

  async function convert(it) {
    const [w, h] = targetSize(it.img), c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (st.fmt === 'jpeg') { x.fillStyle = st.bg; x.fillRect(0, 0, w, h); }
    x.drawImage(it.img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/' + st.fmt, LOSSY.has(st.fmt) ? st.q / 100 : undefined));
    if (!blob || !blob.type.endsWith(st.fmt)) throw new Error(`Your browser cannot save ${EXT[st.fmt].toUpperCase()}`);
    return { blob, w, h, fmt: st.fmt };
  }

  let run = 0;
  async function convertAll() {
    const my = ++run;
    items.forEach(it => { it.out = null; it.err = ''; });
    render();
    for (const it of items) {
      if (my !== run) return;   // settings changed – a newer run took over
      try { it.out = await convert(it); } catch (e) { it.err = e.message; }
      if (my !== run) return;
      renderItem(it);
    }
    const ok = items.filter(i => i.out), before = ok.reduce((n, i) => n + i.file.size, 0), after = ok.reduce((n, i) => n + i.out.blob.size, 0);
    if (ok.length) say(`${ok.length} image${ok.length > 1 ? 's' : ''} ready as ${EXT[st.fmt].toUpperCase()} · ${kb(before)} → ${kb(after)}`);
    $('cvSave').disabled = !ok.length;
  }
  const changed = () => { save(); syncUi(); clearTimeout(timer); timer = setTimeout(() => items.length && convertAll(), 250); };

  /* ---------- List ---------- */
  function sizeLine(it) {
    const src = `${it.img.naturalWidth || '?'}×${it.img.naturalHeight || '?'} · ${kb(it.file.size)}`;
    if (it.err) return `<small class="err">${esc(it.err)}</small>`;
    if (!it.out) return `<small>${src} → converting…</small>`;
    const d = Math.round((it.out.blob.size / it.file.size - 1) * 100);
    return `<small>${src} → ${it.out.w}×${it.out.h} · ${kb(it.out.blob.size)} <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${d}%)</span></small>`;
  }
  function li(it) {
    return `<img src="${it.url}" alt=""><div class="cv-info"><b title="${esc(it.file.name || it.name)}">${esc(it.file.name || it.name)}</b>${sizeLine(it)}</div>
      <div class="cv-act"><button type="button" data-dl="${it.id}"${it.out ? '' : ' disabled'}>.${EXT[st.fmt]}</button><button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}">×</button></div>`;
  }
  function render() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvEmpty').hidden = !!items.length;
    $('cvClear').hidden = !items.length;
    $('cvSave').disabled = !items.some(i => i.out);
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it) { const el = $('cvList').querySelector(`li[data-id="${it.id}"]`); if (el) el.innerHTML = li(it); }

  $('cvList').onclick = e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (dl) { const it = items.find(i => i.id === +dl.dataset.dl); if (it?.out) download(it.out.blob, `${it.name}.${EXT[it.out.fmt]}`); }
    if (rm) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); render(); }
    }
  };
  $('cvClear').onclick = () => { run++; items.forEach(i => URL.revokeObjectURL(i.url)); items = []; render(); };

  /* ---------- Download ---------- */
  function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('cvSave').onclick = async () => {
    const ok = items.filter(i => i.out);
    if (!ok.length) return;
    if (ok.length === 1) { download(ok[0].out.blob, `${ok[0].name}.${EXT[ok[0].out.fmt]}`); return; }
    const used = new Set(), files = [];
    for (const it of ok) {
      let n = `${it.name}.${EXT[it.out.fmt]}`, k = 2;
      while (used.has(n.toLowerCase())) n = `${it.name}-${k++}.${EXT[it.out.fmt]}`;
      used.add(n.toLowerCase());
      files.push({ name: n, data: new Uint8Array(await it.out.blob.arrayBuffer()) });
    }
    download(new Blob([DOCX.zip(files)], { type: 'application/zip' }), `converted-${EXT[st.fmt]}-${today()}.zip`);
    say(`ZIP with ${files.length} images downloaded.`);
  };

  /* ---------- Input: picker, drag & drop, paste ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input, textarea, dialog')) return;
    const f = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (f.length) { e.preventDefault(); addFiles(f); }
  });

  render();
})();
