/* =====================================================================
   Image Resizer page: percentage / exact pixels / preset sizes with
   keep-ratio, crop, pad or stretch; optional max file size (KB) that
   lowers JPG / WebP quality until the file fits. Canvas only – offline.
   Uses the same list markup + styles as the Image Converter page.
   ===================================================================== */
(() => {
  const SET_KEY = 'versatilo-resize-v2';   // v2: default fit = exact size + background
  const say = t => { $('status').textContent = t; };
  const st = { mode: 'percent', pct: 50, w: 0, h: 0, preset: 0, lock: false, lockBy: 'w', fit: 'pad', bg: '#ffffff', bgMode: 'transparent', noUp: true, fmt: 'same', q: 90, kb: 0 };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const PRESETS = [
    ['Full HD', 1920, 1080], ['HD', 1280, 720], ['4K UHD', 3840, 2160],
    ['Instagram post (square)', 1080, 1080], ['Instagram portrait', 1080, 1350], ['Instagram / FB story', 1080, 1920],
    ['Facebook post', 1200, 630], ['Facebook cover', 1640, 624], ['YouTube thumbnail', 1280, 720], ['YouTube banner', 2560, 1440],
    ['LinkedIn banner', 1584, 396], ['X / Twitter header', 1500, 500], ['Open Graph image', 1200, 630],
    ['Profile picture', 400, 400], ['Passport photo (2×2 in, 300 dpi)', 600, 600], ['A4 (150 dpi)', 1240, 1754], ['Favicon', 512, 512],
  ];
  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
  const LOSSY = new Set(['jpeg', 'webp']);
  const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const outFmt = it => st.fmt !== 'same' ? st.fmt : ({ 'image/jpeg': 'jpeg', 'image/webp': 'webp' }[it.file.type] || 'png');

  /* ---------- Controls ---------- */
  const seg = (id, key) => $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { st[key] = b.dataset.v; changed(); }; });
  seg('rzMode', 'mode'); seg('rzFit', 'fit'); seg('rzFmt', 'fmt'); seg('rzBgMode', 'bgMode');
  const range = (id, key) => {
    const el = $(id), out = $(id + 'Out');
    el.value = st[key]; out.textContent = st[key] + '%';
    el.oninput = () => { st[key] = +el.value; out.textContent = el.value + '%'; changed(); };
  };
  range('rzPct', 'pct'); range('rzQ', 'q');
  const num = (id, key) => { $(id).value = st[key] || ''; $(id).oninput = e => { st[key] = Math.max(0, Math.round(+e.target.value || 0)); changed(); }; };
  num('rzKb', 'kb');
  if (st.fit === 'contain') st.fit = 'pad';
  /* Width × height: with the ratio lock on, typing one side fills in the other from the (first) image */
  $('rzW').value = st.w || ''; $('rzH').value = st.h || '';
  const side = (id, key) => { $(id).oninput = e => { st[key] = Math.max(0, Math.round(+e.target.value || 0)); st.lockBy = key; fillOther(); changed(); }; };
  side('rzW', 'w'); side('rzH', 'h');
  $('rzLock').onclick = () => { st.lock = !st.lock; if (!st[st.lockBy]) st.lockBy = st.lockBy === 'w' ? 'h' : 'w'; fillOther(); changed(); };
  const ref = () => items[0]?.img;
  const ratio = img => (img.naturalHeight || 1024) / (img.naturalWidth || 1024);   // h / w
  function fillOther() {   // show the calculated side in its field (locked) or as a hint (unlocked, empty)
    const img = ref();
    $('rzW').placeholder = $('rzH').placeholder = 'auto';
    if (!img) return;
    const r = ratio(img);
    if (st.lock) {
      if (st.lockBy === 'w' && st.w) { st.h = Math.max(1, Math.round(st.w * r)); $('rzH').value = st.h; }
      else if (st.lockBy === 'h' && st.h) { st.w = Math.max(1, Math.round(st.h / r)); $('rzW').value = st.w; }
    } else if (st.w && !st.h) $('rzH').placeholder = 'auto · ' + Math.max(1, Math.round(st.w * r));
    else if (st.h && !st.w) $('rzW').placeholder = 'auto · ' + Math.max(1, Math.round(st.h / r));
  }
  $('rzPreset').innerHTML = PRESETS.map(([n, w, h], i) => `<option value="${i}">${n} – ${w}×${h}</option>`).join('');
  $('rzPreset').value = st.preset; $('rzPreset').onchange = e => { st.preset = +e.target.value; changed(); };
  $('rzBg').value = st.bg; $('rzBg').oninput = e => { st.bg = e.target.value; st.bgMode = 'color'; changed(); };
  $('rzSwatches').innerHTML = ['#ffffff', '#000000', '#f3f4f6', '#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#7c3aed']
    .map(c => `<button type="button" style="background:${c}" data-c="${c}" aria-label="${c}"></button>`).join('');
  $('rzSwatches').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; st.bg = $('rzBg').value = b.dataset.c; st.bgMode = 'color'; changed(); };
  $('rzNoUp').checked = st.noUp; $('rzNoUp').onchange = e => { st.noUp = e.target.checked; changed(); };

  function box() {   // target [W, H] for px / preset (0 = auto)
    if (st.mode === 'preset') { const p = PRESETS[st.preset] || PRESETS[0]; return [p[1], p[2]]; }
    if (st.lock) return st.lockBy === 'w' ? [st.w, 0] : [0, st.h];   // the typed side only – each image keeps its own ratio
    return [st.w, st.h];
  }
  function syncUi() {
    for (const [id, key] of [['rzMode', 'mode'], ['rzFit', 'fit'], ['rzFmt', 'fmt'], ['rzBgMode', 'bgMode']])
      $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st[key]));
    document.querySelectorAll('[data-mode]').forEach(r => { r.hidden = !r.dataset.mode.split(' ').includes(st.mode); });
    const [W, H] = box(), both = W && H;
    $('rzLock').setAttribute('aria-pressed', st.lock);
    if (st.mode === 'px' && !both) $('rzFitRow').hidden = true;   // only one side → ratio is kept, nothing to fit
    const fit = both ? st.fit : 'contain';
    const padding = st.mode !== 'percent' && fit === 'pad';
    const anyJpg = st.fmt === 'jpeg' || (st.fmt === 'same' && items.some(i => outFmt(i) === 'jpeg'));
    const allJpg = st.fmt === 'jpeg' || (st.fmt === 'same' && items.length && items.every(i => outFmt(i) === 'jpeg'));
    $('rzBgMode').querySelector('[data-v=transparent]').disabled = allJpg;
    const bgColor = st.bgMode === 'color' || allJpg;
    $('rzBgPick').hidden = !bgColor;
    $('rzBgNote').textContent = allJpg ? 'JPG cannot be transparent – the background colour is used. Choose PNG or WebP for transparency.'
      : (anyJpg && st.bgMode === 'transparent' ? 'JPG files get the colour (white by default); PNG / WebP stay transparent. ' : '')
      + (padding ? 'The empty sides around the image get this background.' : 'Transparent parts of the image get this background.');
    const anyLossy = st.fmt === 'same' ? items.some(i => LOSSY.has(outFmt(i))) || !items.length : LOSSY.has(st.fmt);
    $('rzQRow').hidden = $('rzKbRow').hidden = !anyLossy;
    $('cvNote').textContent = st.mode === 'percent' ? `Every image becomes ${st.pct}% of its own size.`
      : !W && !H ? 'Enter a width, a height, or both.'
      : !both ? (() => {
          const img = ref(), o = img && (W ? Math.round(W * ratio(img)) : Math.round(H / ratio(img)));
          const size = W ? `${W} × ${o || 'auto'}` : `${o || 'auto'} × ${H}`;
          return `Ratio kept → ${size} px` + (img ? (items.length > 1 ? ` for ${items[0].file.name || 'the first image'}; other images keep their own ratio (see the list).` : '.') : ' – add an image to see the other side.');
        })()
      : {
          cover: `Exactly ${W}×${H} – fills the frame and crops the edges from the centre.`,
          pad: `Exactly ${W}×${H} – the whole image is kept and the empty sides are filled with the pad colour.`,
          stretch: `Exactly ${W}×${H} – the image is stretched, so it may look squashed.` }[fit];
    const n = items.length;
    $('cvSave').textContent = n > 1 ? `Download all (ZIP)` : 'Download';
  }

  /* ---------- Geometry ---------- */
  // returns canvas size + where to draw the source: {cw, ch, sx, sy, sw, sh, dx, dy, dw, dh, pad}
  function plan(img) {
    const iw = img.naturalWidth || 1024, ih = img.naturalHeight || 1024;
    const full = { sx: 0, sy: 0, sw: iw, sh: ih };
    const clampUp = k => st.noUp ? Math.min(1, k) : k;
    const R = v => Math.max(1, Math.round(v));
    if (st.mode === 'percent') {
      const k = clampUp(st.pct / 100), cw = R(iw * k), ch = R(ih * k);
      return { cw, ch, ...full, dx: 0, dy: 0, dw: cw, dh: ch };
    }
    const [W, H] = box();
    if (!W && !H) return { cw: iw, ch: ih, ...full, dx: 0, dy: 0, dw: iw, dh: ih };
    const fit = W && H ? st.fit : 'contain';
    if (fit === 'contain') {
      const k = clampUp(Math.min(W ? W / iw : Infinity, H ? H / ih : Infinity)), cw = R(iw * k), ch = R(ih * k);
      return { cw, ch, ...full, dx: 0, dy: 0, dw: cw, dh: ch };
    }
    if (fit === 'stretch') return { cw: W, ch: H, ...full, dx: 0, dy: 0, dw: W, dh: H };
    if (fit === 'cover') {   // crop the source to the target ratio, centred
      const r = W / H, sw = Math.min(iw, ih * r), sh = sw / r;
      const cw = W, ch = H;   // exact sizes are always exact, even for a small image
      return { cw, ch, sx: (iw - sw) / 2, sy: (ih - sh) / 2, sw, sh, dx: 0, dy: 0, dw: cw, dh: ch };
    }
    // pad: the frame is always W×H; the image fits inside it
    const k = clampUp(Math.min(W / iw, H / ih)), dw = iw * k, dh = ih * k;
    return { cw: W, ch: H, ...full, dx: (W - dw) / 2, dy: (H - dh) / 2, dw, dh, pad: true };
  }
  function draw(img) {
    const p = plan(img), c = document.createElement('canvas');
    c.width = p.cw; c.height = p.ch;
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    return { c, x, p };
  }
  // big downscales look sharper done in halving steps
  function render(img) {
    const { c, x, p } = draw(img);
    let src = img, sx = p.sx, sy = p.sy, sw = p.sw, sh = p.sh;
    while (sw / 2 > p.dw && sh / 2 > p.dh) {
      const t = document.createElement('canvas'); t.width = Math.ceil(sw / 2); t.height = Math.ceil(sh / 2);
      const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high';
      tx.drawImage(src, sx, sy, sw, sh, 0, 0, t.width, t.height);
      src = t; sx = 0; sy = 0; sw = t.width; sh = t.height;
    }
    return { c, x, p, src, s: [sx, sy, sw, sh] };
  }
  const toBlob = (c, fmt, q) => new Promise(res => c.toBlob(res, 'image/' + fmt, LOSSY.has(fmt) ? q : undefined));

  async function resize(it) {
    const fmt = outFmt(it), { c, x, p, src, s } = render(it.img);
    if (fmt === 'jpeg' || st.bgMode === 'color') { x.fillStyle = st.bg; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(src, ...s, p.dx, p.dy, p.dw, p.dh);
    let q = st.q / 100, blob = await toBlob(c, fmt, q), note = '';
    if (!blob) throw new Error('Could not save this image');
    const limit = $('rzKbRow').hidden ? 0 : st.kb * 1024;   // field hidden (PNG only) → no limit
    if (limit && blob.size > limit) {
      if (!LOSSY.has(fmt)) note = 'PNG cannot be squeezed – choose JPG or WebP for a size limit';
      else {   // binary search the highest quality that fits
        let lo = 0.05, hi = q, best = null;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2, b = await toBlob(c, fmt, mid);
          if (b.size <= limit) { best = b; q = mid; lo = mid; } else hi = mid;
        }
        if (!best) { const b = await toBlob(c, fmt, 0.05); if (b.size <= limit) { best = b; q = 0.05; } }
        if (best) { blob = best; note = `quality ${Math.round(q * 100)}%`; }
        else note = `still over ${st.kb} KB at lowest quality – make the size smaller`;
      }
    }
    return { blob, w: c.width, h: c.height, fmt, note, over: limit && blob.size > limit };
  }

  /* ---------- Files ---------- */
  let items = [], seq = 0, timer = 0, run = 0;

  async function addFiles(list) {
    const files = [...list].filter(f => /^image\//.test(f.type) || /\.(svg|ico|avif|bmp)$/i.test(f.name || ''));
    if (!files.length) { say('Please choose image files (PNG, JPG, WebP, GIF, SVG …).'); return; }
    say(`Opening ${files.length} image${files.length > 1 ? 's' : ''}…`);
    let bad = 0;
    for (const file of files) {
      const url = URL.createObjectURL(file), img = new Image();
      img.src = url;
      try { await img.decode(); } catch { URL.revokeObjectURL(url); bad++; continue; }
      items.push({ id: ++seq, file, name: (file.name || 'pasted-image').replace(/\.[^.]+$/, '') || 'image', img, url, out: null, err: '' });
    }
    fillOther();
    renderList();
    if (bad) say(`${bad} file${bad > 1 ? 's' : ''} could not be opened (HEIC / RAW photos are not supported by browsers).`);
    resizeAll();
  }

  async function resizeAll() {
    const my = ++run;
    items.forEach(it => { it.out = null; it.err = ''; });
    renderList();
    for (const it of items) {
      if (my !== run) return;
      try { it.out = await resize(it); } catch (e) { it.err = e.message; }
      if (my !== run) return;
      renderItem(it);
    }
    const ok = items.filter(i => i.out), before = ok.reduce((n, i) => n + i.file.size, 0), after = ok.reduce((n, i) => n + i.out.blob.size, 0);
    if (ok.length) say(`${ok.length} image${ok.length > 1 ? 's' : ''} resized · ${kb(before)} → ${kb(after)}`);
    $('cvSave').disabled = !ok.length;
  }
  const changed = () => { save(); syncUi(); clearTimeout(timer); timer = setTimeout(() => items.length && resizeAll(), 250); };

  /* ---------- List ---------- */
  function sizeLine(it) {
    const src = `${it.img.naturalWidth || '?'}×${it.img.naturalHeight || '?'} · ${kb(it.file.size)}`;
    if (it.err) return `<small class="err">${esc(it.err)}</small>`;
    if (!it.out) return `<small>${src} → resizing…</small>`;
    const o = it.out, d = Math.round((o.blob.size / it.file.size - 1) * 100);
    return `<small>${src} → <b>${o.w}×${o.h}</b> · ${kb(o.blob.size)} <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${d}%)</span></small>`
      + (o.note ? `<small class="${o.over ? 'err' : ''}">${esc(o.note)}</small>` : '');
  }
  function li(it) {
    const ext = it.out ? EXT[it.out.fmt] : EXT[outFmt(it)];
    return `<img src="${it.url}" alt=""><div class="cv-info"><b title="${esc(it.file.name || it.name)}">${esc(it.file.name || it.name)}</b>${sizeLine(it)}</div>
      <div class="cv-act"><button type="button" data-dl="${it.id}"${it.out ? '' : ' disabled'}>.${ext}</button><button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}">×</button></div>`;
  }
  function renderList() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvEmpty').hidden = !!items.length;
    $('cvClear').hidden = !items.length;
    $('cvSave').disabled = !items.some(i => i.out);
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it) { const el = $('cvList').querySelector(`li[data-id="${it.id}"]`); if (el) el.innerHTML = li(it); }
  const fileName = it => `${it.name}-${it.out.w}x${it.out.h}.${EXT[it.out.fmt]}`;

  $('cvList').onclick = e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (dl) { const it = items.find(i => i.id === +dl.dataset.dl); if (it?.out) download(it.out.blob, fileName(it)); }
    if (rm) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); fillOther(); renderList(); }
    }
  };
  $('cvClear').onclick = () => { run++; items.forEach(i => URL.revokeObjectURL(i.url)); items = []; renderList(); };

  /* ---------- Download ---------- */
  function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  $('cvSave').onclick = async () => {
    const ok = items.filter(i => i.out);
    if (!ok.length) return;
    if (ok.length === 1) { download(ok[0].out.blob, fileName(ok[0])); return; }
    const used = new Set(), files = [];
    for (const it of ok) {
      let n = fileName(it), k = 2;
      while (used.has(n.toLowerCase())) n = fileName(it).replace(/(\.\w+)$/, `-${k++}$1`);
      used.add(n.toLowerCase());
      files.push({ name: n, data: new Uint8Array(await it.out.blob.arrayBuffer()) });
    }
    download(new Blob([DOCX.zip(files)], { type: 'application/zip' }), `resized-${today()}.zip`);
    say(`ZIP with ${files.length} images downloaded.`);
  };

  /* ---------- Input: picker, drag & drop, paste ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });
  document.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input, textarea, dialog, select')) return;
    const f = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
    if (f.length) { e.preventDefault(); addFiles(f); }
  });

  renderList();
})();
