/* ===== AI: Work Done from commit name (Google Gemini, free tier) ===== */
const AI_KEY = 'versatilo-gemini-key';
// Tried in order: if one model is overloaded (503) or out of free quota (429), the next one is used.
// Fastest first: Flash-Lite with thinking turned off answers short report text in a second or two.
const AI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-2.5-flash'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const aiStore = {
  get() { try { return localStorage.getItem(AI_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem(AI_KEY, v) : localStorage.removeItem(AI_KEY); } catch {} },
};
let aiKeyMem = aiStore.get();
$('aiKey').value = aiKeyMem;

async function askGemini(tasks) {
  const key = $('aiKey').value.trim() || aiKeyMem;
  if (!key) throw new Error('Add your Gemini API key in ⚙ Settings first.');
  const prompt = `You write the "Work Done / Measurable Output" column of a software developer's daily task report.
Each input item is a git commit message or short task name (optionally with remarks). For each, write 1–2 concise, professional sentences in past tense describing what was done and the concrete output. The report is read by HR and management, who are not technical: use plain business English and avoid jargon (no commit, merge, refactor, API, branch, file or function names).
Rules: stay faithful to the input; do not invent numbers, names, tools or results that are not implied; no markdown, no bullet points, no quotes, no leading labels.
Return a JSON array of strings, one per input item, in the same order.

Input:
${JSON.stringify(tasks.map(t => t.remarks ? { task: t.task, remarks: t.remarks } : { task: t.task }), null, 1)}`;
  const out = await callGemini(prompt, { type: 'ARRAY', items: { type: 'STRING' } }, key);
  return out.map(v => String(v ?? '').trim());
}

// Shared Gemini call: returns the parsed JSON array that matches `schema`
async function callGemini(prompt, schema, key, images = []) {
  key = key || $('aiKey').value.trim() || aiKeyMem;
  if (!key) throw new Error('Add your Gemini API key in ⚙ Settings first.');
  // thinkingBudget 0 = no "thinking" step (the slow part). Models that don't accept it are retried without it.
  // level 0: thinking off + JSON schema · 1: default thinking + schema · 2: plain JSON, no schema (schema is in the prompt anyway)
  const makeBody = level => JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: level < 2 ? prompt : prompt + '\nReply with JSON only, matching this schema: ' + JSON.stringify(schema) },
                                       ...images.map(data => ({ inline_data: { mime_type: 'image/jpeg', data } }))] }],
    generationConfig: { temperature: 0.4, responseMimeType: 'application/json',
                        ...(level < 2 ? { responseSchema: schema } : {}),
                        ...(level === 0 ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
  });
  let data, lastMsg = '', busy = false;
  outer:
  for (const model of AI_MODELS) {
    let level = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) { $('status').textContent = `Gemini is busy, retrying (${model})…`; await sleep(2000); }
      let res;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: makeBody(level),
        });
      } catch { throw new Error('Could not reach Gemini. Check your internet connection.'); }
      const d = await res.json().catch(() => ({}));
      if (res.ok) { data = d; break outer; }
      lastMsg = d.error?.message || res.statusText;
      if (res.status === 400 && /api key/i.test(lastMsg) || res.status === 401 || res.status === 403) throw new Error('Gemini rejected the API key. Check it and save again.');
      if (res.status === 400 && level < 2) { level++; attempt--; continue; }   // a setting this model rejects → same model, simpler request
      if (res.status === 400) continue outer;                 // still rejected → next model
      if (res.status === 404) continue outer;                 // model not available for this key → next model
      if (res.status === 429) { busy = true; continue outer; } // this model's free quota is used up → next model
      if (res.status >= 500) { busy = true; continue; }        // overloaded / high demand → retry, then next model
      throw new Error('Gemini error: ' + lastMsg);
    }
  }
  if (!data) throw new Error(busy ? 'All Gemini models are busy or over the free limit right now. Wait a minute and try again.' : 'Gemini error: ' + lastMsg);
  const text = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('').trim();
  let out;
  try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { throw new Error('Gemini returned an unexpected answer. Try again.'); }
  if (!Array.isArray(out)) throw new Error('Gemini returned an unexpected answer. Try again.');
  return out;
}

// Turn raw git commits into a few plain-language report rows that HR / management can read
async function commitsToTasks(commits) {
  const prompt = `You prepare a software developer's daily work report. The report is read by HR and management, who are NOT technical.
Below are today's git commits (project name + commit message), numbered from 0.
Group commits that belong to the same feature, fix or piece of work into ONE task. Usually 2–8 tasks in total; never more tasks than commits.
For each task write:
- "task": a short title in plain business English (max ~12 words), e.g. "Improved the login page". Do not put the project name in the title – it is shown in a separate column.
Only group commits from the same project.
- "done": 1–2 sentences in past tense describing what was achieved and why it matters to users or the business.
- "commits": the numbers of the commits included in this task. Every commit number must appear in exactly one task.
Rules: avoid technical jargon (no words like commit, merge, refactor, API, endpoint, branch, PR, component, CSS, file or function names); explain it the way you would to a manager. Stay faithful to the commits – do not invent features, numbers, people or results. No markdown, no quotes, no bullet points.
Return a JSON array of objects.

Commits:
${commits.map((c, i) => `${i}. [${c.repo}] ${c.task}`).join('\n')}`;
  const schema = { type: 'ARRAY', items: { type: 'OBJECT', properties: {
    task: { type: 'STRING' }, done: { type: 'STRING' }, commits: { type: 'ARRAY', items: { type: 'INTEGER' } },
  }, required: ['task', 'done', 'commits'] } };
  const out = await callGemini(prompt, schema);
  const rows = out.map(o => ({ task: String(o?.task ?? '').trim(), done: String(o?.done ?? '').trim(),
                               idx: (o?.commits || []).filter(n => Number.isInteger(n) && n >= 0 && n < commits.length) }))
                  .filter(r => r.task);
  if (!rows.length) throw new Error('Gemini returned an unexpected answer. Try again.');
  // Any commit Gemini left out still gets its own row, so no work goes missing
  const used = new Set(rows.flatMap(r => r.idx));
  commits.forEach((c, i) => { if (!used.has(i)) rows.push({ task: c.task, done: '', idx: [i] }); });
  return rows;
}

let aiBusy = false;
async function aiGenerate(rows, overwrite) {
  if (aiBusy) return;
  const items = rows.map(tr => ({ tr, task: tr.querySelector('[data-f=task]').value.trim(), remarks: tr.querySelector('[data-f=remarks]').value.trim().replace(/^Completed$/i, ''),
                                  done: tr.querySelector('[data-f=done]') }))
                    .filter(x => x.task && (overwrite || !x.done.value.trim()));
  if (!items.length) { $('status').textContent = overwrite ? 'Write the commit / task name first.' : 'No rows with a task and an empty Work Done.'; return; }
  aiBusy = true;
  const btns = [...document.querySelectorAll('#tasks .gen')];
  btns.forEach(b => b.disabled = true);
  const spin = items.map(x => x.tr.querySelector('.gen')).filter(Boolean);
  setBusy(spin, true);
  $('status').textContent = `Generating Work Done for ${items.length} row${items.length > 1 ? 's' : ''}…`;
  try {
    const out = await askGemini(items);
    let n = 0;
    items.forEach((x, i) => { if (out[i]) { x.done.value = out[i]; n++; } });
    onChange();
    $('status').textContent = `Generated Work Done for ${n} row${n === 1 ? '' : 's'}. Please review before submitting.`;
  } catch (e) {
    $('status').textContent = e.message;
  } finally {
    aiBusy = false;
    setBusy(spin, false);
    btns.forEach(b => b.disabled = false);
  }
}

