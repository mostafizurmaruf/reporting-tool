/* =====================================================================
   "⬇ Fetch Google Doc" on the Daily Report page:
   signs in with Google (read-only), reads the doc saved in ⚙ Settings,
   takes the part written on the Reporting Date and lets Gemini turn it
   into report rows.
   ===================================================================== */
// One OAuth Client ID for the whole team (public – it is not a secret).
// Allowed origin in Google Cloud Console: https://mostafizurmaruf.github.io
const GOOGLE_CLIENT_ID = '975024824259-ls19abs6381348d0n3ddf6tkb8r0picp.apps.googleusercontent.com';
const GDOC_SCOPE = 'https://www.googleapis.com/auth/documents.readonly';

if (document.getElementById('gdFetch')) (() => {
  /* ---------- Google sign-in (Google Identity Services token client) ---------- */
  const TOKEN_KEY = 'versatilo-gdoc-token';   // sessionStorage: valid ~1 hour, gone when the tab closes
  let gisReady = null, tokenClient = null, pending = null;
  const loadGis = () => gisReady ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
    s.onload = res; s.onerror = () => { gisReady = null; s.remove(); rej(new Error('Could not load Google sign-in. Check your internet connection.')); };
    document.head.appendChild(s);
  });
  const savedToken = () => {
    try { const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null'); return t && t.exp > Date.now() + 60000 ? t.value : ''; } catch { return ''; }
  };
  const saveToken = (value, secs) => { try { value ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ value, exp: Date.now() + secs * 1000 })) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };
  // Must be called straight from the click (before any await), or the browser blocks the Google popup
  function requestToken() {
    return new Promise((resolve, reject) => {
      const ask = () => {
        tokenClient ||= google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID, scope: GDOC_SCOPE,
          callback: r => { const p = pending; pending = null; if (r.error) p?.reject(new Error('Google sign-in failed: ' + (r.error_description || r.error))); else { saveToken(r.access_token, +r.expires_in || 3600); p?.resolve(r.access_token); } },
          error_callback: e => { const p = pending; pending = null; p?.reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google sign-in popup – allow popups for this site and try again.' : 'Google sign-in failed.')); },
        });
        pending = { resolve, reject };
        tokenClient.requestAccessToken({ prompt: '' });
      };
      if (window.google?.accounts?.oauth2) ask(); else loadGis().then(ask, reject);
    });
  }
  // Load the sign-in library early, so the popup opens right inside the click
  if (gdocStore.get()) loadGis().catch(() => {});

  /* ---------- Read the document ---------- */
  const docId = v => (String(v).match(/\/document\/(?:u\/\d+\/)?d\/([\w-]{20,})/) || String(v).trim().match(/^([\w-]{20,})$/) || [])[1] || '';
  async function readDoc(id, token) {
    let res;
    try { res = await fetch(`https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`, { headers: { Authorization: 'Bearer ' + token } }); }
    catch { throw new Error('Could not reach Google Docs. Check your internet connection.'); }
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { saveToken(''); const e = new Error('Google sign-in expired.'); e.expired = true; throw e; }
    if (res.status === 403) throw new Error(/has not been used|disabled/i.test(d.error?.message || '') ? 'Google Docs API is not enabled in the Google Cloud project.' : 'This Google account cannot open the doc. Sign in with the account that owns it, or share the doc with it.');
    if (res.status === 404) throw new Error('Google Doc not found – check the link in ⚙ Settings.');
    if (!res.ok) throw new Error('Google Docs error: ' + (d.error?.message || res.statusText));
    return d;
  }
  // Document → lines of { text, level } (level 0–6 for title / headings, 9 for normal text)
  function docLines(d) {
    const lines = [];
    const LV = { TITLE: 0, HEADING_1: 1, HEADING_2: 2, HEADING_3: 3, HEADING_4: 4, HEADING_5: 5, HEADING_6: 6 };
    const walk = content => (content || []).forEach(el => {
      if (el.paragraph) {
        const p = el.paragraph;
        const text = (p.elements || []).map(e => e.textRun?.content || (e.dateElement?.dateElementProperties?.displayText) || '').join('').replace(/[\u000b\n]+/g, ' ').trim();
        if (!text) return;
        lines.push({ text: (p.bullet ? '• ' : '') + text, level: LV[p.paragraphStyle?.namedStyleType] ?? 9 });
      } else if (el.table) {
        (el.table.tableRows || []).forEach(r => {
          const cells = (r.tableCells || []).map(c => { const sub = []; const keep = lines.length; walk(c.content); sub.push(...lines.splice(keep).map(l => l.text)); return sub.join(' '); });
          if (cells.some(Boolean)) lines.push({ text: '| ' + cells.join(' | ') + ' |', level: 9 });
        });
      } else if (el.tableOfContents) { /* skip */ }
    });
    const tabs = t => (t || []).forEach(tab => { walk(tab.documentTab?.body?.content); tabs(tab.childTabs); });
    if (d.tabs?.length) tabs(d.tabs); else walk(d.body?.content);
    return lines;
  }

  /* ---------- Find the Reporting Date's part ---------- */
  const MON = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
  const pad = n => String(n).padStart(2, '0');
  const iso = (y, m, d) => { y = +y; if (y < 100) y += 2000; m = +m; d = +d; return m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : ''; };
  const mon = s => MON.split('|').indexOf(s.slice(0, 3).toLowerCase()) + 1;
  // Every date written in a line (DD/MM/YYYY like the report, YYYY-MM-DD, "9 Nov 2026", "November 9, 2026")
  function datesIn(s, year) {
    const out = [];
    for (const m of s.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) out.push(iso(m[1], m[2], m[3]));
    for (const m of s.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) out.push(+m[2] > 12 && +m[1] <= 12 ? iso(m[3], m[1], m[2]) : iso(m[3], m[2], m[1]));
    for (const m of s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON})[a-z]*\\.?,?(?:\\s+(\\d{4}))?\\b`, 'gi'))) out.push(iso(m[3] || year, mon(m[2]), m[1]));
    for (const m of s.matchAll(new RegExp(`\\b(${MON})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'gi'))) out.push(iso(m[3] || year, mon(m[1]), m[2]));
    return out.filter(Boolean);
  }
  const asText = ls => ls.map(l => (l.level < 9 ? '#'.repeat(Math.max(1, l.level)) + ' ' : '') + l.text).join('\n');
  // Sections that start with a short line (or heading) carrying the date, up to the next dated line / same-level heading
  function datedPart(lines, day) {
    const year = day.slice(0, 4);
    const isMarker = l => (l.level < 9 || l.text.length <= 80) && datesIn(l.text, year).length > 0;
    const markers = lines.filter(isMarker).length;
    const parts = [];
    lines.forEach((l, i) => {
      if (!isMarker(l) || !datesIn(l.text, year).includes(day)) return;
      const ctx = [];   // the headings above it, e.g. the module name
      for (let j = i - 1, lv = l.level; j >= 0 && lv > 0; j--) if (lines[j].level < lv && lines[j].level < 9) { ctx.unshift(lines[j]); lv = lines[j].level; }
      let k = i + 1;
      while (k < lines.length && !isMarker(lines[k]) && !(l.level < 9 && lines[k].level <= l.level)) k++;
      parts.push(asText([...ctx, ...lines.slice(i, k)]));
    });
    return { markers, text: parts.join('\n\n') };
  }
  // No dates in the doc: compare with the copy saved at the last fetch before the Reporting Date
  const SNAP_KEY = 'versatilo-gdoc-snap';
  const snaps = () => { try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '{}'); } catch { return {}; } };
  function saveSnap(id, day, lines) {
    const all = snaps(), mine = all[id] || {};
    mine[day] = lines.map(l => (l.level < 9 ? l.level + '\t' : '\t') + l.text).join('\n').slice(0, 300000);
    all[id] = Object.fromEntries(Object.entries(mine).sort().slice(-3));   // keep the 3 latest days
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(all)); } catch {}
  }
  function changedPart(id, day, lines) {
    const mine = snaps()[id] || {}, base = Object.keys(mine).filter(d => d < day).sort().pop();
    if (!base) return null;
    const old = new Set(mine[base].split('\n').map(s => s.split('\t').slice(1).join('\t')));
    const out = []; const shown = new Set(); const heads = [];
    lines.forEach(l => {
      if (l.level < 9) { heads.splice(l.level); heads[l.level] = l; }
      if (old.has(l.text)) return;
      heads.filter(Boolean).forEach(h => { if (!shown.has(h)) { shown.add(h); out.push(h); } });
      if (!shown.has(l)) { shown.add(l); out.push(l); }
    });
    return { base, text: asText(out) };
  }

  /* ---------- Gemini: text → report rows ---------- */
  async function aiRows(title, day, text, mode) {
    const how = mode === 'dated' ? 'the part of the document dated that day'
      : mode === 'changes' ? 'only the text added or changed since the previous fetch'
      : 'the end of the whole document (it has no dates, so it may also contain older work – report only what looks like the latest work)';
    const prompt = `You prepare an SQA (software quality assurance) engineer's daily work report for ${fmtDay(day)}. It is read by HR and management, who are NOT technical.
Below is ${how}, from the engineer's work document "${title}" (headings are marked with #).
Group the work into 1–8 report tasks. For each task write:
- "task": a short title in plain business English (max ~12 words), e.g. "Tested the Leave Management module" or "Documented the Attendance screens".
- "done": 1–2 professional sentences in past tense on what was done and the concrete output (screens / features covered, how many test cases or bugs if the text says so).
- "pct": completion 0–100. Use 100 unless the text says the work is unfinished, in progress or pending.
- "remarks": "Completed" when pct is 100, otherwise a short note on what is pending or why it is delayed.
Rules: stay faithful to the text – do not invent features, numbers, people or results. No markdown, no quotes, no bullet points. English only.
Return a JSON array of objects.

Text:
${text}`;
    const schema = { type: 'ARRAY', items: { type: 'OBJECT', required: ['task', 'done', 'pct', 'remarks'], properties: {
      task: { type: 'STRING' }, done: { type: 'STRING' }, pct: { type: 'INTEGER' }, remarks: { type: 'STRING' } } } };
    const out = await callGemini(prompt, schema);
    const rows = out.map(o => ({ task: String(o?.task ?? '').trim(), done: String(o?.done ?? '').trim(),
      pct: String(Math.max(0, Math.min(100, Number.isFinite(+o?.pct) ? Math.round(+o.pct) : 100))), remarks: String(o?.remarks ?? '').trim() || 'Completed' })).filter(r => r.task);
    if (!rows.length) throw new Error('Gemini returned an unexpected answer. Try again.');
    return rows;
  }

  /* ---------- The button ---------- */
  async function run(btn, tokenP) {
    const day = $('repDate').value || today(), id = docId(gdocStore.get());
    $('status').textContent = 'Signing in with Google…';
    let token = await tokenP, d;
    $('status').textContent = 'Reading your Google Doc…';
    try { d = await readDoc(id, token); }
    catch (e) { if (!e.expired) throw e; throw new Error('Google sign-in expired – click ⬇ Fetch Google Doc again.'); }
    const title = (d.title || 'Google Doc').trim(), lines = docLines(d);
    if (!lines.length) { $('status').textContent = `“${title}” is empty.`; return; }

    let text = '', mode = '', note = '';
    const dated = datedPart(lines, day);
    if (dated.text) { text = dated.text; mode = 'dated'; }
    else if (dated.markers >= 2) { saveSnap(id, day, lines); $('status').textContent = `No entry dated ${fmtDay(day)} found in “${title}”. Write the day’s work under a date heading like ${fmtDay(day)}.`; return; }
    else {
      const ch = changedPart(id, day, lines);
      if (ch && !ch.text.trim()) { saveSnap(id, day, lines); $('status').textContent = `Nothing new in “${title}” since ${fmtDay(ch.base)}.`; return; }
      if (ch) { text = ch.text; mode = 'changes'; note = ` (changes since ${fmtDay(ch.base)})`; }
      else { text = asText(lines).slice(-12000); mode = 'whole'; note = ' – the doc has no dates, so Gemini guessed the latest work; tip: add a date heading for each day'; }
    }
    saveSnap(id, day, lines);
    text = text.slice(0, 20000);

    $('status').textContent = `Gemini is writing report rows from “${title}”…`;
    const rows = await aiRows(title, day, text, mode);
    // Replace rows fetched earlier for the same doc + day, drop blank rows, then add the new ones
    const key = `gdoc:${id}:${day}`, val = (tr, f) => tr.querySelector(`[data-f=${f}]`).value.trim();
    [...tbody.children].filter(tr => tr._commits.includes(key) || (!val(tr, 'task') && !val(tr, 'source') && !val(tr, 'done') && /^(completed)?$/i.test(val(tr, 'remarks')))).forEach(tr => tr.remove());
    rows.forEach(r => addRow({ ...r, source: 'SQA – ' + title, commits: [key] }));
    if (!tbody.children.length) addRow();
    onChange();
    $('status').textContent = `Added ${rows.length} task${rows.length === 1 ? '' : 's'} from “${title}” for ${fmtDay(day)}${note}. Please review before submitting.`;
  }

  $('gdFetch').onclick = () => {
    const btn = $('gdFetch');
    if (!docId(gdocStore.get())) { openSettings(); $('setMsg').textContent = 'Paste your Google Doc link under Google Docs, then Save.'; $('gdocUrl').focus(); return; }
    if (!($('aiKey').value.trim() || aiKeyMem)) { openSettings(); $('setMsg').textContent = 'Add your Gemini API key – it writes the report rows from the doc.'; $('aiKey').focus(); return; }
    const tok = savedToken(), tokenP = tok ? Promise.resolve(tok) : requestToken();   // popup opens inside the click
    setBusy(btn, true);
    run(btn, tokenP).catch(e => { $('status').textContent = e.message; }).finally(() => setBusy(btn, false));
  };
})();
