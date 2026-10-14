// Reads the text on a chart with tesseract.js, all inside the browser.
//
// Plain OCR is bad at charts: tick labels are tiny, often a single digit, and sit next to
// gridlines that it mistakes for text. So this does two things.
//   1. A normal pass over the whole image, kept only for real words (titles, legends, categories).
//   2. It finds the glyphs itself (small dark blobs that are not part of long lines), groups them
//      into labels, and pastes every label, enlarged, onto one clean "contact sheet". One OCR call
//      that only knows number characters then reads them all, and each reading maps back to its spot.
(function (root) {
  'use strict';
  let wordsP = null, numsP = null, textP = null;
  // the English model can be fetched by the page and handed over, so it can live under any file name
  let langBytes = null;
  async function lang(paths) {
    if (!paths || !paths.langFile) return 'eng';
    // the model ships as a script (base64), so it loads anywhere a script can, with no fetch needed
    if (!langBytes) langBytes = new Promise((ok, no) => {
      const done = () => { const b = atob(window.UNCHART_ENG), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); window.UNCHART_ENG = null; ok(u.buffer); };
      if (window.UNCHART_ENG) return done();
      const s = document.createElement('script'); s.src = paths.langFile; s.onload = done; s.onerror = () => no(Error('Could not load the text model')); document.head.appendChild(s);
    });
    return [{ code: 'eng', data: new Uint8Array((await langBytes).slice(0)) }];
  }
  function mk(paths, params) {
    return (async () => {
      const opts = Object.assign({ logger: () => {} }, paths || {}); delete opts.langFile;
      const w = await Tesseract.createWorker(await lang(paths), 1, opts);
      await w.setParameters(params);
      return w;
    })();
  }
  const letters = t => (t.match(/[A-Za-z]/g) || []).length;
  const overlap = (a, b) => { const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return 0; return ix * iy / Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))); };

  // ---------- find label-sized blobs of text ----------
  function findLabelBoxes(canvas) {
    const W = canvas.width, H = canvas.height, D = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    // background brightness: the most common gray level
    const hist = new Uint32Array(256), lum = new Uint8Array(W * H), sat = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const r = D[i], g = D[i + 1], b = D[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum[p] = (r * 299 + g * 587 + b * 114) / 1000; sat[p] = mx ? (mx - mn) * 255 / mx : 0; if (sat[p] < 40) hist[lum[p]]++;
    }
    let bgL = 0; for (let k = 1; k < 256; k++) if (hist[k] > hist[bgL]) bgL = k;
    // text is judged against its own surroundings, so faint gray labels on gray panels still count
    const dark = bgL < 110, R = 4;
    const ext = (src, isMax) => { const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = isMax ? 0 : 255; for (let k = Math.max(0, x - R); k <= Math.min(W - 1, x + R); k++) { const v = src[y * W + k]; if (isMax ? v > m : v < m) m = v; } t[y * W + x] = m; }
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = isMax ? 0 : 255; for (let k = Math.max(0, y - R); k <= Math.min(H - 1, y + R); k++) { const v = t[k * W + x]; if (isMax ? v > m : v < m) m = v; } o[y * W + x] = m; }
      return o; };
    const env = ext(lum, !dark);
    const ink = new Uint8Array(W * H);
    for (let p = 0; p < W * H; p++) if ((dark ? lum[p] - env[p] : env[p] - lum[p]) > 48 && sat[p] < 110) ink[p] = 1;
    // connected components
    const lab = new Int32Array(W * H), comps = [], st = [];
    for (let p = 0; p < W * H; p++) {
      if (!ink[p] || lab[p]) continue;
      const c = { x0: 1e9, y0: 1e9, x1: -1, y1: -1, n: 0 }; lab[p] = comps.length + 1; st.push(p);
      while (st.length) {
        const q = st.pop(), x = q % W, y = (q / W) | 0; c.n++;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const k = ny * W + nx; if (ink[k] && !lab[k]) { lab[k] = lab[p]; st.push(k); }
        }
      }
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; comps.push(c);
    }
    // glyphs: not long lines, not huge, not single specks
    const gl = comps.filter(c => c.h <= Math.min(64, H * 0.12) && c.w <= Math.max(c.h * 3.2, 9) && c.n >= 2 && !(c.w > 40 && c.h < 3) && !(c.h > 25 && c.w < 3));
    const tall = gl.filter(c => c.h >= 5).map(c => c.h).sort((a, b) => a - b);
    const hMed = tall.length ? tall[tall.length >> 1] : 10;
    // group glyphs into labels: same line, small gaps
    gl.sort((a, b) => a.x0 - b.x0);
    const boxes = [];
    for (const c of gl) {
      const cy = (c.y0 + c.y1) / 2;
      const b = boxes.find(b => c.x0 - b.x1 <= Math.max(3, Math.max(b.hh, c.h) * 0.75) && c.x0 >= b.x0 - 2 &&
        cy >= b.y0 - b.hh * 0.35 && cy <= b.y1 + b.hh * 0.35 && (c.h < 5 || Math.min(b.y1, c.y1) - Math.max(b.y0, c.y0) > Math.min(b.hh, c.h) * 0.4));
      if (b) { b.x0 = Math.min(b.x0, c.x0); b.x1 = Math.max(b.x1, c.x1); if (c.h >= 5) { b.y0 = Math.min(b.y0, c.y0); b.y1 = Math.max(b.y1, c.y1); b.hh = Math.max(b.hh, c.h); } b.k++; }
      else boxes.push({ x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, hh: c.h, k: 1 });
    }
    return boxes.filter(b => b.hh >= 5 && b.hh <= hMed * 2.6 && (b.x1 - b.x0) < W * 0.4).slice(0, 220);
  }

  // ---------- read many small labels in one go ----------
  async function readSheet(canvas, boxes, worker) {
    if (!boxes.length) return [];
    const TH = 44, PAD = 14, GAP = 34;
    const items = boxes.map(b => { const s = TH / (b.y1 - b.y0 + 1); return { b, s, w: Math.ceil((b.x1 - b.x0 + 1 + 4) * s) }; });
    const SW = Math.min(4000, Math.max(...items.map(i => i.w)) + PAD * 2);
    const sheet = document.createElement('canvas'); sheet.width = SW; sheet.height = items.length * (TH + GAP) + GAP;
    const g = sheet.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, sheet.width, sheet.height); g.imageSmoothingQuality = 'high';
    items.forEach((it, k) => {
      const y = GAP + k * (TH + GAP); it.y = y;
      g.drawImage(canvas, it.b.x0 - 2, it.b.y0 - 2, it.b.x1 - it.b.x0 + 5, it.b.y1 - it.b.y0 + 5, PAD, y - 2 * it.s, (it.b.x1 - it.b.x0 + 5) * it.s, (it.b.y1 - it.b.y0 + 5) * it.s);
    });
    // make it dark text on white, whatever the chart's colors were (labels on a dark chart get flipped one by one)
    const id = g.getImageData(0, 0, sheet.width, sheet.height), d = id.data;
    for (const it of items) {
      const y0 = Math.max(0, Math.floor(it.y - 2 * it.s)), y1 = Math.min(sheet.height, Math.ceil(it.y - 2 * it.s + (it.b.y1 - it.b.y0 + 5) * it.s));
      const x0 = PAD, x1 = Math.min(sheet.width, Math.ceil(PAD + (it.b.x1 - it.b.x0 + 5) * it.s));
      let sum = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * sheet.width + x) * 4; sum += d[i] + d[i + 1] + d[i + 2]; n++; }
      const inv = n && sum / n / 3 < 128;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * sheet.width + x) * 4; let L = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; if (inv) L = 255 - L; const v = Math.max(0, Math.min(255, (L - 60) * 1.6)); d[i] = d[i + 1] = d[i + 2] = v; }
    }
    g.putImageData(id, 0, 0);
    if (root.__debugSheet) root.__lastSheet = sheet.toDataURL();
    const { data } = await worker.recognize(sheet);
    const out = [];
    for (const ln of data.lines || []) {
      const cy = (ln.bbox.y0 + ln.bbox.y1) / 2;
      const it = items.find(i => cy >= i.y - GAP * 0.45 && cy <= i.y + TH + GAP * 0.45); if (!it) continue;
      const text = ln.words.map(w => w.text).join('').trim(); if (!text) continue;
      const wc = ln.words.map(w => w.confidence).filter(c => c > 0);
      out.push({ text, conf: wc.length ? wc.reduce((a, b) => a + b, 0) / wc.length : Math.max(ln.confidence, 50), x0: it.b.x0, y0: it.b.y0, x1: it.b.x1 + 1, y1: it.b.y1 + 1, src: 'sheet' });
    }
    return out;
  }

  async function readWords(canvas, paths) {
    const W = canvas.width, H = canvas.height;
    if (!wordsP) wordsP = mk(paths, { tessedit_pageseg_mode: '11' });
    if (!numsP) numsP = mk(paths, { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789.,-%$kKMB−' });
    if (!textP) textP = mk(paths, { tessedit_pageseg_mode: '6' });
    const f = Math.max(1, Math.min(3, 2200 / Math.max(W, 1)));
    const big = document.createElement('canvas'); big.width = Math.round(W * f); big.height = Math.round(H * f);
    const g = big.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, big.width, big.height); g.drawImage(canvas, 0, 0, big.width, big.height);
    const boxes = findLabelBoxes(canvas);
    const [A, nums, labels] = await Promise.all([
      wordsP.then(w => w.recognize(big)),
      numsP.then(w => readSheet(canvas, boxes, w)),
      textP.then(w => readSheet(canvas, boxes, w)),
    ]);
    const allA = (A.data.words || []).map(wd => ({ text: wd.text.trim(), conf: wd.confidence, x0: wd.bbox.x0 / f, y0: wd.bbox.y0 / f, x1: wd.bbox.x1 / f, y1: wd.bbox.y1 / f }))
      .filter(w => w.text && (w.y1 - w.y0) < H * 0.12);
    const words = allA.filter(w => letters(w.text) >= 2 && w.conf > 50);
    // short words next to a confident word on the same line ("In" in "In store") are kept too
    for (const w of allA) {
      if (words.includes(w) || !letters(w.text) || w.conf < 25) continue;
      const h = w.y1 - w.y0;
      if (words.some(o => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.4 && (Math.abs(o.x0 - w.x1) < h * 0.9 || Math.abs(w.x0 - o.x1) < h * 0.9))) words.push(w);
    }
    // whole labels read from the sheet beat word fragments from the page pass ("In store", not "store")
    for (const L of labels) {
      if (letters(L.text) < 2 || L.conf < 60) continue;
      const hit = words.filter(a => overlap(a, L) > 0.5);
      if (!hit.length) { if (L.conf > 80 && letters(L.text) >= 3) words.push({ ...L }); continue; }
      if (L.text.length > hit.map(a => a.text).join(' ').length) { for (const a of hit) words.splice(words.indexOf(a), 1); words.push({ ...L }); }
    }
    const out = words.slice();
    for (const n of nums) {
      if (!/\d/.test(n.text)) continue;
      if (words.some(a => overlap(a, n) > 0.4 && letters(a.text) >= 2 && a.conf > 70)) continue;
      out.push(n);
    }
    return out;
  }
  root.UnchartOCR = { readWords, _findLabelBoxes: findLabelBoxes };
})(window);
