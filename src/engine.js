// Unchart engine. Turns a picture of a chart back into the numbers behind it.
// Everything here runs in the browser. The OCR step is passed in, so the same code
// runs in the app and in the benchmark.
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // ---------- reading numbers out of OCR text ----------
  function parseNumber(t) {
    if (!t) return null;
    let s = String(t).trim();
    s = s.replace(/[−–—_]/g, '-').replace(/[$€£¥,\s'|]/g, '');
    s = s.replace(/-+$/, '');                 // a tick mark read as a trailing dash
    if (/^-{2,}/.test(s)) s = s.replace(/^-+/, '-');
    let pct = false, mult = 1;
    if (/%$/.test(s)) { pct = true; s = s.slice(0, -1); }
    const suf = s.match(/([kKmMbB])$/);
    if (suf) { mult = { k: 1e3, m: 1e6, b: 1e9 }[suf[1].toLowerCase()]; s = s.slice(0, -1); }
    // common OCR slips inside numbers
    if (/^[-\d.OoIl]+$/.test(s) && /\d/.test(s)) s = s.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
    if (/^-?0\d+$/.test(s)) s = s.replace(/^(-?)0/, '$10.');   // 09 is a 0.9 that lost its point
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const v = parseFloat(s) * mult;
    return isFinite(v) ? { v, pct } : null;
  }

  // ---------- fitting an axis from its tick labels ----------
  // pairs: [{p: pixel, v: value}]. Robust line fit that ignores misread labels.
  function fitAxis(pairs) {
    if (pairs.length < 2) return null;
    let best = null;
    const tol = pts => { const vs = pts.map(q => q.v); return (Math.max(...vs) - Math.min(...vs) || 1) * 0.02; };
    for (const logScale of [false, true]) {
      const P = logScale ? pairs.filter(q => q.v > 0).map(q => ({ p: q.p, v: Math.log10(q.v) })) : pairs;
      if (P.length < 2) continue;
      const t = tol(P);
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        const a = P[i], b = P[j]; if (Math.abs(a.p - b.p) < 3 || a.v === b.v) continue;
        const slope = (b.v - a.v) / (b.p - a.p), icp = a.v - slope * a.p;
        const inl = P.filter(q => Math.abs(icp + slope * q.p - q.v) <= t);
        if (inl.length < 2) continue;
        // refine with least squares on the inliers
        const n = inl.length, mp = inl.reduce((s, q) => s + q.p, 0) / n, mv = inl.reduce((s, q) => s + q.v, 0) / n;
        let sxy = 0, sxx = 0; for (const q of inl) { sxy += (q.p - mp) * (q.v - mv); sxx += (q.p - mp) ** 2; }
        const s2 = sxx ? sxy / sxx : slope, i2 = mv - s2 * mp;
        const resid = inl.reduce((s, q) => s + Math.abs(i2 + s2 * q.p - q.v), 0) / n;
        // a log axis must beat the linear one clearly, and needs 3+ labels
        const score = inl.length * 10 - resid / (t || 1) - (logScale ? (inl.length >= 3 ? 4 : 99) : 0);
        if (!best || score > best.score) best = { score, slope: s2, icp: i2, log: logScale, inliers: inl.length, n: P.length };
      }
    }
    if (!best) return null;
    const { slope, icp, log } = best;
    return {
      log, inliers: best.inliers, total: best.n,
      toValue: p => log ? Math.pow(10, icp + slope * p) : icp + slope * p,
      toPixel: v => ((log ? Math.log10(v) : v) - icp) / slope,
    };
  }

  // labels top to bottom on a y axis often lose their minus sign in OCR. If values go down and then
  // back up, everything after the turn must have been negative.
  function fixMissingMinus(labels) {
    const L = [...labels].sort((a, b) => a.p - b.p).map(q => ({ ...q }));
    const variants = [L];
    const zi = L.findIndex(q => q.v === 0);
    if (zi >= 0 && L.slice(zi + 1).some(q => q.v > 0)) variants.push(L.map((q, k) => k > zi && q.v > 0 ? { ...q, v: -q.v } : q));
    for (let t = 1; t < L.length; t++) if (L[t].v > L[t - 1].v && L[t - 1].v >= 0 && L.slice(t).every(q => q.v > 0)) { variants.push(L.map((q, k) => k >= t ? { ...q, v: -q.v } : q)); break; }
    // values that grow downward are negatives that all lost their minus sign
    if (L.length >= 2 && L.every(q => q.v >= 0)) { const f = fitAxis(L); if (f && f.toValue(1) > f.toValue(0)) variants.unshift(L.map(q => ({ ...q, v: -q.v }))); }
    // keep whichever reading lines up into the cleanest scale (and never one that grows downward)
    let best = L, bi = -1;
    for (const v of variants) { const f = fitAxis(v); let sc = f ? f.inliers - (v === L ? 0 : 0.5) : -1; if (f && f.toValue(1) > f.toValue(0)) sc -= 100; if (sc > bi) { bi = sc; best = v; } }
    return best;
  }

  // OCR often reads the comma in 4,000 as a period. If every label looks like d.000, they are thousands.
  function fixThousands(col) {
    const txt = col.map(q => String(q.text).replace(/[\s$%]/g, ''));
    const nz = txt.filter(t => !/^[-\u2212]?0+$/.test(t));
    const hasComma = txt.some(t => /^\d{1,3}(,\d{3})+$/.test(t));
    const allDot000 = nz.length >= 2 && nz.every(t => /^[-\u2212]?\d{1,3}\.\d{3}$/.test(t)) && nz.every(t => /\.000$/.test(t));
    for (let k = 0; k < col.length; k++) if ((hasComma || allDot000) && /^[-\u2212]?\d{1,3}\.\d{3}$/.test(txt[k])) col[k].v = col[k].v * 1000;
  }

  // ---------- grouping OCR words into axis label rows / columns ----------
  function groupBy(items, key, tolPx) {
    const s = [...items].sort((a, b) => key(a) - key(b)), groups = [];
    for (const it of s) {
      const g = groups.find(g => Math.abs(key(g[0]) - key(it)) <= tolPx || Math.abs(g.k - key(it)) <= tolPx);
      if (g) { g.push(it); g.k = g.reduce((a, q) => a + key(q), 0) / g.length; } else { const ng = [it]; ng.k = key(it); groups.push(ng); }
    }
    return groups;
  }

  function overlapCols(items) {
    const s = [...items].sort((a, b) => a.x0 - b.x0), cols = [];
    for (const it of s) {
      const g = cols.find(g => { const ov = Math.min(g.x1, it.x1) - Math.max(g.x0, it.x0); return ov > Math.min(g.x1 - g.x0, it.x1 - it.x0) * 0.3; });
      if (g) { g.push(it); g.x0 = Math.min(g.x0, it.x0); g.x1 = Math.max(g.x1, it.x1); } else { const ng = [it]; ng.x0 = it.x0; ng.x1 = it.x1; cols.push(ng); }
    }
    cols.forEach(g => { g.k = g.reduce((a, q) => a + q.x1, 0) / g.length; });
    return cols;
  }
  const isTickMark = w => /^[1|lI!\-]$/.test(w.text) && (w.x1 - w.x0) < (w.y1 - w.y0) * 0.45;

  function findAxes(words0, W, H) {
    const words = words0.filter(w => !isTickMark(w) && !/^[-_.]+$/.test(w.text));
    const nums = [];
    for (const w of words) {
      const n = parseNumber(w.text); if (!n) continue;
      nums.push({ ...w, v: n.v, pct: n.pct, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 });
    }
    // y axis labels: stacked vertically and overlapping horizontally (right edges vary when OCR drops a % sign)
    const cols = overlapCols(nums).filter(g => g.length >= 3 && new Set(g.map(q => Math.round(q.cy / 4))).size >= 3);
    cols.forEach(g => { g.span = Math.max(...g.map(q => q.cy)) - Math.min(...g.map(q => q.cy)); });
    cols.sort((a, b) => (b.length * 2 + b.span / H * 10) - (a.length * 2 + a.span / H * 10));
    let yCol = cols.filter(g => g.k < W * 0.5)[0] || cols[0];
    // a second scale on the right must be a real column of labels that lines up into a scale, past the plot
    let yRight = cols.find(g => g !== yCol && g.k > W * 0.75 && g.length >= 3 && g.reduce((a, q) => a + q.conf, 0) / g.length > 60 &&
      (() => { const f = fitAxis(g.map(q => ({ p: q.cy, v: q.v }))); return f && f.inliers >= 3; })()) || null;
    // x axis labels: same baseline, spread horizontally, below the y labels
    const all = words.map(w => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, n: parseNumber(w.text) }));
    const yBottom = yCol ? Math.max(...yCol.map(q => q.cy)) : H * 0.6;
    const rows = groupBy(all.filter(q => q.cy > yBottom - 4 && q.conf > 40), q => q.cy, Math.max(5, H * 0.012))
      .filter(g => g.length >= 2 && new Set(g.map(q => Math.round(q.cx / 8))).size >= 2);
    rows.sort((a, b) => (b.length - a.length) || (a.k - b.k));
    const xRow = rows[0] || null;
    return { yCol, yRight, xRow, nums };
  }

  // ---------- connected components on a boolean mask ----------
  function components(mask, W, H, x0, y0, x1, y1) {
    const lab = new Int32Array(W * H), comps = [];
    const stack = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * W + x; if (!mask[i] || lab[i]) continue;
      const c = { id: comps.length + 1, n: 0, xa: x, xb: x, ya: y, yb: y, sx: 0, sy: 0 };
      lab[i] = c.id; stack.push(i);
      while (stack.length) {
        const j = stack.pop(), jx = j % W, jy = (j / W) | 0;
        c.n++; c.sx += jx; c.sy += jy;
        if (jx < c.xa) c.xa = jx; if (jx > c.xb) c.xb = jx; if (jy < c.ya) c.ya = jy; if (jy > c.yb) c.yb = jy;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = jx + dx, ny = jy + dy;
          if (nx < x0 || nx >= x1 || ny < y0 || ny >= y1) continue;
          const k = ny * W + nx; if (mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); }
        }
      }
      c.w = c.xb - c.xa + 1; c.h = c.yb - c.ya + 1; c.fill = c.n / (c.w * c.h); c.cx = c.sx / c.n; c.cy = c.sy / c.n;
      comps.push(c);
    }
    return { comps, lab };
  }

  // Ramer Douglas Peucker, to find the corners of a traced line (those are the real data points)
  function rdp(pts, eps) {
    if (pts.length < 3) return pts.slice();
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
    const st = [[0, pts.length - 1]];
    while (st.length) {
      const [a, b] = st.pop(); let dm = 0, im = -1;
      const A = pts[a], B = pts[b], dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + B[0] * A[1] - B[1] * A[0]) / L; if (d > dm) { dm = d; im = i; } }
      if (dm > eps) { keep[im] = 1; st.push([a, im], [im, b]); }
    }
    return pts.filter((_, i) => keep[i]);
  }

  // The data behind a line chart usually sits on a regular grid of x values (years, months, 0..n).
  // Try grids from coarse to fine and keep the coarsest one whose straight segments reproduce the drawn line.
  function fitGrid(tr, xcal, tick, Y) {
    const xs = tr.map(t => t[0]);
    const at = px => { let lo = 0, hi = tr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m][0] <= px) lo = m; else hi = m; }
      const a = tr[lo], b = tr[hi]; return b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (px - a[0]) / (b[0] - a[0]); };
    const v0 = xcal.toValue(xs[0]), v1 = xcal.toValue(xs[xs.length - 1]);
    const cands = [];
    for (const m of [1, 2, 2.5, 4, 5, 10, 20, 25, 50]) {
      const st = tick / m, pxStep = Math.abs(xcal.toPixel(st) - xcal.toPixel(0));
      if (pxStep < 2.5) break;
      const lo = Math.min(v0, v1), hi = Math.max(v0, v1), snapTol = st * 0.35 + Math.abs(xcal.toValue(6) - xcal.toValue(0));
      const g0 = Math.round(lo / st) * st, g1 = Math.round(hi / st) * st;
      if (Math.abs(g0 - lo) > snapTol || Math.abs(g1 - hi) > snapTol) continue;
      const n = Math.round((g1 - g0) / st); if (n < 1 || n > 600) continue;
      const grid = []; for (let k = 0; k <= n; k++) { const v = g0 + k * st, px = xcal.toPixel(v); grid.push([px, at(clamp(px, xs[0], xs[xs.length - 1]))]); }
      grid.sort((a, b) => a[0] - b[0]);
      // how far is the drawn line from the straight segments through the grid points
      const dev = []; let gi = 0;
      for (const [x, y] of tr) { while (gi < grid.length - 2 && grid[gi + 1][0] < x) gi++; const a = grid[gi], b = grid[gi + 1] || a;
        // corners get rounded by thick lines, so only judge the straight middle of each segment
        if (Math.min(Math.abs(x - a[0]), Math.abs(b[0] - x)) < pxStep * 0.28) continue;
        const yy = b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); dev.push(Math.abs(yy - y)); }
      if (dev.length < 4) continue;
      dev.sort((a, b) => a - b);
      const p95 = dev[Math.floor(dev.length * 0.95)];
      cands.push({ p95, st, grid });
    }
    if (typeof window !== "undefined") window.__grid = cands.map(c => [c.st, c.p95, c.grid.length]);
    if (!cands.length) return null;
    // the coarsest grid that is about as faithful as the best one wins
    const bestDev = Math.min(...cands.map(c => c.p95));
    const pick = cands.find(c => c.p95 <= bestDev * 2 + 2);
    if (!pick || pick.p95 > 8) return null;
    return pick.grid.map(([px, py]) => ({ x: +(Math.round(xcal.toValue(px) / pick.st) * pick.st).toFixed(6), y: Y(py), px, py }));
    return null;
  }

  function pxResid(f, P) { if (!f) return Infinity; const r = P.map(q => Math.abs(f.toPixel(q.v) - q.p)).filter(isFinite).sort((a, b) => a - b); return r.length ? r[Math.floor(r.length / 2)] : Infinity; }
  // Label boxes from OCR are a pixel or two off. The tick mark or gridline beside each label sits
  // exactly on its value, so snap each label to the darkest short line next to it.
  function lumAt(D, W, x, y) { const i = (y * W + x) * 4; return (D[i] * 299 + D[i + 1] * 587 + D[i + 2] * 114) / 1000; }
  function snapY(D, W, H, q, x0, x1) {
    const h = Math.max(4, q.w ? q.w.y1 - q.w.y0 : 8), lo = Math.max(0, Math.round(q.p - h * 0.6)), hi = Math.min(H - 1, Math.round(q.p + h * 0.6));
    x0 = Math.max(0, Math.round(x0)); x1 = Math.min(W - 1, Math.round(x1)); if (x1 - x0 < 3) return q.p;
    const ls = []; for (let y = lo; y <= hi; y++) for (let x = x0; x <= x1; x += 2) ls.push(lumAt(D, W, x, y));
    ls.sort((a, b) => a - b); const bg = ls[ls.length >> 1];
    const score = []; for (let y = lo; y <= hi; y++) { let s = 0; for (let x = x0; x <= x1; x++) s += Math.max(0, Math.abs(lumAt(D, W, x, y) - bg) - 12); score.push(s); }
    const mx = Math.max(...score); if (mx < 3 * 40) return q.p;
    // weighted centre of the rows that make up the line, so a 2 pixel line lands between them
    let k = score.indexOf(mx), a = k, b = k; while (a > 0 && score[a - 1] > mx * 0.35) a--; while (b < score.length - 1 && score[b + 1] > mx * 0.35) b++;
    if (b - a > 4) return q.p;
    let sw = 0, sy = 0; for (let j = a; j <= b; j++) { sw += score[j]; sy += score[j] * (lo + j); }
    return sw ? sy / sw : q.p;
  }
  function snapX(D, W, H, q, y0, y1) {
    const w = Math.max(4, q.x1 - q.x0), lo = Math.max(0, Math.round(q.cx - w * 0.5)), hi = Math.min(W - 1, Math.round(q.cx + w * 0.5));
    y0 = Math.max(0, Math.round(y0)); y1 = Math.min(H - 1, Math.round(y1)); if (y1 - y0 < 2) return q.cx;
    const ls = []; for (let x = lo; x <= hi; x++) for (let y = y0; y <= y1; y++) ls.push(lumAt(D, W, x, y));
    ls.sort((a, b) => a - b); const bg = ls[ls.length >> 1];
    const score = []; for (let x = lo; x <= hi; x++) { let s = 0; for (let y = y0; y <= y1; y++) s += Math.max(0, Math.abs(lumAt(D, W, x, y) - bg) - 12); score.push(s); }
    const mx = Math.max(...score); if (mx < 2 * 40) return q.cx;
    let k = score.indexOf(mx), a = k, b = k; while (a > 0 && score[a - 1] > mx * 0.35) a--; while (b < score.length - 1 && score[b + 1] > mx * 0.35) b++;
    if (b - a > 4) return q.cx;
    let sw = 0, sx = 0; for (let j = a; j <= b; j++) { sw += score[j]; sx += score[j] * (lo + j); }
    return sw ? sx / sw : q.cx;
  }

  // ---------- the main entry point ----------
  // img: {data, width, height} (RGBA). words: [{text, conf, x0, y0, x1, y1}] in image pixels.
  function extract(img, words, opts = {}) {
    const W = img.width, H = img.height, D = img.data;
    const notes = [];
    const ax = findAxes(words, W, H);
    if (!ax.yCol) return { ok: false, error: 'I could not find the numbers on the y axis.', words };

    // y calibration
    fixThousands(ax.yCol);
    let yl = ax.yCol.map(q => ({ p: q.cy, v: q.v, w: q }));
    yl = fixMissingMinus(yl);
    if (opts.snap !== false) {
      const xr = Math.max(...ax.yCol.map(q => q.x1));
      const raw = fitAxis(yl);
      const snapped = yl.map(q => ({ ...q, p: snapY(D, W, H, q, xr + 1, xr + Math.max(10, (q.w.y1 - q.w.y0) * 2.5)) }));
      const fs = fitAxis(snapped);
      // keep the snapped version only if the labels line up at least as well
      if (fs && (!raw || fs.inliers >= raw.inliers)) yl = snapped;
    }
    const ycal = fitAxis(yl);
    if (!ycal) return { ok: false, error: 'The y axis labels did not line up into a scale.', words };
    const yPct = ax.yCol.filter(q => q.pct).length > ax.yCol.length / 2;
    const yTicks = yl.map(q => q.p).sort((a, b) => a - b);
    const ySpacing = median(yTicks.slice(1).map((p, i) => p - yTicks[i])) || H * 0.1;

    // x calibration: numeric or categories
    let xcal = null, xCats = null, xNumeric = false, xSpacing = W * 0.1, xTick = 1;
    if (ax.xRow) {
      const xr = [...ax.xRow].sort((a, b) => a.cx - b.cx);
      const numeric = xr.filter(q => q.n);
      if (numeric.length >= Math.max(2, xr.length * 0.7)) {
        const xp = numeric.map(q => ({ p: opts.snap === false ? q.cx : snapX(D, W, H, q, q.y0 - Math.max(8, (q.y1 - q.y0) * 1.6), q.y0 - 2), v: q.n.v }));
        xcal = fitAxis(xp);
        const raw = fitAxis(numeric.map(q => ({ p: q.cx, v: q.n.v })));
        const rawP = numeric.map(q => ({ p: q.cx, v: q.n.v }));
        if (!xcal || (raw && (raw.inliers > xcal.inliers || pxResid(raw, rawP) < pxResid(xcal, xp) - 0.05))) xcal = raw; else numeric.forEach((q, i) => { q.cx = xp[i].p; });
        if (xcal && xcal.inliers >= 2) xNumeric = true; else xcal = null;
      }
      if (!xNumeric) xCats = xr.map(q => ({ label: q.text.replace(/[^\w\s.\-%/&']/g, ''), cx: q.cx }));
      const xs = xr.map(q => q.cx); xSpacing = median(xs.slice(1).map((p, i) => p - xs[i])) || xSpacing;
      if (xNumeric) {
        // the value step between neighbouring tick labels (ignore labels that do not fit the scale)
        const ok = numeric.filter(q => Math.abs(xcal.toPixel(q.n.v) - q.cx) < 6).map(q => q.n.v).sort((a, b) => a - b);
        const d = ok.slice(1).map((v, i) => v - ok[i]).filter(v => v > 1e-9);
        xTick = d.length ? Math.min(...d.filter(v => v <= median(d) * 1.01)) : Math.abs(xcal.toValue(xSpacing) - xcal.toValue(0));
      }
    }

    // plot area
    const yLabRight = Math.max(...ax.yCol.map(q => q.x1));
    const left = Math.round(yLabRight + 3);
    const right = Math.round(ax.yRight ? Math.min(...ax.yRight.map(q => q.x0)) - 3 : W - 1);
    const top = Math.round(clamp(yTicks[0] - ySpacing * 0.9, 0, H));
    const xTop = ax.xRow ? Math.min(...ax.xRow.map(q => q.y0)) : H;
    const bottom = Math.round(clamp(Math.min(xTop - 2, yTicks[yTicks.length - 1] + ySpacing * 0.9), 0, H - 1));
    const rect = { left, right, top, bottom };

    // mask out text inside the plot (title, legend labels, annotations), and the legend swatches beside them
    const textMask = new Uint8Array(W * H);
    let inside = words.filter(w => w.conf > 55 && !parseNumber(w.text) && /[A-Za-z]{2,}/.test(w.text) &&
      w.x0 > left - 2 && w.x1 < right + 2 && w.y0 > top - 2 && w.y1 < bottom + 2);
    // join words on the same line into phrases ("In" + "store")
    inside.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) {
      const a = inside[i], b = inside[j], h = Math.max(a.y1 - a.y0, b.y1 - b.y0);
      if (Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < h * 0.4 && b.x0 - a.x1 > -2 && b.x0 - a.x1 < h * 0.9) {
        inside[i] = { ...a, text: a.text + ' ' + b.text, x1: b.x1, y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) }; inside.splice(j, 1); j = i;
      }
    }
    const legendWords = [];
    for (const w of inside) {
      const h = w.y1 - w.y0, stacked = inside.some(o => o !== w && Math.abs(o.x0 - w.x0) < h * 0.8 && Math.abs(o.y0 - w.y0) < h * 5);
      const ext = h * 3.6;   // legend labels have their color swatch on the left
      const x0 = Math.max(0, Math.floor(w.x0 - ext)), x1 = Math.min(W, Math.ceil(w.x1 + h * 0.3));
      const y0 = Math.max(0, Math.floor(w.y0 - h * 0.35)), y1 = Math.min(H, Math.ceil(w.y1 + h * 0.35));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) textMask[y * W + x] = 1;
      legendWords.push({ w, x0, y0, x1, y1 });
    }

    // background color of the plot area
    const hist = new Map();
    for (let y = top; y < bottom; y += 2) for (let x = left; x < right; x += 2) {
      const i = (y * W + x) * 4, k = (D[i] >> 3) << 10 | (D[i + 1] >> 3) << 5 | (D[i + 2] >> 3);
      // backgrounds are white, gray or black. Big bars can outnumber the background, so colorful pixels count far less.
      const wgt = rgb2hsv(D[i], D[i + 1], D[i + 2])[1] < 0.18 ? 1 : 0.02;
      hist.set(k, (hist.get(k) || 0) + wgt);
    }
    let bgk = 0, bgn = 0; for (const [k, n] of hist) if (n > bgn) { bgn = n; bgk = k; }
    const bg = [((bgk >> 10) & 31) * 8 + 4, ((bgk >> 5) & 31) * 8 + 4, (bgk & 31) * 8 + 4];

    // colored ink: anything with real saturation that is clearly not the background
    const N = W * H, sat = new Float32Array(N), ink = new Uint8Array(N);
    let inkCount = 0;
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = y * W + x, i = p * 4; if (textMask[p]) continue;
      const c = [D[i], D[i + 1], D[i + 2]];
      if (cdist(c, bg) < 40) continue;
      const [, s, v] = rgb2hsv(c[0], c[1], c[2]); sat[p] = s;
      if (s > 0.28 && v > 0.18) { ink[p] = 1; inkCount++; }
    }
    // no colored ink at all: the series is black or gray. Use dark pixels, minus the long straight gridlines and spines.
    let mono = false;
    if (inkCount < 30) {
      mono = true;
      const dark = new Uint8Array(N);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x, i = p * 4; if (textMask[p]) continue; if (cdist([D[i], D[i + 1], D[i + 2]], bg) > 90) dark[p] = 1; }
      const rw = right - left, rh = bottom - top;
      for (let y = top; y < bottom; y++) { let n = 0; for (let x = left; x < right; x++) n += dark[y * W + x]; if (n > rw * 0.5) for (let x = left; x < right; x++) dark[y * W + x] = 0; }
      for (let x = left; x < right; x++) { let n = 0; for (let y = top; y < bottom; y++) n += dark[y * W + x]; if (n > rh * 0.6) for (let y = top; y < bottom; y++) dark[y * W + x] = 0; }
      for (let p = 0; p < N; p++) if (dark[p]) { ink[p] = 1; inkCount++; }
    }

    // cluster ink colors into series
    const bins = new Map();
    for (let p = 0; p < N; p++) if (ink[p] && (mono || sat[p] > 0.38)) {
      const i = p * 4, k = (D[i] >> 4) << 8 | (D[i + 1] >> 4) << 4 | (D[i + 2] >> 4);
      const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += D[i]; b.g += D[i + 1]; b.b += D[i + 2]; bins.set(k, b);
    }
    const binList = [...bins.values()].map(b => ({ n: b.n, c: [b.r / b.n, b.g / b.n, b.b / b.n] })).sort((a, b) => b.n - a.n);
    const clusters = [];
    for (const b of binList) {
      const near = clusters.find(c => cdist(c.c, b.c) < 70);
      if (near) { const t = near.n + b.n; near.c = near.c.map((v, j) => (v * near.n + b.c[j] * b.n) / t); near.n = t; }
      else clusters.push({ c: b.c, n: b.n });
    }
    const minN = Math.max(15, (right - left) * 0.06);
    const series0 = clusters.filter(c => c.n >= minN).slice(0, 8);
    if (!series0.length) return { ok: false, error: 'I found the axes but no data marks inside them.', rect, words, dbg: { inkCount, bg, clusters: clusters.slice(0, 5), minN, masked: textMask.reduce((a, v) => a + v, 0) } };
    const hsvOf = c => rgb2hsv(c[0], c[1], c[2]);
    // assign every ink pixel (including faint anti-aliased edges) to the nearest series by hue
    const owner = new Int8Array(N).fill(-1);
    for (let p = 0; p < N; p++) if (ink[p]) {
      const i = p * 4, h = rgb2hsv(D[i], D[i + 1], D[i + 2]);
      let bi = -1, bd = 1e9;
      series0.forEach((s, j) => {
        const sh = hsvOf(s.c); let d;
        if (mono) d = cdist([D[i], D[i + 1], D[i + 2]], s.c);
        else { const dh = Math.min(Math.abs(h[0] - sh[0]), 360 - Math.abs(h[0] - sh[0])); d = dh * 2 + Math.abs(h[2] - sh[2]) * 60 + (h[1] < .45 ? 20 : 0); }
        if (d < bd) { bd = d; bi = j; }
      });
      if (bd < (mono ? 120 : 70)) owner[p] = bi;
    }

    // anti-aliased edges of a line can form their own lighter cluster. If a cluster has the same hue as a bigger
    // one and most of its pixels touch that one, it is a fringe, not a series.
    for (let j = series0.length - 1; j > 0; j--) {
      const hj = hsvOf(series0[j].c);
      for (let k = 0; k < j; k++) {
        const hk = hsvOf(series0[k].c), dh = Math.min(Math.abs(hj[0] - hk[0]), 360 - Math.abs(hj[0] - hk[0]));
        if (dh > 18 && !mono) continue;
        let tot = 0, touch = 0;
        for (let p = 0; p < N; p++) if (owner[p] === j) { tot++; if (owner[p - 1] === k || owner[p + 1] === k || owner[p - W] === k || owner[p + W] === k || owner[p - 2] === k || owner[p + 2] === k || owner[p - 2 * W] === k || owner[p + 2 * W] === k) touch++; }
        if (tot && touch / tot > 0.5) { for (let p = 0; p < N; p++) if (owner[p] === j) owner[p] = k; series0.splice(j, 1); for (let p = 0; p < N; p++) if (owner[p] > j) owner[p]--; break; }
      }
    }

    // pixel <-> value helpers
    const Y = p => ycal.toValue(p);
    const X = p => xNumeric ? xcal.toValue(p) : p;
    const y0px = ycal.log ? null : ycal.toPixel(0);

    const out = [];
    series0.forEach((s, j) => {
      const mask = new Uint8Array(N); let cnt = 0;
      for (let p = 0; p < N; p++) if (owner[p] === j) { mask[p] = 1; cnt++; }
      const { comps } = components(mask, W, H, left, top, right + 1, bottom + 1);
      const big = comps.filter(c => c.n >= 6);
      const color = '#' + s.c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
      // bars: solid rectangles with similar widths that sit on a shared baseline
      const rects = big.filter(c => c.fill > 0.86 && c.w >= 4 && c.h >= 3);
      const wMed = median(rects.map(c => c.w));
      const barLike = rects.filter(c => Math.abs(c.w - wMed) < Math.max(2, wMed * 0.2));
      const baseEdges = barLike.map(c => (y0px != null && Math.abs(c.ya - y0px) < Math.abs(c.yb - y0px)) ? c.ya : c.yb);
      const sharedBase = barLike.length >= 2 && (Math.max(...baseEdges) - Math.min(...baseEdges)) < 4;
      const barArea = barLike.reduce((a, c) => a + c.n, 0);
      // dots: many small round blobs
      const dots = big.filter(c => c.w < (right - left) * 0.05 && c.h < (bottom - top) * 0.08 && c.fill > 0.5);
      const dotArea = dots.reduce((a, c) => a + c.n, 0);
      if (barLike.length >= 2 && sharedBase && barArea > cnt * 0.6 && wMed > 3) {
        const pts = barLike.sort((a, b) => a.cx - b.cx).map((c, k) => {
          const upward = y0px == null || c.ya < y0px - 1;
          let edge = upward ? c.ya : c.yb + 1;
          // the row just past the edge is partly covered; its color tells how far the bar really reaches
          { const ry = upward ? c.ya - 1 : c.yb + 1, xa = c.xa + 2, xb = c.xb - 2;
            if (ry >= 0 && ry < H && xb > xa) { let t = 0, n = 0; const full = cdist(s.c, bg) || 1;
              for (let x = xa; x <= xb; x++) { const i = (ry * W + x) * 4; t += Math.min(1, Math.max(0, 1 - cdist([D[i], D[i + 1], D[i + 2]], s.c) / full)); n++; }
              const cov = n ? t / n : 0; if (cov > 0.08 && cov < 0.95) edge += upward ? -cov : cov; } }
          let label = 'Bar ' + (k + 1);
          if (xCats && xCats.length) { const near = xCats.reduce((b, q) => Math.abs(q.cx - c.cx) < Math.abs(b.cx - c.cx) ? q : b); if (Math.abs(near.cx - c.cx) < Math.max(c.w, xSpacing * 0.5)) label = near.label; }
          return { x: xNumeric ? X(c.cx) : label, y: Y(edge), px: c.cx, py: edge, box: [c.xa, c.ya, c.xb, c.yb] };
        });
        if (xCats && xCats.length > pts.length && pts.every(p => !/^Bar \d/.test(p.x))) {
          // a category with a label but no visible bar has a value of zero
          for (const c of xCats) if (!pts.some(p => p.x === c.label)) pts.push({ x: c.label, y: 0, px: c.cx, py: y0px, empty: true });
          pts.sort((a, b) => a.px - b.px);
        }
        out.push({ type: 'bar', color, points: pts });
      } else if (dots.length >= 5 && dotArea > cnt * 0.7) {
        const a1 = median(dots.map(c => c.n)), pts = [];
        for (const c of dots) { const k = Math.max(1, Math.round(c.n / a1)); for (let q = 0; q < k; q++) pts.push({ x: X(c.cx), y: Y(c.cy), px: c.cx, py: c.cy, merged: k > 1 }); }
        out.push({ type: 'scatter', color, points: pts.sort((a, b) => a.px - b.px), size: Math.sqrt(a1) });
      } else {
        // a line: trace the middle of the ink in every column, then find its corners
        const trace = [];
        // in each column, split the ink into runs and follow the one that continues the line
        const cols = [];
        for (let x = left; x <= right; x++) {
          const runs = []; let a = -1;
          for (let y = top; y <= bottom + 1; y++) { const on = y <= bottom && mask[y * W + x]; if (on && a < 0) a = y; if (!on && a >= 0) { runs.push([a, y - 1]); a = -1; } }
          cols.push(runs);
        }
        // start from the column with the most typical single run, then walk both ways
        let seed = -1; for (let k = 0; k < cols.length; k++) if (cols[k].length === 1 && cols[k][0][1] - cols[k][0][0] < 12) { seed = k; break; }
        if (seed >= 0) {
          const pickRun = (runs, prev) => runs.reduce((b, r) => Math.abs((r[0] + r[1]) / 2 - prev) < Math.abs((b[0] + b[1]) / 2 - prev) ? r : b);
          const ys = new Array(cols.length).fill(null);
          for (const dir of [1, -1]) {
            let prev = (cols[seed][0][0] + cols[seed][0][1]) / 2, miss = 0;
            for (let k = seed; k >= 0 && k < cols.length; k += dir) {
              const runs = cols[k]; if (!runs.length) { if (++miss > 40) break; continue; }
              const r = pickRun(runs, prev), c = (r[0] + r[1]) / 2;
              // a long vertical run is a steep segment: its middle is fine, but if it sits far away it is something else
              if (Math.abs(c - prev) > Math.max(30, (r[1] - r[0]) / 2 + 12) && miss < 3 && runs.length > 1) { miss++; continue; }
              ys[k] = c; prev = r[0] <= prev && prev <= r[1] ? prev : c; miss = 0;
            }
          }
          ys.forEach((y, k) => { if (y != null) trace.push([left + k, y]); });
        }
        if (trace.length < Math.max(5, (right - left) * 0.12)) return;
        // drop isolated specks far from the main run
        const xsMain = trace.filter((t, k) => k && t[0] - trace[k - 1][0] < 6);
        const tr = xsMain.length > trace.length * .5 ? trace : trace;
        const corners = rdp(tr, opts.eps || 1.6);
        let pts = null;
        if (xNumeric && tr.length > 8) pts = fitGrid(tr, xcal, xTick, Y);
        if (!pts) pts = corners.map(c => ({ x: X(c[0]), y: Y(c[1]), px: c[0], py: c[1] }));
        out.push({ type: 'line', color, points: pts, trace: tr.map(t => [t[0], t[1]]) });
      }
    });

    // names from the legend: match each legend swatch's color to a series
    for (const L of legendWords) {
      let best = -1, bd = 1e9;
      out.forEach((s, j) => {
        const sc = [parseInt(s.color.slice(1, 3), 16), parseInt(s.color.slice(3, 5), 16), parseInt(s.color.slice(5, 7), 16)];
        for (let y = L.y0; y < L.y1; y++) for (let x = L.x0; x < L.w.x0; x++) {
          const i = (y * W + x) * 4, d = cdist([D[i], D[i + 1], D[i + 2]], sc); if (d < bd) { bd = d; best = j; }
        }
      });
      if (best >= 0 && bd < 60 && !out[best].name) out[best].name = L.w.text.replace(/[^\w\s.&%'-]/g, '');
    }
    out.forEach((s, j) => { if (!s.name) s.name = out.length > 1 ? 'Series ' + (j + 1) : (s.type === 'bar' ? 'Value' : 'Series'); });

    // ---------- honesty checks ----------
    const yMinShown = Y(bottom), yMaxShown = Y(top);
    const flags = [];
    const hasBars = out.some(s => s.type === 'bar');
    if (hasBars && !ycal.log && y0px != null && y0px > bottom + 3 && yMinShown > 0) {
      const b = out.find(s => s.type === 'bar').points.filter(p => !p.empty), vs = b.map(p => p.y), lo = Math.min(...vs), hi = Math.max(...vs);
      // where the bars stand: their shared bottom edge
      let base = Y(median(b.map(p => p.box[3] + 1)));
      const near = yl.map(q => q.v).reduce((a, v) => Math.abs(v - base) < Math.abs(a - base) ? v : a, Infinity);
      if (Math.abs(near - base) < Math.abs(yMaxShown - yMinShown) * 0.01) base = near;   // it sits on a labeled tick
      else { const lv = yl.map(q => q.v).sort((a, b) => a - b), st = median(lv.slice(1).map((v, i) => v - lv[i])) || 1, q = st / 10; base = Math.round(base / q) * q; }
      const visual = (hi - base) / Math.max(1e-9, lo - base), real = hi / Math.max(1e-9, lo);
      flags.push({ level: 'warn', title: 'The bars do not start at zero', text: `The bars stand on ${fmt(base)}, not 0. The tallest bar looks ${visual.toFixed(1)}x the shortest, but it is only ${((real - 1) * 100).toFixed(0)}% bigger.` });
    }
    if (ycal.log) flags.push({ level: 'info', title: 'This is a log scale', text: 'Equal steps on the axis mean multiplying, not adding. A small rise near the top can be a huge change.' });
    if (ax.yRight) flags.push({ level: 'warn', title: 'Two y axes', text: 'There is a second scale on the right. Lines on different axes can be made to cross or line up wherever the designer wants.' });
    if (!hasBars && !ycal.log && yMinShown > 0 && (yMaxShown - yMinShown) / Math.max(Math.abs(yMaxShown), 1e-9) < 0.25)
      flags.push({ level: 'info', title: 'Zoomed in axis', text: `The axis covers ${fmt(yMinShown)} to ${fmt(yMaxShown)}. Changes look bigger than they are relative to the full value.` });
    if (ycal.inliers < ycal.total) notes.push(`Ignored ${ycal.total - ycal.inliers} y label(s) that did not fit the scale.`);

    return {
      ok: true, rect, series: out, flags, notes, dbg: { clusters: clusters.slice(0, 8).map(c => [c.c.map(Math.round), c.n]), minN },
      axis: { yLog: ycal.log, yPct, xNumeric, yRange: [yMinShown, yMaxShown], xRange: xNumeric ? [X(left), X(right)] : null, yRight: !!ax.yRight },
      calib: { y: yl.map(q => ({ p: q.p, v: q.v })), x: xNumeric ? ax.xRow.filter(q => q.n).map(q => ({ p: q.cx, v: q.n.v })) : [] },
      toPx: { x: v => xNumeric ? xcal.toPixel(v) : v, y: v => ycal.toPixel(v) },
    };
  }

  function fmt(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (a >= 1e4) return Math.round(v).toLocaleString('en-US');
    if (a >= 100) return v.toFixed(1).replace(/\.0$/, '');
    if (a >= 1) return v.toFixed(2).replace(/\.?0+$/, '');
    return v.toPrecision(3);
  }

  // ---------- what the numbers say ----------
  function insights(res) {
    const cards = [];
    for (const s of res.series) {
      const P = s.points.filter(p => isFinite(p.y)); if (P.length < 2) continue;
      const ys = P.map(p => p.y);
      if (s.type === 'line') {
        const a = ys[0], b = ys[ys.length - 1], hi = Math.max(...ys), lo = Math.min(...ys);
        const iH = ys.indexOf(hi), iL = ys.indexOf(lo);
        let peak = ys[0], dd = 0, ddFrom = 0, ddTo = 0, pk = 0;
        ys.forEach((v, k) => { if (v > peak) { peak = v; pk = k; } const d = peak > 0 ? (v - peak) / peak : 0; if (d < dd) { dd = d; ddFrom = pk; ddTo = k; } });
        const xs = P.map(p => typeof p.x === 'number' ? p.x : 0);
        const n = xs.length, mx = xs.reduce((u, v) => u + v, 0) / n, my = ys.reduce((u, v) => u + v, 0) / n;
        let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; });
        const slope = sxx ? sxy / sxx : 0, r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
        const years = xs.every(x => Number.isInteger(+x.toFixed(6)) && x > 1900 && x < 2100);
        const span = xs[n - 1] - xs[0];
        const c = { series: s.name, color: s.color, items: [] };
        if (a !== 0) c.items.push(['Change', `${fmt(a)} to ${fmt(b)}, ${b >= a ? 'up' : 'down'} ${Math.abs((b - a) / Math.abs(a) * 100).toFixed(1)}%`]);
        if (years && span > 0 && a > 0 && b > 0) c.items.push(['Yearly growth (CAGR)', `${((Math.pow(b / a, 1 / span) - 1) * 100).toFixed(1)}% a year over ${span} years`]);
        c.items.push(['High and low', `${fmt(hi)} at ${fx(P[iH].x)}, ${fmt(lo)} at ${fx(P[iL].x)}`]);
        if (dd < -0.05) c.items.push(['Biggest drop', `${(dd * 100).toFixed(1)}% from ${fx(P[ddFrom].x)} to ${fx(P[ddTo].x)}`]);
        c.items.push(['Trend', `${slope >= 0 ? '+' : ''}${fmt(slope)} per step on x, and the straight line explains ${(r2 * 100).toFixed(0)}% of the movement`]);
        cards.push(c);
      } else if (s.type === 'bar') {
        const sorted = [...P].sort((u, v) => v.y - u.y), tot = ys.reduce((u, v) => u + v, 0);
        cards.push({ series: s.name, color: s.color, items: [
          ['Largest', `${sorted[0].x} at ${fmt(sorted[0].y)}`],
          ['Smallest', `${sorted[sorted.length - 1].x} at ${fmt(sorted[sorted.length - 1].y)}`],
          ['Gap', `the largest is ${(sorted[0].y / Math.max(1e-9, sorted[sorted.length - 1].y)).toFixed(2)}x the smallest`],
          ['Total and average', `${fmt(tot)} total, ${fmt(tot / P.length)} on average`],
        ] });
      } else {
        const xs = P.map(p => p.x), n = P.length, mx = xs.reduce((u, v) => u + v, 0) / n, my = ys.reduce((u, v) => u + v, 0) / n;
        let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; });
        const r = sxy / Math.sqrt(sxx * syy || 1), slope = sxy / (sxx || 1);
        cards.push({ series: s.name, color: s.color, items: [
          ['Points', `${n}${P.some(p => p.merged) ? ' (some overlapping dots were split by size)' : ''}`],
          ['Correlation', `r = ${r.toFixed(2)}, ${Math.abs(r) > .7 ? 'strong' : Math.abs(r) > .4 ? 'moderate' : 'weak'} and ${r >= 0 ? 'positive' : 'negative'}`],
          ['Fitted line', `y = ${fmt(my - slope * mx)} ${slope >= 0 ? '+' : '-'} ${fmt(Math.abs(slope))} x`],
        ] });
      }
    }
    return cards;
  }
  const fx = x => typeof x === 'number' ? fmt(x) : x;

  root.Unchart = { extract, insights, parseNumber, fitAxis, fmt, _findAxes: findAxes, _groupBy: groupBy };
})(typeof window !== 'undefined' ? window : globalThis);
