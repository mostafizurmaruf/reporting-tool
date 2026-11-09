/* =====================================================================
   "⬇ Fetch SQA work" on the Daily Report page:
   the day's SQA documentation activity (written by sqa.html) → report rows
   ===================================================================== */
if (document.getElementById('sqaFetch')) (() => {
  const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
  let doc, act;
  function readSqa() {
    const d = read(SQA_DOC_KEY) || {}, str = v => typeof v === 'string' ? v : '';
    doc = {
      project: str(d.project),
      modules: (Array.isArray(d.modules) ? d.modules : []).map(m => ({
        id: str(m.id), name: str(m.name),
        overview: str(m.overview),
        sections: (Array.isArray(m.sections) ? m.sections : []).map(s => ({ id: str(s.id), heading: str(s.heading), intro: str(s.intro), points: str(s.points), table: str(s.table) })),
      })),
    };
    act = read(SQA_ACT_KEY) || {};
  }
  const filled = s => s.heading.trim() && (s.points.trim() || s.table.trim());
  const list = (a, n = 6) => a.length > n ? a.slice(0, n).join(', ') + ` and ${a.length - n} more` : a.join(', ');
  function dayItems(day) {
    const d = act[day] || {}, items = [];
    for (const [mid, e] of Object.entries(d)) {
      if (mid === '_x' || e.deleted) continue;
      const m = doc.modules.find(x => x.id === mid);
      if (!m) continue;   // module no longer in this document
      const live = new Map(m.sections.map(s => [s.id, s]));
      const secs = Object.entries(e.secs || {}).filter(([id, x]) => !x.deleted && live.has(id)).map(([id, x]) => ({ s: live.get(id), new: x.new || e.created }));
      const head = s => s.heading.trim() || 'untitled section';
      const used = m.sections.filter(s => s.heading.trim() || s.points.trim() || s.intro.trim() || s.table.trim());
      const done = used.filter(filled), pending = used.filter(s => !filled(s)).map(head);
      const newSecs = secs.filter(x => x.new).map(x => head(x.s)), upd = secs.filter(x => !x.new).map(x => head(x.s));
      if (!newSecs.length && !upd.length && !e.created && !e.overview && !e.ai) continue;   // only renamed – nothing to report
      items.push({
        key: 'sqa:' + mid, module: m.name.trim() || 'Untitled', project: doc.project.trim(), newModule: !!e.created, aiDrafted: e.ai > 0,
        newSections: newSecs, updatedSections: upd, overviewWritten: !!e.overview && !!m.overview.trim(),
        sectionsComplete: done.length, sectionsTotal: used.length, pendingSections: pending,
        pct: used.length ? Math.round(done.length / used.length * 100) : 0,
      });
    }
    const x = d._x;
    if (x) {
      const how = [x.docx && 'downloaded as DOCX', x.copy && 'copied into Google Docs', x.print && 'printed / saved as PDF'].filter(Boolean);
      if (how.length) items.push({ key: 'sqa:share', share: true, project: doc.project.trim(), how, pct: 100 });
    }
    return items;
  }
  function plainRow(it) {
    const src = 'SQA Documentation' + (it.project ? ' – ' + it.project : '');
    if (it.share) return { task: 'Compiled and shared the SQA documentation', done: `Prepared the ${it.project || 'application'} feature documentation for the team (${it.how.join(', ')}).`, source: src };
    const parts = [];
    if (it.newSections.length) parts.push(`Documented ${it.newSections.length} new section${it.newSections.length > 1 ? 's' : ''} (${list(it.newSections)}).`);
    if (it.updatedSections.length) parts.push(`Updated ${it.updatedSections.length} section${it.updatedSections.length > 1 ? 's' : ''} (${list(it.updatedSections)}).`);
    if (it.overviewWritten) parts.push('Wrote the module overview.');
    if (it.aiDrafted) parts.push('Drafted with Gemini, then reviewed against the app.');
    return { task: `${it.newModule ? 'Created' : 'Updated'} SQA documentation – ${it.module} module`, done: parts.join(' ') || 'Reviewed and refined the module documentation.', source: src };
  }
  const remarkOf = it => it.share || !it.pendingSections.length ? 'Completed'
    : `In progress – ${it.sectionsComplete} of ${it.sectionsTotal} sections complete. Pending: ${list(it.pendingSections, 4)}.`;
  async function aiRows(items) {
    const prompt = `You prepare an SQA (software quality assurance) engineer's daily work report. It is read by HR and management, who are NOT technical.
Each input item is one piece of documentation work done today in the "${doc.project.trim() || 'application'}" feature documentation (a module = one screen or feature of the app; sections = parts of that screen), or a "share" item meaning the document was exported / shared.
For each item write:
- task: a short task title (max 12 words), e.g. "Documented the Leave Management module" or "Updated the Attendance module documentation".
- done: 1–2 professional sentences in past tense on what was documented and the concrete output (mention the main screen parts by name, how many sections). Plain business English; no jargon, no markdown, no quotes.
Stay faithful to the data – do not invent screens, numbers or results. Write in English only.
Return a JSON array with one object per input item, in the same order.

Input:
${JSON.stringify(items.map(({ key, pct, ...rest }) => rest), null, 1)}`;
    const out = await callGemini(prompt, { type: 'ARRAY', items: { type: 'OBJECT', required: ['task', 'done'], properties: { task: { type: 'STRING' }, done: { type: 'STRING' } } } });
    return items.map((it, i) => ({ ...plainRow(it), ...(out[i]?.task ? { task: String(out[i].task).trim() } : {}), ...(out[i]?.done ? { done: String(out[i].done).trim() } : {}) }));
  }
  $('sqaFetch').onclick = async () => {
    const btn = $('sqaFetch'), day = $('repDate').value || today();
    readSqa();   // always read the latest document (it may have been edited on the SQA Tool page in another tab)
    const items = dayItems(day);
    if (!items.length) {
      $('status').textContent = `No SQA documentation work recorded on ${fmtDay(day)}. Work on the SQA Tool page – it is tracked automatically in this browser.`;
      return;
    }
    setBusy(btn, true);
    let rows = items.map(plainRow), note = '';
    try {
      if ($('aiKey').value.trim() || aiKeyMem) {
        $('status').textContent = `Found ${items.length} piece${items.length > 1 ? 's' : ''} of SQA work – Gemini is writing the report rows…`;
        try { rows = await aiRows(items); note = 'ai'; } catch (e) { note = e.message; }
      }
      // Drop blank rows, then update rows fetched earlier (same module) or add new ones
      const val = (tr, f) => tr.querySelector(`[data-f=${f}]`).value.trim();
      [...tbody.children].filter(tr => !val(tr, 'task') && !val(tr, 'source') && !val(tr, 'done') && /^(completed)?$/i.test(val(tr, 'remarks'))).forEach(tr => tr.remove());
      let added = 0, updated = 0;
      items.forEach((it, i) => {
        const r = { ...rows[i], pct: String(it.pct), remarks: remarkOf(it), commits: [it.key] };
        const tr = [...tbody.children].find(t => t._commits.includes(it.key));
        if (tr) { ['task', 'source', 'done', 'pct', 'remarks'].forEach(f => tr.querySelector(`[data-f=${f}]`).value = r[f]); updated++; }
        else { addRow(r); added++; }
      });
      onChange();
      const what = [added && `added ${added}`, updated && `updated ${updated}`].filter(Boolean).join(' and ');
      $('status').textContent = `SQA work for ${fmtDay(day)}: ${what} row${added + updated > 1 ? 's' : ''}` + (note === 'ai' ? ' (written by Gemini). Please review before submitting.'
        : note ? `. Gemini could not rewrite them: ${note}` : '. Add a Gemini key in ⚙ Settings for plain-language rows.');
    } finally { setBusy(btn, false); }
  };

})();
