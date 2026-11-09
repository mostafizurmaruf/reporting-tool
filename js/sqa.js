/* =====================================================================
   SQA DOCUMENTATION BUILDER
   Doc  = { project, version, author, date, modules: [Module] }
   Module = { name, title, overview, sections: [Section] }
   Section = { heading, intro, points (outline text), interaction, table (text: "a | b | c" per line) }
   ===================================================================== */
const SQA = (() => {
  const DKEY = 'versatilo-sqa-doc-v1', MKEY = 'versatilo-form-mode';
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const blankSection = () => ({ id: uid(), heading: '', intro: '', points: '', interaction: '', table: '' });
  const blankModule = name => ({ id: uid(), name: name || 'New module', title: '', overview: '', sections: [blankSection()] });
  const blankDoc = () => ({ project: '', version: '1.0', author: '', date: today(), modules: [blankModule('Home Page')] });
  const h = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let doc, cur = 0, preview = false, saveT;
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const str = v => typeof v === 'string' ? v : '';
    return {
      project: str(d.project), version: str(d.version), author: str(d.author), date: str(d.date),
      modules: (Array.isArray(d.modules) && d.modules.length ? d.modules : [blankModule('Home Page')]).map(m => ({
        id: str(m.id) || uid(), name: str(m.name) || 'Untitled module', title: str(m.title), overview: str(m.overview),
        sections: (Array.isArray(m.sections) ? m.sections : []).map(s => ({ id: str(s.id) || uid(), heading: str(s.heading), intro: str(s.intro), points: str(s.points), interaction: str(s.interaction), table: str(s.table) })),
      })),
    };
  }
  try { doc = normalize(JSON.parse(ls.get(DKEY) || 'null')); } catch { doc = blankDoc(); }
  if (!ls.get(DKEY)) doc = blankDoc();
  const save = () => { clearTimeout(saveT); saveT = setTimeout(() => ls.set(DKEY, JSON.stringify(doc)), 250); };

  /* ---------- Daily activity log (feeds "⬇ Fetch SQA work" in the daily report) ----------
     act = { 'YYYY-MM-DD': { <moduleId>: { name, project, created, deleted, ai, overview, secs: { <sectionId>: { heading, new, deleted } } }, _x: { docx, copy, print } } } */
  const AKEY = 'versatilo-sqa-activity-v1';
  let act = {}, actT;
  try { act = JSON.parse(ls.get(AKEY) || '{}') || {}; } catch { act = {}; }
  function saveAct() {
    clearTimeout(actT);
    actT = setTimeout(() => {
      const keep = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);   // keep 60 days
      Object.keys(act).forEach(d => { if (d < keep) delete act[d]; });
      ls.set(AKEY, JSON.stringify(act));
    }, 300);
  }
  function touch(m, s, kind) {
    const day = act[today()] ||= {};
    const e = day[m.id] ||= { created: false, deleted: false, ai: 0, overview: false, secs: {} };
    e.name = m.name; e.project = doc.project;
    if (kind === 'mcreate') e.created = true;
    else if (kind === 'mdelete') e.deleted = true;
    else if (kind === 'ai') e.ai++;
    else if (kind === 'overview') e.overview = true;
    if (s) {
      const x = e.secs[s.id] ||= { new: false, deleted: false };
      x.heading = s.heading;
      if (kind === 'screate') x.new = true; else if (kind === 'sdel') x.deleted = true;
    }
    saveAct();
  }
  function touchShare(kind) { const x = (act[today()] ||= {})._x ||= {}; x[kind] = (x[kind] || 0) + 1; saveAct(); }
  const mod = () => doc.modules[cur];

  /* ---------- Content model → blocks (shared by preview, clipboard, DOCX, print) ---------- */
  // Inline text → runs. "**x**" is bold; a leading "Label:" is bold when there is no ** in the line.
  function runs(text) {
    text = String(text || '');
    if (text.includes('**')) return text.split('**').map((t, i) => ({ text: t, b: i % 2 === 1 })).filter(r => r.text);
    const m = text.match(/^([^:]{1,48}:)(\s+\S[\s\S]*)?$/);
    return m && m[2] ? [{ text: m[1], b: true }, { text: m[2] }] : [{ text }];
  }
  function outline(points) {
    const out = [];
    for (const raw of String(points || '').split('\n')) {
      if (!raw.trim()) continue;
      const lead = raw.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length;
      let t = raw.trim();
      if (/^#{2,3}\s+/.test(t)) { out.push({ t: 'h3', text: t.replace(/^#+\s+/, '') }); continue; }
      t = t.replace(/^([-*•◦▪]|\d+[.)])\s+/, '');
      out.push({ t: 'li', level: Math.min(5, lead >> 1), runs: runs(t) });
    }
    // a sub-point can only be one level deeper than the point above it
    let prev = -1;
    out.forEach(b => { if (b.t !== 'li') { prev = -1; return; } b.level = Math.min(b.level, prev + 1); prev = b.level; });
    return out;
  }
  const tableRows = t => String(t || '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim())).filter(r => !r.every(c => /^:?-{2,}:?$/.test(c)));
  function moduleBlocks(m) {
    const b = [{ t: 'h1', text: m.title.trim() || m.name.trim() || 'Untitled module' }];
    if (m.title.trim() && m.name.trim() && m.title.trim() !== m.name.trim()) b.push({ t: 'p', runs: [{ text: 'Module: ', b: true }, { text: m.name.trim() }] });
    if (m.overview.trim()) { b.push({ t: 'label', text: 'Overview' }); m.overview.trim().split(/\n\s*\n/).forEach(pp => b.push({ t: 'p', runs: runs(pp.replace(/\n/g, ' ')) })); }
    m.sections.forEach((s, i) => {
      if (!s.heading.trim() && !s.intro.trim() && !s.points.trim() && !s.interaction.trim() && !s.table.trim()) return;
      b.push({ t: 'h2', text: s.heading.trim() || `Section ${i + 1}` });
      if (s.intro.trim()) b.push({ t: 'p', runs: runs(s.intro.trim()) });
      b.push(...outline(s.points));
      const rows = tableRows(s.table);
      if (rows.length) b.push({ t: 'table', rows });
      if (s.interaction.trim()) b.push({ t: 'p', runs: [{ text: 'Interaction: ', b: true }, ...runs(s.interaction.trim())] });
    });
    return b;
  }
  function docBlocks(only) {
    if (only != null) return moduleBlocks(doc.modules[only]);
    const b = [{ t: 'title', text: doc.project.trim() || 'Application' }, { t: 'subtitle', text: 'SQA Feature Documentation' }];
    const meta = [doc.version.trim() && 'Version ' + doc.version.trim(), doc.author.trim() && 'Prepared by ' + doc.author.trim(), doc.date && DOCX.fmtDate(doc.date).replace(/ /g, '')].filter(Boolean).join('  ·  ');
    if (meta) b.push({ t: 'meta', text: meta });
    b.push({ t: 'label', text: 'Contents' });
    doc.modules.forEach((m, i) => b.push({ t: 'li', level: 0, runs: [{ text: `${i + 1}. ${m.title.trim() || m.name.trim()}` }] }));
    doc.modules.forEach(m => b.push(...moduleBlocks(m)));
    return b;
  }

  /* ---------- blocks → HTML (screen preview, or inline-styled for pasting into Google Docs) ---------- */
  function toHTML(blocks, forPaste) {
    const S = forPaste ? {
      h1: ' style="font-size:20pt;color:#17364E;font-weight:bold"', h2: ' style="font-size:14pt;color:#17364E;font-weight:bold"', h3: ' style="font-size:12pt;font-weight:bold"',
      table: ' style="border-collapse:collapse;width:100%"', td: ' style="border:1px solid #9aa6b2;padding:4pt 6pt;vertical-align:top"',
      th: ' style="border:1px solid #9aa6b2;padding:4pt 6pt;background:#17364E;color:#ffffff;font-weight:bold"',
    } : { h1: '', h2: '', h3: '', table: '', td: '', th: '' };
    const r = rs => rs.map(x => x.b ? `<b>${h(x.text)}</b>` : h(x.text)).join('');
    let out = '', depth = -1, cover = '';
    const closeList = () => { while (depth >= 0) { out += '</li></ul>'; depth--; } };
    for (const b of blocks) {
      if (b.t === 'li') {
        const L = Math.min(b.level, depth + 1);
        if (L > depth) { out += '<ul><li>'; depth++; } else { while (depth > L) { out += '</li></ul>'; depth--; } out += '</li><li>'; }
        out += r(b.runs); continue;
      }
      closeList();
      if (b.t === 'title') cover += forPaste ? `<p style="font-size:26pt;font-weight:bold;text-align:center;color:#17364E">${h(b.text)}</p>` : `<div class="t">${h(b.text)}</div>`;
      else if (b.t === 'subtitle') cover += forPaste ? `<p style="font-size:14pt;text-align:center;color:#5b6670">${h(b.text)}</p>` : `<div class="s">${h(b.text)}</div>`;
      else if (b.t === 'meta') cover += forPaste ? `<p style="text-align:center;color:#5b6670">${h(b.text)}</p>` : `<div class="hint">${h(b.text)}</div>`;
      else {
        if (cover) { out += forPaste ? cover : `<div class="cover">${cover}</div>`; cover = ''; }
        if (b.t === 'h1' || b.t === 'h2' || b.t === 'h3') out += `<${b.t}${S[b.t]}>${h(b.text)}</${b.t}>`;
        else if (b.t === 'label') out += `<p><b>${h(b.text)}</b></p>`;
        else if (b.t === 'p') out += `<p>${r(b.runs)}</p>`;
        else if (b.t === 'table') {
          const n = Math.max(...b.rows.map(x => x.length));
          out += `<table${S.table}>` + b.rows.map((row, i) => '<tr>' + Array.from({ length: n }, (_, j) => i === 0
            ? `<td${S.th}><b>${h(row[j] || '')}</b></td>` : `<td${S.td}>${r(runs(row[j] || ''))}</td>`).join('') + '</tr>').join('') + '</table>';
        }
      }
    }
    closeList();
    return out;
  }
  function toMarkdown(blocks) {
    const r = rs => rs.map(x => x.b ? `**${x.text.trim()}**${/\s$/.test(x.text) ? ' ' : ''}` : x.text).join('');
    return blocks.map(b => ({
      title: () => `# ${b.text}`, subtitle: () => b.text, meta: () => b.text, label: () => `**${b.text}**`,
      h1: () => `\n# ${b.text}`, h2: () => `\n## ${b.text}`, h3: () => `### ${b.text}`, p: () => r(b.runs),
      li: () => '  '.repeat(b.level) + '- ' + r(b.runs),
      table: () => '\n' + b.rows.map((row, i) => '| ' + row.join(' | ') + ' |' + (i === 0 ? '\n|' + row.map(() => ' --- |').join('') : '')).join('\n'),
    }[b.t] || (() => ''))()).join('\n') + '\n';
  }

  /* ---------- blocks → DOCX (real Word headings + bullet lists, so the outline / Google Docs import works) ---------- */
  function toDocx(blocks) {
    const E = DOCX.esc, BR = '17364E';
    const R = rs => rs.map(x => `<w:r>${x.b ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${E(x.text)}</w:t></w:r>`).join('');
    const P = (inner, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${inner}</w:p>`;
    const W = 9746;
    let body = '';
    for (const b of blocks) {
      if (b.t === 'title') body += P(R([{ text: b.text }]), '<w:pStyle w:val="Title"/><w:spacing w:before="2400"/><w:jc w:val="center"/>');
      else if (b.t === 'subtitle') body += P(R([{ text: b.text }]), '<w:pStyle w:val="Subtitle"/><w:jc w:val="center"/>');
      else if (b.t === 'meta') body += P(R([{ text: b.text }]), '<w:jc w:val="center"/><w:spacing w:after="600"/>');
      else if (b.t === 'h1') body += P(R([{ text: b.text }]), '<w:pStyle w:val="Heading1"/><w:pageBreakBefore/>');
      else if (b.t === 'h2') body += P(R([{ text: b.text }]), '<w:pStyle w:val="Heading2"/>');
      else if (b.t === 'h3') body += P(R([{ text: b.text }]), '<w:pStyle w:val="Heading3"/>');
      else if (b.t === 'label') body += P(R([{ text: b.text, b: true }]), '<w:spacing w:before="160"/>');
      else if (b.t === 'p') body += P(R(b.runs));
      else if (b.t === 'li') body += P(R(b.runs), `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${b.level}"/><w:numId w:val="1"/></w:numPr>`);
      else if (b.t === 'table') {
        const n = Math.max(...b.rows.map(x => x.length)), cw = W / n | 0;
        const border = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="6" w:space="0" w:color="9AA6B2"/>`).join('') + '</w:tblBorders>';
        body += `<w:tbl><w:tblPr><w:tblW w:w="${cw * n}" w:type="dxa"/>${border}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${`<w:gridCol w:w="${cw}"/>`.repeat(n)}</w:tblGrid>`
          + b.rows.map((row, i) => `<w:tr>${i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` + Array.from({ length: n }, (_, j) =>
            `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${i === 0 ? `<w:shd w:val="clear" w:color="auto" w:fill="${BR}"/>` : ''}</w:tcPr>`
            + P(i === 0 ? `<w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:t xml:space="preserve">${E(row[j] || '')}</w:t></w:r>` : R(runs(row[j] || '')), '<w:spacing w:before="40" w:after="40"/>') + '</w:tc>').join('') + '</w:tr>').join('')
          + '</w:tbl>' + P('');
      }
    }
    const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const document = `${X}<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="500" w:footer="500" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const st = (id, name, ppr, rpr, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rpr}</w:rPr></w:style>`;
    const styles = `${X}<w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Aptos" w:eastAsia="Aptos"/><w:color w:val="283139"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
      + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
      + st('Title', 'Title', '<w:spacing w:after="120"/>', `<w:b/><w:color w:val="${BR}"/><w:sz w:val="56"/><w:szCs w:val="56"/>`)
      + st('Subtitle', 'Subtitle', '<w:spacing w:after="120"/>', '<w:color w:val="5B6670"/><w:sz w:val="30"/><w:szCs w:val="30"/>')
      + st('Heading1', 'heading 1', `<w:keepNext/><w:spacing w:before="240" w:after="160"/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="1F6FEB"/></w:pBdr><w:outlineLvl w:val="0"/>`, `<w:b/><w:color w:val="${BR}"/><w:sz w:val="36"/><w:szCs w:val="36"/>`)
      + st('Heading2', 'heading 2', '<w:keepNext/><w:spacing w:before="280" w:after="80"/><w:outlineLvl w:val="1"/>', `<w:b/><w:color w:val="${BR}"/><w:sz w:val="28"/><w:szCs w:val="28"/>`)
      + st('Heading3', 'heading 3', '<w:keepNext/><w:spacing w:before="160" w:after="40"/><w:outlineLvl w:val="2"/>', '<w:b/><w:sz w:val="23"/><w:szCs w:val="23"/>')
      + st('ListParagraph', 'List Paragraph', '<w:spacing w:after="40"/><w:contextualSpacing/>', '')
      + '</w:styles>';
    const chars = ['•', '◦', '▪'];
    const numbering = `${X}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>`
      + Array.from({ length: 6 }, (_, l) => `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${chars[l % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${360 + l * 360}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/></w:rPr></w:lvl>`).join('')
      + '</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';
    const ct = `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`;
    const rels = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
    const docRels = `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdN" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
    return DOCX.zip([{ name: '[Content_Types].xml', data: ct }, { name: '_rels/.rels', data: rels }, { name: 'word/document.xml', data: document },
                     { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering }, { name: 'word/_rels/document.xml.rels', data: docRels }]);
  }

  /* ---------- Editor UI ---------- */
  const tabs = $('mTabs'), ed = $('mEditor');
  function renderTabs() {
    tabs.innerHTML = doc.modules.map((m, i) => `<button type="button" role="tab" data-tab="${i}" aria-selected="${i === cur}" title="${h(m.name)}">${h(m.name || 'Untitled')}</button>`).join('')
      + '<button type="button" class="add" data-tab="add">+ Add module</button>';
  }
  function secHTML(s, i, n) {
    return `<div class="sec" data-s="${i}">
      <div class="sec-head">
        <div><label>Section ${i + 1} heading</label><input data-f="heading" value="${h(s.heading)}" placeholder="e.g. Header & Real-Time Status Tracking"></div>
        <button type="button" class="icon" data-act="up" title="Move up" aria-label="Move section up" ${i ? '' : 'disabled'}>↑</button>
        <button type="button" class="icon" data-act="down" title="Move down" aria-label="Move section down" ${i < n - 1 ? '' : 'disabled'}>↓</button>
        <button type="button" class="icon" data-act="dup" title="Duplicate" aria-label="Duplicate section">⧉</button>
        <button type="button" class="icon" data-act="del" title="Delete section" aria-label="Delete section">🗑</button>
      </div>
      <div><label>Short description (optional)</label><input data-f="intro" value="${h(s.intro)}" placeholder="e.g. Displayed as a prominent banner slide carousel."></div>
      <div><label>Points – one per line · Tab = sub-point · “Label: text” makes the label bold · “### ” = sub-heading</label>
        <textarea class="pts" data-f="points" rows="${Math.max(5, s.points.split('\n').length + 1)}" placeholder="Date & Time Display: Shows the full current date and real-time clock.&#10;Shift Status: Displays current shift details.&#10;Navigation Controls&#10;  Left and right arrows move to the previous or next day.">${h(s.points)}</textarea></div>
      <div class="grid2">
        <div><label>Interaction (what happens on tap / click)</label><textarea data-f="interaction" rows="2" placeholder="e.g. Tapping the banner opens the Announcement section.">${h(s.interaction)}</textarea></div>
        <div><label>Table (optional) – cells separated by | · first line = header</label><textarea class="tblin" data-f="table" rows="2" placeholder="Color | Status | Meaning&#10;Green | In Office | Working on-site">${h(s.table)}</textarea></div>
      </div>
    </div>`;
  }
  function renderEditor() {
    const m = mod(), n = doc.modules.length;
    const bar = `<div class="mbar">
      <div class="seg" role="group" aria-label="View"><button type="button" data-act="edit" aria-pressed="${!preview}">Edit</button><button type="button" data-act="preview" aria-pressed="${preview}">Preview</button></div>
      <button type="button" class="primary" data-act="ai">✨ Draft with Gemini</button>
      <span class="sp"></span>
      <button type="button" class="icon" data-act="mleft" title="Move module left" aria-label="Move module left" ${cur ? '' : 'disabled'}>←</button>
      <button type="button" class="icon" data-act="mright" title="Move module right" aria-label="Move module right" ${cur < n - 1 ? '' : 'disabled'}>→</button>
      <button type="button" class="danger" data-act="mdel">Delete module</button>
    </div>`;
    if (preview) { ed.innerHTML = bar + `<div class="docprev">${toHTML(moduleBlocks(m)) || '<p class="empty">Nothing written yet.</p>'}</div>`; return; }
    ed.innerHTML = `<div class="grid2">
        <div><label>Module name (short – used as the tab / chapter name)</label><input data-m="name" value="${h(m.name)}" placeholder="e.g. Home Page"></div>
        <div><label>Document title (optional)</label><input data-m="title" value="${h(m.title)}" placeholder="e.g. Attendance Page Specification: My Attendance"></div>
      </div>
      <div style="margin-top:10px"><label>Overview</label><textarea data-m="overview" rows="3" placeholder="What this module is for and where the user reaches it.">${h(m.overview)}</textarea></div>
      ${bar}
      <div id="secList">${m.sections.length ? m.sections.map((s, i) => secHTML(s, i, m.sections.length)).join('') : '<p class="empty">No sections yet.</p>'}</div>
      <div class="row-btns"><button type="button" data-act="addsec">+ Add section</button></div>`;
  }
  const render = () => { cur = Math.max(0, Math.min(cur, doc.modules.length - 1)); renderTabs(); renderEditor(); };
  function fillDetails() { document.querySelectorAll('[data-d]').forEach(el => el.value = doc[el.dataset.d] || ''); }

  document.querySelectorAll('[data-d]').forEach(el => el.addEventListener('input', () => { doc[el.dataset.d] = el.value; save(); }));
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    if (b.dataset.tab === 'add') { doc.modules.push(blankModule()); cur = doc.modules.length - 1; touch(mod(), null, 'mcreate'); preview = false; save(); render(); ed.querySelector('[data-m=name]')?.select(); }
    else { cur = +b.dataset.tab; render(); }
  });
  ed.addEventListener('input', e => {
    const el = e.target, m = mod();
    if (el.dataset.m) { m[el.dataset.m] = el.value; touch(m, null, el.dataset.m === 'overview' ? 'overview' : 'medit'); if (el.dataset.m === 'name') { const t = tabs.children[cur]; t.textContent = el.value || 'Untitled'; t.title = el.value; } }
    else if (el.dataset.f) { const sec = m.sections[+el.closest('[data-s]').dataset.s]; sec[el.dataset.f] = el.value; touch(m, sec, 'sedit'); if (el.tagName === 'TEXTAREA') { el.style.height = 'auto'; el.style.height = el.scrollHeight + 2 + 'px'; } }
    save();
  });
  ed.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const m = mod(), act = b.dataset.act, si = b.closest('[data-s]') ? +b.closest('[data-s]').dataset.s : -1, S = m.sections;
    const swap = (a, i, j) => { [a[i], a[j]] = [a[j], a[i]]; };
    if (act === 'edit' || act === 'preview') { preview = act === 'preview'; return renderEditor(); }
    if (act === 'ai') return openAI();
    if (act === 'addsec') { S.push(blankSection()); touch(m, S[S.length - 1], 'screate'); save(); renderEditor(); const all = ed.querySelectorAll('.sec'); all[all.length - 1]?.querySelector('input').focus(); return; }
    if (act === 'up') swap(S, si, si - 1);
    else if (act === 'down') swap(S, si, si + 1);
    else if (act === 'dup') { S.splice(si + 1, 0, { ...S[si], id: uid() }); touch(m, S[si + 1], 'screate'); }
    else if (act === 'del') {
      const s = S[si];
      if ((s.heading || s.points || s.intro || s.table || s.interaction) && !confirm(`Delete section “${s.heading || 'Section ' + (si + 1)}”?`)) return;
      touch(m, s, 'sdel'); S.splice(si, 1);
    }
    else if (act === 'mleft') { swap(doc.modules, cur, cur - 1); cur--; }
    else if (act === 'mright') { swap(doc.modules, cur, cur + 1); cur++; }
    else if (act === 'mdel') {
      if (!confirm(`Delete the whole module “${m.name}”? This cannot be undone.`)) return;
      touch(m, null, 'mdelete'); doc.modules.splice(cur, 1); if (!doc.modules.length) doc.modules.push(blankModule('Home Page'));
    }
    save(); render();
  });
  // Points box: Tab / Shift+Tab indent or outdent the selected lines; Enter keeps the current indent
  ed.addEventListener('keydown', e => {
    const ta = e.target; if (!ta.classList?.contains('pts')) return;
    const v = ta.value, s = ta.selectionStart, en = ta.selectionEnd;
    const ls0 = v.lastIndexOf('\n', s - 1) + 1;
    if (e.key === 'Tab') {
      e.preventDefault();
      const le = v.indexOf('\n', Math.max(en - (en > s && v[en - 1] === '\n' ? 1 : 0), s)); const end = le < 0 ? v.length : le;
      const lines = v.slice(ls0, end).split('\n');
      const out = lines.map(l => e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : '  ' + l);
      const first = out[0].length - lines[0].length;
      ta.setRangeText(out.join('\n'), ls0, end, 'preserve');
      const total = out.join('\n').length - lines.join('\n').length;
      ta.setSelectionRange(Math.max(ls0, s + first), Math.max(ls0, en + total));
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (e.key === 'Enter' && !e.shiftKey && s === en) {
      const ind = v.slice(ls0).match(/^[ \t]*/)[0];
      if (!ind) return;
      e.preventDefault(); ta.setRangeText('\n' + ind, s, en, 'end'); ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });

  /* ---------- Gemini drafting ---------- */
  const dlg = $('aiDoc'); let shots = [];
  const SCHEMA = { type: 'ARRAY', items: { type: 'OBJECT', required: ['name', 'title', 'overview', 'sections'], properties: {
    name: { type: 'STRING' }, title: { type: 'STRING' }, overview: { type: 'STRING' },
    sections: { type: 'ARRAY', items: { type: 'OBJECT', required: ['heading', 'points'], properties: {
      heading: { type: 'STRING' }, intro: { type: 'STRING' }, interaction: { type: 'STRING' },
      points: { type: 'ARRAY', items: { type: 'OBJECT', required: ['text', 'level'], properties: { text: { type: 'STRING' }, level: { type: 'INTEGER' } } } },
      table: { type: 'ARRAY', items: { type: 'ARRAY', items: { type: 'STRING' } } },
    } } },
  } } };
  function renderThumbs() {
    $('aiThumbs').innerHTML = shots.map((s, i) => `<figure><img src="data:image/jpeg;base64,${s}" alt="Screenshot ${i + 1}"><button type="button" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">×</button></figure>`).join('');
  }
  async function shrink(file) { // → base64 JPEG, longest side ≤ 1400px, so the request stays small
    const img = await createImageBitmap(file), k = Math.min(1, 1400 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }
  $('aiShots').onchange = async e => {
    const files = [...e.target.files].filter(f => f.type.startsWith('image/')); e.target.value = '';
    for (const f of files) { if (shots.length >= 8) break; try { shots.push(await shrink(f)); } catch {} }
    renderThumbs();
  };
  $('aiThumbs').onclick = e => { const b = e.target.closest('[data-rm]'); if (b) { shots.splice(+b.dataset.rm, 1); renderThumbs(); } };
  function openAI() {
    const m = mod(), hasText = moduleBlocks(m).length > 1;
    dlg.querySelector(`input[name=aiMode][value=${hasText ? 'rewrite' : 'new'}]`).checked = true;
    $('aiDocMsg').textContent = ($('aiKey').value.trim() || aiKeyMem) ? 'Uses the Gemini key from ⚙ Settings.' : 'Add a Gemini key in ⚙ Settings first.';
    dlg.showModal(); $('aiNotes').focus();
  }
  $('aiDocClose').onclick = $('aiDocCancel').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  const fromAI = x => ({
    id: uid(), name: String(x.name || '').trim() || 'New module', title: String(x.title || '').trim(), overview: String(x.overview || '').trim(),
    sections: (x.sections || []).map(s => ({
      id: uid(), heading: String(s.heading || '').trim(), intro: String(s.intro || '').trim(), interaction: String(s.interaction || '').trim(),
      points: (s.points || []).map(p => '  '.repeat(Math.max(0, Math.min(5, +p.level || 0))) + String(p.text || '').trim()).filter(l => l.trim()).join('\n'),
      table: (Array.isArray(s.table) ? s.table : []).filter(r => Array.isArray(r) && r.some(c => String(c).trim())).map(r => r.map(c => String(c).replace(/\|/g, '/').trim()).join(' | ')).join('\n'),
    })),
  });
  $('aiDocGo').onclick = async () => {
    const notes = $('aiNotes').value.trim(), rewrite = dlg.querySelector('input[name=aiMode]:checked').value === 'rewrite', m = mod();
    if (!notes && !shots.length && !rewrite) { $('aiDocMsg').textContent = 'Write some notes or add a screenshot first.'; return; }
    const btn = $('aiDocGo'); setBusy(btn, true);
    $('aiDocMsg').textContent = 'Gemini is writing the documentation…'; $('status').textContent = 'Gemini is writing the documentation…';
    const app = doc.project.trim() || 'the application';
    const prompt = `You are a senior SQA (software quality assurance) engineer writing functional feature documentation for ${app}. The document is used by QA testers, developers and product owners to understand and test every screen.

Write ONLY in clear, professional English. If the notes are in Bangla, Banglish or mixed language, translate them – never output Bangla script.

STRUCTURE (one module = one screen or feature area, e.g. "Home Page", "Attendance", "Notification", "Leave Management"):
- name: short module name, 1–4 words, Title Case.
- title: document title, e.g. "${app} – Home Page Overview" or "Attendance Page Specification: My Attendance".
- overview: 1–3 sentences: what the module is for, who uses it and how the user reaches it.
- sections: in the order they appear on screen, top to bottom. One section per header, card, banner, tab, view, form, list or dialog.
  - heading: the UI element or area name, e.g. "Header & Real-Time Status Tracking", "Leave Balance Banner", "Day View", "3.1 Apply For Leave".
  - intro: optional single sentence describing the element (format, purpose). Empty string if not needed.
  - points: bullet points. level 0 = main point, level 1 = sub-point of the point above, level 2 = deeper. Prefer "Label: description" for features and metrics (e.g. "Date & Time Display: Shows the full current date and real-time clock."). Use plain short items for simple option lists (e.g. "All", "Pending", "Approved", "Rejected"). Group related sub-items under a label point such as "Navigation Controls", "Key Metrics Panel", "Sorting key", "Form fields". Include form fields, filters, statuses, validation rules, permissions (e.g. "Only admins / HR can act on this list"), empty and error states when they are known.
  - interaction: what happens on tap / click (navigation target, modal, filter, submit result). Empty string if none.
  - table: only for color codes, status legends or attribute lists; first row is the header; otherwise an empty array.
RULES: be faithful – document only what the notes or screenshots show or clearly imply; do not invent features, numbers or names. Fix spelling. No markdown symbols (no **, #, -) inside the text.
${rewrite ? `
TASK: Improve and complete the CURRENT MODULE below. Keep every fact it already contains, restructure it into the format above, and merge in the new notes / screenshots. Return exactly ONE module.

CURRENT MODULE:
${JSON.stringify({ name: m.name, title: m.title, overview: m.overview, sections: m.sections }, null, 1)}
` : `
TASK: Write the documentation. If the notes clearly cover several separate screens, return one module per screen; otherwise return ONE module.
`}
${notes ? 'NOTES:\n' + notes : 'No notes – use the screenshots.'}${shots.length ? `\n\n${shots.length} screenshot(s) of the app are attached; read every label, card, button and status on them.` : ''}

Return a JSON array of modules.`;
    try {
      const out = (await callGemini(prompt, SCHEMA, null, shots)).filter(x => x && typeof x === 'object').map(fromAI);
      if (!out.length) throw new Error('Gemini returned nothing. Add more detail and try again.');
      if (rewrite) {
        out[0].id = m.id; doc.modules[cur] = out[0]; doc.modules.splice(cur + 1, 0, ...out.slice(1));
        touch(out[0], null, 'ai'); out[0].sections.forEach(s => touch(out[0], s, 'sedit'));
        out.slice(1).forEach(x => { touch(x, null, 'mcreate'); touch(x, null, 'ai'); x.sections.forEach(s => touch(x, s, 'screate')); });
      }
      else {
        const blank = moduleBlocks(m).length === 1 && !m.sections.some(s => s.heading || s.points);
        doc.modules.splice(blank ? cur : cur + 1, blank ? 1 : 0, ...out); if (!blank) cur++;
        out.forEach(x => { touch(x, null, 'mcreate'); touch(x, null, 'ai'); x.sections.forEach(s => touch(x, s, 'screate')); });
      }
      preview = false; save(); render(); dlg.close();
      $('aiNotes').value = ''; shots = []; renderThumbs();
      const secs = out.reduce((a, x) => a + x.sections.length, 0);
      $('status').textContent = `Gemini wrote ${out.length} module${out.length > 1 ? 's' : ''} with ${secs} section${secs === 1 ? '' : 's'}. Please check it against the app.`;
    } catch (e) {
      $('aiDocMsg').textContent = e.message; $('status').textContent = e.message;
    } finally { setBusy(btn, false); }
  };

  /* ---------- Toolbar & file actions ---------- */
  const fileName = ext => ['SQA_Documentation', (doc.project || '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_'), doc.version && 'v' + doc.version.replace(/[^\w.]+/g, '')].filter(Boolean).join('_') + '.' + ext;
  const download = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  async function copyRich(blocks, what) {
    const html = `<meta charset="utf-8"><div style="font-family:Arial,sans-serif">${toHTML(blocks, true)}</div>`, md = toMarkdown(blocks);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })]);
    } catch {
      const box = document.createElement('div'); box.contentEditable = 'true'; box.innerHTML = html; box.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(box); const r = document.createRange(); r.selectNodeContents(box);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      const ok = document.execCommand('copy'); sel.removeAllRanges(); box.remove();
      if (!ok) { $('status').textContent = 'Copy was blocked by the browser. Use Download DOCX instead.'; return; }
    }
    $('status').textContent = `Copied ${what}. Paste it into Google Docs – headings, bullets and tables are kept.`;
  }
  $('dCopyMod').onclick = () => { touchShare('copy'); copyRich(docBlocks(cur), `“${mod().name}”`); };
  $('dCopyAll').onclick = () => { touchShare('copy'); copyRich(docBlocks(), 'the whole document'); };
  $('dDocx').onclick = () => {
    const name = fileName('docx'); touchShare('docx');
    download(new Blob([toDocx(docBlocks())], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name);
    $('status').textContent = 'Downloaded ' + name + ' – it opens in Word, and in Google Docs via File → Open.';
  };
  $('dPrint').onclick = () => { touchShare('print'); $('docPrint').innerHTML = `<div class="docprev">${toHTML(docBlocks())}</div>`; window.print(); };
  $('dExport').onclick = () => { const name = fileName('json'); download(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), name); $('status').textContent = 'Saved ' + name; };
  $('dImport').onclick = () => $('dImportFile').click();
  $('dImportFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d || !Array.isArray(d.modules)) throw 0;
      if (!confirm('Replace the document in this browser with “' + f.name + '”?')) return;
      doc = normalize(d); cur = 0; preview = false; ls.set(DKEY, JSON.stringify(doc)); fillDetails(); render();
      $('status').textContent = `Opened ${f.name} (${doc.modules.length} module${doc.modules.length > 1 ? 's' : ''}).`;
    } catch { $('status').textContent = f.name + ' is not an SQA documentation file.'; }
  };
  $('dNew').onclick = () => {
    if (!confirm('Start a new, empty document? The current one in this browser will be cleared – use “Save as JSON” first if you want to keep it.')) return;
    doc = blankDoc(); doc.author = $('empName').value.trim(); cur = 0; preview = false; ls.set(DKEY, JSON.stringify(doc)); fillDetails(); render();
    $('status').textContent = 'New document started.';
  };
  window.addEventListener('beforeprint', () => { if (document.body.classList.contains('docmode') && !$('docPrint').innerHTML) $('docPrint').innerHTML = `<div class="docprev">${toHTML(docBlocks())}</div>`; });
  window.addEventListener('afterprint', () => { $('docPrint').innerHTML = ''; });

  /* ---------- "⬇ Fetch SQA work": the day's documentation activity → daily report rows ---------- */
  const filled = s => s.heading.trim() && (s.points.trim() || s.table.trim());
  const list = (a, n = 6) => a.length > n ? a.slice(0, n).join(', ') + ` and ${a.length - n} more` : a.join(', ');
  function dayItems(day) {
    const d = act[day] || {}, items = [];
    for (const [mid, e] of Object.entries(d)) {
      if (mid === '_x' || e.deleted) continue;
      const m = doc.modules.find(x => x.id === mid);
      if (!m) continue;   // module no longer in this document
      const live = new Map(m.sections.map(s => [s.id, s]));
      const secs = Object.entries(e.secs || {}).filter(([id, x]) => !x.deleted && live.has(id)).map(([id, x]) => ({ s: live.get(id), new: x.new || e.created }));
      const head = s => s.heading.trim() || 'untitled section';
      const used = m.sections.filter(s => s.heading.trim() || s.points.trim() || s.intro.trim() || s.table.trim());
      const done = used.filter(filled), pending = used.filter(s => !filled(s)).map(head);
      const newSecs = secs.filter(x => x.new).map(x => head(x.s)), upd = secs.filter(x => !x.new).map(x => head(x.s));
      if (!newSecs.length && !upd.length && !e.created && !e.overview && !e.ai) continue;   // only renamed – nothing to report
      items.push({
        key: 'sqa:' + mid, module: m.name.trim() || 'Untitled', project: doc.project.trim(), newModule: !!e.created, aiDrafted: e.ai > 0,
        newSections: newSecs, updatedSections: upd, overviewWritten: !!e.overview && !!m.overview.trim(),
        sectionsComplete: done.length, sectionsTotal: used.length, pendingSections: pending,
        pct: used.length ? Math.round(done.length / used.length * 100) : 0,
      });
    }
    const x = d._x;
    if (x) {
      const how = [x.docx && 'downloaded as DOCX', x.copy && 'copied into Google Docs', x.print && 'printed / saved as PDF'].filter(Boolean);
      if (how.length) items.push({ key: 'sqa:share', share: true, project: doc.project.trim(), how, pct: 100 });
    }
    return items;
  }
  function plainRow(it) {
    const src = 'SQA Documentation' + (it.project ? ' – ' + it.project : '');
    if (it.share) return { task: 'Compiled and shared the SQA documentation', done: `Prepared the ${it.project || 'application'} feature documentation for the team (${it.how.join(', ')}).`, source: src };
    const parts = [];
    if (it.newSections.length) parts.push(`Documented ${it.newSections.length} new section${it.newSections.length > 1 ? 's' : ''} (${list(it.newSections)}).`);
    if (it.updatedSections.length) parts.push(`Updated ${it.updatedSections.length} section${it.updatedSections.length > 1 ? 's' : ''} (${list(it.updatedSections)}).`);
    if (it.overviewWritten) parts.push('Wrote the module overview.');
    if (it.aiDrafted) parts.push('Drafted with Gemini, then reviewed against the app.');
    return { task: `${it.newModule ? 'Created' : 'Updated'} SQA documentation – ${it.module} module`, done: parts.join(' ') || 'Reviewed and refined the module documentation.', source: src };
  }
  const remarkOf = it => it.share || !it.pendingSections.length ? 'Completed'
    : `In progress – ${it.sectionsComplete} of ${it.sectionsTotal} sections complete. Pending: ${list(it.pendingSections, 4)}.`;
  async function aiRows(items) {
    const prompt = `You prepare an SQA (software quality assurance) engineer's daily work report. It is read by HR and management, who are NOT technical.
Each input item is one piece of documentation work done today in the "${doc.project.trim() || 'application'}" feature documentation (a module = one screen or feature of the app; sections = parts of that screen), or a "share" item meaning the document was exported / shared.
For each item write:
- task: a short task title (max 12 words), e.g. "Documented the Leave Management module" or "Updated the Attendance module documentation".
- done: 1–2 professional sentences in past tense on what was documented and the concrete output (mention the main screen parts by name, how many sections). Plain business English; no jargon, no markdown, no quotes.
Stay faithful to the data – do not invent screens, numbers or results. Write in English only.
Return a JSON array with one object per input item, in the same order.

Input:
${JSON.stringify(items.map(({ key, pct, ...rest }) => rest), null, 1)}`;
    const out = await callGemini(prompt, { type: 'ARRAY', items: { type: 'OBJECT', required: ['task', 'done'], properties: { task: { type: 'STRING' }, done: { type: 'STRING' } } } });
    return items.map((it, i) => ({ ...plainRow(it), ...(out[i]?.task ? { task: String(out[i].task).trim() } : {}), ...(out[i]?.done ? { done: String(out[i].done).trim() } : {}) }));
  }
  $('sqaFetch').onclick = async () => {
    const btn = $('sqaFetch'), day = $('repDate').value || today();
    const items = dayItems(day);
    if (!items.length) {
      $('status').textContent = `No SQA documentation work recorded on ${fmtDay(day)}. Work in the SQA Documentation tab – it is tracked automatically in this browser.`;
      return;
    }
    setBusy(btn, true);
    let rows = items.map(plainRow), note = '';
    try {
      if ($('aiKey').value.trim() || aiKeyMem) {
        $('status').textContent = `Found ${items.length} piece${items.length > 1 ? 's' : ''} of SQA work – Gemini is writing the report rows…`;
        try { rows = await aiRows(items); note = 'ai'; } catch (e) { note = e.message; }
      }
      // Drop blank rows, then update rows fetched earlier (same module) or add new ones
      const val = (tr, f) => tr.querySelector(`[data-f=${f}]`).value.trim();
      [...tbody.children].filter(tr => !val(tr, 'task') && !val(tr, 'source') && !val(tr, 'done') && /^(completed)?$/i.test(val(tr, 'remarks'))).forEach(tr => tr.remove());
      let added = 0, updated = 0;
      items.forEach((it, i) => {
        const r = { ...rows[i], pct: String(it.pct), remarks: remarkOf(it), commits: [it.key] };
        const tr = [...tbody.children].find(t => t._commits.includes(it.key));
        if (tr) { ['task', 'source', 'done', 'pct', 'remarks'].forEach(f => tr.querySelector(`[data-f=${f}]`).value = r[f]); updated++; }
        else { addRow(r); added++; }
      });
      onChange();
      const what = [added && `added ${added}`, updated && `updated ${updated}`].filter(Boolean).join(' and ');
      $('status').textContent = `SQA work for ${fmtDay(day)}: ${what} row${added + updated > 1 ? 's' : ''}` + (note === 'ai' ? ' (written by Gemini). Please review before submitting.'
        : note ? `. Gemini could not rewrite them: ${note}` : '. Add a Gemini key in ⚙ Settings for plain-language rows.');
    } finally { setBusy(btn, false); }
  };

  /* ---------- Mode switch ---------- */
  const SUB = { report: $('docSub').textContent, docs: 'Feature documentation for the SQA team – write module by module, then copy to Google Docs or download as DOCX' };
  const TITLE = { report: 'DAILY TASK ASSIGNMENT & PERFORMANCE REPORT', docs: 'SQA FEATURE DOCUMENTATION' };
  const h2 = document.querySelector('header.doc h2');
  function setMode(m, quiet) {
    const docs = m === 'docs';
    document.body.classList.toggle('docmode', docs);
    $('modeReport').setAttribute('aria-selected', !docs); $('modeDocs').setAttribute('aria-selected', docs);
    h2.textContent = TITLE[m]; $('docSub').textContent = SUB[m];
    document.title = docs ? 'SQA Documentation' : 'Daily Task Report';
    ls.set(MKEY, m);
    if (docs && !doc.author && $('empName').value.trim()) { doc.author = $('empName').value.trim(); fillDetails(); save(); }
    if (history.replaceState) history.replaceState(null, '', docs ? '#docs' : location.pathname + location.search);
    if (!quiet) $('status').textContent = docs ? 'SQA documentation is saved automatically in this browser.' : 'Employee details are saved automatically in this browser.';
  }
  $('modeReport').onclick = () => setMode('report');
  $('modeDocs').onclick = () => setMode('docs');
  fillDetails(); render();
  setMode(location.hash === '#docs' ? 'docs' : location.hash === '#report' ? 'report' : (ls.get(MKEY) || 'report'), true);
  return { get doc() { return doc; }, docBlocks, toHTML, toMarkdown, toDocx };
})();
