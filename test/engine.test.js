// Unit tests for the engine. Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const U = require('../src/engine.js');
const R = require('./raster.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} got ${a}`);

test('parseNumber reads the label formats charts use', () => {
  const cases = [['4,500', 4500], ['$4,500', 4500], ['-$1,000', -1000], ['€12', 12], ['(3.5)', -3.5], ['12%', 12], ['1.5M', 1.5e6], ['300K', 3e5],
    ['2 billion t', 2e9], ['80 years', 80], ['0.25', 0.25], ['−20', -20], ['5bn', 5e9], ['1.2 million', 1.2e6], ['09', 0.9], ['1O0', 100]];
  for (const [t, v] of cases) near(U.parseNumber(t).v, v, 1e-9 * Math.max(1, Math.abs(v)), t);
  assert.strictEqual(U.parseNumber('12%').pct, true);
  for (const t of ['Q1 2016', 'Jan', 'North', '', 'abc12']) assert.strictEqual(U.parseNumber(t), null, t);
});

test('parseDateRow turns month, quarter and ISO labels into days', () => {
  const d = U.parseDateRow(['Jan 2020', 'Apr', 'Jul', 'Oct', 'Jan 2021']);
  assert.deepStrictEqual(d.days, [18262, 18353, 18444, 18536, 18628]);
  const q = U.parseDateRow(['Q3 2015', 'Q1 2016', 'Q3 2016']);
  assert.deepStrictEqual(q.days, [16617, 16801, 16983]);
  assert.strictEqual(U.parseDateRow(['2016', '2017', '2018']), null, 'plain years stay numeric');
  const iso = U.parseDateRow(['2020-01', '2020-07', '2021-01']);
  assert.deepStrictEqual(iso.days, [18262, 18444, 18628]);
  const ny = U.parseDateRow(['Feb 04', 'Feb 11', 'Feb 18']);
  assert.ok(ny.noYear);
  assert.strictEqual(ny.days[1] - ny.days[0], 7);
  // a year label in the middle carries to the months after it, and the months before it get the year before
  const mid = U.parseDateRow(['Oct', 'Nov', 'Dec', '2020', 'Feb']);
  assert.strictEqual(mid.days[3], 18262);
  assert.ok(mid.days[0] < mid.days[3] && mid.days[4] > mid.days[3]);
});

test('fitAxis fits a scale, ignores a misread label and finds log axes', () => {
  const pairs = [0, 10, 20, 30, 40].map((v, i) => ({ p: 400 - i * 80, v }));
  pairs.push({ p: 80, v: 90 });          // misread 40 -> 90 at a sixth spot
  const f = U.fitAxis(pairs);
  assert.strictEqual(f.inliers, 5);
  near(f.toValue(400), 0, 1e-9); near(f.toValue(240), 20, 1e-9); near(f.toPixel(30), 160, 1e-9);
  const lg = U.fitAxis([1, 10, 100, 1000].map((v, i) => ({ p: 300 - i * 90, v })));
  assert.ok(lg.log);
  near(lg.toValue(255), Math.sqrt(10), 1e-9);
  // the error band grows away from the labels and with pixel uncertainty
  const [a] = f.band(240, 0.5), [b] = f.band(240, 2);
  assert.ok(a > 0 && b > a);
});

test('fixSeparators reads comma decimals and dot thousands', () => {
  const euro = [{ text: '0,5', v: 5 }, { text: '1,0', v: 10 }, { text: '1,5', v: 15 }];
  assert.ok(U._fixSeparators(euro));
  assert.deepStrictEqual(euro.map(q => q.v), [0.5, 1, 1.5]);
  const dots = [{ text: '0', v: 0 }, { text: '2.000', v: 2 }, { text: '4.000', v: 4 }];
  U._fixSeparators(dots);
  assert.deepStrictEqual(dots.map(q => q.v), [0, 2000, 4000]);
  const us = [{ text: '1,000', v: 1000 }, { text: '2,000', v: 2000 }];
  assert.ok(!U._fixSeparators(us));
  assert.deepStrictEqual(us.map(q => q.v), [1000, 2000]);
});

test('fixPowers turns superscript powers of ten back into a log axis', () => {
  const col = ['105', '104', '103', '102'].map((t, i) => ({ text: t, v: +t, p: i * 50 }));
  assert.ok(U._fixPowers(col));
  assert.deepStrictEqual(col.map(q => q.v), [1e5, 1e4, 1e3, 1e2]);
  assert.ok(!U._fixPowers([{ text: '100', v: 100, p: 0 }, { text: '200', v: 200, p: 10 }, { text: '300', v: 300, p: 20 }]));
});

test('fixMissingMinus restores minus signs lost below zero', () => {
  const L = [20, 10, 0, 10, 20].map((v, i) => ({ p: i * 50, v }));
  const out = U._fixMissingMinus(L);
  assert.deepStrictEqual(out.map(q => q.v), [20, 10, 0, -10, -20]);
});

test('stepRuns finds flat runs', () => {
  const r = U._stepRuns([5, 5, 5, 5, 9, 9, 9, 9, 9, 2, 2, 2, 2], 0.5, 3);
  assert.deepStrictEqual(r.map(q => [q.i0, q.n, q.y]), [[0, 4, 5], [4, 5, 9], [9, 4, 2]]);
});

test('deskew finds a small rotation', () => {
  const img = R.blank(600, 400);
  R.rect(img, 60, 340, 540, 342, [0, 0, 0]);
  for (let k = 0; k < 6; k++) R.rect(img, 60, 40 + k * 60, 540, 40 + k * 60, [200, 200, 200]);
  R.rect(img, 60, 40, 61, 342, [0, 0, 0]);
  for (let k = 0; k < 8; k++) R.rect(img, 80 + k * 55, 200 + (k % 3) * 30, 110 + k * 55, 340, [40, 90, 200]);
  const rot = U.rotate(img, 2);
  const ds = U.deskew(rot);
  near(ds.angle, -2, 0.15, 'angle');
  const flat = U.deskew(img);
  assert.strictEqual(flat.angle, 0);
});

test('a bar chart drawn in memory reads back exactly', () => {
  const { img, words, truth } = R.barChart([12, 30, 25, 7, 18], { lo: 0, hi: 35, step: 5 });
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'bar');
  const ys = r.series[0].points.map(p => p.y);
  assert.strictEqual(ys.length, truth.length);
  ys.forEach((y, i) => near(y, truth[i], 0.15, 'bar ' + i));
  // every value has an error bar and the truth is inside it
  r.series[0].points.forEach((p, i) => assert.ok(Math.abs(p.y - truth[i]) <= Math.max(p.err[0], p.err[1]) + 1e-9));
  assert.ok(U.describe(r).startsWith('A bar chart'));
});

test('horizontal bars are read on their side', () => {
  const { img, words, truth } = R.hbarChart([40, 15, 28, 33], { lo: 0, hi: 50, step: 10 });
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'hbar');
  const P = r.series[0].points;
  assert.deepStrictEqual(P.map(p => p.x), ['Alpha', 'Beta', 'Gamma', 'Delta']);
  P.forEach((p, i) => near(p.y, truth[i], 0.3, 'hbar ' + i));
});

test('stacked bars give each segment its own value', () => {
  const S = [[10, 20, 15], [5, 8, 12]];
  const { img, words } = R.stackedChart(S, { lo: 0, hi: 40, step: 10 });
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'stacked_bar');
  const got = r.series.map(s => s.points.map(p => +p.y.toFixed(1))).sort((a, b) => a[0] - b[0]);
  [[5, 8, 12], [10, 20, 15]].forEach((row, j) => row.forEach((v, i) => near(got[j][i], v, 0.3)));
});

test('a line chart on a numeric x axis snaps to its data points', () => {
  const ys = [3, 7, 4, 9, 6, 8, 2];
  const { img, words } = R.lineChart(ys, { lo: 0, hi: 10, step: 2 });
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'line');
  const P = r.series[0].points;
  assert.strictEqual(P.length, ys.length);
  P.forEach((p, i) => { near(p.x, i, 1e-6); near(p.y, ys[i], 0.12); });
});

test('a pie reads back its shares', () => {
  const shares = [40, 25, 20, 15];
  const { img, words } = R.pieChart(shares, false);
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'pie');
  const got = r.series[0].points.map(p => p.y);
  assert.strictEqual(got.length, 4);
  got.forEach((v, i) => near(v, shares[i], 0.6, 'slice ' + i));
  const d = U.extract(R.pieChart(shares, true).img, []);
  assert.strictEqual(d.chartType, 'donut');
});

test('a chart with no axis numbers is refused, not guessed', () => {
  const { img } = R.barChart([12, 30, 25], { lo: 0, hi: 35, step: 5 });
  const r = U.extract(img, []);
  assert.ok(!r.ok || !r.reliable);
  assert.ok(r.error || r.issues.length);
});

test('findCharts finds two charts on one page', () => {
  const page = R.blank(1000, 1300);
  const a = R.barChart([5, 9, 3], { lo: 0, hi: 10, step: 2 }).img, b = R.lineChart([1, 5, 2, 8], { lo: 0, hi: 10, step: 2 }).img;
  R.paste(page, a, 40, 40); R.paste(page, b, 40, 700);
  const boxes = U.findCharts(page);
  assert.strictEqual(boxes.length, 2);
  assert.ok(boxes.some(q => q.y < 100) && boxes.some(q => q.y > 600));
});

test('a pie and its legend are one chart, not two', () => {
  const { PNG } = require('pngjs'), fs = require('fs'), path = require('path');
  const read = f => { const p = PNG.sync.read(fs.readFileSync(path.join(__dirname, '..', 'examples', f))); const d = new Uint8ClampedArray(p.data); for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; for (let k = 0; k < 3; k++) d[i + k] = d[i + k] * a + 255 * (1 - a); d[i + 3] = 255; } return { width: p.width, height: p.height, data: d }; };
  for (const f of ['ex_pie.png', 'ex_bars.png', 'ex_line.png', 'ex_hbars.png', 'ex_dots.png', 'ex_rates.png']) assert.strictEqual(U.findCharts(read(f)).length, 1, f);
  const b = U.findCharts(read('ex_pie.png'))[0];
  assert.ok(b.x + b.w > 700, 'the box reaches the legend on the right');
});

test('a warning that fires for several pairs of series is shown once', () => {
  const { img, words } = R.stackedChart([[10, 20, 15], [5, 8, 12], [7, 9, 4]], { lo: 0, hi: 40, step: 10 });
  const C = [[31, 119, 180], [255, 127, 14], [44, 160, 44]], to = [[31, 119, 180], [31, 150, 170], [40, 175, 160]];   // two close pairs
  for (let i = 0; i < img.data.length; i += 4) for (let k = 0; k < 3; k++) if (img.data[i] === C[k][0] && img.data[i + 1] === C[k][1] && img.data[i + 2] === C[k][2]) { img.data[i] = to[k][0]; img.data[i + 1] = to[k][1]; img.data[i + 2] = to[k][2]; }
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  const seen = r.issues.map(i => i.code + '|' + i.text);
  assert.strictEqual(new Set(seen).size, seen.length, 'no issue is listed twice');
  assert.strictEqual(r.series.length, 3);
  assert.strictEqual(r.issues.filter(i => i.code === 'similar_colors').length, 1);
});

test('a photo taken at an angle is warped back and still reads', () => {
  const { img, words, truth } = R.barChart([12, 30, 25, 7, 18], { lo: 0, hi: 35, step: 5 });
  const quad = [[70, 40], [600, 15], [640, 420], [30, 395]];
  // draw the "photo": every photo pixel inside the quad looks up the chart through the homography
  const Hm = U._homography(quad, [[0, 0], [639, 0], [639, 399], [0, 399]]);
  const photo = R.blank(680, 440, [40, 40, 40]);
  for (let y = 0; y < photo.height; y++) for (let x = 0; x < photo.width; x++) {
    const z = Hm[6] * x + Hm[7] * y + 1, u = (Hm[0] * x + Hm[1] * y + Hm[2]) / z, v = (Hm[3] * x + Hm[4] * y + Hm[5]) / z;
    if (u < 0 || v < 0 || u > 639 || v > 399) continue;
    const i = (Math.round(v) * 640 + Math.round(u)) * 4, o = (y * photo.width + x) * 4;
    photo.data[o] = img.data[i]; photo.data[o + 1] = img.data[i + 1]; photo.data[o + 2] = img.data[i + 2];
  }
  const back = U.warp(photo, quad, 640, 400);
  let diff = 0; for (let i = 0; i < back.data.length; i += 4) diff += Math.abs(back.data[i] - img.data[i]);
  assert.ok(diff / (640 * 400) < 12, 'mean difference ' + diff / (640 * 400));
  const r = U.extract(back, words);
  assert.ok(r.ok);
  r.series[0].points.forEach((p, i) => near(p.y, truth[i], 0.4));
  // the corner guess finds a bright sheet on a dark table
  const table = R.blank(500, 400, [30, 30, 30]); R.paste(table, R.blank(300, 200), 100, 80);
  const g = U.guessQuad(table);
  near(g[0][0], 100, 2); near(g[0][1], 80, 2); near(g[2][0], 399, 2); near(g[2][1], 279, 2);
});

test('a chart with no readable axis can be set by hand with two ticks', () => {
  const { img, truth } = R.barChart([12, 30, 25, 7, 18], { lo: 0, hi: 35, step: 5 });
  // frame() puts 0 at y=340 and 35 at y=30, with the axis line at x=60
  const Y = v => 340 - v / 35 * 310;
  const r = U.extract(img, [], { calib: { y: [{ p: Y(0), v: 0, x: 55 }, { p: Y(30), v: 30, x: 55 }] } });
  assert.ok(r.ok, r.error);
  r.series[0].points.forEach((p, i) => near(p.y, truth[i], 0.2));
  const h = R.hbarChart([40, 15, 28, 33], { lo: 0, hi: 50, step: 10 });
  const X = v => 110 + v / 50 * 500;
  const rh = U.extract(h.img, h.words.filter(w => !/^\\d+$/.test(w.text)), { calib: { axis: 'x', y: [{ p: X(0), v: 0, y: 345 }, { p: X(50), v: 50, y: 345 }] } });
  assert.ok(rh.ok, rh.error);
  assert.strictEqual(rh.chartType, 'hbar');
  rh.series[0].points.forEach((p, i) => near(p.y, h.truth[i], 0.3));
});

test('bars with no axis but a number on each bar are read from those numbers', () => {
  const { img, words, truth } = R.hbarChart([40, 15, 28, 33], { lo: 0, hi: 50, step: 10 });
  // drop the axis numbers, add value labels right after each bar end
  const W = words.filter(w => !/^\d+$/.test(w.text));
  const X = v => 110 + v / 50 * 500, step = (340 - 30) / 4;
  truth.forEach((v, i) => { const cy = 30 + step * (i + 0.5); W.push(R.word(v + '%', X(v) + 6, cy - 6, X(v) + 40, cy + 6)); });
  const r = U.extract(img, W);
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.chartType, 'hbar');
  r.series[0].points.forEach((p, i) => near(p.y, truth[i], 0.3));
});

test('parseNumber reads scientific notation', () => {
  near(U.parseNumber('$9e+3').v, 9000, 1e-9);
  near(U.parseNumber('2.5e-2').v, 0.025, 1e-12);
  assert.strictEqual(U.parseNumber('e3'), null);
});

test('fixPowers survives one misread superscript and a bare 10', () => {
  // 10^5 read as "103", 10^1 read as "10"
  const col = ['103', '104', '103', '102', '10'].map((t, i) => ({ text: t, v: +t, p: i * 90 }));
  assert.ok(U._fixPowers(col));
  assert.deepStrictEqual(col.map(q => q.v), [1e5, 1e4, 1e3, 1e2, 10]);
});

test('fitAxis drops a label a few pixels off instead of letting it bend the scale', () => {
  // eight labels 40 px apart; the 700 label sits 5 px off (snapped to a bar top), still inside the 2% value tolerance
  const pairs = [0, 100, 200, 300, 400, 500, 600, 700].map((v, i) => ({ p: 400 - i * 40, v }));
  pairs[7].p -= 5;
  const f = U.fitAxis(pairs);
  assert.strictEqual(f.inliers, 7);
  near(f.toValue(400), 0, 1e-9); near(f.toValue(160), 600, 1e-9);
});

test('two touching pie slices in the same color are split at the white line between them', () => {
  const blue = [31, 119, 180], C = [blue, [255, 127, 14], [44, 160, 44], blue];
  const r = U.extract(R.pieChart([30, 25, 20, 25], false, { colors: C, sep: true }).img, []);
  assert.ok(r.ok, r.error);
  const got = r.series[0].points.map(p => p.y);
  assert.strictEqual(got.length, 4);
  [30, 25, 20, 25].forEach((v, i) => near(got[i], v, 0.8, 'slice ' + i));
});

test('a bar crossed by a line of another color keeps its full height', () => {
  const { img, words, truth } = R.barChart([12, 30, 25, 7, 18], { lo: 0, hi: 35, step: 5 });
  R.line(img, 60, 200, 620, 230, [214, 39, 40], 3);
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  const bars = r.series.find(s => s.type === 'bar');
  assert.ok(bars, 'bars found');
  bars.points.filter(p => !p.empty).forEach((p, i) => near(p.y, truth[i], 0.3, 'bar ' + i));
});

test('a grainy picture is smoothed before reading', () => {
  const { img, words, truth } = R.barChart([12, 30, 25, 7, 18], { lo: 0, hi: 35, step: 5 });
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < img.data.length; i += 4) { const n = (rnd() - 0.5) * 60; for (let c = 0; c < 3; c++) img.data[i + c] = Math.max(0, Math.min(255, img.data[i + c] + n)); }
  const r = U.extract(img, words);
  assert.ok(r.ok, r.error);
  r.series[0].points.forEach((p, i) => near(p.y, truth[i], 0.4, 'bar ' + i));
});
