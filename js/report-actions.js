/* ===== Report actions: Copy commits, Fetch commits, CSV buttons, DOCX / PDF export ===== */
$('ghCopy').onclick = async () => {
  const btn = $('ghCopy'); setBusy(btn, true);
  $('status').textContent = 'Fetching commits from GitHub…';
  try {
    const { day, user, commits, failed } = await fetchCommits();
    if (!commits.length) { $('status').textContent = `No commits by ${user} found on ${fmtDay(day)}.` + warn(failed); return; }
    await copyText(commitsText(commits));
    const repos = new Set(commits.map(c => c.repo)).size;
    $('status').textContent = `Copied ${commits.length} commit${commits.length === 1 ? '' : 's'} from ${repos} project${repos === 1 ? '' : 's'} (${fmtDay(day)})` + warn(failed);
  } catch (e) {
    $('status').textContent = e.message;
  } finally { setBusy(btn, false); }
};
$('ghFetch').onclick = async () => {
  const btn = $('ghFetch'); setBusy(btn, true);
  $('status').textContent = 'Fetching commits from GitHub…';
  try {
    const { day, user, commits, failed } = await fetchCommits(true);   // always live, so commits made a moment ago are found
    const have = new Set([...tbody.querySelectorAll('[data-f=task]')].map(el => el.value.trim().toLowerCase()).filter(Boolean));
    const ck = c => c.repo + '\n' + c.task.toLowerCase();
    // Rows remember their commits (saved per Reporting Date), because AI rows no longer match the raw message
    const taken = new Set([...tbody.children].flatMap(tr => tr._commits));
    const fresh = commits.filter(c => !have.has(c.task.toLowerCase()) && !taken.has(ck(c)));
    // With a Gemini key: rewrite commits into plain-language tasks for HR. Without one (or if Gemini fails): one row per commit.
    let rows = fresh.map(c => ({ task: c.task, source: c.repo, commits: [ck(c)] })), aiNote = '';
    if (fresh.length && ($('aiKey').value.trim() || aiKeyMem)) {
      $('status').textContent = `Found ${fresh.length} commit${fresh.length === 1 ? '' : 's'} – Gemini is writing them as report tasks…`;
      try { rows = (await commitsToTasks(fresh)).map(r => ({ task: r.task, done: r.done, source: [...new Set(r.idx.map(i => fresh[i].repo))].join(', '), commits: r.idx.map(i => ck(fresh[i])) })); aiNote = 'ai'; }
      catch (e) { aiNote = e.message; }
      // Grouping failed, or Gemini left some rows without "Work Done": fill those rows one by one
      const empty = rows.filter(r => !r.done);
      if (empty.length) {
        $('status').textContent = `Gemini is writing Work Done for ${empty.length} row${empty.length === 1 ? '' : 's'}…`;
        try { const out = await askGemini(empty); empty.forEach((r, i) => { if (out[i]) r.done = out[i]; }); if (aiNote !== 'ai') aiNote = 'ai'; }
        catch (e) { if (aiNote === 'ai') aiNote = e.message; }
      }
    } else if (fresh.length) {
      $('setOpen').click();   // no Gemini key → open Settings so it can be added
    }
    if (rows.length) {
      // Drop blank rows (default "Completed" remark counts as blank), then add the new rows
      const val = (tr, f) => tr.querySelector(`[data-f=${f}]`).value.trim();
      [...tbody.children].filter(tr => !val(tr, 'task') && !val(tr, 'source') && !val(tr, 'done') && /^(completed)?$/i.test(val(tr, 'remarks'))).forEach(tr => tr.remove());
      rows.forEach(r => addRow(r));
    }
    onChange();
    const skipped = commits.length > fresh.length ? ` (${commits.length - fresh.length} already in the table)` : '';
    $('status').textContent = !commits.length ? `No commits by ${user} found on ${fmtDay(day)}.`
      : !fresh.length ? `All ${commits.length} commits for ${fmtDay(day)} are already in the table.`
      : aiNote === 'ai' ? `Gemini turned ${fresh.length} commit${fresh.length === 1 ? '' : 's'} into ${rows.length} task${rows.length === 1 ? '' : 's'} for ${fmtDay(day)}${skipped}. Please review before submitting.`
      : `Added ${fresh.length} commit${fresh.length === 1 ? '' : 's'} by ${user} for ${fmtDay(day)}${skipped}.` + (aiNote ? ` Gemini could not rewrite them: ${aiNote}` : ' Add a Gemini key in ⚙ Settings to get plain-language tasks.');
  } catch (e) {
    $('status').textContent = e.message;
  } finally { setBusy(btn, false); }
};

$('csvBtn').onclick = () => $('csvFile').click();
$('csvFile').onchange = async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  const n = importCSV(await f.text());
  $('status').textContent = n ? `Imported ${n} task row${n > 1 ? 's' : ''} from ${f.name}` : `No task rows found in ${f.name}`;
};
$('csvTpl').onclick = () => {
  const q = v => /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  const csv = '﻿' + [CSV_COLS, ['Example task', 'Afsana Tanni', 'What was done', '100', '']].map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'Section_A_template.csv';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
function reportData() {
  const d = collect();
  d.tasks = d.tasks.filter(t => Object.entries(t).some(([k, v]) => k !== 'pct' && v));
  if (!d.tasks.length) d.tasks = [{ pct: '100' }];
  d.guides = [...document.querySelectorAll('#guides li')].map(li => li.textContent.trim());
  return d;
}
function reportName(d, ext) {
  const safe = s => (s || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_');
  return ['Daily_Task_Report', safe(d.empName), d.repDate].filter(Boolean).join('_') + '.' + ext;
}
$('docxBtn').onclick = () => {
  const d = reportData();
  const bytes = DOCX.build(d);
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const name = reportName(d, 'docx');
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('status').textContent = 'Downloaded ' + name;
};

/* ===== PDF export (jsPDF + AutoTable, loaded on first use) ===== */
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('load failed')); }; document.head.appendChild(s); });
}
let pdfLib;
function getPdfLib() {
  return pdfLib ||= loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
    .then(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'))
    .then(() => window.jspdf.jsPDF)
    .catch(e => { pdfLib = null; throw e; });
}
function buildPDF(JsPDF, d) {
  const doc = new JsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const M = 36, PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight(), W = PW - 2 * M, CX = PW / 2;
  const BRAND = [23, 54, 78], INK = [40, 49, 57];
  let y = M;
  const room = h => { if (y + h > PH - M) { doc.addPage(); y = M; } };
  const font = (size, color = INK, style = 'bold') => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const heading = (t, size = 12, need = 60) => { room(size + need); y += 6; font(size, BRAND); doc.text(t, M, y + size); y += size + 8; };
  const base = {
    theme: 'grid', margin: { left: M, right: M, top: M, bottom: M }, rowPageBreak: 'avoid',
    styles: { font: 'helvetica', fontSize: 10, textColor: INK, lineColor: [0, 0, 0], lineWidth: 0.4, cellPadding: 5, valign: 'top', overflow: 'linebreak' },
    headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', valign: 'middle' },
  };
  const tbl = o => { doc.autoTable({ ...base, startY: y, ...o }); y = doc.lastAutoTable.finalY + 12; };
  const q = W / 4;

  font(17, BRAND); doc.text('VERSATILO GROUP', CX, y + 14, { align: 'center' }); y += 22;
  font(12, BRAND); doc.text('DAILY TASK ASSIGNMENT & PERFORMANCE REPORT', CX, y + 10, { align: 'center' }); y += 18;
  font(10); doc.text('Reporting Period: 03–27 November 2026 | To be completed before leaving the workplace each working day', CX, y + 8, { align: 'center' }); y += 22;

  // Employee details: header rows (0, 2) styled like table heads
  tbl({
    body: [
      ['Employee Name', 'Employee ID', 'Designation', 'Department / Concern / Project'],
      [d.empName, d.empId, d.designation, d.dept],
      ['Reporting Manager / Supervisor', 'Reporting Date', 'Office In Time', 'Office Out Time'],
      [d.manager, DOCX.fmtDate(d.repDate), DOCX.fmtTime(d.inTime), DOCX.fmtTime(d.outTime)],
    ],
    columnStyles: { 0: { cellWidth: q }, 1: { cellWidth: q }, 2: { cellWidth: q }, 3: { cellWidth: q } },
    didParseCell: c => {
      if (c.row.index % 2 === 0) Object.assign(c.cell.styles, { fillColor: BRAND, textColor: 255, fontStyle: 'bold' });
      else c.cell.styles.minCellHeight = 28;
    },
  });

  heading('SECTION A  |  DAILY TASK-WISE WORK RECORD');
  tbl({
    head: [['SL', 'Task Assigned / Undertaken', 'Work Source / Instructed By', 'Work Done / Measurable Output', 'Completion (%)', 'Pending Tasks / Delay Reason / Remarks']],
    body: d.tasks.map((t, i) => [String(i + 1), t.task || '', t.source || '', t.done || '', t.pct === '' || t.pct == null ? '' : t.pct + '%', t.remarks || '']),
    columnStyles: { 0: { cellWidth: 30, halign: 'center' }, 1: { cellWidth: 135 }, 2: { cellWidth: 130 }, 3: { cellWidth: 185 }, 4: { cellWidth: 70, halign: 'center' }, 5: { cellWidth: W - 550 } },
    bodyStyles: { minCellHeight: 23.5 },
  });
  y -= 2;
  const hint = 'Add rows as required. Report each task separately. Record actual progress at the time of departure.';
  room(20); font(10, INK, 'normal');
  doc.setFillColor(255, 255, 0); doc.rect(M, y, doc.getTextWidth(hint) + 2, 13, 'F');
  doc.text(hint, M + 1, y + 10); y += 22;

  heading('SECTION B  |  DAILY SUMMARY & VERIFICATION', 12, 110);
  tbl({
    head: [['Tasks Assigned / Undertaken', 'Tasks Completed', 'Tasks Pending / In Progress', 'Overall Progress (if assessed by Supervisor)']],
    body: [[d.sAssigned, d.sDone, d.sPending, d.sOverall === '' ? '' : d.sOverall + ' %']],
    columnStyles: { 0: { cellWidth: q }, 1: { cellWidth: q }, 2: { cellWidth: q }, 3: { cellWidth: q } },
    bodyStyles: { minCellHeight: 43.5 },
  });

  // Declaration with a drawn checkbox
  font(11);
  const decl = doc.splitTextToSize('**Employee Declaration: I confirm that the above information accurately reflects the work undertaken and progress achieved today.', W - 16);
  room(decl.length * 14 + 120);
  doc.setDrawColor(...INK); doc.setLineWidth(0.8); doc.rect(M, y + 1, 9, 9);
  if (d.declare) { doc.line(M + 1.8, y + 5.8, M + 3.8, y + 8.2); doc.line(M + 3.8, y + 8.2, M + 7.6, y + 2.6); }
  doc.text(decl, M + 16, y + 9.5); y += decl.length * 14 + 8;

  const t3 = W / 3, SIG_W = 129.6, SIG_H = SIG_W * 179 / 591;
  tbl({
    head: [['Employee Signature & Time', 'Supervisor Verification / Comments', 'Supervisor Signature & Time']],
    body: [[d.empSign, d.supComments, d.supSign]],
    columnStyles: { 0: { cellWidth: t3 }, 1: { cellWidth: t3 }, 2: { cellWidth: t3 } },
    bodyStyles: { minCellHeight: 89 },
    didParseCell: c => { if (c.section === 'body' && c.column.index === 2) c.cell.styles.cellPadding = { top: SIG_H + 10, left: 5, right: 5, bottom: 5 }; },
    didDrawCell: c => { if (c.section === 'body' && c.column.index === 2) doc.addImage('data:image/jpeg;base64,' + SIGN_B64, 'JPEG', c.cell.x + 5, c.cell.y + 5, SIG_W, SIG_H); },
  });

  heading('SECTION C  |  COMPLETION GUIDELINES', 14);
  d.guides.forEach((g, i) => {
    font(11, INK, 'normal');
    const lines = doc.splitTextToSize(g, W - 18);
    room(lines.length * 14);
    doc.text(`${i + 1}.`, M, y + 10); doc.text(lines, M + 18, y + 10);
    y += lines.length * 14 + 3;
  });
  return doc;
}
$('pdfBtn').onclick = async () => {
  const btn = $('pdfBtn'); setBusy(btn, true);
  $('status').textContent = 'Preparing PDF…';
  try {
    const JsPDF = await getPdfLib();
    const d = reportData(), name = reportName(d, 'pdf');
    buildPDF(JsPDF, d).save(name);
    $('status').textContent = 'Downloaded ' + name;
  } catch (e) {
    console.error(e);
    $('status').textContent = 'PDF download failed — check your internet connection (the PDF library loads online). You can still use Print → Save as PDF.';
  } finally { setBusy(btn, false); }
};
load();
store.set(storable()); // drop any Section A/B data stored by the older version
if (!store.ok) $('status').textContent = NO_STORE;

