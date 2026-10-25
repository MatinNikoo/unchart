// Draws the web training specs (bench/seg/gen_web.py) and labels their pixels by redrawing each series in a far
// away color.
// usage: node bench/seg/gen_web.js <out dir> <specs json>
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { serve } = require('../serve.js');
(async () => {
  const out = process.argv[2], specs = JSON.parse(fs.readFileSync(process.argv[3]));
  const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'plotly_templates.json')));
  const srv = await serve(), PORT = srv.port;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  await p.goto(`http://localhost:${PORT}/bench/render_web.html`);
  await p.evaluate(t => { window.TEMPLATES = t; }, tpl);
  await p.evaluate(() => {
    window.pix = async url => { const im = new Image(); im.src = url; await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height); };
    const far = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
      return ['#000000', '#ffffff', '#ff00ff', '#00ff00', '#0000ff', '#ffff00'].map(q => [q, Math.hypot(...[1, 3, 5].map((i, k) => parseInt(q.slice(i, i + 2), 16) - c[k]))]).sort((a, b) => b[1] - a[1])[0][0]; };
    window.label = async s => {
      const base = await window.render(JSON.parse(JSON.stringify(s))), A = await pix(base.png), W = A.width, H = A.height, N = W * H;
      const lab = new Uint8Array(N).fill(5), best = new Int16Array(N);
      for (let j = 0; j < s.palette.length; j++) {
        const t = JSON.parse(JSON.stringify(s)); t.palette[j] = far(s.palette[j]);
        const B = await pix((await window.render(t)).png);
        if (B.width !== W || B.height !== H) return { err: 'size changed' };
        for (let q = 0; q < N; q++) { const i = q * 4, d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
          if (d > 30 && d >= best[q]) { lab[q] = 10 + j; best[q] = d; } }
      }
      const pl = base.info.plot;
      if (pl) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = y * W + x; if (lab[q] >= 10 && (x < pl[0] - 3 || x > pl[2] + 3 || y < pl[1] - 3 || y > pl[3] + 3)) lab[q] = 3; }
      const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), D = g.createImageData(W, H);
      for (let q = 0; q < N; q++) { D.data[q * 4] = D.data[q * 4 + 1] = D.data[q * 4 + 2] = lab[q]; D.data[q * 4 + 3] = 255; }
      g.putImageData(D, 0, 0);
      return { png: base.png, lab: c.toDataURL('image/png'), plot: pl || null };
    };
  });
  let n = 0;
  for (const s of specs) {
    try {
      const r = await p.evaluate(s => window.label(s), s);
      if (r.err) { console.log(s.idx, r.err); continue; }
      const f = k => path.join(out, String(s.idx).padStart(5, '0') + k);
      fs.writeFileSync(f('_raw.png'), Buffer.from(r.png.split(',')[1], 'base64'));
      fs.writeFileSync(f('_rlab.png'), Buffer.from(r.lab.split(',')[1], 'base64'));
      if (!r.plot) console.log(s.idx, s.renderer, 'no plot box');
      n++;
    } catch (e) { console.log(s.idx, s.renderer, s.family, 'FAILED', e.message.slice(0, 150)); }
  }
  console.log(n, 'drawn');
  await b.close(); srv.close();
})();
