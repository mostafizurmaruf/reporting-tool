/* =====================================================================
   Edit Document page: open a PDF or DOCX report, edit its text in place,
   download it again in the same format. Everything runs in the browser.

   DOCX – the original file is unzipped, every paragraph (also inside tables,
          headers and footers) becomes editable. On download only the changed
          text is written back into the original XML, so styles, tables,
          images and the signature stay exactly as they were.
   PDF  – pages are rendered with pdf.js; each line of text gets an invisible
          editable box on top. On download (pdf-lib) the old text is covered
          with its own background colour and the new text is drawn in its place.
   ===================================================================== */
(() => {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const PDFLIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  const host = $('edDoc'), status = $('status');
  const say = t => { status.textContent = t; };
  let doc = null;              // { kind: 'pdf' | 'docx', name, bytes, items: [...], ... }
  const changed = new Set();   // items whose text differs from the original
  let unsaved = false;         // edited since the last download

  /* ---------- Small helpers ---------- */
  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src.split('/').pop() + ' – check your internet connection.')); }; document.head.appendChild(s); });
  }
  let pdfjsP, pdflibP;
  const getPdfjs = () => pdfjsP ||= loadScript(PDFJS + 'pdf.min.js')
    .then(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; return pdfjsLib; })
    .catch(e => { pdfjsP = null; throw e; });
  const getPdfLib = () => pdflibP ||= loadScript(PDFLIB).then(() => window.PDFLib).catch(e => { pdflibP = null; throw e; });

  function download(bytes, name, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  const outName = ext => doc.name.replace(/\.(pdf|docx)$/i, '').replace(/_edited$/, '') + '_edited.' + ext;

  // Editable text box (plain text only, so pasted formatting never sneaks in)
  function makeEditable(el) {
    try { el.contentEditable = 'plaintext-only'; } catch {}
    if (el.contentEditable !== 'plaintext-only') {
      el.contentEditable = 'true';
      el.addEventListener('paste', e => { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); });
    }
  }
  const readText = el => { const t = el.innerText.replace(/\r/g, ''); return el.lastChild && el.lastChild.nodeName === 'BR' ? t.replace(/\n$/, '') : t; };
  function addItem(el, orig, extra) {
    el.textContent = orig;
    makeEditable(el);
    const it = { el, orig, base: orig, ...extra };
    el._it = it;
    doc.items.push(it);
    return it;
  }
  function mark(it) {
    const c = readText(it.el) !== it.base;
    it.el.classList.toggle('changed', c);
    c ? changed.add(it) : changed.delete(it);
    unsaved = true;
    const n = changed.size;
    $('edCount').textContent = n ? `${n} change${n === 1 ? '' : 's'}` : 'No changes';
    $('edCount').classList.toggle('on', n > 0);
  }
  host.addEventListener('input', e => { const it = e.target.closest('[contenteditable]')?._it; if (it) mark(it); });
  host.addEventListener('focusin', e => e.target.classList?.contains('ti') && e.target.classList.add('on'));
  host.addEventListener('focusout', e => e.target.classList?.contains('ti') && e.target.classList.remove('on'));

  /* =====================================================================
     DOCX
     ===================================================================== */
  const inflate = async b => new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  async function unzip(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
    let e = u8.length - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('This file is not a valid DOCX.');
    const count = dv.getUint16(e + 10, true), out = [];
    let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('This DOCX file is damaged.');
      const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
      const nLen = dv.getUint16(p + 28, true), xLen = dv.getUint16(p + 30, true), cLen = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nLen));
      p += 46 + nLen + xLen + cLen;
      if (name.endsWith('/')) continue;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      const raw = u8.subarray(start, start + size);
      if (method !== 0 && method !== 8) throw new Error('This DOCX uses an unsupported compression – open it in Word and save it again.');
      out.push({ name, data: method === 8 ? await inflate(raw) : raw.slice() });
    }
    return out;
  }

  const wKids = (n, name) => [...n.children].filter(c => c.namespaceURI === W_NS && c.localName === name);
  const wKid = (n, name) => n && wKids(n, name)[0];
  const wVal = (n, name) => wKid(n, name)?.getAttributeNS(W_NS, 'val') ?? null;
  const isOn = (pr, name) => { const e = wKid(pr, name); return !!e && !/^(0|false|off)$/.test(e.getAttributeNS(W_NS, 'val') || ''); };
  // Rows / cells, also when wrapped in content controls (<w:sdt>)
  const flat = (n, name) => [...n.children].flatMap(c => c.namespaceURI !== W_NS ? [] : c.localName === name ? [c] : c.localName === 'sdt' && wKid(c, 'sdtContent') ? flat(wKid(c, 'sdtContent'), name) : []);

  // Text pieces of a paragraph in reading order: <w:t>, <w:tab> (\t), <w:br>/<w:cr> (\n).
  // Images, deleted text, field codes and text boxes are left alone.
  const SKIP = new Set(['pPr', 'rPr', 'drawing', 'pict', 'object', 'del', 'moveFrom', 'instrText', 'delText', 'fldChar', 'footnoteReference', 'endnoteReference', 'p', 'tbl']);
  function segsOf(p) {
    const out = [];
    (function walk(n) {
      for (const c of n.children) {
        if (c.namespaceURI !== W_NS || SKIP.has(c.localName)) continue;
        if (c.localName === 't') out.push({ n: c, t: c.textContent });
        else if (c.localName === 'tab') out.push({ n: c, t: '\t' });
        else if (c.localName === 'br' || c.localName === 'cr') out.push({ n: c, t: '\n' });
        else walk(c);
      }
    })(p);
    return out;
  }
  const paraText = p => segsOf(p).map(s => s.t).join('');

  // Body walk shared by "render" (host given) and "write back" (host null): both see the paragraphs in the same order
  function walk(node, el, out, part) {
    for (const c of node.children) {
      if (c.namespaceURI !== W_NS) continue;
      const ln = c.localName;
      if (ln === 'p') { out.push(c); if (el) el.append(paraEl(c, part, out.length - 1)); }
      else if (ln === 'tbl') {
        const t = el && document.createElement('table'), tb = el && t.createTBody();
        if (el) {   // column widths from the table grid
          const cols = wKids(wKid(c, 'tblGrid') || c, 'gridCol').map(g => +g.getAttributeNS(W_NS, 'w') || 0), sum = cols.reduce((a, b) => a + b, 0);
          if (sum) { const cg = t.insertBefore(document.createElement('colgroup'), tb); cols.forEach(w => { const col = document.createElement('col'); col.style.width = w / sum * 100 + '%'; cg.append(col); }); }
        }
        for (const tr of flat(c, 'tr')) {
          const row = el && tb.insertRow();
          for (const tc of flat(tr, 'tc')) {
            let td = null;
            if (el) {
              td = row.insertCell();
              const pr = wKid(tc, 'tcPr'), span = +wVal(pr, 'gridSpan'), fill = wKid(pr, 'shd')?.getAttributeNS(W_NS, 'fill');
              if (span > 1) td.colSpan = span;
              if (fill && /^[0-9a-f]{6}$/i.test(fill)) td.style.background = '#' + fill;
            }
            walk(tc, td, out, part);
          }
        }
        if (el) el.append(t);
      }
      else if (ln === 'sdt') { const sc = wKid(c, 'sdtContent'); if (sc) walk(sc, el, out, part); }
      else if (ln === 'customXml' || ln === 'ins' || ln === 'smartTag') walk(c, el, out, part);
    }
  }

  function paraEl(p, part, idx) {
    const row = document.createElement('div'); row.className = 'dp';
    const pPr = wKid(p, 'pPr'), style = wVal(pPr, 'pStyle') || '', jc = wVal(pPr, 'jc');
    if (wKid(pPr, 'numPr') || /^List/i.test(style)) row.append(Object.assign(document.createElement('span'), { className: 'bul', textContent: '•' }));
    const imgs = p.getElementsByTagNameNS(W_NS, 'drawing').length + p.getElementsByTagNameNS(W_NS, 'pict').length;
    for (let i = 0; i < imgs; i++) row.append(Object.assign(document.createElement('span'), { className: 'img', textContent: '🖼 image' }));

    const ed = document.createElement('div'); ed.className = 'ed';
    const segs = segsOf(p), r = segs.find(s => s.n.localName === 't')?.n.parentNode, rPr = r && wKid(r, 'rPr');
    const h = /^(Heading|Title)(\d?)/i.exec(style);
    if (isOn(rPr, 'b') || h) ed.style.fontWeight = '700';
    if (isOn(rPr, 'i')) ed.style.fontStyle = 'italic';
    if (wKid(rPr, 'u') && wVal(rPr, 'u') !== 'none') ed.style.textDecoration = 'underline';
    const sz = +wVal(rPr, 'sz');
    if (sz) ed.style.fontSize = Math.min(40, Math.max(9, sz / 2 * 1.333)) + 'px';
    else if (h) ed.style.fontSize = (h[1].toLowerCase() === 'title' ? 28 : [0, 24, 20, 17, 16][+h[2] || 1] || 15) + 'px';
    const color = wVal(rPr, 'color');
    if (color && /^[0-9a-f]{6}$/i.test(color)) ed.style.color = '#' + color;
    if (jc) ed.style.textAlign = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }[jc] || '';
    addItem(ed, paraText(p), { part, idx });
    row.append(ed);
    return row;
  }

  // Write the new text into a paragraph, keeping every run (and its formatting) that was not touched.
  // Only the changed middle part is replaced: unchanged text before and after stays in its own runs.
  function setParaText(p, oldT, newT) {
    if (oldT === newT) return;
    const x = p.ownerDocument, mk = n => x.createElementNS(W_NS, 'w:' + n);
    const nodesFor = s => s.split(/(\t|\n)/).filter(Boolean).map(part => {
      if (part === '\t') return mk('tab');
      if (part === '\n') return mk('br');
      const t = mk('t'); t.setAttributeNS(XML_NS, 'xml:space', 'preserve'); t.textContent = part; return t;
    });
    const setT = (n, s) => {
      if (!/[\t\n]/.test(s)) { n.textContent = s; n.setAttributeNS(XML_NS, 'xml:space', 'preserve'); }
      else n.replaceWith(...nodesFor(s));
    };
    let P = 0; while (P < oldT.length && P < newT.length && oldT[P] === newT[P]) P++;
    let S = 0; while (S < oldT.length - P && S < newT.length - P && oldT[oldT.length - 1 - S] === newT[newT.length - 1 - S]) S++;
    const A = P, B = oldT.length - S, mid = newT.slice(P, newT.length - S);

    const segs = segsOf(p);
    if (!segs.length) {   // empty paragraph: add a run with the paragraph-mark formatting
      const r = mk('r'), mrk = wKid(wKid(p, 'pPr'), 'rPr');
      if (mrk) { const c = mrk.cloneNode(true); [...c.children].filter(e => /^(ins|del|moveFrom|moveTo|rPrChange)$/.test(e.localName)).forEach(e => e.remove()); if (c.children.length) r.append(c); }
      r.append(...nodesFor(mid));
      p.append(r);
      return;
    }
    let pos = 0;
    segs.forEach(s => { s.start = pos; pos += s.t.length; });
    const isT = s => s.n.localName === 't', end = s => s.start + s.t.length;
    const anchor = segs.find(s => isT(s) && s.start < A && A <= end(s)) || segs.find(s => isT(s) && s.start <= A && A <= end(s));
    for (const s of segs) {
      if (s === anchor) setT(s.n, s.t.slice(0, A - s.start) + mid + (B <= end(s) ? s.t.slice(B - s.start) : ''));
      else if (isT(s)) { if (end(s) > A && s.start < B) setT(s.n, s.t.slice(0, Math.max(0, A - s.start)) + s.t.slice(Math.min(s.t.length, B - s.start))); }
      else if (s.start >= A && s.start < B) s.n.remove();
    }
    if (!anchor && mid) {   // change starts next to a tab / line break: put the new text beside it, in the same run
      const prev = segs.filter(s => end(s) <= A).pop();
      if (prev) prev.n.after(...nodesFor(mid)); else segs[0].n.before(...nodesFor(mid));
    }
  }

  const parseXml = s => {
    const x = new DOMParser().parseFromString(s, 'application/xml');
    if (x.getElementsByTagName('parsererror').length) throw new Error('This DOCX file could not be read (broken XML).');
    return x;
  };
  const rootOf = x => x.getElementsByTagNameNS(W_NS, 'body')[0] || x.documentElement;

  async function openDocx() {
    const files = await unzip(doc.bytes), dec = new TextDecoder();
    const names = files.map(f => f.name);
    if (!names.includes('word/document.xml')) throw new Error('This file is not a Word document (word/document.xml is missing).');
    const partNames = ['word/document.xml', ...names.filter(n => /^word\/header\d*\.xml$/.test(n)).sort(), ...names.filter(n => /^word\/footer\d*\.xml$/.test(n)).sort()];
    doc.files = files;
    doc.parts = partNames.map((name, i) => ({ i, name, xml: dec.decode(files.find(f => f.name === name).data) }));

    const paper = document.createElement('div'); paper.className = 'paper docx';
    let paras = 0;
    for (const part of doc.parts) {
      const x = parseXml(part.xml), sec = document.createElement('div'), out = [];
      walk(rootOf(x), sec, out, part.i);
      if (!out.length) continue;
      paras += out.length;
      if (doc.parts.length > 1) {
        const kind = part.name.includes('header') ? 'Header' : part.name.includes('footer') ? 'Footer' : 'Document';
        paper.append(Object.assign(document.createElement('div'), { className: 'ed-part', textContent: kind }));
      }
      paper.append(...sec.childNodes);
    }
    host.append(paper);
    return `${paras} paragraph${paras === 1 ? '' : 's'} & table cells`;
  }

  function buildDocx() {
    const files = doc.files.map(f => ({ name: f.name, data: f.data }));
    for (const part of doc.parts) {
      const its = [...changed].filter(it => it.part === part.i);
      if (!its.length) continue;
      const x = parseXml(part.xml), ps = [];
      walk(rootOf(x), null, ps, part.i);
      its.forEach(it => setParaText(ps[it.idx], it.orig, readText(it.el)));
      let s = new XMLSerializer().serializeToString(x);
      if (!s.startsWith('<?xml')) s = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n' + s;
      files.find(f => f.name === part.name).data = s;
    }
    return DOCX.zip(files);
  }

  /* =====================================================================
     PDF
     ===================================================================== */
  // pdf.js often splits one line into several pieces – join pieces of the same font that sit side by side
  function mergeItems(raw) {
    const out = [];
    for (const it of raw) {
      if (typeof it.str !== 'string' || !it.transform) continue;
      const t = it.transform, size = Math.hypot(t[2], t[3]);
      if (Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 || size < 1) continue;   // rotated / skewed text stays as it is
      const last = out[out.length - 1];
      if (!it.str.trim()) {   // pdf.js fills gaps with " " items: a wide one is a column / table-cell gap, so the line ends here
        if (last && it.width > size * 0.6) last.closed = true;
        continue;
      }
      if (last && !last.closed && last.font === it.fontName && Math.abs(last.size - size) < 0.2 && Math.abs(last.y - t[5]) < size * 0.2) {
        const gap = t[4] - (last.x + last.w);
        if (gap > -size * 0.3 && gap < size * 0.8) {
          last.str += (gap > size * 0.15 && !/\s$/.test(last.str) && !/^\s/.test(it.str) ? ' ' : '') + it.str;
          last.w = Math.max(last.w, t[4] + it.width - last.x);
          continue;
        }
      }
      out.push({ str: it.str, x: t[4], y: t[5], w: it.width, size, font: it.fontName });
    }
    out.forEach(o => { o.str = o.str.replace(/\s+$/, ''); });
    return out.filter(o => o.str);
  }

  // Background = most common colour around the text box, ink = the pixel inside that differs from it the most
  function sampleColors(ctx, x0, y0, x1, y1) {
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const ax = Math.max(0, Math.floor(Math.min(x0, x1)) - 3), ay = Math.max(0, Math.floor(Math.min(y0, y1)) - 3);
    const bx = Math.min(cw, Math.ceil(Math.max(x0, x1)) + 3), by = Math.min(ch, Math.ceil(Math.max(y0, y1)) + 3);
    const w = bx - ax, h = by - ay;
    if (w < 8 || h < 8) return { bg: [255, 255, 255], ink: [0, 0, 0] };
    const d = ctx.getImageData(ax, ay, w, h).data, px = (x, y) => { const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const counts = new Map(); let bg = [255, 255, 255], best = 0;
    const vote = c => { const k = (c[0] >> 4) << 8 | (c[1] >> 4) << 4 | c[2] >> 4, n = (counts.get(k) || 0) + 1; counts.set(k, n); if (n > best) { best = n; bg = c; } };
    for (let x = 0; x < w; x++) { vote(px(x, 0)); vote(px(x, h - 1)); }
    for (let y = 1; y < h - 1; y++) { vote(px(0, y)); vote(px(w - 1, y)); }
    let ink = null, far = 0;
    for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
      const c = px(x, y), dd = (c[0] - bg[0]) ** 2 + (c[1] - bg[1]) ** 2 + (c[2] - bg[2]) ** 2;
      if (dd > far) { far = dd; ink = c; }
    }
    if (!ink || far < 3000) ink = bg[0] * .299 + bg[1] * .587 + bg[2] * .114 > 128 ? [0, 0, 0] : [255, 255, 255];
    return { bg, ink };
  }

  async function openPdf() {
    const lib = await getPdfjs();
    let pdf;
    try { pdf = await lib.getDocument({ data: doc.bytes.slice() }).promise; }
    catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'This PDF is password protected – remove the password first.' : 'This PDF could not be opened: ' + (e.message || e)); }
    let blocks = 0;
    for (let n = 1; n <= pdf.numPages; n++) {
      say(`Opening ${doc.name} – page ${n} of ${pdf.numPages}…`);
      blocks += await renderPage(await pdf.getPage(n), n - 1, pdf.numPages);
    }
    if (!blocks) say('This PDF has no editable text (it is probably a scanned image).');
    return `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} · ${blocks} text line${blocks === 1 ? '' : 's'}`;
  }

  async function renderPage(page, index, total) {
    const vp1 = page.getViewport({ scale: 1 });
    const paper = document.createElement('div'); paper.className = 'paper pdf';
    host.append(paper);
    const shown = Math.min(1100, paper.clientWidth || 1000);
    const scale = Math.min(4, Math.max(2, shown / vp1.width * (window.devicePixelRatio || 1)));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    canvas.setAttribute('aria-hidden', 'true');
    paper.style.aspectRatio = `${vp1.width} / ${vp1.height}`;
    paper.append(canvas);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const tc = await page.getTextContent();
    if (total > 1) paper.append(Object.assign(document.createElement('span'), { className: 'pnum', textContent: `Page ${index + 1} / ${total}` }));

    const fontOf = id => {
      let name = '';
      try { name = page.commonObjs.get(id)?.name || ''; } catch {}
      const fam = tc.styles[id]?.fontFamily || '';
      return {
        bold: /bold|black|heavy|semibold/i.test(name), italic: /italic|oblique/i.test(name),
        serif: (/times|roman|serif|georgia|cambria|garamond/i.test(name) && !/sans/i.test(name)) || (!name && fam === 'serif'),
        mono: /courier|mono/i.test(name) || fam === 'monospace',
      };
    };
    const items = mergeItems(tc.items)
      .filter((o, i, all) => !all.some((p, j) => j > i && Math.abs(p.x - o.x) < 0.6 && Math.abs(p.y - o.y) < 0.6 && Math.abs(p.size - o.size) < 0.5));
    for (const o of items) {
      const f = fontOf(o.font);
      const [lx, ly] = vp1.convertToViewportPoint(o.x, o.y);
      const [ax, ay] = vp.convertToViewportPoint(o.x, o.y + o.size * 0.8), [bx, by] = vp.convertToViewportPoint(o.x + o.w, o.y - o.size * 0.2);
      const { bg, ink } = sampleColors(ctx, ax, ay, bx, by);
      const el = document.createElement('span');
      el.className = 'ti' + (f.mono ? ' mono' : f.serif ? ' serif' : '');
      Object.assign(el.style, {
        left: lx / vp1.width * 100 + '%', top: (ly - o.size * 0.92) / vp1.height * 100 + '%',
        minWidth: o.w / vp1.width * 100 + '%', fontSize: o.size / vp1.width * 100 + 'cqw',
        fontWeight: f.bold ? '700' : '400', fontStyle: f.italic ? 'italic' : 'normal',
      });
      el.style.setProperty('--bg-s', `rgb(${bg})`);
      el.style.setProperty('--ink-s', `rgb(${ink})`);
      el.spellcheck = false;
      paper.append(el);
      addItem(el, o.str, { page: index, x: o.x, y: o.y, w: o.w, size: o.size, bg, ink, ...f });
    }
    return items.length;
  }

  /* ----- Remove the old text from the page itself (not only cover it) -----
     A small content-stream reader finds each text-drawing operator (Tj / TJ) and where it starts on the page.
     Operators that start inside a changed text box are cut out. Anything that cannot be matched safely
     (text inside form XObjects, text whose position depends on the text drawn before it) stays,
     hidden under the cover rectangle as before. */
  const PWS = new Set([0, 9, 10, 12, 13, 32]), PDELIM = new Set([...'()<>[]{}/%'].map(c => c.charCodeAt(0)));
  function* pdfTokens(b) {
    const n = b.length;
    let i = 0;
    while (i < n) {
      const c = b[i], s = i;
      if (PWS.has(c)) { i++; continue; }
      if (c === 37) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }                       // % comment
      if (c === 40) {                                                                                     // (literal string)
        for (let depth = 0; i < n; i++) { const d = b[i]; if (d === 92) { i++; continue; } if (d === 40) depth++; else if (d === 41 && --depth === 0) { i++; break; } }
        yield { t: 'str', s, e: i }; continue;
      }
      if (c === 60) {                                                                                     // << or <hex string>
        if (b[i + 1] === 60) { i += 2; yield { t: 'dict', s, e: i }; continue; }
        while (i < n && b[i] !== 62) i++;
        yield { t: 'str', s, e: ++i }; continue;
      }
      if (c === 62) { i += b[i + 1] === 62 ? 2 : 1; yield { t: 'dict', s, e: i }; continue; }
      if (c === 91 || c === 93) { i++; yield { t: c === 91 ? '[' : ']', s, e: i }; continue; }
      if (c === 47) { i++; while (i < n && !PWS.has(b[i]) && !PDELIM.has(b[i])) i++; yield { t: 'name', s, e: i }; continue; }
      while (i < n && !PWS.has(b[i]) && !PDELIM.has(b[i])) i++;
      if (i === s) { i++; continue; }                                                                     // stray delimiter
      const w = String.fromCharCode(...b.subarray(s, i));
      if (/^[+\-]?(\d+\.?\d*|\.\d+)$/.test(w)) { yield { t: 'num', v: +w, s, e: i }; continue; }
      if (w === 'BI') {                                                                                   // inline image: skip its binary data
        let j = i;
        while (j < n - 2 && !(b[j] === 73 && b[j + 1] === 68 && PWS.has(b[j - 1]) && PWS.has(b[j + 2]))) j++;
        for (j += 3; j < n - 1 && !(b[j] === 69 && b[j + 1] === 73 && PWS.has(b[j - 1]) && (j + 2 >= n || PWS.has(b[j + 2]))); ) j++;
        i = Math.min(n, j + 2); yield { t: 'op', v: 'BI', s, e: i }; continue;
      }
      yield { t: 'op', v: w, s, e: i };
    }
  }
  const mul = (m, k) => [m[0] * k[0] + m[1] * k[2], m[0] * k[1] + m[1] * k[3], m[2] * k[0] + m[3] * k[2], m[2] * k[1] + m[3] * k[3], m[4] * k[0] + m[5] * k[2] + k[4], m[4] * k[1] + m[5] * k[3] + k[5]];
  const ID = [1, 0, 0, 1, 0, 0];
  // Every text-showing operator with its byte range and starting point in page space
  function textOps(b) {
    const out = [], stack = [];
    let nums = [], start = -1, depth = 0, ctm = ID, tm = null, tlm = null, size = 0, lead = 0, rise = 0, known = false;
    const last = k => { const a = nums.slice(-k); return a.length === k && a.every(Number.isFinite) ? a : null; };
    for (const tk of pdfTokens(b)) {
      if (start < 0) start = tk.s;
      if (tk.t === '[') depth++;
      else if (tk.t === ']') depth = Math.max(0, depth - 1);
      if (tk.t !== 'op') { if (!depth && tk.t !== ']') nums.push(tk.t === 'num' ? tk.v : NaN); continue; }
      const o = tk.v, s = start;
      let a;
      switch (o) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() || ID; break;
        case 'cm': if ((a = last(6))) ctm = mul(a, ctm); break;
        case 'BT': tm = tlm = ID; known = true; break;
        case 'ET': tm = tlm = null; break;
        case 'Tf': if ((a = last(1))) size = a[0]; break;
        case 'TL': if ((a = last(1))) lead = a[0]; break;
        case 'Ts': if ((a = last(1))) rise = a[0]; break;
        case 'Td': case 'TD': if (tlm && (a = last(2))) { if (o === 'TD') lead = -a[1]; tm = tlm = mul([1, 0, 0, 1, a[0], a[1]], tlm); known = true; } break;
        case 'Tm': if ((a = last(6))) { tm = tlm = a; known = true; } break;
        case 'T*': if (tlm) { tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); known = true; } break;
        case 'Tj': case 'TJ': case "'": case '"': {
          if (!tm) break;
          if (o === "'" || o === '"') { tm = tlm = mul([1, 0, 0, 1, 0, -lead], tlm); known = true; }
          const m = mul(tm, ctm);
          out.push({ s, e: tk.e, op: o, known, x: m[4] + rise * m[2], y: m[5] + rise * m[3], size: Math.abs(size) * Math.hypot(m[2], m[3]) });
          known = false;   // the next operator starts where this text ended – unknown without glyph widths
          break;
        }
      }
      nums = []; start = -1; depth = 0;
    }
    return out;
  }
  // Byte ranges to cut: Tj / TJ that start inside a changed box, unless text after it depends on its width
  function cutRanges(b, its) {
    const ops = textOps(b);
    const hit = ops.map(op => op.known && (op.op === 'Tj' || op.op === 'TJ') && its.some(it =>
      Math.abs(op.y - it.y) < it.size * 0.3 && op.x > it.x - 1 && op.x < it.x + Math.max(it.w, 1) - 0.5 && Math.abs(op.size - it.size) < it.size * 0.2 + 0.2));
    for (let k = ops.length - 1; k >= 0; k--) if (hit[k] && ops[k + 1] && !ops[k + 1].known && !hit[k + 1]) hit[k] = false;
    return ops.filter((_, k) => hit[k]).map(op => [op.s, op.e]);
  }
  function stripPage(L, pdf, page, its) {
    const c = page.node.Contents();
    if (!c) return 0;
    const streams = c instanceof L.PDFArray ? c.asArray().map(r => pdf.context.lookup(r)) : [c];
    if (!streams.every(st => st instanceof L.PDFRawStream)) return 0;
    const parts = streams.map(st => L.decodePDFRawStream(st).decode());
    const b = new Uint8Array(parts.reduce((n, p) => n + p.length + 1, 0));
    let o = 0;
    for (const p of parts) { b.set(p, o); o += p.length; b[o++] = 10; }
    const cut = cutRanges(b, its);
    if (!cut.length) return 0;
    const out = new Uint8Array(b.length);
    let w = 0, from = 0;
    for (const [s, e] of cut) { out.set(b.subarray(from, s), w); w += s - from; out[w++] = 32; from = e; }
    out.set(b.subarray(from), w); w += b.length - from;
    page.node.set(L.PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream(out.subarray(0, w))));
    return cut.length;
  }

  // Characters the standard PDF fonts cannot draw
  const SUBST = { '☑': '[x]', '☒': '[x]', '✔': 'v', '✓': 'v', '☐': '[ ]', '\t': '    ', ' ': ' ', '−': '-', '≥': '>=', '≤': '<=' };
  function encodable(font, s) {
    let out = '', lost = 0;
    for (const ch of s) {
      const c = SUBST[ch] ?? ch;
      try { font.encodeText(c); out += c; } catch { out += '?'; lost++; }
    }
    return { text: out, lost };
  }

  async function buildPdf() {
    const L = await getPdfLib(), { PDFDocument, StandardFonts, rgb } = L;
    let pdf;
    try { pdf = await PDFDocument.load(doc.bytes, { ignoreEncryption: true }); }
    catch (e) { throw new Error('This PDF could not be changed: ' + e.message); }
    const pages = pdf.getPages(), fonts = {};
    const fontFor = async it => {
      const base = it.mono ? 'Courier' : it.serif ? 'TimesRoman' : 'Helvetica';
      const style = it.bold && it.italic ? (it.serif ? 'BoldItalic' : 'BoldOblique') : it.bold ? 'Bold' : it.italic ? (it.serif ? 'Italic' : 'Oblique') : '';
      const key = base + style;
      return fonts[key] ||= await pdf.embedFont(StandardFonts[key]);
    };
    const col = c => rgb(c[0] / 255, c[1] / 255, c[2] / 255);
    // First take the old text out of each page (before pdf-lib adds its own drawing to it)
    const byPage = new Map();
    for (const it of changed) byPage.set(it.page, [...(byPage.get(it.page) || []), it]);
    let removed = 0;
    for (const [pi, its] of byPage) {
      try { removed += stripPage(L, pdf, pages[pi], its); }
      catch (e) { console.warn('Old text on page ' + (pi + 1) + ' is only covered:', e); }
    }
    console.info(`PDF edit: removed ${removed} old text operator(s)`);
    let lost = 0;
    for (const it of changed) {
      const page = pages[it.page], font = await fontFor(it), lh = it.size * 1.15;
      const lines = readText(it.el).split('\n').map(l => { const r = encodable(font, l); lost += r.lost; return r.text; });
      const width = Math.max(it.w, ...lines.map(l => font.widthOfTextAtSize(l, it.size)));
      // Cover the old text (same box the editor shows), then draw the new lines
      page.drawRectangle({ x: it.x - 0.5, y: it.y - 0.23 * it.size - (lines.length - 1) * lh, width: width + 1, height: lines.length * lh, color: col(it.bg) });
      lines.forEach((l, i) => { if (l) page.drawText(l, { x: it.x, y: it.y - i * lh, size: it.size, font, color: col(it.ink) }); });
    }
    return { bytes: await pdf.save(), lost };
  }

  /* =====================================================================
     Page wiring
     ===================================================================== */
  function clear() {
    doc = null; changed.clear(); unsaved = false;
    host.replaceChildren();
    $('edInfo').hidden = true; $('edPick').hidden = false;
    $('edSave').disabled = $('edPrint').disabled = true;
    $('edSave').textContent = 'Download';
  }

  async function openFile(f) {
    if (!f) return;
    if (unsaved && changed.size && !confirm(`${doc.name} has changes that were not downloaded. Open another file anyway?`)) return;
    if (/\.doc$/i.test(f.name)) { say('Old .doc files are not supported – open it in Word and “Save as” .docx first.'); return; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const head = String.fromCharCode(...bytes.subarray(0, 1024));
    const kind = head.includes('%PDF-') ? 'pdf' : head.startsWith('PK') ? 'docx' : '';
    if (!kind) { say(`${f.name} is not a PDF or DOCX file.`); return; }

    clear();
    doc = { kind, name: f.name, bytes, items: [] };
    const btn = $('edSave'); setBusy(btn, true);
    say(`Opening ${f.name}…`);
    try {
      $('edPick').hidden = true;
      const meta = kind === 'pdf' ? await openPdf() : await openDocx();
      doc.items.forEach(it => { it.base = readText(it.el); });   // as the browser shows it (whitespace normalised)
      $('edType').textContent = kind.toUpperCase();
      $('edType').classList.toggle('docx', kind === 'docx');
      $('edName').textContent = f.name;
      $('edMeta').textContent = meta;
      $('edHint').innerHTML = kind === 'pdf'
        ? 'Click any text on the page to change it (<kbd>Enter</kbd> adds a new line). Changed text is drawn in a standard font (Helvetica / Times) over the old text, in the same size and colour – keep it about the same length so it fits its box. Bangla and other non-Latin letters cannot be written into a PDF here; use the DOCX for those.'
        : 'Click any paragraph or table cell to change it. Fonts, tables, images and the signature stay as they are; changed text keeps the style of the text around it. The yellow highlight only shows what you changed – it is not in the download.';
      $('edInfo').hidden = false;
      $('edCount').textContent = 'No changes'; $('edCount').classList.remove('on');
      unsaved = false;
      btn.textContent = kind === 'pdf' ? 'Download PDF' : 'Download DOCX';
      $('edPrint').disabled = false;
      if (doc.items.length || kind === 'docx') say(`Opened ${f.name} – click any text to edit it.`);
    } catch (e) {
      console.error(e);
      clear();
      say(e.message || String(e));
    } finally { setBusy(btn, false); btn.disabled = !doc; }
  }

  $('edFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; openFile(f); };
  $('edOpen').onclick = () => $('edFile').click();

  // Drag & drop anywhere on the page
  const drop = $('edDrop');
  document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); openFile(e.dataTransfer.files[0]); });

  $('edReset').onclick = () => {
    if (!changed.size) { say('There are no changes to undo.'); return; }
    if (!confirm(`Undo all ${changed.size} change(s)?`)) return;
    [...changed].forEach(it => { it.el.textContent = it.orig; it.base = readText(it.el); mark(it); });
    say('All changes were undone.');
  };

  $('edReplAll').onclick = () => {
    const q = $('edFind').value, r = $('edRepl').value;
    if (!doc) return;
    if (!q) { $('edFind').focus(); return; }
    let n = 0;
    doc.items.forEach(it => {
      const t = readText(it.el);
      if (!t.includes(q)) return;
      const parts = t.split(q); n += parts.length - 1;
      it.el.textContent = parts.join(r);
      mark(it);
    });
    say(n ? `Replaced ${n} time${n === 1 ? '' : 's'}.` : `“${q}” was not found.` + (doc.kind === 'pdf' ? ' In a PDF a phrase can be split over two lines – try a shorter part.' : ''));
  };
  [$('edFind'), $('edRepl')].forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('edReplAll').click(); } }));

  $('edPrint').onclick = () => window.print();

  $('edSave').onclick = async () => {
    if (!doc) return;
    const btn = $('edSave'); setBusy(btn, true);
    say('Preparing ' + doc.kind.toUpperCase() + '…');
    try {
      if (doc.kind === 'docx') {
        const name = outName('docx');
        download(buildDocx(), name, DOCX_MIME);
        unsaved = false;
        say(`Downloaded ${name}` + (changed.size ? ` with ${changed.size} change${changed.size === 1 ? '' : 's'}.` : ' (no changes).'));
      } else {
        const name = outName('pdf'), { bytes, lost } = await buildPdf();
        download(bytes, name, 'application/pdf');
        unsaved = false;
        say(`Downloaded ${name}` + (changed.size ? ` with ${changed.size} change${changed.size === 1 ? '' : 's'}.` : ' (no changes).')
          + (lost ? ` ${lost} character${lost === 1 ? '' : 's'} could not be written in the PDF font and became “?”.` : ''));
      }
    } catch (e) {
      console.error(e);
      say('Download failed: ' + (e.message || e));
    } finally { setBusy(btn, false); }
  };

  window.addEventListener('beforeunload', e => { if (unsaved && changed.size) { e.preventDefault(); e.returnValue = ''; } });
})();
