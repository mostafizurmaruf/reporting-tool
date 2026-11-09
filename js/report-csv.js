/* ===== CSV import / template ===== */
const CSV_COLS = ['Task Assigned / Undertaken', 'Work Source / Instructed By', 'Work Done / Measurable Output', 'Completion (%)', 'Pending Tasks / Delay Reason / Remarks'];
const CSV_FIELDS = ['task', 'source', 'done', 'pct', 'remarks'];
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0];
  const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(v => v.trim())).filter(r => r.some(Boolean));
}
function headerField(h) {
  h = h.toLowerCase();
  if (/^(sl|s\.?\s?no\.?|no\.?|#|serial)$/.test(h)) return 'sl';
  if (/remark|pending|delay/.test(h)) return 'remarks';
  if (/source|instruct/.test(h)) return 'source';
  if (/done|output/.test(h)) return 'done';
  if (/complet|%|percent|progress/.test(h)) return 'pct';
  if (/task/.test(h)) return 'task';
  return null;
}
function importCSV(text) {
  const rows = parseCSV(text);
  if (!rows.length) return 0;
  let map = rows[0].map(headerField);
  if (map.some(Boolean)) rows.shift();                         // header row present
  else map = rows[0].length >= 6 ? ['sl', ...CSV_FIELDS] : CSV_FIELDS; // no header: by position
  const tasks = rows.map(r => {
    const t = {};
    map.forEach((f, i) => { if (f && f !== 'sl' && r[i] != null) t[f] = r[i]; });
    if (t.pct != null) {
      const n = parseFloat(String(t.pct).replace('%', ''));
      t.pct = isNaN(n) ? undefined : String(Math.max(0, Math.min(100, n)));
    }
    return t;
  }).filter(t => CSV_FIELDS.some(f => f !== 'pct' && t[f]));
  if (!tasks.length) return 0;
  tbody.innerHTML = ''; hideUndo();
  tasks.forEach(t => addRow(t));
  onChange();
  return tasks.length;
}
