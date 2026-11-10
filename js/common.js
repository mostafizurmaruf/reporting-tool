/* =====================================================================
   Helpers shared by every page (loaded first)
   ===================================================================== */
const $ = id => document.getElementById(id);
const today = () => { const n = new Date(); return [n.getFullYear(), String(n.getMonth() + 1).padStart(2, '0'), String(n.getDate()).padStart(2, '0')].join('-'); };
const fmtDay = day => { const [y, m, d] = day.split('-'); return `${d}/${m}/${y}`; };

// Employee details saved by the Daily Report page (used by the sidebar card)
const REPORT_KEY = 'versatilo-daily-task-v1';
// Google Doc link for "⬇ Fetch Google Doc" (⚙ Settings, per browser)
const GDOC_KEY = 'versatilo-gdoc-url';
const gdocStore = {
  get() { try { return localStorage.getItem(GDOC_KEY) || ''; } catch { return ''; } },
  set(v) { try { v ? localStorage.setItem(GDOC_KEY, v) : localStorage.removeItem(GDOC_KEY); } catch {} },
};
// "Save downloads to Google Drive" (⚙ Settings, per browser) – on unless switched off
const DRIVE_KEY = 'versatilo-drive-save';
const driveStore = {
  get() { try { return localStorage.getItem(DRIVE_KEY) !== '0'; } catch { return true; } },
  set(on) { try { on ? localStorage.removeItem(DRIVE_KEY) : localStorage.setItem(DRIVE_KEY, '0'); } catch {} },
};
// "⬇ Fetch Google Doc" + its Settings section are only for SQA Engineers (Designation on the Daily Report)
const SQA = 'SQA Engineer';
const applyRole = role => document.body.classList.toggle('sqa', role === SQA);
function savedEmployee() {
  try { const d = JSON.parse(localStorage.getItem(REPORT_KEY) || 'null') || {}; return { name: String(d.empName || '').trim(), role: String(d.designation || '').trim() }; }
  catch { return { name: '', role: '' }; }
}

// Show / hide a spinning loader on a button (and next to the status text) while work is running
let busyCount = 0;
function setBusy(btns, on) {
  [].concat(btns).forEach(b => { b.disabled = on; b.classList.toggle('busy', on); b.setAttribute('aria-busy', on); });
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
  $('status').classList.toggle('busy', busyCount > 0);
}
