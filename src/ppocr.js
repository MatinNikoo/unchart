// A second text reader for tick labels and legends: the PP-OCRv5 English recognizer (Apache 2.0, from PaddleOCR)
// run with onnxruntime. It only reads, the label boxes still come from ocr.js. Plain JS so the same crops come out
// in the browser and in node, where the benchmark replays it.
(function (root) {
  'use strict';
  const H = 48;
  let dict = null, sess = null, ortRef = null;
  function setDict(text) { dict = text.split(/\r?\n/); if (dict[dict.length - 1] === '') dict.pop(); }

  // 1d resampling kernels; bicubic is Keys with a = -0.5, lanczos uses 3 lobes
  const K = {
    linear: { r: 1, f: x => Math.max(0, 1 - Math.abs(x)) },
    cubic: { r: 2, f: x => { x = Math.abs(x); return x < 1 ? 1.5 * x ** 3 - 2.5 * x ** 2 + 1 : x < 2 ? -0.5 * x ** 3 + 2.5 * x ** 2 - 4 * x + 2 : 0; } },
    lanczos: { r: 3, f: x => { if (x === 0) return 1; if (Math.abs(x) >= 3) return 0; const p = Math.PI * x; return 3 * Math.sin(p) * Math.sin(p / 3) / (p * p); } },
  };
  // resample a gray float image (w x h) to (W x Hh); when shrinking the kernel is widened so it averages
  function resize(src, w, h, W, Hh, kind) {
    const k = K[kind] || K.cubic;
    const pass = (inp, n, m, stride, count, lineStep, outN) => {
      const s = n / outN, sc = Math.max(1, s), out = new Float32Array(outN * count);
      for (let o = 0; o < outN; o++) {
        const c = (o + 0.5) * s - 0.5, r = k.r * sc, a = Math.ceil(c - r), b = Math.floor(c + r);
        const ws = []; let tot = 0;
        for (let i = a; i <= b; i++) { const v = k.f((i - c) / sc); ws.push(v); tot += v; }
        for (let l = 0; l < count; l++) {
          let acc = 0;
          for (let i = a, j = 0; i <= b; i++, j++) { const ii = Math.min(n - 1, Math.max(0, i)); acc += ws[j] * inp[l * lineStep + ii * stride]; }
          out[l * outN + o] = acc / tot;
        }
      }
      return out;
    };
    // rows first (x direction), then columns
    const t = pass(src, w, 0, 1, h, w, W);           // t is h rows of W
    const tt = new Float32Array(W * h); for (let y = 0; y < h; y++) for (let x = 0; x < W; x++) tt[x * h + y] = t[y * W + x];
    const u = pass(tt, h, 0, 1, W, h, Hh);           // u is W columns of Hh
    const o = new Float32Array(W * Hh); for (let x = 0; x < W; x++) for (let y = 0; y < Hh; y++) o[y * W + x] = u[x * Hh + y];
    return o;
  }

  // cut one label out of an rgba image as dark text on white, stretched to full contrast, 48 px tall
  function prep(img, b, opt = {}) {
    const bh = b.y1 - b.y0, pad = Math.max(2, Math.round(bh * (opt.pad || 0.3)));
    const x0 = Math.max(0, Math.floor(b.x0 - pad)), x1 = Math.min(img.width, Math.ceil(b.x1 + pad));
    const y0 = Math.max(0, Math.floor(b.y0 - pad)), y1 = Math.min(img.height, Math.ceil(b.y1 + pad));
    const w = x1 - x0, h = y1 - y0;
    if (w < 2 || h < 2) return null;
    const g = new Float32Array(w * h), D = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * img.width + x + x0) * 4; g[y * w + x] = (D[i] * 299 + D[i + 1] * 587 + D[i + 2] * 114) / 1000; }
    // the background is what the border of the crop mostly is
    const edge = []; for (let x = 0; x < w; x++) edge.push(g[x], g[(h - 1) * w + x]); for (let y = 0; y < h; y++) edge.push(g[y * w], g[y * w + w - 1]);
    edge.sort((a, c) => a - c); const bg = edge[edge.length >> 1];
    const srt = Float32Array.from(g).sort();
    const dark = bg < 128;
    // ink is the far end from the background
    const ink = dark ? srt[Math.floor(srt.length * 0.98)] : srt[Math.floor(srt.length * 0.02)];
    const span = Math.max(30, Math.abs(bg - ink));
    for (let p = 0; p < g.length; p++) g[p] = Math.max(0, Math.min(1, 1 - Math.abs(g[p] - bg) / span * (Math.sign(ink - bg) * Math.sign(g[p] - bg) >= 0 ? 1 : 0)));
    if (opt.binarize) {
      // otsu on the stretched crop
      const hist = new Float64Array(64); for (const v of g) hist[Math.min(63, v * 64 | 0)]++;
      let best = 0, th = 32, sum = 0, n = g.length; for (let i = 0; i < 64; i++) sum += i * hist[i];
      let wb = 0, sb = 0;
      for (let i = 0; i < 64; i++) { wb += hist[i]; if (!wb) continue; const wf = n - wb; if (!wf) break; sb += i * hist[i]; const mb = sb / wb, mf = (sum - sb) / wf, v = wb * wf * (mb - mf) ** 2; if (v > best) { best = v; th = i; } }
      for (let p = 0; p < g.length; p++) g[p] = g[p] * 64 > th ? 1 : 0;
    }
    let W = Math.max(8, Math.round(w * H / h));
    const r = resize(g, w, h, W, H, opt.kernel || 'cubic');
    // short labels get white space on the right, the model wants a few time steps
    const WW = Math.max(W, opt.minW || 64);
    const t = new Float32Array(3 * H * WW).fill(1);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = r[y * W + x] * 2 - 1; t[y * WW + x] = t[H * WW + y * WW + x] = t[2 * H * WW + y * WW + x] = v; }
    for (let c = 0; c < 3; c++) for (let y = 0; y < H; y++) for (let x = W; x < WW; x++) t[c * H * WW + y * WW + x] = 1;
    return { data: t, w: WW };
  }

  const NUMS = new Set('0123456789.,-+%$kKMBe−'.split(''));
  // greedy ctc decode; with nums only number characters may win a time step (like the tesseract whitelist)
  function decode(probs, T, C, nums) {
    let text = '', cs = [], prev = 0;
    for (let t = 0; t < T; t++) {
      let bi = 0, bv = -1;
      for (let c = 0; c < C; c++) {
        const ch = c === 0 ? '' : c <= dict.length ? dict[c - 1] : ' ';
        if (nums && c && !NUMS.has(ch)) continue;
        const v = probs[t * C + c]; if (v > bv) { bv = v; bi = c; }
      }
      if (bi && bi !== prev) { text += bi <= dict.length ? dict[bi - 1] : ' '; cs.push(bv); }
      prev = bi;
    }
    return { text: text.trim(), conf: cs.length ? 100 * cs.reduce((a, c) => a + c, 0) / cs.length : 0 };
  }

  // the number part of a reading. A unit after a space is dropped (10 g, 5 t), the way the tesseract number pass
  // drops it; scale letters and percent stay. When the free reading is not a number, the number-only decode is used.
  function numText(r) {
    if (!r) return null;
    const f = r.text.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0').trim();
    const m = f.match(/^([-−+]?\s?[$€£]?\s?\d[\d.,]*)\s?(k|K|M|B|bn|%|thousand|million|billion|trillion)?(\s+[A-Za-z°].*)?$/);
    if (m) return { text: (m[1] + (m[2] || '')).replace(/\s/g, ''), conf: r.conf };
    // a word (Q2 2023, Jan '24, Sales 3) or a speck with no digit in it is not a number label
    if (!/\d/.test(f) || /[A-HJ-NP-Za-km-z]/.test(f)) return null;
    return /\d/.test(r.num.text) ? r.num : null;
  }

  async function init(ort, modelBytes, dictText) {
    ortRef = ort; setDict(dictText);
    sess = await ort.InferenceSession.create(modelBytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    return sess;
  }
  // reads each box; returns [{text, conf, num: {text, conf}}] in the same order
  async function readBoxes(img, boxes, opt = {}) {
    const out = [];
    for (const b of boxes) {
      const p = prep(img, b, opt);
      if (!p) { out.push(null); continue; }
      const x = new ortRef.Tensor('float32', p.data, [1, 3, H, p.w]);
      const o = await sess.run({ [sess.inputNames[0]]: x });
      const y = o[sess.outputNames[0]], [, T, C] = y.dims;
      const free = decode(y.data, T, C, false);
      out.push(Object.assign(free, { num: decode(y.data, T, C, true) }));
    }
    return out;
  }
  // puts the two readings of every label box together. items: [{b: box, tn: tesseract word or null, pp: PP reading}]
  // Both agree: keep it. One is empty: the other. They disagree: fit value against position over the boxes of the same
  // column (y labels) or row (x labels) where both agree, and keep the reading closer to that line (linear or log).
  // No line to check against: prefer (pp or tess).
  function pickNumbers(items, parse, prefer) {
    const val = t => { const n = t && parse(t); return n ? n.v : null; };
    for (const it of items) { it.agree = null; if (it.pp && it.tn && val(it.pp.text) != null && val(it.pp.text) === val(it.tn.text)) it.agree = val(it.tn.text); }
    const byFit = it => {
      const cy = (it.b.y0 + it.b.y1) / 2, h = it.b.y1 - it.b.y0;
      const col = items.filter(o => o !== it && o.agree != null && Math.abs(o.b.x1 - it.b.x1) < Math.max(4, h * 0.6));
      const row = items.filter(o => o !== it && o.agree != null && Math.abs((o.b.y0 + o.b.y1) / 2 - cy) < Math.max(3, h * 0.4));
      let best = null;
      for (const [grp, pos] of [[col, o => (o.b.y0 + o.b.y1) / 2], [row, o => (o.b.x0 + o.b.x1) / 2]]) {
        if (grp.length < 2) continue;
        for (const log of [false, true]) {
          const pts = grp.map(o => [pos(o), log ? (o.agree > 0 ? Math.log10(o.agree) : NaN) : o.agree]).filter(p => isFinite(p[1]));
          if (pts.length < 2) continue;
          const n = pts.length, mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
          const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0); if (sxx < 1) continue;
          const k = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / sxx;
          const res = Math.sqrt(pts.reduce((a, p) => a + (p[1] - my - k * (p[0] - mx)) ** 2, 0) / n);
          const sp = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1])) || 1;
          if (res > sp * 0.02) continue;
          const want = my + k * (pos(it) - mx);
          for (const c of [it.tn, it.pp]) {
            let v = val(c.text); if (v == null) continue; if (log) { if (v <= 0) continue; v = Math.log10(v); }
            const e = Math.abs(v - want) / sp;
            if (!best || e < best.e) best = { e, c };
          }
        }
      }
      return best && best.e < 0.25 ? best.c : null;
    };
    return items.map(it => {
      if (!it.pp || !it.tn) return it.tn || it.pp || null;
      if (it.agree != null) return it.tn;
      // with no line to check: a sure PP reading beats tesseract, an unsure one does not
      return byFit(it) || (prefer === 'tess' ? it.tn : prefer === 'pp' ? it.pp : it.pp.conf >= 95 ? it.pp : it.tn);
    });
  }
  const api = { init, readBoxes, prep, decode, resize, setDict, numText, pickNumbers };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.UnchartPP = api;
})(typeof window !== 'undefined' ? window : this);
