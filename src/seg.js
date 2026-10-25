// The mark model: a small U-Net (bench/seg/model.py) that labels every pixel as series ink, text, gridline,
// legend swatch or background, and gives each series pixel an embedding. Pixels whose embeddings sit close
// together are one series, so two lines of nearly the same color, or two lines that cross, still come out as two.
// Plain JS with onnxruntime passed in, so the browser and the node benchmark run the very same steps.
(function (root) {
  'use strict';
  const MAXS = 1024, R = 1.5, EDIM = 8, SURE = 0.9;
  let sess = null, ortRef = null;

  async function init(ort, model) {
    ortRef = ort;
    sess = await ort.InferenceSession.create(model, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return sess;
  }

  // group series pixels by embedding: start from the first pixel not yet taken, move to the mean of its
  // neighbours a few times, take everything within R. Tiny groups are edge noise and go to the nearest group.
  function cluster(E, idx, minPix) {
    const n = idx.length, lab = new Int16Array(n).fill(-1), centers = [];
    const d2 = (k, c) => { let s = 0; for (let j = 0; j < EDIM; j++) { const v = E[j * idx.N + idx[k]] - c[j]; s += v * v; } return s; };
    const R2 = R * R;
    let start = 0, noise = [];
    while (centers.length < 30) {
      while (start < n && lab[start] !== -1) start++;
      if (start >= n) break;
      let c = new Float32Array(EDIM); for (let j = 0; j < EDIM; j++) c[j] = E[j * idx.N + idx[start]];
      for (let it = 0; it < 5; it++) {
        const m = new Float64Array(EDIM); let cnt = 0;
        for (let k = start; k < n; k++) if (lab[k] === -1 && d2(k, c) < R2) { for (let j = 0; j < EDIM; j++) m[j] += E[j * idx.N + idx[k]]; cnt++; }
        if (!cnt) break;
        const nc = new Float32Array(EDIM); for (let j = 0; j < EDIM; j++) nc[j] = m[j] / cnt; c = nc;
      }
      const mem = [];
      for (let k = start; k < n; k++) if (lab[k] === -1 && d2(k, c) < R2) mem.push(k);
      if (!mem.length) { lab[start] = -2; noise.push(start); continue; }
      if (mem.length < minPix) { for (const k of mem) { lab[k] = -2; noise.push(k); } continue; }
      for (const k of mem) lab[k] = centers.length;
      centers.push(c);
    }
    for (let k = 0; k < n; k++) if (lab[k] === -1) noise.push(k);
    if (centers.length) for (const k of noise) {
      let bi = -1, bd = 4 * R2;
      centers.forEach((c, i) => { const d = d2(k, c); if (d < bd) { bd = d; bi = i; } });
      lab[k] = bi;
    }
    return { lab, k: centers.length, centers };
  }

  // logits and embeddings (flat, channel first, w x h) -> per pixel class and series id at the same size.
  // Groups are found on the sure series pixels only (the middle of a line or bar), then the soft edges join the
  // nearest group, so the anti-aliased rim of a shape never becomes a series of its own.
  function decode(cls, emb, w, h, minPix) {
    const N = w * h, C = cls.length / N, c8 = new Uint8Array(N), sure = new Uint8Array(N);
    for (let p = 0; p < N; p++) {
      let b = 0, bv = cls[p]; for (let j = 1; j < C; j++) { const v = cls[j * N + p]; if (v > bv) { bv = v; b = j; } } c8[p] = b;
      if (b === 1) { let z = 0; for (let j = 0; j < C; j++) z += Math.exp(cls[j * N + p] - bv); sure[p] = 1 / z > SURE ? 1 : 0; }
    }
    const core = [], rest = [];
    for (let p = 0; p < N; p++) if (c8[p] === 1) (sure[p] ? core : rest).push(p);
    const idx = Int32Array.from(core); idx.N = N;
    const { lab, k, centers } = cluster(emb, idx, minPix);
    const inst = new Int16Array(N).fill(-1);
    for (let i = 0; i < idx.length; i++) inst[idx[i]] = lab[i];
    const R4 = 4 * R * R;
    for (const p of rest) {
      let bi = -1, bd = R4;
      for (let i = 0; i < centers.length; i++) { let d = 0; for (let j = 0; j < EDIM; j++) { const v = emb[j * N + p] - centers[i][j]; d += v * v; } if (d < bd) { bd = d; bi = i; } }
      inst[p] = bi;
    }
    return { cls: c8, inst, k };
  }

  // nearest neighbour resize of the label maps back to the picture size
  function upsample(o, w, h, W, H) {
    if (w === W && h === H) return o;
    const cls = new Uint8Array(W * H), inst = new Int16Array(W * H);
    for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, Math.floor((y + 0.5) * h / H)); for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, Math.floor((x + 0.5) * w / W)), q = sy * w + sx, p = y * W + x; cls[p] = o.cls[q]; inst[p] = o.inst[q]; } }
    return { cls, inst, k: o.k };
  }

  // img: {width, height, data (rgba)}. Returns {width, height, cls, inst, k, ms}
  async function run(img) { const t0 = Date.now(), raw = await infer(img), o = post(raw); o.ms = Date.now() - t0; return o; }
  function post(raw) {
    const { w, h, W, H, cls, emb } = raw;
    const o = upsample(decode(cls, emb, w, h, Math.max(12, Math.round(w * 0.01))), w, h, W, H);
    return { width: W, height: H, cls: o.cls, inst: o.inst, k: o.k };
  }
  // the model's raw outputs at the size it ran: class logits and embeddings, channel first
  async function infer(img) {
    if (!sess) throw new Error('seg model not loaded');
    const W = img.width, H = img.height, s = Math.min(1, MAXS / Math.max(W, H));
    const w = Math.max(16, Math.round(W * s)), h = Math.max(16, Math.round(H * s));
    const pw = Math.ceil(w / 16) * 16, ph = Math.ceil(h / 16) * 16;
    const x = new Float32Array(3 * pw * ph), D = img.data;
    // area average down to (w, h), edge padding up to a multiple of 16
    for (let y = 0; y < ph; y++) for (let xx = 0; xx < pw; xx++) {
      const sx = Math.min(xx, w - 1), sy = Math.min(y, h - 1);
      const xa = Math.floor(sx * W / w), xb = Math.max(xa + 1, Math.floor((sx + 1) * W / w)), ya = Math.floor(sy * H / h), yb = Math.max(ya + 1, Math.floor((sy + 1) * H / h));
      let r = 0, g = 0, b = 0, n = 0;
      for (let v = ya; v < yb; v++) for (let u = xa; u < xb; u++) { const i = (v * W + u) * 4; r += D[i]; g += D[i + 1]; b += D[i + 2]; n++; }
      const p = y * pw + xx; x[p] = r / n / 255; x[pw * ph + p] = g / n / 255; x[2 * pw * ph + p] = b / n / 255;
    }
    const out = await sess.run({ image: new ortRef.Tensor('float32', x, [1, 3, ph, pw]) });
    const cl = out.cls.data, em = out.emb.data, C = cl.length / (pw * ph);
    // crop the padding off
    const cls = new Float32Array(C * w * h), emb = new Float32Array(EDIM * w * h);
    for (let j = 0; j < C; j++) for (let y = 0; y < h; y++) cls.set(cl.subarray(j * pw * ph + y * pw, j * pw * ph + y * pw + w), j * w * h + y * w);
    for (let j = 0; j < EDIM; j++) for (let y = 0; y < h; y++) emb.set(em.subarray(j * pw * ph + y * pw, j * pw * ph + y * pw + w), j * w * h + y * w);
    return { w, h, W, H, cls, emb };
  }

  // the same flip and resize the engine applies to the picture
  function flip(sg) {
    const W = sg.width, H = sg.height, cls = new Uint8Array(W * H), inst = new Int16Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x, o = (W - 1 - x) * H + (H - 1 - y); cls[o] = sg.cls[i]; inst[o] = sg.inst[i]; }
    return { width: H, height: W, cls, inst, k: sg.k };
  }
  function scale(sg, w, h) { const o = upsample(sg, sg.width, sg.height, w, h); return { width: w, height: h, cls: o.cls, inst: o.inst, k: sg.k }; }

  const api = { init, run, infer, post, decode, cluster, flip, scale };
  root.UnchartSeg = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
