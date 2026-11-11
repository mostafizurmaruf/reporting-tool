/* =====================================================================
   Video Compressor page: re-encodes videos with the browser's own
   WebCodecs encoder (hardware accelerated) through Mediabunny, which
   reads MP4 / MOV / WebM / MKV and writes MP4 (H.264 + AAC) or
   WebM (VP9 + Opus). Nothing is uploaded – the library is the only
   download (jsdelivr, first visit).
   ===================================================================== */
(() => {
  const MB_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1.62.1/dist/bundles/mediabunny.min.mjs';
  const SET_KEY = 'versatilo-video-v1';
  const say = t => { $('status').textContent = t; };
  const st = { by: 'quality', q: 'medium', mb: 16, res: 0, fps: 0, audio: 'keep', fmt: 'mp4' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const AUDIO_BPS = 96000, MAX_PASS = 4;   // audio bitrate used for the target-size maths
  const FMT = { mp4: { ext: 'mp4', mime: 'video/mp4', video: 'avc', audio: 'aac' }, webm: { ext: 'webm', mime: 'video/webm', video: 'vp9', audio: 'opus' } };
  const kb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const even = n => Math.max(2, Math.round(n / 2) * 2);

  /* ---------- Library + browser support ---------- */
  const supported = 'VideoEncoder' in window && 'VideoDecoder' in window;
  let MB = null, mbLoading = null;
  const lib = () => MB ? Promise.resolve(MB) : (mbLoading ||= import(MB_URL).then(m => (MB = m)).catch(e => { mbLoading = null; throw new Error('Could not load the video library – check your internet connection.'); }));
  if (!supported) {
    $('vcSupport').hidden = false;
    $('vcSupport').textContent = 'This browser cannot encode video (WebCodecs missing). Please use a recent Chrome, Edge, Safari 17+ or Firefox 130+.';
  } else lib().catch(() => {});   // warm up in the background

  /* ---------- Controls ---------- */
  const SEGS = [['vcBy', 'by'], ['vcQ', 'q'], ['vcRes', 'res', true], ['vcFps', 'fps', true], ['vcAudio', 'audio'], ['vcFmt', 'fmt']];
  for (const [id, key, numeric] of SEGS)
    $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { st[key] = numeric ? +b.dataset.v : b.dataset.v; changed(); }; });
  $('vcMb').value = st.mb;
  $('vcMb').oninput = e => { st.mb = Math.max(0, +e.target.value || 0); changed(); };
  $('vcMbChips').onclick = e => { const b = e.target.closest('[data-mb]'); if (!b) return; st.mb = +b.dataset.mb; $('vcMb').value = st.mb; changed(); };

  function syncUi() {
    for (const [id, key] of SEGS) $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(st[key])));
    document.querySelectorAll('[data-by]').forEach(r => { r.hidden = r.dataset.by !== st.by; });
    $('vcMbChips').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.mb === st.mb));
    $('cvNote').textContent = (st.by === 'size'
      ? `Each video is aimed at just under ${st.mb || '?'} MB – the bitrate is worked out from its length. Long videos at a small size will look blocky; lowering the resolution helps.`
      : { high: 'High – looks almost the same as the original, saves less space.', medium: 'Medium – good balance for sharing.', low: 'Small – noticeably smaller files, fine on phones.', 'very-low': 'Smallest – for previews; detail is lost.' }[st.q])
      + (st.fmt === 'webm' ? ' WebM (VP9) is smaller but slower to make and iPhones / some apps may not play it.' : '');
    const busy = !!running, todo = items.filter(i => !i.out && !i.err).length, done = items.filter(i => i.out).length;
    $('vcGo').disabled = !supported || !items.length || busy;
    $('vcGo').textContent = busy ? 'Compressing…' : todo || !done ? `Compress${items.length > 1 ? ' all' : ''}` : 'Compress again';
    $('vcSaveAll').hidden = done < 2;
    $('vcSaveAll').textContent = `Download all (${done})`;
    $('cvClear').hidden = !items.length || busy;
  }
  const changed = () => {
    save();
    if (!running) items.forEach(it => { if (it.out || it.err) { it.out = null; it.err = ''; it.p = 0; renderItem(it); } });   // settings changed → old results are stale
    syncUi();
  };

  /* ---------- Files ---------- */
  let items = [], seq = 0, running = null;   // item: {id, file, name, url, info, out:{blob,ms}, err, p}

  async function addFiles(list) {
    const files = [...list].filter(f => /^video\//.test(f.type) || /\.(mkv|mov|mp4|webm|m4v)$/i.test(f.name || ''));
    if (!files.length) { say('Please choose video files (MP4, MOV, WebM, MKV).'); return; }
    for (const file of files) items.push({ id: ++seq, file, name: (file.name || 'video').replace(/\.[^.]+$/, '') || 'video', url: URL.createObjectURL(file), info: null, out: null, err: '', p: 0 });
    renderList();
    say(`Reading ${files.length} video${files.length > 1 ? 's' : ''}…`);
    try { await lib(); } catch (e) { say(e.message); return; }
    for (const it of items.filter(i => !i.info && !i.err)) {
      try { it.info = await probe(it.file); } catch (e) { it.err = 'This file could not be read – ' + (e.message || 'unsupported format'); }
      renderItem(it);
    }
    say(`${items.length} video${items.length > 1 ? 's' : ''} ready – choose the settings and press Compress.`);
    syncUi();
  }
  async function probe(file) {
    const input = new MB.Input({ source: new MB.BlobSource(file), formats: MB.ALL_FORMATS });
    try {
      const v = await input.getPrimaryVideoTrack(), a = await input.getPrimaryAudioTrack();
      if (!v) throw new Error('no video track');
      const duration = await input.computeDuration();
      let fps = 0; try { fps = (await v.computePacketStats(120)).averagePacketRate; } catch {}
      return { w: v.displayWidth, h: v.displayHeight, duration, fps, vcodec: v.codec, audio: !!a, acodec: a?.codec };
    } finally { input.dispose(); }
  }

  /* ---------- Compress ---------- */
  function targetBitrate(info) {   // bits/s for the video track so the whole file lands under st.mb
    const total = st.mb * 1048576 * 8 * 0.94 / Math.max(1, info.duration);   // 6 % headroom for the container
    const audio = st.audio === 'keep' && info.audio ? AUDIO_BPS : 0;
    return Math.max(100000, Math.floor(total - audio));
  }
  const STEPS = [1080, 720, 480, 360];
  const shortSide = (info, res = st.res) => Math.min(res || Infinity, Math.min(info.w, info.h));
  function videoOptions(info, bitrate, res = st.res) {
    const o = { codec: FMT[st.fmt].video, forceTranscode: true };
    const short = Math.min(info.w, info.h);
    if (res && res < short) {   // the short side becomes 1080 / 720 / …, never upscale
      const k = res / short;
      o.width = even(info.w * k); o.height = even(info.h * k); o.fit = 'fill';
    } else if (info.w % 2 || info.h % 2) { o.width = even(info.w); o.height = even(info.h); o.fit = 'fill'; }   // encoders want even sizes
    if (st.fps && (!info.fps || info.fps > st.fps + 0.5)) o.frameRate = st.fps;
    // a plain number would mean a 0–1 quality level, so bitrates go in as { bitrate }
    o.quality = bitrate ? new MB.Quality({ bitrate, bitrateMode: 'constant' }) : new MB.Quality(st.q);
    return o;
  }
  async function encodeOnce(it, bitrate, res) {
    const fmt = FMT[st.fmt];
    const input = new MB.Input({ source: new MB.BlobSource(it.file), formats: MB.ALL_FORMATS });
    const output = new MB.Output({
      format: st.fmt === 'mp4' ? new MB.Mp4OutputFormat({ fastStart: 'in-memory' }) : new MB.WebMOutputFormat(),
      target: new MB.BufferTarget(),
    });
    try {
      // AAC is missing in some browsers (e.g. Chromium / Firefox on Linux) – MP4 can carry Opus instead
      const acodec = st.audio === 'keep' && it.info.audio ? await MB.getFirstEncodableAudioCodec(st.fmt === 'mp4' ? ['aac', 'opus'] : ['opus']) : null;
      const audio = !acodec ? { discard: true } : { codec: acodec, quality: new MB.Quality({ bitrate: st.by === 'size' ? AUDIO_BPS : 128000 }) };
      if (st.audio === 'keep' && it.info.audio && !acodec) it.note = 'this browser cannot encode sound – the video was saved without it';
      const conv = await MB.Conversion.init({ input, output, video: videoOptions(it.info, bitrate, res), audio, showWarnings: false });
      if (!conv.isValid) throw new Error('Cannot convert: ' + (conv.discardedTracks.map(d => d.reason).join(', ') || 'unsupported video'));
      if (acodec && conv.discardedTracks.some(d => d.track.isAudioTrack?.())) it.note = 'sound could not be kept in this format';
      conv.onProgress = p => { it.p = p; renderProgress(it); };
      running = { it, conv };
      await conv.execute();
      return new Blob([output.target.buffer], { type: fmt.mime });
    } finally { input.dispose(); }
  }
  async function compress(it) {
    const fmt = FMT[st.fmt], t0 = performance.now();
    if (!(await MB.canEncodeVideo(fmt.video))) throw new Error(`This browser cannot make ${fmt.video.toUpperCase()} video – try ${st.fmt === 'mp4' ? 'WebM' : 'MP4'}.`);
    if (st.by !== 'size') return { blob: await encodeOnce(it), ms: performance.now() - t0, fmt: st.fmt };
    // Target size: encoders don't hit a bitrate exactly (and each has a floor per resolution), so if the file is too
    // big, scale the bitrate down and try again; if the bitrate alone didn't help, step the resolution down too.
    const limit = st.mb * 1048576;
    let bitrate = targetBitrate(it.info), res = st.res, blob = null, prev = Infinity;
    for (it.pass = 1; it.pass <= MAX_PASS; it.pass++) {
      blob = await encodeOnce(it, bitrate, res);
      if (blob.size <= limit || it.pass === MAX_PASS) break;
      const k = limit / blob.size;
      if (blob.size > prev * 0.9 || k < 0.6) {   // encoder at its floor → smaller frame
        const next = STEPS.find(p => p < shortSide(it.info, res));
        if (next) res = next;
      }
      prev = blob.size;
      bitrate = Math.max(60000, Math.floor(bitrate * Math.max(k, 0.5) * 0.93));
      it.p = 0; renderItem(it);
    }
    it.pass = 0;
    if (res !== st.res) it.note = `resolution lowered to ${res}p to fit under ${st.mb} MB`;
    if (blob.size > limit) it.note = `still over ${st.mb} MB – choose a lower resolution or a bigger size`;
    return { blob, ms: performance.now() - t0, fmt: st.fmt };
  }
  async function runAll() {
    if (running) return;
    try { await lib(); } catch (e) { say(e.message); return; }
    const queue = items.filter(i => i.info && !i.out);
    if (!queue.length) { items.forEach(i => { i.out = null; i.p = 0; }); queue.push(...items.filter(i => i.info)); renderList(); }
    running = {}; syncUi();
    let n = 0;
    for (const it of queue) {
      if (!items.includes(it)) continue;   // removed while waiting
      n++; say(`Compressing ${n} of ${queue.length}: ${it.file.name}…`);
      it.err = ''; it.note = ''; it.p = 0; renderItem(it);
      try { it.out = await compress(it); }
      catch (e) { it.err = e instanceof MB.ConversionCanceledError || e?.name === 'ConversionCanceledError' ? 'Cancelled' : (e.message || String(e)); }
      running = {};
      renderItem(it);
    }
    running = null;
    const ok = items.filter(i => i.out), before = ok.reduce((s, i) => s + i.file.size, 0), after = ok.reduce((s, i) => s + i.out.blob.size, 0);
    say(ok.length ? `Done · ${kb(before)} → ${kb(after)} (${Math.round((1 - after / before) * 100)}% smaller)` : 'Nothing was compressed.');
    syncUi();
  }
  $('vcGo').onclick = runAll;

  /* ---------- List ---------- */
  function line(it) {
    const f = it.file;
    if (!it.info && !it.err) return `<small>${kb(f.size)} · reading…</small>`;
    const src = it.info ? `${dur(it.info.duration)} · ${it.info.w}×${it.info.h}${it.info.fps ? ' · ' + Math.round(it.info.fps) + ' fps' : ''} · ${kb(f.size)}` : kb(f.size);
    if (it.err) return `<small>${src}</small><small class="err">${esc(it.err)}</small>`;
    if (it.out) {
      const d = Math.round((it.out.blob.size / f.size - 1) * 100);
      return `<small>${src} → <b>${kb(it.out.blob.size)}</b> <span class="${d > 0 ? 'up' : 'down'}">(${d > 0 ? '+' : ''}${d}%)</span> · ${(it.out.ms / 1000).toFixed(1)} s</small>`
        + (d >= 0 ? `<small class="err">The original is already smaller – keep the original, or pick a lower quality / resolution.</small>` : '')
        + (it.note ? `<small class="${/^resolution lowered/.test(it.note) ? '' : 'err'}">${esc(it.note)}</small>` : '');
    }
    const active = running?.it === it;
    return `<small>${src}</small>` + (active || it.p ? `<div class="vc-bar"><i style="width:${(it.p * 100).toFixed(1)}%"></i></div><small class="vc-pct">${Math.round(it.p * 100)}%${it.pass > 1 ? ` · pass ${it.pass} – the last try was over ${st.mb} MB` : ''}</small>` : '');
  }
  function li(it) {
    const active = running?.it === it;
    return `<video src="${it.url}#t=0.5" muted preload="metadata" playsinline aria-hidden="true"></video>
      <div class="cv-info"><b title="${esc(it.file.name)}">${esc(it.file.name)}</b><div data-line>${line(it)}</div></div>
      <div class="cv-act">${active ? `<button type="button" data-cancel="${it.id}">Cancel</button>`
        : `<button type="button" data-dl="${it.id}"${it.out ? '' : ' disabled'}>.${it.out ? FMT[it.out.fmt].ext : FMT[st.fmt].ext}</button><button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}">×</button>`}</div>`;
  }
  function renderList() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvEmpty').hidden = !!items.length;
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it) {   // keeps the <video> thumbnail element, only swaps text + buttons
    const el = $('cvList').querySelector(`li[data-id="${it.id}"]`);
    if (!el) return;
    const tmp = document.createElement('li'); tmp.innerHTML = li(it);
    el.querySelector('[data-line]').innerHTML = tmp.querySelector('[data-line]').innerHTML;
    el.querySelector('.cv-act').replaceWith(tmp.querySelector('.cv-act'));
    syncUi();
  }
  function renderProgress(it) {
    const el = $('cvList').querySelector(`li[data-id="${it.id}"]`);
    const bar = el?.querySelector('.vc-bar i'), pct = el?.querySelector('.vc-pct');
    if (!bar) return renderItem(it);
    bar.style.width = (it.p * 100).toFixed(1) + '%'; pct.textContent = Math.round(it.p * 100) + '%' + (it.pass > 1 ? ` · pass ${it.pass} – the last try was over ${st.mb} MB` : '');
  }

  const fileName = it => `${it.name}-compressed.${FMT[it.out.fmt].ext}`;
  function download(blob, name) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  $('cvList').onclick = e => {
    const dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]'), cancel = e.target.closest('[data-cancel]');
    if (dl) { const it = items.find(i => i.id === +dl.dataset.dl); if (it?.out) download(it.out.blob, fileName(it)); }
    if (cancel && running?.conv) running.conv.cancel();
    if (rm) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); renderList(); }
    }
  };
  $('cvClear').onclick = () => { if (running) return; items.forEach(i => URL.revokeObjectURL(i.url)); items = []; renderList(); };
  // videos are big – one file after another instead of a ZIP that would need all of them in memory twice
  $('vcSaveAll').onclick = async () => {
    for (const it of items.filter(i => i.out)) { download(it.out.blob, fileName(it)); await new Promise(r => setTimeout(r, 600)); }
  };
  window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Input: picker, drag & drop ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

  renderList();
})();
