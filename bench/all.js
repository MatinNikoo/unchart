// Runs the whole benchmark: every set through the app's pipeline in headless Chromium, then the scoring and the report.
// usage: node bench/all.js [--only test] [--skip-run] [--resume]
// Serves the repo itself on a free port, so nothing else needs to be running.
const fs = require('fs'), path = require('path'), http = require('http'), { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2), only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null, skipRun = args.includes('--skip-run'), resume = args.includes('--resume');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((q, s) => {
  const p = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(s);
});
// [name, set dir, split, results file]
// (synthetic test v1 was scored by engine v1, kept in results/v1; it is in the list so a rerun can repeat it)
const SETS = [
  ['synthetic-test2', 'dataset/synthetic-test2', null, 'results/synthetic_test2.json'],
  ['families-test', 'dataset/synthetic-families-test', null, 'results/families_test.json'],
  ['owid-test', 'dataset/real-owid', 'test', 'results/owid_test.json'],
  ['fred', 'data/real-fred', null, 'results/fred.json'],
  ['charts', 'charts', null, 'results/v2_charts.json'],
  ['charts2', 'charts2', null, 'results/v2_charts2.json'],
  ['charts3', 'charts3', null, 'results/v2_charts3.json'],
  ['synthetic-dev', 'dataset/synthetic-dev', null, 'results/synthetic_dev.json'],
  ['owid-dev', 'dataset/real-owid', 'dev', 'results/owid_dev.json'],
  ['families-dev', 'dataset/synthetic-families-dev', null, 'results/families_dev.json'],
  ['synthetic-test', 'dataset/synthetic-test', null, 'results/synthetic_test.json'],
];
// children run asynchronously, so this process keeps serving files to the browser while they work
const run = (cmd, a, env, outFile) => new Promise((ok, no) => {
  console.log('>', cmd, a.join(' '));
  const c = spawn(cmd, a, { cwd: ROOT, stdio: outFile ? ['ignore', 'pipe', 'inherit'] : 'inherit', env: Object.assign({}, process.env, env || {}) });
  let buf = ''; if (outFile) c.stdout.on('data', d => { buf += d; });
  c.on('close', code => { if (outFile) fs.writeFileSync(outFile, buf); code ? no(Error(cmd + ' ' + a[0] + ' failed')) : ok(); });
});
server.listen(0, '127.0.0.1', async () => {
  const PORT = String(server.address().port);
  try {
    // the repo holds a few pictures per set, so unpack the full sets first (nothing happens when they are already there)
    if (!skipRun) await run('python3', ['bench/get_dataset.py']).catch(e => console.log('could not get the full datasets,', e.message));
    for (const [name, dir, split, out] of SETS) {
      if (only && !name.includes(only)) continue;
      if (!fs.existsSync(path.join(ROOT, dir, 'truth.json'))) { console.log('skipping', name, '(not fetched)'); continue; }
      if (!skipRun) await run('node', ['bench/run.js', dir, out].concat(split ? ['--split', split] : [], resume ? ['--resume'] : []), { PORT });
      await run('python3', ['bench/score.py', dir, out, '--quiet', '--out', out.replace('.json', '_scored.json')].concat(split ? ['--split', split] : []));
      // the v1 sets are also scored with the v1 scorer, so the regression check uses the exact old metric
      if (/^charts/.test(name)) {
        await run('python3', ['legacy/score.py', out], { DIR: dir }, path.join(ROOT, out.replace('.json', '_v1metric.txt')));
      }
    }
    await run('python3', ['bench/report.py']);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
  server.close();
});
