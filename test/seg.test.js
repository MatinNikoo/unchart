// Tests for the mark model glue (no model needed): grouping embeddings, and the engine's use of a series map.
const test = require('node:test');
const assert = require('node:assert');
const G = require('../src/seg.js');
const U = require('../src/engine.js');

// a fake model output on a w x h picture: class logits (5) and embeddings (8), channel first
function fake(w, h, at) {
  const N = w * h, cls = new Float32Array(5 * N).fill(-5), emb = new Float32Array(8 * N);
  for (let p = 0; p < N; p++) cls[p] = 5;   // background
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const k = at(x, y); if (k == null) continue;
    const p = y * w + x; cls[p] = -5; cls[N + p] = 5;
    for (let j = 0; j < 8; j++) emb[j * N + p] = (j === k ? 4 : 0) + 0.1 * Math.sin(p + j);
  }
  return { cls, emb };
}

test('two series with far apart embeddings come out as two groups', () => {
  const w = 60, h = 40;
  const { cls, emb } = fake(w, h, (x, y) => y === 10 ? 0 : y === 30 ? 1 : null);
  const o = G.decode(cls, emb, w, h, 5);
  assert.strictEqual(o.k, 2);
  assert.notStrictEqual(o.inst[10 * w + 5], o.inst[30 * w + 5]);
  assert.strictEqual(o.inst[10 * w + 5], o.inst[10 * w + 50]);
  assert.strictEqual(o.inst[20 * w + 5], -1);
});

test('soft edge pixels join the nearest group instead of making their own', () => {
  const w = 40, h = 20;
  const { cls, emb } = fake(w, h, (x, y) => y === 8 || y === 9 ? 0 : null);
  // row 9 is unsure (series only just wins) and its embedding is a bit off
  for (let x = 0; x < w; x++) { const p = 9 * w + x; cls[p] = 0.5; cls[w * h + p] = 0.6; emb[p] += 1.2; }
  const o = G.decode(cls, emb, w, h, 5);
  assert.strictEqual(o.k, 1);
  assert.strictEqual(o.inst[9 * w + 3], o.inst[8 * w + 3]);
});

test('flip and scale keep the map in step with the picture', () => {
  const sg = { width: 4, height: 2, k: 1, inst: Int16Array.from([0, -1, -1, -1, -1, -1, -1, 0]), cls: Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 1]) };
  const f = G.flip(sg);
  assert.strictEqual(f.width, 2); assert.strictEqual(f.height, 4);
  assert.strictEqual(G.flip(f).inst.join(','), sg.inst.join(','));
  const s = G.scale(sg, 8, 4);
  assert.strictEqual(s.inst[0], 0); assert.strictEqual(s.inst[8 * 4 - 1], 0); assert.strictEqual(s.inst[4], -1);
});

test('the engine ignores a series map of the wrong size', () => {
  const W = 50, H = 40, D = new Uint8ClampedArray(W * H * 4).fill(255);
  const sg = { width: 10, height: 10, k: 0, inst: new Int16Array(100).fill(-1) };
  const r = U.extract({ width: W, height: H, data: D }, [], { seg: sg });
  assert.strictEqual(r.ok, false);
});
