/* ===== DOCX builder (pure, offline) ===== */
const DOCX = (() => {
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };

  function zip(files) { // files: [{name, data:string|Uint8Array}]
    const parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
      h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)];
    const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0)); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
                                    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const BRAND = '17364E', INK = '283139';

  function run(text, o = {}) {
    const rpr = `<w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Aptos"/>${o.b ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.hl ? `<w:highlight w:val="${o.hl}"/>` : ''}<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/></w:rPr>`;
    return String(text ?? '').split('\n').map((ln, i) =>
      `<w:r>${rpr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(ln)}</w:t></w:r>`).join('');
  }
  function p(text, o = {}) {
    return `<w:p><w:pPr><w:spacing w:before="${o.before || 0}" w:after="${o.after ?? 60}"/>${o.center ? '<w:jc w:val="center"/>' : ''}${o.ind ? `<w:ind w:left="360" w:hanging="360"/>` : ''}</w:pPr>${run(text, o)}</w:p>`;
  }
  function cell(text, w, o = {}) {
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.head ? `<w:shd w:val="clear" w:color="auto" w:fill="${BRAND}"/>` : ''}</w:tcPr>${text && text.xml ? text.xml : p(text, o.head ? { b: true, color: 'FFFFFF', sz: 20, after: 0 } : { sz: 20, after: 0, center: o.center })}</w:tc>`;
  }
  function table(widths, rows) { // rows: [{cells:[text], head:bool, h:twips}]
    const grid = widths.map(w => `<w:gridCol w:w="${w}"/>`).join('');
    const b = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="8" w:space="0" w:color="000000"/>`).join('') + '</w:tblBorders>';
    const trs = rows.map(r => `<w:tr>${r.h ? `<w:trPr><w:trHeight w:val="${r.h}"/></w:trPr>` : ''}${r.cells.map((c, i) => cell(c, widths[i], { head: r.head, center: r.center && r.center[i] })).join('')}</w:tr>`).join('');
    return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:jc w:val="center"/>${b}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>${p('', { after: 120 })}`;
  }
  const heading = (t, sz = 24) => p(t, { b: true, color: BRAND, sz, before: 120, after: 80 });

  function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d} / ${m} / ${y}`; }
  function fmtTime(t) { if (!t) return ''; let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${String(m).padStart(2, '0')} ${ap}`; }

  // Supervisor signature image (591×179 px) shown 1.8" wide
  const SIGN_BYTES = Uint8Array.from(atob(SIGN_B64), c => c.charCodeAt(0));
  function sigImage() {
    const cx = 1645920, cy = Math.round(cx * 179 / 591);
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="1" name="Supervisor signature"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="sign.jpeg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdSign"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  function build(d) {
    const W = 15398, q = W / 4 | 0;
    let body = '';
    body += p('VERSATILO GROUP', { b: true, sz: 34, color: BRAND, center: true, after: 20 });
    body += p('DAILY TASK ASSIGNMENT & PERFORMANCE REPORT', { b: true, sz: 24, color: BRAND, center: true, after: 20 });
    body += p('Reporting Period: 03–27 November 2026 | To be completed before leaving the workplace each working day', { b: true, sz: 20, color: INK, center: true, after: 160 });
    body += table([q, q, q, q], [
      { head: true, cells: ['Employee Name', 'Employee ID', 'Designation', 'Department / Concern / Project'] },
      { h: 560, cells: [d.empName, d.empId, d.designation, d.dept] },
      { head: true, cells: ['Reporting Manager / Supervisor', 'Reporting Date', 'Office In Time', 'Office Out Time'] },
      { h: 560, cells: [d.manager, fmtDate(d.repDate), fmtTime(d.inTime), fmtTime(d.outTime)] },
    ]);
    body += heading('SECTION A  |  DAILY TASK-WISE WORK RECORD');
    const tw = [600, 2700, 2600, 3700, 1400, 4398];
    const rows = [{ head: true, cells: ['SL', 'Task Assigned / Undertaken', 'Work Source / Instructed By', 'Work Done / Measurable Output', 'Completion (%)', 'Pending Tasks / Delay Reason / Remarks'] }];
    d.tasks.forEach((t, i) => rows.push({ h: 470, center: [true, false, false, false, true, false],
      cells: [String(i + 1), t.task, t.source, t.done, t.pct === '' || t.pct == null ? '' : t.pct + '%', t.remarks] }));
    body += table(tw, rows);
    body += p('Add rows as required. Report each task separately. Record actual progress at the time of departure.', { sz: 20, color: INK, hl: 'yellow', after: 120 });
    body += heading('SECTION B  |  DAILY SUMMARY & VERIFICATION');
    body += table([q, q, q, q], [
      { head: true, cells: ['Tasks Assigned / Undertaken', 'Tasks Completed', 'Tasks Pending / In Progress', 'Overall Progress (if assessed by Supervisor)'] },
      { h: 870, cells: [d.sAssigned, d.sDone, d.sPending, d.sOverall === '' ? '' : d.sOverall + ' %'] },
    ]);
    body += p((d.declare ? '☑ ' : '☐ ') + '**Employee Declaration: I confirm that the above information accurately reflects the work undertaken and progress achieved today.', { b: true, sz: 22, color: INK, after: 120 });
    const t3 = W / 3 | 0;
    body += table([t3, t3, t3], [
      { head: true, cells: ['Employee Signature & Time', 'Supervisor Verification / Comments', 'Supervisor Signature & Time'] },
      { h: 1780, cells: [d.empSign, d.supComments, { xml: sigImage() + p(d.supSign, { sz: 20, after: 0 }) }] },
    ]);
    body += heading('SECTION C  |  COMPLETION GUIDELINES', 28);
    d.guides.forEach((g, i) => body += p(`${i + 1}.\t${g}`, { sz: 22, color: INK, ind: true, after: 40 }));

    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdSign" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/sign.jpeg"/></Relationships>`;
    return zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: doc },
                { name: 'word/_rels/document.xml.rels', data: docRels }, { name: 'word/media/sign.jpeg', data: SIGN_BYTES }]);
  }
  return { build, fmtDate, fmtTime, zip, esc };
})();
