/* =====================================================================
   Video to Text page – screen recordings / videos → text.
   Speech:  the sound track is decoded in the browser (Web Audio, 16 kHz mono)
            and cut into pieces at quiet moments.
            Gemini  → each ~4 min piece is sent as WAV to Google Gemini (user's key).
            Offline → Whisper (Transformers.js, in a web worker); the library comes
                      from jsdelivr and the model from huggingface.co on first use,
                      then the browser caches them. The audio never leaves the browser.
   Screen:  a frame is grabbed every N seconds; frames that look the same as the
            last one are skipped, the rest are read with Gemini or Tesseract.js,
            and only lines that were not already seen are kept (so scrolling or a
            static slide doesn't repeat the same text over and over).
   ===================================================================== */
(() => {
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js';
  const SET_KEY = 'versatilo-vtt-v1';
  const RATE = 16000;                    // Whisper and Gemini both want 16 kHz mono speech
  const MAX_FRAMES = { gemini: 300, offline: 400 };
  const say = t => { $('status').textContent = t; };
  const st = { mode: 'both', engine: 'gemini', lang: 'auto', model: 'base', every: '2', stamps: 'on' };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const kb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const words = t => (t.match(/\S+/g) || []).length;
  const ts = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${String(m).padStart(2, '0')}:${x}`; };
  const wantSpeech = () => st.mode !== 'screen', wantScreen = () => st.mode !== 'speech';

  let stopReq = false;
  const checkStop = () => { if (stopReq) throw new Error('Stopped.'); };

  /* =================================================================
     Speech
     ================================================================= */
  // Decodes the file's sound track straight to 16 kHz (decodeAudioData resamples to the context's rate) and mixes to mono
  async function getAudio(file) {
    const buf = await file.arrayBuffer();
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    let ab;
    try { ab = await new Ctx(1, 1, RATE).decodeAudioData(buf); }
    catch { throw new Error('No sound could be read from this video – it may have been recorded without audio. Try “Screen text”.'); }
    const n = ab.length, out = new Float32Array(n);
    for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) out[i] += d[i]; }
    if (ab.numberOfChannels > 1) for (let i = 0; i < n; i++) out[i] /= ab.numberOfChannels;
    return out;
  }
  const rms = (a, s = 0, e = a.length) => { let t = 0; for (let i = s; i < e; i++) t += a[i] * a[i]; return Math.sqrt(t / Math.max(1, e - s)); };

  // Cuts the audio into pieces of at most `max` seconds, each ending at the quietest 0.1 s after `min` seconds
  function pieces(a, min, max) {
    const out = [], win = RATE / 10, step = RATE / 20;
    let s = 0;
    while (s < a.length) {
      let e = s + max * RATE;
      if (e >= a.length) e = a.length;
      else {
        let best = Infinity;
        for (let p = s + min * RATE; p + win <= s + max * RATE; p += step) { const r = rms(a, p, p + win); if (r < best) { best = r; e = p + win / 2; } }
        e = Math.round(e);
      }
      out.push([s, e]); s = e;
    }
    return out;
  }
  const SILENT = 0.003;   // pieces quieter than this are skipped (saves time; Whisper invents "Thank you." on silence)

  function wav(a) {
    const b = new ArrayBuffer(44 + a.length * 2), v = new DataView(b);
    const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); v.setUint32(4, 36 + a.length * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, a.length * 2, true);
    for (let i = 0; i < a.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, a[i])) * 0x7fff, true);
    return new Blob([b], { type: 'audio/wav' });
  }
  const b64 = blob => new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = () => fail(r.error); r.readAsDataURL(blob); });

  const langHint = () => st.lang === 'en' ? 'The speech is in English.' : st.lang === 'bn' ? 'The speech is in Bangla – write it in Bengali script.' : 'The speech may be English, Bangla or a mix of both.';

  async function speechGemini(it, a, prog) {
    const list = pieces(a, 200, 240), segs = [];
    for (let i = 0; i < list.length; i++) {
      checkStop();
      const [s, e] = list[i], off = s / RATE;
      prog(i / list.length, `Gemini is listening… part ${i + 1} of ${list.length}`);
      if (rms(a, s, e) < SILENT) continue;
      const data = await b64(wav(a.subarray(s, e)));
      const prompt = `This audio clip is from a screen recording. Transcribe every spoken word exactly as said. ${langHint()} Keep each word in its original language and script (Bangla in Bengali script, English in Latin script); do not translate, summarise, correct or add anything. Ignore music and background noise.
Return a JSON array of objects, one per sentence or short phrase, in order: "start" = seconds from the beginning of THIS clip when it is said, "text" = the words.
If nobody speaks, return an empty array.`;
      const schema = { type: 'ARRAY', items: { type: 'OBJECT', properties: { start: { type: 'NUMBER' }, text: { type: 'STRING' } }, required: ['start', 'text'] } };
      const out = await callGemini(prompt, schema, null, [{ mime: 'audio/wav', data }]);
      const len = (e - s) / RATE;
      for (const o of out) {
        const text = String(o?.text ?? '').trim();
        if (text) segs.push({ t: off + Math.min(len, Math.max(0, +o.start || 0)), text });
      }
    }
    return segs;
  }

  /* ---------- Whisper in a module web worker (keeps the page responsive) ---------- */
  const WORKER_SRC = `
import { pipeline, env } from '${TF_URL}';
env.allowLocalModels = false;
let asr = null, cur = '';
self.onmessage = async ({ data: m }) => {
  try {
    if (m.model !== cur) {
      if (asr) { await asr.dispose?.(); asr = null; cur = ''; }
      asr = await pipeline('automatic-speech-recognition', m.model, { dtype: 'q8', device: 'wasm', progress_callback: p => self.postMessage({ type: 'load', p }) });
      cur = m.model;
    }
    if (!m.audio) { self.postMessage({ type: 'done', text: '' }); return; }
    const opt = { task: 'transcribe' };
    if (m.language) opt.language = m.language;
    const r = await asr(m.audio, opt);
    self.postMessage({ type: 'done', text: (Array.isArray(r) ? r[0] : r)?.text || '' });
  } catch (e) { self.postMessage({ type: 'error', message: e?.message || String(e) }); }
};`;
  let asrWorker = null, asrUrl = '';
  function asr(msg, onLoad) {
    if (!asrWorker) {
      asrUrl ||= URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      asrWorker = new Worker(asrUrl, { type: 'module' });
    }
    const w = asrWorker;
    return new Promise((ok, fail) => {
      w.onmessage = ({ data: d }) => {
        if (d.type === 'load') onLoad?.(d.p);
        else if (d.type === 'done') ok(d.text);
        else fail(new Error(d.message));
      };
      w.onerror = e => { e.preventDefault?.(); killAsr(); fail(new Error('Could not load the offline speech engine – check your internet connection (needed the first time).')); };
      w.postMessage(msg, msg.audio ? [msg.audio.buffer] : []);
    });
  }
  const killAsr = () => { asrWorker?.terminate(); asrWorker = null; };

  async function speechOffline(it, a, prog) {
    const model = `onnx-community/whisper-${st.model}`, language = { en: 'english', bn: 'bengali' }[st.lang] || null;
    // load the model first (with download progress), then transcribe ~30 s pieces – Whisper's window is 30 s
    const files = {};
    await asr({ model }, p => {
      if (p.status === 'progress' && p.total) files[p.file] = [p.loaded, p.total];
      const v = Object.values(files), got = v.reduce((s, x) => s + x[0], 0), all = v.reduce((s, x) => s + x[1], 0);
      prog(0, all ? `Downloading the speech model (first time only)… ${Math.round(got / all * 100)}% of ${kb(all)}` : 'Starting the offline speech engine…');
    });
    const list = pieces(a, 20, 29), segs = [];
    for (let i = 0; i < list.length; i++) {
      checkStop();
      const [s, e] = list[i];
      prog(i / list.length, `Listening… ${ts(s / RATE)} of ${ts(a.length / RATE)}`);
      if (rms(a, s, e) < SILENT) continue;
      const text = (await asr({ model, language, audio: a.slice(s, e) })).trim();
      // drop Whisper's typical "hallucinations" on near-silent pieces
      if (text && !/^[\s.。,!?…-]*$|^\[.*\]$|^\(.*\)$/.test(text)) segs.push({ t: s / RATE, text });
    }
    return segs;
  }

  async function doSpeech(it, prog) {
    prog(0, 'Reading the sound track…');
    const a = await getAudio(it.file);
    it.duration ||= a.length / RATE;
    if (rms(a) < SILENT / 3) return [];
    return st.engine === 'gemini' ? speechGemini(it, a, prog) : speechOffline(it, a, prog);
  }

  /* =================================================================
     Screen text
     ================================================================= */
  const once = (el, ok, ms = 15000) => new Promise((res, rej) => {
    const t = setTimeout(() => { clean(); rej(new Error('The video took too long to respond.')); }, ms);
    const fine = () => { clean(); res(); }, bad = () => { clean(); rej(new Error('This video could not be opened in the browser.')); };
    const clean = () => { clearTimeout(t); el.removeEventListener(ok, fine); el.removeEventListener('error', bad); };
    el.addEventListener(ok, fine); el.addEventListener('error', bad);
  });
  async function openVideo(it) {
    const v = Object.assign(document.createElement('video'), { muted: true, preload: 'auto', playsInline: true, src: it.url });
    const meta = once(v, 'loadeddata');
    v.load(); await meta;
    // Screen recordings saved by MediaRecorder (WebM) often have no length in the header: seek far past the end to make the browser find it
    if (!isFinite(v.duration) || !v.duration) {
      const found = new Promise(res => { const f = () => { if (isFinite(v.duration)) { v.removeEventListener('durationchange', f); res(); } }; v.addEventListener('durationchange', f); });
      v.currentTime = 1e101;
      await Promise.race([found, new Promise(r => setTimeout(r, 15000))]);
      if (!isFinite(v.duration)) { if (it.duration) return v; throw new Error('Could not find the length of this video.'); }
    }
    it.duration = v.duration;
    return v;
  }
  async function seek(v, t) {
    const done = once(v, 'seeked', 20000);
    v.currentTime = t;
    await done;
  }

  // small grey thumbnail used to skip frames that look the same as the last one read
  const sigC = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
  const sigG = sigC.getContext('2d', { willReadFrequently: true });
  function signature(v) {
    sigG.drawImage(v, 0, 0, 160, 90);
    const d = sigG.getImageData(0, 0, 160, 90).data, out = new Uint8Array(160 * 90);
    for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
    return out;
  }
  const changedPx = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 28) n++; return n; };

  function frameCanvas(v, maxSide) {
    const w = v.videoWidth, h = v.videoHeight, k = Math.min(1, maxSide / Math.max(w, h));
    const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return c;
  }

  // keeps only lines that were not seen before in this video (case, spaces and punctuation ignored)
  function newLines(lines, seen) {
    const out = [];
    for (let l of lines) {
      l = l.replace(/\s+/g, ' ').trim();
      const key = l.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
      if (key.length < 3 || (l.match(/\p{L}/gu) || []).length < 2 || seen.has(key)) continue;
      seen.add(key); out.push(l);
    }
    return out;
  }

  /* ---------- Tesseract (loaded on first use, one worker kept per language set) ---------- */
  let tessLoading = null, tWorker = null, tLang = '';
  const tess = () => window.Tesseract ? Promise.resolve(window.Tesseract) : (tessLoading ||= new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src: TESS_URL, async: true });
    s.onload = () => ok(window.Tesseract);
    s.onerror = () => { tessLoading = null; s.remove(); fail(new Error('Could not load the OCR library – check your internet connection.')); };
    document.head.appendChild(s);
  }));
  async function getTess() {
    const lang = { en: 'eng', bn: 'ben' }[st.lang] || 'eng+ben';
    if (tWorker && tLang === lang) return tWorker;
    if (tWorker) { await tWorker.terminate().catch(() => {}); tWorker = null; }
    const T = await tess();
    tWorker = await T.createWorker(lang, 1);
    tLang = lang;
    return tWorker;
  }

  async function doScreen(it, prog) {
    prog(0, 'Opening the video…');
    const v = await openVideo(it);
    try {
      if (!v.videoWidth) throw new Error('This file has no picture – use “Speech” for audio files.');
      const dur = it.duration;
      let every = +st.every;
      const cap = MAX_FRAMES[st.engine];
      if (dur / every > cap) every = Math.ceil(dur / cap);
      it.note = every !== +st.every ? `long video – screen read every ${every} s` : '';

      // 1) walk through the video, keep frames that changed
      const frames = [];
      let last = null;
      for (let t = Math.min(0.3, dur / 2); t < dur; t += every) {
        checkStop();
        await seek(v, t);
        prog(t / dur * (st.engine === 'gemini' ? 0.3 : 0.15), `Looking at the screen… ${ts(t)} of ${ts(dur)}`);
        const sig = signature(v);
        if (last && changedPx(sig, last) < 12) continue;
        last = sig;
        frames.push({ t, c: frameCanvas(v, st.engine === 'gemini' ? 1600 : 2400) });
        if (st.engine === 'gemini') { const c = frames.at(-1).c; frames.at(-1).data = c.toDataURL('image/jpeg', 0.85).split(',')[1]; frames.at(-1).c = null; }
      }
      const base = st.engine === 'gemini' ? 0.3 : 0.15, seen = new Set(), segs = [];
      const push = (t, lines) => { const n = newLines(lines, seen); if (n.length) segs.push({ t, text: n.join('\n'), block: true }); };

      // 2) read them
      if (st.engine === 'gemini') {
        const B = 6;
        for (let i = 0; i < frames.length; i += B) {
          checkStop();
          const batch = frames.slice(i, i + B);
          prog(base + (1 - base) * i / frames.length, `Gemini is reading the screen… ${Math.min(i + B, frames.length)} of ${frames.length} frames`);
          const prompt = `These ${batch.length} images are frames from a screen recording, in time order. For EACH image, transcribe all readable text on the screen exactly as written. It may be English, Bangla (Bengali script) or a mix – keep every word in its original language and script; do not translate, correct, summarise or add anything. Focus on the main content (documents, web pages, apps, slides, code, chat); skip the operating-system taskbar, clock and window buttons.
Return a JSON array with exactly ${batch.length} strings, one per image in the same order. In each string put one line of screen text per line (separated by \\n), in natural reading order. Use "" for an image with no readable text.`;
          const out = await callGemini(prompt, { type: 'ARRAY', items: { type: 'STRING' } }, null, batch.map(f => f.data));
          batch.forEach((f, k) => push(f.t, String(out[k] ?? '').split('\n')));
        }
      } else {
        prog(base, 'Starting the OCR engine (first time downloads the language data)…');
        const w = await getTess();
        for (let i = 0; i < frames.length; i++) {
          checkStop();
          prog(base + (1 - base) * i / frames.length, `Reading the screen… frame ${i + 1} of ${frames.length} (${ts(frames[i].t)})`);
          const { data } = await w.recognize(frames[i].c);
          const lines = data.lines?.length ? data.lines.filter(l => l.confidence >= 45).map(l => l.text) : (data.text || '').split('\n');
          push(frames[i].t, lines);
          frames[i].c = null;
        }
      }
      return segs;
    } finally { v.removeAttribute('src'); v.load(); }
  }

  /* =================================================================
     Result text
     ================================================================= */
  function compose(it) {
    const on = st.stamps === 'on', r = it.res;
    const sp = r.speech && (r.speech.length ? r.speech.map(s => (on ? `[${ts(s.t)}] ` : '') + s.text).join(on ? '\n' : ' ') : '(no speech found)');
    const sc = r.screen && (r.screen.length ? r.screen.map(s => (on ? `[${ts(s.t)}]\n` : '') + s.text).join('\n\n') : '(no text found on screen)');
    if (sp != null && sc != null) return `===== SPEECH =====\n${sp}\n\n===== SCREEN TEXT =====\n${sc}`;
    return sp ?? sc;
  }
  const empty = it => it.res && !(it.res.speech?.length || it.res.screen?.length);

  /* =================================================================
     Controls
     ================================================================= */
  const SEGS = [['vtMode', 'mode'], ['vtEngine', 'engine'], ['vtLang', 'lang'], ['vtModel', 'model'], ['vtEvery', 'every'], ['vtStamps', 'stamps']];
  for (const [id, key] of SEGS)
    $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { if (running) return; st[key] = b.dataset.v; changed(key); }; });

  const hasKey = () => !!($('aiKey').value.trim() || aiKeyMem);
  function syncUi() {
    for (const [id, key] of SEGS) $(id).querySelectorAll('button').forEach(b => { b.setAttribute('aria-pressed', b.dataset.v === st[key]); b.disabled = running; });
    document.querySelectorAll('.ic-ctrl [data-eng], .ic-ctrl [data-need]').forEach(r => {
      r.hidden = (r.dataset.eng && r.dataset.eng !== st.engine) || (r.dataset.need === 'speech' && !wantSpeech()) || (r.dataset.need === 'screen' && !wantScreen());
    });
    const what = st.mode === 'speech' ? 'the sound' : st.mode === 'screen' ? 'frames of the video' : 'the sound and frames of the video';
    $('cvNote').textContent = st.engine === 'gemini'
      ? `Gemini AI – most accurate, especially for Bangla and mixed speech. ${what[0].toUpperCase() + what.slice(1)} (not the whole file) is sent to Google Gemini with your own API key` + (hasKey() ? '.' : ' – add the key in ⚙ Settings first.') + ' Long videos use more of the free quota.'
      : 'Offline – the video stays in your browser.' + (wantSpeech() ? ' Speech uses Whisper: the model is downloaded once and cached; Bangla needs “Accurate” and is still weaker than Gemini. About 1–3× the video length on a normal laptop.' : '') + (wantScreen() ? ' Screen text uses Tesseract (English / Bangla data ≈ 5 MB, first time only).' : '');
    const todo = items.filter(i => !i.res && !i.err).length, done = items.filter(i => i.res && !empty(i)).length;
    $('ocGo').disabled = !items.length;
    $('ocGo').textContent = running ? 'Stop' : todo || !done ? `Convert to text${items.length > 1 ? ' (all)' : ''}` : 'Convert again';
    $('ocGo').classList.toggle('primary', !running);
    $('ocCopyAll').hidden = $('ocSaveAll').hidden = !done;
    $('ocCopyAll').textContent = done > 1 ? `Copy all (${done})` : 'Copy text';
    $('cvClear').hidden = !items.length || running;
  }
  const changed = key => {
    save();
    // timestamps are only formatting – everything else needs a fresh run
    items.forEach(it => {
      if (key === 'stamps') { if (it.res) { it.text = compose(it); renderItem(it, true); } }
      else if (it.res || it.err) { it.res = it.text = null; it.err = ''; it.p = 0; renderItem(it, true); }
    });
    syncUi();
  };

  /* =================================================================
     Files
     ================================================================= */
  let items = [], seq = 0, running = false;   // item: {id, file, name, url, duration, res:{speech,screen}, text, ms, err, p, phase, note}

  function addFiles(list) {
    const files = [...list].filter(f => /^(video|audio)\//.test(f.type) || /\.(mp4|m4v|webm|mkv|mov|mp3|m4a|wav|ogg|opus)$/i.test(f.name || ''));
    if (!files.length) { say('Please choose video files (MP4, WebM …).'); return; }
    for (const file of files) items.push({ id: ++seq, file, name: (file.name || 'video').replace(/\.[^.]+$/, '') || 'video', url: URL.createObjectURL(file), duration: 0, res: null, text: null, ms: 0, err: '', p: 0, phase: '', note: '' });
    renderList();
    say(`${items.length} video${items.length > 1 ? 's' : ''} ready – press Convert to text.`);
  }

  async function runAll() {
    if (running) { stopReq = true; say('Stopping after the current step…'); return; }
    if (st.engine === 'gemini' && !hasKey()) {
      openSettings(); $('setMsg').textContent = 'Add your Gemini API key to use Gemini AI, then Save.'; $('aiKey').focus();
      return;
    }
    let queue = items.filter(i => !i.res);
    if (!queue.length) { items.forEach(i => { i.res = i.text = null; i.err = ''; }); queue = [...items]; renderList(); }
    running = true; stopReq = false; syncUi();
    let n = 0;
    for (const it of queue) {
      if (!items.includes(it)) continue;
      if (stopReq) break;
      n++; say(`Converting ${n} of ${queue.length}: ${it.file.name}…`);
      it.err = ''; it.p = 0; it.phase = ''; it.note = ''; renderItem(it, true);
      const t0 = performance.now();
      try {
        const both = wantSpeech() && wantScreen(), res = {};
        const part = (a, b) => (p, phase) => { it.p = a + (b - a) * p; it.phase = phase || ''; renderProgress(it); };
        if (wantSpeech()) {
          try { res.speech = await doSpeech(it, part(0, both ? 0.5 : 1)); }
          catch (e) { if (!both || stopReq) throw e; res.speech = []; it.note = e.message; }   // a silent video can still have screen text
        }
        if (wantScreen()) res.screen = await doScreen(it, part(both ? 0.5 : 0, 1));
        it.res = res; it.text = compose(it); it.ms = performance.now() - t0;
      } catch (e) {
        it.err = e.message || String(e);
        if (st.engine === 'offline' && !stopReq) { killAsr(); await tWorker?.terminate().catch(() => {}); tWorker = null; }   // a failed worker may be stuck
      }
      it.p = 0; it.phase = '';
      renderItem(it, true);
    }
    running = false;
    const ok = items.filter(i => i.res && !empty(i)), total = ok.reduce((s, i) => s + words(i.text), 0);
    say(stopReq ? 'Stopped.' : !ok.length ? 'No text was found.' : `Done · ${total} word${total === 1 ? '' : 's'} from ${ok.length} video${ok.length > 1 ? 's' : ''} – check it before using.`);
    stopReq = false;
    syncUi();
  }
  $('ocGo').onclick = runAll;

  /* =================================================================
     List
     ================================================================= */
  function line(it) {
    const src = (it.duration ? ts(it.duration) + ' · ' : '') + kb(it.file.size);
    const note = it.note ? `<small class="vc-pct">${esc(it.note)}</small>` : '';
    if (it.err) return `<small>${src}</small><small class="err">${esc(it.err)}</small>`;
    if (it.res) {
      if (empty(it)) return `<small>${src}</small><small class="err">No speech or screen text found.</small>${note}`;
      const r = it.res, parts = [];
      if (r.speech) parts.push(`${r.speech.length} speech line${r.speech.length === 1 ? '' : 's'}`);
      if (r.screen) parts.push(`${r.screen.length} screen change${r.screen.length === 1 ? '' : 's'}`);
      return `<small>${src} · <b>${words(it.text)} words</b> · ${parts.join(' · ')} · ${(it.ms / 1000).toFixed(0)} s</small>${note}`;
    }
    const active = running && (it.p || it.phase);
    return `<small>${src}${running ? '' : ' · ready'}</small>` + (active ? progressHtml(it) : '');
  }
  const progressHtml = it => `<div class="vc-bar"><i style="width:${(it.p * 100).toFixed(1)}%"></i></div><small class="vc-pct">${Math.round(it.p * 100)}%${it.phase ? ' · ' + esc(it.phase) : ''}</small>`;
  function li(it) {
    const has = !!(it.res && !empty(it));
    return `<video src="${it.url}#t=0.5" muted preload="metadata" playsinline aria-hidden="true"></video>
      <div class="cv-info"><b title="${esc(it.file.name)}">${esc(it.file.name)}</b><div data-line>${line(it)}</div></div>
      <div class="cv-act"><button type="button" data-copy="${it.id}"${has ? '' : ' disabled'}>Copy</button><button type="button" data-dl="${it.id}"${has ? '' : ' disabled'}>.txt</button><button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}"${running ? ' disabled' : ''}>×</button></div>
      <textarea class="oc-text" data-text="${it.id}" rows="10" spellcheck="false" aria-label="Text from ${esc(it.name)}"${has ? '' : ' hidden'}>${esc(has ? it.text : '')}</textarea>`;
  }
  function renderList() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvList').querySelectorAll('video').forEach((v, i) => v.addEventListener('loadedmetadata', () => {
      const it = items[i];
      if (it && !it.duration && isFinite(v.duration)) { it.duration = v.duration; renderItem(it); }
    }, { once: true }));
    $('cvEmpty').hidden = !!items.length;
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it, withText) {   // keeps the <video> thumbnail; the textarea is only rebuilt when the text itself changed
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
    if (!bar) return renderItem(it);
    bar.style.width = (it.p * 100).toFixed(1) + '%';
    pct.textContent = Math.round(it.p * 100) + '%' + (it.phase ? ' · ' + it.phase : '');
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
  const done = () => items.filter(i => i.res && !empty(i) && i.text?.trim());
  const allText = () => { const ok = done(); return ok.length === 1 ? ok[0].text : ok.map(i => `########## ${i.file.name} ##########\n${i.text.trim()}`).join('\n\n\n'); };

  $('cvList').onclick = e => {
    const cp = e.target.closest('[data-copy]'), dl = e.target.closest('[data-dl]'), rm = e.target.closest('[data-rm]');
    if (cp) { const it = items.find(i => i.id === +cp.dataset.copy); if (it?.text) copy(it.text, 'Text'); }
    if (dl) { const it = items.find(i => i.id === +dl.dataset.dl); if (it?.text) download(it.text, `${it.name}.txt`); }
    if (rm && !running) {
      const i = items.findIndex(x => x.id === +rm.dataset.rm);
      if (i >= 0) { URL.revokeObjectURL(items[i].url); items.splice(i, 1); renderList(); }
    }
  };
  $('cvClear').onclick = () => { if (running) return; items.forEach(i => URL.revokeObjectURL(i.url)); items = []; renderList(); };
  $('ocCopyAll').onclick = () => { const t = allText(); if (t) copy(t, 'All text'); };
  $('ocSaveAll').onclick = () => { const t = allText(); if (!t) return; const ok = done(); download(t, ok.length === 1 ? `${ok[0].name}.txt` : 'video-text.txt'); };
  window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Input: picker, drag & drop ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

  renderList();
})();
