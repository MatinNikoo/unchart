// Reads the text on a chart with tesseract.js (and the PP-OCRv5 recognizer when it is given), all in the browser.
// Tick labels are tiny and sit next to gridlines, so a normal OCR pass misses most of them. This file reads the
// whole picture once for titles, legends and category names, then finds the glyphs itself, groups them into
// labels and reads every label from one enlarged contact sheet that only knows number characters.
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
  // a label worth keeping: a real word, or a short code like Q1, H2 or Q3 2024
  const wordy = t => letters(t) >= 2 || /^[QH][1-4]\b/i.test(t) || /^[A-Za-z][\s']?\d{2,4}$/.test(t);
  const overlap = (a, b) => { const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    if (ix <= 0 || iy <= 0) return 0; return ix * iy / Math.max(1, Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0))); };

  // ---------- find label-sized blobs of text ----------
  function findLabelBoxes(canvas, cutOverride) {
    const W = canvas.width, H = canvas.height, D = canvas.getContext('2d').getImageData(0, 0, W, H).data;
    // background brightness: the most common gray level
    const hist = new Uint32Array(256), lum = new Uint8Array(W * H), sat = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const r = D[i], g = D[i + 1], b = D[i + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      lum[p] = (r * 299 + g * 587 + b * 114) / 1000; sat[p] = mx ? (mx - mn) * 255 / mx : 0; if (sat[p] < 40) hist[lum[p]]++;
    }
    let bgL = 0; for (let k = 1; k < 256; k++) if (hist[k] > hist[bgL]) bgL = k;
    // a colored theme (navy) has few gray pixels; the edge of the picture shows its real background
    const edge = []; for (let x = 0; x < W; x += 3) edge.push(lum[W + x], lum[(H - 2) * W + x]); for (let y = 0; y < H; y += 3) edge.push(lum[y * W + 1], lum[y * W + W - 2]);
    edge.sort((a, b) => a - b); const eL = edge[edge.length >> 1];
    if (edge.filter(v => Math.abs(v - eL) < 20).length > edge.length * 0.6 && Math.abs(eL - bgL) > 60) bgL = eL;
    // text is judged against its own surroundings, so faint gray labels on gray panels still count
    const dark = bgL < 110, R = 4;
    const ext = (src, isMax) => { const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let m = isMax ? 0 : 255; for (let k = Math.max(0, x - R); k <= Math.min(W - 1, x + R); k++) { const v = src[y * W + k]; if (isMax ? v > m : v < m) m = v; } t[y * W + x] = m; }
      for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = isMax ? 0 : 255; for (let k = Math.max(0, y - R); k <= Math.min(H - 1, y + R); k++) { const v = t[k * W + x]; if (isMax ? v > m : v < m) m = v; } o[y * W + x] = m; }
      return o; };
    const env = ext(lum, !dark);
    const ink = new Uint8Array(W * H);
    // (strong contrast counts even in color: plotly's navy gray labels are fairly saturated)
    // faint gray labels on a small picture only reach 50 or 60 levels of contrast: the cut adapts to the strongest text
    const ch = new Uint32Array(256); let nc = 0;
    for (let p = 0; p < W * H; p++) { if (sat[p] >= 110) continue; const c = dark ? lum[p] - env[p] : env[p] - lum[p]; if (c > 10) { ch[Math.min(255, c | 0)]++; nc++; } }
    let acc = 0, c995 = 255; for (let k = 255; k >= 0; k--) { acc += ch[k]; if (acc >= nc * 0.005) { c995 = k; break; } }
    const cut = cutOverride || Math.max(24, Math.min(48, c995 * 0.4));
    for (let p = 0; p < W * H; p++) { const c = dark ? lum[p] - env[p] : env[p] - lum[p]; if ((c > cut && sat[p] < 110) || (c > 110 && sat[p] < 170)) ink[p] = 1; }
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
    // the typical label height comes from boxes of two or more glyphs: the pieces of a thin sloped line are many
    // small single "glyphs" and would drag a plain median down until real labels look too tall
    // (weighted by width: a label is wide, a piece of a dashed line is not)
    const multi = boxes.filter(b => b.k >= 2 && b.hh >= 5).sort((a, b) => a.hh - b.hh);
    let hRef = hMed;
    if (multi.length >= 3) { const tot = multi.reduce((a, b) => a + b.x1 - b.x0 + 1, 0); let acc = 0; for (const b of multi) { acc += b.x1 - b.x0 + 1; if (acc >= tot / 2) { hRef = Math.max(hMed, b.hh); break; } } }
    const out = boxes.filter(b => b.hh >= 5 && b.hh <= hRef * 2.6 && (b.x1 - b.x0) < W * 0.4).slice(0, 220);
    // very faint labels (a small, washed out picture): look again with a lower cut
    if (out.length < 6 && !cutOverride && cut > 20) { const again = findLabelBoxes(canvas, 16); if (again.length > out.length) return again; }
    return out;
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
      // stretch each label's own range to full black on white: light gray tick labels otherwise come out too faint
      const Ls = [];
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * sheet.width + x) * 4; let L = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000; if (inv) L = 255 - L; Ls.push(L); }
      const srt = Float32Array.from(Ls).sort(), lo = srt[Math.floor(srt.length * 0.02)] || 0, hi = srt[Math.floor(srt.length * 0.6)] || 255;
      const span = Math.max(40, hi - lo);
      let k = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * sheet.width + x) * 4; let v = Math.max(0, Math.min(255, (Ls[k++] - lo) / span * 255 * 1.1)); d[i] = d[i + 1] = d[i + 2] = v; }
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

  // the PP-OCR reader for number labels (src/ppocr.js), when the page passes paths.pp = {ort, wasm, model, dict}.
  // Without it, or if it fails to load, tesseract reads the numbers alone like before.
  let ppP = null;
  function ppReady(paths) {
    if (!paths || !paths.pp || !root.UnchartPP) return null;
    if (!ppP) ppP = (async () => {
      if (!root.ort) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = paths.pp.ort; s.onload = ok; s.onerror = () => no(Error('Could not load onnxruntime')); document.head.appendChild(s); });
      root.ort.env.wasm.wasmPaths = paths.pp.wasm; root.ort.env.wasm.numThreads = 1;
      const [m, d] = await Promise.all([fetch(paths.pp.model).then(r => r.arrayBuffer()), fetch(paths.pp.dict).then(r => r.text())]);
      await root.UnchartPP.init(root.ort, new Uint8Array(m), d);
      return true;
    })().catch(e => { console.warn('number reader off:', e.message); return false; });
    return ppP;
  }

  async function readWords(canvas, paths) {
    const W = canvas.width, H = canvas.height;
    if (!wordsP) wordsP = mk(paths, { tessedit_pageseg_mode: '11' });
    if (!numsP) numsP = mk(paths, { tessedit_pageseg_mode: '6', tessedit_char_whitelist: '0123456789.,-+%$kKMBe−' });
    if (!textP) textP = mk(paths, { tessedit_pageseg_mode: '6' });
    const f = Math.max(1, Math.min(3, 2200 / Math.max(W, 1)));
    const big = document.createElement('canvas'); big.width = Math.round(W * f); big.height = Math.round(H * f);
    const g = big.getContext('2d'); g.imageSmoothingQuality = 'high'; g.fillStyle = '#fff'; g.fillRect(0, 0, big.width, big.height); g.drawImage(canvas, 0, 0, big.width, big.height);
    // small pictures (a downscaled screenshot) have labels only a few pixels tall: find them on a 2x copy
    let lc = canvas, sf = 1, boxes = findLabelBoxes(canvas);
    const hs = boxes.map(b => b.hh).sort((a, b) => a - b), hMed = hs.length ? hs[hs.length >> 1] : 0;
    if (!hs.length || hMed < 8 || Math.max(W, H) < 700) {
      sf = 2; lc = document.createElement('canvas'); lc.width = W * sf; lc.height = H * sf;
      const g2 = lc.getContext('2d'); g2.imageSmoothingQuality = 'high'; g2.drawImage(canvas, 0, 0, lc.width, lc.height);
      boxes = findLabelBoxes(lc);
    }
    const back = list => list.map(q => Object.assign(q, { x0: q.x0 / sf, y0: q.y0 / sf, x1: q.x1 / sf, y1: q.y1 / sf }));
    const bxs = boxes.map(b => ({ x0: b.x0 / sf, y0: b.y0 / sf, x1: (b.x1 + 1) / sf, y1: (b.y1 + 1) / sf }));
    const ppR = ppReady(paths);
    const [A, nums, labels, pp] = await Promise.all([
      wordsP.then(w => w.recognize(big)),
      numsP.then(w => readSheet(lc, boxes, w)).then(back),
      textP.then(w => readSheet(lc, boxes, w)).then(back),
      ppR ? ppR.then(ok => ok ? root.UnchartPP.readBoxes(canvas.getContext('2d').getImageData(0, 0, W, H), bxs) : null) : null,
    ]);
    const allA = (A.data.words || []).map(wd => ({ text: wd.text.trim(), conf: wd.confidence, x0: wd.bbox.x0 / f, y0: wd.bbox.y0 / f, x1: wd.bbox.x1 / f, y1: wd.bbox.y1 / f }))
      .filter(w => w.text && (w.y1 - w.y0) < H * 0.12);
    const words = allA.filter(w => wordy(w.text) && w.conf > 50);
    // short words next to a confident word on the same line ("In" in "In store") are kept too
    for (const w of allA) {
      if (words.includes(w) || !letters(w.text) || w.conf < 25) continue;
      const h = w.y1 - w.y0;
      if (words.some(o => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.4 && (Math.abs(o.x0 - w.x1) < h * 0.9 || Math.abs(w.x0 - o.x1) < h * 0.9))) words.push(w);
    }
    // whole labels read from the sheet beat word fragments from the page pass ("In store", not "store")
    for (const L of labels) {
      if (!wordy(L.text) || L.conf < 60) continue;
      const hit = words.filter(a => overlap(a, L) > 0.5);
      if (!hit.length) { if (L.conf > 80 && (letters(L.text) >= 3 || wordy(L.text))) words.push({ ...L }); continue; }
      if (L.text.length > hit.map(a => a.text).join(' ').length) { for (const a of hit) words.splice(words.indexOf(a), 1); words.push({ ...L }); }
    }
    // a sure PP reading of a whole word label (a legend entry, a date like Sep 01) replaces the tesseract words in it
    if (pp) bxs.forEach((b, i) => {
      const r = pp[i];
      if (!r || r.conf < (paths.pp.wordConf || 97) || !wordy(r.text)) return;
      const hit = words.filter(a => wordy(a.text) && overlap(a, b) > 0.5).sort((a, c) => a.x0 - c.x0);
      if (!hit.length || hit.map(a => a.text).join('') === r.text.replace(/\s/g, '')) return;
      for (const a of hit) words.splice(words.indexOf(a), 1);
      words.push({ text: r.text, conf: r.conf, x0: Math.min(b.x0, ...hit.map(a => a.x0)), y0: Math.min(b.y0, ...hit.map(a => a.y0)), x1: Math.max(b.x1, ...hit.map(a => a.x1)), y1: Math.max(b.y1, ...hit.map(a => a.y1)) });
    });
    const out = words.slice();
    let numsF = nums.filter(n => /\d/.test(n.text));
    // both readers on every label box; where they disagree the reading that fits its axis line wins
    if (pp) {
      // an unsure PP reading of a box is mostly a speck or a piece of a word, not a label
      const sure = q => q && q.conf >= (paths.pp.minConf != null ? paths.pp.minConf : 80) ? q : null;
      const items = bxs.map((b, i) => ({ b, tn: numsF.find(n => overlap(n, b) > 0.6) || null, pp: sure(root.UnchartPP.numText(pp[i])) }));
      const pick = root.UnchartPP.pickNumbers(items, root.Unchart.parseNumber, paths.pp.prefer || 'pp');
      const used = new Set(items.map(it => it.tn).filter(Boolean));
      numsF = items.map((it, i) => pick[i] && { text: pick[i].text, conf: pick[i].conf, x0: it.b.x0, y0: it.b.y0, x1: it.b.x1, y1: it.b.y1, src: 'sheet' })
        .filter(Boolean).concat(numsF.filter(n => !used.has(n)));
    }
    for (const n of numsF) {
      if (words.some(a => overlap(a, n) > 0.4 && wordy(a.text) && a.conf > 70)) continue;
      out.push(n);
    }
    return out;
  }
  // OCR the strip under the plot turned by deg degrees (clockwise), and put each label back at its anchor:
  // angled tick labels end at their tick, so the anchor is the label's right end.
  async function readRotated(canvas, rect, deg, paths) {
    if (!rect) return [];
    const y0 = Math.max(0, Math.round(rect.bottom + 1)), sh = canvas.height - y0, sw = canvas.width;
    if (sh < 12) return [];
    const a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a), f = 2;
    const RW = Math.ceil((sw * cs + sh * sn) * f), RH = Math.ceil((sw * sn + sh * cs) * f);
    const rc = document.createElement('canvas'); rc.width = RW; rc.height = RH;
    const g = rc.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, RW, RH); g.imageSmoothingQuality = 'high';
    // rotate about the strip's top left corner, shifted so everything stays on the canvas
    g.setTransform(f * cs, f * sn, -f * sn, f * cs, f * sh * sn, 0);
    g.drawImage(canvas, 0, y0, sw, sh, 0, 0, sw, sh);
    if (!wordsP) return [];
    const { data } = await (await wordsP).recognize(rc);
    const out = [];
    for (const wd of data.words || []) {
      const t = wd.text.trim(); if (!t || wd.confidence < 50) continue;
      // the right end of the word, halfway up, back into strip coordinates (undo the scale, shift and rotation)
      const X = wd.bbox.x1 / f - sh * sn, Y = (wd.bbox.y0 + wd.bbox.y1) / 2 / f;
      const sx = X * cs + Y * sn, sy = -X * sn + Y * cs;
      if (sx < 0 || sx > sw || sy < 0 || sy > sh) continue;
      out.push({ text: t, conf: wd.confidence, x0: sx - 3, x1: sx + 3, y0: y0 + Math.max(0, sy - 4), y1: y0 + Math.max(0, sy - 4) + 8, rotated: deg });
    }
    return out;
  }

  // the whole read: straighten a slightly rotated picture, read the text, then the chart.
  // Returns {res, words, canvas, angle}. canvas is what the result's pixel positions refer to.
  // the mark model (src/seg.js), when the page passes paths.seg = {ort, wasm, model}. Without it the color rules find the series.
  let segP = null;
  function segReady(paths) {
    if (!paths || !paths.seg || !root.UnchartSeg) return null;
    if (!segP) segP = (async () => {
      if (!root.ort) await new Promise((ok, no) => { const s = document.createElement('script'); s.src = paths.seg.ort; s.onload = ok; s.onerror = () => no(Error('Could not load onnxruntime')); document.head.appendChild(s); });
      root.ort.env.wasm.wasmPaths = paths.seg.wasm; root.ort.env.wasm.numThreads = paths.seg.threads || 1;
      const m = await fetch(paths.seg.model).then(r => r.arrayBuffer());
      await root.UnchartSeg.init(root.ort, new Uint8Array(m));
      return true;
    })().catch(e => { console.warn('mark model off:', e.message); return false; });
    return segP;
  }

  async function readChart(canvas, paths, opts = {}) {
    const t0 = performance.now();
    let c = canvas, img = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const ds = opts.deskew === false ? { angle: 0, img } : root.Unchart.deskew(img);
    if (ds.angle) {
      c = document.createElement('canvas'); c.width = ds.img.width; c.height = ds.img.height;
      c.getContext('2d').putImageData(new ImageData(ds.img.data, ds.img.width, ds.img.height), 0, 0);
      img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    }
    const sr = segReady(paths);
    let seg = null;
    if (sr && await sr) { try { seg = await root.UnchartSeg.run(img); } catch (e) { console.warn('mark model failed:', e.message); } }
    if (seg) opts = Object.assign({}, opts, { seg });
    const ts = performance.now();
    let words = opts.words || await readWords(c, paths);
    const t1 = performance.now();
    let res, all = words;
    try { res = root.Unchart.extract(img, words, opts); } catch (e) { res = { ok: false, code: 'crash', error: 'Something broke while reading: ' + e.message, stack: String(e.stack) }; }
    // tiny, blurred or scanned labels: when no value axis came out, read the picture again at twice the size
    if (!res.ok && res.code === 'no_axis' && !opts.words && opts.upscale !== false && c.width * c.height < 1.6e6) {
      const big = document.createElement('canvas'); big.width = c.width * 2; big.height = c.height * 2;
      const g = big.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, big.width, big.height);
      const w2 = (await readWords(big, paths)).map(w => Object.assign({}, w, { x0: w.x0 / 2, y0: w.y0 / 2, x1: w.x1 / 2, y1: w.y1 / 2 }));
      let r2; try { r2 = root.Unchart.extract(img, w2, opts); } catch (e) { r2 = { ok: false }; }
      if (r2.ok) { res = r2; res.upscaled = true; words = all = w2; }
    }
    // x labels drawn at an angle do not read; read the strip under the plot again, turned so the labels sit flat
    // (opts.cacheRot reads the turned strip for every chart, so the benchmark can replay this step without OCR)
    let rot = null;
    if (res.ok && opts.cacheRot && !opts.words) { rot = {}; for (const deg of [30, 45, 90]) rot[deg] = await readRotated(c, res.rect, deg, paths); }
    if (res.ok && res.xWeak && !opts.words && opts.rotated !== false) {
      if (!rot) { rot = {}; for (const deg of [30, 45, 90]) rot[deg] = await readRotated(c, res.rect, deg, paths); }
      const r2 = root.Unchart.withRotated(img, words, res, rot, opts);
      res = r2.res; all = r2.words;
    }
    res.angle = ds.angle; res.ms_ocr = t1 - ts; res.ms_seg = seg ? seg.ms : 0; res.ms_total = performance.now() - t0;
    return { res, words: all, flat: words, rot, canvas: c, angle: ds.angle, seg };
  }
  root.UnchartOCR = { readWords, readChart, _findLabelBoxes: findLabelBoxes };
})(window);
