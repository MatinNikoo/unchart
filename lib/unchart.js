// Node API: read charts from image files and PDFs with the same in-browser reader the app uses, run inside headless
// Chromium (playwright). Nothing leaves your machine.
//
//   const { readFiles, toCSV } = require('./lib/unchart.js');
//   const results = await readFiles(['report.pdf', 'shot.png'], { type: 'auto' });
//   // one result per chart found: { file, page, chart, ok, chartType, confidence, reliable, issues, series: [...] }
const fs = require('fs'), path = require('path'), http = require('http');
const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };

function toCSV(r) {
  const q = v => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const num = v => typeof v === 'number' ? +v.toPrecision(8) : v;
  const S = r.series;
  if (r.chartType === 'pie' || r.chartType === 'donut') return ['slice,share_percent', ...S[0].points.map(p => [q(p.x), num(p.y)].join(','))].join('\n');
  if (S.every(s => s.type === 'scatter')) return ['series,x,y', ...S.flatMap(s => s.points.map(p => [q(s.name), num(p.x), num(p.y)].join(',')))].join('\n');
  const keys = [], rows = new Map();
  S.forEach((s, j) => s.points.forEach(p => { const k = String(p.x); if (!rows.has(k)) { rows.set(k, { x: p.x, v: [] }); keys.push(k); } rows.get(k).v[j] = p.y; }));
  return [['x', ...S.map(s => q(s.name))].join(','), ...keys.map(k => [q(rows.get(k).x), ...S.map((_, j) => num(rows.get(k).v[j]))].join(','))].join('\n');
}

// files: paths to images or PDFs. opts.type: 'auto' or a chart type; opts.whole: one chart per image (no detection);
// opts.model: true turns the experimental mark model on. opts.onResult(r): called as each chart is read.
async function readFiles(files, opts = {}) {
  const { chromium } = require('playwright');
  const server = http.createServer((q, s) => {
    const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
  });
  await new Promise(ok => server.listen(0, '127.0.0.1', ok));
  const b = await chromium.launch();
  const all = [];
  try {
    const page = await b.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/bin/batch.html${opts.model ? '?model=1' : ''}`);
    for (const f of files) {
      let res;
      try { res = await page.evaluate(([n, d, o]) => window.readFile(n, d, o), [path.basename(f), fs.readFileSync(f).toString('base64'), { type: opts.type || 'auto', whole: !!opts.whole }]); }
      catch (e) { res = [{ page: 1, chart: 1, ok: false, error: 'could not read the file (' + e.message.split('\n')[0] + ')' }]; }
      if (!res.length) res = [{ page: 1, chart: 1, ok: false, error: 'no chart found' }];
      for (const r of res) { r.file = f; all.push(r); if (opts.onResult) opts.onResult(r, res.length); }
    }
  } finally { await b.close(); server.close(); }
  return all;
}

module.exports = { readFiles, toCSV };
