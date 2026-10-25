// Reruns only the extract step in node, with OCR words saved by `bench/run.js --cache`.
// For fast iteration on the dev split. Final numbers always come from bench/run.js in Chromium.
// usage: node bench/run_node.js <set dir> <out.json> [--split dev] [--ids a,b]
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs'); const jpeg = require('jpeg-js');
const U = require(process.env.ENGINE || '../src/engine.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
// CAL=<file> replays with another calibration. With SEG the calibration fit on the model's reads is the default
const cal = process.env.CAL || path.join(__dirname, '..', 'src', process.env.SEG ? 'calibration_model.json' : 'calibration.json');
if (fs.existsSync(cal) && !process.argv.includes('--nocal')) U.setCalibration(JSON.parse(fs.readFileSync(cal)));
function decode(f) {
  const buf = fs.readFileSync(f);
  let w, h, d;
  if (/\.jpe?g$/i.test(f)) { const j = jpeg.decode(buf, { useTArray: true }); w = j.width; h = j.height; d = j.data; }
  else { const p = PNG.sync.read(buf); w = p.width; h = p.height; d = p.data; }
  // composite over white like the browser harness does
  const o = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) { const a = d[i + 3] / 255; o[i] = d[i] * a + 255 * (1 - a); o[i + 1] = d[i + 1] * a + 255 * (1 - a); o[i + 2] = d[i + 2] * a + 255 * (1 - a); o[i + 3] = 255; }
  return { width: w, height: h, data: o };
}
const dir = path.resolve(process.argv[2]), outp = process.argv[3], split = arg('--split'), ids = arg('--ids'), sample = +arg('--sample', 0);
let truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
// --sample N: the first N charts of each family, for a quick look while tuning
if (sample) { const per = {}; truth = truth.filter(t => (per[t.family] = (per[t.family] || 0) + 1) <= sample); }
const imgDir = fs.existsSync(path.join(dir, 'images')) ? path.join(dir, 'images') : dir;
// OCR_CACHE points at another cache folder (same layout), to compare readers
const cdir = path.join(process.env.OCR_CACHE || path.join(__dirname, '..', '.cache', 'ocr'), path.basename(dir));
const out = {};
let stale = 0;
// SEG=<model.onnx> runs the mark model on each chart first (cached per model in .cache/seg)
const SEGM = process.env.SEG, crypto = require('crypto');
let SEG = null, segDir = null;
// the raw model outputs are cached (logits as int8, embeddings of series pixels as int16), so changes to the
// grouping step replay without running the model again
async function segFor(img, file) {
  const f = path.join(segDir, file + '.raw.gz'), z = require('zlib');
  let raw = null;
  if (fs.existsSync(f)) {
    const b = z.gunzipSync(fs.readFileSync(f)), hd = new Uint32Array(b.buffer.slice(b.byteOffset, b.byteOffset + 28));
    const [w, h, W, H, C, E, n] = hd, N = w * h;
    if (W === img.width && H === img.height) {
      const lg = new Int8Array(b.buffer.slice(b.byteOffset + 28, b.byteOffset + 28 + C * N)), cls = new Float32Array(C * N);
      for (let i = 0; i < C * N; i++) cls[i] = lg[i] / 8;
      const ev = new Int16Array(b.buffer.slice(b.byteOffset + 28 + C * N, b.byteOffset + 28 + C * N + E * n * 2)), emb = new Float32Array(E * N);
      let k = 0;
      for (let p = 0; p < N; p++) { let bj = 0; for (let j = 1; j < C; j++) if (cls[j * N + p] > cls[bj * N + p]) bj = j;
        if (bj === 1) { for (let j = 0; j < E; j++) emb[j * N + p] = ev[k * E + j] / 1000; k++; } }
      raw = { w, h, W, H, cls, emb };
    }
  }
  if (!raw) {
    raw = await SEG.infer(img);
    const { w, h, W, H, cls, emb } = raw, N = w * h, C = cls.length / N, E = emb.length / N;
    const lg = new Int8Array(C * N); for (let i = 0; i < C * N; i++) lg[i] = Math.max(-127, Math.min(127, Math.round(cls[i] * 8)));
    for (let i = 0; i < C * N; i++) cls[i] = lg[i] / 8;   // the run uses the same rounded logits a replay would
    const ser = []; for (let p = 0; p < N; p++) { let bj = 0; for (let j = 1; j < C; j++) if (cls[j * N + p] > cls[bj * N + p]) bj = j; if (bj === 1) ser.push(p); }
    const ev = new Int16Array(E * ser.length); ser.forEach((p, k) => { for (let j = 0; j < E; j++) ev[k * E + j] = Math.max(-32767, Math.min(32767, Math.round(emb[j * N + p] * 1000))); });
    for (const p of ser) for (let j = 0; j < E; j++) emb[j * N + p] = Math.round(emb[j * N + p] * 1000) / 1000;
    const hd = new Uint32Array([w, h, W, H, C, E, ser.length]);
    fs.writeFileSync(f, z.gzipSync(Buffer.concat([Buffer.from(hd.buffer), Buffer.from(lg.buffer), Buffer.from(ev.buffer)]), { level: 3 }));
  }
  return SEG.post(raw);
}
(async () => {
if (SEGM) {
  const ort = require('onnxruntime-web'); ort.env.wasm.numThreads = 1; ort.env.logLevel = 'error';
  SEG = require('../src/seg.js'); await SEG.init(ort, fs.readFileSync(SEGM));
  segDir = path.join(__dirname, '..', '.cache', 'seg', crypto.createHash('sha256').update(fs.readFileSync(SEGM)).digest('hex').slice(0, 10), path.basename(dir));
  fs.mkdirSync(segDir, { recursive: true });
}
for (const t of truth) {
  if (split && t.split && t.split !== split) continue;
  if (ids && !ids.split(',').includes(t.file) && !ids.split(',').includes(t.id)) continue;
  const cf = path.join(cdir, t.file + '.json');
  if (!fs.existsSync(cf)) { console.log('no cache for', t.file); continue; }
  const c = JSON.parse(fs.readFileSync(cf));
  let img = decode(path.join(imgDir, t.file));
  const t0 = Date.now();
  const ds = process.argv.includes('--nodeskew') ? { angle: 0, img } : U.deskew(img);
  if (Math.abs(ds.angle - (c.angle || 0)) > 0.05) stale++;
  img = ds.img;
  const words = c.words.map(w => ({ text: w[0], conf: w[1], x0: w[2], y0: w[3], x1: w[4], y1: w[5] }));
  let r;
  const o = JSON.parse(arg('--opts', '{}'));
  if (SEG) o.seg = await segFor(img, t.file);
  try { r = U.extract(img, words, o); } catch (e) { r = { ok: false, code: 'crash', error: e.message + ' ' + e.stack.split('\n')[1] }; }
  // the second OCR pass of the strip under the plot, replayed from the cache like the app would run it
  if (r.ok && r.xWeak && c.rot && o.rotated !== false) {
    const rot = {}; for (const k in c.rot) rot[k] = c.rot[k].map(w => ({ text: w[0], conf: w[1], x0: w[2], y0: w[3], x1: w[4], y1: w[5] }));
    r = U.withRotated(img, words, r, rot, o).res;
  }
  const rd = v => typeof v === 'number' ? +v.toFixed(6) : v;
  out[t.file] = { ok: r.ok, error: r.error, code: r.code, chartType: r.chartType, confidence: r.confidence, reliable: r.reliable, issues: r.issues, features: r.features, flags: r.flags, axis: r.axis, rect: r.rect, angle: ds.angle,
    ms_extract: Date.now() - t0, series: (r.series || []).map(s => ({ type: s.type, name: s.name, color: s.color, axis: s.axis, stacked: s.stacked, points: s.points.map(p => ({ x: rd(p.x), y: rd(p.y), xv: p.xv, px: rd(p.px), py: rd(p.py), err: p.err && p.err.map(rd), empty: p.empty })) })) };
}
if (stale) console.log(stale, 'charts were deskewed differently than when their OCR was cached');
fs.writeFileSync(outp, JSON.stringify(out));
console.log(Object.keys(out).length, 'charts ->', outp);
})();
