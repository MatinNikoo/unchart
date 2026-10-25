// The Unchart page: input, the stage with its overlay and editing tools, and the output tabs.
(function () {
'use strict';
const $ = id => document.getElementById(id);
const abs = p => new URL(p, location.href).href;
const PATHS = { workerPath: abs('vendor/worker.min.js'), corePath: abs('vendor/core/'), langFile: 'vendor/lang/eng.js', workerBlobURL: false, cacheMethod: 'none' };
// the PP-OCR reader for number and word labels (onnxruntime in the page, about 19 MB, fetched on the first read)
PATHS.pp = { ort: 'vendor/ort/ort.wasm.min.js', wasm: abs('vendor/ort/'), model: 'vendor/pp/en_PP-OCRv5_mobile_rec.onnx', dict: 'vendor/pp/ppocrv5_en_dict.txt' };
// the experimental mark model (src/seg.js, 3 MB, same onnxruntime). Off by default, see the Reading tab.
const SEG_PATHS = { ort: 'vendor/ort/ort.wasm.min.js', wasm: abs('vendor/ort/'), model: 'vendor/seg/unchart_marks.onnx' };
const E = window.UnchartExport;
// the confidence model is fit on the reads of the reader that uses it, so the mark model has its own file
const loadCalibration = on => fetch(on ? 'src/calibration_model.json' : 'src/calibration.json').then(r => r.ok ? r.json() : null).then(w => { if (w) Unchart.setCalibration(w); }).catch(() => {});
let calReady = loadCalibration(false);
const src = $('src'), ov = $('ov'), sel = $('sel');
const S = { canvas: null, img: null, words: null, res: null, crop: null, view: 'both', fmt: 'tsv', table: null, hl: -1, pdf: null, page: 1, fit: null, cross: null,
  type: 'auto', model: false, hist: [], fut: [], mode: '', pick: null, calib: [], quad: null, boxes: null, showErr: false, euro: false, step: null };
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const fmt = v => typeof v === 'number' ? Unchart.fmt(v) : v;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const TYPE_NAME = { bar: 'Bars', hbar: 'Bars', grouped_bar: 'Grouped bars', stacked_bar: 'Stacked bars', stacked_hbar: 'Stacked bars', line: 'Line', step: 'Steps',
  area: 'Area', stacked_area: 'Stacked area', scatter: 'Dots', pie: 'Pie', donut: 'Donut', histogram: 'Histogram', bar_line: 'Bars + line' };
const isPie = R => R && (R.chartType === 'pie' || R.chartType === 'donut');
const horiz = R => R && R.axis && R.axis.orient === 'h';

// ---------- loading ----------
function toCanvas(img) { const c = document.createElement('canvas'); c.width = img.naturalWidth || img.width; c.height = img.naturalHeight || img.height; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0); return c; }
function loadURL(u) { return new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(toCanvas(im)); im.onerror = no; im.src = u; }); }
const isPDF = b => b.type === 'application/pdf' || /\.pdf$/i.test(b.name || '');
async function loadBlob(b) { if (isPDF(b)) return loadPDF(b); const u = URL.createObjectURL(b); try { return await loadURL(u); } finally { URL.revokeObjectURL(u); } }
let pdfReady = null;
function pdfLib() { if (!pdfReady) pdfReady = new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'vendor/pdf.min.js'; s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = abs('vendor/pdf.worker.min.js'); ok(pdfjsLib); }; s.onerror = no; document.head.appendChild(s); }); return pdfReady; }
async function loadPDF(b) { const lib = await pdfLib(); S.pdf = await lib.getDocument({ data: await b.arrayBuffer() }).promise; S.page = 1; return renderPage(); }
async function renderPage() {
  const pg = await S.pdf.getPage(S.page), vp = pg.getViewport({ scale: 2 });
  const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await pg.render({ canvasContext: g, viewport: vp }).promise;
  return c;
}
function imgOf(c) { return c.getContext('2d').getImageData(0, 0, c.width, c.height); }

// ---------- stage ----------
function show(canvas, res) {
  S.canvas = canvas; S.crop = null; S.res = res; S.fit = null; S.pick = null; setMode('');
  src.width = ov.width = sel.width = canvas.width; src.height = ov.height = sel.height = canvas.height;
  src.getContext('2d').drawImage(canvas, 0, 0);
  sel.getContext('2d').clearRect(0, 0, sel.width, sel.height); $('cropgo').hidden = true;
  if (res) fitAxes(); drawOverlay(1); if (res) renderAll();
}
function waiting(msg) { setSteps({}); clearReadout(); $('errbox').innerHTML = `<div class="err"><b>${esc(msg)}</b>It reads as soon as you let go.</div>`; $('time').textContent = ''; }
function clearReadout() { $('table').innerHTML = ''; $('cards').innerHTML = ''; $('checks').innerHTML = ''; $('code').textContent = ''; ['sType', 'sSeries', 'sPoints', 'sRange', 'sConf'].forEach(i => $(i).textContent = '-'); $('honBadge').textContent = '-'; $('honBadge').className = 'badge ok'; syncEdit(); }
function fitAxes() {
  const R = S.res; S.fit = null; if (!R || !R.ok || isPie(R)) return;
  const v = R.calib.y && R.calib.y.length >= 2 ? Unchart.fitAxis(R.calib.y, { log: !!R.axis.yLog }) : null;
  const x = !R.axis.xDate && R.calib.x && R.calib.x.length >= 2 ? Unchart.fitAxis(R.calib.x) : null;
  S.fit = v ? { v, x, h: horiz(R) } : null;
}
const off = () => S.crop ? [S.crop.x, S.crop.y] : [0, 0];

function drawOverlay(t) {
  const g = ov.getContext('2d'); g.clearRect(0, 0, ov.width, ov.height);
  const R = S.res; src.className = S.view === 'rebuilt' ? 'dim' : '';
  if (!R || !R.ok || S.view === 'orig') return;
  const o = off(), k = Math.max(1, ov.width / 900), rect = R.rect;
  g.save(); g.translate(o[0], o[1]);
  g.beginPath(); g.rect(-o[0], -o[1], rect.left + (rect.right - rect.left + 40) * t + o[0], ov.height); g.clip();
  const sig = css('--signal');
  g.lineWidth = 1.2 * k; g.strokeStyle = sig; g.globalAlpha = .85;
  if (R.calib.axis === 'x') for (const q of R.calib.y || []) { g.beginPath(); g.moveTo(q.p, rect.bottom + 3); g.lineTo(q.p, rect.bottom - 9 * k); g.stroke(); }
  else {
    for (const q of R.calib.y || []) { g.beginPath(); g.moveTo(rect.left - 3, q.p); g.lineTo(rect.left + 9 * k, q.p); g.stroke(); }
    for (const q of R.calib.x || []) { g.beginPath(); g.moveTo(q.p, rect.bottom + 3); g.lineTo(q.p, rect.bottom - 9 * k); g.stroke(); }
  }
  g.globalAlpha = 1;
  if (S.cross && t >= 1) { g.save(); g.setLineDash([4 * k, 4 * k]); g.lineWidth = 1 * k; g.strokeStyle = 'rgba(20,20,20,.55)';
    g.beginPath(); g.moveTo(rect.left, S.cross[1]); g.lineTo(rect.right, S.cross[1]); g.moveTo(S.cross[0], rect.top); g.lineTo(S.cross[0], rect.bottom); g.stroke(); g.restore(); }
  if (isPie(R)) {
    const P = R.pie, s = R.series[0];
    g.strokeStyle = sig; g.lineWidth = 2.4 * k;
    g.beginPath(); g.arc(P.cx, P.cy, P.r, 0, 7); g.stroke(); if (P.hole) { g.beginPath(); g.arc(P.cx, P.cy, P.hole, 0, 7); g.stroke(); }
    s.points.forEach((p, i) => {
      const a = (p.deg0 - 90) * Math.PI / 180, m = (p.deg0 + p.deg / 2 - 90) * Math.PI / 180, r0 = P.hole || 0;
      g.beginPath(); g.moveTo(P.cx + r0 * Math.cos(a), P.cy + r0 * Math.sin(a)); g.lineTo(P.cx + P.r * Math.cos(a), P.cy + P.r * Math.sin(a)); g.stroke();
      const rr = (r0 + P.r) / 2; g.beginPath(); g.arc(P.cx + rr * Math.cos(m), P.cy + rr * Math.sin(m), (S.hl === i ? 9 : 5) * k, 0, 7); g.fillStyle = '#fff'; g.fill(); g.stroke();
    });
    g.restore(); return;
  }
  R.series.forEach((s, si) => {
    const P = s.points.filter(p => p.px != null && p.py != null);
    g.strokeStyle = sig; g.fillStyle = sig; g.lineWidth = 2.4 * k;
    if (s.type === 'line' || s.type === 'area' || s.type === 'step') {
      g.beginPath();
      P.forEach((p, i) => { if (!i) g.moveTo(p.px, p.py); else if (s.type === 'step') { g.lineTo(p.px, P[i - 1].py); g.lineTo(p.px, p.py); } else g.lineTo(p.px, p.py); });
      g.stroke();
      P.forEach(p => { g.beginPath(); g.rect(p.px - 3.4 * k, p.py - 3.4 * k, 6.8 * k, 6.8 * k); g.fillStyle = '#fff'; g.fill(); g.stroke(); });
    } else if (s.type === 'bar') {
      P.forEach(p => { if (p.empty || !p.box) return; const b = p.box; g.globalAlpha = .18; g.fillRect(b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1); g.globalAlpha = 1; g.strokeRect(b[0], b[1], b[2] - b[0] + 1, b[3] - b[1] + 1);
        g.beginPath(); g.lineWidth = 3 * k;
        if (horiz(R)) { g.moveTo(p.px, b[1] - 5 * k); g.lineTo(p.px, b[3] + 5 * k); } else { g.moveTo(b[0] - 5 * k, p.py); g.lineTo(b[2] + 5 * k, p.py); }
        g.stroke(); g.lineWidth = 2.4 * k; });
    } else {
      const r = Math.max(4, (s.size || 4) * .75) * k * .6 + 3; P.forEach(p => { g.beginPath(); g.arc(p.px, p.py, r, 0, 7); g.stroke(); });
    }
  });
  if (S.hl >= 0 && S.table) { const row = S.table.rows[S.hl]; if (row) for (const p of row.pts) { if (!p || p.px == null) continue; g.beginPath(); g.arc(p.px, p.py, 9 * k, 0, 7); g.lineWidth = 2 * k; g.strokeStyle = '#111'; g.stroke(); } }
  if (S.pick) { const p = pickPoint(); if (p && p.px != null) { g.beginPath(); g.arc(p.px, p.py, 12 * k, 0, 7); g.lineWidth = 2.5 * k; g.strokeStyle = sig; g.setLineDash([4 * k, 3 * k]); g.stroke(); g.setLineDash([]); } }
  g.restore();
}
function reveal() {
  const sc = $('scan'), t0 = performance.now(), D = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1000; sc.hidden = false;
  (function f() { const t = Math.min(1, (performance.now() - t0) / D), e = 1 - Math.pow(1 - t, 3); drawOverlay(e);
    const R = S.res; if (R && R.ok) { const o = S.crop ? S.crop.x : 0; sc.style.left = Math.min(100, (o + R.rect.left + (R.rect.right - R.rect.left + 40) * e) / ov.width * 100) + '%'; }
    if (t < 1) requestAnimationFrame(f); else sc.hidden = true; })();
}

// ---------- running ----------
function setSteps(st) { document.querySelectorAll('#pipe>div').forEach(el => { el.className = st[el.dataset.s] || ''; }); }
let firstRun = true;
async function run(canvas, crop) {
  $('extag').hidden = true;
  const c = crop ? (() => { const k = document.createElement('canvas'); k.width = crop.w; k.height = crop.h; k.getContext('2d').drawImage(canvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h); return k; })() : canvas;
  S.crop = crop || null; S.res = null; S.fit = null; S.pick = null; S.hist = []; S.fut = []; drawOverlay(0); $('errbox').innerHTML = '';
  const t0 = performance.now(); setSteps({ read: 'on' });
  $('time').textContent = firstRun ? 'Loading reader, first time only' : '';
  const sc = $('scan'); sc.hidden = false; const st = performance.now();
  (function tick() { if (sc.hidden) return; const x = (performance.now() - st) / 1300 % 1; sc.style.left = ((crop ? crop.x : 0) + x * c.width) / S.canvas.width * 100 + '%'; requestAnimationFrame(tick); })();
  let out;
  try { await calReady; out = await UnchartOCR.readChart(c, Object.assign({}, PATHS, S.model ? { seg: SEG_PATHS } : {}), { type: S.type }); } catch (e) { sc.hidden = true; setSteps({ read: 'bad' }); fail('The text reader could not start.', String(e.message || e)); return; }
  firstRun = false; sc.hidden = true;
  // a straightened picture replaces what is on the stage, so the overlay lines up with it
  if (out.angle) { show(out.canvas, null); toast(`Straightened a ${Math.abs(out.angle).toFixed(1)}° tilt first.`); }
  S.img = imgOf(out.canvas); S.words = out.words; S.seg = out.seg;
  const res = out.res, ms = performance.now() - t0;
  setSteps({ read: 'done', axes: 'on' }); await new Promise(r => setTimeout(r, 40));
  if (!res.ok) { setSteps({ read: 'done', axes: 'bad' }); fail(res.error, 'Pick the chart type above, use Fix axis to click two labeled ticks, or drag a tighter box around just the chart.'); syncEdit(); return; }
  S.res = res; fitAxes(); setSteps({ read: 'done', axes: 'done', trace: 'done', check: 'done' });
  $('time').textContent = `${(ms / 1000).toFixed(1)} s`;
  renderAll(); reveal();
}
// rerun only the measuring step with the words already read (type switch, manual axis)
function reextract(opts) {
  if (!S.img || !S.words) { toast('Open a chart first.'); return; }
  const res = Unchart.extract(S.img, S.words, Object.assign({ type: S.type, seg: S.seg }, opts || {}));
  if (!res.ok) { fail(res.error, 'Try another chart type, or Fix axis to set the scale by hand.'); return; }
  if (S.res) pushHistory();
  S.res = res; S.pick = null; $('errbox').innerHTML = ''; fitAxes(); setSteps({ read: 'done', axes: 'done', trace: 'done', check: 'done' });
  renderAll(); drawOverlay(1);
}
function fail(title, detail) { S.res = null; clearReadout(); $('errbox').innerHTML = `<div class="err"><b>${esc(title)}</b>${esc(detail || '')}</div>`; $('time').textContent = ''; drawOverlay(0); select('tData'); }

// ---------- history ----------
const snap = () => JSON.stringify(S.res);
function pushHistory() { if (!S.res) return; S.hist.push(snap()); if (S.hist.length > 100) S.hist.shift(); S.fut = []; syncEdit(); }
function restore(json) { S.res = JSON.parse(json); S.pick = null; fitAxes(); renderAll(); drawOverlay(1); syncEdit(); }
function undo() { if (!S.hist.length) return toast('Nothing to undo.'); S.fut.push(snap()); restore(S.hist.pop()); toast('Undone.'); }
function redo() { if (!S.fut.length) return toast('Nothing to redo.'); S.hist.push(snap()); restore(S.fut.pop()); toast('Redone.'); }

// ---------- readout ----------
function buildTable(R) {
  const series = R.series;
  if (isPie(R)) return { cols: [{ name: 'Share (%)', color: series[0].color }], rows: series[0].points.map(p => ({ x: p.x, vals: [p.y], errs: [p.err], pts: [p], px: p.deg0 })), xName: 'Slice', pie: true };
  const keys = new Map(); let dup = 0;
  series.forEach((s, si) => s.points.forEach(p => { const k = typeof p.x === 'number' ? +p.x.toFixed(6) : p.x;
    if (!keys.has(k)) keys.set(k, { x: k, vals: Array(series.length).fill(null), errs: Array(series.length).fill(null), pts: Array(series.length).fill(null), px: horiz(R) ? p.py : p.px });
    const r = keys.get(k); if (r.vals[si] == null && r.pts[si] == null) { r.vals[si] = p.y; r.errs[si] = p.err; r.pts[si] = p; }
    else keys.set('dup' + (dup++), { x: k, vals: series.map((_, j) => j === si ? p.y : null), errs: series.map((_, j) => j === si ? p.err : null), pts: series.map((_, j) => j === si ? p : null), px: horiz(R) ? p.py : p.px }); }));
  const scatter = series.every(s => s.type === 'scatter'), rows = [...keys.values()];
  rows.sort((a, b) => scatter ? (a.x - b.x) : (a.px - b.px));
  const xd = E.xDigits(rows.map(r => r.x)); rows.forEach(r => { if (typeof r.x === 'number') r.x = E.roundX(r.x, xd); });
  return { cols: series.map(s => ({ name: s.name, color: s.color, type: s.type, axis: s.axis || 'left' })), rows, xName: scatter || R.axis.xNumeric ? (R.axis.xDate ? 'Date' : 'x') : 'Category' };
}
function viewTable() {
  // what exports and the remake use: the table, resampled onto an even grid when asked
  const T = S.table; if (!T) return null;
  if (S.step && (T.rows.every(r => typeof r.x === 'number') || E.isDateCol(T.rows.map(r => r.x)))) return E.resample(T, S.step, S.res.series.some(s => s.type === 'step') ? 'step' : 'line');
  return T;
}
function renderAll() {
  const R = S.res; if (!R || !R.ok) return;
  S.table = buildTable(R);
  const span = isPie(R) ? 100 : Math.abs(R.axis.yRange[1] - R.axis.yRange[0]) || 1; S.span = span; S.dec = Math.max(0, Math.min(6, 2 - Math.floor(Math.log10(span))));
  $('sType').textContent = TYPE_NAME[R.chartType] || R.chartType;
  $('sSeries').textContent = isPie(R) ? 1 : R.series.length;
  $('sPoints').textContent = R.series.reduce((a, s) => a + s.points.filter(p => !p.empty).length, 0);
  if (isPie(R)) $('sRange').innerHTML = `0 to 100<small>%</small>`;
  else { const lv = (R.calib.y || []).map(q => q.v), lo = lv.length ? Math.min(...lv) : R.axis.yRange[0], hi = lv.length ? Math.max(...lv) : R.axis.yRange[1];
    $('sRange').innerHTML = `${esc(fmt(lo))} to ${esc(fmt(hi))}${R.axis.yPct ? '<small>%</small>' : ''}${R.axis.yLog ? '<small>log</small>' : ''}`; }
  $('sConf').innerHTML = `${Math.round((R.confidence || 0) * 100)}<small>%</small>`;
  $('sConf').parentNode.className = R.reliable ? '' : 'lowconf';
  $('errbox').innerHTML = R.reliable ? '' : `<div class="err"><b>I am not confident in this reading.</b>${esc((R.issues || []).map(i => i.text).join(' ') || 'The chart did not look clean enough to trust every number.')} Check the numbers against the chart, set the axis with Fix axis, or pick the chart type above.</div>`;
  $('stepRow').hidden = !(S.table.rows.length > 2 && (S.table.rows.every(r => typeof r.x === 'number') || E.isDateCol(S.table.rows.map(r => r.x))) && R.series.every(s => s.type !== 'scatter' && s.type !== 'bar'));
  src.setAttribute('aria-label', Unchart.describe(R));
  renderTable(); renderInsights(); renderChecks(); renderCode(); defaultRemake(); renderRemake(); syncEdit();
}
function numStr(v, dec) {
  if (v == null || !isFinite(v)) return '';
  if (Math.abs(v) < (S.span || 1) * 0.004 && dec == null) v = 0;
  const s = (+v.toFixed(dec != null ? dec : S.dec)).toString();
  return S.euro ? s.replace('.', ',') : s;
}
const errStr = e => e ? '±' + numStr(Math.max(e[0], e[1]), Math.min(6, S.dec + 1)) : '';
function renderTable() {
  const T = S.table, show = S.showErr;
  let h = `<thead><tr><th>${esc(T.xName)}</th>${T.cols.map((c, i) => `<th><span class="sw" style="background:${c.color}"></span><span contenteditable="${T.pie ? 'false' : 'true'}" spellcheck="false" data-col="${i}">${esc(c.name)}</span></th>${show ? '<th>±</th>' : ''}`).join('')}</tr></thead><tbody>`;
  T.rows.forEach((r, ri) => {
    h += `<tr data-r="${ri}"><td${T.pie ? ` contenteditable="true" spellcheck="false" data-name="${ri}"` : ''}>${esc(typeof r.x === 'number' ? numStr(r.x, 6) : r.x)}</td>${r.vals.map((v, ci) => `<td contenteditable="true" spellcheck="false" data-r="${ri}" data-c="${ci}"${r.pts[ci] && r.pts[ci].merged ? ' class="est" title="Overlapping dots, split by size"' : ''}>${numStr(v)}</td>${show ? `<td class="pm">${errStr(r.errs && r.errs[ci])}</td>` : ''}`).join('')}</tr>`;
  });
  $('table').innerHTML = h + '</tbody>';
}
let editing = false;
$('table').addEventListener('focusin', () => { editing = false; });
$('table').addEventListener('input', e => {
  const el = e.target;
  if (!editing) { pushHistory(); editing = true; }
  if (el.dataset.col != null) { const i = +el.dataset.col; S.table.cols[i].name = el.textContent.trim(); S.res.series[i].name = S.table.cols[i].name; renderInsights(); renderCode(); syncEdit(); return; }
  if (el.dataset.name != null) { const r = S.table.rows[+el.dataset.name]; r.x = el.textContent.trim(); r.pts[0].x = r.x; renderInsights(); renderCode(); return; }
  if (el.dataset.r != null) {
    const r = S.table.rows[+el.dataset.r], c = +el.dataset.c, t = el.textContent.trim().replace(/\s/g, '');
    const v = parseFloat(S.euro ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')); if (!isFinite(v)) return; r.vals[c] = v;
    const p = r.pts[c]; if (p) { p.y = v; if (S.fit) { const px = S.fit.v.toPixel(v); if (S.fit.h) p.px = px; else { p.py = px; if (p.box) p.box[1] = Math.min(p.py, p.box[3]); } } }
    drawOverlay(1); renderInsights(); renderCode(); renderRemake();
  }
});
$('table').addEventListener('mouseover', e => { const tr = e.target.closest('tr[data-r]'); setHL(tr ? +tr.dataset.r : -1, false); });
$('table').addEventListener('mouseleave', () => setHL(-1, false));
function setHL(i, scroll) {
  if (S.hl === i) return; S.hl = i; document.querySelectorAll('#table tr.hl').forEach(t => t.classList.remove('hl'));
  if (i >= 0) { const tr = document.querySelector(`#table tr[data-r="${i}"]`); if (tr) { tr.classList.add('hl'); if (scroll) { const box = tr.closest('.tablebox'); box.scrollTo({ top: tr.offsetTop - box.clientHeight / 2, behavior: 'smooth' }); } } }
  drawOverlay(1);
}
function renderInsights() {
  const R = S.res, cards = Unchart.insights(R), M = moments(), T = viewTable();
  const stats = T.cols.map((c, j) => ({ c, s: E.stats(T.rows.map(r => r.vals[j])) })).filter(q => q.s);
  const statCard = `<div class="card"><h4>Summary</h4><div class="tablebox"><table class="mini"><thead><tr><th>Series</th><th>n</th><th>Mean</th><th>Median</th><th>SD</th><th>Min</th><th>Max</th></tr></thead><tbody>${stats.map(({ c, s }) => `<tr><td>${esc(c.name)}</td><td>${s.n}</td><td>${numStr(s.mean)}</td><td>${numStr(s.median)}</td><td>${numStr(s.sd)}</td><td>${numStr(s.min)}</td><td>${numStr(s.max)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const desc = Unchart.describe(R);
  $('cards').innerHTML = (M.length ? `<div class="card"><h4>Moments</h4><dl class="kv">${M.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>` : '') +
    cards.map(c => `<div class="card"><h4><span class="sw" style="background:${c.color}"></span>${esc(c.series)}</h4><dl class="kv">${c.items.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>`).join('') + statCard +
    `<div class="card"><h4>Described in words</h4><p class="hint" id="altText">${esc(desc)}</p><div class="acts"><button class="btn" type="button" id="copyAlt">Copy as alt text</button></div></div>`;
  $('copyAlt').onclick = () => copy(desc, 'Copied. Paste it as the image alt text.');
}
const FIX_LABEL = { truncated: 'See it drawn honestly', pie_many: 'See it as sorted bars', pie_close: 'See it as sorted bars', dual: 'See both on one scale', area_base: 'Start the axis at zero', zoomed: 'Start the axis at zero' };
function renderChecks() {
  const R = S.res, F = R.flags || [], A = R.axis, hasBars = R.series.some(s => s.type === 'bar'), passes = [];
  if (isPie(R)) passes.push(['Shares add up', `The slices add up to ${numStr(R.series[0].points.reduce((a, p) => a + p.y, 0), 1)}%.`]);
  else {
    if (hasBars && !F.some(f => f.code === 'truncated')) passes.push(['Bars start at zero', 'So their lengths compare fairly.']);
    if (!A.yRight) passes.push(['One value axis', 'Every series is measured on the same scale.']);
    if (!A.yLog) passes.push(['Linear scale', 'Equal steps on the axis mean equal amounts.']);
    if (!F.some(f => f.code === 'uneven')) passes.push(['Even steps on x', 'The x labels are spaced to match their values.']);
  }
  const warn = F.filter(f => f.level === 'warn').length;
  $('honBadge').textContent = warn ? `${warn} ISSUE${warn > 1 ? 'S' : ''}` : 'OK'; $('honBadge').className = 'badge' + (warn ? '' : ' ok');
  $('checks').innerHTML = F.map(f => `<div class="check ${f.level}"><span class="dot">${f.level === 'warn' ? '!' : 'i'}</span><div><b>${esc(f.title)}</b><span>${esc(f.text)}</span>${FIX_LABEL[f.code] ? `<div class="fixbtn"><button class="btn go" type="button" data-fix="${f.code}">${FIX_LABEL[f.code]}</button></div>` : ''}</div></div>`).join('') +
    passes.map(([t, d]) => `<div class="check ok"><span class="dot">✓</span><div><b>${t}</b><span>${d}</span></div></div>`).join('') +
    '<p class="hint">Unchart cannot see 3D effects or pictures sized by area, so it does not check those.</p>';
}
$('checks').addEventListener('click', e => {
  const b = e.target.closest('[data-fix]'); if (!b) return; const code = b.dataset.fix, set = UnchartRemake.PRESETS.honest.set;
  const clearAxis = d => { if (d.ax && d.ax.y) { delete d.ax.y.min; delete d.ax.y.max; delete d.ax.y.log; } };
  if (code === 'truncated') {
    EDI.change(d => { Object.assign(d, set, { type: 'bar', index: false }); clearAxis(d); }); select('tRem');
    // drop the axis from where the original started down to zero, so you watch the gaps shrink to their real size
    const lv = (S.res.calib.y || []).map(q => q.v), from = lv.length ? Math.min(...lv) : 0, t0 = performance.now(), D = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 1400;
    (function f() { const t = Math.min(1, (performance.now() - t0) / D), e2 = t < .15 ? 0 : 1 - Math.pow(1 - (t - .15) / .85, 3), lo = from * (1 - e2);
      if (t < 1) { renderRemake({ yMin: lo, zero: false }); requestAnimationFrame(f); } else renderRemake(); })();
    return;
  }
  EDI.change(d => { Object.assign(d, set); clearAxis(d); if (code === 'dual') { d.index = true; d.type = 'line'; } if (code === 'pie_many' || code === 'pie_close') d.type = 'bar'; }); select('tRem');
});
function exportOpts() { return { dec: S.dec, euro: S.euro, err: $('exErr').checked }; }
// the native chart inside the XLSX follows the editor (src/editor.js builds the description)
const xlsxChart = () => EDI.xlsxSpec();
const xlsxOpts = () => Object.assign(exportOpts(), { chart: xlsxChart() });
function exportAs(f) {
  const T = viewTable(), o = exportOpts();
  if (f === 'json') { const xd = E.xDigits(S.res.series.flatMap(s => s.points.map(p => p.x))); return JSON.stringify({ chart: S.res.chartType, confidence: +(S.res.confidence || 0).toFixed(3), reliable: !!S.res.reliable,
    series: S.res.series.map(s => ({ name: s.name, type: s.type, points: s.points.filter(p => !p.empty || p.y === 0).map(p => Object.assign({ x: typeof p.x === 'number' ? E.roundX(p.x, xd) : p.x, y: +(+p.y).toFixed(S.dec + 1) }, o.err && p.err ? { err: +Math.max(p.err[0], p.err[1]).toPrecision(3) } : {})) })) }, null, 1); }
  if (f === 'xlsx') return '(XLSX is a spreadsheet file with the table and a chart you can restyle in Excel or Sheets. The chart follows the Remake settings. Use Download file.)\n\n' + E.tsv(T, o);
  return { tsv: E.tsv, csv: E.csv, md: E.markdown, latex: E.latex, pandas: E.pandas, r: E.r }[f](T, o);
}
function renderCode() { if (S.table) $('code').textContent = exportAs(S.fmt); }
document.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { S.fmt = b.dataset.f; document.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderCode(); });
$('exErr').onchange = () => renderCode();

// ---------- remake: the chart editor (src/editor.js) ----------
const RM = UnchartRemake;
const EDI = UnchartEditor.init({ $, S, E, getTable: viewTable, fmt, isPie, toast: m => toast(m), download: (d, t, n) => downloadBlob(d, t, n),
  downloadXlsx: () => $('dlXlsx').click(), copyData: () => $('copySheets').click() });
window.unchartEditor = EDI;   // handle for the tests and for scripting from the console
const defaultRemake = () => EDI.fresh(), renderRemake = extra => EDI.render(extra), syncEditor = () => EDI.sync();
$('rUndo').onclick = () => EDI.undo(); $('rRedo').onclick = () => EDI.redo();
$('rBig').onclick = () => { const on = !$('ed').classList.contains('big'); $('ed').classList.toggle('big', on); $('rBig').setAttribute('aria-pressed', on); $('rBig').textContent = on ? 'Close full screen' : 'Full screen'; document.body.style.overflow = on ? 'hidden' : ''; EDI.render(); };

// ---------- moments: crossings and the biggest moves ----------
function moments() {
  const T = viewTable(); if (!T || !T.rows.every(r => typeof r.x === 'number') || S.res.series.some(s => !['line', 'area', 'step'].includes(s.type))) return [];
  const out = [], rows = T.rows, k = T.cols.length, xs = v => S.res.axis.xDate ? new Date(v * 864e5).toISOString().slice(0, 10) : numStr(v, 6);
  for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) for (let i = 1; i < rows.length; i++) {
    const d0 = rows[i - 1].vals[a] - rows[i - 1].vals[b], d1 = rows[i].vals[a] - rows[i].vals[b];
    if (isFinite(d0) && isFinite(d1) && d0 * d1 < 0) { const up = d1 > 0 ? a : b, dn = d1 > 0 ? b : a; out.push(['Crossing', `${T.cols[up].name} moved above ${T.cols[dn].name} between ${xs(rows[i - 1].x)} and ${xs(rows[i].x)}`]); }
  }
  for (let c = 0; c < k; c++) { let best = null; for (let i = 1; i < rows.length; i++) { const v0 = rows[i - 1].vals[c], v1 = rows[i].vals[c]; if (v0 == null || v1 == null) continue; const d = v1 - v0; if (!best || Math.abs(d) > Math.abs(best.d)) best = { d, i, v0 }; }
    if (best) out.push(['Biggest move', `${T.cols[c].name} ${best.d >= 0 ? 'rose' : 'fell'} ${fmt(Math.abs(best.d))}${best.v0 ? ` (${(Math.abs(best.d / best.v0) * 100).toFixed(0)}%)` : ''} from ${xs(rows[best.i - 1].x)} to ${xs(rows[best.i].x)}`]); }
  return out.slice(0, 12);
}
// ---------- copy and download ----------
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => t.hidden = true, 1900); }
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); toast(label); }
  catch (e) { const pre = $('code'); pre.textContent = text; select('tExp'); const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Selected. Press Ctrl C or ⌘C.'); }
}
function download(href, name) { const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove(); toast('Saved ' + name); }
function downloadBlob(data, type, name) { const u = URL.createObjectURL(new Blob([data], { type })); download(u, name); setTimeout(() => URL.revokeObjectURL(u), 2000); }
const EXT = { tsv: ['tsv', 'text/tab-separated-values'], csv: ['csv', 'text/csv'], md: ['md', 'text/markdown'], latex: ['tex', 'text/x-tex'], pandas: ['py', 'text/x-python'], r: ['R', 'text/plain'], json: ['json', 'application/json'] };
$('copySheets').onclick = () => S.table && copy(E.tsv(viewTable(), exportOpts()), 'Copied. Paste into any sheet.');
$('copyCode').onclick = () => S.table && copy(S.fmt === 'xlsx' ? E.tsv(viewTable(), exportOpts()) : $('code').textContent, 'Copied');
$('dlCsv').onclick = () => S.table && downloadBlob(E.csv(viewTable(), exportOpts()), 'text/csv', 'unchart.csv');
$('dlXlsx').onclick = () => S.table && downloadBlob(E.xlsx(viewTable(), xlsxOpts()), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'unchart.xlsx');
$('dlFile').onclick = () => { if (!S.table) return; if (S.fmt === 'xlsx') return $('dlXlsx').click(); const [x, t] = EXT[S.fmt]; downloadBlob(exportAs(S.fmt), t, 'unchart.' + x); };
$('showErr').onchange = e => { S.showErr = e.target.checked; renderTable(); };
$('useModel').onchange = e => { S.model = e.target.checked; calReady = loadCalibration(S.model); if (S.canvas && S.res) { toast(S.model ? 'Reading again with the mark model.' : 'Reading again with the color rules.'); run(S.canvas, S.crop); } };
$('numStyle').onchange = e => { S.euro = e.target.value === 'eu'; renderTable(); renderInsights(); renderCode(); };
$('stepGo').onclick = () => { const v = parseFloat(String($('stepIn').value).replace(',', '.')); S.step = v > 0 ? v : null; renderInsights(); renderCode(); renderRemake(); toast(S.step ? `Resampled every ${fmt(S.step)}. Exports use the new grid.` : 'Showing the points as read.'); };

// ---------- tabs, views, examples ----------
const TABS = [['tData', 'pData'], ['tIns', 'pIns'], ['tRem', 'pRem'], ['tHon', 'pHon'], ['tExp', 'pExp']];
function select(id) { TABS.forEach(([t, p]) => { $(t).setAttribute('aria-selected', t === id); $(t).tabIndex = t === id ? 0 : -1; $(p).hidden = t !== id; }); if (id === 'tRem') requestAnimationFrame(() => EDI.sync()); }
TABS.forEach(([t]) => $(t).onclick = () => select(t));
$('tabs').addEventListener('keydown', e => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const i = TABS.findIndex(([t]) => $(t).getAttribute('aria-selected') === 'true');
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
  select(TABS[j][0]); $(TABS[j][0]).focus(); e.preventDefault();
});
[['vBoth', 'both'], ['vOrig', 'orig'], ['vRebuilt', 'rebuilt']].forEach(([id, v]) => $(id).onclick = () => { S.view = v; ['vBoth', 'vOrig', 'vRebuilt'].forEach(x => $(x).setAttribute('aria-pressed', x === id)); drawOverlay(1); });
async function example(f, animate) {
  document.querySelectorAll('[data-ex]').forEach(x => x.setAttribute('aria-pressed', x.dataset.ex === f));
  $('pdfnav').hidden = true; S.pdf = null; S.boxes = null; $('extag').hidden = false; $('errbox').innerHTML = '';
  S.type = 'auto'; $('rType').value = 'auto';
  const c = await loadURL('examples/' + f), R = JSON.parse(JSON.stringify(window.UNCHART_EXAMPLES[f]));
  S.img = imgOf(c); S.words = R.words; S.hist = []; S.fut = []; S.step = null;
  show(c, R); setSteps({ read: 'done', axes: 'done', trace: 'done', check: 'done' }); $('time').textContent = `${(R.ms / 1000).toFixed(1)} s`;
  if (f === 'ex_bars.png' && animate) select('tHon'); else if (animate) select('tData');
  if (animate) reveal();
}
document.querySelectorAll('[data-ex]').forEach(b => b.onclick = () => example(b.dataset.ex, true));
$('rType').onchange = e => { S.type = e.target.value; if (S.img && S.words) reextract(); };

// ---------- input ----------
async function take(blob) {
  document.querySelectorAll('[data-ex]').forEach(x => x.setAttribute('aria-pressed', 'false')); $('extag').hidden = true;
  if (!isPDF(blob)) { $('pdfnav').hidden = true; S.pdf = null; }
  let c; try { c = await loadBlob(blob); } catch (e) { fail('That file could not be opened.', 'Use a PNG, JPG, WebP or PDF.'); return; }
  if (c.width > 2400) { const k = 2400 / c.width, d = document.createElement('canvas'); d.width = 2400; d.height = Math.round(c.height * k); d.getContext('2d').drawImage(c, 0, 0, d.width, d.height); c = d; }
  $('box').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  S.step = null; await openPage(c);
}
// find the charts on a page (or in a screenshot of a dashboard) and read the first one
async function openPage(c) {
  show(c, null);
  const boxes = Unchart.findCharts(imgOf(c));
  const whole = boxes.length === 1 && boxes[0].w * boxes[0].h > c.width * c.height * 0.6;
  S.boxes = boxes.length >= 2 || (S.pdf && boxes.length) ? boxes : null;
  renderNav();
  if (S.boxes) return run(c, S.boxes[0]);
  if (S.pdf && !whole) return waiting('No chart found on this page. Drag a box around one.');
  run(c, null);
}
function renderNav() {
  const nav = $('pdfnav'), parts = [];
  if (S.pdf) parts.push(`Page ${S.page} of ${S.pdf.numPages} <button class="chip" type="button" id="pp">Previous</button> <button class="chip" type="button" id="pn">Next</button>`);
  if (S.boxes) parts.push(`${S.boxes.length} chart${S.boxes.length > 1 ? 's' : ''} found ` + S.boxes.map((b, i) => `<button class="chip" type="button" data-box="${i}" aria-pressed="${i === 0}">${i + 1}</button>`).join(' '));
  nav.hidden = !parts.length; nav.innerHTML = parts.join(' <span class="k">·</span> ');
  if (S.pdf) { $('pp').onclick = async () => { if (S.page > 1) { S.page--; await openPage(await renderPage()); } }; $('pn').onclick = async () => { if (S.page < S.pdf.numPages) { S.page++; await openPage(await renderPage()); } }; }
  nav.querySelectorAll('[data-box]').forEach(b => b.onclick = () => { nav.querySelectorAll('[data-box]').forEach(x => x.setAttribute('aria-pressed', x === b)); run(S.canvas, S.boxes[+b.dataset.box]); });
}
$('open').onclick = () => $('file').click();
$('file').onchange = e => { const f = e.target.files[0]; if (f) take(f); e.target.value = ''; };
document.addEventListener('paste', e => { const it = [...((e.clipboardData || {}).items || [])].find(i => i.type.startsWith('image/')); if (it) { e.preventDefault(); take(it.getAsFile()); } });
let dragN = 0;
document.addEventListener('dragenter', e => { if ([...e.dataTransfer.types].includes('Files')) { dragN++; $('drop').hidden = false; } });
document.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; $('drop').hidden = true; } });
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); dragN = 0; $('drop').hidden = true; const f = e.dataTransfer.files[0]; if (f) take(f); });

// ---------- editing tools ----------
function setMode(m) {
  if (!m) $('loupe').hidden = true;
  S.mode = m; S.calib = m === 'calib' ? [] : S.calib; $('calibform').hidden = true;
  document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
  sel.className = m ? 'tool' : '';
  if (m !== 'warp') { S.quad = null; if (S.canvas) sel.getContext('2d').clearRect(0, 0, sel.width, sel.height); $('cropgo').hidden = true; $('cropgo').textContent = 'Read this area'; }
  const tips = { add: 'Click on the chart to add a point to the series picked on the right.', calib: S.calib.length ? 'Now click a second labeled tick.' : 'Click a labeled tick on the value axis, then type its value.', warp: 'Drag the four corners onto the corners of the chart, then press Straighten and read.' };
  $('xy').textContent = tips[m] || 'Move over the chart to measure any point';
}
const pickPoint = () => { const R = S.res; if (!S.pick || !R) return null; const s = R.series[S.pick.si]; return s ? s.points[S.pick.pi] : null; };
function syncEdit() {
  const R = S.res, ok = R && R.ok && !isPie(R), p = pickPoint();
  $('delPt').disabled = !p; $('undo').disabled = !S.hist.length; $('redo').disabled = !S.fut.length;
  $('addPt').disabled = !ok || !S.fit;
  const ss = $('ptSeries');
  ss.innerHTML = ok ? R.series.map((s, i) => `<option value="${i}">${esc(s.name)}</option>`).join('') : '';
  ss.disabled = !ok;
  if (p) ss.value = String(S.pick.si);
  $('pickInfo').textContent = p ? `${R.series[S.pick.si].name}, ${typeof p.x === 'number' ? numStr(p.x, 4) : p.x}: ${numStr(p.y)}` : '';
}
$('ptSeries').onchange = e => {
  // with a point picked, move it to the chosen series; otherwise this picks the series new points go to
  const p = pickPoint(), to = +e.target.value, R = S.res; if (!p || to === S.pick.si) return;
  pushHistory();
  const from = R.series[S.pick.si]; from.points.splice(S.pick.pi, 1);
  const dst = R.series[to]; dst.points.push(p); dst.points.sort((a, b) => (horiz(R) ? a.py - b.py : a.px - b.px));
  S.pick = { si: to, pi: dst.points.indexOf(p) }; renderAll(); drawOverlay(1); toast(`Moved to ${dst.name}.`);
};
function deletePick() {
  const p = pickPoint(); if (!p) return; pushHistory();
  S.res.series[S.pick.si].points.splice(S.pick.pi, 1);
  if (!S.res.series[S.pick.si].points.length) S.res.series.splice(S.pick.si, 1);
  S.pick = null; renderAll(); drawOverlay(1); toast('Point deleted.');
}
$('delPt').onclick = deletePick;
$('undo').onclick = undo; $('redo').onclick = redo;
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  const m = b.dataset.mode;
  if (m === S.mode) return setMode('');
  if (m === 'warp') return startWarp();
  if (m === 'add' && S.res && S.res.series.every(s => s.type === 'bar')) return toast('Adding points works on line and dot charts. For bars, type the number in the table.');
  if (m === 'calib' && !S.canvas) return toast('Open a chart first.');
  setMode(m);
});
$('helpBtn').onclick = () => { $('help').hidden = !$('help').hidden; };
$('helpClose').onclick = () => { $('help').hidden = true; };
function addPointAt(lx, ly) {
  const R = S.res, F = S.fit; if (!R || !F) return;
  const si = +$('ptSeries').value || 0, s = R.series[si]; if (!s) return;
  const y = F.h ? F.v.toValue(lx) : F.v.toValue(ly);
  let x;
  if (R.axis.xNumeric && F.x) x = F.x.toValue(lx);
  else if (R.axis.xNumeric && R.axis.xDate) { const a = s.points.filter(p => p.xv != null); if (a.length >= 2) { const p0 = a[0], p1 = a[a.length - 1]; const xv = p0.xv + (p1.xv - p0.xv) * (lx - p0.px) / (p1.px - p0.px || 1); x = new Date(Math.round(xv) * 864e5).toISOString().slice(0, 10); } }
  if (x == null) { const near = s.points.reduce((b, p) => !b || Math.abs(p.px - lx) < Math.abs(b.px - lx) ? p : b, null); x = typeof (near && near.x) === 'number' || near == null ? Math.round(lx) : 'Point ' + (s.points.length + 1); }
  pushHistory();
  const p = { x, y, px: lx, py: ly, err: [Math.abs(F.v.slope) * 2, Math.abs(F.v.slope) * 2], added: true };
  s.points.push(p); s.points.sort((a, b) => a.px - b.px);
  S.pick = { si, pi: s.points.indexOf(p) }; renderAll(); drawOverlay(1);
}
// manual axis: two clicks on labeled ticks, each followed by its value
function calibClick(lx, ly, cx, cy) {
  const h = S.type === 'hbar' || S.type === 'stacked_hbar' || horiz(S.res);
  const f = $('calibform'); f.hidden = false;
  f.style.left = (cx / sel.width * 100) + '%'; f.style.top = (cy / sel.height * 100) + '%';
  $('calibIn').value = ''; $('calibIn').focus();
  S.calibPending = { p: h ? lx : ly, x: lx, y: ly, h };
  $('calibLab').textContent = `Value at this ${h ? 'x' : 'y'} tick`;
}
function calibSubmit() {
  const t = String($('calibIn').value).trim(), n = Unchart.parseNumber(S.euro ? t.replace(/\./g, '').replace(',', '.') : t);
  if (!n) { toast('Type the number printed at that tick.'); return; }
  const q = S.calibPending; S.calib.push({ p: q.p, v: n.v, x: q.x, y: q.y }); $('calibform').hidden = true;
  if (S.calib.length < 2) { setMode('calib'); $('xy').textContent = 'Now click a second labeled tick, far from the first.'; return; }
  const cal = S.calib.slice(), h = q.h, logAx = $('calibLog').checked;
  setMode('');
  if (Math.abs(cal[0].p - cal[1].p) < 8 || cal[0].v === cal[1].v) { toast('Pick two ticks further apart with different values.'); return; }
  reextract({ calib: h ? { axis: 'x', y: cal, yLog: logAx } : { y: cal, yLog: logAx } });
  if (S.res && S.res.ok) toast('Axis set by hand. Every value was measured again.');
}
$('calibOk').onclick = calibSubmit;
$('calibIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); calibSubmit(); } if (e.key === 'Escape') setMode(''); });
// perspective: four corner handles over the photo
function startWarp() {
  if (!S.canvas) return toast('Open a photo first.');
  setMode('warp');
  const img = imgOf(S.canvas), W = S.canvas.width, H = S.canvas.height;
  let q = Unchart.guessQuad(img);
  const area = Math.abs((q[1][0] - q[0][0]) * (q[3][1] - q[0][1]));
  if (area < W * H * 0.2) q = [[W * .06, H * .06], [W * .94, H * .06], [W * .94, H * .94], [W * .06, H * .94]];
  S.quad = q; drawQuad();
  const b = $('cropgo'); b.textContent = 'Straighten and read'; b.hidden = false; b.style.left = '50%'; b.style.top = '88%';
}
function drawQuad() {
  const g = sel.getContext('2d'), q = S.quad, k = Math.max(1, sel.width / 700); g.clearRect(0, 0, sel.width, sel.height);
  g.fillStyle = 'rgba(10,10,11,.45)'; g.fillRect(0, 0, sel.width, sel.height);
  g.save(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fill(); g.restore();
  g.strokeStyle = css('--signal'); g.lineWidth = 2 * k; g.beginPath(); q.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.stroke();
  q.forEach(p => { g.beginPath(); g.arc(p[0], p[1], 9 * k, 0, 7); g.fillStyle = '#fff'; g.fill(); g.stroke(); });
}
async function applyWarp() {
  const q = S.quad, out = Unchart.warp(imgOf(S.canvas), q);
  if (!out) return toast('Those corners do not make a usable shape.');
  const c = document.createElement('canvas'); c.width = out.width; c.height = out.height; c.getContext('2d').putImageData(new ImageData(out.data, out.width, out.height), 0, 0);
  setMode(''); S.boxes = null; $('pdfnav').hidden = true; show(c, null); run(c, null);
}

// ---------- pointer: measure, pick and drag points, add points, crop, corners ----------
let drag = null, pdrag = null, qdrag = -1;
const pos = e => { const r = sel.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * sel.width, (e.clientY - r.top) / r.height * sel.height]; };
function clearSel() { sel.getContext('2d').clearRect(0, 0, sel.width, sel.height); $('cropgo').hidden = true; }
function nearPoint(e) {
  const R = S.res; if (!R || !R.ok || isPie(R) || S.view === 'orig') return null;
  const [mx, my] = pos(e), o = off(); let best = null, bd = 1e9;
  R.series.forEach((s, si) => s.points.forEach((p, pi) => { if (p.empty || p.px == null) return; const d = Math.hypot(p.px + o[0] - mx, p.py + o[1] - my); if (d < bd) { bd = d; best = { si, pi, p }; } }));
  return bd <= Math.max(10, sel.width / 90) ? best : null;
}
sel.addEventListener('pointerdown', e => {
  if (!S.canvas) return;
  const [mx, my] = pos(e), o = off();
  if (S.mode === 'warp') { const k = Math.max(1, sel.width / 700); qdrag = S.quad.findIndex(p => Math.hypot(p[0] - mx, p[1] - my) < 18 * k); if (qdrag >= 0) sel.setPointerCapture(e.pointerId); return; }
  if (S.mode === 'calib') { calibClick(mx - o[0], my - o[1], mx, my); return; }
  if (S.mode === 'add') { addPointAt(mx - o[0], my - o[1]); return; }
  const np = nearPoint(e);
  if (np) { S.pick = { si: np.si, pi: np.pi }; pdrag = np; pdrag.moved = false; sel.setPointerCapture(e.pointerId); sel.className = 'grabbing'; $('tip').hidden = true; syncEdit(); drawOverlay(1); return; }
  if (S.pick) { S.pick = null; syncEdit(); drawOverlay(1); }
  drag = { a: pos(e), b: pos(e), moved: false }; sel.setPointerCapture(e.pointerId); $('cropgo').hidden = true;
});
// a magnifier next to the pointer while placing points, setting the axis, moving corners or dragging a point
function loupe(e) {
  const L = $('loupe'), on = e && S.canvas && (S.mode === 'add' || S.mode === 'calib' || S.mode === 'warp' || (pdrag && pdrag.moved));
  if (!on) { L.hidden = true; return; }
  const [mx, my] = pos(e), r = sel.getBoundingClientRect(), fr = sel.parentElement.getBoundingClientRect(), Z = 4, size = 132, src = $('src');
  const k = sel.width / r.width, half = size / 2 / Z * k;
  const g = L.getContext('2d'); L.width = L.height = size; g.imageSmoothingEnabled = false;
  g.fillStyle = '#111'; g.fillRect(0, 0, size, size);
  g.drawImage(src, mx - half, my - half, half * 2, half * 2, 0, 0, size, size);
  g.drawImage($('ov'), mx - half, my - half, half * 2, half * 2, 0, 0, size, size);
  g.strokeStyle = '#FF5A1F'; g.lineWidth = 1; g.beginPath(); g.moveTo(size / 2 + 0.5, 0); g.lineTo(size / 2 + 0.5, size / 2 - 6); g.moveTo(size / 2 + 0.5, size / 2 + 6); g.lineTo(size / 2 + 0.5, size);
  g.moveTo(0, size / 2 + 0.5); g.lineTo(size / 2 - 6, size / 2 + 0.5); g.moveTo(size / 2 + 6, size / 2 + 0.5); g.lineTo(size, size / 2 + 0.5); g.stroke();
  // above and to the right of the pointer, flipped when that would leave the picture
  let x = e.clientX - fr.left + 18, y = e.clientY - fr.top - size - 18;
  if (x + size > fr.width) x = e.clientX - fr.left - size - 18;
  if (y < 0) y = e.clientY - fr.top + 18;
  L.style.left = x + 'px'; L.style.top = y + 'px'; L.hidden = false;
}
sel.addEventListener('pointerleave', () => loupe(null));
sel.addEventListener('pointerup', () => requestAnimationFrame(() => { if (!S.mode) loupe(null); }));
sel.addEventListener('pointermove', e => {
  loupe(e);
  if (S.mode === 'warp') { if (qdrag >= 0) { S.quad[qdrag] = pos(e); drawQuad(); } return; }
  if (!pdrag) { if (!S.mode) sel.className = nearPoint(e) ? 'grab' : ''; return; }
  if (!S.fit) return;
  const o = off(), [mx, my] = pos(e), p = pdrag.p, R = S.res;
  if (!pdrag.moved) { pushHistory(); pdrag.moved = true; }
  if (S.fit.h) { const px = mx - o[0]; p.px = px; p.y = S.fit.v.toValue(px); if (p.box) p.box[2] = Math.max(px, p.box[0]); }
  else { const py = my - o[1]; p.py = py; p.y = S.fit.v.toValue(py); if (p.box) p.box[1] = Math.min(py, p.box[3]); }
  const ri = S.table.rows.findIndex(r => r.pts.includes(p)), ci = ri >= 0 ? S.table.rows[ri].pts.indexOf(p) : -1;
  if (ri >= 0) { S.table.rows[ri].vals[ci] = p.y; const td = document.querySelector(`#table td[data-r="${ri}"][data-c="${ci}"]`); if (td) td.textContent = numStr(p.y); setHL(ri, true); }
  $('xy').innerHTML = `<span class="xy">${esc(R.series[pdrag.si].name)} at ${esc(typeof p.x === 'number' ? numStr(p.x, 4) : p.x)} is now ${esc(numStr(p.y))}</span>`;
  drawOverlay(1); e.stopImmediatePropagation();
});
sel.addEventListener('pointerup', e => {
  if (S.mode === 'warp') { qdrag = -1; return; }
  if (!pdrag) return; const moved = pdrag.moved; pdrag = null; sel.className = 'grab';
  if (moved) { renderInsights(); renderCode(); renderRemake(); toast('Point moved. The table, reading and remake updated.'); }
  syncEdit(); e.stopImmediatePropagation();
});
sel.addEventListener('pointermove', e => {
  if (S.mode) return;
  if (drag) { drag.b = pos(e); const [x0, y0] = drag.a, [x1, y1] = drag.b; if (Math.hypot(x1 - x0, y1 - y0) > 8) drag.moved = true; if (!drag.moved) return;
    const g = sel.getContext('2d'); g.clearRect(0, 0, sel.width, sel.height); g.fillStyle = 'rgba(10,10,11,.55)'; g.fillRect(0, 0, sel.width, sel.height);
    g.clearRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); g.strokeStyle = css('--signal'); g.lineWidth = Math.max(1.5, sel.width / 600); g.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); return; }
  hover(e);
});
sel.addEventListener('pointerup', () => {
  if (!drag || S.mode) return; const { a: [x0, y0], b: [x1, y1], moved } = drag; drag = null; if (!moved) return;
  const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0); if (w < 40 || h < 40) { clearSel(); return; }
  S.pending = { x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(w), h: Math.round(h) };
  const b = $('cropgo'); b.hidden = false; b.style.left = ((S.pending.x + w / 2) / sel.width * 100) + '%'; b.style.top = ((S.pending.y + h) / sel.height * 100) + '%';
});
sel.addEventListener('pointerleave', () => { $('tip').hidden = true; S.cross = null; if (!drag && !S.mode) { setHL(-1, false); drawOverlay(1); $('xy').textContent = 'Move over the chart to measure any point'; } });
$('cropgo').onclick = () => { if (S.mode === 'warp') return applyWarp(); clearSel(); run(S.canvas, S.pending); };
function hover(e) {
  const T = S.table, R = S.res; if (!T || !R || !R.ok) return; const [mx, my] = pos(e), o = off();
  const lx = mx - o[0], ly = my - o[1], rc = R.rect;
  if (!isPie(R) && lx >= rc.left && lx <= rc.right && ly >= rc.top && ly <= rc.bottom && S.fit) {
    S.cross = [lx, ly];
    const v = S.fit.h ? S.fit.v.toValue(lx) : S.fit.v.toValue(ly), xv = !S.fit.h && S.fit.x ? S.fit.x.toValue(lx) : null;
    $('xy').innerHTML = `<span class="xy">${xv != null ? 'x ' + esc(fmt(xv)) + '  ' : ''}${S.fit.h ? 'value' : 'y'} ${esc(fmt(v))}</span>`;
  } else S.cross = null;
  let best = -1, bd = 1e9, bp = null, bc = 0;
  T.rows.forEach((r, i) => r.pts.forEach((p, c) => { if (!p || p.px == null) return; const d = Math.hypot(p.px + o[0] - mx, p.py + o[1] - my); if (d < bd) { bd = d; best = i; bp = p; bc = c; } }));
  const tip = $('tip');
  if (isPie(R)) {
    const P = R.pie, d = Math.hypot(lx - P.cx, ly - P.cy); let a = Math.atan2(ly - P.cy, lx - P.cx) * 180 / Math.PI + 90; if (a < 0) a += 360;
    const i = d <= P.r && d >= (P.hole || 0) ? R.series[0].points.findIndex(p => { let rel = a - p.deg0; if (rel < 0) rel += 360; return rel <= p.deg; }) : -1;
    if (i < 0) { tip.hidden = true; setHL(-1, false); return; }
    const p = R.series[0].points[i]; tip.hidden = false; tip.style.left = (mx / sel.width * 100) + '%'; tip.style.top = (my / sel.height * 100) + '%';
    tip.textContent = `${p.x}  →  ${numStr(p.y, 1)}%`; setHL(i, true); return;
  }
  if (best < 0 || bd > Math.max(14, sel.width / 40)) { tip.hidden = true; S.hl = -1; document.querySelectorAll('#table tr.hl').forEach(t => t.classList.remove('hl')); drawOverlay(1); return; }
  tip.hidden = false; tip.style.left = ((bp.px + o[0]) / sel.width * 100) + '%'; tip.style.top = ((bp.py + o[1]) / sel.height * 100) + '%';
  const r = T.rows[best]; tip.textContent = `${T.cols[bc].name}  ${typeof r.x === 'number' ? numStr(r.x, 4) : r.x}  →  ${numStr(r.vals[bc])}${bp.err ? '  ' + errStr(bp.err) : ''}`;
  setHL(best, true); drawOverlay(1);
}

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  const t = e.target, typing = t.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName);
  const mod = e.ctrlKey || e.metaKey;
  const inEd = !$('pRem').hidden;
  if (inEd && !typing && EDI.key(e)) return;
  if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
  if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); return redo(); }
  if (e.key === 'Escape' && $('ed').classList.contains('big')) return $('rBig').click();
  if (typing || mod || e.altKey) return;
  if (e.key === 'Escape') { setMode(''); clearSel(); S.pending = null; $('help').hidden = true; if (S.pick) { S.pick = null; syncEdit(); drawOverlay(1); } return; }
  if (e.key === '?') { $('help').hidden = !$('help').hidden; return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && S.pick) { e.preventDefault(); return deletePick(); }
  if (/^[1-5]$/.test(e.key)) { select(TABS[+e.key - 1][0]); return; }
  if (e.key === 'a') return document.querySelector('[data-mode="add"]').click();
  if (e.key === 'f') return document.querySelector('[data-mode="calib"]').click();
  if (e.key === 'c' && S.table) return copy(E.tsv(viewTable(), exportOpts()), 'Copied. Paste into any sheet.');
  if (S.pick && S.fit && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault(); const p = pickPoint(); if (!p) return;
    const step = e.shiftKey ? 10 : 1, d = (e.key === 'ArrowUp' || e.key === 'ArrowRight') ? 1 : -1;
    pushHistory();
    if (S.fit.h) { p.px += d * step; p.y = S.fit.v.toValue(p.px); } else { p.py -= d * step; p.y = S.fit.v.toValue(p.py); if (p.box) p.box[1] = Math.min(p.py, p.box[3]); }
    renderAll(); drawOverlay(1);
  }
});

select('tData');
example('ex_line.png', false);
})();
