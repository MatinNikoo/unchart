// Tests for the PP-OCR number reader glue (no model needed). Run with: node --test test/
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/ppocr.js');
const U = require('../src/engine.js');

const rd = (text, conf = 99, num = '') => ({ text, conf, num: { text: num, conf } });

test('numText keeps the number and its scale, drops a unit word', () => {
  assert.strictEqual(P.numText(rd('10 g')).text, '10');
  assert.strictEqual(P.numText(rd('2.5M')).text, '2.5M');
  assert.strictEqual(P.numText(rd('$1,200')).text, '$1,200');
  assert.strictEqual(P.numText(rd('100 years')).text, '100');
  assert.strictEqual(P.numText(rd('1O0')).text, '100');
});

test('numText says no for words and specks', () => {
  assert.strictEqual(P.numText(rd('Q2 2023', 99, '22023')), null);
  assert.strictEqual(P.numText(rd('Sales 3', 99, '3')), null);
  assert.strictEqual(P.numText(rd('/', 40, '1')), null);
  assert.strictEqual(P.numText(null), null);
});

test('pickNumbers keeps agreement and settles a disagreement by the axis line', () => {
  // a y axis column: 0, 10, 20, 30, 40 every 50 px; the box at 20 reads 20 (PP) against 28 (tesseract)
  const col = [0, 10, 20, 30, 40].map((v, k) => ({ b: { x0: 10, x1: 30, y0: 400 - k * 50, y1: 412 - k * 50 }, v }));
  const items = col.map(c => ({ b: c.b, tn: { text: String(c.v), conf: 90 }, pp: { text: String(c.v), conf: 99 } }));
  items[2].tn = { text: '28', conf: 90 };
  items[3].pp = { text: '80', conf: 99 };
  const pick = P.pickNumbers(items, U.parseNumber, 'pp');
  assert.deepStrictEqual(pick.map(q => q.text), ['0', '10', '20', '30', '40']);
});

test('pickNumbers falls back to whichever reader has something', () => {
  const b = { x0: 0, x1: 10, y0: 0, y1: 10 };
  const pick = P.pickNumbers([{ b, tn: null, pp: { text: '5', conf: 99 } }, { b, tn: { text: '7', conf: 80 }, pp: null }, { b, tn: null, pp: null }], U.parseNumber, 'pp');
  assert.deepStrictEqual(pick.map(q => q && q.text), ['5', '7', null]);
});

test('the resampler keeps a flat image flat and its size right', () => {
  const g = new Float32Array(6 * 4).fill(0.5);
  for (const k of ['linear', 'cubic', 'lanczos']) {
    const r = P.resize(g, 6, 4, 15, 10, k);
    assert.strictEqual(r.length, 150);
    for (const v of r) assert.ok(Math.abs(v - 0.5) < 1e-6, k);
  }
});
