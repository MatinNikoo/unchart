// Turning a recovered table into files: CSV, TSV, Markdown, LaTeX, pandas, R, JSON and XLSX.
// Also resampling a line onto a regular x grid and per series summary numbers. Runs in the browser and in node.
(function (root) {
  'use strict';
  // table: {xName, cols: [{name}], rows: [{x, vals: [number|null], errs?: [[lo, hi]|null]}]}
  // opts: {dec: digits, euro: true for 1.234,5 style, err: true to add a ± column per series}
  function fmtNum(v, o = {}) {
    if (v == null || !isFinite(v)) return '';
    let s = (+(+v).toFixed(o.dec != null ? o.dec : 6)).toString();
    if (/e/.test(s)) s = (+v).toPrecision(8);
    return o.euro ? s.replace('.', ',') : s;
  }
  // How many decimals an x column needs. Years that come out as 2020.333333 read as 2020.333, whole numbers stay whole.
  // Rounding never moves a value by more than 1% of the smallest gap between neighbouring x values.
  function xDigits(xs) {
    const v = [...new Set(xs.filter(x => typeof x === 'number' && isFinite(x)))].sort((a, b) => a - b);
    if (!v.length) return 0;
    let gap = Infinity;
    for (let i = 1; i < v.length; i++) gap = Math.min(gap, v[i] - v[i - 1]);
    const tol = Math.max(isFinite(gap) ? gap * 0.01 : 1e-4 * Math.max(1, Math.abs(v[0])), 1e-9);
    for (let d = 0; d <= 6; d++) { const m = Math.pow(10, d); if (v.every(x => Math.abs(x - Math.round(x * m) / m) <= tol)) return d; }
    return 6;
  }
  const roundX = (x, d) => +(+x).toFixed(d);
  function matrix(t, o = {}) {
    const head = [t.xName];
    t.cols.forEach(c => { head.push(c.name); if (o.err) head.push(c.name + ' ±'); });
    const rows = t.rows.map(r => {
      const out = [typeof r.x === 'number' ? fmtNum(r.x, Object.assign({}, o, { dec: 6 })) : String(r.x)];
      r.vals.forEach((v, j) => { out.push(fmtNum(v, o)); if (o.err) { const e = r.errs && r.errs[j]; out.push(e ? fmtNum(Math.max(e[0], e[1]), o) : ''); } });
      return out;
    });
    return { head, rows };
  }
  const quote = (s, sep) => (s.includes(sep) || /["\n]/.test(s)) ? '"' + s.replace(/"/g, '""') + '"' : s;
  // a text cell that starts like a formula would run as one when the file is opened in a spreadsheet, so it gets a
  // leading apostrophe. Real numbers, negative ones included, are left alone.
  const noFormula = s => (/^[=+\-@\t\r]/.test(s) && !isFinite(+String(s).replace(',', '.'))) ? "'" + s : s;
  function delimited(t, o = {}, sep = ',') {
    // European numbers use a comma, so their CSV uses semicolons like spreadsheets in those locales do
    if (sep === ',' && o.euro) sep = ';';
    const M = matrix(t, o);
    return [M.head, ...M.rows].map(r => r.map(c => quote(noFormula(c), sep)).join(sep)).join('\n');
  }
  function markdown(t, o = {}) {
    const M = matrix(t, o);
    return '| ' + M.head.join(' | ') + ' |\n|' + M.head.map((_, i) => i ? ' ---: |' : ' --- |').join('') + '\n' + M.rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
  }
  const TEX = { '\\': '\\textbackslash{}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}', '&': '\\&', '%': '\\%', '$': '\\$', '#': '\\#', '_': '\\_', '{': '\\{', '}': '\\}' };
  const tex = s => String(s).replace(/[\\~^&%$#_{}]/g, c => TEX[c]);
  function latex(t, o = {}) {
    const M = matrix(t, o);
    return ['\\begin{tabular}{l' + 'r'.repeat(M.head.length - 1) + '}', '\\toprule', M.head.map(tex).join(' & ') + ' \\\\', '\\midrule',
      ...M.rows.map(r => r.map(tex).join(' & ') + ' \\\\'), '\\bottomrule', '\\end{tabular}'].join('\n');
  }
  function code(t, lang, o = {}) {
    const M = matrix(t, Object.assign({}, o, { euro: false }));
    const cols = M.head.map((h, i) => ({ h, v: M.rows.map(r => r[i]) })), isNum = c => c.v.every(v => v === '' || isFinite(+v));
    const lit = (c, none) => isNum(c) ? c.v.map(v => v === '' ? none : v).join(', ') : c.v.map(v => JSON.stringify(v)).join(', ');
    if (lang === 'pandas') return 'import pandas as pd\n\ndf = pd.DataFrame({\n' + cols.map(c => `    ${JSON.stringify(c.h)}: [${lit(c, 'None')}],`).join('\n') + '\n})';
    return 'df <- data.frame(\n' + cols.map((c, i) => `  \`${c.h.replace(/`/g, '')}\` = c(${lit(c, 'NA')})` + (i < cols.length - 1 ? ',' : '')).join('\n') + ',\n  check.names = FALSE\n)';
  }

  // ---------- XLSX: a minimal workbook, stored without compression ----------
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  const utf8 = s => typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Uint8Array.from(Buffer.from(s, 'utf8'));
  function zip(files) {
    const parts = [], central = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const [name, text] of files) {
      const nb = utf8(name), data = utf8(text), crc = crc32(data);
      const head = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
      parts.push(Uint8Array.from(head), nb, data);
      central.push(Uint8Array.from([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
      off += head.length + nb.length + data.length;
    }
    const cl = central.reduce((a, b) => a + b.length, 0);
    const end = Uint8Array.from([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cl), ...u32(off), ...u16(0)]);
    const all = [...parts, ...central, end], out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
    let p = 0; for (const b of all) { out.set(b, p); p += b.length; }
    return out;
  }
  const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function colName(i) { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
  // Excel counts days from 1899-12-30
  const serial = iso => Date.parse(iso) / 864e5 + 25569;
  const NS_C = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const NS_CDR = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:cdr="http://schemas.openxmlformats.org/drawingml/2006/chartDrawing"';
  const hex6 = c => (/^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '').toUpperCase() : null);
  const SWATCH = ['1F4FD8', 'FF5A1F', '0E9F6E', '9B51E0', 'D61F69', 'B7791F', '0891B2', '4B5563'];
  const EMU = 9525, hpt = px => Math.max(100, Math.min(400000, Math.round(px * 75)));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const frac = v => Math.round(clamp(v, 0, 1) * 1e5) / 1e5;
  // ---- DrawingML pieces: fills, lines, effects and text, from the same sparse format objects the editor writes ----
  const clr = (c, tr) => `<a:srgbClr val="${hex6(c)}">${tr > 0 ? `<a:alpha val="${Math.round((100 - tr) * 1000)}"/>` : ''}</a:srgbClr>`;
  const PATT = { diag: 'wdUpDiag', diagb: 'wdDnDiag', horz: 'ltHorz', vert: 'ltVert', grid: 'smGrid', cross: 'diagCross', dots: 'pct20', dotsl: 'lgConfetti', check: 'smCheck', zig: 'zigZag', plus: 'trellis', brick: 'horzBrick' };
  const DASHX = { dash: 'dash', dot: 'sysDot', dashdot: 'dashDot', long: 'lgDash', longdot: 'lgDashDot' };
  function fillXml(F, base) {
    F = F || {}; const t = F.t || 'solid', c = hex6(F.c) || hex6(base), tr = +F.tr || 0;
    if (t === 'none' || !c) return '<a:noFill/>';
    if (t === 'grad') {
      const c2 = hex6(F.c2) || hex6(base) || c, mixed = !hex6(F.c2), tr2 = F.tr2 != null ? +F.tr2 : tr;
      const second = mixed ? lighten(c, 0.55) : c2;
      const path = F.k === 'radial' ? '<a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>' : `<a:lin ang="${Math.round(((+F.ang || 0) % 360) * 60000)}" scaled="0"/>`;
      return `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0">${clr(c, tr)}</a:gs><a:gs pos="100000">${clr(second, tr2)}</a:gs></a:gsLst>${path}</a:gradFill>`;
    }
    if (t === 'pat') return `<a:pattFill prst="${PATT[F.pat] || 'wdUpDiag'}"><a:fgClr>${clr(hex6(F.pc) || c, tr)}</a:fgClr><a:bgClr>${clr(hex6(F.pb) || 'FFFFFF', tr)}</a:bgClr></a:pattFill>`;
    return `<a:solidFill>${clr(c, tr)}</a:solidFill>`;
  }
  const lighten = (c, k) => { const n = parseInt(c, 16), ch = s => Math.round(((n >> s) & 255) * (1 - k) + 255 * k).toString(16).padStart(2, '0'); return (ch(16) + ch(8) + ch(0)).toUpperCase(); };
  // a line: the user's format wins, then the given color and width. width 0 means no line unless the user asked for one.
  function lnXml(L, baseC, baseW, extra) {
    L = L || {}; const c = hex6(L.c) || hex6(baseC), w = L.w != null && L.w !== '' && isFinite(+L.w) ? +L.w : (L.t === 'solid' ? Math.max(1, baseW || 1) : baseW || 0);
    if (L.t === 'none' || !c || !(w > 0)) return '<a:ln><a:noFill/></a:ln>';
    const d = DASHX[L.dash] ? `<a:prstDash val="${DASHX[L.dash]}"/>` : '<a:prstDash val="solid"/>';
    return `<a:ln w="${Math.round(w * EMU)}" cap="rnd"><a:solidFill>${clr(c, +L.tr || 0)}</a:solidFill>${d}<a:round/>${extra || ''}</a:ln>`;
  }
  function fxXml(f) {
    if (!f) return ''; let g = '', s = '', so = '';
    if (f.glow && f.glow.on) g = `<a:glow rad="${Math.round((+f.glow.r || 8) * EMU)}">${clr(f.glow.c || '#FFB020', +f.glow.tr || 60)}</a:glow>`;
    if (f.shadow && f.shadow.on) { const dx = +f.shadow.dx || 0, dy = f.shadow.dy != null && f.shadow.dy !== '' ? +f.shadow.dy : 3, d = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      s = `<a:outerShdw blurRad="${Math.round((f.shadow.blur != null && f.shadow.blur !== '' ? +f.shadow.blur : 6) * EMU)}" dist="${Math.round(d * EMU)}" dir="${Math.round(ang * 60000)}" algn="ctr" rotWithShape="0">${clr(f.shadow.c || '#000000', f.shadow.tr != null ? +f.shadow.tr : 70)}</a:outerShdw>`; }
    if (f.soft && f.soft.on) so = `<a:softEdge rad="${Math.round((+f.soft.r || 4) * EMU)}"/>`;
    return g || s || so ? `<a:effectLst>${g}${s}${so}</a:effectLst>` : '';
  }
  const spPr = (fill, ln, fx) => `<c:spPr>${fill || ''}${ln || ''}${fx || ''}</c:spPr>`;
  const rPr = (t, tag) => `<a:${tag} lang="en-US" sz="${hpt(t.size || 12)}" b="${(+t.wt || 400) >= 600 ? 1 : 0}" i="${t.it ? 1 : 0}"><a:solidFill>${clr(t.c || '#16161A')}</a:solidFill>${t.font ? `<a:latin typeface="${xml(t.font)}"/>` : ''}</a:${tag}>`;
  const txPr = (t, rot) => `<c:txPr><a:bodyPr${rot != null ? ` rot="${Math.round(rot * 60000)}" vert="horz"` : ''}/><a:lstStyle/><a:p><a:pPr>${rPr(t, 'defRPr').replace(' lang="en-US"', '')}</a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const richTitle = (paras, rot, layout) => `<c:title><c:tx><c:rich><a:bodyPr${rot ? ' rot="-5400000" vert="horz"' : ''}/><a:lstStyle/>${paras.map(p => `<a:p><a:pPr algn="${p.al || 'ctr'}">${rPr(p.t, 'defRPr').replace(' lang="en-US"', '')}</a:pPr><a:r>${rPr(p.t, 'rPr')}<a:t>${xml(p.s)}</a:t></a:r></a:p>`).join('')}</c:rich></c:tx>${layout || ''}<c:overlay val="0"/></c:title>`;
  const manual = (x, y, w, h, inner) => `<c:layout><c:manualLayout>${inner ? '<c:layoutTarget val="inner"/>' : ''}<c:xMode val="edge"/><c:yMode val="edge"/><c:x val="${frac(x)}"/><c:y val="${frac(y)}"/>${w != null ? `<c:w val="${frac(w)}"/><c:h val="${frac(h)}"/>` : ''}</c:manualLayout></c:layout>`;
  const MARK = { circle: 'circle', square: 'square', diamond: 'diamond', triangle: 'triangle', down: 'triangle', cross: 'plus', x: 'x', star: 'star', dash: 'dash', none: 'none' };
  const UNITS = { 100: 'hundreds', 1000: 'thousands', 10000: 'tenThousands', 100000: 'hundredThousands', 1000000: 'millions', 1e9: 'billions', 1e12: 'trillions' };
  const TICK = { none: 'none', out: 'out', in: 'in', cross: 'cross' };
  // a description written for the old options (a list of colors, kinds and axes per column) becomes the same shape the editor gives
  function fromLegacy(c, t) {
    const ser = t.cols.map((col, j) => ({ j, name: col.name, kind: (c.kinds || [])[j] || null, color: (c.colors || [])[j], axis: (c.axis || [])[j] || 'left', dl: c.labels ? { on: true, val: true } : null })).filter(s => !(c.hidden || []).includes(s.j));
    return { type: c.type, title: c.title, xTitle: c.xTitle, yTitle: c.yTitle, y2Title: c.y2Title, legend: c.legend === null || c.legend === 'none' ? null : { pos: c.legend || 'bottom', hide: [] }, ser,
      slices: (c.sliceColors || []).map((color, k) => ({ k, color })), dl: { on: c.labels !== false && (c.type === 'pie' || c.type === 'donut' || !!c.labels) }, log: c.log, yMin: c.yMin, yMax: c.yMax, ax: {}, gridMode: 'value', zero: false, bar: {}, ln: {}, ar: {}, pie: {}, tx: {} };
  }
  // chart: the description (see xlsxSpec in editor.js), or the older flat options
  function chartXml(t, o, cols, N, xKind) {
    const c = o.chart.ser ? o.chart : fromLegacy(o.chart, t), type = c.type || 'line', S = 'Unchart!', ref = (col, r0, r1) => `${S}$${col}$${r0}:$${col}$${r1}`;
    const colIdx = L => L.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const cells = L => t.__M.rows.map(r => r[colIdx(L)]);
    const numCache = (vs, fc) => `<c:numCache><c:formatCode>${xml(fc || 'General')}</c:formatCode><c:ptCount val="${vs.length}"/>${vs.map((v, i) => v === '' || v == null || !isFinite(+v) ? '' : `<c:pt idx="${i}"><c:v>${+v}</c:v></c:pt>`).join('')}</c:numCache>`;
    const strCache = vs => `<c:strCache><c:ptCount val="${vs.length}"/>${vs.map((v, i) => `<c:pt idx="${i}"><c:v>${xml(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
    const xs = cells('A'), xNums = xKind === 'date' ? xs.map(serial) : xs, nPts = N - 1;
    const catRef = xKind === 'str' ? `<c:cat><c:strRef><c:f>${ref('A', 2, N)}</c:f>${strCache(xs)}</c:strRef></c:cat>` : `<c:cat><c:numRef><c:f>${ref('A', 2, N)}</c:f>${numCache(xNums, xKind === 'date' ? 'yyyy-mm-dd' : 'General')}</c:numRef></c:cat>`;
    const th = c.th || { bg: '#FFFFFF', fg: '#16161A', grid: '#E3E3E8', axis: '#9A9AA2', muted: '#6B6B73' }, TX = c.tx || {};
    const tt = (k, size, col) => Object.assign({ size, wt: 400, c: col || th.fg }, TX[k]);
    const base = tt('legend', c.size || 12);
    const pie = type === 'pie' || type === 'donut', horiz = ['hbar', 'hstacked', 'hstacked100'].includes(type);
    const grouping = { stacked: 'stacked', hstacked: 'stacked', stackedArea: 'stacked', stacked100: 'percentStacked', hstacked100: 'percentStacked', stackedArea100: 'percentStacked' }[type] || 'standard';
    const many = nPts > 40, fs = c.size || 14, A = c.ax || {}, AY = A.y || {}, AX = A.x || {}, AY2 = A.y2 || {};
    const color = (s, j) => hex6(s.color) || SWATCH[j % 8];
    const head = L => t.__M.head[colIdx(L)];
    const tx = s => { const L = cols[s.j], h = head(L); return !s.name || s.name === h ? `<c:tx><c:strRef><c:f>${S}$${L}$1</c:f>${strCache([h])}</c:strRef></c:tx>` : `<c:tx><c:v>${xml(s.name)}</c:v></c:tx>`; };
    const val = s => `<c:val><c:numRef><c:f>${ref(cols[s.j], 2, N)}</c:f>${numCache(cells(cols[s.j]))}</c:numRef></c:val>`;
    const numFmt = (code, linked) => `<c:numFmt formatCode="${xml(code || 'General')}" sourceLinked="${linked ? 1 : 0}"/>`;
    const kindOf = s => s.kind === 'lolli' ? 'bar' : s.kind === 'dot' ? 'dot' : s.kind || (['bar', 'stacked', 'stacked100', 'hbar', 'hstacked', 'hstacked100', 'lollipop'].includes(type) ? 'bar' : ['area', 'stackedArea', 'stackedArea100'].includes(type) ? 'area' : 'line');
    // ---- data labels ----
    function dlXml(d, kind) {
      if (!d || !d.on) return '';
      const stacked = grouping !== 'standard' || kind === 'area';
      let pos = '';
      if (kind === 'bar') pos = { inEnd: 'inEnd', inBase: 'inBase', center: 'ctr', outEnd: 'outEnd', auto: stacked ? 'ctr' : 'outEnd' }[d.pos || 'auto'] || 'outEnd';
      else if (kind === 'line' || kind === 'dot') pos = { above: 't', below: 'b', left: 'l', right: 'r', center: 'ctr', auto: 't' }[d.pos || 'auto'] || 't';
      if (kind === 'bar' && stacked && pos === 'outEnd') pos = 'ctr';
      return dlGroup(d, pos, false);
    }
    function dlGroup(d, pos, isPie) {
      const lt = tt('label', Math.max(9, fs * 0.9)), box = c.labelF || {};
      const sv = isPie ? false : d.val !== false, sp = isPie && d.val !== false;
      const fc = d.fmt || (isPie ? '0.0%' : '');
      return `<c:dLbls>${fc ? numFmt(fc, false) : ''}${box.fill || box.line ? spPr(fillXml(box.fill || { t: 'none' }, th.bg), lnXml(box.line, th.axis, 0)) : ''}${txPr(lt)}${pos ? `<c:dLblPos val="${pos}"/>` : ''}<c:showLegendKey val="0"/><c:showVal val="${sv ? 1 : 0}"/><c:showCatName val="${d.cat ? 1 : 0}"/><c:showSerName val="${d.ser ? 1 : 0}"/><c:showPercent val="${sp ? 1 : 0}"/><c:showBubbleSize val="0"/>${d.sep && d.sep !== ', ' ? `<c:separator>${xml(d.sep)}</c:separator>` : ''}${isPie ? '<c:showLeaderLines val="1"/>' : ''}</c:dLbls>`;
    }
    // custom error bars from the reading error
    const errXml = (s, scatter) => {
      if (s.err == null || !t.__errs) return ''; const E = t.__errs[s.j]; if (!E) return '';
      const lit = k => `<c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${E.length}"/>${E.map((e, i) => e ? `<c:pt idx="${i}"><c:v>${+e[k]}</c:v></c:pt>` : '').join('')}</c:numLit>`;
      return `<c:errBars>${scatter ? '<c:errDir val="y"/>' : ''}<c:errBarType val="both"/><c:errValType val="cust"/><c:noEndCap val="0"/><c:plus>${lit(1)}</c:plus><c:minus>${lit(0)}</c:minus>${spPr('', lnXml({ c: c.ebc, w: c.ebw }, th.fg, 1.2))}</c:errBars>`;
    };
    // ---- the series ----
    const varyC = k => hex6((c.vary || [])[k]);
    function ptXml(s, kind) {
      const out = [], pts = Object.assign({}, s.dpts || {});
      (c.vary || []).forEach((v, k) => { if (v && pts[k] == null && kind === 'bar') pts[k] = { fill: { t: 'solid', c: v } }; });
      Object.keys(pts).map(Number).sort((a, b) => a - b).forEach(k => { if (k >= nPts) return; const f = pts[k] || {}, col = hex6(f.fill && f.fill.c) || varyC(k) || color(s, s.j);
        if (kind === 'bar') out.push(`<c:dPt><c:idx val="${k}"/><c:invertIfNegative val="0"/><c:bubble3D val="0"/>${spPr(fillXml(f.fill, col), lnXml(f.line, col, 0), fxXml(f))}</c:dPt>`);
        else if (kind === 'line' || kind === 'dot') out.push(`<c:dPt><c:idx val="${k}"/><c:marker><c:symbol val="${MARK[(s.marker || {}).shape] || 'circle'}"/><c:size val="${markSize(s)}"/>${spPr(fillXml(f.fill, col), lnXml(f.line, col, 0))}</c:marker><c:bubble3D val="0"/></c:dPt>`); });
      return out.join('');
    }
    const markSize = s => clamp(Math.round(((s.marker && s.marker.size) || (c.ln && c.ln.size) || Math.max(5, fs * 0.42)) * 0.75), 2, 72);
    function markerXml(s, forceOn) {
      const m = s.marker || {}, mode = m.mode || 'auto';
      if (mode === 'off' || (!forceOn && mode !== 'on' && many)) return '<c:marker><c:symbol val="none"/></c:marker>';
      const col = color(s, s.j), fillC = hex6(m.c) || col, lineC = hex6(m.lc) || col;
      return `<c:marker><c:symbol val="${MARK[m.shape] || 'circle'}"/><c:size val="${markSize(s)}"/>${spPr(m.hollow ? '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>' : fillXml({ t: 'solid', c: fillC }, col), lnXml({ c: lineC, w: m.lw || (m.hollow ? 1.5 : 0) }, lineC, 0))}</c:marker>`;
    }
    const lineW = s => (s.line && s.line.w != null && s.line.w !== '' ? +s.line.w : 0) || s.lw || (c.ln && c.ln.w) || Math.max(1.6, fs * 0.17);
    const lnSer = s => lnXml(Object.assign({ t: 'solid' }, s.line, { w: lineW(s), dash: (s.line && s.line.dash) || s.dash }), color(s, s.j), lineW(s));
    const areaTr = s => (s.fill && s.fill.tr != null ? +s.fill.tr : (c.ar && c.ar.tr != null ? +c.ar.tr : 82));
    function serXml(s, i, kind, errScatter) {
      const col = color(s, s.j), head = `<c:idx val="${i}"/><c:order val="${i}"/>${tx(s)}`, dl = dlXml(s.dl, kind), eb = errXml(s, errScatter);
      if (kind === 'bar') return `<c:ser>${head}${spPr(fillXml(s.fill, col), lnXml(s.line, col, 0), fxXml(s))}<c:invertIfNegative val="0"/>${ptXml(s, 'bar')}${dl}${eb}${catRef}${val(s)}</c:ser>`;
      if (kind === 'area') return `<c:ser>${head}${spPr(fillXml(Object.assign({ t: 'solid', tr: areaTr(s) }, s.fill), col), lnXml(Object.assign({ t: 'solid' }, s.line, { w: (s.line && s.line.w) || (grouping === 'standard' ? lineW(s) : 0) }), col, 0), fxXml(s))}${dl}${eb}${catRef}${val(s)}</c:ser>`;
      return `<c:ser>${head}${spPr('', lnSer(s), fxXml(s))}${markerXml(s)}${ptXml(s, 'line')}${dl}${eb}${catRef}${val(s)}<c:smooth val="${s.smooth ? 1 : 0}"/></c:ser>`;
    }
    // reference lines become extra series made of literals, so the sheet keeps only the data
    const refSeries = (c.refs || []).flatMap(r => {
      const mk = (v, label) => ({ v, label, line: Object.assign({ dash: 'dash' }, r.line), c: r.c });
      return r.kind === 'band' && r.v2 != null ? [mk(r.v, r.text ? r.text + ' (from)' : ''), mk(r.v2, r.text ? r.text + ' (to)' : '')] : [mk(r.v, r.text)];
    });
    const refXml = (ax, first) => refSeries.map((r, k) => `<c:ser><c:idx val="${first + k}"/><c:order val="${first + k}"/><c:tx><c:v>${xml(r.label || 'Reference')}</c:v></c:tx>${spPr('', lnXml(r.line, th.fg, 1.5))}<c:marker><c:symbol val="none"/></c:marker>${r.label ? `<c:dLbls><c:dLbl><c:idx val="${nPts - 1}"/>${txPr(tt('label', fs * 0.9))}<c:dLblPos val="t"/><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="1"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbl><c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>` : ''}${catRef}<c:val><c:numLit><c:formatCode>General</c:formatCode><c:ptCount val="${nPts}"/>${Array.from({ length: nPts }, (_, q) => `<c:pt idx="${q}"><c:v>${r.v}</c:v></c:pt>`).join('')}</c:numLit></c:val><c:smooth val="0"/></c:ser>`).join('');
    // ---- axes ----
    const allVals = []; (c.ser || []).forEach(s => cells(cols[s.j]).forEach(v => { if (v !== '' && isFinite(+v)) allVals.push(+v); }));
    const nonNeg = allVals.length > 0 && allVals.every(v => v >= 0);
    const scaling = (lo, hi, log, rev, base) => `<c:scaling>${log ? `<c:logBase val="${base || 10}"/>` : ''}<c:orientation val="${rev ? 'maxMin' : 'minMax'}"/>${hi != null ? `<c:max val="${hi}"/>` : ''}${lo != null ? `<c:min val="${lo}"/>` : ''}</c:scaling>`;
    const gl = (on, F, w) => on ? `<c:${w}>${spPr('', lnXml(F && F.line, th.grid, w === 'majorGridlines' ? 0.75 : 0.5))}</c:${w}>` : '';
    const gridOn = (a, axisName, def) => a.grid != null && a.grid !== '' ? !!a.grid : def;
    const showAx = a => a.show !== false;
    const catAx = (id, cross, pos, title, a, o2 = {}) => {
      const ticks = TICK[a.ticks] || 'out', rot = a.rot != null && a.rot !== 'auto' && isFinite(+a.rot) ? +a.rot : null, F = (c.axisF || {}).x || {};
      return `<c:catAx><c:axId val="${id}"/>${scaling(null, null, false, o2.rev)}<c:delete val="${o2.del || !showAx(a) ? 1 : 0}"/><c:axPos val="${pos}"/>${gl(gridOn(a, 'x', c.gridMode === 'both'), c.grid, 'majorGridlines')}${gl(!!a.mgrid, c.gridM, 'minorGridlines')}${title ? title : ''}${xKind === 'date' ? numFmt(a.fmt || 'yyyy-mm-dd', false) : a.fmt && xKind === 'num' ? numFmt(a.fmt, false) : numFmt('General', true)}<c:majorTickMark val="${ticks}"/><c:minorTickMark val="none"/><c:tickLblPos val="${o2.del ? 'none' : ({ none: 'none', low: 'low', high: 'high', next: 'nextTo' }[a.lab] || 'low')}"/>${spPr('', lnXml(F.line, th.axis, 1))}${txPr(tt(o2.tick || 'xTick', Math.max(9, fs * 0.9), th.muted), rot)}<c:crossAx val="${cross}"/>${o2.crossAt != null ? `<c:crossesAt val="${o2.crossAt}"/>` : '<c:crosses val="autoZero"/>'}<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/>${a.every > 1 ? `<c:tickLblSkip val="${Math.round(a.every)}"/>` : ''}<c:noMultiLvlLbl val="0"/></c:catAx>`;
    };
    const valAx = (id, cross, pos, title, a, o2 = {}) => {
      const lo = a.min != null && a.min !== '' ? +a.min : o2.lo, hi = a.max != null && a.max !== '' ? +a.max : o2.hi, log = !!(a.log || o2.log), F = (c.axisF || {})[o2.F || 'y'] || {};
      const zero = lo == null && !log && c.zero && nonNeg && !o2.noZero ? 0 : lo, unit = UNITS[+a.units];
      const side = a.side === 'right' && !o2.second;
      const crosses = o2.crosses || (side ? 'max' : 'autoZero');
      return `<c:valAx><c:axId val="${id}"/>${scaling(zero, hi, log, a.rev, a.base)}<c:delete val="${showAx(a) ? 0 : 1}"/><c:axPos val="${side ? 'r' : pos}"/>${gl(o2.grid !== false && gridOn(a, 'y', c.gridMode === 'value' || c.gridMode === 'both'), c.grid, 'majorGridlines')}${gl(!!a.mgrid && o2.grid !== false, c.gridM, 'minorGridlines')}${title || ''}${numFmt(a.fmt || (grouping === 'percentStacked' ? '0%' : 'General'), !a.fmt && grouping !== 'percentStacked')}<c:majorTickMark val="${TICK[a.ticks] || 'out'}"/><c:minorTickMark val="${TICK[a.mticks] || 'none'}"/><c:tickLblPos val="${a.lab === 'none' ? 'none' : 'nextTo'}"/>${spPr('', lnXml(F.line, th.axis, 1))}${txPr(tt(o2.tick || 'yTick', Math.max(9, fs * 0.9), th.muted))}<c:crossAx val="${cross}"/><c:crosses val="${crosses}"/><c:crossBetween val="${o2.mid ? 'midCat' : 'between'}"/>${a.major ? `<c:majorUnit val="${+a.major}"/>` : ''}${a.minor ? `<c:minorUnit val="${+a.minor}"/>` : ''}${unit ? `<c:dispUnits><c:builtInUnit val="${unit}"/>${a.unitLab ? '<c:dispUnitsLbl/>' : ''}</c:dispUnits>` : ''}</c:valAx>`;
    };
    const axTitle = (s, k, rot) => s ? richTitle([{ s, t: tt(k, fs, th.muted) }], rot) : '';
    const lim = { lo: c.yMin != null && c.yMin !== '' && isFinite(c.yMin) ? +c.yMin : null, hi: c.yMax != null && c.yMax !== '' && isFinite(c.yMax) ? +c.yMax : null, log: !!c.log };
    // the order series appear in, for the legend and the series numbers
    const vis = c.ser || [];
    let plot = '', axes = '', legendEntries = '';
    if (pie) {
      const s0 = vis[0] || { j: 0 }, j = s0.j, sl = c.slices || [];
      const slBy = k => sl.find(q => q.k === k) || {};
      const pts = Array.from({ length: nPts }, (_, k) => { const q = slBy(k), col = hex6(q.color) || SWATCH[k % 8]; return `<c:dPt><c:idx val="${k}"/><c:bubble3D val="0"/>${q.ex ? `<c:explosion val="${Math.round(q.ex)}"/>` : ''}${spPr(fillXml(q.fill, col), lnXml(Object.assign({ t: 'solid', w: 1.5 }, q.line), th.bg, 1.5))}</c:dPt>`; }).join('');
      const pp = c.pie || {}, lab = pp.lab || 'inside', ppos = lab === 'outside' ? 'outEnd' : lab === 'best' ? 'bestFit' : (type === 'donut' ? null : 'inEnd');
      const lbl = c.dl && c.dl.on ? dlGroup(c.dl, type === 'donut' ? null : ppos, true) : '';
      const ser = `<c:ser><c:idx val="0"/><c:order val="0"/>${tx(Object.assign({ name: null }, s0))}${pts}${lbl}${catRef}${val(s0)}</c:ser>`;
      plot = type === 'pie' ? `<c:pieChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="${Math.round((+pp.start || 0) % 360)}"/></c:pieChart>` : `<c:doughnutChart><c:varyColors val="1"/>${ser}<c:firstSliceAng val="${Math.round((+pp.start || 0) % 360)}"/><c:holeSize val="${clamp(Math.round(+pp.hole || 56), 10, 90)}"/></c:doughnutChart>`;
      legendEntries = (c.legend && c.legend.hide || []).map(k => `<c:legendEntry><c:idx val="${k}"/><c:delete val="1"/></c:legendEntry>`).join('');
    } else if (type === 'scatter') {
      const ser = vis.map((s, i) => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${tx(s)}${spPr('', '<a:ln w="19050"><a:noFill/></a:ln>', fxXml(s))}${markerXml(s, true)}${ptXml(s, 'dot')}${dlXml(s.dl, 'dot')}${errXml(s, true)}<c:xVal><c:numRef><c:f>${ref('A', 2, N)}</c:f>${numCache(xNums)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>${ref(cols[s.j], 2, N)}</c:f>${numCache(cells(cols[s.j]))}</c:numRef></c:yVal><c:smooth val="0"/></c:ser>`).join('');
      plot = `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${ser}<c:axId val="10"/><c:axId val="20"/></c:scatterChart>`;
      axes = valAx(10, 20, 'b', axTitle(c.xTitle, 'xTitle'), Object.assign({ grid: gridOn(AX, 'x', c.gridMode === 'both') }, AX), { grid: true, mid: true, tick: 'xTick', F: 'x', noZero: true }) + valAx(20, 10, 'l', axTitle(c.yTitle, 'yTitle', true), AY, Object.assign({ mid: true }, lim));
      legendEntries = (c.legend && c.legend.hide || []).map(k => { const i = vis.findIndex(s => s.j === k); return i >= 0 ? `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>` : ''; }).join('');
    } else {
      const right = vis.map(s => s.axis === 'right' && c.dual !== false);
      const idx = (kind, onRight) => vis.map((s, i) => [s, i]).filter(([s, i]) => kindOf(s) === kind && right[i] === onRight);
      const gapW = clamp(Math.round(type === 'lollipop' ? 500 : (c.bar && c.bar.gap != null ? +c.bar.gap : 40)), 0, 500), ovl = grouping === 'standard' ? clamp(Math.round((c.bar && +c.bar.overlap) || 0), -100, 100) : 100;
      const group = (kind, onRight, ax) => {
        const L = idx(kind, onRight); if (!L.length) return '';
        if (kind === 'bar') return `<c:barChart><c:barDir val="${horiz ? 'bar' : 'col'}"/><c:grouping val="${grouping === 'standard' ? 'clustered' : grouping}"/><c:varyColors val="0"/>${L.map(([s, i]) => serXml(s, i, 'bar')).join('')}<c:gapWidth val="${gapW}"/><c:overlap val="${ovl}"/><c:axId val="${ax[0]}"/><c:axId val="${ax[1]}"/></c:barChart>`;
        if (kind === 'area') return `<c:areaChart><c:grouping val="${grouping}"/><c:varyColors val="0"/>${L.map(([s, i]) => serXml(s, i, 'area')).join('')}<c:axId val="${ax[0]}"/><c:axId val="${ax[1]}"/></c:areaChart>`;
        return `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${L.map(([s, i]) => serXml(s, i, 'line')).join('')}${onRight ? '' : refXml('y', vis.length)}<c:marker val="1"/><c:axId val="${ax[0]}"/><c:axId val="${ax[1]}"/></c:lineChart>`;
      };
      plot = group('bar', false, [10, 20]) + group('area', false, [10, 20]) + group('line', false, [10, 20]);
      if (refSeries.length && !idx('line', false).length) plot += `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${refXml('y', vis.length)}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`;
      const catRev = !!AX.rev !== horiz;
      const xTitleX = horiz ? c.yTitle : c.xTitle, yTitleV = horiz ? c.xTitle : c.yTitle;
      const crossAt = typeof AY.cross === 'number' ? AY.cross : null;
      axes = catAx(10, 20, horiz ? 'l' : 'b', axTitle(xTitleX, horiz ? 'yTitle' : 'xTitle', horiz), AX, { rev: catRev, crossAt }) + valAx(20, 10, horiz ? 'b' : 'l', axTitle(yTitleV, horiz ? 'xTitle' : 'yTitle', !horiz), AY, Object.assign({ crosses: catRev && horiz && !AY.side ? 'max' : null }, lim));
      if (right.some(Boolean)) {
        plot += group('bar', true, [30, 40]) + group('area', true, [30, 40]) + group('line', true, [30, 40]);
        axes += catAx(30, 40, 'b', '', {}, { del: true }) + valAx(40, 30, 'r', axTitle(c.y2Title, 'y2Title', true), AY2, { grid: false, crosses: 'max', second: true, tick: 'y2Tick', F: 'y2' });
      }
      legendEntries = (c.legend && c.legend.hide || []).map(k => { const i = vis.findIndex(s => s.j === k); return i >= 0 ? `<c:legendEntry><c:idx val="${i}"/><c:delete val="1"/></c:legendEntry>` : ''; }).join('');
    }
    // ---- chart area, plot area, title and legend ----
    const W = c.W || 800, H = c.H || 450, P = c.plot, E = c.els || {};
    const plotLayout = pie ? (c.pieBox ? manual(c.pieBox[0] / W, c.pieBox[1] / H, (c.pieBox[2] - c.pieBox[0]) / W, (c.pieBox[3] - c.pieBox[1]) / H, true) : '<c:layout/>') : P ? manual(P.L / W, P.T / H, (P.R - P.L) / W, (P.B - P.T) / H, true) : '<c:layout/>';
    const plotF = c.plotF || {}, ch = c.chart || {};
    const plotSp = plotF.fill || plotF.line || plotF.shadow ? spPr(fillXml(plotF.fill || { t: 'none' }, th.bg), lnXml(plotF.line, th.axis, 0), fxXml(plotF)) : spPr('<a:noFill/>', '<a:ln><a:noFill/></a:ln>');
    const lg = c.legend, lpos = lg ? ({ top: 't', bottom: 'b', right: 'r', left: 'l', custom: 'r' }[lg.pos] || 't') : null;
    const lgF = (lg && lg.f) || {}, le = E.legend;
    const legend = lg && (vis.length > 1 || pie) ? `<c:legend><c:legendPos val="${lpos}"/>${legendEntries}${le && lg.pos === 'custom' ? manual(le[0] / W, le[1] / H, null, null, false) : ''}<c:overlay val="0"/>${lgF.fill || lgF.line ? spPr(fillXml(lgF.fill || { t: 'none' }, th.bg), lnXml(lgF.line, th.axis, 0)) : ''}${txPr(tt('legend', fs, th.fg))}</c:legend>` : '';
    const paras = []; if (c.title) paras.push({ s: c.title, t: tt('title', Math.round(fs * 1.45)), al: 'l' }); if (c.subtitle) paras.push({ s: c.subtitle, t: tt('subtitle', Math.round(fs * 1.05), th.muted), al: 'l' });
    const titleXml = paras.length ? richTitle(paras, false, E.title ? manual(E.title[0] / W, E.title[1] / H) : '') + '<c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>';
    const baseFont = { size: fs, wt: 400, c: th.fg, font: c.font };
    const area = spPr(fillXml(ch.fill || { t: 'solid', c: th.bg }, th.bg), lnXml(ch.line, th.axis, 0), fxXml(ch));
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace ${NS_C}><c:roundedCorners val="${+ch.rad > 0 ? 1 : 0}"/><c:chart>${titleXml}<c:plotArea>${plotLayout}${plot}${axes}${plotSp}</c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>${area}${txPr(baseFont)}${c.shapes ? '<c:userShapes r:id="rId1"/>' : ''}</c:chartSpace>`;
  }
  // text boxes, shapes and the source note, drawn over the chart in fractions of its size
  function shapesXml(c) {
    const W = c.W || 800, H = c.H || 450, th = c.th || { bg: '#FFFFFF', fg: '#16161A', axis: '#9A9AA2', muted: '#6B6B73' }, out = []; let id = 2;
    const anchor = (x0, y0, x1, y1, body) => `<cdr:relSizeAnchor><cdr:from><cdr:x>${frac(Math.min(x0, x1))}</cdr:x><cdr:y>${frac(Math.min(y0, y1))}</cdr:y></cdr:from><cdr:to><cdr:x>${frac(Math.max(x0, x1))}</cdr:x><cdr:y>${frac(Math.max(y0, y1))}</cdr:y></cdr:to>${body}</cdr:relSizeAnchor>`;
    const para = (s, t) => String(s).split('\n').map(l => `<a:p><a:pPr algn="l"/><a:r>${rPr(t, 'rPr')}<a:t>${xml(l)}</a:t></a:r></a:p>`).join('');
    const items = (c.ann || []).slice();
    if (c.note && c.els && c.els.note) items.push({ kind: 'text', text: c.note, box: c.els.note, f: {}, t: Object.assign({ size: Math.max(8, Math.round((c.size || 14) * 0.82)), wt: 400, c: th.muted }, (c.tx || {}).note), plain: true });
    items.forEach((a, n) => {
      const nm = `Shape ${n + 1}`, f = a.f || {}, b = a.box;
      if (a.kind === 'line' || a.kind === 'arrow') {
        const x0 = a.fx || 0, y0 = a.fy || 0, x1 = x0 + (a.fw || 0), y1 = y0 + (a.fh || 0), fl = (x1 < x0 ? ' flipH="1"' : '') + (y1 < y0 ? ' flipV="1"' : '');
        out.push(anchor(x0, y0, x1, y1, `<cdr:cxnSp macro=""><cdr:nvCxnSpPr><cdr:cNvPr id="${id++}" name="${nm}"/><cdr:cNvCxnSpPr/></cdr:nvCxnSpPr><cdr:spPr><a:xfrm${fl}><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lnXml(f.line, th.fg, 1.5, a.kind === 'arrow' ? '<a:tailEnd type="triangle"/>' : '')}</cdr:spPr></cdr:cxnSp>`));
        return;
      }
      const x0 = b ? b[0] / W : a.fx || 0, y0 = b ? b[1] / H : a.fy || 0, x1 = b ? b[2] / W : x0 + (a.fw || 0.2), y1 = b ? b[3] / H : y0 + (a.fh || 0.1);
      const geom = a.kind === 'ellipse' ? 'ellipse' : f.rad > 0 ? 'roundRect' : 'rect', hasText = a.text && a.kind !== 'rect' && a.kind !== 'ellipse' || (a.text && (a.kind === 'rect' || a.kind === 'ellipse'));
      const fillX = a.plain || a.kind === 'text' && !f.fill ? '<a:noFill/>' : fillXml(f.fill, a.kind === 'callout' ? th.bg : th.fg);
      const lnX = a.plain || a.kind === 'text' && !f.line ? '<a:ln><a:noFill/></a:ln>' : lnXml(f.line, a.kind === 'callout' ? th.axis : th.fg, a.kind === 'callout' ? 1 : 1.5);
      out.push(anchor(x0, y0, x1, y1, `<cdr:sp macro="" textlink=""><cdr:nvSpPr><cdr:cNvPr id="${id++}" name="${nm}"/><cdr:cNvSpPr${a.kind === 'text' || a.kind === 'callout' || a.plain ? ' txBox="1"' : ''}/></cdr:nvSpPr><cdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></a:xfrm><a:prstGeom prst="${geom}"><a:avLst/></a:prstGeom>${fillX}${lnX}${fxXml(f)}</cdr:spPr><cdr:txBody><a:bodyPr vertOverflow="overflow" wrap="square" lIns="45720" tIns="27432" rIns="45720" bIns="27432" rtlCol="0" anchor="${a.kind === 'rect' || a.kind === 'ellipse' ? 'ctr' : 't'}"/><a:lstStyle/>${hasText ? para(a.text, a.t || { size: 13, c: th.fg }) : '<a:p><a:endParaRPr lang="en-US"/></a:p>'}</cdr:txBody></cdr:sp>`));
    });
    return out.length ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:userShapes ${NS_CDR}>${out.join('')}</c:userShapes>` : '';
  }
  function xlsx(t, o = {}) {
    const M = matrix(t, Object.assign({}, o, { euro: false }));
    const dates = M.rows.length > 0 && M.rows.every(r => ISO.test(r[0]));
    const xKind = dates ? 'date' : M.rows.every(r => r[0] !== '' && isFinite(+r[0])) ? 'num' : 'str';
    const cell = (v, r, c) => {
      const ref = colName(c) + (r + 1);
      if (r === 0) return v === '' ? '' : `<c r="${ref}" s="2" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
      if (c === 0 && dates) return `<c r="${ref}" s="1"><v>${serial(v)}</v></c>`;
      if (v !== '' && isFinite(+v)) return `<c r="${ref}"><v>${+v}</v></c>`;
      return v === '' ? '' : `<c r="${ref}" t="inlineStr"><is><t>${xml(v)}</t></is></c>`;
    };
    const rows = [M.head, ...M.rows].map((r, i) => `<row r="${i + 1}">${r.map((v, c) => cell(v, i, c)).join('')}</row>`).join('');
    const widths = M.head.map((h, c) => Math.min(40, Math.max(10, h.length + 2, ...M.rows.slice(0, 200).map(r => String(r[c]).length + 2))));
    const colsXml = `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
    const chart = !!(o.chart && M.rows.length && t.cols.length);
    const errs = t.cols.map((_, j) => t.rows.map(r => r.errs && r.errs[j] ? [r.errs[j][0], r.errs[j][1]] : null)), shapes = chart && o.chart.ser ? shapesXml(o.chart) : '';
    if (chart && o.chart.ser) o = Object.assign({}, o, { chart: Object.assign({}, o.chart, { shapes: !!shapes }) });
    // the column letter that holds each series (every other column when the ± columns are included)
    const serCols = t.cols.map((_, j) => colName(1 + j * (o.err ? 2 : 1)));
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', CT = 'application/vnd.openxmlformats-officedocument';
    const files = [
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${CT}.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT}.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${CT}.spreadsheetml.styles+xml"/>${chart ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="${CT}.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="${CT}.drawingml.chart+xml"/>${shapes ? `<Override PartName="/xl/drawings/drawing2.xml" ContentType="${CT}.drawingml.chartshapes+xml"/>` : ''}` : ''}</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets><sheet name="Unchart" sheetId="1" r:id="rId1"/></sheets></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ['xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${colsXml}<sheetData>${rows}</sheetData>${chart ? '<drawing r:id="rId1"/>' : ''}</worksheet>`],
    ];
    if (chart) {
      const c0 = M.head.length + 1;
      files.push(['xl/worksheets/_rels/sheet1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`]);
      files.push(['xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${Math.round(((o.chart && o.chart.W) || 800) * 9525)}" cy="${Math.round(((o.chart && o.chart.H) || 450) * 9525)}"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="${xml(((o.chart && o.chart.title) || 'Chart').slice(0, 60))}" descr="${xml(((o.chart && o.chart.alt) || '').slice(0, 800))}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="${R}" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`]);
      files.push(['xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/chart" Target="../charts/chart1.xml"/></Relationships>`]);
      files.push(['xl/charts/chart1.xml', chartXml(Object.assign({}, t, { __M: M, __errs: errs.some(c => c.some(Boolean)) ? errs : null }), o, serCols, M.rows.length + 1, xKind)]);
      if (shapes) {
        files.push(['xl/charts/_rels/chart1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/chartUserShapes" Target="../drawings/drawing2.xml"/></Relationships>`]);
        files.push(['xl/drawings/drawing2.xml', shapes]);
      }
    }
    return zip(files);
  }

  // ---------- resampling a line onto an even x grid ----------
  // kind 'step' holds the last value, anything else interpolates in a straight line
  const isDateCol = xs => xs.length > 0 && xs.every(x => typeof x === 'string' && ISO.test(x));
  function resample(t, step, kind) {
    // dates are resampled in days and written back as dates
    if (isDateCol(t.rows.map(r => r.x))) {
      const day = s => Date.parse(s + 'T00:00:00Z') / 864e5, iso = d => new Date(Math.round(d) * 864e5).toISOString().slice(0, 10);
      const r = resample(Object.assign({}, t, { rows: t.rows.map(q => Object.assign({}, q, { x: day(q.x) })) }), step, kind);
      return r === t ? t : Object.assign({}, r, { rows: r.rows.map(q => Object.assign({}, q, { x: iso(q.x) })), resampledDays: true });
    }
    const xs = t.rows.map(r => r.x);
    if (!(step > 0) || !xs.every(x => typeof x === 'number')) return t;
    const lo = Math.min(...xs), hi = Math.max(...xs), n = Math.floor((hi - lo) / step + 1e-9);
    if (n > 5000) return t;
    const rows = [];
    for (let k = 0; k <= n; k++) {
      const x = +(lo + k * step).toFixed(9), vals = t.cols.map((_, j) => {
        const P = t.rows.filter(r => r.vals[j] != null && isFinite(r.vals[j])).map(r => [r.x, r.vals[j]]).sort((a, b) => a[0] - b[0]);
        if (!P.length || x < P[0][0] - 1e-9 || x > P[P.length - 1][0] + 1e-9) return null;
        let i = 0; while (i < P.length - 1 && P[i + 1][0] <= x) i++;
        if (kind === 'step' || i === P.length - 1 || P[i][0] === x) return P[i][1];
        const [x0, y0] = P[i], [x1, y1] = P[i + 1]; return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
      });
      rows.push({ x, vals });
    }
    return Object.assign({}, t, { rows, resampled: step });
  }


  // ---------- PDF: one page holding the chart as a Flate compressed image, sized in points ----------
  async function deflate(bytes) {
    if (typeof CompressionStream !== 'undefined') {
      const cs = new CompressionStream('deflate'), w = cs.writable.getWriter(); w.write(bytes); w.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    }
    return Uint8Array.from(require('zlib').deflateSync(Buffer.from(bytes)));
  }
  // px: {data: RGBA bytes, width, height}. The page is wpx by hpx CSS pixels (0.75 point each). title and alt go in the file info.
  async function pdf(px, wpx, hpx, bg, meta = {}) {
    const n = px.width * px.height, rgb = new Uint8Array(n * 3), d = px.data, B = [1, 3, 5].map(i => parseInt((/^#?[0-9a-f]{6}$/i.test(bg || '') ? bg.replace('#', '') : 'ffffff').slice(i - 1, i + 1), 16));
    for (let i = 0; i < n; i++) { const a = d[i * 4 + 3] / 255; for (let k = 0; k < 3; k++) rgb[i * 3 + k] = Math.round(d[i * 4 + k] * a + B[k] * (1 - a)); }
    const z = await deflate(rgb), w = +(wpx * 0.75).toFixed(2), h = +(hpx * 0.75).toFixed(2), enc = new TextEncoder();
    const str = s => '(' + s.replace(/[\\()]/g, '\\$&').replace(/[^\x20-\x7e]/g, '?') + ')';
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
    const parts = [], offs = []; let pos = 0;
    const put = b => { const u = typeof b === 'string' ? enc.encode(b) : b; parts.push(u); pos += u.length; };
    put('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    const obj = (i, body, stream) => { offs[i] = pos; put(`${i} 0 obj\n${body}\n`); if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); } put('endobj\n'); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
    obj(4, `<< /Type /XObject /Subtype /Image /Width ${px.width} /Height ${px.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${z.length} >>`, z);
    obj(5, `<< /Length ${content.length} >>`, content);
    obj(6, `<< /Title ${str(String(meta.title || 'Chart'))} /Creator ${str('Unchart')} >>`);
    const xref = pos;
    put(`xref\n0 7\n0000000000 65535 f \n${offs.slice(1).map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(pos); let p = 0; for (const b of parts) { out.set(b, p); p += b.length; }
    return out;
  }

  function stats(vals) {
    const v = vals.filter(x => x != null && isFinite(x)).sort((a, b) => a - b), n = v.length;
    if (!n) return null;
    const mean = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : 0;
    const med = n % 2 ? v[n >> 1] : (v[n / 2 - 1] + v[n / 2]) / 2;
    return { n, mean, median: med, sd, min: v[0], max: v[n - 1], sum: mean * n };
  }

  const api = { matrix, csv: (t, o) => delimited(t, o, ','), tsv: (t, o) => delimited(t, o, '\t'), markdown, latex, pandas: (t, o) => code(t, 'pandas', o), r: (t, o) => code(t, 'r', o), xlsx, zip, crc32, resample, isDateCol, stats, fmtNum, xDigits, roundX, pdf };
  root.UnchartExport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
