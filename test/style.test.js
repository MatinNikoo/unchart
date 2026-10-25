// Number and date format codes, color maths and shared drawing pieces used by the chart editor.
const test = require('node:test');
const assert = require('node:assert');
const ST = require('../src/style.js');

test('number format codes follow Excel', () => {
  const f = ST.fmtNumber;
  assert.strictEqual(f(1234567.891, '#,##0.00'), '1,234,567.89');
  assert.strictEqual(f(0.256, '0.0%'), '25.6%');
  assert.strictEqual(f(2500000, '#,##0.0,,"M"'), '2.5M');
  assert.strictEqual(f(-5.5, '0.0;(0.0)'), '(5.5)');
  assert.strictEqual(f(1234, '$#,##0'), '$1,234');
  assert.strictEqual(f(5, '000'), '005');
  assert.strictEqual(f(0.000123, '0.00E+00'), '1.23E-04');
  assert.strictEqual(f(1234.5, '#,##0.0', { euro: true }), '1.234,5');
});

test('date codes', () => {
  assert.strictEqual(ST.fmtDate(19000, 'yyyy-mm-dd'), '2022-01-08');
  assert.strictEqual(ST.fmtDate(19000, 'mmm d, yyyy'), 'Jan 8, 2022');
  assert.strictEqual(ST.fmtDate(19000, 'mmmm yyyy'), 'January 2022');
  assert.ok(ST.isDateCode('yyyy-mm-dd') && !ST.isDateCode('#,##0'));
});

test('color maths', () => {
  assert.strictEqual(Math.round(ST.contrast('#000000', '#ffffff')), 21);
  assert.ok(ST.deltaE('#ff0000', '#00ff00') > 80);
  assert.ok(ST.deltaE('#336699', '#336699') < 0.001);
  // red and green collapse for someone with red or green blindness
  assert.ok(ST.deltaE(ST.simulate('#d62728', 'deutan'), ST.simulate('#2ca02c', 'deutan')) < ST.deltaE('#d62728', '#2ca02c') / 2);
  assert.strictEqual(ST.mix('#000000', '#ffffff', 0.5), '#808080');
  assert.strictEqual(ST.isHex('#12abEF'), true);
  assert.strictEqual(ST.isHex('red'), false);
});

test('sparse formats merge deeply and leave their inputs alone', () => {
  const a = { fill: { t: 'solid', c: '#112233' }, line: { w: 2 } }, b = { fill: { c: '#445566' } };
  const m = ST.merge(ST.merge({}, a), b);
  assert.deepStrictEqual(m, { fill: { t: 'solid', c: '#445566' }, line: { w: 2 } });
  assert.strictEqual(a.fill.c, '#112233');
});

test('fills, lines and markers write valid SVG attributes', () => {
  const D = ST.makeDefs('t_');
  const grad = ST.fillAttr({ t: 'grad', c: '#112233', ang: 90 }, '#000000', D);
  assert.match(grad, /fill="url\(#t_/);
  assert.match(D.xml ? D.xml() : D.toString(), /linearGradient/);
  assert.match(ST.fillAttr({ t: 'none' }, '#000000', D), /fill="none"/);
  assert.match(ST.lineAttr({ c: '#ff0000', w: 3, dash: 'dash' }, { c: '#000000' }), /stroke="#ff0000".*stroke-width="3".*stroke-dasharray/);
  for (const shape of Object.keys(ST.MARKERS)) { const m = ST.marker(shape, 10, 10, 4, ' fill="#000"', ''); assert.ok(/<(circle|rect|path|polygon)/.test(m), shape); assert.ok(!/NaN/.test(m)); }
});

test('smooth paths never overshoot their points', () => {
  const P = [[0, 0], [10, 0], [20, 100], [30, 100]], d = ST.smoothPath(P);
  const ys = (d.match(/-?\d+\.?\d*/g) || []).map(Number);
  assert.ok(ys.every(v => v >= -0.01 && v <= 100.01));
});

test('a number code with no digit placeholder reads as General', () => {
  assert.strictEqual(ST.fmtNumber(5, 'just some words'), '5');
  assert.strictEqual(ST.fmtNumber(5, '#,##0" units"'), '5 units');
});
