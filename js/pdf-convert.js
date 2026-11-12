/* =====================================================================
   PDF Converter page: PDF → Word (.docx) · Text · Markdown · HTML · PNG / JPG.
   pdf.js (cdnjs, on first use) reads the text of each page; lines are
   grouped into headings / paragraphs / bullet points by font size and
   spacing. Pages without a text layer (scans) can be read with
   Tesseract.js OCR (jsdelivr, on first use). Nothing is uploaded.
   ===================================================================== */
(() => {
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const SET_KEY = 'versatilo-pdfconv-v1';
  const MIME = {
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain;charset=utf-8', md: 'text/markdown;charset=utf-8', html: 'text/html;charset=utf-8',
    png: 'image/png', jpg: 'image/jpeg', zip: 'application/zip',
  };
  const IMAGE = f => f === 'png' || f === 'jpg';

  const say = t => { $('status').textContent = t; };
  const st = { fmt: 'docx', lines: 'join', ocr: 'auto', lang: 'eng+ben', dpi: '150', marks: true };
  try { Object.assign(st, JSON.parse(localStorage.getItem(SET_KEY) || '{}')); } catch {}
  const save = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(st)); } catch {} };

  const kb = n => n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enc = new TextEncoder();
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

  /* ---------- Libraries (loaded on first use) ---------- */
  const loadScript = src => new Promise((ok, fail) => {
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = ok; s.onerror = () => { s.remove(); fail(new Error('Could not load ' + src.split('/').pop() + ' – check your internet connection.')); };
    document.head.appendChild(s);
  });
  let pdfjsP, tessP, worker = null, workerLang = '', onLog = null;
  const getPdfjs = () => pdfjsP ||= loadScript(PDFJS + 'pdf.min.js')
    .then(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return pdfjsLib; })
    .catch(e => { pdfjsP = null; throw e; });
  const getTess = () => tessP ||= loadScript(TESS_URL).then(() => window.Tesseract).catch(e => { tessP = null; throw e; });
  async function getWorker(lang) {
    if (worker && workerLang === lang) return worker;
    if (worker) { await worker.terminate().catch(() => {}); worker = null; }
    const T = await getTess();
    worker = await T.createWorker(lang, 1, { logger: m => onLog?.(m) });
    workerLang = lang;
    return worker;
  }

  /* ---------- Page range: "1-3, 5, 8-" → [1,2,3,5,8,9,…] ---------- */
  function parseRange(str, max) {
    str = str.trim();
    if (!str || /^all$/i.test(str)) return Array.from({ length: max }, (_, i) => i + 1);
    const set = new Set();
    for (const part of str.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d*)\s*[-–]\s*(\d*)$/) || part.match(/^(\d+)$/);
      if (!m) throw new Error(`“${part}” is not a page number or range.`);
      const a = m[1] ? +m[1] : 1, b = m.length > 2 ? (m[2] ? +m[2] : max) : a;
      for (let n = Math.max(1, Math.min(a, b)); n <= Math.min(max, Math.max(a, b)); n++) set.add(n);
    }
    if (!set.size) throw new Error(`This PDF has only ${max} page${max === 1 ? '' : 's'}.`);
    return [...set].sort((x, y) => x - y);
  }

  /* ---------- Rendering ---------- */
  async function renderPage(page, scale) {
    const vp = page.getViewport({ scale });
    const c = Object.assign(document.createElement('canvas'), { width: Math.ceil(vp.width), height: Math.ceil(vp.height) });
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return c;
  }
  const canvasBytes = (c, type, q) => new Promise((ok, fail) => c.toBlob(b => b ? b.arrayBuffer().then(a => ok(new Uint8Array(a))) : fail(new Error('Could not make the image (page too large?).')), type, q));

  /* ---------- Text layer → blocks {type: h1|h2|p|li, lines: [..]} ---------- */
  const BULLET = /^[•●▪◦‣■□○◆➢➤►✓✔\uf0b7\uf0a7\uf076\uf0d8*–-]\s+/;
  const NUMBERED = /^(\d{1,3}|[a-zA-Z]|[ivxlIVXL]{1,5})[.)]\s+/;

  function textBlocks(tc, vh) {
    // 1 · items → lines (content order; a new line starts when the baseline moves)
    const lines = []; let cur = null, space = false;
    for (const it of tc.items) {
      if (!('str' in it)) continue;   // marked-content tags
      if (!it.str.trim()) { space = true; continue; }
      const t = it.transform, size = Math.hypot(t[2], t[3]) || it.height || 10, x = t[4], y = vh - t[5];
      if (!cur || Math.abs(y - cur.y) > Math.max(size, cur.size) * 0.5) {
        cur = { y, x0: x, end: x + it.width, size, text: it.str };
        lines.push(cur);
      } else {
        const gap = x - cur.end;
        if (gap > size * 3) cur.text += '\t';   // wide gap = table / column gap
        else if ((space || gap > size * 0.2) && !/\s$/.test(cur.text) && !/^\s/.test(it.str)) cur.text += ' ';
        cur.text += it.str; cur.end = Math.max(cur.end, x + it.width); cur.size = Math.max(cur.size, size); cur.x0 = Math.min(cur.x0, x);
      }
      space = false;
    }
    return linesToBlocks(lines);
  }

  // lines {y: baseline from top, x0, end, size, text} → headings / paragraphs / bullets (shared by the text layer and OCR)
  function linesToBlocks(lines) {
    const L = lines.map(l => ({ ...l, text: l.text.replace(/[ \u00a0]+/g, ' ').replace(/ ?\t ?/g, '\t').trim() })).filter(l => l.text);
    if (!L.length) return [];

    // 2 · body size (most text) + normal line spacing
    const bySize = {}; L.forEach(l => { const k = Math.round(l.size * 2) / 2; bySize[k] = (bySize[k] || 0) + l.text.length; });
    const body = +Object.entries(bySize).sort((a, b) => b[1] - a[1])[0][0];
    const gaps = []; for (let i = 1; i < L.length; i++) { const d = L[i].y - L[i - 1].y; if (d > 0 && Math.abs(L[i].size - body) < 1 && Math.abs(L[i - 1].size - body) < 1) gaps.push(d); }
    const lh = median(gaps) || body * 1.25;
    const right = Math.max(...L.map(l => l.end)), left = Math.min(...L.map(l => l.x0));

    // 3 · lines → blocks
    const blocks = []; let blk = null, prev = null;
    for (const l of L) {
      const short = l.text.length < 150;
      const level = short && l.size >= body * 1.6 ? 'h1' : short && l.size >= body * 1.2 ? 'h2' : null;
      const bullet = BULLET.test(l.text), numbered = NUMBERED.test(l.text);
      const d = prev ? l.y - prev.y : 0;
      const prevEnded = prev && prev.end < left + (right - left) * 0.75 && /[.:!?।)"”]$/.test(prev.text);
      const brk = !blk || (level || null) !== (blk.level || null) || bullet || numbered || d < 0 || d > lh * 1.45 + 0.5
        || Math.abs(l.size - prev.size) > body * 0.15 || (prevEnded && !level)
        || (blk.type === 'li' && l.x0 < blk.x0 + body * 0.5);   // a bullet's wrapped lines are indented; a line back at the margin ends the list item
      const text = bullet ? l.text.replace(BULLET, '') : l.text;
      if (brk) { blk = { type: level || (bullet ? 'li' : 'p'), level, x0: l.x0, lines: [text] }; blocks.push(blk); }
      else blk.lines.push(text);
      prev = l;
    }
    return blocks.map(({ type, lines }) => ({ type, lines }));
  }

  // Tesseract lines (pixel boxes) → the same block logic; Bangla "|" misread for the dari "।" is fixed
  function ocrBlocks(data) {
    const fix = t => t.replace(/([\u0980-\u09FF])\s*\|/g, '$1।').replace(/^[+»]\s+(?=\S)/, '• ');
    const lines = (data.lines || []).map(l => ({ y: l.bbox.y1, x0: l.bbox.x0, end: l.bbox.x1, size: (l.rowAttributes?.row_height || (l.bbox.y1 - l.bbox.y0)) * 0.75, text: fix(l.text || '') }));
    if (lines.length) return linesToBlocks(lines);
    return (data.text || '').replace(/\r/g, '').split(/\n\s*\n/).map(p => p.split('\n').map(s => fix(s.trim())).filter(Boolean)).filter(a => a.length)
      .map(lines => ({ type: 'p', lines }));
  }

  // "Join paragraphs": one line per paragraph, "exam-\nple" → "example"
  const joined = lines => st.lines === 'keep' ? lines.join('\n')
    : lines.reduce((a, s) => !a ? s : /\p{Ll}-$/u.test(a) && /^\p{Ll}/u.test(s) ? a.slice(0, -1) + s : a + ' ' + s, '');

  /* ---------- Output builders (pages: [{n, blocks}]) ---------- */
  function toTxt(pages) {
    return pages.map(pg => {
      const body = pg.blocks.map((b, i) => (i ? (b.type === 'li' && pg.blocks[i - 1].type === 'li' ? '\n' : '\n\n') : '') + (b.type === 'li' ? '• ' : '') + joined(b.lines)).join('');
      return (st.marks && pages.length > 1 ? `— Page ${pg.n} —\n\n` : '') + body;
    }).join('\n\n\n').trim() + '\n';
  }

  function toMd(pages) {
    const mdEsc = s => s.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(#|\d+\.|[+-] )/gm, '\\$1').replace(/\t/g, '    ');
    return pages.map((pg, pi) => {
      const body = pg.blocks.map((b, i) => {
        const t = mdEsc(joined(b.lines)).replace(/\n/g, '  \n');
        const sep = i ? (b.type === 'li' && pg.blocks[i - 1].type === 'li' ? '\n' : '\n\n') : '';
        return sep + (b.type === 'h1' ? '# ' : b.type === 'h2' ? '## ' : b.type === 'li' ? '- ' : '') + (b.type[0] === 'h' ? t.replace(/ {2}\n/g, ' ') : t);
      }).join('');
      return (st.marks && pi ? '---\n\n' : '') + body;
    }).join('\n\n').trim() + '\n';
  }

  function toHtml(pages, title) {
    const inner = b => esc(joined(b.lines)).replace(/\n/g, '<br>').replace(/\t/g, ' &emsp; ');
    const body = pages.map((pg, pi) => {
      let out = st.marks && pi ? `<hr data-page="${pg.n}">\n` : '', inList = false;
      for (const b of pg.blocks) {
        if (b.type === 'li' && !inList) { out += '<ul>\n'; inList = true; }
        if (b.type !== 'li' && inList) { out += '</ul>\n'; inList = false; }
        out += b.type === 'li' ? `  <li>${inner(b)}</li>\n` : `<${b.type}>${inner(b)}</${b.type}>\n`;
      }
      return out + (inList ? '</ul>\n' : '');
    }).join('');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
body{max-width:820px;margin:40px auto;padding:0 20px;font:16px/1.65 system-ui,-apple-system,"Segoe UI","Noto Sans Bengali","Nirmala UI",sans-serif;color:#1f2933;background:#fff}
h1{font-size:1.8em;line-height:1.25;margin:1.2em 0 .5em}h2{font-size:1.35em;line-height:1.3;margin:1.1em 0 .4em}
p{margin:0 0 .9em}ul{margin:0 0 .9em;padding-left:1.4em}hr{border:0;border-top:1px dashed #c5ccd3;margin:2.2em 0}
@media (prefers-color-scheme:dark){body{background:#14181c;color:#e3e8ec}hr{border-color:#3a434c}}
</style>
</head>
<body>
${body}</body>
</html>
`;
  }

  function toDocx(pages, pt) {
    const x = s => DOCX.esc(s);
    const runs = text => text.split('\n').map((ln, i) => (i ? '<w:r><w:br/></w:r>' : '')
      + ln.split('\t').map((seg, j) => (j ? '<w:r><w:tab/></w:r>' : '') + (seg ? `<w:r><w:t xml:space="preserve">${x(seg)}</w:t></w:r>` : '')).join('')).join('');
    const STYLE = { h1: 'Heading1', h2: 'Heading2', li: 'ListBullet' };
    const para = b => `<w:p>${STYLE[b.type] ? `<w:pPr><w:pStyle w:val="${STYLE[b.type]}"/></w:pPr>` : ''}${b.type === 'li' ? '<w:r><w:t>•</w:t></w:r><w:r><w:tab/></w:r>' : ''}${runs(joined(b.lines))}</w:p>`;
    const body = pages.map((pg, i) => (st.marks && i ? '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' : '') + (pg.blocks.length ? pg.blocks.map(para).join('') : '<w:p/>')).join('');
    const W = Math.round(pt.w * 20), H = Math.round(pt.h * 20), M = 1134;   // page size from the PDF, 2 cm margins
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="${W}" w:h="${H}"${W > H ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${M}" w:right="${M}" w:bottom="${M}" w:left="${M}" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const heading = (id, name, sz, lvl) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${lvl}"/></w:pPr><w:rPr><w:b/><w:bCs/><w:color w:val="17364E"/><w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr></w:style>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Nirmala UI"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:bidi="bn-BD"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading('Heading1', 'heading 1', 32, 0)}${heading('Heading2', 'heading 2', 26, 1)}<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style></w:styles>`;
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    return DOCX.zip([
      { name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels },
      { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/_rels/document.xml.rels', data: docRels },
    ]);
  }

  /* ---------- Controls ---------- */
  const SEGS = [['pcFmt', 'fmt'], ['pcLines', 'lines'], ['pcOcr', 'ocr'], ['pcLang', 'lang'], ['pcDpi', 'dpi']];
  for (const [id, key] of SEGS)
    $(id).querySelectorAll('button').forEach(b => { b.onclick = () => { if (running) return; st[key] = b.dataset.v; changed(); }; });
  $('pcMarks').onchange = e => { st.marks = e.target.checked; changed(); };
  $('pcPages').oninput = () => { if (!running) { items.forEach(i => { i.out = null; i.err = ''; }); renderList(); } };

  function syncUi() {
    for (const [id, key] of SEGS) $(id).querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === st[key]));
    $('pcMarks').checked = st.marks;
    const img = IMAGE(st.fmt);
    document.querySelectorAll('[data-kind]').forEach(r => { r.hidden = r.dataset.kind !== (img ? 'image' : 'text'); });
    document.querySelectorAll('[data-ocr]').forEach(r => { r.hidden = img || st.ocr === 'off'; });
    $('cvNote').textContent = img
      ? `Each page becomes one ${st.fmt.toUpperCase()} image (${st.dpi} dpi${st.dpi === '300' ? ' – print quality, bigger files' : st.dpi === '72' ? ' – screen size, small files' : ''}). Several pages are packed in a ZIP.`
      : 'Text, headings and bullet points are kept; exact layout, fonts and pictures are not (use PNG / JPG for an exact copy of a page). '
        + (st.ocr === 'off' ? 'OCR is off – scanned pages come out empty.'
          : st.ocr === 'all' ? 'Every page is read with OCR – slower, but fixes PDFs whose text copies out as garbled Bangla. The first run downloads the language data.'
          : 'Pages with no text layer (scans) are read with OCR automatically. If Bangla comes out garbled, choose “Every page”.');
    const done = items.filter(i => i.out).length;
    $('pcGo').disabled = !items.length || running;
    $('pcGo').textContent = running ? 'Converting…' : items.length > 1 && done < items.length ? 'Convert all & download' : done && done === items.length ? 'Download again' : 'Convert & download';
    $('cvClear').hidden = !items.length || running;
  }
  function changed() {
    save();
    if (!running) { items.forEach(it => { it.out = null; it.err = ''; }); renderList(); }
    else syncUi();
  }

  /* ---------- Files ---------- */
  let items = [], seq = 0, running = false;   // {id, file, name, pdf, pages, thumb, model:{key, map}, out:{files, plain}, err, phase}

  async function addFiles(list) {
    const files = [...list].filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    if (!files.length) { say('Please choose PDF files.'); return; }
    const added = files.map(file => ({ id: ++seq, file, name: (file.name || 'document').replace(/\.pdf$/i, '') || 'document', pdf: null, pages: 0, thumb: '', model: null, out: null, err: '', phase: 'opening…' }));
    items.push(...added); renderList();
    let lib;
    try { lib = await getPdfjs(); } catch (e) { added.forEach(it => { it.err = e.message; it.phase = ''; }); renderList(); return; }
    for (const it of added) {
      try {
        it.pdf = await lib.getDocument({ data: new Uint8Array(await it.file.arrayBuffer()) }).promise;
        it.pages = it.pdf.numPages;
        const c = await renderPage(await it.pdf.getPage(1), 1);
        const k = 360 / c.width, t = Object.assign(document.createElement('canvas'), { width: 360, height: Math.round(c.height * k) });
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        it.thumb = t.toDataURL('image/jpeg', 0.8);
      } catch (e) {
        it.err = e?.name === 'PasswordException' ? 'Password protected – remove the password first.' : 'Could not open this PDF: ' + (e?.message || e);
      }
      it.phase = '';
      if (!items.includes(it)) it.pdf?.destroy();
      renderItem(it);
    }
    const ok = items.filter(i => i.pdf).length;
    if (!running) say(ok ? `${ok} PDF${ok > 1 ? 's' : ''} ready – choose a format and press Convert.` : 'No PDF could be opened.');
  }

  // text of one page (cached per OCR setting, so switching Word ↔ Text does not read again)
  async function pageModel(it, n, tick) {
    const key = st.ocr + '|' + st.lang;
    if (it.model?.key !== key) it.model = { key, map: new Map() };
    if (it.model.map.has(n)) return it.model.map.get(n);
    const page = await it.pdf.getPage(n), vp = page.getViewport({ scale: 1 });
    let blocks = [], ocr = false;
    if (st.ocr !== 'all') blocks = textBlocks(await page.getTextContent(), vp.height);
    const chars = blocks.reduce((s, b) => s + b.lines.join('').replace(/\s/g, '').length, 0);
    if (st.ocr === 'all' || (st.ocr === 'auto' && chars < 3)) {
      const c = await renderPage(page, Math.min(3, Math.max(1.5, 2200 / vp.width)));
      onLog = m => {
        if (m.status === 'recognizing text') tick(`OCR page ${n} · ${Math.round(m.progress * 100)}%`);
        else if (/loading|initializ/.test(m.status)) tick(/language/.test(m.status) ? 'downloading OCR language data (first time only)…' : 'starting OCR…');
      };
      try {
        const w = await getWorker(st.lang);
        const { data } = await w.recognize(c);
        const ob = ocrBlocks(data);
        const och = ob.reduce((t, b) => t + b.lines.join('').replace(/\s/g, '').length, 0);
        if (st.ocr === 'all' || och > chars) { blocks = ob; ocr = true; }
      } finally { onLog = null; c.width = c.height = 0; }
    }
    page.cleanup();
    const r = { n, blocks, ocr, pt: { w: vp.width, h: vp.height } };
    it.model.map.set(n, r);
    return r;
  }

  async function convert(it, nums) {
    const tick = t => { it.phase = t; renderItem(it); };
    if (IMAGE(st.fmt)) {
      const files = [], pad = String(it.pages).length;
      for (const n of nums) {
        tick(`page ${n} of ${it.pages}…`);
        const page = await it.pdf.getPage(n);
        const c = await renderPage(page, +st.dpi / 72);
        const data = await canvasBytes(c, MIME[st.fmt], 0.92);
        c.width = c.height = 0; page.cleanup();
        files.push({ name: `${it.name}-p${String(n).padStart(pad, '0')}.${st.fmt}`, data });
      }
      return { files, plain: '', note: `${files.length} image${files.length > 1 ? 's' : ''}` };
    }
    const pages = [];
    for (const n of nums) { tick(`reading page ${n} of ${it.pages}…`); pages.push(await pageModel(it, n, tick)); }
    const plain = toTxt(pages), words = (plain.match(/\S+/g) || []).length;
    const data = st.fmt === 'docx' ? toDocx(pages, pages[0].pt) : enc.encode(st.fmt === 'txt' ? '\ufeff' + plain : st.fmt === 'md' ? toMd(pages) : toHtml(pages, it.name));
    const empty = pages.filter(p => !p.blocks.length).length, ocrd = pages.filter(p => p.ocr).length;
    return {
      files: [{ name: `${it.name}.${st.fmt}`, data }], plain,
      note: `${words} words` + (ocrd ? ` · OCR on ${ocrd} page${ocrd > 1 ? 's' : ''}` : ''),
      warn: !words ? 'No text found' + (st.ocr === 'off' ? ' – it is probably scanned; turn OCR on.' : '.') : empty ? `${empty} page${empty > 1 ? 's' : ''} without text${st.ocr === 'off' ? ' – turn OCR on for scans' : ''}.` : '',
    };
  }

  async function runAll() {
    if (running) return;
    const ready = items.filter(i => i.pdf);
    if (!ready.length) return;
    running = true; renderList();
    let n = 0;
    for (const it of ready.filter(i => !i.out)) {
      if (!items.includes(it)) continue;
      n++; say(`Converting ${it.file.name}…`);
      it.err = '';
      try { it.out = await convert(it, parseRange($('pcPages').value, it.pages)); }
      catch (e) {
        it.err = e.message || String(e);
        if (worker && /ocr|tesseract|worker/i.test(it.err)) { await worker.terminate().catch(() => {}); worker = null; }
      }
      it.phase = ''; renderItem(it);
    }
    running = false;
    const ok = items.filter(i => i.out);
    syncUi();
    if (!ok.length) { say(items.find(i => i.err)?.err || 'Nothing was converted.'); return; }
    downloadItems(ok);
    const failed = items.filter(i => i.err).length;
    say(`Done · ${ok.length} file${ok.length > 1 ? 's' : ''} converted to ${fmtName()}` + (failed ? ` · ${failed} failed` : '') + (IMAGE(st.fmt) ? '.' : ' – check the result before using it.'));
  }
  const fmtName = () => ({ docx: 'Word', txt: 'text', md: 'Markdown', html: 'HTML', png: 'PNG', jpg: 'JPG' })[st.fmt];
  $('pcGo').onclick = runAll;

  /* ---------- Download ---------- */
  function saveBlob(data, name, type) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type })), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  function downloadItems(list) {
    const files = list.flatMap(i => i.out.files);
    if (files.length === 1) return saveBlob(files[0].data, files[0].name, MIME[st.fmt]);
    // unique names inside the ZIP (two PDFs can share a name)
    const seen = new Set();
    const named = files.map(f => { let nm = f.name, k = 1; while (seen.has(nm)) nm = f.name.replace(/(\.\w+)$/, `-${++k}$1`); seen.add(nm); return { name: nm, data: f.data }; });
    saveBlob(DOCX.zip(named), list.length === 1 ? `${list[0].name}-pages.zip` : `pdf-to-${st.fmt}-${today()}.zip`, MIME.zip);
  }

  /* ---------- List ---------- */
  function line(it) {
    const src = kb(it.file.size) + (it.pages ? ` · ${it.pages} page${it.pages > 1 ? 's' : ''}` : '');
    if (it.err) return `<small>${src}</small><small class="err">${esc(it.err)}</small>`;
    if (it.phase) return `<small>${src}</small><small class="vc-pct">${esc(it.phase)}</small>`;
    if (it.out) return `<small>${src} · <b>${esc(it.out.note)}</b></small>` + (it.out.warn ? `<small class="err">${esc(it.out.warn)}</small>` : '');
    return `<small>${src}${running ? '' : ' · ready'}</small>`;
  }
  function li(it) {
    const done = !!it.out;
    return `${it.thumb ? `<img src="${it.thumb}" alt="" aria-hidden="true">` : '<div class="pc-ph" aria-hidden="true">PDF</div>'}
      <div class="cv-info"><b title="${esc(it.file.name)}">${esc(it.file.name)}</b><div data-line>${line(it)}</div></div>
      <div class="cv-act"><button type="button" data-dl="${it.id}"${done ? '' : ' disabled'}>Download</button>${IMAGE(st.fmt) ? '' : `<button type="button" data-copy="${it.id}"${done && it.out.plain.trim() ? '' : ' disabled'}>Copy text</button>`}<button type="button" class="x" data-rm="${it.id}" aria-label="Remove ${esc(it.name)}"${running ? ' disabled' : ''}>×</button></div>`;
  }
  function renderList() {
    $('cvList').innerHTML = items.map(it => `<li data-id="${it.id}">${li(it)}</li>`).join('');
    $('cvEmpty').hidden = !!items.length;
    syncUi();
    if (!items.length) say($('status').dataset.idle);
  }
  function renderItem(it) {
    const el = $('cvList').querySelector(`li[data-id="${it.id}"]`);
    if (el) el.innerHTML = li(it);
    syncUi();
  }

  $('cvList').onclick = async e => {
    const b = e.target.closest('button'); if (!b) return;
    const it = items.find(i => i.id === +(b.dataset.dl || b.dataset.copy || b.dataset.rm));
    if (!it) return;
    if (b.dataset.dl && it.out) downloadItems([it]);
    if (b.dataset.copy && it.out) {
      try { await navigator.clipboard.writeText(it.out.plain); say('Text copied.'); } catch { say('Could not copy the text.'); }
    }
    if (b.dataset.rm && !running) { it.pdf?.destroy(); items.splice(items.indexOf(it), 1); renderList(); }
  };
  $('cvClear').onclick = () => { if (running) return; items.forEach(i => i.pdf?.destroy()); items = []; renderList(); };
  window.addEventListener('beforeunload', e => { if (running) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- Input: picker, drag & drop ---------- */
  $('cvFile').onchange = e => { const f = [...e.target.files]; e.target.value = ''; addFiles(f); };
  const drop = $('cvDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); });

  renderList();
})();
