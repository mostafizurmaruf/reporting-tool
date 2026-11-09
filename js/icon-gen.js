/* =====================================================================
   Icon Generator page: logo + background + padding → every Android and
   iOS launcher icon size, packed into one ZIP (DOCX.zip). Runs offline.

   Android  res/mipmap-<density>/ic_launcher.png        48dp, legacy shape
            res/mipmap-<density>/ic_launcher_round.png  48dp, circle
            res/mipmap-<density>/ic_launcher_foreground.png / _background.png  108dp adaptive layers
            res/mipmap-anydpi-v26/ic_launcher(.xml|_round.xml)
            play_store_512.png
   iOS      AppIcon.appiconset/*.png + Contents.json (always opaque – iOS does not allow transparency)
   ===================================================================== */
(() => {
  const SET_KEY = 'versatilo-icon-v1', M = 1024;   // every icon is drawn at 1024 px first, then scaled down
  const say = t => { $('status').textContent = t; };
  const st = { tint: 'original', bg: 'solid', c1: '#2563eb', c2: '#17a2b8', pad: 16, shape: 'rounded', trim: true, android: true, ios: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  let img = null, imgName = 'app', logo = null;   // logo = trimmed + tinted canvas

  /* ---------- Canvas helpers ---------- */
  const mk = (w, h = w) => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx2 = c => { const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; return x; };
  function shapePath(x, s, shape, off = 0) {
    x.beginPath();
    if (shape === 'circle') x.arc(off + s / 2, off + s / 2, s / 2, 0, Math.PI * 2);
    else if (shape === 'squircle') {   // superellipse, like many Android launchers
      const r = s / 2, cx = off + r, cy = off + r;
      for (let i = 0; i <= 96; i++) {
        const t = i / 96 * Math.PI * 2, c = Math.cos(t), si = Math.sin(t);
        const px = cx + r * Math.sign(c) * Math.abs(c) ** 0.5, py = cy + r * Math.sign(si) * Math.abs(si) ** 0.5;
        i ? x.lineTo(px, py) : x.moveTo(px, py);
      }
      x.closePath();
    } else if (shape === 'square') x.rect(off, off, s, s);
    else {
      const r = s * (shape === 'ios' ? 0.2237 : 0.17);
      x.moveTo(off + r, off); x.arcTo(off + s, off, off + s, off + s, r); x.arcTo(off + s, off + s, off, off + s, r);
      x.arcTo(off, off + s, off, off, r); x.arcTo(off, off, off + s, off, r); x.closePath();
    }
  }
  function downscale(c, size) {
    let cur = c;
    while (cur.width / 2 >= size) { const n = mk(cur.width / 2); ctx2(n).drawImage(cur, 0, 0, n.width, n.height); cur = n; }
    if (cur.width === size) return cur;
    const out = mk(size); ctx2(out).drawImage(cur, 0, 0, size, size); return out;
  }

  /* ---------- Logo: trim transparent edges, apply tint ---------- */
  function prepareLogo() {
    if (!img) { logo = null; return; }
    const w0 = img.naturalWidth || M, h0 = img.naturalHeight || M, k = Math.min(1, 2048 / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    let c = mk(w, h);
    ctx2(c).drawImage(img, 0, 0, w, h);
    if (st.trim) {
      const d = c.getContext('2d').getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0 && (x0 > 0 || y0 > 0 || x1 < w - 1 || y1 < h - 1)) {
        const t = mk(x1 - x0 + 1, y1 - y0 + 1);
        t.getContext('2d').drawImage(c, -x0, -y0);
        c = t;
      }
    }
    if (st.tint !== 'original') {
      const x = c.getContext('2d');
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = st.tint === 'white' ? '#fff' : '#000';
      x.fillRect(0, 0, c.width, c.height);
    }
    logo = c;
  }

  /* ---------- Drawing ---------- */
  function paintBg(x, s, opaque) {
    if (st.bg === 'transparent') { if (!opaque) return; x.fillStyle = '#ffffff'; }
    else if (st.bg === 'gradient') { const g = x.createLinearGradient(0, 0, s, s); g.addColorStop(0, st.c1); g.addColorStop(1, st.c2); x.fillStyle = g; }
    else x.fillStyle = st.c1;
    x.fillRect(0, 0, s, s);
  }
  function paintLogo(x, s, box) {   // logo centred in a square `box` wide, minus the padding
    if (!logo) return;
    const inner = box * (1 - 2 * st.pad / 100), k = Math.min(inner / logo.width, inner / logo.height);
    const w = logo.width * k, h = logo.height * k;
    x.drawImage(logo, (s - w) / 2, (s - h) / 2, w, h);
  }
  // layer: 'full' (bg + logo, clipped to shape) | 'fg' (adaptive foreground, 108dp canvas) | 'bg' (adaptive background)
  const cache = new Map();
  function master(layer, shape = 'square', opaque = false) {
    const key = [layer, shape, opaque].join('|');
    if (cache.has(key)) return cache.get(key);
    const c = mk(M), x = ctx2(c);
    if (layer === 'full') {
      shapePath(x, M, shape); x.clip();
      paintBg(x, M, opaque); paintLogo(x, M, M);
    } else if (layer === 'fg') paintLogo(x, M, M * 72 / 108);   // the visible part of an adaptive icon is the middle 72 of 108dp
    else paintBg(x, M, false);
    cache.set(key, c);
    return c;
  }
  const icon = (size, layer, shape, opaque) => downscale(master(layer, shape, opaque), size);
  // An adaptive icon as a launcher shows it: both layers, middle 72/108 visible, cut to the launcher's mask
  function adaptivePreview(size, mask) {
    const c = mk(size), x = ctx2(c), big = size * 108 / 72, off = -(big - size) / 2;
    shapePath(x, size, mask); x.clip();
    x.drawImage(master('bg'), off, off, big, big);
    x.drawImage(master('fg'), off, off, big, big);
    return c;
  }

  /* ---------- Preview ---------- */
  const TILES = [
    ['Android', () => icon(120, 'full', st.shape)],
    ['Android round', () => icon(120, 'full', 'circle')],
    ['Adaptive circle', () => adaptivePreview(120, 'circle')],
    ['Adaptive squircle', () => adaptivePreview(120, 'squircle')],
    ['Adaptive rounded', () => adaptivePreview(120, 'rounded')],
    ['iOS', () => { const c = mk(120), x = ctx2(c); shapePath(x, 120, 'ios'); x.clip(); x.drawImage(icon(120, 'full', 'square', true), 0, 0); return c; }],
  ];
  const home = $('pvHome');
  const tileCanvases = TILES.map(([name]) => {
    const f = document.createElement('figure'), c = mk(120);
    f.append(c, Object.assign(document.createElement('figcaption'), { textContent: name }));
    home.append(f);
    return c;
  });
  let queued = false;
  function refresh() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      cache.clear();
      const pm = $('pvMaster'), px = pm.getContext('2d');
      px.clearRect(0, 0, pm.width, pm.height);
      px.drawImage(icon(480, 'full', st.shape), 0, 0);
      TILES.forEach(([, draw], i) => { const c = tileCanvases[i], x = c.getContext('2d'); x.clearRect(0, 0, 120, 120); x.drawImage(draw(), 0, 0); });
      syncUi();
    });
  }

  /* ---------- Controls ---------- */
  const SWATCHES = ['#ffffff', '#000000', '#2563eb', '#17364e', '#16a34a', '#e5534b', '#f59e0b', '#7c3aed', '#ec4899', '#0ea5e9'];
  SWATCHES.forEach(c => {
    const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c; b.setAttribute('aria-label', 'Background ' + c);
    b.onclick = () => { st.c1 = c; if (st.bg === 'transparent') st.bg = 'solid'; $('icC1').value = c; save(); refresh(); };
    $('icSwatches').append(b);
  });
  function seg(id, key, after) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button[data-v]'); if (!b) return;
      st[key] = b.dataset.v; save(); if (after) after(); refresh();
    });
  }
  seg('icTint', 'tint', prepareLogo);
  seg('icBg', 'bg');
  seg('icShape', 'shape');
  $('icC1').oninput = e => { st.c1 = e.target.value; save(); refresh(); };
  $('icC2').oninput = e => { st.c2 = e.target.value; save(); refresh(); };
  $('icPad').oninput = e => { st.pad = +e.target.value; save(); refresh(); };
  $('icTrim').onchange = e => { st.trim = e.target.checked; save(); prepareLogo(); refresh(); };
  $('icAndroid').onchange = e => { st.android = e.target.checked; save(); syncUi(); };
  $('icIos').onchange = e => { st.ios = e.target.checked; save(); syncUi(); };

  function syncUi() {
    for (const [id, key] of [['icTint', 'tint'], ['icBg', 'bg'], ['icShape', 'shape']])
      $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st[key]));
    $('icC1').value = st.c1; $('icC2').value = st.c2;
    $('icC2').hidden = st.bg !== 'gradient';
    $('icColors').hidden = st.bg === 'transparent';
    $('icPad').value = st.pad; $('icPadOut').textContent = st.pad + '%';
    $('icTrim').checked = st.trim; $('icAndroid').checked = st.android; $('icIos').checked = st.ios;
    $('icSave').disabled = !img || !(st.android || st.ios);
    $('icNote').textContent = st.bg === 'transparent' && st.ios ? 'iOS icons cannot be transparent – they get a white background. Android icons stay transparent.' : '';
  }

  /* ---------- Loading the logo ---------- */
  async function loadImage(file) {
    if (!file || !/^image\//.test(file.type)) { say('Please choose an image file (PNG, SVG, JPG or WebP).'); return; }
    const url = URL.createObjectURL(file), el = new Image();
    el.src = url;
    try { await el.decode(); }
    catch { URL.revokeObjectURL(url); say(`${file.name || 'This image'} could not be opened.`); return; }
    img = el;
    imgName = (file.name || 'app').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || 'app';
    $('icThumb').src = url; $('icThumb').hidden = false; $('icDropIcon').setAttribute('hidden', '');   // SVG elements have no .hidden property
    $('icDropText').textContent = (file.name || 'Pasted image') + ' – click to change';
    prepareLogo();
    refresh();
    const w = img.naturalWidth, h = img.naturalHeight;
    say(w && Math.max(w, h) < 512 ? `Logo is only ${w}×${h} px – large icons may look blurry. 1024 px or an SVG is best.` : 'Logo added – adjust the background and padding, then download.');
  }
  $('icFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; loadImage(f); };
  const drop = $('icDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); loadImage(e.dataTransfer.files[0]); });
  document.addEventListener('paste', e => {
    if (e.target.closest && e.target.closest('input, textarea, dialog')) return;
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); loadImage(f); }
  });

  /* ---------- Export ---------- */
  const png = c => new Promise((res, rej) => c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error('PNG export failed')), 'image/png'));
  // iOS: App Store Connect rejects icons with an alpha channel, so write a true RGB PNG (canvas.toBlob always gives RGBA)
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  async function pngRGB(c) {
    const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data, raw = new Uint8Array((w * 3 + 1) * h);
    for (let y = 0, o = 0; y < h; y++) { raw[o++] = 0; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; raw[o++] = src[i]; raw[o++] = src[i + 1]; raw[o++] = src[i + 2]; } }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
      dv.setUint32(0, data.length); out.set([...type].map(ch => ch.charCodeAt(0)), 4); out.set(data, 8);
      dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      return out;
    };
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, w); dv.setUint32(4, h); ihdr.set([8, 2, 0, 0, 0], 8);   // 8-bit, colour type 2 = RGB
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
  // [idiom, size in pt, scale]
  const IOS = [
    ['iphone', 20, 2], ['iphone', 20, 3], ['iphone', 29, 2], ['iphone', 29, 3], ['iphone', 40, 2], ['iphone', 40, 3], ['iphone', 60, 2], ['iphone', 60, 3],
    ['ipad', 20, 1], ['ipad', 20, 2], ['ipad', 29, 1], ['ipad', 29, 2], ['ipad', 40, 1], ['ipad', 40, 2], ['ipad', 76, 1], ['ipad', 76, 2], ['ipad', 83.5, 2],
    ['ios-marketing', 1024, 1],
  ];
  async function buildZip() {
    cache.clear();
    const files = [], root = imgName + '_icons/';
    if (st.android) {
      const a = root + 'android/res/';
      for (const [d, f] of Object.entries(DENS)) {
        files.push({ name: `${a}mipmap-${d}/ic_launcher.png`, data: await png(icon(Math.round(48 * f), 'full', st.shape)) });
        files.push({ name: `${a}mipmap-${d}/ic_launcher_round.png`, data: await png(icon(Math.round(48 * f), 'full', 'circle')) });
        files.push({ name: `${a}mipmap-${d}/ic_launcher_foreground.png`, data: await png(icon(Math.round(108 * f), 'fg')) });
        files.push({ name: `${a}mipmap-${d}/ic_launcher_background.png`, data: await png(icon(Math.round(108 * f), 'bg')) });
      }
      files.push({ name: `${a}mipmap-anydpi-v26/ic_launcher.xml`, data: ADAPTIVE });
      files.push({ name: `${a}mipmap-anydpi-v26/ic_launcher_round.xml`, data: ADAPTIVE });
      files.push({ name: root + 'android/play_store_512.png', data: await png(icon(512, 'full', 'square')) });
    }
    if (st.ios) {
      const dir = root + 'ios/AppIcon.appiconset/', done = new Set(), images = [];
      for (const [idiom, pt, scale] of IOS) {
        const px = Math.round(pt * scale), filename = `Icon-${px}.png`;
        if (!done.has(px)) { done.add(px); files.push({ name: dir + filename, data: await pngRGB(icon(px, 'full', 'square', true)) }); }
        images.push({ filename, idiom, scale: scale + 'x', size: `${pt}x${pt}` });
      }
      files.push({ name: dir + 'Contents.json', data: JSON.stringify({ images, info: { author: 'xcode', version: 1 } }, null, 2) });
    }
    files.push({ name: root + 'README.txt', data: [
      'Launcher icons – made with the Versatilo Icon Generator',
      '',
      st.android ? 'ANDROID\n  Copy everything inside android/res/ into app/src/main/res/ (replace the existing ic_launcher files).\n  AndroidManifest.xml: android:icon="@mipmap/ic_launcher"  android:roundIcon="@mipmap/ic_launcher_round"\n  Android 8+ uses the adaptive icon (foreground + background layers). play_store_512.png is for the Play Console.\n  Flutter: android/app/src/main/res/   React Native: android/app/src/main/res/\n' : '',
      st.ios ? 'iOS\n  In Xcode open Assets.xcassets, delete the old AppIcon and drag in the AppIcon.appiconset folder\n  (or replace the folder in ios/Runner/Assets.xcassets/ for Flutter, ios/<App>/Images.xcassets/ for React Native).\n' : '',
    ].join('\n').replace(/\n/g, '\r\n') });
    return { bytes: DOCX.zip(files), count: files.filter(f => f.name.endsWith('.png')).length, name: imgName + '_launcher_icons.zip' };
  }
  $('icSave').onclick = async () => {
    const btn = $('icSave'); setBusy(btn, true);
    say('Making icons…');
    try {
      const { bytes, count, name } = await buildZip();
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' })); a.download = name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      say(`Downloaded ${name} – ${count} icons` + (st.android && st.ios ? ' for Android and iOS.' : st.android ? ' for Android.' : ' for iOS.'));
    } catch (e) {
      console.error(e);
      say('Could not make the icons: ' + (e.message || e));
    } finally { setBusy(btn, false); syncUi(); }
  };

  syncUi();
  refresh();
})();
