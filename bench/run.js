// Runs every chart of a set through the app's own pipeline (deskew, OCR, extract) in headless Chromium.
// usage: node bench/run.js <set dir> <out.json> [--split dev|test] [--ids a,b] [--cache] [--resume] [--seg]
// --seg turns the experimental mark model on (with the calibration fit on its reads). Without it the rules alone read the series.
// <set dir> holds truth.json and the images (in images/ or next to truth.json).
// --cache also saves the OCR words, so bench/run_node.js can rerun the extract step without OCR.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8790;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
(async () => {
  const dir = path.resolve(process.argv[2]), outp = process.argv[3];
  const split = arg('--split'), ids = arg('--ids'), cache = process.argv.includes('--cache') || process.argv.includes('--missing'), missing = process.argv.includes('--missing');
  const root = path.resolve(__dirname, '..');
  const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json')));
  const imgDir = fs.existsSync(path.join(dir, 'images')) ? path.join(dir, 'images') : dir;
  let rel = path.relative(root, imgDir).split(path.sep).join('/');
  // data/ sits outside the served folder only if the repo moved; it is served from the repo root
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text().slice(0, 200)); });
  await p.goto(`http://localhost:${PORT}/bench/harness.html${process.argv.includes('--seg') ? '?seg=1' : ''}`);
  // --resume keeps what an interrupted run already wrote and reads only the rest
  const resume = process.argv.includes('--resume');
  const out = fs.existsSync(outp) && (ids || missing || resume) ? JSON.parse(fs.readFileSync(outp)) : {};
  const cdir = path.join(root, '.cache', 'ocr', path.basename(dir));
  fs.mkdirSync(path.dirname(path.resolve(outp)), { recursive: true });
  if (cache) fs.mkdirSync(cdir, { recursive: true });
  let n = 0;
  for (const t of truth) {
    if (split && t.split && t.split !== split) continue;
    if (ids && !ids.split(',').includes(t.file) && !ids.split(',').includes(t.id)) continue;
    if (missing && fs.existsSync(path.join(cdir, t.file + '.json'))) continue;
    if (resume && out[t.file]) continue;
    let r;
    try { r = await p.evaluate(([src, o]) => window.run(src, o), [`/${rel}/${t.file}`, cache ? { cacheRot: true } : {}]); }
    catch (e) { r = { ok: false, code: 'crash', error: String(e.message).slice(0, 300) }; }
    // flat: the words of the page pass; rot: the strip under the plot read turned 30/45/90 degrees
    if (cache && r.words) fs.writeFileSync(path.join(cdir, t.file + '.json'), JSON.stringify({ angle: r.angle, words: r.flat || r.words, rot: r.rot || null }));
    delete r.words; delete r.flat; delete r.rot;
    out[t.file] = r; n++;
    if (n % 10 === 0) fs.writeFileSync(outp, JSON.stringify(out));
    process.stdout.write(`${t.file} ${t.family || t.type} -> ${r.ok ? r.chartType + ' ' + r.series.map(s => s.type + ':' + s.points.length).join(',') + ' conf ' + (r.confidence || 0).toFixed(2) : 'FAIL ' + r.code}\n`);
  }
  fs.writeFileSync(outp, JSON.stringify(out));
  console.log(n, 'charts ->', outp);
  await b.close();
})();
