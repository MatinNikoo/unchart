// Draws the Chart.js, Vega-Lite, ECharts and Plotly charts of a split in headless Chromium.
// usage: node bench/render_web.js dev|test [ids]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const PORT = process.env.PORT || 8790;
(async () => {
  const split = process.argv[2], only = process.argv[3] ? process.argv[3].split(',') : null;
  const dir = path.join(__dirname, '..', 'dataset', 'synthetic-' + split);
  const specs = JSON.parse(fs.readFileSync(path.join(dir, 'specs.json')));
  const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, 'plotly_templates.json')));
  const ip = path.join(dir, 'raw', 'info_web.json');
  const info = fs.existsSync(ip) ? JSON.parse(fs.readFileSync(ip)) : {};
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('console', m => { if (m.type() === 'error') console.log('console:', m.text()); });
  await p.goto(`http://localhost:${PORT}/bench/render_web.html`);
  await p.evaluate(t => { window.TEMPLATES = t; }, tpl);
  let n = 0;
  for (const s of specs) {
    if (!['chartjs', 'vegalite', 'echarts', 'plotly'].includes(s.renderer) || (only && !only.includes(s.id))) continue;
    try {
      const r = await p.evaluate(s => window.render(s), s);
      fs.writeFileSync(path.join(dir, 'raw', s.id + '.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      info[s.id] = r.info; n++;
      if (r.info.err) console.log(s.id, s.renderer, s.family, 'info error', r.info.err);
    } catch (e) { console.log(s.id, s.renderer, s.family, 'FAILED', e.message.slice(0, 200)); }
  }
  fs.writeFileSync(ip, JSON.stringify(info));
  console.log(n, 'drawn');
  await b.close();
})();
