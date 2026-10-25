// Runs the example charts through the real pipeline and saves the results, so the app opens already working.
// usage: node precompute.js
const { chromium } = require('playwright'); const fs = require('fs');
const EX = ['ex_line.png', 'ex_bars.png', 'ex_dots.png', 'ex_pie.png', 'ex_hbars.png', 'ex_rates.png'];
(async () => {
  const srv = process.env.PORT ? null : await require('./bench/serve.js').serve();
  const PORT = process.env.PORT || srv.port;
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(`http://localhost:${PORT}/bench/harness.html`);
  const out = {};
  for (const f of EX) {
    out[f] = await p.evaluate(async f => {
      const im = new Image(); im.src = '/examples/' + f; await im.decode();
      const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0);
      const { res, words } = await UnchartOCR.readChart(c, PATHS, {});
      const r = JSON.parse(JSON.stringify(res));
      r.ms = Math.round(res.ms_total);
      r.words = words.map(w => ({ text: w.text, conf: Math.round(w.conf), x0: +w.x0.toFixed(1), y0: +w.y0.toFixed(1), x1: +w.x1.toFixed(1), y1: +w.y1.toFixed(1) }));
      return r;
    }, f);
    const r = out[f];
    console.log(f, r.ok, r.chartType, r.ms + ' ms', 'confidence ' + (r.confidence || 0).toFixed(2), (r.series || []).map(s => s.name + ':' + s.points.length).join(' '));
  }
  fs.writeFileSync('examples/precomputed.js', 'window.UNCHART_EXAMPLES=' + JSON.stringify(out) + ';');
  await b.close(); if (srv) srv.close();
})();
