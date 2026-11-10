/* ===== Form logic ===== */
const KEY = REPORT_KEY;
const tbody = $('tasks');
const store = {
  ok: (() => { try { localStorage.setItem(KEY + '-t', '1'); const r = localStorage.getItem(KEY + '-t') === '1'; localStorage.removeItem(KEY + '-t'); return r; } catch { return false; } })(),
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } },
};
const NO_STORE = 'Auto-save is blocked in this browser (private mode or blocked site data).';
// Section A (tasks) and Section B (summary) are never kept in browser storage
const NOT_STORED = ['tasks', 'manual', 'sAssigned', 'sDone', 'sPending', 'sOverall', 'repDate', 'inTime', 'outTime', 'empSign'];
// Default values (editable – your changes are saved) and per-day defaults applied every time the page opens
const FIXED = { designation: 'Software Developer', dept: 'IT', manager: 'Afsana Tanni' };
const DEFAULTS = () => ({ inTime: '11:15', outTime: '19:15', repDate: today() });
// Employee Signature = "Name" + "DD/MM/YYYY, Out Time" from the fields above (read-only, always auto)
function autoSign() {
  const n = $('empName').value.trim(), t = DOCX.fmtTime($('outTime').value), dt = DOCX.fmtDate($('repDate').value || today());
  $('empSign').value = n ? [n, [dt, t].filter(Boolean).join(', ')].filter(Boolean).join('\n') : '';
  // Supervisor Signature date & time = Reporting Date + Office Out Time (fixed, not editable)
  $('supSignDate').textContent = [dt, t].filter(Boolean).join(', ');
}
// Section A rows + Section B numbers are saved per Reporting Date, so each day keeps its own report
const DAY_FIELDS = ['sAssigned', 'sDone', 'sPending', 'sOverall'];
let curDay = '';   // the Reporting Date the rows on screen belong to
function storable() {
  const d = collect(), days = { ...((store.get() || {}).days || {}) };
  const used = d.tasks.some(t => t.task || t.source || t.done || !/^(completed)?$/i.test(t.remarks || '')) || DAY_FIELDS.some(k => d.manual[k] || (k === 'sOverall' && d[k]));
  if (curDay) { if (used) { const trs = [...tbody.children]; days[curDay] = { tasks: d.tasks.map((t, i) => trs[i]._commits.length ? { ...t, commits: trs[i]._commits } : t), manual: d.manual }; DAY_FIELDS.forEach(k => days[curDay][k] = d[k]); } else delete days[curDay]; }
  NOT_STORED.forEach(k => delete d[k]);
  d.days = days;
  return d;
}
function loadDay(day) {
  const s = ((store.get() || {}).days || {})[day] || {};
  curDay = day;
  tbody.innerHTML = ''; hideUndo();
  manual = { ...(s.manual || {}) };
  if (s.tasks?.length) s.tasks.forEach(t => addRow(t)); else for (let i = 0; i < 6; i++) addRow();
  DAY_FIELDS.forEach(k => $(k).value = s[k] ?? '');
  autoSummary();
}

function addRow(t = {}) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td class="pick"><input type="checkbox" class="pick" aria-label="Select row"></td><td class="sl"></td>
    <td><textarea data-f="task" rows="2"></textarea></td>
    <td><textarea data-f="source" rows="2"></textarea></td>
    <td><textarea data-f="done" rows="2"></textarea></td>
    <td class="pct"><input data-f="pct" type="number" min="0" max="100" placeholder="0–100"></td>
    <td><textarea data-f="remarks" rows="2"></textarea></td>
    <td class="act"><button type="button" class="icon gen" title="Generate Work Done with AI" aria-label="Generate Work Done with AI">✨</button><button type="button" class="icon del" title="Remove row" aria-label="Remove row">✕</button></td>`;
  tr.querySelectorAll('[data-f]').forEach(el => el.value = t[el.dataset.f] ?? '');
  tr._commits = t.commits || [];   // keys of the commits this row reports; removing the row frees them for the next fetch
  if (t.pct == null) tr.querySelector('[data-f=pct]').value = '100';
  if (t.remarks == null) tr.querySelector('[data-f=remarks]').value = 'Completed';
  tr.querySelector('.gen').onclick = () => aiGenerate([tr], true);
  tr.querySelector('.del').onclick = () => deleteRows([tr]);
  tbody.appendChild(tr); renumber();
}
function renumber() { [...tbody.children].forEach((tr, i) => tr.querySelector('td.sl').textContent = i + 1); syncPick(); }

/* ===== Row selection: single checkbox + select all → delete selected ===== */
function picks() { return [...tbody.querySelectorAll('input.pick')]; }
function syncPick() {
  const all = picks(), on = all.filter(c => c.checked);
  all.forEach(c => c.closest('tr').classList.toggle('picked', c.checked));
  const head = $('pickAll');
  head.checked = all.length > 0 && on.length === all.length;
  head.indeterminate = on.length > 0 && on.length < all.length;
  const del = $('delSel');
  del.hidden = !on.length;
  del.textContent = on.length === all.length && all.length > 1 ? `🗑 Delete all (${on.length})` : `🗑 Delete selected (${on.length})`;
}
tbody.addEventListener('change', e => { if (e.target.matches('input.pick')) syncPick(); });
$('pickAll').addEventListener('change', e => { picks().forEach(c => c.checked = e.target.checked); syncPick(); });
$('delSel').onclick = () => {
  const rows = picks().filter(c => c.checked).map(c => c.closest('tr'));
  if (!rows.length) return;
  deleteRows(rows);
};

/* ===== Delete with Undo (single ✕ and Delete selected) ===== */
let undoData = null, undoT;
function deleteRows(rows) {
  const all = [...tbody.children];
  const removed = rows.map(tr => ({ tr, i: all.indexOf(tr) })).sort((a, b) => a.i - b.i);
  removed.forEach(r => { r.tr.remove(); r.tr.querySelector('input.pick').checked = false; });
  const filler = tbody.children.length ? null : (addRow(), tbody.lastElementChild);   // table never stays empty
  renumber(); onChange();
  undoData = { removed, filler };
  const n = removed.length;
  $('undoMsg').textContent = `Deleted ${n} row${n === 1 ? '' : 's'}.`;
  $('undoBar').classList.add('show');
  clearTimeout(undoT); undoT = setTimeout(hideUndo, 10000);
}
function hideUndo() { $('undoBar').classList.remove('show'); undoData = null; }
function undoDelete() {
  if (!undoData) return;
  const { removed, filler } = undoData;
  // Remove the auto-added blank row only if it is still untouched
  if (filler && filler.isConnected && ![...filler.querySelectorAll('textarea')].some(t => t.value.trim() && t.value.trim() !== 'Completed')) filler.remove();
  removed.forEach(({ tr, i }) => tbody.insertBefore(tr, tbody.children[i] || null));
  renumber(); onChange();
  clearTimeout(undoT); hideUndo();
  $('status').textContent = `Restored ${removed.length} row${removed.length === 1 ? '' : 's'}.`;
}
$('undoBtn').onclick = undoDelete;
// Ctrl+Z / ⌘Z also undoes the last delete while the Undo bar is showing (not while typing in a field)
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && undoData && !e.target.closest('input,textarea,[contenteditable]')) {
    e.preventDefault(); undoDelete();
  }
});

function collect() {
  const d = {};
  document.querySelectorAll('[data-k]').forEach(el => d[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value.trim());
  d.tasks = [...tbody.children].map(tr => { const o = {}; tr.querySelectorAll('[data-f]').forEach(el => o[el.dataset.f] = el.value.trim()); return o; });
  d.supSign = $('supSignDate').textContent;
  d.manual = manual;
  return d;
}

let manual = {};
function autoSummary() {
  const filled = [...tbody.children].map(tr => ({ task: tr.querySelector('[data-f=task]').value.trim(), pct: tr.querySelector('[data-f=pct]').value }))
                                    .filter(t => t.task);
  const done = filled.filter(t => Number(t.pct) >= 100).length;
  const vals = { sAssigned: filled.length, sDone: done, sPending: filled.length - done };
  for (const k in vals) if (!manual[k]) $(k).value = filled.length ? vals[k] : '';
}
let saveT;
function saveNow() {
  clearTimeout(saveT);
  const ok = store.set(storable()), cur = $('status').textContent;
  // Don't hide an important message (e.g. a Gemini/GitHub error) behind "Saved …"
  if (!ok) $('status').textContent = NO_STORE;
  else if (!cur || /^Saved \d/.test(cur)) $('status').textContent = 'Saved ' + new Date().toLocaleTimeString();
}
function onChange() {
  autoSummary();
  autoSign();
  clearTimeout(saveT);
  saveT = setTimeout(saveNow, 300);
}
// Flush pending changes when the tab is closed, reloaded or hidden
addEventListener('pagehide', saveNow);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

function load() {
  const d = store.get() || {};
  tbody.innerHTML = ''; hideUndo();
  manual = {};
  document.querySelectorAll('[data-k]').forEach(el => {
    const v = NOT_STORED.includes(el.dataset.k) ? undefined : d[el.dataset.k];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v ?? '';
  });
  Object.entries(DEFAULTS()).forEach(([k, v]) => $(k).value = v);
  Object.entries(FIXED).forEach(([k, v]) => { if (!$(k).value.trim()) $(k).value = v; });
  applyRole($('designation').value);
  loadDay($('repDate').value || today());
  autoSign();
  $('supSignImg').src = 'data:image/jpeg;base64,' + SIGN_B64;
}

// Changing the Reporting Date: keep the current day's rows, then show the chosen day's saved rows
$('repDate').addEventListener('input', () => {
  const day = $('repDate').value;
  if (!day || day === curDay) return;
  saveNow();
  loadDay(day);
});
document.addEventListener('input', e => {
  if (['sAssigned', 'sDone', 'sPending'].includes(e.target.id)) manual[e.target.id] = e.target.value !== '';
  if (e.target.matches('input[type=number]')) {
    const max = e.target.max ? Number(e.target.max) : Infinity;
    if (Number(e.target.value) > max) e.target.value = max;
    if (Number(e.target.value) < 0) e.target.value = 0;
  }
  onChange();
});
document.addEventListener('change', onChange);
// Designation decides whether the SQA-only controls (Fetch Google Doc) are shown – apply right away
$('designation').addEventListener('change', e => applyRole(e.target.value));
$('addRow').onclick = () => { addRow(); onChange(); tbody.lastElementChild.querySelector('textarea').focus(); };

