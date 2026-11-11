/* =====================================================================
   Image Compressor page: make images smaller without changing their
   pixel size – by quality, or down to a target file size (KB).
   JPG / WebP / AVIF are re-encoded with canvas.toBlob; PNG is reduced to
   a colour palette (median cut + dithering, written as an indexed PNG),
   which is what makes PNGs really shrink. Canvas only – offline.
   Uses the same list markup + styles as the Image Converter page.
   ===================================================================== */
(() => {
  const SET_KEY = 'versatilo-compress-v1';
  const say = t => { $('status').textContent = t; };
  const st = { by: 'quality', q: 75, kb: 200, max: 0, fmt: 'same' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };
  const kb = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Which formats can this browser write? ---------- */
  const probe = document.createElement('canvas'); probe.width = probe.height = 1;
  const canWrite = t => probe.toDataURL('image/' + t).startsWith('data:image/' + t);
  const SUPPORTED = Object.fromEntries(Object.keys(EXT).map(f => [f, f === 'png' || canWrite(f)]));
  if (st.fmt !== 'same' && !SUPPORTED[st.fmt]) st.fmt = 'same';
  const outFmt = it => {
    if (st.fmt !== 'same') return st.fmt;
    const f = { 'image/jpeg': 'jpeg', 'image/webp': 'webp', 'image/avif': 'avif' }[it.file.type] || 'png';
    return SUPPORTED[f] ? f : 'png';
  };
  // PNG has no quality setting – the quality picks how many colours stay (95%+ = lossless)
  const pngColors = q => q >= 95 ? 0 : q >= 50 ? 256 : q >= 38 ? 128 : q >= 26 ? 64 : q >= 16 ? 32 : 16;

  /* ---------- Controls ---------- */
  $('cpBy').querySelectorAll('button').forEach(b => { b.onclick = () => { st.by = b.dataset.v; changed(); }; });
  $('cpFmt').querySelectorAll('button').forEach(b => {
    if (b.dataset.v !== 'same' && !SUPPORTED[b.dataset.v]) { b.disabled = true; b.title = 'Your browser cannot save this format (try Chrome)'; }
    b.onclick = () => { st.fmt = b.dataset.v; changed(); };
  });
  $('cpQ').value = st.q;
  $('cpQ').oninput = e => { st.q = +e.target.value; changed(); };
  $('cpQChips').onclick = e => { const b = e.target.closest('[data-q]'); if (!b) return; st.q = +b.dataset.q; $('cpQ').value = st.q; changed(); };
  $('cpKb').value = st.kb || '';
  $('cpKb').oninput = e => { st.kb = Math.max(0, Math.round(+e.target.value || 0)); changed(); };
  $('cpKbChips').onclick = e => { const b = e.target.closest('[data-kb]'); if (!b) return; st.kb = +b.dataset.kb; $('cpKb').value = st.kb; changed(); };
  $('cpMax').value = st.max || '';
  $('cpMax').oninput = e => { st.max = Math.max(0, Math.round(+e.target.value || 0)); changed(); };

  function syncUi() {
    for (const [id, key] of [['cpBy', 'by'], ['cpFmt', 'fmt']])
      $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st[key]));
    document.querySelectorAll('[data-by]').forEach(r => { r.hidden = r.dataset.by !== st.by; });
    $('cpQOut').textContent = st.q + '%';
    $('cpQChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.q === st.q));
    $('cpKbChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.kb === st.kb));
    const fmts = new Set(items.length ? items.map(outFmt) : [st.fmt === 'same' ? 'any' : st.fmt]);
    const png = fmts.has('png') || fmts.has('any'), n = pngColors(st.q);
    $('cvNote').textContent = (st.by === 'quality'
      ? (fmts.size === 1 && png && !fmts.has('any') ? '' : `Saved at ${st.q}% quality. `)
        + (png ? (n ? `PNG: colours are reduced to a ${n}-colour palette – transparency is kept. ` : 'PNG: kept lossless (set the quality below 95% to shrink PNG files). ') : '')
      : !st.kb ? 'Enter a size in KB. '
      : `Each image gets the best quality that fits in ${kb(st.kb * 1024)}; if that is not enough it is also scaled down a little. `)
      + (fmts.has('jpeg') ? 'JPG: transparent areas become white. ' : '')
      + 'If a file would not get smaller, the original is kept.';
    $('cvSave').textContent = items.length > 1 ? 'Download all (ZIP)' : 'Download';
  }

  /* ---------- Canvas ---------- */
  function canvas(img, k, fmt) {   // the image at scale k (≤ 1); big downscales are done in halving steps (sharper)
    const iw = img.naturalWidth || 1024, ih = img.naturalHeight || 1024;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(iw * k)); c.height = Math.max(1, Math.round(ih * k));
    const x = c.getContext('2d', { willReadFrequently: fmt === 'png' });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    if (fmt === 'jpeg') { x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); }
    let src = img, sw = iw, sh = ih;
    while (sw / 2 > c.width && sh / 2 > c.height) {
      const t = document.createElement('canvas'); t.width = Math.ceil(sw / 2); t.height = Math.ceil(sh / 2);
      const tx = t.getContext('2d'); tx.imageSmoothingQuality = 'high';
      tx.drawImage(src, 0, 0, sw, sh, 0, 0, t.width, t.height);
      src = t; sw = t.width; sh = t.height;
    }
    x.drawImage(src, 0, 0, sw, sh, 0, 0, c.width, c.height);
    return c;
  }
  const toBlob = (c, fmt, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Could not save this image')), 'image/' + fmt, fmt === 'png' ? undefined : q));

  /* ---------- PNG: colour palette (lossy, like TinyPNG) ----------
     pngPrep(canvas) counts the colours once and returns quant(colors) → Blob of an 8-bit indexed PNG. */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const SZ = 1 << 19;   // histogram bins: 5 bits each for R, G, B + 4 bits alpha
  const KEY = (r, g, b, a) => a < 8 ? 0 : (r >> 3) << 14 | (g >> 3) << 9 | (b >> 3) << 4 | a >> 4;

  function pngPrep(c) {
    const w = c.width, h = c.height, px = c.getContext('2d').getImageData(0, 0, w, h).data;
    const cnt = new Uint32Array(SZ), sum = new Float64Array(SZ * 4);
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a < 8) { cnt[0]++; continue; }   // (almost) invisible → one fully transparent colour
      const k = KEY(px[i], px[i + 1], px[i + 2], a), o = k * 4;
      cnt[k]++; sum[o] += px[i]; sum[o + 1] += px[i + 1]; sum[o + 2] += px[i + 2]; sum[o + 3] += a;
    }
    const keys = []; for (let k = 0; k < SZ; k++) if (cnt[k]) keys.push(k);
    const B = keys.length, bn = new Float64Array(B), bc = new Float64Array(B * 4), binOf = new Int32Array(SZ).fill(-1);
    keys.forEach((k, b) => { binOf[k] = b; bn[b] = cnt[k]; for (let ch = 0; ch < 4; ch++) bc[b * 4 + ch] = sum[k * 4 + ch] / cnt[k]; });

    return async function quant(colors) {
      /* 1 · median cut over the bins */
      const stat = ids => {
        const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0]; let n = 0;
        for (const b of ids) { n += bn[b]; for (let ch = 0; ch < 4; ch++) { const v = bc[b * 4 + ch]; if (v < lo[ch]) lo[ch] = v; if (v > hi[ch]) hi[ch] = v; } }
        let ch = 0; for (let i = 1; i < 4; i++) if (hi[i] - lo[i] > hi[ch] - lo[ch]) ch = i;
        const range = hi[ch] - lo[ch];
        return { ids, n, ch, score: ids.length > 1 ? range * range * Math.sqrt(n) : -1 };
      };
      const boxes = [stat(Array.from({ length: B }, (_, i) => i))];
      while (boxes.length < colors) {
        let bi = 0; for (let i = 1; i < boxes.length; i++) if (boxes[i].score > boxes[bi].score) bi = i;
        const box = boxes[bi]; if (box.score <= 0) break;
        const ids = box.ids, ch = box.ch; ids.sort((p, q) => bc[p * 4 + ch] - bc[q * 4 + ch]);
        let cut = 1, acc = bn[ids[0]];
        while (cut < ids.length - 1 && acc < box.n / 2) acc += bn[ids[cut++]];
        boxes.splice(bi, 1, stat(ids.slice(0, cut)), stat(ids.slice(cut)));
      }
      const K = boxes.length, pal = new Float64Array(K * 4), own = new Int32Array(B);
      const means = () => {
        const s = new Float64Array(K * 4), n = new Float64Array(K);
        for (let b = 0; b < B; b++) { const p = own[b]; n[p] += bn[b]; for (let ch = 0; ch < 4; ch++) s[p * 4 + ch] += bc[b * 4 + ch] * bn[b]; }
        for (let p = 0; p < K; p++) if (n[p]) for (let ch = 0; ch < 4; ch++) pal[p * 4 + ch] = s[p * 4 + ch] / n[p];
      };
      const near = (r, g, b, a) => {
        let best = 0, bd = Infinity;
        for (let p = 0, o = 0; p < K; p++, o += 4) {
          const dr = r - pal[o], dg = g - pal[o + 1], db = b - pal[o + 2], da = a - pal[o + 3], d = dr * dr + dg * dg + db * db + da * da;
          if (d < bd) { bd = d; best = p; }
        }
        return best;
      };
      const assign = () => { for (let b = 0, o = 0; b < B; b++, o += 4) own[b] = near(bc[o], bc[o + 1], bc[o + 2], bc[o + 3]); };
      boxes.forEach((box, p) => { for (const b of box.ids) own[b] = p; });
      means();
      /* 2 · two k-means passes pull the palette onto the real colours */
      for (let i = 0; i < 2 && B > K; i++) { assign(); means(); await new Promise(r => setTimeout(r)); }
      // non-opaque colours first, so the tRNS chunk can stop early
      const order = Array.from({ length: K }, (_, i) => i).sort((p, q) => (Math.round(pal[p * 4 + 3]) < 255 ? 0 : 1) - (Math.round(pal[q * 4 + 3]) < 255 ? 0 : 1));
      const P = new Uint8Array(K * 4); order.forEach((p, i) => { for (let ch = 0; ch < 4; ch++) P[i * 4 + ch] = Math.round(pal[p * 4 + ch]); });
      for (let i = 0; i < K * 4; i++) pal[i] = P[i];
      assign();

      /* 3 · map every pixel (Floyd–Steinberg dithering when colours were really dropped) */
      const cache = new Int16Array(SZ).fill(-1), dither = B > K, F = 0.75;
      const raw = new Uint8Array((w + 1) * h);
      let e0 = new Float32Array((w + 2) * 4), e1 = new Float32Array((w + 2) * 4);
      for (let y = 0, i = 0, o = 0; y < h; y++) {
        raw[o++] = 0;   // filter: none
        for (let x = 0; x < w; x++, i += 4) {
          let r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
          const clear = a < 8, e = (x + 1) * 4;
          if (clear) r = g = b = a = 0;
          else if (dither) {
            r += e0[e]; g += e0[e + 1]; b += e0[e + 2]; a += e0[e + 3];
            r = r < 0 ? 0 : r > 255 ? 255 : r; g = g < 0 ? 0 : g > 255 ? 255 : g; b = b < 0 ? 0 : b > 255 ? 255 : b; a = a < 0 ? 0 : a > 255 ? 255 : a;
          }
          const k = KEY((r + .5) | 0, (g + .5) | 0, (b + .5) | 0, (a + .5) | 0);
          let p = cache[k];
          if (p < 0) { const bin = binOf[k]; p = cache[k] = bin >= 0 ? own[bin] : near(r, g, b, a); }
          raw[o++] = p;
          if (dither && !clear) {
            const q = p * 4, d = [(r - P[q]) * F, (g - P[q + 1]) * F, (b - P[q + 2]) * F, (a - P[q + 3]) * F];
            for (let ch = 0; ch < 4; ch++) {
              const v = d[ch]; if (!v) continue;
              e0[e + 4 + ch] += v * 7 / 16; e1[e - 4 + ch] += v * 3 / 16; e1[e + ch] += v * 5 / 16; e1[e + 4 + ch] += v / 16;
            }
          }
        }
        const t = e0; e0 = e1; e1 = t; e1.fill(0);
        if (y % 256 === 255) await new Promise(r => setTimeout(r));   // let the page breathe on big images
      }

      /* 4 · write the PNG: IHDR (8-bit, colour type 3) · PLTE · tRNS · IDAT · IEND */
      const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      const chunk = (type, data) => {
        const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
        dv.setUint32(0, data.length); out.set([...type].map(ch => ch.charCodeAt(0)), 4); out.set(data, 8);
        dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
        return out;
      };
      const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
      dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 3, 0, 0, 0], 8);
      const plte = new Uint8Array(K * 3); let nT = 0;
      for (let p = 0; p < K; p++) { plte.set(P.subarray(p * 4, p * 4 + 3), p * 3); if (P[p * 4 + 3] < 255) nT = p + 1; }
      const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('PLTE', plte)];
      if (nT) parts.push(chunk('tRNS', Uint8Array.from({ length: nT }, (_, p) => P[p * 4 + 3])));
      parts.push(chunk('IDAT', z), chunk('IEND', new Uint8Array(0)));
      return new Blob(parts, { type: 'image/png' });
    };
  }

  /* ---------- Compress one image ---------- */
  async function byQuality(c, fmt) {
    if (fmt !== 'png') return { blob: await toBlob(c, fmt, st.q / 100), note: '' };
    const n = pngColors(st.q);
    return n ? { blob: await pngPrep(c)(n), note: `${n} colours` } : { blob: await toBlob(c, 'png'), note: 'lossless' };
  }
  // best version of this canvas that fits the limit, or {blob (smallest try), over: true}
  async function bySize(c, fmt, limit) {
    if (fmt === 'png') {
      let blob = await toBlob(c, 'png');
      if (blob.size <= limit) return { blob, note: 'lossless' };
      const quant = pngPrep(c);
      for (const n of [256, 128, 64, 32, 16]) {
        blob = await quant(n);
        if (blob.size <= limit) return { blob, note: `${n} colours` };
      }
      return { blob, over: true };
    }
    const HI = 0.92, LO = 0.3;
    let blob = await toBlob(c, fmt, HI);
    if (blob.size <= limit) return { blob, note: `quality ${Math.round(HI * 100)}%` };
    let best = await toBlob(c, fmt, LO), q = LO;
    if (best.size > limit) return { blob: best, over: true };
    for (let i = 0, lo = LO, hi = HI; i < 6; i++) {   // binary search the highest quality that fits
      const mid = (lo + hi) / 2, b = await toBlob(c, fmt, mid);
      if (b.size <= limit) { best = b; q = mid; lo = mid; } else hi = mid;
    }
    return { blob: best, note: `quality ${Math.round(q * 100)}%` };
  }

  async function compress(it) {
    const fmt = outFmt(it), img = it.img, same = it.file.type === 'image/' + fmt;
    const k0 = st.max ? Math.min(1, st.max / Math.max(img.naturalWidth || 1024, img.naturalHeight || 1024)) : 1;
    const limit = st.by === 'size' ? st.kb * 1024 : 0;
    const keep = note => ({ blob: it.file, w: img.naturalWidth, h: img.naturalHeight, fmt, note, kept: true });
    if (st.by === 'size' && !limit) throw new Error('Enter a target size in KB');
    if (limit && same && k0 === 1 && it.file.size <= limit) return keep(`already under ${kb(limit)} – original kept`);

    let c, r, k = k0;
    if (!limit) { c = canvas(img, k, fmt); r = await byQuality(c, fmt); }
    else for (const s of [1, .85, .7, .6, .5, .4, .3, .2, .12]) {   // quality first; scale down only when that is not enough
      k = k0 * s; c = canvas(img, k, fmt); r = await bySize(c, fmt, limit);
      if (!r.over || Math.max(c.width, c.height) <= 16) break;
    }
    if (same && k === 1 && r.blob.size >= it.file.size) return keep('already well compressed – original kept');
    const notes = [r.over ? `could not reach ${kb(limit)}` : r.note];
    if (k < k0) notes.push(`scaled to ${Math.round(k / k0 * 100)}% to fit`);
    if (it.file.type === 'image/gif') notes.push('animation is not kept');
    return { blob: r.blob, w: c.width, h: c.height, fmt, note: notes.filter(Boolean).join(' · '), over: !!r.over };
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
    renderList();
    if (bad) say(`${bad} file${bad > 1 ? 's' : ''} could not be opened (HEIC / RAW photos are not supported by browsers).`);
    compressAll();
  }

  async function compressAll() {
    const my = ++run;
    items.forEach(it => { it.out = null; it.err = ''; });
    renderList();
    let done = 0;
    for (const it of items) {
      if (my !== run) return;
      if (items.length > 1) say(`Compressing ${++done} of ${items.length}…`); else say('Compressing…');
      let out = null, err = '';
      try { out = await compress(it); } catch (e) { err = e.message; }
      if (my !== run) return;
      it.out = out; it.err = err;
      renderItem(it);
    }
    const ok = items.filter(i => i.out), before = ok.reduce((n, i) => n + i.file.size, 0), after = ok.reduce((n, i) => n + i.out.blob.size, 0);
    if (ok.length) say(`${ok.length} image${ok.length > 1 ? 's' : ''} compressed · ${kb(before)} → ${kb(after)}` + (before > after ? ` · saved ${Math.round((1 - after / before) * 100)}%` : ''));
    else if (items.length) say(items[0].err || 'Nothing could be compressed.');
    $('cvSave').disabled = !ok.length;
  }
  const changed = () => { save(); syncUi(); clearTimeout(timer); timer = setTimeout(() => items.length && compressAll(), 250); };

  /* ---------- List ---------- */
  function sizeLine(it) {
    const dim = `${it.img.naturalWidth || '?'}×${it.img.naturalHeight || '?'}`, src = `${dim} · ${kb(it.file.size)}`;
    if (it.err) return `<small class="err">${esc(it.err)}</small>`;
    if (!it.out) return `<small>${src} → compressing…</small>`;
    const o = it.out, d = Math.round((o.blob.size / it.file.size - 1) * 100), newDim = `${o.w}×${o.h}`;
    return `<small>${src} → ${newDim !== dim ? newDim + ' · ' : ''}<b>${kb(o.blob.size)}</b> <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d)}%)</span></small>`
      + (o.note ? `<small class="${o.over ? 'err' : ''}">${esc(o.note)}</small>` : '');
  }
  function li(it) {
    const ext = EXT[it.out ? it.out.fmt : outFmt(it)];
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
  const fileName = it => `${it.name}-min.${EXT[it.out.fmt]}`;

  $('cvList').onclick = e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (dl) { const it = items.find(i => i.id === +dl.dataset.dl); if (it?.out) download(it.out.blob, fileName(it)); }
    if (rm) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); renderList(); }
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
    download(new Blob([DOCX.zip(files)], { type: 'application/zip' }), `compressed-${today()}.zip`);
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
