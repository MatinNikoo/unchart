// Reads every label box of every chart with the PP-OCR number reader in node and saves the raw readings, so
// bench/ppocr/merge.js can try ways of combining them with the tesseract words without reading again.
// usage: node bench/ppocr/read_boxes.js <set dir> <out dir> [--split dev] [--kernel cubic|linear|lanczos] [--bin] [--pad 0.3]
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', '..');
const { PNG } = require(R + '/node_modules/pngjs'); const jpeg = require(R + '/node_modules/jpeg-js');
const ort = require('onnxruntime-web'); ort.env.wasm.numThreads = 1; ort.env.logLevel = 'error';
global.window = global; require(R + '/src/ocr.js');
const U = require(R + '/src/engine.js'), PP = require(R + '/src/ppocr.js');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
function decode(f) {
  const buf = fs.readFileSync(f); let w, h, d;
  if (/\.jpe?g$/i.test(f)) { const j = jpeg.decode(buf, { useTArray: true }); w = j.width; h = j.height; d = j.data; }
  else { const p = PNG.sync.read(buf); w = p.width; h = p.height; d = p.data; }
  const o = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h * 4; i += 4) { const a = d[i + 3] / 255; o[i] = d[i] * a + 255 * (1 - a); o[i + 1] = d[i + 1] * a + 255 * (1 - a); o[i + 2] = d[i + 2] * a + 255 * (1 - a); o[i + 3] = 255; }
  return { width: w, height: h, data: o };
}
const cv = img => ({ width: img.width, height: img.height, getContext: () => ({ getImageData: () => ({ data: img.data }) }) });
function up2(img) {
  const W = img.width * 2, H = img.height * 2, o = new Uint8ClampedArray(W * H * 4);
  for (let c = 0; c < 3; c++) {
    const g = new Float32Array(img.width * img.height); for (let p = 0; p < g.length; p++) g[p] = img.data[p * 4 + c];
    const r = PP.resize(g, img.width, img.height, W, H, 'linear'); for (let p = 0; p < r.length; p++) o[p * 4 + c] = r[p];
  }
  for (let p = 0; p < W * H; p++) o[p * 4 + 3] = 255;
  return { width: W, height: H, data: o };
}
(async () => {
  const dir = path.resolve(process.argv[2]), outDir = process.argv[3], split = arg('--split');
  const opt = { kernel: arg('--kernel', 'cubic'), binarize: process.argv.includes('--bin'), pad: +arg('--pad', 0.3) };
  await PP.init(ort, fs.readFileSync(R + '/vendor/pp/en_PP-OCRv5_mobile_rec.onnx'), fs.readFileSync(R + '/vendor/pp/ppocrv5_en_dict.txt', 'utf8'));
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
  const imgDir = fs.existsSync(path.join(dir, 'images')) ? path.join(dir, 'images') : dir;
  const cout = path.join(outDir, path.basename(dir)); fs.mkdirSync(cout, { recursive: true });
  let n = 0, t0 = Date.now();
  for (const t of truth) {
    if (split && t.split !== split) continue;
    let img = U.deskew(decode(path.join(imgDir, t.file))).img;
    let sf = 1, boxes = window.UnchartOCR._findLabelBoxes(cv(img));
    const hs = boxes.map(b => b.hh).sort((a, b) => a - b), hMed = hs.length ? hs[hs.length >> 1] : 0;
    if (!hs.length || hMed < 8 || Math.max(img.width, img.height) < 700) { sf = 2; boxes = window.UnchartOCR._findLabelBoxes(cv(up2(img))); }
    const bx = boxes.map(b => ({ x0: b.x0 / sf, y0: b.y0 / sf, x1: (b.x1 + 1) / sf, y1: (b.y1 + 1) / sf }));
    const reads = await PP.readBoxes(img, bx, opt);
    fs.writeFileSync(path.join(cout, t.file + '.json'), JSON.stringify(bx.map((b, i) => [b.x0, b.y0, b.x1, b.y1].map(v => +v.toFixed(1))
      .concat(reads[i] ? [reads[i].text, +reads[i].conf.toFixed(1), reads[i].num.text, +reads[i].num.conf.toFixed(1)] : []))));
    n++;
  }
  console.log(n, 'charts', ((Date.now() - t0) / n).toFixed(0), 'ms/chart');
})();
