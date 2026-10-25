// Makes an OCR cache (same layout as .cache/ocr) from the tesseract cache plus raw PP readings, with the same
// merge the app runs (UnchartPP.numText and pickNumbers). Replay it with OCR_CACHE=<out dir> node bench/run_node.js.
// usage: node bench/ppocr/merge.js <set name> <raw dir> <out dir> <prefer: pp|tess|auto|only> [minConf]
// PPWORDS=97 also lets a sure PP reading of a word label replace the tesseract words in its box.
const fs = require('fs'), path = require('path');
const R = path.join(__dirname, '..', '..');
const U = require(R + '/src/engine.js'), PP = require(R + '/src/ppocr.js');
const [set, rawDir, outDir, policy] = process.argv.slice(2), minConf = +(process.argv[6] || 0);
const letters = t => (t.match(/[A-Za-z]/g) || []).length;
const wordy = t => letters(t) >= 2 || /^[QH][1-4]\b/i.test(t) || /^[A-Za-z][\s']?\d{2,4}$/.test(t);
const overlap = (a, b) => { const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (ix <= 0 || iy <= 0) return 0; return ix * iy / Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))); };
const cin = path.join(process.env.TESS_CACHE || path.join(R, '.cache', 'ocr_v2'), set), cout = path.join(outDir, set); fs.mkdirSync(cout, { recursive: true });
for (const f of fs.readdirSync(path.join(rawDir, set))) {
  const c = JSON.parse(fs.readFileSync(path.join(cin, f)));
  const raw = JSON.parse(fs.readFileSync(path.join(rawDir, set, f)));
  const W = c.words.map(w => ({ text: w[0], conf: w[1], x0: w[2], y0: w[3], x1: w[4], y1: w[5] }));
  const keep = W.filter(w => wordy(w.text) || !/\d/.test(w.text));
  const tessNums = W.filter(w => !keep.includes(w));
  const items = raw.map(r => {
    const b = { x0: r[0], y0: r[1], x1: r[2], y1: r[3] };
    let pp = r.length > 4 ? PP.numText({ text: r[4], conf: r[5], num: { text: r[6], conf: r[7] } }) : null;
    if (pp && pp.conf < minConf) pp = null;
    return { b, pp, tn: policy === 'only' ? null : tessNums.find(w => overlap(w, b) > 0.6) || null };
  });
  const pick = PP.pickNumbers(items, U.parseNumber, policy);
  const used = new Set(items.map(it => it.tn).filter(Boolean));
  const nums = items.map((it, i) => pick[i] && { text: pick[i].text, conf: pick[i].conf, ...it.b }).filter(Boolean).concat(tessNums.filter(n => !used.has(n) && policy !== 'only'));
  // word labels: a sure PP reading of a whole box replaces the tesseract words inside it when they differ
  let kept = keep;
  if (process.env.PPWORDS) {
    const wc = +process.env.PPWORDS;
    kept = keep.slice();
    raw.forEach(r => {
      if (r.length < 5 || r[5] < wc || !wordy(r[4])) return;
      const b = { x0: r[0], y0: r[1], x1: r[2], y1: r[3] };
      const hit = kept.filter(a => wordy(a.text) && overlap(a, b) > 0.5);
      if (!hit.length) return;
      const tt = hit.sort((a, c) => a.x0 - c.x0).map(a => a.text).join(' ');
      if (tt.replace(/\s/g, '') === r[4].replace(/\s/g, '')) return;
      for (const a of hit) kept.splice(kept.indexOf(a), 1);
      kept.push({ text: r[4], conf: r[5], x0: Math.min(b.x0, ...hit.map(a => a.x0)), y0: Math.min(b.y0, ...hit.map(a => a.y0)), x1: Math.max(b.x1, ...hit.map(a => a.x1)), y1: Math.max(b.y1, ...hit.map(a => a.y1)) });
    });
  }
  const out = kept.concat(nums.filter(n => !kept.some(a => overlap(a, n) > 0.4 && wordy(a.text) && a.conf > 70)));
  fs.writeFileSync(path.join(cout, f), JSON.stringify({ angle: c.angle, words: out.map(w => [w.text, w.conf, w.x0, w.y0, w.x1, w.y1]), rot: c.rot }));
}
