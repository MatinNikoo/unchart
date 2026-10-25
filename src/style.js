// Drawing helpers shared by the chart editor, the renderer and the file exports.
// Number format codes (the Excel kind), fills, outlines, effects, marker shapes, and the color checks.
(function (root) {
  'use strict';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const r2 = v => Math.round(v * 100) / 100;

  // ---------- colors ----------
  function rgb(c) {
    let h = String(c || '').trim().replace('#', '');
    if (h.length === 3) h = h.replace(/./g, m => m + m);
    const n = parseInt(h, 16);
    return /^[0-9a-f]{6}$/i.test(h) ? [n >> 16, (n >> 8) & 255, n & 255] : [0, 0, 0];
  }
  const hex2 = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  const toHex = ([r, g, b]) => '#' + hex2(r) + hex2(g) + hex2(b);
  const isHex = c => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(c || '').trim());
  // t from 0 (a) to 1 (b)
  function mix(a, b, t) { const p = rgb(a), q = rgb(b); return toHex(p.map((v, i) => v + (q[i] - v) * t)); }
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const unlin = v => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  function luminance(c) { const [r, g, b] = rgb(c); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
  function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  // black or white, whichever reads better on this color
  const inkOn = c => contrast(c, '#16161A') >= contrast(c, '#FFFFFF') ? '#16161A' : '#FFFFFF';

  // How a color looks to someone with a color vision deficiency (Machado, Oliveira and Fernandes 2009, full severity),
  // worked out in linear light.
  const CVD = {
    protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
    deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
    tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  };
  function simulate(c, kind) {
    const v = rgb(c).map(lin);
    if (kind === 'gray') { const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; return toHex([unlin(y), unlin(y), unlin(y)]); }
    const M = CVD[kind]; if (!M) return toHex(rgb(c));
    return toHex(M.map(row => unlin(Math.max(0, Math.min(1, row[0] * v[0] + row[1] * v[1] + row[2] * v[2])))));
  }
  function lab(c) {
    const [r, g, b] = rgb(c).map(lin);
    const f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
    const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047), y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b), z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  // CIEDE2000, the usual measure of how different two colors look. Under about 10 two chart colors are easy to confuse.
  function deltaE(c1, c2) {
    const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180, deg = 180 / Math.PI;
    const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
    const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2, Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
    const hp = (b, a) => { if (!b && !a) return 0; const h = Math.atan2(b, a) * deg; return h < 0 ? h + 360 : h; };
    const h1 = hp(b1, ap1), h2 = hp(b2, ap2);
    const dL = L2 - L1, dC = Cp2 - Cp1;
    let dh = 0; if (Cp1 * Cp2) { dh = h2 - h1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
    const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * rad / 2), Lb = (L1 + L2) / 2, Cpb = (Cp1 + Cp2) / 2;
    let hb = h1 + h2; if (Cp1 * Cp2) { hb = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2; }
    const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
    const SL = 1 + 0.015 * (Lb - 50) ** 2 / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cpb, SH = 1 + 0.015 * Cpb * T;
    const RT = -2 * Math.sqrt(Cpb ** 7 / (Cpb ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
    return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
  }

  // ---------- number format codes ----------
  // The subset of Excel's codes that charts use: 0 # ? . , % E+00, "text", \x, _x, up to three sections, and date codes.
  const MON = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function sections(code) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < code.length; i++) { const ch = code[i]; if (ch === '"') q = !q; if (ch === ';' && !q) { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out;
  }
  // splits a section into literal text before, the number pattern, and literal text after
  function tokens(sec) {
    const toks = []; let i = 0;
    while (i < sec.length) {
      const ch = sec[i];
      if (ch === '"') { const j = sec.indexOf('"', i + 1), e = j < 0 ? sec.length : j; toks.push({ lit: sec.slice(i + 1, e) }); i = e + 1; }
      else if (ch === '\\') { toks.push({ lit: sec[i + 1] || '' }); i += 2; }
      else if (ch === '_') { toks.push({ lit: ' ' }); i += 2; }
      else if (ch === '*') i += 2;
      else if (ch === '[') { const j = sec.indexOf(']', i); i = j < 0 ? sec.length : j + 1; }
      else if (/[0#?]/.test(ch)) { let j = i; while (j < sec.length && /[0#?.,]/.test(sec[j])) j++; toks.push({ num: sec.slice(i, j) }); i = j; }
      else if (ch === 'E' && /^E[+-]0+/.test(sec.slice(i))) { const m = /^E[+-]0+/.exec(sec.slice(i))[0]; toks.push({ exp: m }); i += m.length; }
      else if (ch === '%') { toks.push({ pct: true }); i++; }
      else { toks.push({ lit: ch }); i++; }
    }
    return toks;
  }
  const groupDigits = (s, sep) => s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  function applySection(a, sec, euro, neg) {
    const toks = tokens(sec), ni = toks.findIndex(t => t.num != null);
    let pct = toks.filter(t => t.pct).length;
    let body = '';
    const lits = t => t.lit != null ? t.lit : t.pct ? '%' : t.exp ? '' : '';
    if (ni < 0) return toks.map(lits).join('');
    let pat = toks[ni].num, scale = 0;
    // commas after the last digit placeholder divide by a thousand each
    const m = /[,]+$/.exec(pat); if (m) { scale = m[0].length; pat = pat.slice(0, -scale); }
    const dot = pat.indexOf('.'), intPat = dot < 0 ? pat : pat.slice(0, dot), decPat = dot < 0 ? '' : pat.slice(dot + 1).replace(/,/g, '');
    const thousands = /,/.test(intPat), minInt = (intPat.match(/0/g) || []).length, minDec = (decPat.match(/[0?]/g) || []).length, maxDec = decPat.length;
    let v = a * Math.pow(100, pct ? 1 : 0) / Math.pow(1000, scale);
    if (pct > 1) v = a * Math.pow(100, pct) / Math.pow(1000, scale);
    const ex = toks.find(t => t.exp);
    let expPart = '';
    if (ex) {
      let e = v === 0 ? 0 : Math.floor(Math.log10(Math.abs(v))); const w = ex.exp.length - 2;
      let mant = v / Math.pow(10, e); if (+mant.toFixed(maxDec) >= 10) { mant /= 10; e++; }
      v = mant; expPart = 'E' + (e < 0 ? '-' : ex.exp[1] === '+' ? '+' : '') + String(Math.abs(e)).padStart(w, '0');
    }
    let s = Math.abs(v).toFixed(Math.min(20, maxDec));
    let [ip, fp = ''] = s.split('.');
    if (maxDec > minDec) fp = fp.replace(new RegExp('0{0,' + (maxDec - minDec) + '}$'), '');
    ip = ip.replace(/^0+(?=\d)/, ''); if (ip === '0' && minInt === 0) ip = '';
    if (ip.length < minInt) ip = ip.padStart(minInt, '0');
    if (thousands) ip = groupDigits(ip, euro ? '.' : ',');
    body = ip + (fp ? (euro ? ',' : '.') + fp : '') + expPart;
    if (!body) body = '0';
    const out = toks.map((t, i) => i === ni ? body : lits(t)).join('');
    return neg && /[1-9]/.test(body) ? '-' + out : out;
  }
  // formats v with a code. 'General' or an empty code uses the plain digits.
  function fmtNumber(v, code, opt) {
    if (v == null || !isFinite(v)) return '';
    const o = opt || {}, euro = !!o.euro;
    if (!code || /^general$/i.test(code)) {
      let s = String(+v.toPrecision(12)); if (/e/i.test(s)) s = (+s).toFixed(0);
      return euro ? s.replace('.', ',') : s;
    }
    const S = sections(code);
    // a code with no digit placeholder would print the same words at every tick, so read it as General
    if (!S.some(x => /[0#?]/.test(String(x).replace(/"[^"]*"|\\.|\[[^\]]*\]/g, '')))) return fmtNumber(v, '', o);
    if (v < 0 && S.length > 1) return applySection(-v, S[1], euro, false);
    if (v === 0 && S.length > 2) return applySection(0, S[2], euro, false);
    return applySection(Math.abs(v), S[0], euro, v < 0);
  }
  const isDateCode = code => { const t = String(code || '').replace(/"[^"]*"/g, '').replace(/\\./g, ''); return /[ymd]/i.test(t) && !/[0#?]/.test(t); };
  // days since 1970-01-01 (what the renderer uses for dates)
  function fmtDate(days, code) {
    const t = new Date(Math.round(days * 864e5));
    const y = t.getUTCFullYear(), mo = t.getUTCMonth(), d = t.getUTCDate(), w = t.getUTCDay();
    return String(code || 'yyyy-mm-dd').replace(/"([^"]*)"|\\(.)|yyyy|yy|mmmm|mmm|mm|m|dddd|ddd|dd|d/gi, (m, q, b) => {
      if (q != null) return q; if (b != null) return b;
      switch (m.toLowerCase()) {
        case 'yyyy': return String(y); case 'yy': return String(y).slice(-2).padStart(2, '0');
        case 'mmmm': return MON[mo]; case 'mmm': return MON[mo].slice(0, 3); case 'mm': return String(mo + 1).padStart(2, '0'); case 'm': return String(mo + 1);
        case 'dddd': return DOW[w]; case 'ddd': return DOW[w].slice(0, 3); case 'dd': return String(d).padStart(2, '0'); default: return String(d);
      }
    });
  }
  // the codes the editor offers, grouped like Excel's Format Cells
  const NUMBER_CODES = [
    ['Automatic', ''], ['Number, no decimals', '#,##0'], ['Number, 1 decimal', '#,##0.0'], ['Number, 2 decimals', '#,##0.00'],
    ['Percent', '0%'], ['Percent, 1 decimal', '0.0%'], ['Dollars', '$#,##0'], ['Dollars and cents', '$#,##0.00'], ['Euros', '#,##0 "€"'],
    ['Thousands (K)', '#,##0,"K"'], ['Millions (M)', '#,##0.0,,"M"'], ['Billions (B)', '#,##0.0,,,"B"'], ['Scientific', '0.00E+00'], ['Plus or minus', '+#,##0;-#,##0;0'],
  ];
  const DATE_CODES = [['Year', 'yyyy'], ['Month and year', 'mmm yyyy'], ['Month and day', 'mmm d'], ['Full date', 'd mmm yyyy'], ['ISO date', 'yyyy-mm-dd'], ['Short', 'm/d/yy']];
  // a value divided by a display unit (Excel's "display units" on an axis)
  const UNITS = [['None', 1], ['Hundreds', 1e2], ['Thousands', 1e3], ['Ten thousands', 1e4], ['Hundred thousands', 1e5], ['Millions', 1e6], ['Billions', 1e9], ['Trillions', 1e12]];

  // ---------- fills, outlines, effects ----------
  // A format is sparse: {fill:{t,c,c2,ang,k,pat,pc,pb,tr,tr2}, line:{t,c,w,dash,tr}, shadow:{on,c,blur,dx,dy,tr}, glow:{on,c,r,tr}, soft:{on,r}, rad}
  // t is the kind of fill: none, solid, grad (a gradient), pat (a pattern). Missing parts fall back to the base given when drawing.
  const merge = (a, b) => { const o = Object.assign({}, a || {}); for (const k in b || {}) o[k] = b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(o[k], b[k]) : b[k]; return o; };
  const DASH = { solid: null, dash: [4, 3], dot: [1, 2], dashdot: [4, 2, 1, 2], long: [8, 3], longdot: [8, 2, 1, 2] };
  function dashArray(kind, w) {
    const d = DASH[kind]; if (!d) return '';
    const k = Math.max(1, w); return d.map(v => r2(v * k)).join(' ');
  }
  const PATTERNS = { diag: 'Diagonal stripes', diagb: 'Back diagonal stripes', horz: 'Horizontal stripes', vert: 'Vertical stripes', grid: 'Grid', cross: 'Diagonal cross', dots: 'Dots', dotsl: 'Large dots', check: 'Checks', zig: 'Zigzag', plus: 'Plus signs', brick: 'Bricks' };
  function patternBody(p, fg) {
    const s = `stroke="${fg}" stroke-width="1.4" fill="none"`, f = `fill="${fg}"`;
    switch (p) {
      case 'diagb': return [8, `<path d="M-2 6l4 4M0 0l8 8M6 -2l4 4" ${s}/>`];
      case 'horz': return [6, `<path d="M0 1.5h6" ${s}/>`];
      case 'vert': return [6, `<path d="M1.5 0v6" ${s}/>`];
      case 'grid': return [8, `<path d="M0 .7h8M.7 0v8" ${s}/>`];
      case 'cross': return [8, `<path d="M0 0l8 8M8 0l-8 8" ${s}/>`];
      case 'dots': return [4, `<circle cx="1.2" cy="1.2" r=".9" ${f}/>`];
      case 'dotsl': return [8, `<circle cx="2" cy="2" r="1.6" ${f}/><circle cx="6" cy="6" r="1.6" ${f}/>`];
      case 'check': return [8, `<rect width="4" height="4" ${f}/><rect x="4" y="4" width="4" height="4" ${f}/>`];
      case 'zig': return [8, `<path d="M0 6l2 -4l2 4l2 -4l2 4" ${s}/>`];
      case 'plus': return [8, `<path d="M4 1.5v5M1.5 4h5" ${s}/>`];
      case 'brick': return [8, `<path d="M0 .6h8M0 4.6h8M2 .6v4M6 4.6v3.4" ${s}/>`];
      default: return [8, `<path d="M-2 2l4 -4M0 8l8 -8M6 10l4 -4" ${s}/>`];
    }
  }
  // collects gradients, patterns and filters, each written once
  function makeDefs(prefix) {
    const items = [], seen = new Map(); let n = 0;
    return {
      add(key, build) { if (seen.has(key)) return seen.get(key); const id = prefix + (++n); seen.set(key, id); items.push(build(id)); return id; },
      xml: () => items.join(''), count: () => items.length,
    };
  }
  const op = tr => { const v = 1 - Math.max(0, Math.min(100, +tr || 0)) / 100; return v >= 0.999 ? '' : r2(v); };
  // fill attributes for one shape. base is the color used when the format does not name one.
  function fillAttr(f, base, D) {
    f = f || {};
    const t = f.t || 'solid', c = isHex(f.c) ? f.c : base;
    if (t === 'none' || !c) return ' fill="none"';
    if (t === 'grad') {
      const c2 = isHex(f.c2) ? f.c2 : mix(c, '#ffffff', 0.55), a = +f.ang || 0, k = f.k === 'radial' ? 'radial' : 'linear';
      const t1 = +f.tr || 0, t2 = f.tr2 != null ? +f.tr2 : t1;
      const id = D.add(['g', k, c, c2, a, t1, t2].join('|'), id => {
        const so = x => op(x) ? ` stop-opacity="${op(x)}"` : '';
        const stops = `<stop offset="0" stop-color="${c}"${so(t1)}/><stop offset="1" stop-color="${c2}"${so(t2)}/>`;
        if (k === 'radial') return `<radialGradient id="${id}" cx=".5" cy=".5" r=".75">${stops}</radialGradient>`;
        const rd = a * Math.PI / 180, x = Math.cos(rd) / 2, y = Math.sin(rd) / 2;
        return `<linearGradient id="${id}" x1="${r2(.5 - x)}" y1="${r2(.5 - y)}" x2="${r2(.5 + x)}" y2="${r2(.5 + y)}">${stops}</linearGradient>`;
      });
      return ` fill="url(#${id})"`;
    }
    if (t === 'pat') {
      const fg = isHex(f.pc) ? f.pc : c, bg = isHex(f.pb) ? f.pb : null, pat = PATTERNS[f.pat] ? f.pat : 'diag', o = op(f.tr);
      const id = D.add(['p', pat, fg, bg, o].join('|'), id => {
        const [sz, body] = patternBody(pat, fg);
        return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${sz}" height="${sz}">${bg ? `<rect width="${sz}" height="${sz}" fill="${bg}"/>` : ''}<g${o ? ` opacity="${o}"` : ''}>${body}</g></pattern>`;
      });
      return ` fill="url(#${id})"`;
    }
    const o = op(f.tr);
    return ` fill="${c}"${o ? ` fill-opacity="${o}"` : ''}`;
  }
  // stroke attributes. base: {c, w} used when the format is silent; base.c null means no outline unless the format asks.
  function lineAttr(l, base) {
    l = l || {}; base = base || {};
    const t = l.t || (base.c || l.c ? 'solid' : 'none');
    if (t === 'none') return ' stroke="none"';
    const c = isHex(l.c) ? l.c : base.c; if (!c) return ' stroke="none"';
    const w = l.w != null && l.w !== '' ? Math.max(0, +l.w) : base.w != null ? base.w : 1, o = op(l.tr), da = dashArray(l.dash || base.dash, w);
    if (!w) return ' stroke="none"';
    return ` stroke="${c}" stroke-width="${r2(w)}"${o ? ` stroke-opacity="${o}"` : ''}${da ? ` stroke-dasharray="${da}"` : ''}${l.dash && l.dash !== 'solid' || base.round ? ' stroke-linecap="round"' : ''} stroke-linejoin="round"`;
  }
  // an effects filter for a group of shapes: soft edges, then glow and shadow behind it. Returns the filter id or ''.
  // defaults the editor shows and the XLSX writer repeats
  const FX = { shadow: { blur: 6, dx: 0, dy: 3, tr: 70, c: '#000000' }, glow: { r: 8, tr: 60, c: '#FFB020' }, soft: { r: 4 } };
  const numOr = (v, d) => v == null || v === '' || !isFinite(+v) ? d : +v;
  function effectId(fm, D, W, H) {
    fm = fm || {};
    const sh = fm.shadow && fm.shadow.on ? fm.shadow : null, gl = fm.glow && fm.glow.on ? fm.glow : null, so = fm.soft && fm.soft.on ? fm.soft : null;
    if (!sh && !gl && !so) return '';
    const key = ['f', JSON.stringify([sh, gl, so]), W, H].join('|');
    return D.add(key, id => {
      let x = '', src = 'SourceGraphic', merge = [];
      if (so) { const r = Math.max(0.5, numOr(so.r, FX.soft.r)); x += `<feMorphology in="SourceAlpha" operator="erode" radius="${r2(r / 2)}" result="se"/><feGaussianBlur in="se" stdDeviation="${r2(r / 2)}" result="sm"/><feComposite in="SourceGraphic" in2="sm" operator="in" result="soft"/>`; src = 'soft'; }
      const alpha = src === 'SourceGraphic' ? 'SourceAlpha' : src;
      if (sh) x += `<feGaussianBlur in="${alpha}" stdDeviation="${r2(Math.max(0, numOr(sh.blur, FX.shadow.blur)) / 2)}" result="sb"/><feOffset in="sb" dx="${r2(numOr(sh.dx, FX.shadow.dx))}" dy="${r2(numOr(sh.dy, FX.shadow.dy))}" result="so"/><feFlood flood-color="${isHex(sh.c) ? sh.c : FX.shadow.c}" flood-opacity="${op(numOr(sh.tr, FX.shadow.tr)) || 1}" result="sf"/><feComposite in="sf" in2="so" operator="in" result="sd"/>`;
      if (gl) x += `<feMorphology in="${alpha}" operator="dilate" radius="${r2(Math.max(0, numOr(gl.r, FX.glow.r)) / 3)}" result="gd"/><feGaussianBlur in="gd" stdDeviation="${r2(Math.max(0.5, numOr(gl.r, FX.glow.r)) / 2)}" result="gb"/><feFlood flood-color="${isHex(gl.c) ? gl.c : FX.glow.c}" flood-opacity="${op(numOr(gl.tr, FX.glow.tr)) || 0.7}" result="gf"/><feComposite in="gf" in2="gb" operator="in" result="gw"/>`;
      if (gl) merge.push('gw'); if (sh) merge.push('sd'); merge.push(src);
      return `<filter id="${id}" filterUnits="userSpaceOnUse" x="-20" y="-20" width="${W + 40}" height="${H + 40}" color-interpolation-filters="sRGB">${x}<feMerge>${merge.map(m => `<feMergeNode in="${m}"/>`).join('')}</feMerge></filter>`;
    });
  }
  const hasEffects = fm => !!(fm && ((fm.shadow && fm.shadow.on) || (fm.glow && fm.glow.on) || (fm.soft && fm.soft.on)));

  // ---------- marker shapes ----------
  const MARKERS = { circle: 'Circle', square: 'Square', diamond: 'Diamond', triangle: 'Triangle', down: 'Triangle down', cross: 'Plus', x: 'Cross', star: 'Star', dash: 'Dash', none: 'None' };
  // one marker centred at x, y with radius r. attrs is the fill and stroke attribute text.
  function marker(shape, x, y, r, attrs, extra) {
    x = r2(x); y = r2(y); r = r2(Math.max(0.5, +r || 0.5)); const e = extra || '';
    switch (shape) {
      case 'square': return `<rect x="${r2(x - r * 0.88)}" y="${r2(y - r * 0.88)}" width="${r2(r * 1.76)}" height="${r2(r * 1.76)}"${attrs}${e}/>`;
      case 'diamond': return `<path d="M${x} ${r2(y - r * 1.25)}L${r2(x + r * 1.25)} ${y}L${x} ${r2(y + r * 1.25)}L${r2(x - r * 1.25)} ${y}Z"${attrs}${e}/>`;
      case 'triangle': return `<path d="M${x} ${r2(y - r * 1.2)}L${r2(x + r * 1.1)} ${r2(y + r * 0.85)}L${r2(x - r * 1.1)} ${r2(y + r * 0.85)}Z"${attrs}${e}/>`;
      case 'down': return `<path d="M${x} ${r2(y + r * 1.2)}L${r2(x + r * 1.1)} ${r2(y - r * 0.85)}L${r2(x - r * 1.1)} ${r2(y - r * 0.85)}Z"${attrs}${e}/>`;
      case 'cross': { const a = r2(r * 0.4), b = r2(r * 1.15); return `<path d="M${r2(x - a)} ${r2(y - b)}h${r2(2 * a)}v${r2(b - a)}h${r2(b - a)}v${r2(2 * a)}h${r2(a - b)}v${r2(b - a)}h${r2(-2 * a)}v${r2(a - b)}h${r2(a - b)}v${r2(-2 * a)}h${r2(b - a)}Z"${attrs}${e}/>`; }
      case 'x': { const a = r2(r * 0.36), b = r2(r * 1.1); return `<path transform="rotate(45 ${x} ${y})" d="M${r2(x - a)} ${r2(y - b)}h${r2(2 * a)}v${r2(b - a)}h${r2(b - a)}v${r2(2 * a)}h${r2(a - b)}v${r2(b - a)}h${r2(-2 * a)}v${r2(a - b)}h${r2(a - b)}v${r2(-2 * a)}h${r2(b - a)}Z"${attrs}${e}/>`; }
      case 'star': { let d = ''; for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.55 : r * 1.35, a = -Math.PI / 2 + i * Math.PI / 5; d += (i ? 'L' : 'M') + r2(x + rr * Math.cos(a)) + ' ' + r2(y + rr * Math.sin(a)); } return `<path d="${d}Z"${attrs}${e}/>`; }
      case 'dash': return `<rect x="${r2(x - r * 1.2)}" y="${r2(y - r * 0.3)}" width="${r2(r * 2.4)}" height="${r2(r * 0.6)}"${attrs}${e}/>`;
      default: return `<circle cx="${x}" cy="${y}" r="${r}"${attrs}${e}/>`;
    }
  }

  // ---------- smooth lines ----------
  // A curve through the points that never overshoots them (monotone cubic, Fritsch and Carlson), so a smoothed line
  // cannot show a peak or a dip the data does not have. P is [[x, y], ...] with x increasing.
  function smoothPath(P) {
    const n = P.length; if (n < 3) return 'M' + P.map(p => r2(p[0]) + ' ' + r2(p[1])).join('L');
    const dx = [], sl = [];
    for (let i = 0; i < n - 1; i++) { dx.push(P[i + 1][0] - P[i][0] || 1e-9); sl.push((P[i + 1][1] - P[i][1]) / dx[i]); }
    const m = [sl[0]];
    for (let i = 1; i < n - 1; i++) m.push(sl[i - 1] * sl[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / sl[i - 1] + (dx[i] + 2 * dx[i - 1]) / sl[i]));
    m.push(sl[n - 2]);
    let d = 'M' + r2(P[0][0]) + ' ' + r2(P[0][1]);
    for (let i = 0; i < n - 1; i++) { const h = dx[i]; d += `C${r2(P[i][0] + h / 3)} ${r2(P[i][1] + m[i] * h / 3)} ${r2(P[i + 1][0] - h / 3)} ${r2(P[i + 1][1] - m[i + 1] * h / 3)} ${r2(P[i + 1][0])} ${r2(P[i + 1][1])}`; }
    return d;
  }

  // a rectangle path with each corner rounded by its own radius [tl, tr, br, bl]
  function roundRect(x, y, w, h, rad) {
    const R = Array.isArray(rad) ? rad : [rad, rad, rad, rad], m = Math.min(w, h) / 2, [a, b, c, d] = R.map(v => Math.max(0, Math.min(m, +v || 0)));
    if (!a && !b && !c && !d) return `M${r2(x)} ${r2(y)}h${r2(w)}v${r2(h)}h${r2(-w)}Z`;
    return `M${r2(x + a)} ${r2(y)}H${r2(x + w - b)}${b ? `A${r2(b)} ${r2(b)} 0 0 1 ${r2(x + w)} ${r2(y + b)}` : ''}V${r2(y + h - c)}${c ? `A${r2(c)} ${r2(c)} 0 0 1 ${r2(x + w - c)} ${r2(y + h)}` : ''}H${r2(x + d)}${d ? `A${r2(d)} ${r2(d)} 0 0 1 ${r2(x)} ${r2(y + h - d)}` : ''}V${r2(y + a)}${a ? `A${r2(a)} ${r2(a)} 0 0 1 ${r2(x + a)} ${r2(y)}` : ''}Z`;
  }

  root.UnchartStyle = { esc, r2, rgb, toHex, isHex, mix, luminance, contrast, inkOn, simulate, deltaE, CVD, fmtNumber, fmtDate, isDateCode, NUMBER_CODES, DATE_CODES, UNITS,
    merge, dashArray, DASH, PATTERNS, makeDefs, fillAttr, lineAttr, effectId, FX, hasEffects, MARKERS, marker, smoothPath, roundRect, MON };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.UnchartStyle;
})(typeof window !== 'undefined' ? window : globalThis);
