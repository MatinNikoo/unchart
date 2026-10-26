// Tests for the file exports. The XLSX check opens the file with Python's openpyxl when it is installed.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path'), { execFileSync } = require('child_process');
const E = require('../src/export.js');

const T = { xName: 'Year', cols: [{ name: 'Sales, $' }, { name: 'Cost' }], rows: [{ x: 2020, vals: [1.5, 2] }, { x: 2021, vals: [2.25, null] }, { x: 2023, vals: [4, 3] }] };

test('csv quotes names and leaves gaps empty', () => {
  assert.strictEqual(E.csv(T), 'Year,"Sales, $",Cost\n2020,1.5,2\n2021,2.25,\n2023,4,3');
  assert.strictEqual(E.csv(T, { euro: true }).split('\n')[1], '2020;1,5;2');
});

test('x values that are years with a fraction get a sensible number of decimals', () => {
  const months = [2020, 2020 + 1 / 12, 2020 + 2 / 12, 2020 + 4 / 12].map(x => +x.toFixed(6));
  assert.strictEqual(E.xDigits(months), 3);
  assert.strictEqual(E.roundX(months[3], 3), 2020.333);
  assert.strictEqual(E.xDigits([2018, 2019, 2020]), 0);
  assert.strictEqual(E.xDigits([0.25, 0.5, 1]), 2);
  assert.strictEqual(E.xDigits([]), 0);
});

test('markdown and latex tables', () => {
  assert.ok(E.markdown(T).startsWith('| Year | Sales, $ | Cost |\n| --- | ---: | ---: |'));
  const tx = E.latex(T);
  assert.ok(tx.includes('Sales, \\$') && tx.includes('\\toprule') && tx.includes('2021 & 2.25 &  \\\\'));
});

test('pandas and R code', () => {
  assert.ok(E.pandas(T).includes('"Cost": [2, None, 3]'));
  assert.ok(E.r(T).includes('`Cost` = c(2, NA, 3)'));
});

test('resample a line onto an even grid', () => {
  const R = E.resample(T, 0.5);
  assert.strictEqual(R.rows.length, 7);
  assert.strictEqual(R.rows[1].vals[0], 1.875);
  assert.ok(Math.abs(R.rows[1].vals[1] - (2 + 0.5 / 3)) < 1e-12);   // Cost has no 2021 value, so it runs straight from 2020 to 2023
  assert.strictEqual(R.rows[4].vals[0], 3.125);                    // 2022 is halfway from 2021 to 2023
  const S = E.resample(T, 1, 'step');
  assert.deepStrictEqual(S.rows.map(r => r.vals[0]), [1.5, 2.25, 2.25, 4]);
  assert.deepStrictEqual(S.rows.map(r => r.vals[1]), [2, 2, 2, 3]);
});

test('summary numbers', () => {
  const s = E.stats([4, 1, 3, null, 2]);
  assert.deepStrictEqual([s.n, s.mean, s.median, s.min, s.max], [4, 2.5, 2.5, 1, 4]);
  assert.ok(Math.abs(s.sd - 1.2909944) < 1e-6);
});

test('crc32 matches the standard check value', () => {
  assert.strictEqual(E.crc32(Buffer.from('123456789')).toString(16), 'cbf43926');
});

test('xlsx opens in a spreadsheet library', (t) => {
  const f = path.join(os.tmpdir(), 'unchart_test_' + process.pid + '.xlsx');
  fs.writeFileSync(f, E.xlsx(T));
  let out;
  try { out = execFileSync('python3', ['-c', 'import sys,openpyxl;ws=openpyxl.load_workbook(sys.argv[1]).active;print([[c.value for c in r] for r in ws.iter_rows()])', f]).toString(); }
  catch (e) { t.skip('openpyxl not available'); return; }
  finally { fs.unlinkSync(f); }
  assert.strictEqual(out.trim(), "[['Year', 'Sales, $', 'Cost'], [2020, 1.5, 2], [2021, 2.25, None], [2023, 4, 3]]");
});

test('xlsx carries a native chart of each kind, and dates stay dates', (t) => {
  const D = { xName: 'Date', cols: [{ name: 'Sales' }, { name: 'Margin', axis: 'right' }], rows: [{ x: '2020-01-01', vals: [1, 0.1] }, { x: '2020-02-01', vals: [2, 0.2] }] };
  const kinds = { line: 'LineChart', stacked: 'BarChart', hbar: 'BarChart', area: 'AreaChart', scatter: 'ScatterChart', pie: 'PieChart', donut: 'DoughnutChart' };
  const f = path.join(os.tmpdir(), 'unchart_chart_' + process.pid + '.xlsx');
  for (const [type, cls] of Object.entries(kinds)) {
    fs.writeFileSync(f, E.xlsx(type === 'scatter' ? T : D, { chart: { type, title: 'T', axis: type === 'line' ? ['left', 'right'] : null } }));
    let out;
    try { out = execFileSync('python3', ['-c', "import sys,openpyxl;ws=openpyxl.load_workbook(sys.argv[1]).active;print(type(ws._charts[0]).__name__, ws['A2'].number_format)", f]).toString().trim(); }
    catch (e) { fs.unlinkSync(f); t.skip('openpyxl not available'); return; }
    assert.strictEqual(out.split(' ')[0], cls, type);
    if (type !== 'scatter') assert.strictEqual(out.split(' ')[1], 'yyyy-mm-dd');
  }
  fs.unlinkSync(f);
});

test('a date axis is resampled in days and stays dates', () => {
  const t = { cols: [{ name: 'a' }], rows: [{ x: '2020-01-01', vals: [1] }, { x: '2020-03-01', vals: [3] }] };
  const r = E.resample(t, 30, 'line');
  assert.deepStrictEqual(r.rows.map(q => q.x), ['2020-01-01', '2020-01-31', '2020-03-01']);
  assert.ok(Math.abs(r.rows[1].vals[0] - 2) < 1e-9);
  assert.ok(r.resampledDays);
});

test('pdf is a single page of the chart, with a valid cross reference table', async () => {
  const px = { width: 6, height: 3, data: new Uint8ClampedArray(6 * 3 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256)) };
  const b = Buffer.from(await E.pdf(px, 8, 4, '#ffffff'));
  const s = b.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4') && /%%EOF\s*$/.test(s));
  assert.ok(/\/MediaBox \[0 0 6 3\]/.test(s));
  // every offset in the xref points at its object
  const xs = /xref\n0 (\d+)\n([\s\S]*?)trailer/.exec(s);
  assert.ok(xs);
  const lines = xs[2].trim().split('\n').slice(1);
  lines.forEach((l, i) => { const off = parseInt(l.slice(0, 10), 10); assert.ok(s.slice(off).startsWith(`${i + 1} 0 obj`), `object ${i + 1} sits at its offset`); });
  assert.strictEqual(+/startxref\n(\d+)/.exec(s)[1], s.indexOf('xref\n0'));
});

test('xlsx chart follows an editor description: fills, dashes, axes, labels and shapes', (t) => {
  const D = { xName: 'Month', cols: [{ name: 'Sales' }, { name: 'Cost' }], rows: [1, 2, 3, 4].map(i => ({ x: 'M' + i, vals: [i * 10, i * 6] })) };
  const col = c => ({ t: 'solid', c });
  const spec = { type: 'bar', W: 800, H: 450, th: { bg: '#ffffff', fg: '#16161a', grid: '#e3e3e8', axis: '#9a9aa2', muted: '#5a5a62' }, font: 'Arial', size: 14, title: 'Sales and cost', subtitle: '', xTitle: 'Month', yTitle: 'Dollars', y2Title: '',
    tx: {}, els: {}, plot: { L: 60, T: 60, R: 780, B: 400 }, legend: { pos: 'bottom', hide: [] }, chart: { fill: col('#fffaf0') }, plotF: {}, grid: {}, gridM: {}, axisF: { x: {}, y: {}, y2: {} },
    ser: [{ j: 0, name: 'Sales', kind: 'bar', color: '#1f4fd8', fill: { t: 'grad', c: '#1f4fd8', c2: '#9bb4f5', ang: 90 }, line: { t: 'solid', c: '#102a80', w: 1.5, dash: 'dash' }, marker: { shape: 'circle', size: 0 }, axis: 'left', dl: { on: true, val: true, pos: 'outEnd' }, dpts: {} },
      { j: 1, name: 'Cost', kind: 'bar', color: '#ff5a1f', fill: { t: 'pat', pat: 'diag', c: '#ff5a1f' }, line: {}, marker: { shape: 'circle', size: 0 }, axis: 'left', dl: null, dpts: { 2: { fill: col('#00aa55') } } }],
    slices: [], bar: { gap: 40, overlap: 10 }, ln: {}, ar: {}, pie: {}, dl: { on: true }, gridMode: 'value', zero: true, ax: { x: {}, y: { min: 0, max: 100, major: 20, fmt: '$#,##0' }, y2: {} }, refs: [{ kind: 'line', v: 30, v2: null, text: 'Target', line: { c: '#cc0000', w: 2, dash: 'dash' }, c: '#cc0000' }],
    ann: [{ kind: 'text', text: 'Launch month', fx: 0.2, fy: 0.15, fw: 0.3, f: {}, t: { size: 13, wt: 400, c: '#16161a' }, box: [160, 70, 400, 100] }, { kind: 'rect', text: '', fx: 0.5, fy: 0.3, fw: 0.1, fh: 0.1, f: { fill: col('#ffe08a'), line: { t: 'solid', c: '#333333', w: 1 } }, t: {}, box: [400, 135, 480, 180] }],
    alt: 'Sales and cost by month', labelF: {}, eb: null };
  const f = path.join(os.tmpdir(), 'unchart_spec_' + process.pid + '.xlsx');
  fs.writeFileSync(f, E.xlsx(D, { chart: spec }));
  let out;
  try { out = JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'xlsx_check.py'), f]).toString()); }
  catch (e) { fs.unlinkSync(f); t.skip('openpyxl not available'); return; }
  fs.unlinkSync(f);
  const c = out.charts[0];
  assert.strictEqual(c.type, 'BarChart');
  assert.strictEqual(c.gapWidth, 40);
  assert.strictEqual(c.y_axis.min, 0); assert.strictEqual(c.y_axis.max, 100); assert.strictEqual(c.y_axis.major, 20);
  assert.ok(/\$/.test(c.y_axis.numFmt), 'value axis keeps the dollar format');
  assert.ok(out.xml.gradFill && out.xml.pattFill && out.xml.prstDash && out.xml.dLbls, 'gradient, pattern, dash and labels reach the XML');
  assert.ok(out.descr, 'alt text is stored on the drawing');
});

test('text that looks like a formula never runs as one in a spreadsheet', () => {
  const H = { xName: '=cmd', cols: [{ name: '+SUM(A1)' }, { name: '@x' }], rows: [{ x: '-label', vals: [-3.5, 2] }, { x: 'ok', vals: [1, -2] }] };
  const rows = E.csv(H).split('\n');
  assert.strictEqual(rows[0], "'=cmd,'+SUM(A1),'@x");
  assert.strictEqual(rows[1], "'-label,-3.5,2");
  assert.strictEqual(rows[2], 'ok,1,-2');
  assert.ok(E.tsv(H).startsWith("'=cmd\t"));
});

test('latex escapes backslashes so a label cannot run a command', () => {
  const L = E.latex({ xName: '\\input{x}', cols: [{ name: 'a_b' }], rows: [{ x: 'c', vals: [1] }] });
  assert.ok(L.includes('\\textbackslash{}input\\{x\\}'));
  assert.ok(!L.includes('\\input{x}'));
});
