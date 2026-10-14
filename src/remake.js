// Remake: redraw a chart cleanly from recovered numbers. Honest baseline, optional projection, three looks.
(function (root) {
  'use strict';
  const THEMES = {
    light: { bg: '#FFFFFF', fg: '#111114', muted: '#6B6B73', grid: '#E7E7EA', pal: ['#1F4FD8', '#FF5A1F', '#0E9F6E', '#9B51E0', '#D61F69'] },
    dark: { bg: '#0A0A0B', fg: '#ECECEA', muted: '#8C8C92', grid: '#232327', pal: ['#ECECEA', '#FF5A1F', '#3DDC97', '#8FA3FF', '#FF6FA8'] },
    print: { bg: '#ECE9E2', fg: '#121212', muted: '#5E5A53', grid: '#D8D3C9', pal: ['#121212', '#FF5A1F', '#2D4CE0', '#00A060', '#FF3DA8'] },
  };

  // Student t quantile for a two sided interval, good enough for small samples
  function tq(df, conf) {
    const z = conf >= 0.95 ? 1.96 : conf >= 0.9 ? 1.645 : 1.282;
    if (df <= 0) return z * 3;
    const g1 = (z ** 3 + z) / 4, g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
    return z + g1 / df + g2 / (df * df);
  }

  // Fit y on x (straight line) or log y on x (steady growth). Returns predictions with a 90% band.
  function project(xs, ys, kind, steps, stepSize, startX) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter(p => isFinite(p[0]) && isFinite(p[1]) && (kind !== 'growth' || p[1] > 0));
    const n = pts.length; if (n < 3) return null;
    const tf = kind === 'growth' ? Math.log : v => v, inv = kind === 'growth' ? Math.exp : v => v;
    const X = pts.map(p => p[0]), Y = pts.map(p => tf(p[1]));
    const mx = X.reduce((a, b) => a + b, 0) / n, my = Y.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (X[i] - mx) ** 2; sxy += (X[i] - mx) * (Y[i] - my); }
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    let sse = 0; for (let i = 0; i < n; i++) sse += (Y[i] - a - b * X[i]) ** 2;
    const s = Math.sqrt(sse / Math.max(1, n - 2)), t = tq(n - 2, 0.9), last = startX != null ? startX : X[n - 1];
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const x = last + k * stepSize, se = s * Math.sqrt(1 + 1 / n + (x - mx) ** 2 / (sxx || 1)), m = a + b * x;
      out.push({ x, y: inv(m), lo: inv(m - t * se), hi: inv(m + t * se) });
    }
    const r2 = (() => { let st = 0; for (const y of Y) st += (y - my) ** 2; return st ? 1 - sse / st : 0; })();
    return { pts: out, slope: b, r2, kind };
  }

  function nice(lo, hi, n) {
    const span = hi - lo || Math.abs(hi) || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
    return { lo: Math.floor(lo / step) * step, hi: Math.ceil(hi / step) * step, step };
  }
  const fmtTick = (v, step) => { const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return Math.abs(v) >= 1e4 ? Math.round(v).toLocaleString('en-US') : v.toFixed(d); };

  // table: {xName, cols:[{name}], rows:[{x, vals:[]}]}. opts: {type, zero, trend, theme, title, steps}
  function draw(canvas, table, opts) {
    const T = THEMES[opts.theme] || THEMES.light, dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = canvas.clientWidth || 800, H = Math.round(W * 9 / 16);
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
    const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = T.bg; g.fillRect(0, 0, W, H);
    const numericX = table.rows.every(r => typeof r.x === 'number');
    const type = opts.type === 'dots' ? 'dots' : opts.type === 'bar' || !numericX ? (opts.type === 'line' && numericX ? 'line' : opts.type === 'area' && numericX ? 'area' : 'bar') : opts.type;
    const rows = table.rows, k = table.cols.length;
    // projections, only for numeric x with a steady step
    let proj = [];
    const projections = [];
    if (opts.trend !== 'off' && numericX && type !== 'bar' && rows.length >= 3) {
      if (type === 'dots') { const srt = [...rows].sort((a, b) => a.x - b.x); const xs0 = srt.map(r => r.x); for (let c = 0; c < k; c++) { const ys0 = srt.map(r => r.vals[c]); const ok = xs0.map((x, i) => [x, ys0[i]]).filter(q => isFinite(q[1])); const x0 = ok[0][0], x1 = ok[ok.length - 1][0]; const f = ok.length >= 3 ? project(ok.map(q => q[0]), ok.map(q => q[1]), 'linear', 30, (x1 - x0) / 30, x0) : null; if (f) f.fit = true; projections.push(f); } proj = projections; } else {
      const xs = rows.map(r => r.x), dx = (xs[xs.length - 1] - xs[0]) / (xs.length - 1);
      const steps = opts.steps || Math.max(2, Math.round(rows.length * 0.3));
      for (let c = 0; c < k; c++) { const p = project(xs, rows.map(r => r.vals[c]), opts.trend, steps, dx); projections.push(p); }
      proj = projections;
    } }
    // scale
    let vals = [];
    rows.forEach(r => r.vals.forEach(v => { if (isFinite(v)) vals.push(v); }));
    proj.forEach(p => p && p.pts.forEach(q => { vals.push(q.lo, q.hi); }));
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (opts.zero || type === 'bar') { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    let sc = nice(lo, hi, 5);
    if (opts.lo != null) { const s2 = nice(opts.lo, hi, 5); sc = { lo: opts.lo, hi: s2.hi, step: s2.step }; }
    const xsAll = numericX ? rows.map(r => r.x).concat(proj.length && proj[0] ? proj[0].pts.map(q => q.x) : []) : null;
    const xmin = numericX ? Math.min(...xsAll) : 0, xmax = numericX ? Math.max(...xsAll) : rows.length;
    // layout
    const padL = 56, padR = 22, padT = (opts.title ? 46 : 22) + (k > 1 ? 22 : 0), padB = 40;
    const PX = v => padL + (numericX && type !== 'bar' ? (v - xmin) / ((xmax - xmin) || 1) : (v + 0.5) / rows.length) * (W - padL - padR);
    const PY = v => padT + (1 - (v - sc.lo) / ((sc.hi - sc.lo) || 1)) * (H - padT - padB);
    g.font = '12px "Geist Mono", ui-monospace, monospace'; g.textBaseline = 'middle';
    if (opts.title) { g.fillStyle = T.fg; g.font = '600 15px "Geist", system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(opts.title, padL - 40, 22); g.font = '12px "Geist Mono", ui-monospace, monospace'; }
    // grid and y labels
    g.strokeStyle = T.grid; g.lineWidth = 1; g.fillStyle = T.muted; g.textAlign = 'right';
    for (let v = Math.ceil(sc.lo / sc.step - 1e-9) * sc.step; v <= sc.hi + sc.step * 1e-6; v += sc.step) { const y = Math.round(PY(v)) + 0.5; g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke(); g.fillText(fmtTick(v, sc.step), padL - 8, y); }
    if (sc.lo < 0 && sc.hi > 0) { g.strokeStyle = T.muted; g.beginPath(); g.moveTo(padL, Math.round(PY(0)) + .5); g.lineTo(W - padR, Math.round(PY(0)) + .5); g.stroke(); }
    // x labels
    g.textAlign = 'center'; g.fillStyle = T.muted;
    const every = Math.max(1, Math.ceil(rows.length / Math.floor((W - padL - padR) / 64)));
    if (numericX && type !== 'bar') { const xt = nice(xmin, xmax, Math.min(8, Math.floor((W - padL - padR) / 70))); for (let v = Math.ceil(xmin / xt.step) * xt.step; v <= xmax + 1e-9; v += xt.step) g.fillText(fmtTick(v, xt.step), PX(v), H - padB + 18); }
    else rows.forEach((r, i) => { if (i % every === 0) g.fillText(String(numericX ? fmtTick(r.x, 1) : r.x).slice(0, 12), PX(i), H - padB + 18); });
    // projection bands first
    proj.forEach((p, c) => {
      if (!p) return; const col = T.pal[c % T.pal.length];
      g.fillStyle = col; g.globalAlpha = 0.12; g.beginPath();
      p.pts.forEach((q, i) => i ? g.lineTo(PX(q.x), PY(q.hi)) : g.moveTo(PX(q.x), PY(q.hi)));
      for (let i = p.pts.length - 1; i >= 0; i--) g.lineTo(PX(p.pts[i].x), PY(p.pts[i].lo));
      g.fill(); g.globalAlpha = 1;
      g.setLineDash([5, 5]); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); p.pts.forEach((q, i) => i ? g.lineTo(PX(q.x), PY(q.y)) : g.moveTo(PX(q.x), PY(q.y))); g.stroke(); g.setLineDash([]);
    });
    if (proj.length && proj[0] && !proj[0].fit) { const x0 = PX(proj[0].pts[0].x); g.strokeStyle = T.muted; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(x0, padT); g.lineTo(x0, H - padB); g.stroke(); g.setLineDash([]); g.fillStyle = T.muted; const lbl = 'projection, 90% band', tw = g.measureText(lbl).width; const right = x0 + 6 + tw < W - padR; g.textAlign = right ? 'left' : 'right'; g.fillText(lbl, right ? x0 + 6 : x0 - 6, padT + 8); }
    // series
    const bw = (W - padL - padR) / rows.length * 0.72 / k;
    for (let c = 0; c < k; c++) {
      const col = T.pal[c % T.pal.length]; g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 2.4;
      if (opts.type === 'dots' && numericX) {
        rows.forEach(r => { const v = r.vals[c]; if (!isFinite(v)) return; g.globalAlpha = .85; g.beginPath(); g.arc(PX(r.x), PY(v), 3.6, 0, 7); g.fill(); g.globalAlpha = 1; });
      } else if (type === 'bar') {
        rows.forEach((r, i) => { const v = r.vals[c]; if (!isFinite(v)) return; const x = PX(i) - (bw * k) / 2 + c * bw, y0 = PY(Math.max(sc.lo, Math.min(0, sc.hi))) , y1 = PY(v); g.fillRect(x + 1, Math.min(y0, y1), bw - 2, Math.abs(y1 - y0)); });
      } else {
        const P = rows.map(r => [PX(r.x), PY(r.vals[c])]).filter(p => isFinite(p[1]));
        if (type === 'area') { g.globalAlpha = 0.16; g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.lineTo(P[P.length - 1][0], PY(Math.max(sc.lo, 0))); g.lineTo(P[0][0], PY(Math.max(sc.lo, 0))); g.fill(); g.globalAlpha = 1; }
        g.beginPath(); P.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke();
        if (P.length <= 40) P.forEach(p => { g.beginPath(); g.arc(p[0], p[1], 3, 0, 7); g.fill(); });
      }
    }
    // legend
    if (k > 1) { g.textAlign = 'left'; let lx = padL; const ly = opts.title ? 44 : 16; g.font = '12px "Geist", system-ui, sans-serif';
      table.cols.forEach((c, i) => { g.fillStyle = T.pal[i % T.pal.length]; g.fillRect(lx, ly - 4, 10, 8); g.fillStyle = T.fg; g.fillText(c.name, lx + 15, ly); lx += g.measureText(c.name).width + 34; }); }
    return { projections, type };
  }
  root.UnchartRemake = { draw, project };
})(window);
