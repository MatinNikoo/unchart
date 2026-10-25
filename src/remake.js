// Remake: draw a chart cleanly from recovered numbers, as SVG, with every element under the user's control.
// render(table, opts) gives {svg, width, height, notes, geom}. draw(canvas, table, opts) paints the same picture on a canvas (older API).
// The options are plain data, so a chart is a small JSON document. The keys are listed in DEFAULTS.
(function (root) {
  'use strict';
  const ST = root.UnchartStyle || (typeof require !== 'undefined' ? require('./style.js') : null);
  const THEMES = {
    light: { bg: '#FFFFFF', fg: '#16161A', muted: '#5F5F67', grid: '#E3E3E8', axis: '#9A9AA2' },
    dark: { bg: '#111113', fg: '#ECECEA', muted: '#9A9AA0', grid: '#2B2B31', axis: '#5A5A61' },
    print: { bg: '#F3F0E8', fg: '#141414', muted: '#55514A', grid: '#DCD6CA', axis: '#8F887C' },
  };
  // light and dark versions of each palette. 'colorblind' is the Okabe and Ito set.
  const lighter = L => L.map(c => ST.mix(c, '#ffffff', 0.3));
  const pal = (name, L, D) => ({ name, light: L, dark: D || lighter(L) });
  const PALETTES = {
    unchart: { name: 'Unchart', light: ['#1F4FD8', '#FF5A1F', '#0E9F6E', '#9B51E0', '#D61F69', '#B7791F', '#0891B2', '#4B5563'],
      dark: ['#8FA3FF', '#FF7A45', '#3DDC97', '#C79BFF', '#FF6FA8', '#FFB020', '#22D3EE', '#D4D4D8'] },
    colorblind: { name: 'Colorblind safe', light: ['#0072B2', '#E69F00', '#009E73', '#CC79A7', '#56B4E9', '#D55E00', '#F0E442', '#000000'],
      dark: ['#56B4E9', '#E69F00', '#009E73', '#CC79A7', '#0072B2', '#D55E00', '#F0E442', '#FFFFFF'] },
    sheets: { name: 'Spreadsheet', light: ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E'],
      dark: ['#6F95DB', '#F29A5C', '#BFBFBF', '#FFCF40', '#86B5E3', '#8FC46C', '#4D6FB0', '#C86A30'] },
    blues: { name: 'One hue', light: ['#08306B', '#2171B5', '#6BAED6', '#9ECAE1', '#4292C6', '#C6DBEF', '#084594', '#DEEBF7'],
      dark: ['#DEEBF7', '#9ECAE1', '#6BAED6', '#4292C6', '#C6DBEF', '#2171B5', '#F7FBFF', '#08519C'] },
    original: { name: 'Same as the picture', light: ['#1F4FD8', '#FF5A1F', '#0E9F6E', '#9B51E0', '#D61F69', '#B7791F', '#0891B2', '#4B5563'],
      dark: ['#8FA3FF', '#FF7A45', '#3DDC97', '#C79BFF', '#FF6FA8', '#FFB020', '#22D3EE', '#D4D4D8'] },
    accent: { name: 'Gray with accent', light: ['#E4572E', '#4D4D55', '#8C8C94', '#B4B4BB', '#6A6A72', '#CFCFD4', '#2E2E33', '#A0A0A7'],
      dark: ['#FF7A45', '#D4D4D8', '#A1A1A8', '#7A7A82', '#BABAC0', '#5C5C63', '#EDEDEF', '#8E8E95'] },
    editorial: pal('Editorial', ['#0F5499', '#CC0000', '#00994D', '#F2A900', '#6B2D8B', '#00A0A0', '#7A4B2A', '#4D4D4D']),
    pastel: pal('Pastel', ['#6C8EBF', '#E8A87C', '#8FC1A9', '#C38D9E', '#E6C86E', '#8EA8C3', '#B8A1D9', '#A3A3A3']),
    vivid: pal('Vivid', ['#2563EB', '#F97316', '#16A34A', '#DB2777', '#EAB308', '#7C3AED', '#06B6D4', '#EF4444']),
    earth: pal('Earth', ['#8C510A', '#3B7A57', '#BF812D', '#35978F', '#A6611A', '#80CDC1', '#543005', '#01665E']),
    sunset: pal('Sunset', ['#7A1F5C', '#D6455D', '#F28C38', '#F7C948', '#4B3F72', '#B5446E', '#FF7B54', '#2F2A44']),
    ink: pal('Ink', ['#111111', '#555555', '#888888', '#B0B0B0', '#333333', '#6E6E6E', '#9C9C9C', '#CCCCCC']),
  };
  const FONTS = { sans: 'Arial, Helvetica, "Liberation Sans", sans-serif', serif: 'Georgia, "Times New Roman", "DejaVu Serif", serif',
    mono: '"Courier New", Courier, "Liberation Mono", monospace', wide: 'Verdana, "DejaVu Sans", sans-serif',
    times: '"Times New Roman", Times, "Liberation Serif", serif', narrow: '"Arial Narrow", "Liberation Sans Narrow", Arial, sans-serif',
    rounded: '"Trebuchet MS", "Lucida Grande", "DejaVu Sans", sans-serif', display: 'Impact, "Arial Black", "Haettenschweiler", sans-serif', hand: '"Comic Sans MS", "Comic Neue", cursive' };
  const FONT_NAMES = { sans: 'Sans (Arial)', serif: 'Serif (Georgia)', mono: 'Mono (Courier)', wide: 'Wide (Verdana)', times: 'Times', narrow: 'Narrow', rounded: 'Rounded (Trebuchet)', display: 'Display (Impact)', hand: 'Handwritten' };
  const TYPES = ['line', 'step', 'area', 'stackedArea', 'stackedArea100', 'bar', 'stacked', 'stacked100', 'hbar', 'hstacked', 'hstacked100', 'combo', 'lollipop', 'scatter', 'pie', 'donut'];
  const TYPE_NAMES = { line: 'Line', step: 'Steps', area: 'Area', stackedArea: 'Stacked area', stackedArea100: '100% stacked area', bar: 'Bars', stacked: 'Stacked bars', stacked100: '100% stacked bars',
    hbar: 'Horizontal bars', hstacked: 'Horizontal stacked', hstacked100: 'Horizontal 100%', combo: 'Bars and line', lollipop: 'Lollipop', scatter: 'Dots', pie: 'Pie', donut: 'Donut' };
  const AX_Y = { show: true, min: null, max: null, major: null, minor: null, log: null, base: 10, rev: false, cross: 'auto', side: 'left', units: 1, unitLab: false, fmt: '', ticks: 'none', mticks: 'none', lab: 'next', grid: null, mgrid: false, trot: -90 };
  const AX_X = { show: true, fmt: '', rot: 'auto', every: 'auto', rev: false, ticks: 'none', mticks: 'none', lab: 'low', grid: null, mgrid: false, min: null, max: null, major: null, between: 'auto', trot: 0 };
  const AX_Y2 = { show: true, min: null, max: null, major: null, fmt: '', ticks: 'none', units: 1, log: null, trot: 90 };
  const DEFAULTS = {
    type: 'line', theme: 'light', palette: 'unchart', font: 'sans', fontCustom: '', fontSize: 14, width: 800, aspect: 16 / 9, height: null,
    title: '', subtitle: '', xLabel: '', yLabel: '', y2Label: '', note: '', alt: '', yMin: null, yMax: null, zero: true, log: false, grid: 'value', legend: 'top', labels: false, trend: 'off',
    series: {}, slices: {},
    ax: { x: {}, y: {}, y2: {} }, tx: {}, fm: {}, so: {}, pl: {},
    bar: { gap: 40, overlap: 0, rad: 0, vary: false, neg: '' },
    ln: { w: 0, smooth: false, dash: 'solid', mk: 'auto', shape: 'circle', size: 0 },
    ar: { tr: 82 },
    pie: { start: 0, hole: 56, ex: 0, lab: 'inside', leader: true, center: '', cs: 0 },
    dl: { on: false, pos: 'auto', val: true, pct: false, cat: false, ser: false, sep: ', ', fmt: '' },
    lay: { m: { t: 0, r: 0, b: 0, l: 0 }, tal: 'start', lal: 'start', lx: 0.7, ly: 0.12, pad: { t: 0, r: 0, b: 0, l: 0 } },
    lg: { hide: [], sym: 'auto' },
    refs: [], ann: [], focus: { s: null, dim: 70 }, eb: { on: false, w: 1.4, cap: 4, c: '' },
  };
  // looks the user can pick in one click. 'honest' is the redraw that removes the usual tricks.
  const PRESETS = {
    clean: { name: 'Clean', set: { theme: 'light', palette: 'unchart', font: 'sans', grid: 'value', legend: 'top' } },
    dark: { name: 'Dark', set: { theme: 'dark', palette: 'unchart', font: 'sans', grid: 'value' } },
    print: { name: 'Print', set: { theme: 'print', palette: 'accent', font: 'serif', grid: 'value' } },
    colorblind: { name: 'Colorblind safe', set: { palette: 'colorblind' } },
    slides: { name: 'Slides', set: { fontSize: 18, aspect: 16 / 9, width: 1200, legend: 'bottom', labels: true } },
    honest: { name: 'Honest redraw', set: { zero: true, log: false, yMin: null, yMax: null, trend: 'off', grid: 'value' } },
  };
  const ISO = /^\d{4}-\d{2}-\d{2}$/, DAY = 864e5, MON = ST.MON.map(m => m.slice(0, 3));
  const esc = ST.esc, r2 = ST.r2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const num = v => v != null && v !== '' && isFinite(+v) ? +v : null;
  let ctx = null, seq = 0;
  function measurer() {
    if (typeof document !== 'undefined') return (s, size, fam, wt, it) => { ctx = ctx || document.createElement('canvas').getContext('2d'); ctx.font = `${it ? 'italic ' : ''}${wt || 400} ${size}px ${fam}`; return ctx.measureText(String(s)).width; };
    return (s, size, fam, wt) => String(s).length * size * (wt >= 600 ? 0.62 : 0.56);
  }
  function palette(name, dark) { const p = PALETTES[name] || PALETTES.unchart; return dark ? p.dark : p.light; }
  // a theme read off a chosen background color
  function themeFor(bg) {
    const dark = ST.luminance(bg) < 0.3, fg = dark ? '#ECECEA' : '#16161A';
    return { bg, fg, muted: ST.mix(fg, bg, 0.4), grid: ST.mix(bg, fg, 0.12), axis: ST.mix(bg, fg, 0.35), dark };
  }

  // Student t quantile for a two sided interval, good enough for small samples
  function tq(df, conf) {
    const z = conf >= 0.95 ? 1.96 : conf >= 0.9 ? 1.645 : 1.282;
    if (df <= 0) return z * 3;
    const g1 = (z ** 3 + z) / 4, g2 = (5 * z ** 5 + 16 * z ** 3 + 3 * z) / 96;
    return z + g1 / df + g2 / (df * df);
  }
  // Fit y on x (straight line) or log y on x (steady growth). Returns predictions with a 90% band.
  function project(xs, ys, kind, steps, stepSize, startX) {
    const pts = xs.map((x, i) => [x, ys[i]]).filter(p => isFinite(p[0]) && p[1] != null && isFinite(p[1]) && (kind !== 'growth' || p[1] > 0));
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
    const r2v = (() => { let st = 0; for (const y of Y) st += (y - my) ** 2; return st ? 1 - sse / st : 0; })();
    return { pts: out, slope: b, r2: r2v, kind };
  }

  function nice(lo, hi, n) {
    if (!(hi > lo)) { const c = isFinite(lo) ? lo : 0; lo = c - 1; hi = c + 1; }
    const span = hi - lo || Math.abs(hi) || 1, raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw * 0.999) || 10 * mag;
    return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step };
  }
  function decimals(step) { for (let d = 0; d <= 8; d++) { const q = step * Math.pow(10, d); if (Math.abs(q - Math.round(q)) < 1e-6 * Math.max(1, q)) return d; } return 8; }
  function fmtNum(v, d, euro) {
    if (v == null || !isFinite(v)) return '';
    const s = Math.abs(v).toFixed(Math.max(0, Math.min(8, d)));
    let [a, b] = s.split('.');
    if (a.length > 4) a = a.replace(/\B(?=(\d{3})+(?!\d))/g, euro ? '.' : ',');
    return (v < 0 && +s !== 0 ? '-' : '') + a + (b ? (euro ? ',' : '.') + b : '');
  }
  // digits for a value label: about three significant figures of the biggest value
  const labelDigits = maxAbs => Math.max(0, Math.min(4, 2 - Math.floor(Math.log10(maxAbs || 1))));
  const fmtDateAuto = (d, kind) => { const t = new Date(d * DAY); return kind === 'y' ? String(t.getUTCFullYear()) : kind === 'm' ? MON[t.getUTCMonth()] + ' ' + t.getUTCFullYear() : MON[t.getUTCMonth()] + ' ' + t.getUTCDate(); };
  const dateKind = span => span > 365 * 2.5 ? 'y' : span > 90 ? 'm' : 'd';
  function dateTicks(x0, x1, maxN) {
    const kind = dateKind(x1 - x0), out = [], a = new Date(x0 * DAY);
    if (kind === 'y') {
      for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 500]) {
        out.length = 0; let y = a.getUTCFullYear() + (Date.UTC(a.getUTCFullYear(), 0, 1) / DAY < x0 - 1e-9 ? 1 : 0); y = Math.ceil(y / s) * s;
        for (; Date.UTC(y, 0, 1) / DAY <= x1 + 1e-9; y += s) out.push(Date.UTC(y, 0, 1) / DAY);
        if (out.length <= maxN) break;
      }
    } else if (kind === 'm') {
      for (const s of [1, 2, 3, 6, 12]) {
        out.length = 0; let y = a.getUTCFullYear(), m = a.getUTCMonth(); if (Date.UTC(y, m, 1) / DAY < x0 - 1e-9) m++;
        while (m % s) m++;
        for (; Date.UTC(y, m, 1) / DAY <= x1 + 1e-9; m += s) out.push(Date.UTC(y, m, 1) / DAY);
        if (out.length <= maxN) break;
      }
    } else {
      for (const s of [1, 2, 7, 14, 28]) { out.length = 0; for (let d = Math.ceil(x0 - 1e-9); d <= x1 + 1e-9; d += s) out.push(d); if (out.length <= maxN) break; }
    }
    return { ticks: out.slice(), kind };
  }
  function validOrder(o, n) { return Array.isArray(o) && o.length === n && new Set(o).size === n && o.every(i => i >= 0 && i < n) ? o : Array.from({ length: n }, (_, i) => i); }

  function render(table, opts, measure) {
    const o = Object.assign({}, DEFAULTS, opts || {});
    const sub = k => Object.assign({}, DEFAULTS[k], o[k]);
    const BAR = sub('bar'), LN = sub('ln'), AR = sub('ar'), PIE = sub('pie'), DL = sub('dl'), LAY = sub('lay'), LG = sub('lg'), FOC = sub('focus'), EB = sub('eb');
    const AXO = o.ax || {}, AXY = Object.assign({}, AX_Y, AXO.y), AXX = Object.assign({}, AX_X, AXO.x), AXY2 = Object.assign({}, AX_Y2, AXO.y2);
    const FM = o.fm || {}, TX = o.tx || {}, SOO = o.so || {}, PL = o.pl || {};
    const M = measure || measurer();
    const fmx = (...keys) => keys.reduce((a, k) => ST.merge(a, FM[k]), {});
    let th = Object.assign({}, THEMES[o.theme] || THEMES.light);
    const cf = FM.chart && FM.chart.fill;
    if (cf && cf.t === 'solid' && ST.isHex(cf.c)) th = themeFor(cf.c);
    const dark = o.theme === 'dark' || (th.dark != null ? th.dark : false);
    const famOf = f => { if (!f) return null; if (FONTS[f]) return FONTS[f]; const t = String(f).replace(/["'{};<>]/g, '').trim(); return t ? `"${t}", ${FONTS.sans}` : null; };
    const fam = famOf(o.fontCustom) || famOf(o.font) || FONTS.sans, fs = clamp(+o.fontSize || 14, 8, 48);
    const W = Math.round(clamp(+o.width || 800, 240, 6000)), H = num(o.height) ? Math.round(clamp(+o.height, 120, 6000)) : Math.round(W / clamp(+o.aspect || 16 / 9, 0.4, 3));
    const pl0 = palette(o.palette, dark), parts = [], boxes = [], notes = [], id = 'uc' + (++seq), D = ST.makeDefs(id + '_');
    const Z = { bg: [], plot: [], band: [], grid: [], axis: [], marks: [], ref: [], box: [], text: [], ann: [] };
    const put = (layer, xml) => { Z[layer].push(xml); };
    const geom = { W, H, pts: {}, els: {}, colors: [] };
    const hit = (a, b, p) => a[0] < b[2] + p && b[0] < a[2] + p && a[1] < b[3] + p && b[1] < a[3] + p;
    const euro = !!o.euro;

    // ---------- text ----------
    // a text style: the base given by the caller, then whatever the user set for this element
    const tcol = {};
    const TS = (key, base) => { const t = TX[key] || {}; tcol[key] = { c: ST.isHex(t.c) ? t.c : base.c, size: clamp(+t.size || base.size, 6, 120), wt: t.wt || base.wt || 400 }; return { size: clamp(+t.size || base.size, 6, 120), wt: t.wt || base.wt || 400, it: !!t.it, c: ST.isHex(t.c) ? t.c : base.c, font: famOf(t.font) || fam,
      al: t.al || base.al || 'start', ls: +t.ls || 0, rot: num(t.rot), lh: clamp(+t.lh || 1.28, 0.9, 2.4), key }; };
    const tw = (s, st) => M(s, st.size, st.font, st.wt, st.it) + (st.ls ? st.ls * String(s).length : 0);
    const mark = (key, b) => { const e = geom.els[key]; geom.els[key] = e ? [Math.min(e[0], b[0]), Math.min(e[1], b[1]), Math.max(e[2], b[2]), Math.max(e[3], b[3])] : b.slice(); };
    // every piece of text goes through here, so its box is known and later labels can stay clear of it
    function text(x, y, s, st, opt = {}) {
      s = String(s); if (!s) return false;
      const w = tw(s, st), a = opt.anchor || 'start', size = st.size, rot = opt.rot != null ? opt.rot : 0, h = size * 1.24;
      const x0 = a === 'middle' ? -w / 2 : a === 'end' ? -w : 0;
      let b;
      if (!rot) b = [x + x0, y - h / 2, x + x0 + w, y + h / 2];
      else {
        const t = rot * Math.PI / 180, c = Math.cos(t), sn = Math.sin(t), xs = [], ys = [];
        for (const [px, py] of [[x0, -h / 2], [x0 + w, -h / 2], [x0, h / 2], [x0 + w, h / 2]]) { xs.push(x + px * c - py * sn); ys.push(y + px * sn + py * c); }
        b = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      }
      if (opt.avoid && (boxes.some(q => hit(q, b, 2)) || b[0] < 1 || b[2] > W - 1 || b[1] < 1 || b[3] > H - 1 || (opt.within && !(b[0] >= opt.within[0] && b[2] <= opt.within[2] && b[1] >= opt.within[1] && b[3] <= opt.within[3])))) return false;
      boxes.push(b);
      if (opt.el) mark(opt.el, b);
      put(opt.layer || 'text', `<text x="${r2(x)}" y="${r2(y)}" font-size="${size}"${st.wt !== 400 ? ` font-weight="${st.wt}"` : ''}${st.it ? ' font-style="italic"' : ''}${st.font !== fam ? ` font-family="${esc(st.font)}"` : ''} fill="${opt.color || st.c}" text-anchor="${a}" dominant-baseline="central"${st.ls ? ` letter-spacing="${st.ls}"` : ''}${rot ? ` transform="rotate(${r2(rot)} ${r2(x)} ${r2(y)})"` : ''}${opt.el ? ` data-el="${opt.el}"` : ''}${opt.j != null ? ` data-j="${opt.j}"` : ''}>${esc(s)}</text>`);
      return true;
    }
    function fit(s, st, maxW) {
      s = String(s); if (tw(s, st) <= maxW) return s;
      let lo = 0, hi = s.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tw(s.slice(0, mid) + '…', st) <= maxW) lo = mid; else hi = mid - 1; }
      return lo ? s.slice(0, lo).trimEnd() + '…' : '';
    }
    function wrap(s, st, maxW, maxLines) {
      const lines = [];
      for (const para of String(s).split(/\n/)) {
        let cur = '';
        for (const w of para.split(/\s+/).filter(Boolean)) { const t = cur ? cur + ' ' + w : w; if (tw(t, st) <= maxW || !cur) cur = t; else { lines.push(cur); cur = w; } }
        lines.push(cur);
      }
      if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = fit(lines[maxLines - 1] + ' …', st, maxW); }
      return lines.map(l => fit(l, st, maxW));
    }

    // ---------- data ----------
    const rows = (table && table.rows) || [], cols = (table && table.cols) || [];
    let xs = rows.map(r => r.x), xDate = !!o.xDate;
    if (xs.length && xs.every(x => typeof x === 'string' && ISO.test(x))) { xs = xs.map(x => Date.parse(x) / DAY); xDate = true; }
    const numericX = xs.length > 0 && xs.every(x => typeof x === 'number' && isFinite(x));
    let type = o.type === 'dots' ? 'scatter' : TYPES.includes(o.type) ? o.type : 'line';
    if (type === 'scatter' && !numericX) { type = 'line'; notes.push('Dots need numbers on x, so this one is drawn as a line.'); }
    const sOpt = o.series || {}, hidden = sOpt.hidden || [], names = sOpt.names || {}, colors = sOpt.colors || {};
    const kindOfType = { bar: 'bar', stacked: 'bar', stacked100: 'bar', hbar: 'bar', hstacked: 'bar', hstacked100: 'bar', area: 'area', stackedArea: 'area', stackedArea100: 'area', line: 'line', step: 'line', scatter: 'dot', lollipop: 'lolli' };
    const SER = validOrder(sOpt.order, cols.length).filter(i => !hidden.includes(i)).map(i => {
      const so = SOO[i] || {}, base = cols[i].type === 'bar' ? 'bar' : 'line';
      return { i, name: names[i] != null && names[i] !== '' ? names[i] : cols[i].name, so,
        color: ST.isHex(colors[i]) ? colors[i] : (o.palette === 'original' && cols[i].color) || pl0[i % pl0.length],
        kind: type === 'combo' ? (so.kind === 'bar' || so.kind === 'line' || so.kind === 'area' ? so.kind : base) : kindOfType[type] || 'line',
        right: (so.axis || cols[i].axis) === 'right',
        v: rows.map(r => { const q = r.vals[i]; return q == null || !isFinite(q) ? null : +q; }),
        err: rows.map(r => (r.errs && r.errs[i]) || null) };
    });
    if (type === 'combo' && !SER.some(s => s.kind === 'bar') && SER.length) SER[0].kind = 'bar';
    // a second value axis on the right, for series the original drew against one
    const dual = o.dual !== false && ['line', 'step', 'combo', 'bar'].includes(type) && SER.some(s => s.right) && SER.some(s => !s.right);
    if (dual) SER.forEach(s => { if (s.right) s.name += ' (right axis)'; });
    const pie = type === 'pie' || type === 'donut';
    let SL = [];
    if (pie) {
      const pOpt = o.slices || {}, src = SER[0];
      if (SER.length > 1) notes.push(`A pie shows one series, so this one uses ${src.name}.`);
      if (src) SL = validOrder(pOpt.order, rows.length).filter(k => !(pOpt.hidden || []).includes(k)).map(k => ({ k, name: (pOpt.names || {})[k] || String(rows[k].x),
        color: ST.isHex((pOpt.colors || {})[k]) ? pOpt.colors[k] : (o.palette === 'original' && rows[k].pts && rows[k].pts[0] && rows[k].pts[0].color) || pl0[k % pl0.length], v: src.v[k] })).filter(s => s.v != null && s.v > 0);
      if (src && src.v.some(v => v != null && v < 0)) notes.push('Negative values cannot be pie slices, so they are left out.');
    }
    const xLabelOf = j => {
      if (!numericX) return String(rows[j].x);
      const code = AXX.fmt;
      if (xDate) return code && ST.isDateCode(code) ? ST.fmtDate(xs[j], code) : fmtDateAuto(xs[j], dateKind((Math.max(...xs) - Math.min(...xs)) || 1));
      return code ? ST.fmtNumber(xs[j], code, { euro }) : fmtNum(xs[j], decimals(Math.abs(xs[j]) % 1 ? 0.0001 : 1), euro);
    };

    // ---------- formats of the marks ----------
    const fmBar = k => ST.merge(ST.merge({}, FM.bars), FM['s' + k]);
    const fmLine = k => ST.merge(ST.merge({}, FM.lines), FM['s' + k]);
    const fmArea = k => ST.merge(ST.merge({}, FM.areas), FM['s' + k]);
    const fmDot = k => ST.merge(ST.merge({}, FM.dots), FM['s' + k]);

    // ---------- background, header, note and legend ----------
    const m0 = Math.round(Math.max(12, W * 0.025)), mm = LAY.m || {};
    const mg = (v, size) => clamp(+v || 0, -m0, size * 0.3), mL = m0 + mg(mm.l, W), mR = m0 + mg(mm.r, W), mT = m0 + mg(mm.t, H), mB = m0 + mg(mm.b, H), PAD = LAY.pad || {};
    const chartFm = fmx('chart');
    {
      // the outline stays when the fill is turned off, and a transparent export keeps only the outline
      const noFill = o.transparent || (chartFm.fill && chartFm.fill.t === 'none'), rad = clamp(+chartFm.rad || 0, 0, Math.min(W, H) / 2);
      put('bg', `<rect width="${W}" height="${H}" pointer-events="all"${rad ? ` rx="${rad}"` : ''}${noFill ? ' fill="none"' : ST.fillAttr(chartFm.fill, th.bg, D)}${ST.lineAttr(chartFm.line, { c: null })} data-el="chart"/>`);
    }
    const fsT = Math.round(fs * 1.45), fsS = Math.round(fs * 1.05), fsN = Math.max(8, Math.round(fs * 0.82)), fsA = Math.round(fs * 0.9);
    const stT = TS('title', { size: fsT, wt: 700, c: th.fg, al: LAY.tal }), stS = TS('subtitle', { size: fsS, c: th.muted, al: LAY.tal }), stN = TS('note', { size: fsN, c: th.muted, al: LAY.tal });
    const stL = TS('legend', { size: fs, c: th.fg }), stTick = TS('xTick', { size: fsA, c: th.muted }), stYT = TS('yTick', { size: fsA, c: th.muted }), stY2T = TS('y2Tick', { size: fsA, c: th.muted });
    const stXT = TS('xTitle', { size: fs, c: th.muted, al: 'middle' }), stYTi = TS('yTitle', { size: fs, c: th.muted, al: 'middle' }), stY2Ti = TS('y2Title', { size: fs, c: th.muted, al: 'middle' }), stLab = TS('label', { size: fsA, c: th.fg });
    const alX = (st, from, to) => st.al === 'middle' ? [(from + to) / 2, 'middle'] : st.al === 'end' ? [to, 'end'] : [from, 'start'];
    let top = mT, bottom = H - mB;
    if (o.title) for (const l of wrap(o.title, stT, W - mL - mR, 2)) { const [x, a] = alX(stT, mL, W - mR); text(x, top + stT.size * 0.6, l, stT, { anchor: a, el: 'title' }); top += stT.size * stT.lh; }
    if (o.subtitle) for (const l of wrap(o.subtitle, stS, W - mL - mR, 2)) { const [x, a] = alX(stS, mL, W - mR); text(x, top + stS.size * 0.6, l, stS, { anchor: a, el: 'subtitle' }); top += stS.size * 1.3; }
    if (o.title || o.subtitle) top += fs * 0.5;
    if (o.note) { const L = wrap(o.note, stN, W - mL - mR, 3); for (let j = L.length - 1; j >= 0; j--) { const [x, a] = alX(stN, mL, W - mR); text(x, bottom - stN.size * 0.6, L[j], stN, { anchor: a, el: 'note' }); bottom -= stN.size * 1.3; } bottom -= fs * 0.4; }
    const hideL = LG.hide || [];
    const items = (pie ? SL.map(s => ({ name: s.name, color: s.color, key: 'sl' + s.k, k: s.k, kind: 'bar', fmKey: 'sl' + s.k })) :
      SER.length > 1 ? SER.map(s => ({ name: s.name, color: s.color, key: 's' + s.i, k: s.i, kind: s.kind, s, fmKey: 's' + s.i })) : []).filter(it => !hideL.includes(it.k));
    let legend = items.length ? o.legend : 'none', rightW = 0, leftW = 0;
    const sw = Math.round(fs * 0.75), legFm = fmx('legend');
    function swatch(x, y, it) {
      const el = `data-el="legend"`;
      if (it.kind === 'line') {
        const F = fmLine(it.k), ln = ST.lineAttr(Object.assign({}, F.line, { c: F.line && F.line.c ? F.line.c : it.color }), { c: it.color, w: 3, round: true });
        put('text', `<path d="M${r2(x)} ${r2(y)}h${sw}" fill="none"${ln} ${el}/>`);
      } else if (it.kind === 'dot') put('text', ST.marker((it.s && it.s.so.mk && it.s.so.mk.shape) || LN.shape || 'circle', x + sw / 2, y, sw / 2.4, ` fill="${it.color}"`, ` ${el}`));
      else { const F = it.kind === 'area' ? fmArea(it.k) : fmBar(it.k); put('text', `<rect x="${r2(x)}" y="${r2(y - sw / 2)}" width="${sw}" height="${sw}" rx="2"${ST.fillAttr(F.fill, it.color, D)}${ST.lineAttr(F.line, { c: null })} ${el}/>`); }
      mark('legend', [x, y - sw / 2, x + sw, y + sw / 2]);
    }
    const lgText = (x, y, it, nm) => text(x, y, nm, stL, { el: 'legend' });
    function legendRows(maxW) {
      const L = [[]]; let x = 0;
      for (const it of items) { const nm = fit(it.name, stL, Math.max(40, maxW * 0.45)), w = sw + 6 + tw(nm, stL) + fs * 1.3; if (x + w > maxW && L[L.length - 1].length) { L.push([]); x = 0; } L[L.length - 1].push({ it, nm, w }); x += w; }
      return L;
    }
    function legendBox(x0, y0, x1, y1) {
      if (!(legFm.fill && legFm.fill.t && legFm.fill.t !== 'none') && !(legFm.line && (legFm.line.c || legFm.line.t === 'solid'))) return;
      const p = 6; put('box', `<rect x="${r2(x0 - p)}" y="${r2(y0 - p)}" width="${r2(x1 - x0 + 2 * p)}" height="${r2(y1 - y0 + 2 * p)}" rx="${clamp(+legFm.rad || 0, 0, 20)}"${ST.fillAttr(legFm.fill, th.bg, D)}${ST.lineAttr(legFm.line, { c: null })} data-el="legend"/>`);
    }
    function drawRows(L, y0, from, to) {
      const rowH = stL.size * 1.55;
      L.forEach((row, r) => {
        const rw = row.reduce((a, q) => a + q.w, 0) - fs * 1.3, y = y0 + r * rowH + stL.size * 0.7;
        let x = LAY.lal === 'middle' ? (from + to) / 2 - rw / 2 : LAY.lal === 'end' ? to - rw : from;
        row.forEach(q => { swatch(x, y, q.it); lgText(x + sw + 6, y, q.it, q.nm); x += q.w; });
      });
      const e = geom.els.legend; if (e) legendBox(e[0], e[1], e[2], e[3]);
    }
    if (legend === 'top' || legend === 'bottom') {
      let L = legendRows(W - mL - mR);
      if (L.length > 3) { L = L.slice(0, 3); notes.push('Some legend entries did not fit.'); }
      const h = L.length * stL.size * 1.55;
      if (legend === 'top') { drawRows(L, top, mL, W - mR); top += h + fs * 0.4; } else { bottom -= h; drawRows(L, bottom + fs * 0.2, mL, W - mR); bottom -= fs * 0.3; }
    } else if (legend === 'right' || legend === 'left') {
      const maxW = Math.min(W * 0.3, Math.max(...items.map(it => sw + 8 + tw(it.name, stL))));
      if (legend === 'right') rightW = Math.ceil(maxW) + fs; else leftW = Math.ceil(maxW) + fs;
    }
    const right = W - mR - rightW, leftX = mL + leftW;
    function drawSide(y0, y1) {
      const rowH = stL.size * 1.55, n = Math.max(1, Math.floor((y1 - y0) / rowH)), w = (legend === 'right' ? rightW : leftW) - fs;
      const x = legend === 'right' ? W - mR - rightW + fs : mL;
      const show = items.length > n ? items.slice(0, n - 1) : items;
      show.forEach((it, r) => { const y = y0 + r * rowH + stL.size * 0.7; swatch(x, y, it); lgText(x + sw + 6, y, it, fit(it.name, stL, w - sw - 8)); });
      if (show.length < items.length) text(x, y0 + show.length * rowH + stL.size * 0.7, `+${items.length - show.length} more`, stL, { color: th.muted, el: 'legend' });
      const e = geom.els.legend; if (e) legendBox(e[0], e[1], e[2], e[3]);
    }
    // a legend dragged onto the chart sits on top of it and takes no room
    function drawFloating() {
      const rowH = stL.size * 1.55, w = Math.min(W * 0.4, Math.max(...items.map(it => sw + 8 + tw(it.name, stL)))), x0 = clamp(LAY.lx * W, 4, W - w - 4), y0 = clamp(LAY.ly * H, 4, H - items.length * rowH - 4);
      items.forEach((it, r) => { const y = y0 + r * rowH + stL.size * 0.7; swatch(x0, y, it); lgText(x0 + sw + 6, y, it, fit(it.name, stL, w - sw - 8)); });
      const e = geom.els.legend; if (e) legendBox(e[0], e[1], e[2], e[3]);
    }
    if (legend === 'custom') legend = 'float';

    // ---------- pie and donut ----------
    if (pie) {
      if (legend === 'right' || legend === 'left') drawSide(top, bottom);
      const tot = SL.reduce((a, s) => a + s.v, 0), outer = PIE.lab === 'outside' || (PIE.lab === 'best');
      const share = s => s.v / tot * 100, shareText = s => { const v = share(s); return (v < 10 ? v.toFixed(1) : v.toFixed(0)) + '%'; };
      // a pie label is any of the name, the series, and the share (or the value itself when a number format is set)
      const labText = s => { const a = []; if (DL.cat) a.push(s.name); if (DL.ser && SER[0]) a.push(SER[0].name); if (DL.val !== false || DL.pct) a.push(DL.fmt ? ST.fmtNumber(s.v, DL.fmt, { euro }) : shareText(s)); return a.join(DL.sep == null ? ', ' : DL.sep); };
      const showLabels = !!(DL.on || o.labels);
      const labs = showLabels ? SL.map(s => (PL['sl' + s.k] && PL['sl' + s.k].text) ? PL['sl' + s.k].text : PL['sl' + s.k] && PL['sl' + s.k].show === false ? '' : labText(s)) : [];
      const maxLW = outer && showLabels ? Math.min(W * 0.28, Math.max(0, ...labs.map(l => tw(l, stLab)))) : 0;
      const cx = (leftX + right) / 2, cy = (top + bottom) / 2, exF = clamp(+PIE.ex || 0, 0, 60) / 100;
      const R = Math.max(10, Math.min((right - leftX) / 2 - maxLW - (outer ? 22 : 0), (bottom - top) / 2 - (outer ? stLab.size * 1.4 : 0)) / (1 + exF) - 4), hole = type === 'donut' ? R * clamp((+PIE.hole || 56) / 100, 0.15, 0.9) : 0;
      let a0 = (-90 + (+PIE.start || 0)) * Math.PI / 180;
      const pt = (a, r, dx = 0, dy = 0) => [cx + dx + r * Math.cos(a), cy + dy + r * Math.sin(a)];
      const gap = clamp(num((FM.slices || {}).line && FM.slices.line.w) != null ? +FM.slices.line.w : 1.5, 0, 12);
      SL.forEach(s => {
        const fmS = ST.merge(ST.merge({}, FM.slices), FM['sl' + s.k]), a1 = a0 + s.v / tot * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0, am = (a0 + a1) / 2;
        const ex = (exF + (clamp(+((o.slices || {}).ex || {})[s.k] || 0, 0, 60)) / 100) * R, dx = ex * Math.cos(am), dy = ex * Math.sin(am);
        const attrs = ST.fillAttr(fmS.fill, s.color, D) + ST.lineAttr(fmS.line, { c: th.bg, w: gap }) + ` data-el="sl${s.k}" data-j="${s.k}"`;
        const eff = ST.effectId(fmS, D, W, H);
        let shape;
        if (SL.length === 1) shape = hole ? `<path d="M${r2(cx - R)} ${r2(cy)}a${r2(R)} ${r2(R)} 0 1 0 ${r2(2 * R)} 0a${r2(R)} ${r2(R)} 0 1 0 ${r2(-2 * R)} 0ZM${r2(cx - hole)} ${r2(cy)}a${r2(hole)} ${r2(hole)} 0 1 1 ${r2(2 * hole)} 0a${r2(hole)} ${r2(hole)} 0 1 1 ${r2(-2 * hole)} 0Z" fill-rule="evenodd"${attrs}/>` : `<circle cx="${r2(cx)}" cy="${r2(cy)}" r="${r2(R)}"${attrs}/>`;
        else { const [x0, y0] = pt(a0, R, dx, dy), [x1, y1] = pt(a1, R, dx, dy);
          let d = `M${r2(x0)} ${r2(y0)}A${r2(R)} ${r2(R)} 0 ${big} 1 ${r2(x1)} ${r2(y1)}`;
          if (hole) { const [x2, y2] = pt(a1, hole, dx, dy), [x3, y3] = pt(a0, hole, dx, dy); d += `L${r2(x2)} ${r2(y2)}A${r2(hole)} ${r2(hole)} 0 ${big} 0 ${r2(x3)} ${r2(y3)}Z`; } else d += `L${r2(cx + dx)} ${r2(cy + dy)}Z`;
          shape = `<path d="${d}"${attrs}/>`; }
        put('marks', eff ? `<g filter="url(#${eff})">${shape}</g>` : shape);
        s.a0 = a0; s.a1 = a1; s.dx = dx; s.dy = dy; geom.pts['sl' + s.k] = pt(am, (R + hole) / 2, dx, dy); mark('sl' + s.k, [cx - R, cy - R, cx + R, cy + R]);
        a0 = a1;
      });
      if (hole && PIE.center) { const stC = TS('pieCenter', { size: Math.round(hole * 0.42) || fs, wt: 700, c: th.fg, al: 'middle' }); const cs = Object.assign({}, stC, { size: Math.max(6, +PIE.cs || stC.size) }), cw = hole * 1.7;
        while (cs.size > 8 && tw(PIE.center, cs) > cw) cs.size -= 1;
        text(cx, cy, fit(PIE.center, cs, cw), cs, { anchor: 'middle', el: 'pieCenter' }); }
      if (showLabels) {
        const rr = hole ? (R + hole) / 2 : R * 0.64;
        let skipped = 0; const outs = [];
        SL.forEach((s, n) => { const lab = labs[n]; if (!lab) return; const w = tw(lab, stLab), am = (s.a0 + s.a1) / 2, arc = (s.a1 - s.a0) * rr;
          const inside = PIE.lab === 'inside' || (PIE.lab === 'best' && arc >= w + 6 && (s.a1 - s.a0) >= 0.22);
          if (inside) { const [lx, ly] = pt(am, rr, s.dx, s.dy); if (arc < w + 6 || (s.a1 - s.a0) < 0.22 || !text(lx, ly, lab, stLab, { anchor: 'middle', color: ST.inkOn(s.color), avoid: true, el: 'label', j: s.k })) skipped++; }
          else outs.push({ s, lab, am });
        });
        // outside labels, pushed apart on each side so they do not touch, with a leader line to the slice
        for (const side of [1, -1]) {
          const L = outs.filter(q => (Math.cos(q.am) >= 0 ? 1 : -1) === side).sort((a, b) => Math.sin(a.am) - Math.sin(b.am)), lh = stLab.size * 1.35;
          let prev = -1e9;
          L.forEach(q => { const [ex, ey] = pt(q.am, R + 8, q.s.dx, q.s.dy); q.y = Math.max(ey, prev + lh); prev = q.y; q.ex = ex; q.ey = ey; });
          const over = (L.length ? L[L.length - 1].y : 0) - (bottom - lh / 2); if (over > 0) L.forEach(q => { q.y -= over; });
          let nxt = 1e9; for (let n = L.length - 1; n >= 0; n--) { L[n].y = Math.min(L[n].y, nxt - lh); nxt = L[n].y; }
          L.forEach(q => { const [sx, sy] = pt(q.am, R * 0.98, q.s.dx, q.s.dy), lx = cx + side * (R + 22);
            if (PIE.leader !== false) put('text', `<path d="M${r2(sx)} ${r2(sy)}L${r2(q.ex)} ${r2(q.ey)}L${r2(lx - side * 4)} ${r2(q.y)}" fill="none" stroke="${th.axis}" stroke-width="1" data-el="label"/>`);
            if (!text(lx, q.y, q.lab, stLab, { anchor: side > 0 ? 'start' : 'end', avoid: true, el: 'label', j: q.s.k })) skipped++; });
        }
        if (skipped) notes.push(`${skipped} small slice${skipped > 1 ? 's are' : ' is'} too thin for a label.`);
      }
      if (legend === 'float') drawFloating();
      geom.pie = { cx, cy, R, hole };
      return finish([], { L: cx - R, T: cy - R, R: cx + R, B: cy + R });
    }

    // ---------- value scale ----------
    const stacked = ['stacked', 'stacked100', 'stackedArea', 'stackedArea100', 'hstacked', 'hstacked100'].includes(type), pct100 = ['stacked100', 'stackedArea100', 'hstacked100'].includes(type);
    const horiz = type === 'hbar' || type === 'hstacked' || type === 'hstacked100', barLike = ['bar', 'stacked', 'stacked100', 'hbar', 'hstacked', 'hstacked100', 'combo', 'lollipop'].includes(type);
    const n = rows.length;
    const cum = [];   // stacked: per row, per series [base, top]
    if (stacked) for (let j = 0; j < n; j++) {
      let p = 0, q = 0; const tot = SER.reduce((a, s) => a + Math.max(0, s.v[j] || 0), 0);
      cum.push(SER.map(s => { let v = s.v[j]; if (v == null) return null; if (pct100) v = tot ? Math.max(0, v) / tot * 100 : 0; if (v >= 0) { const b = [p, p + v]; p += v; return b; } const b = [q + v, q]; q += v; return b; }));
    }
    if (pct100 && SER.some(s => s.v.some(v => v != null && v < 0))) notes.push('Negative values are left out of the 100% charts.');
    let vals = [];
    if (stacked) cum.forEach(r => r.forEach(b => b && vals.push(b[0], b[1])));
    else SER.forEach(s => !(dual && s.right) && s.v.forEach(v => v != null && vals.push(v)));
    const vals2 = dual ? SER.filter(s => s.right).flatMap(s => s.v.filter(v => v != null && isFinite(v))) : [];
    // projections, only for numbers on x
    const projections = [];
    if (o.trend && o.trend !== 'off' && numericX && ['line', 'area', 'scatter', 'step'].includes(type) && n >= 3) {
      if (type === 'scatter') SER.forEach(s => { const ok = xs.map((x, j) => [x, s.v[j]]).filter(q => q[1] != null).sort((a, b) => a[0] - b[0]); const f = ok.length >= 3 ? project(ok.map(q => q[0]), ok.map(q => q[1]), 'linear', 30, (ok[ok.length - 1][0] - ok[0][0]) / 30, ok[0][0]) : null; if (f) f.fit = true; projections.push(f); });
      else { const dx = (xs[n - 1] - xs[0]) / Math.max(1, n - 1), steps = o.steps || Math.max(2, Math.round(n * 0.3)); SER.forEach(s => projections.push(project(xs, s.v, o.trend, steps, dx))); }
      projections.forEach(p => p && p.pts.forEach(q => vals.push(q.lo, q.hi)));
    }
    const ebOn = EB.on && !stacked && ['bar', 'hbar', 'line', 'step', 'scatter', 'combo', 'lollipop'].includes(type);
    if (ebOn) SER.forEach(s => { if (!(dual && s.right)) s.v.forEach((v, j) => { const e = s.err[j]; if (v != null && e) vals.push(v - e[0], v + e[1]); }); });
    vals = vals.filter(v => isFinite(v));
    if (!vals.length) vals = [0, 1];
    const logAllowed = ['line', 'step', 'scatter'].includes(type);
    let log = AXY.log != null ? !!AXY.log : !!o.log;
    if (log && (!logAllowed || vals.some(v => v <= 0))) { log = false; notes.push(logAllowed ? 'A log scale needs every value above zero.' : 'A log scale is only offered for lines and dots.'); }
    const lbase = AXY.base === 2 ? 2 : 10, lg = v => Math.log(v) / Math.log(lbase);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    const zero = !log && (o.zero || stacked || type === 'area');
    if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (barLike && !zero && !log) notes.push('These bars do not start at zero, so the differences look bigger than they are.');
    if (lo === hi) { lo -= Math.abs(lo) * 0.1 || 1; hi += Math.abs(hi) * 0.1 || 1; }
    let userLo = num(AXY.min) != null ? +AXY.min : num(o.yMin), userHi = num(AXY.max) != null ? +AXY.max : num(o.yMax);
    // a limit on the wrong side of the data, or a minimum above the maximum, would draw nothing sensible
    if (userLo != null && userHi != null && userLo >= userHi) { notes.push('The axis minimum is not below the maximum, so both were ignored.'); userLo = userHi = null; }
    else if (userLo != null && userHi == null && userLo >= hi && !log) hi = userLo + (hi - lo || 1);
    else if (userHi != null && userLo == null && userHi <= lo && !log) lo = userHi - (hi - lo || 1);
    const suffix = pct100 ? '%' : '', unit = num(AXY.units) > 0 ? +AXY.units : 1;
    const revY = !!AXY.rev, revX = !!AXX.rev;

    // ---------- plot box ----------
    const xTitleH = o.xLabel ? stXT.size * 1.7 : 0, yTitleW = o.yLabel ? stYTi.size * 1.6 : 0, y2TitleW = dual && o.y2Label ? stY2Ti.size * 1.6 : 0;
    const showY = AXY.show !== false, showX = AXX.show !== false;
    const tickLen = k => k === 'none' ? 0 : 5;
    const D0 = { lo, hi, uLo: userLo, uHi: userHi, log, major: num(AXY.major), minor: num(AXY.minor), rev: revY };
    let D1 = null;
    if (dual && vals2.length) { let a = Math.min(...vals2), b = Math.max(...vals2); if (zero || type === 'bar' || type === 'combo') { a = Math.min(0, a); b = Math.max(0, b); } if (a === b) { a -= 1; b += 1; } D1 = { lo: a, hi: b, uLo: num(AXY2.min), uHi: num(AXY2.max), log: false, major: num(AXY2.major), minor: null, rev: revY }; }
    function scaleFor(len, gap, Dm) {
      const nT = Math.max(2, Math.floor(len / gap)), { uLo, uHi, lo, hi, log, major, minor, rev } = Dm;
      const wrapS = (o2) => Object.assign(o2, { f: rev ? v => 1 - o2.f0(v) : o2.f0 });
      if (log) {
        const a = Math.floor(lg(uLo > 0 ? uLo : lo) + 1e-9), b = Math.ceil(lg(uHi > 0 ? uHi : hi) - 1e-9), ticks = [], mt = [];
        const dec = Math.max(1, b - a), every = Math.max(1, Math.ceil(dec / nT));
        for (let e = a; e <= b; e += every) ticks.push(Math.pow(lbase, e));
        if (dec <= 2) for (let e = a; e < b; e++) for (const k of lbase === 2 ? [] : [2, 5]) ticks.push(k * Math.pow(lbase, e));
        ticks.sort((p, q) => p - q);
        const L = uLo > 0 ? uLo : Math.pow(lbase, a), U = uHi > 0 ? uHi : Math.pow(lbase, b);
        if (minor) for (let e = a; e < b; e++) for (let k = 2; k < lbase; k++) mt.push(k * Math.pow(lbase, e));
        return wrapS({ lo: L, hi: U, ticks: ticks.filter(t => t >= L * 0.999 && t <= U * 1.001), minor: mt.filter(t => t >= L && t <= U), step: null, d: v => decimals(v < 1 ? v : 1), log: true, f0: v => (lg(v) - lg(L)) / (lg(U) - lg(L)) });
      }
      const s = nice(uLo != null ? uLo : lo, uHi != null ? uHi : hi, nT), L = uLo != null ? uLo : s.lo, U = uHi != null && uHi > L ? uHi : Math.max(s.hi, L + s.step);
      const step = major > 0 && (U - L) / major <= 400 ? major : (s.step > 0 ? s.step : 1), ticks = [], mt = [];
      for (let v = Math.ceil(L / step - 1e-9) * step; v <= U + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12));
      if (minor > 0 && (U - L) / minor <= 800) for (let v = Math.ceil(L / minor - 1e-9) * minor; v <= U + minor * 1e-6; v += minor) { const w = +v.toPrecision(12); if (!ticks.some(t => Math.abs(t - w) < minor * 1e-6)) mt.push(w); }
      const d = decimals(step / (Dm === D0 ? unit : 1));
      return wrapS({ lo: L, hi: U, ticks, minor: mt, step, d: () => d, f0: v => (v - L) / ((U - L) || 1) });
    }
    const vfmt = (sc, v, axis) => { const A = axis === 2 ? AXY2 : AXY, u = axis === 2 ? (num(AXY2.units) > 0 ? +AXY2.units : 1) : unit, code = A.fmt;
      if (code) return ST.isDateCode(code) ? ST.fmtDate(v, code) : ST.fmtNumber(v / u, code, { euro });
      return fmtNum(v / u, u !== 1 ? Math.min(6, decimals(sc.step ? sc.step / u : 1)) : sc.d(v), euro) + suffix; };
    let sc, sc2 = null, L, R, B = 0, T = 0, xLabH = 0, xRot = 0, xEvery = 1, topExtra = 0;
    const pd = (v, size) => clamp(+v || 0, -size * 0.1, size * 0.3), padT = pd(PAD.t, H), padB = pd(PAD.b, H), padL = pd(PAD.l, W), padR = pd(PAD.r, W);
    const contX = numericX && !barLike;
    const vScale = (Dm, len) => { let gap = fs * 2.6, q = scaleFor(len, gap, Dm);
      const tight = () => q.ticks.some((v, i) => i && Math.abs(q.f(v) - q.f(q.ticks[i - 1])) * len < fsA * 1.45);
      if (!(Dm.major > 0)) { for (let k = 0; k < 8 && tight(); k++) { gap *= 1.5; q = scaleFor(len, gap, Dm); } if (tight()) q.ticks = [q.ticks[0], q.ticks[q.ticks.length - 1]]; }
      return q; };
    const ySide = AXY.side === 'right' && !dual ? 'right' : 'left';
    const tickLab = rot => {
      // the height the x labels need under the plot
      if (!showX) return 0;
      return rot ? Math.min(H * 0.28, Math.max(...rows.map((_, j) => tw(xLabelOf(j), stTick))) * Math.abs(Math.sin(rot * Math.PI / 180)) + stTick.size * 1.2) + 4 : stTick.size * 1.9;
    };
    const pass = () => {
      T = top + fs * 0.5 + topExtra + padT; B = bottom - xLabH - xTitleH - padB; if (B - T < 40) B = T + 40;
      if (!horiz) {
        sc = vScale(D0, B - T);
        const tickW = showY ? Math.max(...sc.ticks.map(v => tw(vfmt(sc, v), stYT))) + tickLen(AXY.ticks) : 0, lw = showY ? tickW + fs * 0.6 : 0;
        if (ySide === 'right') { L = leftX + padL; R = right - yTitleW - lw - padR; } else { L = leftX + yTitleW + lw + padL; R = right - padR; }
        if (R - L < 40) R = L + 40;
        if (D1) { sc2 = vScale(D1, B - T); R -= (showY ? Math.max(...sc2.ticks.map(v => tw(vfmt(sc2, v, 2), stY2T))) + fs * 0.6 : 0) + y2TitleW; }
      } else {
        const catW = showX ? Math.min((right - leftX) * 0.35, Math.max(...rows.map((_, j) => tw(xLabelOf(j), stTick)))) : 0;
        L = leftX + yTitleW + (catW ? catW + fs * 0.6 : 0) + padL; R = right - padR;
        let gap = fs * 4; const edgeW = () => Math.max(...sc.ticks.map(v => tw(vfmt(sc, v), stYT))) / 2 + 2; sc = scaleFor(R - L, gap, D0);
        if (!(D0.major > 0)) for (let k = 0; k < 6; k++) { const w = Math.max(...sc.ticks.map(v => tw(vfmt(sc, v), stYT))) + fs * 1.2; if (w * sc.ticks.length <= (R - L) * 0.95) break; gap *= 1.4; sc = scaleFor(R - L, gap, D0); }
        R = Math.min(R, right - edgeW()); if (R - L < 40) R = L + 40; sc = scaleFor(R - L, gap, D0); L = Math.max(L, leftX + edgeW() - 2);
      }
    };
    if (horiz) { xLabH = showY ? stYT.size * 1.9 : 0; }
    pass();
    if (!horiz) {
      // x labels: decide the tilt and how many to skip, now that the plot width is known
      const band0 = (R - L) / Math.max(1, n);
      if (!contX && showX) {
        const maxW = Math.max(...rows.map((_, j) => tw(xLabelOf(j), stTick))), rotUser = AXX.rot === 'auto' ? null : +AXX.rot;
        const every0 = Math.max(1, Math.ceil((Math.min(maxW, band0 * 3) + fs * 0.8) / band0));
        xRot = rotUser != null ? rotUser : stTick.rot != null ? stTick.rot : every0 > 1 && band0 >= stTick.size * 1.5 ? -45 : 0;
        xEvery = num(AXX.every) > 0 ? Math.round(AXX.every) : xRot ? Math.max(1, Math.ceil(stTick.size * 1.5 / band0)) : every0;
      }
      xLabH = tickLab(xRot) + tickLen(AXX.ticks);
      if (AXX.lab === 'high') { topExtra = xLabH + stTick.size * 0.6; xLabH = 0; } else topExtra = 0;
      pass();
    }
    if (legend === 'right' || legend === 'left') drawSide(T, B);
    if (legend === 'float') drawFloating();
    // numbers on x drawn edge to edge: leave room for half of the last label
    let xLo = 0, xHi = 1, xt = null;
    const allInt = numericX && xs.every(x => Number.isInteger(x));
    if (contX) {
      xLo = Math.min(...xs); xHi = Math.max(...xs);
      projections.forEach(p => p && p.pts.forEach(q => { xLo = Math.min(xLo, q.x); xHi = Math.max(xHi, q.x); }));
      if (xLo === xHi) { xLo -= 1; xHi += 1; }
      if (type === 'scatter' && !xDate) { const s = nice(xLo, xHi, 6); xLo = s.lo; xHi = s.hi; }
      const okLim = v => num(v) != null && (!xDate || Math.abs(+v) < 3e6);
      if (okLim(AXX.min)) xLo = +AXX.min; if (okLim(AXX.max) && +AXX.max > xLo) xHi = +AXX.max;
      if (!(xHi > xLo)) xHi = xLo + 1;
      const xl = v => AXX.fmt ? (ST.isDateCode(AXX.fmt) ? ST.fmtDate(v, AXX.fmt) : ST.fmtNumber(v, AXX.fmt, { euro })) : xDate ? fmtDateAuto(v, xt ? xt.kind : dateKind(xHi - xLo)) : fmtNum(v, 2, euro);
      const sample = xl(xHi);
      R = Math.min(R, W - mR - tw(sample, stTick) / 2);
      L = Math.max(L, mL + tw(xl(xLo), stTick) / 2 + 1);
      for (let want = Math.max(2, Math.floor((R - L) / (tw(sample, stTick) + fs * 1.5))); want >= 2; want--) {
        if (xDate) xt = dateTicks(xLo, xHi, want);
        else { const s = nice(xLo, xHi, want), t = [], okMajor = num(AXX.major) > 0 && (xHi - xLo) / +AXX.major <= 400, step = okMajor ? +AXX.major : s.step; if (allInt && step < 1) s.step = 1; const st2 = okMajor ? step : s.step; for (let v = Math.ceil(xLo / st2 - 1e-9) * st2; v <= xHi + st2 * 1e-6; v += st2) t.push(Math.abs(v) < st2 * 1e-9 ? 0 : +v.toPrecision(12)); xt = { ticks: t, d: decimals(st2) }; }
        const pos = v => L + (v - xLo) / (xHi - xLo) * (R - L), lab = v => xDate ? (AXX.fmt && ST.isDateCode(AXX.fmt) ? ST.fmtDate(v, AXX.fmt) : fmtDateAuto(v, xt.kind)) : AXX.fmt ? ST.fmtNumber(v, AXX.fmt, { euro }) : fmtNum(v, xt.d, euro);
        const bx = xt.ticks.map(v => { const w = tw(lab(v), stTick); return [pos(v) - w / 2, pos(v) + w / 2]; });
        if ((num(AXX.major) > 0 && !xDate) || bx.every((b, i) => !i || b[0] > bx[i - 1][1] + fs * 0.8)) break;
      }
    }
    const VP = v => sc.f(v);   // 0..1 along the value axis
    const Y = v => B - VP(v) * (B - T), X = v => L + VP(v) * (R - L), Y2 = sc2 ? v => B - sc2.f(v) * (B - T) : Y, YS = s => dual && s.right ? Y2 : Y;
    const band = (horiz ? (B - T) : (R - L)) / Math.max(1, n);
    const idx = j => revX ? n - 1 - j : j;
    const CX = j => contX ? L + (xs[j] - xLo) / (xHi - xLo) * (R - L) : (horiz ? T : L) + (idx(j) + 0.5) * band;
    const xpos = v => L + (v - xLo) / (xHi - xLo) * (R - L);
    geom.plot = { L, T, R, B, horiz }; geom.band = band;
    const clipPad = barLike ? 0 : 6;
    const clipId = id + 'c';
    D.add('clip', () => `<clipPath id="${clipId}"><rect x="${r2(L - clipPad)}" y="${r2(T - 2)}" width="${r2(R - L + 2 * clipPad)}" height="${r2(B - T + 4)}"/></clipPath>`);
    const plotFm = fmx('plot');
    if ((plotFm.fill && plotFm.fill.t && plotFm.fill.t !== 'none') || plotFm.line && (plotFm.line.c || plotFm.line.t === 'solid') || ST.hasEffects(plotFm)) {
      const eff = ST.effectId(plotFm, D, W, H), r = `<rect x="${r2(L)}" y="${r2(T)}" width="${r2(R - L)}" height="${r2(B - T)}" pointer-events="all"${ST.fillAttr(plotFm.fill, th.bg, D)}${ST.lineAttr(plotFm.line, { c: null })} data-el="plot"/>`;
      put('plot', eff ? `<g filter="url(#${eff})">${r}</g>` : r);
    } else put('plot', `<rect x="${r2(L)}" y="${r2(T)}" width="${r2(R - L)}" height="${r2(B - T)}" fill="none" pointer-events="all" data-el="plot"/>`);
    mark('plot', [L, T, R, B]);

    // ---------- grid, bands and axes ----------
    const gridFm = fmx('grid'), gridMFm = fmx('gridM');
    const gAttr = (F, base) => ST.lineAttr(F.line, base);
    const yGrid = AXY.grid != null ? !!AXY.grid : (o.grid === 'value' || o.grid === 'both'), xGrid = AXX.grid != null ? !!AXX.grid : o.grid === 'both';
    const base = log ? sc.lo : (() => { const c = AXY.cross === 'auto' || num(AXY.cross) == null ? 0 : +AXY.cross; return clamp(c, sc.lo, sc.hi); })();
    const gLine = (x1, y1, x2, y2, F, def, el) => put('grid', `<path d="M${r2(x1)} ${r2(y1)}${x1 === x2 ? 'V' + r2(y2) : 'H' + r2(x2)}" fill="none"${gAttr(F, def)} data-el="${el}"/>`);
    const gMain = { c: th.grid, w: 1 }, gMin = { c: ST.mix(th.grid, th.bg, 0.5), w: 0.75 };
    if (!horiz) {
      sc.ticks.forEach(v => { const y = Math.round(Y(v)) + 0.5; if (yGrid) gLine(L, y, R, y, gridFm, gMain, 'grid'); });
      if (AXY.mgrid) sc.minor.forEach(v => { const y = Math.round(Y(v)) + 0.5; gLine(L, y, R, y, gridMFm, gMin, 'gridM'); });
    } else {
      sc.ticks.forEach(v => { const x = Math.round(X(v)) + 0.5; if (yGrid) gLine(x, T, x, B, gridFm, gMain, 'grid'); });
      if (AXY.mgrid) sc.minor.forEach(v => { const x = Math.round(X(v)) + 0.5; gLine(x, T, x, B, gridMFm, gMin, 'gridM'); });
    }
    // axis tick labels and marks, value axis
    const axisYFm = fmx('axisY'), axisXFm = fmx('axisX'), axisY2Fm = fmx('axisY2');
    const tk = (x1, y1, dir, len, kind, F, def, el) => { // a tick mark across a vertical or horizontal axis line
      const a = kind === 'in' ? -1 : kind === 'cross' ? -1 : 0, b = kind === 'in' ? 0 : 1; if (kind === 'none') return;
      put('axis', `<path d="M${r2(x1 + (dir === 'x' ? a * len : 0))} ${r2(y1 + (dir === 'y' ? a * len : 0))}${dir === 'x' ? 'H' + r2(x1 + b * len * (kind === 'cross' ? 1 : 1)) : 'V' + r2(y1 + b * len * (kind === 'cross' ? 1 : 1))}" fill="none"${ST.lineAttr(F.line, def)} data-el="${el}"/>`);
    };
    const yAxisX = ySide === 'right' ? R : L;
    if (showY) {
      const every = Math.max(1, Math.ceil(stYT.size * 1.45 / Math.max(1, Math.min(...sc.ticks.map((v, i) => i ? Math.abs(sc.f(v) - sc.f(sc.ticks[i - 1])) * (horiz ? R - L : B - T) : 1e9)))));
      sc.ticks.forEach((v, i) => {
        if (!horiz) { const y = Math.round(Y(v)) + 0.5, lab = vfmt(sc, v);
          if (AXY.lab !== 'none' && (i % every === 0 || sc.ticks.length <= 3)) text(ySide === 'right' ? yAxisX + tickLen(AXY.ticks) + fs * 0.5 : yAxisX - tickLen(AXY.ticks) - fs * 0.5, y, lab, stYT, { anchor: ySide === 'right' ? 'start' : 'end', el: 'yTick' });
          tk(yAxisX, y, 'x', tickLen(AXY.ticks), ySide === 'right' ? (AXY.ticks === 'out' ? 'in' : AXY.ticks === 'in' ? 'out' : AXY.ticks) : AXY.ticks, axisYFm, { c: th.axis, w: 1 }, 'axisY'); }
        else { const x = Math.round(X(v)) + 0.5;
          if (AXY.lab !== 'none' && (i % every === 0 || sc.ticks.length <= 3)) text(x, B + tickLen(AXY.ticks) + stYT.size * 1.3, vfmt(sc, v), stYT, { anchor: 'middle', el: 'yTick' });
          tk(x, B, 'y', tickLen(AXY.ticks), AXY.ticks === 'out' ? 'out' : AXY.ticks, axisYFm, { c: th.axis, w: 1 }, 'axisY'); }
      });
      if (AXY.mticks !== 'none') sc.minor.forEach(v => { if (!horiz) tk(yAxisX, Math.round(Y(v)) + 0.5, 'x', 3, ySide === 'right' ? (AXY.mticks === 'out' ? 'in' : 'out') : AXY.mticks, axisYFm, { c: th.axis, w: 1 }, 'axisY'); else tk(Math.round(X(v)) + 0.5, B, 'y', 3, AXY.mticks, axisYFm, { c: th.axis, w: 1 }, 'axisY'); });
      if (sc2) sc2.ticks.forEach(v => { const y = Math.round(Y2(v)) + 0.5; text(R + fs * 0.5 + tickLen(AXY2.ticks), y, vfmt(sc2, v, 2), stY2T, { el: 'y2Tick' }); tk(R, y, 'x', tickLen(AXY2.ticks), AXY2.ticks === 'out' ? 'in' : AXY2.ticks === 'in' ? 'out' : AXY2.ticks, axisY2Fm, { c: th.axis, w: 1 }, 'axisY2'); });
      if (unit !== 1 && AXY.unitLab) { const nm = (ST.UNITS.find(u => u[1] === unit) || [String(unit)])[0]; text(horiz ? R : yAxisX, horiz ? B + stYT.size * 2.9 : T - stYT.size * 0.2, nm, Object.assign({}, stYT, { size: Math.max(8, stYT.size - 1) }), { anchor: horiz ? 'end' : ySide === 'right' ? 'start' : 'end', el: 'yTick', avoid: true }); }
      const yl = axisYFm.line, drawYLine = yl && (yl.c || yl.t === 'solid');
      if (drawYLine) put('axis', horiz ? `<path d="M${r2(L)} ${r2(B)}H${r2(R)}" fill="none"${ST.lineAttr(yl, { c: th.axis, w: 1 })} data-el="axisY"/>` : `<path d="M${r2(yAxisX)} ${r2(T)}V${r2(B)}" fill="none"${ST.lineAttr(yl, { c: th.axis, w: 1 })} data-el="axisY"/>`);
      if (sc2 && axisY2Fm.line && (axisY2Fm.line.c || axisY2Fm.line.t === 'solid')) put('axis', `<path d="M${r2(R)} ${r2(T)}V${r2(B)}" fill="none"${ST.lineAttr(axisY2Fm.line, { c: th.axis, w: 1 })} data-el="axisY2"/>`);
    }
    // the line the categories (or x numbers) sit on
    const baseY = Math.round(Y(base)) + 0.5, baseX = Math.round(X(base)) + 0.5;
    if (showX) {
      const xl = axisXFm.line, def = { c: th.axis, w: 1 };
      if (!(xl && xl.t === 'none')) put('axis', !horiz ? `<path d="M${r2(L)} ${baseY}H${r2(R)}" fill="none"${ST.lineAttr(xl, def)} data-el="axisX"/>` : `<path d="M${baseX} ${r2(T)}V${r2(B)}" fill="none"${ST.lineAttr(xl, def)} data-el="axisX"/>`);
    }
    const labY = AXX.lab === 'next' ? baseY + tickLen(AXX.ticks) : AXX.lab === 'high' ? T - tickLen(AXX.ticks) : B + tickLen(AXX.ticks);
    if (showX && contX) {
      const lab = v => xDate ? (AXX.fmt && ST.isDateCode(AXX.fmt) ? ST.fmtDate(v, AXX.fmt) : fmtDateAuto(v, xt.kind)) : AXX.fmt ? ST.fmtNumber(v, AXX.fmt, { euro }) : fmtNum(v, xt.d, euro);
      xt.ticks.forEach(v => { const x = Math.round(xpos(v)) + 0.5; if (xGrid) gLine(x, T, x, B, gridFm, gMain, 'grid'); tk(x, AXX.lab === 'next' ? baseY : B, 'y', tickLen(AXX.ticks), AXX.ticks, axisXFm, { c: th.axis, w: 1 }, 'axisX');
        text(x, AXX.lab === 'high' ? labY - stTick.size * 1.3 : labY + stTick.size * 1.3, lab(v), stTick, { anchor: 'middle', el: 'xTick' }); });
      if (AXX.mgrid && xt.ticks.length > 1) for (let i = 0; i < xt.ticks.length - 1; i++) { const x = Math.round(xpos((xt.ticks[i] + xt.ticks[i + 1]) / 2)) + 0.5; gLine(x, T, x, B, gridMFm, gMin, 'gridM'); }
    } else if (showX && !horiz) {
      const between = AXX.between === 'auto' ? barLike : AXX.between === 'between';
      const rowsShown = rows.map((_, j) => j).filter(j => j % xEvery === 0);
      rows.forEach((_, j) => {
        const cxj = CX(j);
        if (xGrid) gLine(Math.round(cxj) + 0.5, T, Math.round(cxj) + 0.5, B, gridFm, gMain, 'grid');
        if (AXX.mgrid && j < n - 1) gLine(Math.round(cxj + band / 2) + 0.5, T, Math.round(cxj + band / 2) + 0.5, B, gridMFm, gMin, 'gridM');
        if (AXX.ticks !== 'none') tk(between ? cxj - band / 2 : cxj, AXX.lab === 'next' ? baseY : B, 'y', tickLen(AXX.ticks), AXX.ticks, axisXFm, { c: th.axis, w: 1 }, 'axisX');
        if (between && AXX.ticks !== 'none' && j === n - 1) tk(cxj + band / 2, AXX.lab === 'next' ? baseY : B, 'y', tickLen(AXX.ticks), AXX.ticks, axisXFm, { c: th.axis, w: 1 }, 'axisX');
        if (!rowsShown.includes(j)) return;
        const s = xLabelOf(j);
        if (xRot) { const maxLen = Math.max(40, xLabH * 1.2 / Math.abs(Math.sin(xRot * Math.PI / 180)) - 4);
          text(cxj + (xRot < 0 ? stTick.size * 0.3 : -stTick.size * 0.3), labY + stTick.size * 0.5, fit(s, stTick, maxLen), stTick, { anchor: xRot < 0 ? 'end' : 'start', rot: xRot, el: 'xTick' }); }
        else text(cxj, AXX.lab === 'high' ? labY - stTick.size * 1.3 : labY + stTick.size * 1.3, fit(s, stTick, band * xEvery - fs * 0.6), stTick, { anchor: 'middle', el: 'xTick', avoid: true });
      });
    } else if (showX && horiz) {
      const every = num(AXX.every) > 0 ? Math.round(AXX.every) : Math.max(1, Math.ceil(stTick.size * 1.4 / band));
      rows.forEach((_, j) => { if (j % every) return; const cyj = CX(j);
        if (xGrid) gLine(L, Math.round(cyj) + 0.5, R, Math.round(cyj) + 0.5, gridFm, gMain, 'grid');
        text(L - fs * 0.5 - tickLen(AXX.ticks), cyj, fit(xLabelOf(j), stTick, L - leftX - yTitleW - fs * 0.6), stTick, { anchor: 'end', el: 'xTick' }); });
    }
    if (o.xLabel) { const [x, a] = alX(stXT, L, R); text(x, B + xLabH + stXT.size * 0.85 + (padB ? 0 : 0), fit(o.xLabel, stXT, R - L), stXT, { anchor: a, el: 'xTitle' }); }
    if (o.yLabel) { const rot = stYTi.rot != null ? stYTi.rot : AXY.trot != null && !horiz ? +AXY.trot : -90;
      const tx = ySide === 'right' ? W - mR - stYTi.size * 0.7 - rightW : leftX + stYTi.size * 0.7; text(tx, (T + B) / 2, fit(o.yLabel, stYTi, B - T), stYTi, { anchor: 'middle', rot, el: 'yTitle' }); }
    if (dual && o.y2Label) text(W - mR - rightW - stY2Ti.size * 0.7, (T + B) / 2, fit(o.y2Label, stY2Ti, B - T), stY2Ti, { anchor: 'middle', rot: 90, el: 'y2Title' });

    // ---------- reference lines and bands ----------
    const refs = Array.isArray(o.refs) ? o.refs : [];
    const valPos = v => horiz ? X(v) : Y(v), catPos = v => contX ? xpos(v) : (horiz ? T : L) + (revX ? n - 1 - v : v) * band + band / 2;
    refs.forEach(rf => {
      const key = 'ref:' + rf.id, F = fmx(key), vAx = rf.axis !== 'x', v1 = num(rf.v), v2 = num(rf.v2);
      if (v1 == null) return;
      const c = ST.isHex(F.line && F.line.c) ? F.line.c : th.fg, band2 = rf.kind === 'band' && v2 != null, stR = TS(key, { size: fsA, c, wt: 600 });
      let p1, p2;
      if (vAx) { if (log && (v1 <= 0 || (band2 && v2 <= 0))) return; p1 = valPos(v1); p2 = band2 ? valPos(v2) : p1; }
      else { p1 = catPos(v1); p2 = band2 ? catPos(v2) : p1; if (!contX && band2) { const lo2 = Math.min(p1, p2) - band / 2, hi2 = Math.max(p1, p2) + band / 2; p1 = lo2; p2 = hi2; } }
      const inRange = v => vAx ? (horiz ? v >= L - 1 && v <= R + 1 : v >= T - 1 && v <= B + 1) : (horiz ? v >= T - 1 && v <= B + 1 : v >= L - 1 && v <= R + 1);
      if (!inRange(p1) && !inRange(p2)) { notes.push(`The reference ${band2 ? 'band' : 'line'} at ${rf.v}${band2 ? ' to ' + rf.v2 : ''} is outside the chart.`); return; }
      const vert = vAx ? horiz : !horiz;
      const a = clamp(Math.min(p1, p2), vert ? L : T, vert ? R : B), b = clamp(Math.max(p1, p2), vert ? L : T, vert ? R : B);
      if (band2) {
        const fillF = ST.merge({ fill: { t: 'solid', c, tr: 82 } }, F);
        put('band', vert ? `<rect x="${r2(a)}" y="${r2(T)}" width="${r2(b - a)}" height="${r2(B - T)}"${ST.fillAttr(fillF.fill, c, D)}${ST.lineAttr(F.line && F.line.t === 'solid' ? F.line : { t: 'none' }, {})} data-el="${key}"/>` : `<rect x="${r2(L)}" y="${r2(a)}" width="${r2(R - L)}" height="${r2(b - a)}"${ST.fillAttr(fillF.fill, c, D)}${ST.lineAttr(F.line && F.line.t === 'solid' ? F.line : { t: 'none' }, {})} data-el="${key}"/>`);
        mark(key, vert ? [a, T, b, B] : [L, a, R, b]);
      } else {
        const lineA = ST.lineAttr(F.line, { c, w: 1.5, dash: 'dash' });
        put('ref', vert ? `<path d="M${r2(a)} ${r2(T)}V${r2(B)}" fill="none"${lineA} data-el="${key}"/>` : `<path d="M${r2(L)} ${r2(a)}H${r2(R)}" fill="none"${lineA} data-el="${key}"/>`);
        mark(key, vert ? [a - 3, T, a + 3, B] : [L, a - 3, R, a + 3]);
      }
      if (rf.text) {
        // the spot picked in the editor comes first; when other text is already there the label moves along its line, then to the other side
        const al = rf.pos || 'end', ctr = (a + b) / 2, sz = stR.size, step = sz * 1.4, order = [al].concat(['end', 'start', 'middle'].filter(q => q !== al)), tries = [];
        if (!vert) {
          const xAt = q => q === 'start' ? [L + 6, 'start'] : q === 'middle' ? [(L + R) / 2, 'middle'] : [R - 6, 'end'];
          const ys = band2 ? [ctr, ctr - step, ctr + step] : [a - sz * 0.8, a + sz * 0.8];
          ys.forEach(y => order.forEach(q => tries.push([xAt(q)[0], y, xAt(q)[1]])));
        } else {
          const yAt = q => q === 'start' ? B - sz : q === 'middle' ? (T + B) / 2 : T + sz;
          const xs = band2 ? [[ctr, 'middle']] : [[a + 5, 'start'], [a - 5, 'end']];
          order.forEach(q => [0, 1, 2].forEach(k => xs.forEach(([x, an]) => tries.push([x, yAt(q) + (q === 'start' ? -1 : 1) * k * step, an]))));
        }
        const col = !vert && !band2 ? c : undefined;
        if (!tries.some(([x, y, an]) => text(x, y, rf.text, stR, { anchor: an, el: key, layer: 'ref', color: col, avoid: true }))) text(tries[0][0], tries[0][1], rf.text, stR, { anchor: tries[0][2], el: key, layer: 'ref', color: col });
      }
    });

    // ---------- marks ----------
    const labels = [];
    const dig = labelDigits(Math.max(...vals.map(Math.abs))), dfmt = (code, v) => code ? ST.fmtNumber(v, code, { euro }) : null;
    const lfmt = v => { const t = fmtNum(v, pct100 ? 0 : dig, euro), dp = euro ? ',' : '.'; return (t.includes(dp) ? t.replace(/0+$/, '').replace(/[.,]$/, '') : t) + suffix; };
    const dim = s => FOC.s != null && FOC.s !== '' && +FOC.s !== s.i ? clamp(1 - (+FOC.dim || 70) / 100, 0.05, 1) : 1;
    const gOpen = (s, attrs) => { const f = ST.effectId(s.fmx || {}, D, W, H), o2 = dim(s); return `<g data-el="s${s.i}"${f ? ` filter="url(#${f})"` : ''}${o2 < 1 ? ` opacity="${r2(o2)}"` : ''}${attrs || ''}>`; };
    // projection bands first
    projections.forEach((p, c) => {
      if (!p) return; const col = SER[c].color, px = q => xpos(q.x);
      put('marks', `<path d="${p.pts.map((q, i) => (i ? 'L' : 'M') + r2(px(q)) + ' ' + r2(Y(q.hi))).join('')}${p.pts.slice().reverse().map(q => 'L' + r2(px(q)) + ' ' + r2(Y(q.lo))).join('')}Z" fill="${col}" fill-opacity="0.13"/>`);
      put('marks', `<path d="${p.pts.map((q, i) => (i ? 'L' : 'M') + r2(px(q)) + ' ' + r2(Y(q.y))).join('')}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="5 5"/>`);
    });
    if (projections.some(p => p && !p.fit)) { const p = projections.find(q => q), x0 = xpos(p.pts[0].x); put('marks', `<path d="M${r2(x0)} ${r2(T)}V${r2(B)}" stroke="${th.muted}" stroke-dasharray="2 4"/>`); const stP = TS('projection', { size: fsA, c: th.muted }); labels.push(() => text(x0 - 6, T + fs * 0.7, 'projection, 90% band', stP, { anchor: 'end', avoid: true }) || text(x0 + 6, T + fs * 0.7, 'projection, 90% band', stP, { avoid: true })); }
    // data label settings of one series
    const dlFor = s => { const d = Object.assign({}, DL, s && s.so && s.so.dl); const on = s && s.so && s.so.dl && s.so.dl.on != null ? !!s.so.dl.on : (DL.on || !!o.labels); return Object.assign(d, { on }); };
    const pinfo = (s, j) => PL['s' + s.i + '.' + j] || null;
    function labelParts(s, j, v, d, share) {
      const custom = pinfo(s, j); if (custom && custom.show === false) return '';
      if (custom && custom.text) return custom.text;
      const a = [];
      if (d.cat) a.push(xLabelOf(j)); if (d.ser) a.push(s.name);
      if (d.val !== false) a.push(d.fmt ? dfmt(d.fmt, v) : lfmt(v));
      if (d.pct && share != null) a.push((share < 10 ? share.toFixed(1) : share.toFixed(0)) + '%');
      return a.join(d.sep == null ? ', ' : d.sep);
    }
    const labelBox = (b, el) => { const F = fmx('label'); if (!(F.fill && F.fill.t && F.fill.t !== 'none') && !(F.line && (F.line.c || F.line.t === 'solid'))) return; const p = 3; put('box', `<rect x="${r2(b[0] - p)}" y="${r2(b[1] + 1)}" width="${r2(b[2] - b[0] + 2 * p)}" height="${r2(b[3] - b[1] - 2)}" rx="${clamp(+F.rad || 3, 0, 20)}"${ST.fillAttr(F.fill, th.bg, D)}${ST.lineAttr(F.line, { c: null })} data-el="label"/>`); };
    const placeLabel = (x, y, t, st, anchor, within, color, j) => { const before = boxes.length, ok = text(x, y, t, st, { anchor, avoid: true, within, color, el: 'label', j }); if (ok) labelBox(boxes[before], 'label'); return ok; };
    const kbar = SER.filter(s => s.kind === 'bar'), nb = Math.max(1, kbar.length);
    const barS = type === 'combo' || ['bar', 'hbar'].includes(type) ? kbar : type === 'lollipop' ? [] : [];
    // Excel's way of sizing bars: one category is gap + k bars that overlap by the given share
    const gap = clamp(num(BAR.gap) != null ? +BAR.gap : 40, 0, 500) / 100, ov = clamp(num(BAR.overlap) != null ? +BAR.overlap : 0, -100, 100) / 100;
    const bw = band / (nb - (nb - 1) * ov + gap), groupW = bw * (nb - (nb - 1) * ov), gStart = (band - groupW) / 2;
    const rad = clamp(+BAR.rad || 0, 0, 200);
    function barPath(x, y, w, h, up, hz) {
      const r = Math.min(rad, w / 2, h / 2); if (!r) return null;
      const R4 = hz ? (up ? [0, r, r, 0] : [r, 0, 0, r]) : (up ? [r, r, 0, 0] : [0, 0, r, r]);
      return ST.roundRect(x, y, w, h, R4);
    }
    const ptFill = (s, j, v, F) => { const pf = FM['s' + s.i + '.p' + j]; let c = s.color; if (BAR.vary && SER.length === 1) c = pl0[j % pl0.length]; if (num(v) != null && v < 0 && ST.isHex(BAR.neg)) c = BAR.neg; if (pf && pf.fill && ST.isHex(pf.fill.c)) c = pf.fill.c; return { c, pf }; };
    function barMark(s, j, v, x, y, w, h, up, hz, F, extraStroke) {
      const { c, pf } = ptFill(s, j, v, F), fillF = ST.merge(F.fill, pf && pf.fill ? Object.assign({}, pf.fill, { c: undefined }) : {}), lineF = ST.merge(F.line, pf && pf.line);
      const attrs = ST.fillAttr(Object.assign({}, fillF, { c }), c, D) + ST.lineAttr(lineF, extraStroke || { c: null }) + ` data-el="s${s.i}" data-j="${j}"`;
      const d = barPath(x, y, w, h, up, hz);
      return d ? `<path d="${d}"${attrs}/>` : `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(0.5, w))}" height="${r2(Math.max(0.5, h))}"${attrs}/>`;
    }
    const errMark = (s, j, v, along, cross) => { // error bars: along = [lo, hi] positions on the value axis, cross = position on the other
      const e = s.err[j]; if (!ebOn || !e || v == null) return '';
      const c = ST.isHex(EB.c) ? EB.c : th.fg, cap = +EB.cap || 0, w = EB.w || 1.4, f = x => horiz ? [x, cross] : [cross, x];
      const [a1, b1] = f(along[0]), [a2, b2] = f(along[1]);
      let d = `M${r2(a1)} ${r2(b1)}L${r2(a2)} ${r2(b2)}`;
      for (const p of along) { const [px, py] = f(p); d += horiz ? `M${r2(px)} ${r2(py - cap)}V${r2(py + cap)}` : `M${r2(px - cap)} ${r2(py)}H${r2(px + cap)}`; }
      return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" data-el="eb"/>`;
    };
    if (['bar', 'hbar', 'combo'].includes(type) && barS.length) {
      barS.forEach((s, c) => {
        s.fmx = fmBar(s.i); const out = []; const Yb = YS(s), b0 = dual && s.right ? Math.max(sc2.lo, Math.min(0, sc2.hi)) : base;
        s.v.forEach((v, j) => {
          if (v == null) return; const off = (horiz ? T : L) + idx(j) * band + gStart + c * bw * (1 - ov), a = horiz ? X(b0) : Yb(b0), b = horiz ? X(v) : Yb(v), up = v >= b0;
          out.push(horiz ? barMark(s, j, v, Math.min(a, b), off, Math.abs(b - a), bw, up, true, s.fmx) : barMark(s, j, v, off, Math.min(a, b), bw, Math.abs(b - a), up, false, s.fmx));
          geom.pts['s' + s.i + '.' + j] = horiz ? [b, off + bw / 2] : [off + bw / 2, b];
          const e = errMark(s, j, v, horiz ? [X(v - (s.err[j] || [0])[0]), X(v + (s.err[j] || [0, 0])[1])] : [Yb(v - (s.err[j] || [0])[0]), Yb(v + (s.err[j] || [0, 0])[1])], off + bw / 2); if (e) out.push(e);
          const d = dlFor(s);
          if (d.on) labels.push(() => {
            const t = labelParts(s, j, v, d, null); if (!t) return true;
            const pos = d.pos === 'auto' ? 'outEnd' : d.pos, inside = pos !== 'outEnd', col = inside ? ST.inkOn(ptFill(s, j, v, s.fmx).c) : undefined, w = tw(t, stLab), dir = up ? 1 : -1;
            const ee = ebOn && s.err[j] ? (horiz ? Math.abs(X(v + dir * s.err[j][up ? 1 : 0]) - b) : Math.abs(Yb(v + dir * s.err[j][up ? 1 : 0]) - b)) : 0;
            if (!horiz) {
              const y = pos === 'center' ? (a + b) / 2 : pos === 'inEnd' ? b + dir * stLab.size * 0.8 : pos === 'inBase' ? a - dir * stLab.size * 0.8 : b - dir * (stLab.size * 0.8 + ee);
              return w <= (inside ? bw - 2 : bw + band * (nb === 1 ? 1 : 0.3)) && placeLabel(off + bw / 2, y, t, stLab, 'middle', [L, T, R, B], col, j);
            }
            const x = pos === 'center' ? (a + b) / 2 : pos === 'inEnd' ? b - dir * 4 : pos === 'inBase' ? a + dir * 4 : b + dir * (4 + ee);
            const an = pos === 'center' ? 'middle' : (pos === 'inEnd' ? dir < 0 : dir > 0) ? 'start' : 'end';
            return stLab.size * 1.1 <= bw + 2 && placeLabel(x, off + bw / 2, t, stLab, an, [L, T, R + rightW, B], col, j);
          });
        });
        put('marks', gOpen(s) + out.join('') + '</g>');
      });
    } else if (type === 'lollipop') {
      SER.forEach((s, c) => {
        s.fmx = fmBar(s.i); const out = [], k = SER.length, step = band / (k + 0.4), shape = (s.so.mk && s.so.mk.shape) || LN.shape || 'circle', r = Math.max(3, num(s.so.mk && s.so.mk.size) != null ? s.so.mk.size / 2 : Math.max(4, fs * 0.36));
        s.v.forEach((v, j) => { if (v == null) return; const { c: col } = ptFill(s, j, v, s.fmx), off = (horiz ? T : L) + idx(j) * band + (band - step * (k - 1)) / 2 + c * step, a = horiz ? X(base) : Y(base), b = horiz ? X(v) : Y(v);
          const sw2 = Math.max(1.5, fs * 0.14), stem = s.fmx.line && s.fmx.line.w != null ? s.fmx.line.w : sw2;
          out.push(`<path d="${horiz ? `M${r2(a)} ${r2(off)}H${r2(b)}` : `M${r2(off)} ${r2(a)}V${r2(b)}`}" fill="none" stroke="${col}" stroke-width="${r2(stem)}" stroke-linecap="round" data-el="s${s.i}" data-j="${j}"/>`);
          out.push(ST.marker(shape, horiz ? b : off, horiz ? off : b, r, ST.fillAttr(s.fmx.fill, col, D) + ST.lineAttr(s.fmx.line && s.fmx.line.c ? s.fmx.line : { t: 'none' }, {}), ` data-el="s${s.i}" data-j="${j}"`));
          geom.pts['s' + s.i + '.' + j] = horiz ? [b, off] : [off, b];
          const e = errMark(s, j, v, horiz ? [X(v - (s.err[j] || [0])[0]), X(v + (s.err[j] || [0, 0])[1])] : [Y(v - (s.err[j] || [0])[0]), Y(v + (s.err[j] || [0, 0])[1])], off); if (e) out.push(e);
          const d = dlFor(s); if (d.on) labels.push(() => { const t = labelParts(s, j, v, d, null); if (!t) return true; return horiz ? placeLabel(b + (v >= base ? r + 4 : -r - 4), off, t, stLab, v >= base ? 'start' : 'end', [L, T, R + rightW, B], undefined, j) : placeLabel(off, b + (v >= base ? -r - stLab.size * 0.8 : r + stLab.size * 0.8), t, stLab, 'middle', [L, T, R, B], undefined, j); }); });
        put('marks', gOpen(s) + out.join('') + '</g>');
      });
    } else if (type === 'stacked' || type === 'stacked100' || type === 'hstacked' || type === 'hstacked100') {
      const bw2 = band / (1 + gap), hz = horiz;
      SER.forEach((s, c) => {
        s.fmx = fmBar(s.i); const out = [], stroke = { c: th.bg, w: 0.75 };
        cum.forEach((r, j) => {
          const q = r[c]; if (!q) return;
          const v = q[1] - q[0], p0 = (hz ? T : L) + idx(j) * band + (band - bw2) / 2;
          if (hz) { const x0 = X(q[0]), x1 = X(q[1]); out.push(barMark(s, j, v, Math.min(x0, x1), p0, Math.abs(x1 - x0), bw2, true, true, s.fmx, stroke)); geom.pts['s' + s.i + '.' + j] = [x1, p0 + bw2 / 2]; }
          else { const y0 = Y(q[0]), y1 = Y(q[1]); out.push(barMark(s, j, v, p0, Math.min(y0, y1), bw2, Math.abs(y1 - y0), true, false, s.fmx, stroke)); geom.pts['s' + s.i + '.' + j] = [p0 + bw2 / 2, y1]; }
          const d = dlFor(s);
          if (d.on) labels.push(() => { const t = labelParts(s, j, v, d, pct100 ? v : (cum[j].reduce((a, bb) => a + (bb ? bb[1] - bb[0] : 0), 0) ? v / cum[j].reduce((a, bb) => a + (bb ? Math.max(0, bb[1] - bb[0]) : 0), 0) * 100 : null)); if (!t) return true; const col = ST.inkOn(ptFill(s, j, v, s.fmx).c);
            if (hz) { const x0 = X(q[0]), x1 = X(q[1]); const pos = d.pos === 'inEnd' ? x1 - 4 : d.pos === 'inBase' ? x0 + 4 : (x0 + x1) / 2; return Math.abs(x1 - x0) >= tw(t, stLab) + 6 && bw2 >= stLab.size * 1.3 && placeLabel(pos, p0 + bw2 / 2, t, stLab, d.pos === 'inEnd' ? 'end' : d.pos === 'inBase' ? 'start' : 'middle', [L, T, R, B], col, j); }
            const y0 = Y(q[0]), y1 = Y(q[1]), pos = d.pos === 'inEnd' ? Math.min(y0, y1) + stLab.size * 0.8 : d.pos === 'inBase' ? Math.max(y0, y1) - stLab.size * 0.8 : (y0 + y1) / 2;
            return Math.abs(y1 - y0) >= stLab.size * 1.3 && tw(t, stLab) <= bw2 - 4 && placeLabel(p0 + bw2 / 2, pos, t, stLab, 'middle', [L, T, R, B], col, j); });
        });
        put('marks', gOpen(s) + out.join('') + '</g>');
      });
    } else if (type === 'stackedArea' || type === 'stackedArea100') {
      SER.forEach((s, c) => {
        s.fmx = fmArea(s.i); const out = [], segs = []; let cur = [];
        cum.forEach((r, j) => { if (r[c]) cur.push(j); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
        const F = s.fmx, fillF = Object.assign({ t: 'solid', tr: 12 }, F.fill);
        segs.forEach(g => { const up = g.map(j => `${r2(CX(j))} ${r2(Y(cum[j][c][1]))}`), dn = g.slice().reverse().map(j => `${r2(CX(j))} ${r2(Y(cum[j][c][0]))}`);
          out.push(`<path d="M${up.join('L')}L${dn.join('L')}Z"${ST.fillAttr(fillF, s.color, D)}${ST.lineAttr(F.line, { c: null })} data-el="s${s.i}"/>`); });
        cum.forEach((r, j) => { if (r[c]) geom.pts['s' + s.i + '.' + j] = [CX(j), Y(r[c][1])]; });
        put('marks', gOpen(s) + out.join('') + '</g>');
        const d = dlFor(s); if (d.on && n <= 60) cum.forEach((r, j) => { if (!r[c]) return; const v = r[c][1] - r[c][0]; labels.push(() => { const t = labelParts(s, j, v, d, null); return !t || placeLabel(CX(j), Y(r[c][1]) - stLab.size * 1.0, t, stLab, 'middle', [L - fs, T - fs, R + fs, B], undefined, j); }); });
      });
    } else if (type === 'scatter') {
      SER.forEach(s => {
        s.fmx = fmDot(s.i); const out = [], mk = s.so.mk || {}, shape = mk.shape || LN.shape || 'circle', r = Math.max(2.5, num(mk.size) != null ? mk.size / 2 : num(LN.size) ? LN.size / 2 : fs * 0.26);
        s.v.forEach((v, j) => { if (v == null) return; const { c: col, pf } = ptFill(s, j, v, s.fmx), x = CX(j), y = Y(v);
          const f = ST.merge(s.fmx.fill, pf && pf.fill ? Object.assign({}, pf.fill, { c: undefined }) : {});
          out.push(ST.marker(shape, x, y, r, ST.fillAttr(Object.assign({ t: 'solid', tr: 15 }, f, { c: col }), col, D) + ST.lineAttr(ST.merge(s.fmx.line, pf && pf.line), { c: null }), ` data-el="s${s.i}" data-j="${j}"`));
          geom.pts['s' + s.i + '.' + j] = [x, y];
          const e = errMark(s, j, v, [Y(v - (s.err[j] || [0])[0]), Y(v + (s.err[j] || [0, 0])[1])], x); if (e) out.push(e);
          const d = dlFor(s); if (d.on && n <= 60) labels.push(() => { const t = labelParts(s, j, v, d, null); return !t || labelAt(x, y, r, t, d.pos, j); }); });
        put('marks', gOpen(s) + out.join('') + '</g>');
      });
    }
    function labelAt(x, y, r, t, pos, j) {
      const gp = r + 3 + stLab.size * 0.5, wi = [L - fs, T - fs, R + fs, B];
      const spots = pos === 'below' ? [[x, y + gp, 'middle']] : pos === 'left' ? [[x - r - 4, y, 'end']] : pos === 'right' ? [[x + r + 4, y, 'start']] : pos === 'center' ? [[x, y, 'middle']] : [[x, y - gp, 'middle'], [x, y + gp, 'middle']];
      return spots.some(([px, py, an]) => placeLabel(px, py, t, stLab, an, wi, undefined, j));
    }
    if (['line', 'step', 'area', 'combo'].includes(type)) {
      // line, step, area, and the lines of a combo
      (type === 'combo' ? SER.filter(s => s.kind !== 'bar') : SER).forEach(s => {
        const area = s.kind === 'area' || type === 'area', F = s.fmx = area ? fmArea(s.i) : fmLine(s.i), mk = s.so.mk || {}, sl = s.so.ln || {};
        const segs = []; let cur = [], Ys = YS(s);
        s.v.forEach((v, j) => { if (v == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push([CX(j), Ys(v), j]); }); if (cur.length) segs.push(cur);
        const lw = num(sl.w) ? +sl.w : num(LN.w) ? +LN.w : Math.max(1.6, fs * 0.17), smooth = sl.smooth != null ? !!sl.smooth : !!LN.smooth, dash = sl.dash || LN.dash || 'solid';
        const lineF = Object.assign({}, F.line, F.line && F.line.dash ? {} : { dash });
        const out = [], bY = Y(base);
        const pr = num(mk.size) != null ? mk.size / 2 : num(LN.size) ? LN.size / 2 : Math.max(2.4, fs * 0.21), shape = mk.shape || LN.shape || 'circle', mode = mk.mode || LN.mk || 'auto';
        const showMk = mode === 'on' || (mode === 'auto' && n <= 40 && type !== 'step') && shape !== 'none';
        segs.forEach(P => {
          let d;
          if (type === 'step') d = 'M' + P.map((p, i) => i ? `${r2(p[0])} ${r2(P[i - 1][1])}L${r2(p[0])} ${r2(p[1])}` : `${r2(p[0])} ${r2(p[1])}`).join('L');
          else if (smooth && P.length > 2 && !revX) d = ST.smoothPath(P.map(p => [p[0], p[1]]));
          else d = 'M' + P.map(p => `${r2(p[0])} ${r2(p[1])}`).join('L');
          if (area) { const fillF = Object.assign({ t: 'solid', tr: num(AR.tr) != null ? +AR.tr : 82 }, F.fill); out.push(`<path d="${d}L${r2(P[P.length - 1][0])} ${r2(bY)}L${r2(P[0][0])} ${r2(bY)}Z"${ST.fillAttr(fillF, s.color, D)} stroke="none" data-el="s${s.i}"/>`); }
          if (!(F.line && F.line.t === 'none')) out.push(`<path d="${d}" fill="none"${ST.lineAttr(lineF, { c: s.color, w: lw, round: true })} data-el="s${s.i}"/>`);
        });
        if (showMk && shape !== 'none') segs.forEach(P => P.forEach(p => { const pf = FM['s' + s.i + '.p' + p[2]], col = pf && pf.fill && ST.isHex(pf.fill.c) ? pf.fill.c : s.color, hollow = !!mk.hollow;
          out.push(ST.marker(shape, p[0], p[1], pr, hollow ? ` fill="${th.bg}" stroke="${col}" stroke-width="${r2(Math.max(1.5, pr * 0.5))}"` : ` fill="${ST.isHex(mk.c) ? mk.c : col}"` + (ST.isHex(mk.lc) ? ` stroke="${mk.lc}" stroke-width="${num(mk.lw) || 1}"` : ''), ` data-el="s${s.i}" data-j="${p[2]}"`)); }));
        else segs.forEach(P => P.forEach(p => out.push(`<circle cx="${r2(p[0])}" cy="${r2(p[1])}" r="7" fill="transparent" data-el="s${s.i}" data-j="${p[2]}"/>`)));
        s.v.forEach((v, j) => { if (v == null) return; geom.pts['s' + s.i + '.' + j] = [CX(j), Ys(v)]; const e = errMark(s, j, v, [Ys(v - (s.err[j] || [0])[0]), Ys(v + (s.err[j] || [0, 0])[1])], CX(j)); if (e) out.push(e); });
        put('marks', gOpen(s) + out.join('') + '</g>');
        const d = dlFor(s); if (d.on) { if (n <= 60) s.v.forEach((v, j) => { if (v == null) return; labels.push(() => { const t = labelParts(s, j, v, d, null); return !t || labelAt(CX(j), Ys(v), pr, t, d.pos, j); }); }); else notes.push('Too many points to label each one.'); }
      });
    }
    // marks go inside a clip so a fixed axis range cuts them off cleanly
    put('marks', '');
    // value labels, then the ones that would overlap are dropped
    let dropped = 0; const nl = labels.length; labels.forEach(f => { if (!f()) dropped++; });
    if (dropped && nl) notes.push(`${dropped} of ${nl} value labels were left out so they would not overlap.`);

    // ---------- annotations: text boxes, shapes and callouts ----------
    (Array.isArray(o.ann) ? o.ann : []).forEach(a => drawAnn(a));
    function drawAnn(a) {
      const key = 'ann:' + a.id, F = fmx(key), kind = a.kind || 'text';
      const fw = (num(a.fw) != null ? a.fw : 0.25) * W, fh = (num(a.fh) != null ? a.fh : 0.1) * H, x0 = (num(a.fx) != null ? a.fx : 0.5) * W, y0 = (num(a.fy) != null ? a.fy : 0.5) * H;
      const lineDef = { c: th.fg, w: 1.5 }, effId = ST.effectId(F, D, W, H), wrapG = s2 => effId ? `<g filter="url(#${effId})">${s2}</g>` : s2;
      if (kind === 'rect' || kind === 'ellipse') {
        const x = Math.min(x0, x0 + fw), y = Math.min(y0, y0 + fh), w = Math.abs(fw), h = Math.abs(fh), at = `${ST.fillAttr(F.fill && F.fill.t ? F.fill : { t: 'none' }, th.fg, D)}${ST.lineAttr(F.line, lineDef)} data-el="${key}"`;
        put('ann', wrapG(kind === 'ellipse' ? `<ellipse cx="${r2(x + w / 2)}" cy="${r2(y + h / 2)}" rx="${r2(w / 2)}" ry="${r2(h / 2)}"${at}/>` : `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" rx="${clamp(+F.rad || 0, 0, Math.min(w, h) / 2)}"${at}/>`));
        // the editor adds a wide invisible outline, so a shape with no fill can be grabbed
        if (o.hit) put('ann', kind === 'ellipse' ? `<ellipse cx="${r2(x + w / 2)}" cy="${r2(y + h / 2)}" rx="${r2(w / 2)}" ry="${r2(h / 2)}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" data-el="${key}"/>` : `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" data-el="${key}"/>`);
        mark(key, [x, y, x + w, y + h]);
        if (a.text) { const st = TS(key, { size: fsA, c: th.fg, al: 'middle' }), lines = wrap(a.text, st, w - 12, 8); lines.forEach((l, i) => text(x + w / 2, y + h / 2 + (i - (lines.length - 1) / 2) * st.size * st.lh, l, st, { anchor: 'middle', layer: 'ann', el: key })); }
        return;
      }
      if (kind === 'line' || kind === 'arrow') {
        const x1 = x0 + fw, y1 = y0 + fh, ang = Math.atan2(y1 - y0, x1 - x0), lw = F.line && num(F.line.w) != null ? +F.line.w : 1.5, hs = Math.max(8, lw * 4.5), c = ST.isHex(F.line && F.line.c) ? F.line.c : th.fg;
        let s2 = `<path d="M${r2(x0)} ${r2(y0)}L${r2(kind === 'arrow' ? x1 - Math.cos(ang) * hs * 0.7 : x1)} ${r2(kind === 'arrow' ? y1 - Math.sin(ang) * hs * 0.7 : y1)}" fill="none"${ST.lineAttr(F.line, lineDef)} data-el="${key}"/>`;
        if (kind === 'arrow') s2 += `<path d="M${r2(x1)} ${r2(y1)}L${r2(x1 - hs * Math.cos(ang - 0.4))} ${r2(y1 - hs * Math.sin(ang - 0.4))}L${r2(x1 - hs * Math.cos(ang + 0.4))} ${r2(y1 - hs * Math.sin(ang + 0.4))}Z" fill="${c}" data-el="${key}"/>`;
        if (o.hit) s2 += `<path d="M${r2(x0)} ${r2(y0)}L${r2(x1)} ${r2(y1)}" fill="none" stroke="#000" stroke-opacity="0" stroke-width="14" pointer-events="stroke" data-el="${key}"/>`;
        put('ann', wrapG(s2)); mark(key, [Math.min(x0, x1) - 4, Math.min(y0, y1) - 4, Math.max(x0, x1) + 4, Math.max(y0, y1) + 4]);
        return;
      }
      // text box or callout
      const st = TS(key, { size: fsA, c: th.fg, al: 'start' }), pad = 7, maxW = Math.max(40, fw - 2 * pad), lines = wrap(a.text || '', st, maxW, 12);
      const tw2 = Math.max(0, ...lines.map(l => tw(l, st))), bwid = kind === 'callout' ? Math.min(fw, tw2 + 2 * pad) : fw, bh = lines.length * st.size * st.lh + 2 * pad - (st.lh - 1) * st.size * 0.5;
      let bx = x0, by = y0, tgt = null;
      if (kind === 'callout') {
        tgt = a.s != null && a.j != null && geom.pts['s' + a.s + '.' + a.j] ? geom.pts['s' + a.s + '.' + a.j] : a.sl != null && geom.pts['sl' + a.sl] ? geom.pts['sl' + a.sl] : (num(a.tx) != null ? [a.tx * W, a.ty * H] : null);
        if (!tgt) return;
        bx = clamp(tgt[0] + (+a.dx || 0) - bwid / 2, 4, W - bwid - 4); by = clamp(tgt[1] + (+a.dy || -50) - bh / 2, 4, H - bh - 4);
      }
      const hasBox = (F.fill && F.fill.t && F.fill.t !== 'none') || (F.line && (F.line.c || F.line.t === 'solid')) || kind === 'callout';
      const boxF = kind === 'callout' ? ST.merge({ fill: { t: 'solid', c: th.bg }, line: { c: th.axis, w: 1 } }, F) : F;
      let s2 = '';
      if (tgt) {
        const cx = bx + bwid / 2, cy = by + bh / 2, dxn = tgt[0] - cx, dyn = tgt[1] - cy, k = Math.min(bwid / 2 / Math.abs(dxn || 1e-6), bh / 2 / Math.abs(dyn || 1e-6)), ex = k < 1 ? cx + dxn * k : cx, ey = k < 1 ? cy + dyn * k : cy;
        const lc = ST.isHex(boxF.line && boxF.line.c) ? boxF.line.c : th.axis, ang = Math.atan2(tgt[1] - ey, tgt[0] - ex), d2 = Math.hypot(tgt[0] - ex, tgt[1] - ey);
        if (d2 > 6) s2 += `<path d="M${r2(ex)} ${r2(ey)}L${r2(tgt[0] - Math.cos(ang) * 3)} ${r2(tgt[1] - Math.sin(ang) * 3)}" fill="none" stroke="${lc}" stroke-width="${r2(boxF.line && num(boxF.line.w) != null ? boxF.line.w : 1.2)}" data-el="${key}"/><circle cx="${r2(tgt[0])}" cy="${r2(tgt[1])}" r="3.2" fill="${lc}" data-el="${key}"/>`;
      }
      if (hasBox) s2 += `<rect x="${r2(bx)}" y="${r2(by)}" width="${r2(bwid)}" height="${r2(bh)}" rx="${clamp(+boxF.rad || (kind === 'callout' ? 4 : 0), 0, 30)}"${ST.fillAttr(boxF.fill, th.bg, D)}${ST.lineAttr(boxF.line, { c: null })} data-el="${key}"/>`;
      if (s2) put('ann', wrapG(s2));
      mark(key, [bx, by, bx + bwid, by + bh]);
      lines.forEach((l, i) => { const [tx0, an] = st.al === 'middle' ? [bx + bwid / 2, 'middle'] : st.al === 'end' ? [bx + bwid - pad, 'end'] : [bx + pad, 'start']; text(tx0, by + pad + st.size * 0.62 + i * st.size * st.lh, l, st, { anchor: an, layer: 'ann', el: key }); });
      a._box = [bx, by, bx + bwid, by + bh];
    }
    return finish(projections, { L, T, R, B });

    function finish(projections, plotBox) {
      const alt = (o.alt && String(o.alt).trim()) || describe(table, Object.assign({}, o, { type }), { ser: SER, sl: SL, pie });
      const faces = (o.fontFaces || []).map(f => `@font-face{font-family:"${String(f.family).replace(/["{};]/g, '')}";src:url(${f.src});${f.weight ? 'font-weight:' + f.weight + ';' : ''}}`).join('');
      const defs = D.xml() + (faces ? `<style>${faces}</style>` : '');
      const clipped = Z.marks.join('');
      const body = Z.bg.join('') + Z.plot.join('') + Z.band.join('') + Z.grid.join('') + Z.axis.join('') + (clipped ? `<g${pie ? '' : ` clip-path="url(#${clipId})"`}>${clipped}</g>` : '') + Z.ref.join('') + Z.box.join('') + Z.text.join('') + Z.ann.join('');
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(fam)}" role="img" aria-labelledby="${id}t ${id}d"><title id="${id}t">${esc(o.title || 'Chart')}</title><desc id="${id}d">${esc(alt)}</desc><defs>${defs}</defs>${body}</svg>`;
      geom.legend = geom.els.legend || null; geom.boxes = boxes; geom.th = th; geom.tc = tcol;
      geom.colors = pie ? SL.map(s => ({ key: 'sl' + s.k, name: s.name, color: s.color })) : SER.map(s => ({ key: 's' + s.i, name: s.name, color: s.color, kind: s.kind }));
      return { svg, width: W, height: H, type, projections, notes, boxes, geom, alt, pb: plotBox };
    }
  }

  // A plain sentence or two for people who cannot see the chart: what it is, and the start, end and range of each series.
  function describe(table, o, ctxt) {
    const rows = (table && table.rows) || [], cols = (table && table.cols) || [], type = (o && o.type) || 'line';
    const nm = (TYPE_NAMES[type] || 'Chart').toLowerCase().replace(/^bars$/, 'bar');
    const f = v => { const a = Math.abs(v); return fmtNum(v, a >= 100 ? 0 : a >= 10 ? 1 : 2); };
    if (!rows.length || !cols.length) return 'An empty chart.';
    const ttl = o && o.title ? `${o.title}. ` : '';
    if (type === 'pie' || type === 'donut') {
      const sl = (ctxt && ctxt.sl) || [], tot = sl.reduce((a, s) => a + s.v, 0);
      return `${ttl}A ${type} chart with ${sl.length} slices. ` + sl.slice().sort((a, b) => b.v - a.v).slice(0, 5).map(s => `${s.name} ${tot ? (s.v / tot * 100).toFixed(0) : 0}%`).join(', ') + (sl.length > 5 ? ', and more' : '') + '.';
    }
    const ser = (ctxt && ctxt.ser) || cols.map((c, i) => ({ name: c.name, v: rows.map(r => r.vals[i]) }));
    const first = rows[0].x, last = rows[rows.length - 1].x, xs = v => typeof v === 'number' ? fmtNum(v, Math.abs(v) % 1 ? 2 : 0) : String(v);
    const parts = ser.slice(0, 4).map(s => {
      const v = s.v.map((q, j) => [q, j]).filter(q => q[0] != null); if (!v.length) return `${s.name} has no values`;
      const mn = v.reduce((a, b) => b[0] < a[0] ? b : a), mx = v.reduce((a, b) => b[0] > a[0] ? b : a);
      return `${s.name} goes from ${f(v[0][0])} to ${f(v[v.length - 1][0])}, with a low of ${f(mn[0])} at ${xs(rows[mn[1]].x)} and a high of ${f(mx[0])} at ${xs(rows[mx[1]].x)}`;
    });
    return `${ttl}A ${nm} chart of ${ser.length} series (${ser.slice(0, 6).map(s => s.name).join(', ')}${ser.length > 6 ? ', and more' : ''}) over ${rows.length} points, from ${xs(first)} to ${xs(last)}. ${parts.join('. ')}${ser.length > 4 ? '. The other series are in the data table' : ''}.`;
  }

  // the SVG painted onto a canvas at a scale, for PNG files and the clipboard
  function toCanvas(svg, w, h, scale, canvas) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => { const c = canvas || document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale); const g = c.getContext('2d'); g.setTransform(scale, 0, 0, scale, 0, 0); g.clearRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h); res(c); };
      img.onerror = rej;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  function toPNG(svg, w, h, scale) { return toCanvas(svg, w, h, scale || 2).then(c => new Promise(r => c.toBlob(r, 'image/png'))); }

  // older API: paint on a canvas sized to its box. Used to keep the same call working for anyone who used it.
  function draw(canvas, table, opts) {
    const W = canvas.clientWidth || 800, out = render(table, Object.assign({ width: W, aspect: 16 / 9, theme: opts && opts.theme === 'print' ? 'print' : opts && opts.theme, zero: true }, opts, { width: W }));
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    canvas.style.height = out.height + 'px';
    toCanvas(out.svg, out.width, out.height, dpr, canvas).catch(() => {});
    return out;
  }
  root.UnchartRemake = { draw, render, describe, toPNG, toCanvas, project, PALETTES, PRESETS, THEMES, FONTS, FONT_NAMES, TYPES, TYPE_NAMES, DEFAULTS, AX_X, AX_Y, AX_Y2, fmtNum, themeFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.UnchartRemake;
})(typeof window !== 'undefined' ? window : globalThis);
