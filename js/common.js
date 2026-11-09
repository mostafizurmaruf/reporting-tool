/* =====================================================================
   Helpers shared by every page (loaded first)
   ===================================================================== */
const $ = id => document.getElementById(id);
const today = () => { const n = new Date(); return [n.getFullYear(), String(n.getMonth() + 1).padStart(2, '0'), String(n.getDate()).padStart(2, '0')].join('-'); };
const fmtDay = day => { const [y, m, d] = day.split('-'); return `${d}/${m}/${y}`; };

// Employee details saved by the Daily Report page (used by the sidebar card and the SQA author field)
const REPORT_KEY = 'versatilo-daily-task-v1';
// SQA Tool document + daily activity log (written by sqa.html, read by "⬇ Fetch SQA work" on the Daily Report)
const SQA_DOC_KEY = 'versatilo-sqa-doc-v1', SQA_ACT_KEY = 'versatilo-sqa-activity-v1';
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
