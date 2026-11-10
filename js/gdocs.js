/* =====================================================================
   "⬇ Fetch Google Doc" on the Daily Report page:
   signs in with Google (js/google-auth.js), reads the Docs / Sheets saved in ⚙ Settings,
   takes the part written on the Reporting Date and lets Gemini turn it
   into report rows.
   ===================================================================== */
if (document.getElementById('gdFetch')) (() => {
  // Load the sign-in library early, so the popup opens right inside the click
  if (gdocStore.get()) GoogleAuth.load().catch(() => {});

  /* ---------- Read the document ---------- */
  // Link → "doc/<id>" or "sheet/<id>" (a bare id counts as a doc)
  const docId = v => {
    v = String(v).trim();
    const m = v.match(/\/(document|spreadsheets)\/(?:u\/\d+\/)?d\/([\w-]{20,})/);
    return m ? (m[1] === 'document' ? 'doc/' : 'sheet/') + m[2] : /^[\w-]{20,}$/.test(v) ? 'doc/' + v : '';
  };
  // One link per line (commas / spaces work too); duplicates removed
  const docIds = () => [...new Set(gdocStore.get().split(/[\s,]+/).map(docId).filter(Boolean))];
  // Google API call with friendlier messages for a doc / sheet link
  const gapi = (url, token, what) => GoogleAuth.api(url, token, what).catch(e => {
    if (e.status === 403) throw new Error('This Google account cannot open it. Sign in with the account that owns it, or share it with that account.');
    if (e.status === 404) throw new Error('not found – check the link in ⚙ Settings.');
    throw e;
  });
  const readDoc = (id, token) => gapi(`https://docs.googleapis.com/v1/documents/${id}?includeTabsContent=true`, token, 'Docs');
  // Spreadsheet → { title, mdy, sheets: [{ title, rows: [[cell…]] }] } (cells as shown in the sheet)
  async function readSheet(id, token) {
    const meta = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=properties(title,locale),sheets.properties(title,hidden)`, token, 'Sheets');
    const tabs = (meta.sheets || []).map(x => x.properties).filter(x => x && !x.hidden).map(x => x.title);
    if (!tabs.length) return { title: meta.properties?.title, sheets: [] };
    const q = tabs.map(t => 'ranges=' + encodeURIComponent(`'${t.replace(/'/g, "''")}'`)).join('&');
    const v = await gapi(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values:batchGet?${q}&majorDimension=ROWS`, token, 'Sheets');
    return { title: meta.properties?.title, mdy: /^en_(US|PH)$/.test(meta.properties?.locale || ''),   // US-style sheets write dates as MM/DD/YYYY
             sheets: tabs.map((t, i) => ({ title: t, rows: (v.valueRanges?.[i]?.values || []).map(r => r.map(c => String(c ?? '').replace(/\s+/g, ' ').trim())) })) };
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
  function datesIn(s, year, mdy) {
    const out = [];
    for (const m of s.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) out.push(iso(m[1], m[2], m[3]));
    for (const m of s.matchAll(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/g)) out.push((mdy ? +m[1] <= 12 : +m[2] > 12 && +m[1] <= 12) ? iso(m[3], m[1], m[2]) : iso(m[3], m[2], m[1]));
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

  /* ---------- Gemini: text of every doc → report rows ---------- */
  const HOW = {
    dated: 'the part dated that day',
    changes: 'only the text added or changed since the previous fetch',
    whole: 'the end of the document (it has no dates, so it may also contain older work – report only what looks like the latest work)',
  };
  async function aiRows(day, docs) {
    const prompt = `You prepare an SQA (software quality assurance) engineer's daily work report for ${fmtDay(day)}. It is read by HR and management, who are NOT technical.
Below is text from the engineer's work documents and spreadsheets, numbered from 0 (headings are marked with #; spreadsheet rows are shown as | cell | cell |, under their column names).
Group the work into report tasks (usually 1–8 per document; never mix two documents in one task). For each task write:
- "doc": the number of the document the task comes from.
- "task": a short title in plain business English (max ~12 words), e.g. "Tested the Leave Management module" or "Documented the Attendance screens".
- "done": 1–2 professional sentences in past tense on what was done and the concrete output (screens / features covered, how many test cases or bugs if the text says so).
- "pct": completion 0–100. Use 100 unless the text says the work is unfinished, in progress or pending.
- "remarks": "Completed" when pct is 100, otherwise a short note on what is pending or why it is delayed.
Rules: stay faithful to the text – do not invent features, numbers, people or results. No markdown, no quotes, no bullet points. English only.
Return a JSON array of objects.

${docs.map((d, i) => `=== Document ${i}: "${d.title}" – ${HOW[d.mode]} ===\n${d.text}`).join('\n\n')}`;
    const schema = { type: 'ARRAY', items: { type: 'OBJECT', required: ['doc', 'task', 'done', 'pct', 'remarks'], properties: {
      doc: { type: 'INTEGER' }, task: { type: 'STRING' }, done: { type: 'STRING' }, pct: { type: 'INTEGER' }, remarks: { type: 'STRING' } } } };
    const out = await callGemini(prompt, schema);
    const rows = out.map(o => ({ doc: docs[Number.isInteger(o?.doc) && docs[o.doc] ? o.doc : 0], task: String(o?.task ?? '').trim(), done: String(o?.done ?? '').trim(),
      pct: String(Math.max(0, Math.min(100, Number.isFinite(+o?.pct) ? Math.round(+o.pct) : 100))), remarks: String(o?.remarks ?? '').trim() || 'Completed' })).filter(r => r.task);
    if (!rows.length) throw new Error('Gemini returned an unexpected answer. Try again.');
    return rows;
  }

  /* ---------- One doc → the Reporting Date's text (or a reason it has none) ---------- */
  async function sheetPart(id, day, token) {
    const d = await readSheet(id.slice(6), token), year = day.slice(0, 4);
    const title = (d.title || 'Google Sheet').trim(), lines = [], parts = [];
    let dated = 0;
    for (const sh of d.sheets) {
      const rows = sh.rows.filter(r => r.some(Boolean));
      if (!rows.length) continue;
      const row = r => '| ' + r.join(' | ') + ' |', head = { text: 'Columns: ' + row(rows[0]), level: 2 };
      lines.push({ text: sh.title, level: 1 }, head, ...rows.slice(1).map(r => ({ text: row(r), level: 9 })));
      const hits = rows.slice(1).filter(r => { const ds = r.flatMap(c => c.length <= 40 ? datesIn(c, year, d.mdy) : []); if (ds.length) dated++; return ds.includes(day); });
      if (hits.length) parts.push(asText([{ text: sh.title, level: 1 }, head, ...hits.map(r => ({ text: row(r), level: 9 }))]));
    }
    if (!lines.length) return { id, title, skip: 'empty' };
    let res;
    if (parts.length) res = { id, title, mode: 'dated', text: parts.join('\n\n') };
    else if (dated >= 2) res = { id, title, skip: `no row dated ${fmtDay(day)}` };
    else {
      const ch = changedPart(id, day, lines);
      res = ch && !ch.text.trim() ? { id, title, skip: `nothing new since ${fmtDay(ch.base)}` }
        : ch ? { id, title, mode: 'changes', text: ch.text }
        : { id, title, mode: 'whole', text: asText(lines).slice(-12000) };
    }
    saveSnap(id, day, lines);
    if (res.text) res.text = res.text.slice(0, 20000);
    return res;
  }
  async function docPart(id, day, token) {
    if (id.startsWith('sheet/')) return sheetPart(id, day, token);
    const d = await readDoc(id.slice(4), token);
    const title = (d.title || 'Google Doc').trim(), lines = docLines(d);
    if (!lines.length) return { id, title, skip: 'empty' };
    const dated = datedPart(lines, day);
    let res;
    if (dated.text) res = { id, title, mode: 'dated', text: dated.text };
    else if (dated.markers >= 2) res = { id, title, skip: `no entry dated ${fmtDay(day)}` };
    else {
      const ch = changedPart(id, day, lines);
      res = ch && !ch.text.trim() ? { id, title, skip: `nothing new since ${fmtDay(ch.base)}` }
        : ch ? { id, title, mode: 'changes', text: ch.text }
        : { id, title, mode: 'whole', text: asText(lines).slice(-12000) };
    }
    saveSnap(id, day, lines);
    if (res.text) res.text = res.text.slice(0, 20000);
    return res;
  }

  /* ---------- The button ---------- */
  async function run(ids, tokenP) {
    const day = $('repDate').value || today();
    $('status').textContent = 'Signing in with Google…';
    const token = await tokenP;
    $('status').textContent = `Reading ${ids.length} Google Doc${ids.length === 1 ? '' : 's'}…`;
    const got = await Promise.all(ids.map(id => docPart(id, day, token).catch(e => {
      if (e.expired) throw new Error(e.message + ' Click ⬇ Fetch Google Doc again.');
      return { id, title: (id.startsWith('sheet/') ? 'Sheet …' : 'Doc …') + id.slice(-6), skip: e.message };
    })));
    const docs = got.filter(d => d.text), skipped = got.filter(d => d.skip).map(d => `“${d.title}”: ${d.skip}`);
    if (!docs.length) {
      $('status').textContent = `Nothing to add for ${fmtDay(day)} – ${skipped.join('; ')}.` + (got.some(d => /no entry dated/.test(d.skip)) ? ` Write the day’s work under a date heading like ${fmtDay(day)}.` : '');
      return;
    }
    $('status').textContent = `Gemini is writing report rows from ${docs.length} doc${docs.length === 1 ? '' : 's'}…`;
    const rows = await aiRows(day, docs);
    // Replace rows fetched earlier for the same docs + day, drop blank rows, then add the new ones
    const keys = new Set(docs.map(d => `gdoc:${d.id}:${day}`)), val = (tr, f) => tr.querySelector(`[data-f=${f}]`).value.trim();
    [...tbody.children].filter(tr => tr._commits.some(k => keys.has(k)) || (!val(tr, 'task') && !val(tr, 'source') && !val(tr, 'done') && /^(completed)?$/i.test(val(tr, 'remarks')))).forEach(tr => tr.remove());
    rows.forEach(({ doc, ...r }) => addRow({ ...r, source: 'SQA – ' + doc.title, commits: [`gdoc:${doc.id}:${day}`] }));
    if (!tbody.children.length) addRow();
    onChange();
    const guessed = docs.filter(d => d.mode === 'whole').map(d => `“${d.title}”`);
    $('status').textContent = `Added ${rows.length} task${rows.length === 1 ? '' : 's'} from ${docs.map(d => `“${d.title}”`).join(', ')} for ${fmtDay(day)}. Please review before submitting.`
      + (guessed.length ? ` ${guessed.join(', ')} has no dates, so Gemini guessed the latest work – add a date heading for each day.` : '')
      + (skipped.length ? ` Skipped – ${skipped.join('; ')}.` : '');
  }

  // Settings opened from this button → Save continues the fetch (the Save click also allows the Google popup)
  let resume = false;
  $('settings').addEventListener('close', () => setTimeout(() => { resume = false; }));
  $('setSave').addEventListener('click', () => { if (resume) { resume = false; setTimeout(() => $('gdFetch').click()); } });
  const askSettings = (msg, field) => { openSettings(); $('setMsg').textContent = msg; $(field).focus(); resume = true; };

  $('gdFetch').onclick = () => {
    const btn = $('gdFetch'), ids = docIds();
    if (btn.disabled) return;
    if (!ids.length) return askSettings(gdocStore.get() ? 'That is not a Google Docs / Sheets link – paste links like https://docs.google.com/document/d/… or …/spreadsheets/d/…, then Save.' : 'Paste your Google Docs / Sheets link(s) – one per line – then Save.', 'gdocUrl');
    if (!($('aiKey').value.trim() || aiKeyMem)) return askSettings('Add your Gemini API key – it writes the report rows from the doc – then Save.', 'aiKey');
    const tokenP = GoogleAuth.token();   // popup opens inside the click
    setBusy(btn, true);
    run(ids, tokenP).catch(e => { $('status').textContent = e.message; }).finally(() => setBusy(btn, false));
  };
})();
