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
  tr.innerHTML = `<td class="pick"><input type="checkbox" class="pick" aria-label="Select row"></td><td class="sl"><span class="grip" title="Drag to reorder (or Alt+↑ / Alt+↓ while typing)" aria-hidden="true">⠿</span><span class="n"></span></td>
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
  tr.querySelector('.grip').addEventListener('pointerdown', e => dragRow(tr, e));
  tbody.appendChild(tr); renumber();
}
function renumber() {
  const trs = [...tbody.children];
  trs.forEach((tr, i) => {
    tr.querySelector('td.sl .n').textContent = i + 1;
  });
  syncPick();
}

/* ===== Reorder rows: drag the ⠿ grip (mouse or touch), or Alt+↑ / Alt+↓ while typing in a row ===== */
function moveRow(tr, dir) {
  const sib = dir < 0 ? tr.previousElementSibling : tr.nextElementSibling;
  if (!sib) return false;
  tbody.insertBefore(tr, dir < 0 ? sib : sib.nextElementSibling);
  hideUndo();   // saved Undo positions no longer match after a move
  renumber(); onChange();
  return true;
}
function dragRow(tr, e) {
  if (e.button > 0 || tbody.classList.contains('settling')) return;
  e.preventDefault();
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  const rows = [...tbody.children], start = rows.indexOf(tr);
  const sy0 = scrollY, y0 = e.clientY;
  // Row positions in page coordinates, taken once so the math stays stable while things move
  const box = rows.map(r => { const b = r.getBoundingClientRect(); return { top: b.top + sy0, h: b.height }; });
  const h = box[start].h;
  const minDy = box[0].top - box[start].top, maxDy = box.at(-1).top + box.at(-1).h - (box[start].top + h);
  let y = y0, target = start, scrollT;
  tr.classList.add('dragging'); tbody.classList.add('sorting'); document.body.classList.add('row-drag');

  const nums = () => {   // show the serial numbers the rows will get if dropped now
    const order = rows.filter(r => r !== tr); order.splice(target, 0, tr);
    order.forEach((r, i) => r.querySelector('td.sl .n').textContent = i + 1);
  };
  const update = () => {
    const dy = Math.min(maxDy, Math.max(minDy, y - y0 + scrollY - sy0));
    tr.style.transform = `translateY(${dy}px)`;
    const c = box[start].top + h / 2 + dy;   // centre of the dragged row
    let t = start;
    for (let i = start + 1; i < rows.length; i++) if (c > box[i].top + box[i].h / 2) t = i;
    for (let i = start - 1; i >= 0; i--) if (c < box[i].top + box[i].h / 2) t = i;
    if (t !== target) {
      target = t;
      rows.forEach((r, i) => {
        if (r === tr) return;
        const shift = i > start && i <= target ? -h : i < start && i >= target ? h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
      nums();
    }
  };
  // Scroll the page while the pointer is held near the top/bottom edge
  const edge = () => {
    const d = y < 70 ? -10 : y > innerHeight - 110 ? 10 : 0;   // bottom zone clears the sticky action bar
    if (d) { scrollBy(0, d); update(); }
    scrollT = requestAnimationFrame(edge);
  };
  scrollT = requestAnimationFrame(edge);
  const move = ev => { y = ev.clientY; update(); };
  const end = () => {
    cancelAnimationFrame(scrollT);
    grip.removeEventListener('pointermove', move);
    grip.removeEventListener('pointerup', end);
    grip.removeEventListener('pointercancel', end);
    document.body.classList.remove('row-drag');
    // Glide the dragged row into its new slot, then move it in the DOM for real
    let off = 0;
    if (target > start) for (let i = start + 1; i <= target; i++) off += box[i].h;
    else for (let i = target; i < start; i++) off -= box[i].h;
    tbody.classList.add('settling');
    tr.classList.add('dropping');
    tr.style.transform = `translateY(${off}px)`;
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      tbody.classList.remove('sorting', 'settling');
      tr.classList.remove('dragging', 'dropping');
      rows.forEach(r => r.style.transform = '');
      if (target !== start) {
        tbody.insertBefore(tr, rows.filter(r => r !== tr)[target] || null);
        hideUndo();   // saved Undo positions no longer match after a move
        renumber(); onChange();
        tr.classList.add('moved'); setTimeout(() => tr.classList.remove('moved'), 700);
      } else renumber();
    };
    tr.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 260);   // in case no transition runs (reduced motion, zero distance)
  };
  grip.addEventListener('pointermove', move);
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}
tbody.addEventListener('keydown', e => {
  if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const tr = e.target.closest('tr');
  if (!tr) return;
  e.preventDefault();
  const el = e.target;
  if (moveRow(tr, e.key === 'ArrowUp' ? -1 : 1)) el.focus();
});

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

