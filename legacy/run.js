// Runs every benchmark chart through the app's own engine in a real browser and saves the results.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8790;
(async () => {
  const DIR = process.env.DIR || 'charts';
  const truth = JSON.parse(fs.readFileSync(path.join(__dirname, '..', DIR, 'truth.json')));
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(`http://localhost:${PORT}/bench/harness.html`);
  const out = {};
  for (const t of truth) {
    if (only && !only.includes(t.file)) continue;
    const r = await p.evaluate(src => window.run(src), `/${DIR}/${t.file}`);
    out[t.file] = r;
    process.stdout.write(`${t.file} ${t.type} ${r.ok ? r.series.map(s => s.type + ':' + s.points.length).join(',') : 'FAIL ' + r.error}\n`);
  }
  fs.writeFileSync(path.join(__dirname, only ? 'results_partial.json' : 'results_' + DIR.replace(/[^a-z0-9]/gi, '') + '.json'), JSON.stringify(out));
  await b.close();
})();
