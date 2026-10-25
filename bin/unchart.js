#!/usr/bin/env node
// Batch mode: read every chart in a set of images, folders or PDFs and write CSV and JSON.
// Runs the same in-browser reader as the app inside headless Chromium. Nothing leaves your machine.
//
//   node bin/unchart.js report.pdf charts/ shot.png --out unchart-out
//   options: --out DIR (default unchart-out), --type auto|bar|line|... , --whole (one chart per image, skip detection),
//   --mark-model (try the experimental mark model, off by default)
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); if (i < 0) return d; const v = args[i + 1]; args.splice(i, 2); return v; };
const flag = k => { const i = args.indexOf(k); if (i < 0) return false; args.splice(i, 1); return true; };
const out = opt('--out', 'unchart-out'), type = opt('--type', 'auto'), whole = flag('--whole'), model = flag('--mark-model');
if (!args.length || flag('--help')) { console.log('usage: node bin/unchart.js <images, folders or PDFs> [--out DIR] [--type auto] [--whole] [--mark-model]'); process.exit(args.length ? 0 : 1); }

const EXT = /\.(png|jpe?g|webp|gif|bmp|pdf)$/i;
const files = [];
for (const a of args) {
  if (!fs.existsSync(a)) { console.error('not found:', a); continue; }
  if (fs.statSync(a).isDirectory()) for (const f of fs.readdirSync(a).sort()) { if (EXT.test(f)) files.push(path.join(a, f)); }
  else if (EXT.test(a)) files.push(a);
}
if (!files.length) { console.error('no images or PDFs to read'); process.exit(1); }

let lib;
try { require.resolve('playwright'); lib = require('../lib/unchart.js'); } catch (e) { console.error('Run npm install first (the batch tool drives a headless Chromium through playwright).'); process.exit(1); }

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const all = await lib.readFiles(files, { type, whole, model, onResult: (r, n) => {
    const base = path.basename(r.file).replace(/\.[^.]+$/, '') + (n > 1 || /\.pdf$/i.test(r.file) ? `_p${r.page}_c${r.chart}` : '');
    r.name = base;
    if (r.ok) fs.writeFileSync(path.join(out, base + '.csv'), lib.toCSV(r) + '\n');
    const tag = !r.ok ? `FAILED: ${r.error}` : `${r.chartType}, ${r.series.length} series, confidence ${(r.confidence * 100).toFixed(0)}%${r.reliable ? '' : ' (NOT RELIABLE: ' + (r.issues.map(i => i.text).join(' ') || 'the chart did not look clean enough to trust every number.') + ')'}`;
    console.log(`${base}: ${tag}`);
  } });
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(all, null, 1));
  console.log(`${all.filter(r => r.ok).length} of ${all.length} charts read, ${all.filter(r => r.ok && !r.reliable).length} flagged as not reliable. Output in ${out}/`);
})();
