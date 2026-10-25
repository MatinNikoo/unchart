// Unchart engine. Turns a picture of a chart back into the numbers behind it.
// Everything here runs in the browser (and in node for tests). The OCR step is passed in, so the
// same code runs in the app, the batch tool and the benchmark.
(function (root) {
  'use strict';

  // ---------- small helpers ----------
  const median = a => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quant = (a, q) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
  // hue difference in degrees; colors with little saturation have no reliable hue, so they count as close
  function hueGap(a, b) {
    const ha = rgb2hsv(a[0], a[1], a[2]), hb = rgb2hsv(b[0], b[1], b[2]);
    if (ha[1] < 0.25 || hb[1] < 0.25) return 0;
    const d = Math.abs(ha[0] - hb[0]); return Math.min(d, 360 - d);
  }
  function rgb2hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
    return [h, mx ? d / mx : 0, mx];
  }
  const cdist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const hex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  const unhex = s => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

  // ---------- reading numbers out of OCR text ----------
  const MULT = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, mln: 1e6, million: 1e6, b: 1e9, bn: 1e9, g: 1e9, billion: 1e9, t: 1e12, trillion: 1e12 };
  // "$4,500", "12%", "1.5M", "(3)", "80 years", "2 billion t", "-0.5". Returns {v, pct} or null.
  function parseNumber(t) {
    if (t == null) return null;
    let s = String(t).trim();
    if (!s) return null;
    s = s.replace(/[−\u2013\u2014_]/g, '-').replace(/[|]/g, '');
    let neg = false;
    const par = s.match(/^\((.*)\)$/); if (par) { neg = true; s = par[1]; }
    s = s.replace(/^([-+]?)\s*[$€£¥₹]\s*/, '$1').replace(/^[$€£¥₹]\s*(-)/, '$1');
    s = s.replace(/-+$/, '');                 // a tick mark read as a trailing dash
    if (/^-{2,}/.test(s)) s = s.replace(/^-+/, '-');
    // scientific notation, as some chart tools print it (9e+3, 2.5e-2)
    const sci = s.match(/^([-+]?)(\d+(?:\.\d+)?)[eE]([-+]?\d{1,3})\s*(%?)$/);
    if (sci) { const v = (sci[1] === '-' || neg ? -1 : 1) * parseFloat(sci[2]) * Math.pow(10, +sci[3]); return isFinite(v) ? { v, pct: sci[4] === '%', unit: '' } : null; }
    // the number itself, then an optional scale word, percent sign and unit
    const m = s.match(/^([-+]?)\s*((?:\d[\d,' ]*)?\d?(?:[.,]\d+)?|[\dOoIl.,]+)\s*(thousand|million|billion|trillion|mln|mn|bn|k|K|m|M|b|B|g|G|t|T)?\s*(%|‰)?\s*([A-Za-zµ°²³/ .$€£]{0,24})$/);
    if (!m || !m[2] || !/\d/.test(m[2])) return null;
    let num = m[2].replace(/[\s']/g, '');
    // common OCR slips inside numbers
    if (/^[-\d.,OoIl]+$/.test(num)) num = num.replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
    num = num.replace(/,/g, '');
    if (/^0\d+$/.test(num)) num = num.replace(/^0/, '0.');   // 09 is a 0.9 that lost its point
    if (!/^(\d+\.?\d*|\.\d+)$/.test(num)) return null;
    let sc = m[3] || '', unit = (m[5] || '').trim();
    // a lone t or m after a number is usually a unit (tonnes, metres), unless it is upper case
    if ((sc === 't' || sc === 'm') && unit) return null;
    if (sc === 't') { unit = 't' + (unit ? ' ' + unit : ''); sc = ''; }
    // a unit made of letters must look like a word, not OCR junk glued to the number
    if (unit && !/^[A-Za-zµ°²³/ .$€£]+$/.test(unit)) return null;
    let v = parseFloat(num) * (sc ? MULT[sc.toLowerCase()] : 1);
    if (m[1] === '-' || neg) v = -v;
    if (m[4] === '‰') v /= 10;
    return isFinite(v) ? { v, pct: m[4] === '%', unit } : null;
  }

  // ---------- reading dates out of axis labels ----------
  const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const daysUTC = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;
  const y2 = s => { const n = +s; return s.length === 2 ? (n > 50 ? 1900 + n : 2000 + n) : n; };
  // parses one label into the parts it has: {y, m, d, q}. Missing parts are filled in from neighbours later.
  function parseDatePart(t, dayFirst) {
    const s = String(t || '').trim().replace(/[‘’`´]/g, "'").replace(/[.,]$/, '').replace(/\s+/g, ' ');
    let m;
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/))) return { y: +m[1], m: +m[2], d: +m[3] };
    if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/)) && +m[2] <= 12) return { y: +m[1], m: +m[2], d: 1 };
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) return { y: y2(m[3]), m: +m[1], d: +m[2] };
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/)) && +m[1] <= 12) return { m: +m[1], d: +m[2] };
    if ((m = s.match(/^[Qq]([1-4])[ ']?(\d{2}|\d{4})?$/))) return { q: +m[1], y: m[2] ? y2(m[2]) : undefined };
    if ((m = s.match(/^(\d{4}) ?[Qq]([1-4])$/))) return { q: +m[2], y: +m[1] };
    // "Dec15" (an apostrophe year that lost its apostrophe) is a year
    if (!dayFirst && (m = s.match(/^([A-Za-z]{3})'?(\d{2})$/)) && MON[m[1].toLowerCase()]) return { m: MON[m[1].toLowerCase()], d: 1, y: y2(m[2]) };
    // "Jan '20" and "Jan 2020" are years, "Feb 04" is a day
    if ((m = s.match(/^([A-Za-z]{3,9})\.? ?(?:'(\d{2})|(\d{4}))?$/)) && MON[m[1].toLowerCase()]) return { m: MON[m[1].toLowerCase()], d: 1, y: m[2] ? y2(m[2]) : m[3] ? +m[3] : undefined };
    if ((m = s.match(/^([A-Za-z]{3,9})\.? ?(\d{1,2}),? ?(\d{4})?$/)) && MON[m[1].toLowerCase()]) return { m: MON[m[1].toLowerCase()], d: +m[2], y: m[3] ? +m[3] : undefined };
    if ((m = s.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.? ?(\d{4})?$/)) && MON[m[2].toLowerCase()]) return { m: MON[m[2].toLowerCase()], d: +m[1], y: m[3] ? +m[3] : undefined };
    // "Thu 02" (a weekday and the day of the month, Vega-Lite's daily ticks): only the day counts
    if ((m = s.match(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.? ?(\d{1,2})$/i)) && +m[1] >= 1 && +m[1] <= 31) return { d: +m[1], dayOnly: true };
    if ((m = s.match(/^(1[89]\d\d|2[01]\d\d)$/))) return { y: +m[1], yearOnly: true };
    if ((m = s.match(/^(\d{1,2})$/)) && +m[1] >= 1 && +m[1] <= 31) return { d: +m[1], dayOnly: true };
    return null;
  }
  // a row of x labels -> days since 1970 for each, or null if this is not a date axis
  function parseDateRow(labels) {
    // "Feb7" next to "Feb21": the two digits are a day, not the year 2021
    let dayFirst = labels.some(t => /^[A-Za-z]{3}\.? ?\d$/.test(String(t).trim())) && !labels.some(t => /'\d{2}$/.test(String(t)));
    // "Feb04 Feb11 Feb18 Mar04": read as years they would jump back and forth, so they are days
    const glued = labels.map(t => String(t).trim().match(/^([A-Za-z]{3})(\d{2})$/)).filter(m => m && MON[m[1].toLowerCase()]);
    if (!dayFirst && glued.length >= 3 && glued.some((m, i) => i && +m[2] < +glued[i - 1][2]) && glued.every(m => +m[2] >= 1 && +m[2] <= 31)) dayFirst = true;
    const P = labels.map(t => parseDatePart(t, dayFirst));
    const ok = P.filter(Boolean);
    if (ok.length < Math.max(2, labels.length * 0.7)) return null;
    if (!ok.some(p => p.m || p.q)) return null;          // plain years stay a numeric axis
    if (ok.every(p => p.dayOnly)) return null;
    // carry the year (and month for day only labels) from left to right
    let yr = null, mo = null, noYear = false;
    const first = P.find(p => p && p.y != null);
    if (first) yr = first.y; else { yr = 2001; noYear = true; }
    // walk left from the first labeled year so earlier labels get the right year too
    const fi = first ? P.indexOf(first) : 0;
    let prevM = first ? (first.m || (first.q ? first.q * 3 - 2 : 1)) : null;
    for (let i = fi - 1; i >= 0; i--) { const p = P[i]; if (!p) continue; const mm = p.m || (p.q ? p.q * 3 - 2 : null); if (mm && prevM && mm > prevM) yr--; if (mm) prevM = mm; }
    prevM = null; const out = [];
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (!p) { out.push(null); continue; }
      if (p.y != null) yr = p.y;
      let mm = p.m || (p.q ? p.q * 3 - 2 : null);
      if (p.yearOnly) mm = 1;
      if (p.dayOnly) mm = mo;
      if (mm == null) { out.push(null); continue; }
      if (p.y == null && !p.dayOnly && prevM != null && mm < prevM) yr++;
      prevM = mm; mo = mm;
      out.push(daysUTC(yr, mm, p.d || 1));
    }
    return { days: out, noYear };
  }
  const isoDay = d => { const t = new Date(Math.round(d) * 864e5); return t.toISOString().slice(0, 10); };

  // ---------- fitting an axis from its tick labels ----------
  // pairs: [{p: pixel, v: value}]. Robust line fit that ignores misread labels.
  // Also returns what is needed to put an error bar on any value read off this axis.
  function fitAxis(pairs, opts = {}) {
    if (pairs.length < 2) return null;
    let best = null;
    const tol = pts => { const vs = pts.map(q => q.v); return (Math.max(...vs) - Math.min(...vs) || 1) * 0.02; };
    for (const logScale of opts.log === false ? [false] : opts.log === true ? [true] : [false, true]) {
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
        const score = inl.length * 10 - resid / (t || 1) - (logScale && opts.log !== true ? (inl.length >= 3 ? 4 : 99) : 0);
        if (!best || score > best.score) {
          let ss = 0; for (const q of inl) ss += (i2 + s2 * q.p - q.v) ** 2;
          best = { score, slope: s2, icp: i2, log: logScale, inliers: inl.length, n: P.length, mp, sxx, rsd: n > 2 ? Math.sqrt(ss / (n - 2)) : 0, inl };
        }
      }
    }
    if (!best) return null;
    // the 2% tolerance lets a label that is a few pixels off (a misread, a label snapped to the wrong line) pull
    // the fit. Look again among those labels for the line that most of them hit within a pixel or two.
    if (best.inl.length >= 4) {
      const L = best.inl, ps = L.map(q => q.p).sort((a, b) => a - b), sp = median(ps.slice(1).map((p, k) => p - ps[k])) || 10;
      const tolP = 1.5 + 0.03 * sp;
      let top = null;
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        if (Math.abs(L[a].p - L[b].p) < 3 || L[a].v === L[b].v) continue;
        const sl = (L[b].v - L[a].v) / (L[b].p - L[a].p), ic = L[a].v - sl * L[a].p;
        const r = L.map(q => Math.abs((q.v - ic) / sl - q.p)), k = r.filter(v => v <= tolP).length, e = r.reduce((s, v) => s + Math.min(v, tolP), 0);
        if (!top || k > top.k || (k === top.k && e < top.e)) top = { k, e, keep: L.filter((q, i) => r[i] <= tolP) };
      }
      if (top && top.k >= 3 && top.k < L.length && top.k >= L.length * 0.6) {
        const keep = top.keep, n = keep.length, mp = keep.reduce((s, q) => s + q.p, 0) / n, mv = keep.reduce((s, q) => s + q.v, 0) / n;
        let sxy = 0, sxx = 0; for (const q of keep) { sxy += (q.p - mp) * (q.v - mv); sxx += (q.p - mp) ** 2; }
        if (sxx) { const s2 = sxy / sxx, i2 = mv - s2 * mp; let ss = 0; for (const q of keep) ss += (i2 + s2 * q.p - q.v) ** 2;
          best = Object.assign({}, best, { slope: s2, icp: i2, inliers: n, mp, sxx, rsd: n > 2 ? Math.sqrt(ss / (n - 2)) : 0, inl: keep }); }
      }
    }
    const { slope, icp, log } = best;
    // spread of the labels around the fitted line, in pixels
    const rsdPx = Math.abs(best.rsd / slope);
    return {
      log, inliers: best.inliers, total: best.n, slope, icp, rsdPx, mp: best.mp, sxx: best.sxx,
      used: best.inl.map(q => q.p),
      toValue: p => log ? Math.pow(10, icp + slope * p) : icp + slope * p,
      toPixel: v => ((log ? Math.log10(v) : v) - icp) / slope,
      // half width of a ~95% band for a value read at pixel p, given the pixel uncertainty of the mark
      band: (p, sdPx) => {
        const n = best.inliers, fitPx = n > 2 ? Math.max(rsdPx, 0.15) * Math.sqrt(1 / n + (p - best.mp) ** 2 / (best.sxx || 1)) : 1.0;
        const sp = Math.hypot(sdPx, fitPx), d = 1.96 * Math.abs(slope) * sp;
        if (!log) return [d, d];
        const v = Math.pow(10, icp + slope * p); return [v - v / Math.pow(10, d), v * Math.pow(10, d) - v];
      },
    };
  }

  // labels top to bottom on a y axis often lose their minus sign in OCR. If values go down and then
  // back up, everything after the turn must have been negative.
  function fixMissingMinus(labels, minusAt) {
    const L = [...labels].sort((a, b) => a.p - b.p).map(q => ({ ...q }));
    const variants = [L];
    const zi = L.findIndex(q => q.v === 0);
    if (zi >= 0 && L.slice(zi + 1).some(q => q.v > 0)) variants.push(L.map((q, k) => k > zi && q.v > 0 ? { ...q, v: -q.v } : q));
    for (let t = 1; t < L.length; t++) if (L[t].v > L[t - 1].v && L[t - 1].v >= 0 && L.slice(t).every(q => q.v > 0)) { variants.push(L.map((q, k) => k >= t ? { ...q, v: -q.v } : q)); break; }
    // values that grow downward are negatives that all lost their minus sign, unless no label has a dash in front (a reversed axis)
    const reversedOk = minusAt && L.length >= 3 && L.every(q => q.v >= 0) && L.filter(q => q.v > 0).every(q => !minusAt(q));
    if (L.length >= 2 && L.every(q => q.v >= 0) && !reversedOk) { const f = fitAxis(L); if (f && f.toValue(1) > f.toValue(0)) variants.unshift(L.map(q => ({ ...q, v: -q.v }))); }
    // keep whichever reading lines up into the cleanest scale (and never one that grows downward, unless it is clearly reversed)
    let best = L, bi = -1;
    for (const v of variants) { const f = fitAxis(v); let sc = f ? f.inliers - (v === L ? 0 : 0.5) : -1; if (f && f.toValue(1) > f.toValue(0) && !reversedOk) sc -= 100; if (sc > bi) { bi = sc; best = v; } }
    return best;
  }

  // OCR often reads the comma in 4,000 as a period. If every label looks like d.000, they are thousands.
  // A column where every comma has one or two digits after it uses the comma as a decimal point (1,5 = 1.5).
  function fixSeparators(col) {
    // a tick mark glued to the label reads as a trailing dash ("$8.000-")
    const txt = col.map(q => String(q.text).replace(/[\s$%€£]/g, '').replace(/[-\u2013\u2014_|]+$/, ''));
    const nz = txt.filter(t => !/^[-−]?0+$/.test(t));
    const hasComma = txt.some(t => /^-?\d{1,3}(,\d{3})+$/.test(t));
    // (most of them: a stray label from the x axis can land in the column)
    const m000 = nz.filter(t => /^[-−]?\d{1,3}\.000$/.test(t)).length;
    const allDot000 = m000 >= 2 && (m000 === nz.length || (m000 >= 3 && m000 >= nz.length * 0.6 && !nz.some(t => /^[-−]?\d+\.\d{1,2}$/.test(t))));
    const euro = !hasComma && txt.some(t => /,\d{1,2}$/.test(t)) && txt.every(t => !/,/.test(t) || /^-?\d+,\d{1,2}$/.test(t));
    for (let k = 0; k < col.length; k++) {
      if ((hasComma || allDot000) && /^[-−]?\d{1,3}\.\d{3}$/.test(txt[k])) col[k].v = col[k].v * 1000;
      else if (euro && /,\d{1,2}$/.test(txt[k])) { const n = parseNumber(txt[k].replace(',', '.')); if (n) col[k].v = n.v; }
    }
    return euro;
  }
  // 10^3 written with a superscript reads as "103". A run of labels 10d with consecutive d is a log axis of powers of ten.
  function fixPowers(col) {
    // labels like 10², 10³ read as "102", "103". One superscript is often misread ("105" as "103") or lost ("10"),
    // so the exponents are checked against the even spacing of the labels: one decade per step.
    const txt = col.map(q => String(q.text).replace(/\s/g, ''));
    const cand = col.map((q, k) => /^10[-−]?\d{0,2}$/.test(txt[k]) ? { k, p: q.p, e: txt[k].length === 2 ? 1 : +txt[k].slice(2).replace('−', '-') } : null).filter(Boolean);
    if (col.length < 3 || cand.length < 3 || cand.length < col.length * 0.75 || cand.filter(c => txt[c.k].length > 2).length < 2) return false;
    const ps = col.map(q => q.p).sort((a, b) => a - b), sp = median(ps.slice(1).map((p, i) => p - ps[i]));
    if (!(sp > 3) || ps.slice(1).some((p, i) => Math.abs((p - ps[i]) / sp - 1) > 0.15)) return false;
    let best = null;
    for (const a of cand) for (const dir of [-1, 1]) {
      const pred = q => a.e + dir * Math.round((q.p - a.p) / sp), agree = cand.filter(c => pred(c) === c.e).length;
      if (!best || agree > best.agree) best = { agree, pred };
    }
    if (best.agree < Math.max(3, cand.length * 0.6)) return false;
    col.forEach(q => { q.v = Math.pow(10, best.pred(q)); });
    return true;
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
  // text that names something (not a number, even one with a unit glued on like "0an rate" from a misread "Loan rate")
  const isWord = t => /[A-Za-z]{2,}/.test(t) && (!parseNumber(t) || (parseNumber(t).unit || '').replace(/[^A-Za-z]/g, '').length >= 3 && !/^\d[\d,. ]*(years?|yrs|people|days|hours|tons?|t|kg|km|mi|pp|pts|points)$/i.test(t));
  const isTickMark = w => /^[1|lI!\-]$/.test(w.text) && (w.x1 - w.x0) < (w.y1 - w.y0) * 0.45;

  function findAxes(words0, W, H) {
    const words = words0.filter(w => !isTickMark(w) && !/^[-_.]+$/.test(w.text));
    const nums = [];
    for (const w of words) {
      const n = parseNumber(w.text); if (!n) continue;
      nums.push({ ...w, v: n.v, pct: n.pct, unit: n.unit, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0 });
    }
    // y axis labels: stacked vertically and overlapping horizontally (right edges vary when OCR drops a % sign)
    const cols = overlapCols(nums).filter(g => g.length >= 3 && new Set(g.map(q => Math.round(q.cy / 4))).size >= 3);
    cols.forEach(g => { g.span = Math.max(...g.map(q => q.cy)) - Math.min(...g.map(q => q.cy)); g.fit = fitAxis(g.map(q => ({ p: q.cy, v: q.v }))); });
    // a column has to line up into a scale to be an axis (this drops columns of bar value labels)
    const good = cols.filter(g => g.fit && g.fit.inliers >= Math.min(3, g.length));
    good.sort((a, b) => (b.length * 2 + b.span / H * 10) - (a.length * 2 + a.span / H * 10));
    let yCol = good.filter(g => g.k < W * 0.5)[0] || good[0] || null;
    // a second scale on the right must be a real column of labels that lines up into a scale, past the plot
    const yRight = yCol && good.find(g => g !== yCol && g.k > W * 0.6 && g.x0 > yCol.x1 + W * 0.3 && g.length >= 3 && g.reduce((a, q) => a + q.conf, 0) / g.length > 60 && g.fit.inliers >= 3) || null;
    // x axis labels: same baseline, spread horizontally, below the y labels
    const all = words.map(w => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, n: parseNumber(w.text) }));
    // (only labels that fit the scale: an x label caught in the column would push this below the x row)
    const yIn = yCol && yCol.fit ? yCol.filter(q => yCol.fit.used.includes(q.cy)) : yCol;
    const yBottom = yCol ? Math.max(...(yIn.length >= 2 ? yIn : yCol).map(q => q.cy)) : H * 0.6;
    // a number read twice (once alone, once inside a longer label like "Dec'15") only counts once
    const ov = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
    const deduped = all.filter(q => !all.some(o => o !== q && o.text.length > q.text.length && ov(o, q) > 0.6 * (q.x1 - q.x0) * (q.y1 - q.y0)));
    const rows = groupBy(deduped.filter(q => q.cy > yBottom - 4 && q.conf > 40), q => q.cy, Math.max(5, H * 0.012))
      .filter(g => g.length >= 2 && new Set(g.map(q => Math.round(q.cx / 8))).size >= 2);
    // tick labels are numbers or dates and sit just under the plot; a sentence of notes further down is not an axis
    const rowScore = g => g.filter(q => q.n || parseDatePart(q.text)).length * 3 + g.length - Math.max(0, g.k - yBottom) / (H * 0.08);
    rows.sort((a, b) => (rowScore(b) - rowScore(a)) || (a.k - b.k));
    const xRow = rows[0] || null;
    return { yCol, yRight, xRow, nums, cols: good };
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
        if (jx + 1 < x1) { const k = j + 1; if (mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); } }
        if (jx - 1 >= x0) { const k = j - 1; if (mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); } }
        if (jy + 1 < y1) { const k = j + W; if (mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); } }
        if (jy - 1 >= y0) { const k = j - W; if (mask[k] && !lab[k]) { lab[k] = c.id; stack.push(k); } }
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

  // interpolate a traced line at pixel x
  function traceAt(tr, px) {
    let lo = 0, hi = tr.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tr[m][0] <= px) lo = m; else hi = m; }
    const a = tr[lo], b = tr[hi]; return b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (px - a[0]) / (b[0] - a[0]);
  }

  // The data behind a line chart usually sits on a regular grid of x values (years, months, 0..n).
  // Try grids from coarse to fine and keep the coarsest one whose straight segments reproduce the drawn line.
  function evalGrid(tr, vals, xcal) {
    const xs0 = tr[0][0], xs1 = tr[tr.length - 1][0];
    const grid = vals.map(v => [xcal.toPixel(v), v]).filter(g => g[0] >= xs0 - 3 && g[0] <= xs1 + 3).sort((a, b) => a[0] - b[0]);
    if (grid.length < 2) return null;
    const pxStep = median(grid.slice(1).map((g, i) => g[0] - grid[i][0]));
    if (pxStep < 2.5) return null;
    // a grid point a few pixels past the end of the trace (the plot edge cut the line): carry the end on straight
    // inside the trace, a corner column far from where both neighbouring straight pieces point (a gridline crossing
    // right at the corner) is replaced by the point they agree on
    const ext = (px) => { if (pxStep >= 14 && px >= xs0 + 7 && px <= xs1 - 7) { const t = d => traceAt(tr, px + d), l = t(-2) + (t(-2) - t(-6)) / 2, r = t(2) + (t(2) - t(6)) / 2, m = t(0);
        return Math.abs(l - r) < 3 && Math.abs(m - l) > 4 && Math.abs(m - r) > 4 ? (l + r) / 2 : m; }
      if (px >= xs0 && px <= xs1) return traceAt(tr, px);
      const k = px < xs0 ? 0 : tr.length - 1, j = px < xs0 ? Math.min(tr.length - 1, 4) : Math.max(0, tr.length - 5);
      const a = tr[k], b = tr[j]; if (Math.abs(px - a[0]) > 4 || b[0] === a[0]) return a[1];
      return a[1] + (b[1] - a[1]) * (px - a[0]) / (b[0] - a[0]); };
    const G = grid.map(([px, v]) => [px, ext(px), v]);
    // how far is the drawn line from the straight segments through the grid points
    const dev = []; let gi = 0;
    for (const [x, y] of tr) { while (gi < G.length - 2 && G[gi + 1][0] < x) gi++; const a = G[gi], b = G[gi + 1] || a;
      // corners get rounded by thick lines, so only judge the straight middle of each segment
      if (Math.min(Math.abs(x - a[0]), Math.abs(b[0] - x)) < pxStep * 0.28) continue;
      const yy = b[0] === a[0] ? a[1] : a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]); dev.push(Math.abs(yy - y)); }
    if (dev.length < 4) return null;
    dev.sort((a, b) => a - b);
    // the grid must reach both ends of the line
    if (G[0][0] - xs0 > pxStep * 0.6 || xs1 - G[G.length - 1][0] > pxStep * 0.6) return null;
    return { p95: dev[Math.floor(dev.length * 0.95)], G };
  }
  function pickGrid(cands, Y) {
    if (!cands.length) return null;
    const bestDev = Math.min(...cands.map(c => c.p95));
    const pick = cands.find(c => c.p95 <= bestDev * 2 + 2);
    if (!pick || pick.p95 > 8) return null;
    return { st: pick.st, p95: pick.p95, pts: pick.G.map(([px, py, v]) => ({ x: pick.round ? pick.round(v) : v, y: Y(py), px, py })) };
  }
  function fitGrid(tr, xcal, tick, Y, anchor) {
    const v0 = xcal.toValue(tr[0][0]), v1 = xcal.toValue(tr[tr.length - 1][0]), lo = Math.min(v0, v1), hi = Math.max(v0, v1);
    const cands = [];
    for (const m of [1, 2, 2.5, 3, 4, 5, 6, 10, 12, 20, 25, 50]) {
      const st = tick / m, pxStep = Math.abs(xcal.toPixel(st) - xcal.toPixel(0));
      if (pxStep < 2.5) break;
      // the grid on multiples of the step, and the grid through the first tick label (2013, 2018, ... with a step of 5)
      let best = null;
      for (const g0 of [Math.floor(lo / st) * st, anchor != null ? anchor - Math.ceil((anchor - lo) / st - 1e-9) * st : null]) {
        if (g0 == null || (best && Math.abs(g0 - best.g0) < st * 1e-6)) continue;
        const n = Math.round((hi - g0) / st) + 1; if (n < 2 || n > 600) continue;
        const vals = []; for (let k = 0; k <= n; k++) vals.push(+(g0 + k * st).toFixed(9));
        const e = evalGrid(tr, vals, xcal); if (e && (!best || e.p95 < best.p95)) best = Object.assign(e, { g0 });
      }
      if (best) { const off = best.g0; cands.push(Object.assign(best, { st, round: v => +(off + Math.round((v - off) / st) * st).toFixed(6) })); }
    }
    // a time axis in years: data are almost always yearly, so a one year grid that fits wins over a coarser one
    // (a flat stretch fits any coarse grid just as well)
    if (lo >= 1700 && hi <= 2200 && hi - lo >= 6 && tick >= 1 && Number.isInteger(tick)) {
      const one = cands.find(c => Math.abs(c.st - 1) < 1e-9), bestDev = cands.length ? Math.min(...cands.map(c => c.p95)) : 0;
      if (one && one.p95 <= bestDev * 2 + 2 && one.p95 <= 8 && Math.abs(xcal.toPixel(1) - xcal.toPixel(0)) >= 4) return pickGrid([one], Y);
    }
    return pickGrid(cands, Y);
  }
  // dates: yearly, quarterly, monthly, weekly or daily data points
  function fitGridDates(tr, xcal, Y) {
    const d0 = xcal.toValue(tr[0][0]), d1 = xcal.toValue(tr[tr.length - 1][0]);
    const a = new Date(Math.floor(Math.min(d0, d1) - 400) * 864e5), y0 = a.getUTCFullYear(), last = Math.max(d0, d1) + 400;
    const cands = [];
    const months = step => { const v = []; for (let y = y0, m = 0; ; m += step) { const d = Date.UTC(y + Math.floor(m / 12), m % 12, 1) / 864e5; if (d > last) break; v.push(d); } return v; };
    for (const [st, vals] of [[365, months(12)], [91, months(3)], [30, months(1)]]) { const e = evalGrid(tr, vals, xcal); if (e) cands.push(Object.assign(e, { st })); }
    for (const st of [7, 1]) {
      let best = null;
      for (let o = 0; o < st; o++) { const v = []; for (let d = Math.floor(Math.min(d0, d1)) - st + o; d <= Math.max(d0, d1) + st; d += st) v.push(d); const e = evalGrid(tr, v, xcal); if (e && (!best || e.p95 < best.p95)) best = e; }
      if (best) cands.push(Object.assign(best, { st }));
    }
    return pickGrid(cands, Y);
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
  // where the horizontal lines at the tick positions (gridlines, the axis) stop on the right
  function lineEnd(D, W, H, ys, left) {
    const ends = [];
    for (const yy of ys) {
      const y = Math.round(yy); if (y < 2 || y > H - 3) continue;
      // a line pixel differs from the pixels 2 rows above and below in the same way
      const on = x => { const a = lumAt(D, W, x, y), u = lumAt(D, W, x, y - 2), d = lumAt(D, W, x, y + 2); return Math.abs(a - u) > 12 && Math.abs(a - d) > 12 && Math.sign(a - u) === Math.sign(a - d); };
      let x = Math.max(0, Math.round(left)), last = -1, gap = 0, hits = 0;
      for (; x < W; x++) { if (on(x)) { last = x; gap = 0; hits++; } else if (++gap > 12 && last >= 0) break; }
      if (hits > (W - left) * 0.3) ends.push(last);
    }
    if (ends.length < 2) return null;
    ends.sort((a, b) => a - b);
    const m = ends[ends.length >> 1];
    return ends.filter(e => Math.abs(e - m) <= 3).length >= Math.max(2, ends.length * 0.5) ? m : null;
  }
  // is there a short horizontal dash just left of this label (a minus sign OCR dropped)?
  function minusLeftOf(D, W, H, w, bgL) {
    const h = w.y1 - w.y0, cy = (w.y0 + w.y1) / 2, x1 = Math.round(w.x0) - 1, x0 = Math.max(0, Math.round(w.x0 - h * 0.9));
    let hits = 0, rowsHit = new Set();
    for (let y = Math.round(cy - h * 0.5); y <= Math.round(cy + h * 0.5); y++) { if (y < 0 || y >= H) continue;
      let run = 0; for (let x = x0; x <= x1; x++) { if (Math.abs(lumAt(D, W, x, y) - bgL) > 60) run++; }
      if (run >= Math.max(2, h * 0.25)) { hits++; rowsHit.add(y); } }
    return hits > 0 && hits <= Math.max(2, h * 0.3) && [...rowsHit].every(y => Math.abs(y - cy) < h * 0.3);
  }

  // ---------- straightening a slightly rotated picture ----------
  // Finds the small rotation that makes the long straight lines (axes, gridlines, bar edges) line up
  // with the pixel grid. Returns {angle (degrees), img}. img is a new rotated image or the same one.
  function deskew(img, opts = {}) {
    const W = img.width, H = img.height, D = img.data;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / 600)), w = Math.floor(W / f), h = Math.floor(H / f);
    const L = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y * f) * W + x * f) * 4; L[y * w + x] = (D[i] * 299 + D[i + 1] * 587 + D[i + 2] * 114) / 1000; }
    // edge points with a strong vertical or horizontal gradient
    const ptsH = [], ptsV = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const gy = L[(y + 1) * w + x] - L[(y - 1) * w + x], gx = L[y * w + x + 1] - L[y * w + x - 1];
      if (Math.abs(gy) > 40 && Math.abs(gy) > 2 * Math.abs(gx)) ptsH.push(x, y);
      else if (Math.abs(gx) > 40 && Math.abs(gx) > 2 * Math.abs(gy)) ptsV.push(x, y);
    }
    const score = deg => {
      const t = Math.tan(deg * Math.PI / 180); let s = 0;
      const hist = new Float32Array(h + w + 4);
      for (let k = 0; k < ptsH.length; k += 2) { const yy = Math.round(ptsH[k + 1] - ptsH[k] * t) + w; if (yy >= 0 && yy < hist.length) hist[yy]++; }
      for (const v of hist) s += v * v;
      const hv = new Float32Array(h + w + 4);
      for (let k = 0; k < ptsV.length; k += 2) { const xx = Math.round(ptsV[k] + ptsV[k + 1] * t) + h; if (xx >= 0 && xx < hv.length) hv[xx]++; }
      for (const v of hv) s += v * v;
      return s;
    };
    if (ptsH.length + ptsV.length < 200) return { angle: 0, img };
    let best = 0, bs = score(0);
    const s0 = bs, lim = opts.maxAngle || 4;
    for (let a = -lim; a <= lim + 1e-9; a += 0.25) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    const b0 = best; for (let a = b0 - 0.25; a <= b0 + 0.25 + 1e-9; a += 0.05) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    const b1 = best; for (let a = b1 - 0.05; a <= b1 + 0.05 + 1e-9; a += 0.01) { const s = score(a); if (s > bs) { bs = s; best = a; } }
    if (Math.abs(best) < 0.15 || bs < s0 * 1.25) return { angle: 0, img };
    return { angle: +best.toFixed(2), img: rotate(img, best) };
  }
  // rotate by deg degrees (positive turns the picture clockwise), bilinear, padding with the corner color
  function rotate(img, deg) {
    const W = img.width, H = img.height, D = img.data, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const W2 = Math.ceil(Math.abs(W * c) + Math.abs(H * s)), H2 = Math.ceil(Math.abs(W * s) + Math.abs(H * c));
    const out = new Uint8ClampedArray(W2 * H2 * 4), bg = [D[0], D[1], D[2]];
    const cx = (W - 1) / 2, cy = (H - 1) / 2, cx2 = (W2 - 1) / 2, cy2 = (H2 - 1) / 2;
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) {
      const dx = x - cx2, dy = y - cy2, sx = c * dx - s * dy + cx, sy = s * dx + c * dy + cy, o = (y * W2 + x) * 4;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[o] = bg[0]; out[o + 1] = bg[1]; out[o + 2] = bg[2]; out[o + 3] = 255; continue; }
      for (let k = 0; k < 3; k++) {
        const i = (y0 * W + x0) * 4 + k;
        out[o + k] = (D[i] * (1 - fx) + D[i + 4] * fx) * (1 - fy) + (D[i + W * 4] * (1 - fx) + D[i + W * 4 + 4] * fx) * fy;
      }
      out[o + 3] = 255;
    }
    return { width: W2, height: H2, data: out };
  }

  // ---------- straightening a photo of a screen or a printout ----------
  // quad: the chart's four corners in the photo [[x,y] top left, top right, bottom right, bottom left].
  // Returns a w x h image with that quadrilateral mapped onto a rectangle (perspective warp, bilinear).
  function homography(src, dst) {
    // solve the 8 unknowns of the projective map from four point pairs
    const A = [], b = [];
    for (let k = 0; k < 4; k++) {
      const [x, y] = src[k], [u, v] = dst[k];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      if (Math.abs(M[c][c]) < 1e-12) return null;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    const h = M.map((r, i) => r[n] / r[i]);
    return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  }
  function warp(img, quad, w, h) {
    const W = img.width, H = img.height, D = img.data;
    if (!w || !h) {
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      w = Math.round(Math.max(d(quad[0], quad[1]), d(quad[3], quad[2]))); h = Math.round(Math.max(d(quad[0], quad[3]), d(quad[1], quad[2])));
    }
    // map output pixels back into the photo
    const Hm = homography([[0, 0], [w - 1, 0], [w - 1, h - 1], [0, h - 1]], quad);
    if (!Hm) return null;
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const z = Hm[6] * x + Hm[7] * y + 1, sx = (Hm[0] * x + Hm[1] * y + Hm[2]) / z, sy = (Hm[3] * x + Hm[4] * y + Hm[5]) / z, o = (y * w + x) * 4;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      out[o + 3] = 255;
      if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) { out[o] = out[o + 1] = out[o + 2] = 255; continue; }
      for (let k = 0; k < 3; k++) { const i = (y0 * W + x0) * 4 + k; out[o + k] = (D[i] * (1 - fx) + D[i + 4] * fx) * (1 - fy) + (D[i + W * 4] * (1 - fx) + D[i + W * 4 + 4] * fx) * fy; }
    }
    return { width: w, height: h, data: out };
  }
  // a first guess at the corners of a screen or sheet of paper in a photo: the biggest bright region, by its extreme corners
  function guessQuad(img) {
    const W = img.width, H = img.height, D = img.data, f = Math.max(1, Math.ceil(Math.max(W, H) / 500)), w = Math.ceil(W / f), h = Math.ceil(H / f);
    const L = new Float32Array(w * h), ls = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y * f) * W + x * f) * 4; L[y * w + x] = (D[i] * 299 + D[i + 1] * 587 + D[i + 2] * 114) / 1000; ls.push(L[y * w + x]); }
    const thr = (quant(ls, 0.1) + quant(ls, 0.9)) / 2, m = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) m[p] = L[p] > thr ? 1 : 0;
    const { comps, lab } = components(m, w, h, 0, 0, w, h);
    if (!comps.length) return [[0, 0], [W - 1, 0], [W - 1, H - 1], [0, H - 1]];
    const c = comps.reduce((a, q) => q.n > a.n ? q : a);
    let tl = null, tr = null, br = null, bl = null;
    for (let y = c.ya; y <= c.yb; y++) for (let x = c.xa; x <= c.xb; x++) {
      if (lab[y * w + x] !== c.id) continue;
      if (!tl || x + y < tl[0] + tl[1]) tl = [x, y]; if (!br || x + y > br[0] + br[1]) br = [x, y];
      if (!tr || x - y > tr[0] - tr[1]) tr = [x, y]; if (!bl || y - x > bl[1] - bl[0]) bl = [x, y];
    }
    return [tl, tr, br, bl].map(q => [q[0] * f, q[1] * f]);
  }

  // ---------- turning a horizontal chart on its side ----------
  // (x, y) -> (H-1-y, W-1-x). Horizontal bars become vertical bars standing on the bottom edge,
  // with values growing upward, so the vertical reader can measure them.
  function flipImg(img) {
    const W = img.width, H = img.height, D = img.data, out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, o = ((W - 1 - x) * H + (H - 1 - y)) * 4;
      out[o] = D[i]; out[o + 1] = D[i + 1]; out[o + 2] = D[i + 2]; out[o + 3] = 255;
    }
    return { width: H, height: W, data: out };
  }
  // the mark model's labels follow the picture through the same flip and resize
  function segFlip(sg) {
    const W = sg.width, H = sg.height, inst = new Int16Array(W * H), cls = sg.cls ? new Uint8Array(W * H) : null;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = (W - 1 - x) * H + (H - 1 - y); inst[o] = sg.inst[y * W + x]; if (cls) cls[o] = sg.cls[y * W + x]; }
    return { width: H, height: W, inst, cls, k: sg.k };
  }
  function segScale(sg, w, h) {
    const inst = new Int16Array(w * h), cls = sg.cls ? new Uint8Array(w * h) : null;
    for (let y = 0; y < h; y++) { const sy = Math.min(sg.height - 1, Math.floor((y + 0.5) * sg.height / h)); for (let x = 0; x < w; x++) { const q = sy * sg.width + Math.min(sg.width - 1, Math.floor((x + 0.5) * sg.width / w)); inst[y * w + x] = sg.inst[q]; if (cls) cls[y * w + x] = sg.cls[q]; } }
    return { width: w, height: h, inst, cls, k: sg.k };
  }
  const flipWord = (w, W, H) => ({ ...w, x0: H - 1 - w.y1, x1: H - 1 - w.y0, y0: W - 1 - w.x1, y1: W - 1 - w.x0, flipped: true });

  // ---------- background and ink ----------
  function plotBackground(D, W, rect) {
    const hist = new Map();
    for (let y = rect.top; y < rect.bottom; y += 2) for (let x = rect.left; x < rect.right; x += 2) {
      const i = (y * W + x) * 4, k = (D[i] >> 3) << 10 | (D[i + 1] >> 3) << 5 | (D[i + 2] >> 3);
      // backgrounds are white, gray or black. Big bars can outnumber the background, so colorful pixels count far less.
      const wgt = rgb2hsv(D[i], D[i + 1], D[i + 2])[1] < 0.18 ? 1 : 0.02;
      hist.set(k, (hist.get(k) || 0) + wgt);
    }
    let bgk = 0, bgn = 0; for (const [k, n] of hist) if (n > bgn) { bgn = n; bgk = k; }
    const A = [((bgk >> 10) & 31) * 8 + 4, ((bgk >> 5) & 31) * 8 + 4, (bgk & 31) * 8 + 4];
    // a colored theme (navy slides) loses the vote above, more so with noise. The color around the edge of the
    // picture wins when it also covers a good part of the plot.
    const H = (D.length / 4 / W) | 0, edge = [];
    for (let x = 0; x < W; x += 3) edge.push([x, 1], [x, H - 2]);
    for (let y = 0; y < H; y += 3) edge.push([1, y], [W - 2, y]);
    const px = edge.map(([x, y]) => { const i = (y * W + x) * 4; return [D[i], D[i + 1], D[i + 2]]; });
    const B0 = [0, 1, 2].map(c => median(px.map(p => p[c])));
    if (px.filter(p => cdist(p, B0) < 30).length < px.length * 0.5) return A;
    let r = 0, g = 0, b = 0, n = 0, tot = 0;
    for (let y = rect.top; y < rect.bottom; y += 2) for (let x = rect.left; x < rect.right; x += 2) { const i = (y * W + x) * 4; tot++;
      if (cdist([D[i], D[i + 1], D[i + 2]], B0) < 30) { r += D[i]; g += D[i + 1]; b += D[i + 2]; n++; } }
    if (!n || n < tot * 0.15) return A;
    const B = [r / n, g / n, b / n];
    return cdist(A, B) < 30 ? A : (rgb2hsv(B[0], B[1], B[2])[1] >= 0.18 ? B : A);
  }

  function joinWords(ws) {
    const s = [...ws].sort((a, b) => a.x0 - b.x0).map(w => ({ ...w })), out = [];
    for (const w of s) { const h = w.y1 - w.y0, prev = out.find(o => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.4 && w.x0 - o.x1 > -2 && w.x0 - o.x1 < h * 0.8);
      if (prev) { prev.text += ' ' + w.text; prev.x1 = w.x1; prev.y0 = Math.min(prev.y0, w.y0); prev.y1 = Math.max(prev.y1, w.y1); prev.conf = Math.max(prev.conf || 0, w.conf || 0); } else out.push(w); }
    return out;
  }
  // ---------- pie and donut charts ----------
  function readPie(img, words, opts = {}) {
    const W = img.width, H = img.height, D = img.data, N = W * H;
    const full = { left: 0, right: W - 1, top: 0, bottom: H - 1 };
    const bg = plotBackground(D, W, full);
    const textMask = new Uint8Array(N);
    for (const w of words) { for (let y = Math.max(0, Math.floor(w.y0 - 1)); y < Math.min(H, Math.ceil(w.y1 + 1)); y++) for (let x = Math.max(0, Math.floor(w.x0 - 1)); x < Math.min(W, Math.ceil(w.x1 + 1)); x++) textMask[y * W + x] = 1; }
    // anything clearly not background; slices are colorful or at least not the background gray.
    // the shape tests run on a smaller copy, which is plenty to find a disc (a block counts when it is mostly ink,
    // so thin leader lines out to the labels drop away)
    const f = Math.max(1, Math.ceil(Math.max(W, H) / 360)), w = Math.ceil(W / f), h = Math.ceil(H / f);
    const m = new Uint8Array(N), sm = new Uint8Array(w * h);
    const bg2 = 45 * 45;
    for (let p = 0, i = 0; p < N; p++, i += 4) { if (textMask[p]) continue; const dr = D[i] - bg[0], dg = D[i + 1] - bg[1], db = D[i + 2] - bg[2]; if (dr * dr + dg * dg + db * db > bg2) m[p] = 1; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let n = 0, t = 0; for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) { const xx = x * f + dx, yy = y * f + dy; if (xx < W && yy < H) { t++; n += m[yy * W + xx]; } } sm[y * w + x] = n * 4 >= t * 3 ? 1 : 0; }
    // close small gaps (white lines between slices) with a dilation, then take the biggest blob
    const dil = new Uint8Array(w * h), Rd = Math.max(1, Math.round(2 / f + 0.5));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (sm[y * w + x]) for (let dy = -Rd; dy <= Rd; dy++) for (let dx = -Rd; dx <= Rd; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) dil[yy * w + xx] = 1; }
    const { comps } = components(dil, w, h, 0, 0, w, h);
    if (!comps.length) return null;
    comps.sort((a, b) => b.n - a.n);
    const c = comps[0];
    const rs = (c.w + c.h) / 4, ar = c.w / c.h;
    if (rs * f < Math.min(W, H) * 0.12 || ar < 0.85 || ar > 1.18) return null;
    const cxs = (c.xa + c.xb) / 2, cys = (c.ya + c.yb) / 2;
    // how round is it: the ring inside the disc must be covered and the corners of its box empty
    let inDisc = 0, cov = 0, cornerN = 0, cornerOn = 0;
    for (let y = Math.floor(cys - rs); y <= Math.ceil(cys + rs); y++) for (let x = Math.floor(cxs - rs); x <= Math.ceil(cxs + rs); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue; const d = Math.hypot(x - cxs, y - cys);
      if (d < rs * 0.97 && d > rs * 0.6) { inDisc++; if (dil[y * w + x]) cov++; }
      if (d > rs * 1.12) { cornerN++; if (sm[y * w + x]) cornerOn++; }
    }
    const ringCover = cov / Math.max(1, inDisc);
    if (ringCover < 0.9) return null;
    if (cornerN && cornerOn / cornerN > 0.25) return null;
    const r = rs * f + (f - 1) / 2, cx = cxs * f + (f - 1) / 2, cy = cys * f + (f - 1) / 2;
    // a donut has background in the middle
    let hole = 0;
    for (let rr = 0; rr < r * 0.9; rr += 1) { let bgN = 0, n = 0;
      for (let a = 0; a < 360; a += 10) { const x = Math.round(cx + rr * Math.cos(a * Math.PI / 180)), y = Math.round(cy + rr * Math.sin(a * Math.PI / 180)); if (x < 0 || y < 0 || x >= W || y >= H) continue; n++; if (!m[y * W + x] || textMask[y * W + x]) bgN++; }
      if (n && bgN / n > 0.6) hole = rr; else break; }
    const donut = hole > r * 0.2;
    const r0 = donut ? hole + 2 : r * 0.12, r1 = r * 0.94;
    // read the color all around, at several radii, and vote per angle
    const NA = 1440, radii = []; for (let k = 0; k < 6; k++) radii.push(r0 + (r1 - r0) * (0.1 + 0.8 * k / 5));
    const samples = [], raw = radii.map(() => new Array(NA).fill(null));
    for (let k = 0; k < NA; k++) {
      const a = (k / NA) * 2 * Math.PI - Math.PI / 2, cs = [];   // start at 12 o'clock, go clockwise
      radii.forEach((rr, ri) => { const x = Math.round(cx + rr * Math.cos(a)), y = Math.round(cy + rr * Math.sin(a)); if (x < 0 || y < 0 || x >= W || y >= H) return; const p = y * W + x, i = p * 4;
        if (textMask[p]) return; const col = [D[i], D[i + 1], D[i + 2]]; raw[ri][k] = col;
        if (!m[p]) return; cs.push(col); });
      samples.push(cs);
    }
    // cluster the slice colors
    const cl = [];
    for (const cs of samples) for (const col of cs) { const near = cl.find(q => cdist(q.c, col) < 34); if (near) { near.n++; near.s = near.s.map((v, j) => v + col[j]); } else cl.push({ c: col, n: 1, s: col.slice() }); }
    cl.forEach(q => { q.c = q.s.map(v => v / q.n); });
    const tot = cl.reduce((a, q) => a + q.n, 0);
    const keep = cl.filter(q => q.n > tot * 0.004).sort((a, b) => b.n - a.n);
    if (keep.length < 1) return null;
    const lab = samples.map(cs => {
      if (!cs.length) return -1; const votes = new Array(keep.length).fill(0);
      for (const col of cs) { let bi = -1, bd = 1e9; keep.forEach((q, j) => { const d = cdist(q.c, col); if (d < bd) { bd = d; bi = j; } }); if (bd < 40) votes[bi]++; }
      const mx = Math.max(...votes); return mx > 0 ? votes.indexOf(mx) : -1;
    });
    // a thin line running out from the centre in a color no slice has (white, or the background) is the separator
    // between two slices. It shows up at the same angle on most radii, give or take a pixel.
    const sepR = raw.map(R => R.map(col => col && (cdist(col, bg) < 60 || keep.every(q => cdist(q.c, col) >= 40)) ? 1 : 0));
    const sepK = new Uint8Array(NA);
    // (and the angles around it are clean: grain makes odd pixels everywhere)
    const u = new Float32Array(NA); for (const S of sepR) for (let k = 0; k < NA; k++) u[k] += S[k];
    for (let k = 0; k < NA; k++) { let n = 0; for (const S of sepR) { let hit = 0; for (let d = -3; d <= 3 && !hit; d++) hit = S[(k + d + NA) % NA]; n += hit; }
      if (n < 5) continue;
      let t = 0, c = 0; for (let d = 8; d <= 40; d++) { t += u[(k + d) % NA] + u[(k - d + NA) % NA]; c += 2 * sepR.length; }
      if (t / c < 0.12) sepK[k] = 1; }
    // fill unknown angles (separators, labels) from the neighbours, half each way
    const known = lab.map(v => v >= 0);
    if (!known.some(Boolean)) return null;
    const L = lab.slice();
    for (let k = 0; k < NA; k++) if (L[k] < 0) {
      let a = 1; while (lab[(k - a + NA) % NA] < 0 && a < NA) a++; let b = 1; while (lab[(k + b) % NA] < 0 && b < NA) b++;
      L[k] = a <= b ? lab[(k - a + NA) % NA] : lab[(k + b) % NA];
    }
    // two shades of one slice (grain or a scan splits a color in two) flip back and forth many times around the
    // circle; real neighbours meet once. Shades that alternate like that are one color.
    for (let it = 0; it < 6; it++) {
      const tr = new Map();
      for (let k = 0; k < NA; k++) { const a = L[k], b = L[(k + 1) % NA]; if (a !== b) { const key = Math.min(a, b) + ',' + Math.max(a, b); tr.set(key, (tr.get(key) || 0) + 1); } }
      const flick = [...tr].filter(([key, n]) => { const [a, b] = key.split(',').map(Number); return n >= 8 && cdist(keep[a].c, keep[b].c) < 70; }).sort((x, y) => y[1] - x[1])[0];
      if (!flick) break;
      const [a, b] = flick[0].split(',').map(Number), cntA = L.filter(v => v === a).length, cntB = L.filter(v => v === b).length, [to, from] = cntA >= cntB ? [a, b] : [b, a];
      for (let k = 0; k < NA; k++) if (L[k] === from) L[k] = to;
    }
    // runs of the same color are slices; drop slivers shorter than half a degree (anti-aliasing)
    let start = 0; while (start < NA && L[start] === L[(start - 1 + NA) % NA]) start++;
    if (start === NA) start = 0;
    // separators: the middle of each short run of background angles. Two slices in the same color (a palette that
    // ran out of colors) are only told apart by the separator between them.
    const cut = new Uint8Array(NA);
    // (only on a clean read: in a grainy picture odd pixels line up by chance)
    if (sepK.reduce((a, v) => a + v, 0) < NA * 0.06)
      for (let k = 0; k < NA; k++) if (sepK[k] && !sepK[(k - 1 + NA) % NA]) { let n = 0; while (n < NA && sepK[(k + n) % NA]) n++; if (n <= NA / 360 * 4) cut[(k + (n >> 1)) % NA] = 1; }
    if (opts.debug) console.log('DBG pie sepK', sepK.reduce((a, v) => a + v, 0), 'cuts', [...cut].map((v, k) => v ? k : -1).filter(k => k >= 0).join(','), 'r', r.toFixed(1), 'cx', cx.toFixed(1), cy.toFixed(1));
    let runs = [];
    for (let k = 0; k < NA; k++) { const i = (start + k) % NA; if (!runs.length || runs[runs.length - 1].c !== L[i] || (cut[i] && runs[runs.length - 1].n >= NA / 360 * 1.2)) runs.push({ c: L[i], a0: start + k, n: 0, sep: runs.length > 0 && runs[runs.length - 1].c === L[i] }); runs[runs.length - 1].n++; }
    // slivers: a run under 2 degrees (or under 3 degrees in a color no real slice has) is the blended edge between
    // two slices. It is split between its neighbours.
    const bigColor = new Set(runs.filter(q => q.n >= NA / 360 * 2).map(q => q.c));
    for (let it = 0; it < 40; it++) {
      // (or under 3 degrees in a color that is a mix of its two neighbours: the blurred edge between them)
      const blend = k => { const q = runs[k], pc = keep[runs[(k - 1 + runs.length) % runs.length].c].c, nc = keep[runs[(k + 1) % runs.length].c].c, c = keep[q.c].c;
        const v = nc.map((x, i) => x - pc[i]), u = c.map((x, i) => x - pc[i]), vv = v.reduce((a, x) => a + x * x, 0) || 1, al = u.reduce((a, x, i) => a + x * v[i], 0) / vv;
        return al > 0.1 && al < 0.9 && Math.hypot(...u.map((x, i) => x - al * v[i])) < 25; };
      const tiny = runs.findIndex((q, k) => q.n < NA / 360 * 2 || (q.n < NA / 360 * 3 && !bigColor.has(q.c)) || (q.n < NA / 360 * 3 && runs.length > 2 && blend(k))); if (tiny < 0 || runs.length < 2) break;
      const prev = runs[(tiny - 1 + runs.length) % runs.length], next = runs[(tiny + 1) % runs.length], h = runs[tiny].n / 2;
      // a sliver sitting on a separator keeps the two slices apart even when they share a color
      { const T = runs[tiny]; for (let d = -3; d <= T.n + 3; d++) if (cut[((T.a0 + d) % NA + NA) % NA]) { next.sep = true; break; } }
      prev.n += Math.floor(h); next.n += Math.ceil(h); next.a0 -= Math.ceil(h); runs.splice(tiny, 1);
      for (let k = runs.length - 1; k > 0; k--) if (runs[k].c === runs[k - 1].c && !runs[k].sep) { runs[k - 1].n += runs[k].n; runs.splice(k, 1); }
    }
    // merge neighbours that ended up with the same color
    // a split that leaves a sliver under 4 degrees was not a real separator
    runs.forEach((q, k) => { const pv = runs[(k - 1 + runs.length) % runs.length]; if (q.sep && (q.n < NA / 360 * 4 || pv.n < NA / 360 * 4)) q.sep = false; });
    for (let k = runs.length - 1; k > 0; k--) if (runs[k].c === runs[k - 1].c && !runs[k].sep) { runs[k - 1].n += runs[k].n; runs.splice(k, 1); }
    const wrapCut = cut[start % NA] || cut[(start - 1 + NA) % NA] || cut[(start + 1) % NA];
    if (runs.length > 1 && runs[0].c === runs[runs.length - 1].c && !wrapCut && !runs[0].sep) { runs[0].n += runs[runs.length - 1].n; runs[0].a0 = runs[runs.length - 1].a0; runs.pop(); }
    if (opts.debug) console.log('DBG pie runs', runs.map(q => q.c + ':' + q.a0 + '+' + q.n + (q.sep ? 's' : '')).join(' '));
    if (runs.length < 2 && !opts.force) return null;
    // start the list with the slice whose edge is nearest 12 o'clock
    let z = 0, zd = 1e9; runs.forEach((q, i) => { const a = q.a0 % NA, d = Math.min(a, NA - a); if (d < zd) { zd = d; z = i; } });
    if (z > 0) runs = runs.slice(z).concat(runs.slice(0, z));
    const slices = runs.map(q => ({ color: hex(keep[q.c].c), deg0: (q.a0 % NA) / NA * 360, deg: q.n / NA * 360, share: q.n / NA * 100 }));
    // percent labels printed on or next to the slices, matched by angle
    const pctWords = words.map(w => ({ w, n: parseNumber(w.text) })).filter(q => q.n && q.n.pct);
    for (const q of pctWords) {
      const wx = (q.w.x0 + q.w.x1) / 2, wy = (q.w.y0 + q.w.y1) / 2, d = Math.hypot(wx - cx, wy - cy);
      if (d > r * 1.6) continue;
      let ang = Math.atan2(wy - cy, wx - cx) * 180 / Math.PI + 90; if (ang < 0) ang += 360;
      for (const s of slices) { let rel = ang - s.deg0; if (rel < 0) rel += 360; if (rel <= s.deg) { (s.all = s.all || []).push({ v: q.n.v, rel }); if (!s.label || Math.abs(q.n.v - s.share) < Math.abs(s.label - s.share)) s.label = q.n.v; } }
    }
    // two printed percentages inside one run of color: two slices in the same color with no line between them.
    // Split the run where the printed shares say.
    for (let k = slices.length - 1; k >= 0; k--) {
      const s = slices[k], L = (s.all || []).sort((a, b) => a.rel - b.rel);
      if (L.length < 2 || Math.abs(L.reduce((a, q) => a + q.v, 0) - s.share) > 2.5) continue;
      let d0 = s.deg0; const parts = L.map(q => { const p = { color: s.color, deg0: d0 % 360, deg: q.v * 3.6, share: q.v, label: q.v }; d0 += q.v * 3.6; return p; });
      parts[parts.length - 1].deg = s.deg0 + s.deg - parts[parts.length - 1].deg0 - (parts[parts.length - 1].deg0 < s.deg0 ? 360 : 0);
      slices.splice(k, 1, ...parts);
    }
    // printed percentages are exact when they agree with the angles and add up to about 100
    const labeled = slices.filter(s => s.label != null);
    let usedLabels = false;
    if (labeled.length === slices.length && Math.abs(slices.reduce((a, s) => a + s.label, 0) - 100) < 1.5 && slices.every(s => Math.abs(s.label - s.share) < 3)) {
      slices.forEach(s => { s.share = s.label; }); usedLabels = true;
    }
    // names: a legend swatch of the same color first (best matches first), else a text label sitting off the slice
    const names = joinWords(words.filter(w => (/[A-Za-z]/.test(w.text) || /^\d{4}$/.test(w.text)) && !(parseNumber(w.text) && parseNumber(w.text).pct) && w.conf > 40));
    const cand = [];
    for (const w of names) {
      const h = w.y1 - w.y0;
      slices.forEach((sl, k) => { const sc = unhex(sl.color); let hit = 0;
        for (let y = Math.round(w.y0); y < w.y1; y++) for (let x = Math.max(0, Math.round(w.x0 - h * 2.2)); x < w.x0 - 1; x++) { const i = (y * W + x) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], sc) < 30) hit++; }
        if (hit >= 6 && Math.hypot((w.x0 + w.x1) / 2 - cx, (w.y0 + w.y1) / 2 - cy) > r * 1.02) cand.push({ k, hit, w }); });
    }
    cand.sort((a, b) => b.hit - a.hit);
    // more legend entries than slices: two slices share a color and were read as one
    const legendN = new Set(cand.map(c => c.w)).size;
    const used = new Set();
    for (const c of cand) if (!slices[c.k].name && !used.has(c.w)) { slices[c.k].name = c.w.text; used.add(c.w); }
    if (used.size < 2) {
      // labels around the pie: each goes to the slice whose middle points at it, closest angles first
      const lc = [];
      for (const w of names) {
        if (used.has(w)) continue;
        const wx = (w.x0 + w.x1) / 2, wy = (w.y0 + w.y1) / 2, d = Math.hypot(wx - cx, wy - cy);
        if (d < r * 0.98 || d > r * 1.5) continue;
        let ang = Math.atan2(wy - cy, wx - cx) * 180 / Math.PI + 90; if (ang < 0) ang += 360;
        slices.forEach(sl => { const mid = sl.deg0 + sl.deg / 2, dd = Math.abs(((ang - mid + 540) % 360) - 180); if (dd < Math.max(20, sl.deg / 2 + 8)) lc.push({ sl, w, dd }); });
      }
      lc.sort((a, b) => a.dd - b.dd);
      const usedW = new Set();
      for (const c of lc) if (!c.sl.name && !usedW.has(c.w)) { c.sl.name = c.w.text; usedW.add(c.w); }
    }
    slices.forEach((s, k) => { if (!s.name) s.name = 'Slice ' + (k + 1); });
    const sepUnknown = lab.filter(v => v < 0).length / NA;
    return {
      ok: true, chartType: donut ? 'donut' : 'pie', rect: { left: Math.round(cx - r), right: Math.round(cx + r), top: Math.round(cy - r), bottom: Math.round(cy + r) },
      pie: { cx, cy, r, hole: donut ? hole : 0 },
      series: [{ type: 'pie', name: 'Share', color: slices[0].color, points: slices.map(s => ({ x: s.name, y: s.share, color: s.color, deg0: s.deg0, deg: s.deg,
        err: usedLabels ? [0.05, 0.05] : [Math.max(0.25, sepUnknown * 100 / slices.length), Math.max(0.25, sepUnknown * 100 / slices.length)] })) }],
      axis: { yLog: false, yPct: true, xNumeric: false, yRange: [0, 100], xRange: null, yRight: false, orient: 'v' },
      calib: { y: [], x: [] }, flags: [], notes: usedLabels ? ['Shares come from the printed percentages, which agree with the slice angles.'] : [],
      features: { ringCover, slices: slices.length, sepUnknown, usedLabels: usedLabels ? 1 : 0, pctLabels: labeled.length, legendExtra: Math.max(0, legendN - slices.length), tiny: slices.filter(s => s.share < 1).length },
    };
  }

  // ---------- the vertical reader ----------
  // Works on a chart whose values run up the y axis. Horizontal charts are flipped before they get here.
  // series from the mark model: each predicted series inside the plot becomes one owner id, colored by the median
  // of its pixels that stand clearly off the background. Returns false when the model found nothing usable.
  function segSeries(sg, D, W, rect, textMask, bg, minN, owner, series0, clusters) {
    const { left, right, top, bottom } = rect, by = new Map();
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = y * W + x, k = sg.inst[p]; if (k < 0 || textMask[p]) continue;
      let g = by.get(k); if (!g) by.set(k, g = []); g.push(p);
    }
    let S = [];
    for (const [k, ps] of by) {
      const far = ps.filter(p => cdist([D[p * 4], D[p * 4 + 1], D[p * 4 + 2]], bg) > 60), use = far.length >= Math.min(30, ps.length * 0.3) ? far : ps;
      const c = [0, 1, 2].map(j => median(use.filter((_, i) => i % Math.ceil(use.length / 4000) === 0).map(p => D[p * 4 + j])));
      S.push({ k, ps, c, n: ps.length });
    }
    S.sort((a, b) => b.n - a.n);
    // the soft rim of a bar or line can come out as a group of its own: a group that mostly hugs a bigger one joins it
    const lab = new Map(); S.forEach((s, i) => { for (const p of s.ps) lab.set(p, i); });
    for (let i = S.length - 1; i > 0; i--) {
      const touch = new Array(S.length).fill(0);
      for (const p of S[i].ps) for (const q of [p - 2, p + 2, p - 2 * W, p + 2 * W, p - 1, p + 1, p - W, p + W]) { const o = lab.get(q); if (o != null && o !== i) { touch[o]++; break; } }
      const best = touch.indexOf(Math.max(...touch));
      if (touch[best] > S[i].n * 0.5 && S[best].n > S[i].n) { for (const p of S[i].ps) { S[best].ps.push(p); lab.set(p, best); } S[best].n += S[i].n; S[i].n = 0; }
    }
    S = S.filter(s => s.n >= minN && cdist(s.c, bg) > 45);
    // gray straight lines (gridlines, axis lines) are not data when there are colored series
    const satOf = c => rgb2hsv(c[0], c[1], c[2])[1];
    if (S.some(s => satOf(s.c) > 0.25)) S = S.filter(s => {
      if (satOf(s.c) > 0.25) return true;
      const rows = new Map(), cols = new Map();
      for (const p of s.ps) { const y = Math.floor(p / W), x = p - y * W; rows.set(y, (rows.get(y) || 0) + 1); cols.set(x, (cols.get(x) || 0) + 1); }
      let line = 0; for (const p of s.ps) { const y = Math.floor(p / W), x = p - y * W; if (rows.get(y) > (right - left) * 0.5 || cols.get(x) > (bottom - top) * 0.6) line++; }
      return line < s.n * 0.6;
    });
    if (!S.length) return false;
    S.sort((a, b) => b.n - a.n);
    S.slice(0, 10).forEach((s, j) => { for (const p of s.ps) owner[p] = j; series0.push({ c: s.c, n: s.n, seg: true }); clusters.push({ c: s.c, n: s.n }); });
    return true;
  }

  // the color groups, checked against the model. Two groups of close colors that the model sees as one series
  // become one (a line and its anti-aliased rim, a band and its lighter edge). One color group that the model sees
  // as two clearly separate series of near the same color is split in two.
  function segRefine(sg, D, W, rect, minN, owner, series0) {
    const { left, right, top, bottom } = rect, K = series0.length;
    const hist = series0.map(() => new Map()), tot = new Array(K).fill(0);
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = y * W + x, o = owner[p], k = sg.inst[p]; if (o < 0) continue; tot[o]++; if (k < 0) continue;
      hist[o].set(k, (hist[o].get(k) || 0) + 1);
    }
    const top1 = h => { let bk = -1, bn = 0, n = 0; for (const [k, v] of h) { n += v; if (v > bn) { bn = v; bk = k; } } return { k: bk, share: n ? bn / n : 0, n }; };
    // join
    const into = series0.map((_, j) => j);
    for (let j = 0; j < K; j++) for (let i = 0; i < j; i++) {
      if (into[i] !== i) continue;
      const a = top1(hist[i]), b = top1(hist[j]);
      if (a.k < 0 || a.k !== b.k || a.share < 0.7 || b.share < 0.7 || a.n < tot[i] * 0.5 || b.n < tot[j] * 0.5) continue;
      if (cdist(series0[i].c, series0[j].c) > 90) continue;
      into[j] = i; break;
    }
    // split
    const extra = [];
    for (let j = 0; j < K; j++) {
      if (into[j] !== j) continue;
      const big = [...hist[j]].filter(([, v]) => v >= Math.max(minN, tot[j] * 0.3)).sort((a, b) => b[1] - a[1]);
      if (big.length < 2) continue;
      // two series of one color only touch where they cross. A part that hugs the main part along its length (the
      // edge line on top of its own fill, the rim of a marker) is the same series.
      const k0 = big[0][0];
      for (const [k, n] of big.slice(1)) {
        let touch = 0;
        for (let y = top + 2; y < bottom - 2; y++) for (let x = left + 2; x < right - 2; x++) { const p = y * W + x; if (owner[p] !== j || sg.inst[p] !== k) continue;
          for (const q of [p - 2, p + 2, p - 2 * W, p + 2 * W]) if (owner[q] === j && sg.inst[q] === k0) { touch++; break; } }
        if (touch < n * 0.15) extra.push({ from: j, k });
      }
    }
    if (!extra.length && into.every((v, j) => v === j)) return;
    const newId = new Map(); extra.forEach((e, n) => newId.set(e.from + ':' + e.k, K + n));
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = y * W + x, o = owner[p]; if (o < 0) continue;
      const nid = newId.get(o + ':' + sg.inst[p]);
      owner[p] = nid != null ? nid : into[o];
    }
    for (const e of extra) series0.push({ c: series0[e.from].c.slice(), n: 0, split: true });
    // renumber so the ids stay 0..n-1 in order
    const keep = series0.map((_, j) => j < K ? into[j] === j : true), map = []; let m = 0;
    series0.forEach((_, j) => { map[j] = keep[j] ? m++ : -1; });
    for (let p = 0; p < owner.length; p++) if (owner[p] >= 0) owner[p] = map[owner[p]];
    const kept = series0.filter((_, j) => keep[j]); series0.length = 0; series0.push(...kept);
    series0.forEach(s => { s.n = 0; });
    for (let p = 0; p < owner.length; p++) if (owner[p] >= 0) series0[owner[p]].n++;
  }

  function core(img, words, opts) {
    const W = img.width, H = img.height, D = img.data;
    const notes = [];
    const force = opts.type && opts.type !== 'auto' ? opts.type : null;
    const ax = findAxes(words, W, H);
    let yl, ycal;
    if (opts.calib && opts.calib.y && opts.calib.y.length >= 2) {
      // the axis set by hand: two (or more) clicked ticks with typed values
      yl = opts.calib.y.map(q => ({ p: q.p, v: q.v }));
      ycal = fitAxis(yl, { log: !!opts.calib.yLog });
      if (!ax.yCol) { const xs = opts.calib.y.map(q => q.x != null ? q.x : 0); ax.yCol = [{ x0: Math.max(0, Math.min(...xs) - 2), x1: Math.max(...xs), cy: yl[0].p, conf: 100, v: yl[0].v, pct: false, unit: '' }]; }
    } else {
      if (!ax.yCol) return { ok: false, code: 'no_axis', error: 'I could not find the numbers on the value axis.', words };
      // y calibration
      const euro = fixSeparators(ax.yCol);
      const pow10 = fixPowers(ax.yCol.map(q => Object.assign(q, { p: q.cy })));
      if (euro) notes.push('The axis uses a comma as the decimal point.');
      yl = ax.yCol.map(q => ({ p: q.cy, v: q.v, w: q }));
      const bgL = lumAt(D, W, Math.min(W - 1, Math.round(ax.yCol[0].x1 + 2)), Math.round(ax.yCol[0].cy));
      if (!pow10) yl = fixMissingMinus(yl, q => q.w && minusLeftOf(D, W, H, q.w, bgL));
      // OCR often drops the decimal point ("1.5" read as "15"). If some labels do not fit the scale, try the labels
      // with no point in them divided by 10; keep that when more labels then line up.
      if (!pow10) {
        const f0 = fitAxis(yl);
        if (f0 && f0.inliers < f0.total) {
          const off = (f, q) => Math.abs(f.toPixel(q.v) - q.p) > 3, noPt = q => !/[.,]/.test(String(q.w && q.w.text));
          const fits = (f, base) => f && f.inliers > base.inliers && f.rsdPx < 2;
          // (a) every label without a point divided by 10, if a label that kept its point ("0.5", "05") disagreed
          //     before and agrees after
          const altA = yl.map(q => noPt(q) && Math.abs(q.v) >= 10 ? { ...q, v: q.v / 10 } : q), fA = fitAxis(altA);
          const proofA = fA && yl.some((q, k) => /\.|^0\d/.test(String(q.w && q.w.text)) && off(f0, q) && !off(fA, altA[k]));
          // (b) only the labels that agreed divided by 10, when the ones that disagreed carry a unit ("35M" read for
          //     3.5M next to "500K"): then everything lines up
          const altB = yl.map(q => noPt(q) && !off(f0, q) && q.v !== 0 ? { ...q, v: q.v / 10 } : q), fB = fitAxis(altB);
          const proofB = fB && fB.inliers === fB.total && fB.total >= 4 && yl.filter(q => off(f0, q)).every(q => /\d\s*[KkMBb%][-\u2013_|]*$/.test(String(q.w && q.w.text)));
          const pick = proofA && fits(fA, f0) ? altA : proofB && fits(fB, f0) ? altB : null;
          if (pick) { yl = pick; notes.push('Some axis labels lost their decimal point when read; I put it back.'); }
        }
      }
      if (opts.snap !== false) {
        const raw = fitAxis(yl, pow10 ? { log: true } : {});
        const rawIn = raw ? yl.filter(q => raw.used.includes(q.p)) : [];
        const xr = Math.max(...(rawIn.length >= 2 ? rawIn.map(q => q.w) : ax.yCol).map(q => q.x1));
        const snapped = yl.map(q => ({ ...q, p: snapY(D, W, H, q, xr + 1, xr + Math.max(10, (q.w.y1 - q.w.y0) * 2.5)) }));
        const fs = fitAxis(snapped, pow10 ? { log: true } : {});
        // keep the snapped version only if the labels line up at least as well
        if (fs && (!raw || fs.inliers >= raw.inliers)) yl = snapped;
      }
      ycal = fitAxis(yl, pow10 ? { log: true } : {});
    }
    if (!ycal) return { ok: false, code: 'axis_fit', error: 'The value axis labels did not line up into a scale.', words };
    if (opts.debug) console.log('DBG ycal', yl.map(q => q.v + '@' + q.p.toFixed(1) + (q.w ? '/' + ((q.w.y0 + q.w.y1) / 2).toFixed(1) : '') + ' r' + (ycal.toPixel(q.v) - q.p).toFixed(2)).join(' '), 'rsdPx', ycal.rsdPx.toFixed(2));
    const yPct = ax.yCol.filter(q => q.pct).length > ax.yCol.length / 2;
    const yUnit = median(ax.yCol.map(q => q.unit ? 1 : 0)) ? (ax.yCol.find(q => q.unit) || {}).unit : '';
    // labels that fit the scale; a stray word caught in the label column must not move the plot edges
    const ylIn = yl.filter(q => isFinite(q.p) && Math.abs(ycal.toPixel(q.v) - q.p) <= 3);
    const yColIn = ylIn.length >= 2 && ylIn.every(q => q.w) ? ylIn.map(q => q.w) : ax.yCol;
    // (the top and bottom still follow every label: a misread label is usually still a real tick)
    const yTicks = yl.map(q => q.p).filter(isFinite).sort((a, b) => a - b);
    const ySpacing = median(yTicks.slice(1).map((p, i) => p - yTicks[i])) || H * 0.1;

    // x calibration: numeric, dates or categories
    let xcal = null, xCats = null, xLabels = null, xNumeric = false, xDate = null, xSpacing = W * 0.1, xTick = 1, xAnchor = null;
    if (opts.xWords) ax.xRow = opts.xWords.length ? opts.xWords : null;
    if (opts.calib && opts.calib.x && opts.calib.x.length >= 2) {
      xcal = fitAxis(opts.calib.x, { log: !!opts.calib.xLog }); xNumeric = !!xcal;
      if (xNumeric) { const vs = opts.calib.x.map(q => q.v).sort((a, b) => a - b); xTick = Math.abs(vs[1] - vs[0]) || 1; }
    } else if (ax.xRow) {
      const xr = [...ax.xRow].sort((a, b) => a.cx - b.cx);
      const numeric = xr.filter(q => q.n && !/^[A-Za-z]/.test(q.text));
      const dates = opts.noDates ? null : parseDateRow(xr.map(q => q.text));
      if (dates && !(numeric.length >= xr.length * 0.9 && !dates.days.some((d, i) => d != null && !xr[i].n))) {
        const dp = xr.map((q, i) => ({ p: q.cx, v: dates.days[i], q })).filter(q => q.v != null);
        const snapped = dp.map(q => ({ p: opts.snap === false ? q.p : snapX(D, W, H, q.q, q.q.y0 - Math.max(8, (q.q.y1 - q.q.y0) * 1.6), q.q.y0 - 2), v: q.v }));
        const f1 = fitAxis(snapped, { log: false }), f0 = fitAxis(dp, { log: false });
        xcal = f1 && (!f0 || f1.inliers >= f0.inliers) ? f1 : f0;
        // month labels sit at the first of the month, so the step between them is uneven in days: allow 4% slack
        if (xcal && xcal.inliers >= Math.max(2, dp.length * 0.6)) { xNumeric = true; xDate = { noYear: dates.noYear }; xTick = 1; }
        else xcal = null;
      }
      if (!xNumeric && numeric.length >= Math.max(2, xr.length * 0.7)) {
        // OCR drops minus signs on x labels too (-4 -3 ... read as 4 3 ...): same fix as the y axis, mirrored
        const fixed = fixMissingMinus(numeric.map((q, k) => ({ p: -q.cx, v: q.n.v, k })));
        if (fixed.some(q => q.v !== numeric[q.k].n.v)) fixed.forEach(q => { numeric[q.k].n = Object.assign({}, numeric[q.k].n, { v: q.v }); });
        const xp = numeric.map(q => ({ p: opts.snap === false ? q.cx : snapX(D, W, H, q, q.y0 - Math.max(8, (q.y1 - q.y0) * 1.6), q.y0 - 2), v: q.n.v }));
        xcal = fitAxis(xp);
        const rawP = numeric.map(q => ({ p: q.cx, v: q.n.v }));
        const raw = fitAxis(rawP);
        if (!xcal || (raw && (raw.inliers > xcal.inliers || pxResid(raw, rawP) < pxResid(xcal, xp) - 0.05))) xcal = raw; else numeric.forEach((q, i) => { q.cx = xp[i].p; });
        // most labels must agree, and a reversed x axis (rare) needs clear support
        if (xcal && xcal.inliers >= Math.max(2, Math.min(4, Math.ceil(numeric.length * 0.5))) && (xcal.slope > 0 || xcal.inliers >= 4)) xNumeric = true; else xcal = null;
        if (xNumeric) {
          // the value step between neighbouring tick labels (ignore labels that do not fit the scale)
          const ok = numeric.filter(q => Math.abs(xcal.toPixel(q.n.v) - q.cx) < 6).map(q => q.n.v).sort((a, b) => a - b);
          const d = ok.slice(1).map((v, i) => v - ok[i]).filter(v => v > 1e-9);
          xTick = d.length ? Math.min(...d.filter(v => v <= median(d) * 1.01)) : Math.abs(xcal.toValue(xSpacing) - xcal.toValue(0));
          xAnchor = ok.length ? ok[0] : null;
          if (xcal.log) xTick = null;
        }
      }
      // the labels themselves, kept even on a number or date axis: bars take the label they stand on
      xCats = xr.map(q => ({ label: q.text.replace(/[^\w\s.\-%/&'$€£]/g, ''), cx: q.cx, n: q.n }));
      if (xNumeric) xLabels = xCats, xCats = null;
      const xs = xr.map(q => q.cx); xSpacing = median(xs.slice(1).map((p, i) => p - xs[i])) || xSpacing;
    }

    // plot area
    const yOnRight = yColIn.length && Math.min(...yColIn.map(q => q.x0)) > W * 0.5;
    const yLabRight = Math.max(...yColIn.map(q => q.x1));
    let left = yOnRight ? 2 : Math.round(yLabRight + 3);
    let right = Math.round(yOnRight ? Math.min(...yColIn.map(q => q.x0)) - 3 : ax.yRight ? Math.min(...ax.yRight.map(q => q.x0)) - 3 : W - 1);
    // gridlines and the x axis line end where the plot ends: a legend or note to the right of them is not data
    if (!yOnRight && !opts.rect) { const e = lineEnd(D, W, H, yl.map(q => q.p), left);
      // ...unless a bar or area carries on across that edge (gridlines that break off over a bar)
      const yA = Math.round(Math.min(...yl.map(q => q.p))), yB = Math.round(Math.max(...yl.map(q => q.p)));
      const across = e ? [3, 5, 7].every(d => { const x = Math.round(e) + d; if (x >= W) return false; let n = 0; for (let y = yA; y <= yB; y++) { const i = (y * W + x) * 4; if (rgb2hsv(D[i], D[i + 1], D[i + 2])[1] > 0.3) n++; } return n > (yB - yA) * 0.1; }) : false;
      if (e && e > left + 40 && e < right && !across) right = Math.min(right, Math.round(e + 2)); }
    if (opts.rect) { left = opts.rect.left; right = opts.rect.right; }
    // a top label that did not read as a number ("aM" for 4M) still marks a tick: the plot goes up to it too
    const hLab0 = median(yColIn.map(q => q.y1 - q.y0)) || 10;
    const above = words.filter(w => Math.abs(w.x1 - yLabRight) < hLab0 * 1.2 && (w.y1 - w.y0) < hLab0 * 1.6 && (w.y0 + w.y1) / 2 < yTicks[0] - ySpacing * 0.5 && (w.y0 + w.y1) / 2 > yTicks[0] - ySpacing * 1.5);
    const topTick = above.length ? Math.min(yTicks[0], ...above.map(w => (w.y0 + w.y1) / 2)) : yTicks[0];
    const top = Math.round(opts.rect ? opts.rect.top : clamp(topTick - ySpacing * 0.9, 0, H));
    const xTop = ax.xRow ? Math.min(...ax.xRow.map(q => q.y0)) : H;
    // down to the x labels (the lowest y label can be missing), but not far past the last tick
    const lastT = yTicks[yTicks.length - 1];
    let bottom = Math.round(opts.rect ? opts.rect.bottom : clamp(ax.xRow && xTop > lastT ? Math.min(xTop - 2, lastT + ySpacing * 1.6) : Math.min(xTop - 2, lastT + ySpacing * 0.9), 0, H - 1));
    // the x axis line, when there is one under the last tick, is the bottom of the plot: the x labels below it are not data
    let bottomA = bottom;
    if (!opts.rect) {
      const bgc = [D[(Math.round(yTicks[0]) * W + Math.round((left + right) / 2)) * 4], D[(Math.round(yTicks[0]) * W + Math.round((left + right) / 2)) * 4 + 1], D[(Math.round(yTicks[0]) * W + Math.round((left + right) / 2)) * 4 + 2]];
      // (the lowest such line: gridlines above it are inside the plot)
      for (let y = bottom - 1; y >= Math.max(0, Math.round(lastT) - 2); y--) {
        let n = 0; for (let x = left; x < right; x++) { const i = (y * W + x) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], bgc) > 40) n++; }
        if (n > (right - left) * 0.85) { if (bottom > y + 3) bottomA = y + 1; break; }
      }
    }
    bottom = bottomA;
    const rect = { left, right, top, bottom };
    if (right - left < 20 || bottom - top < 20) return { ok: false, code: 'no_plot', error: 'The plot area between the axes is too small to read.', words };

    // mask out text inside the plot (title, legend labels, annotations), and the legend swatches beside them
    const textMask = new Uint8Array(W * H);
    const axisWords = new Set([...(ax.xRow || []), ...(ax.yCol || []), ...(ax.yRight || [])].map(q => q.text + '@' + Math.round(q.x0) + ',' + Math.round(q.y0)));
    const legendish = w => isWord(w.text) || (/^(19|20)\d\d$/.test(w.text) && !axisWords.has(w.text + '@' + Math.round(w.x0) + ',' + Math.round(w.y0)));
    // words on one line join first, so a shaky word next to a clear one ("0an" + "rate") still counts as legend text
    // (words of a chart turned on its side were already joined the right way round)
    const lettered = words.filter(w => w.conf > 35 && /[A-Za-z]/.test(w.text) && !/^[|lI!]$/.test(w.text));
    const phrases = lettered.some(w => w.flipped) ? lettered.map(w => ({ ...w })) : joinWords(lettered);
    // a "word" whose ink is mostly one saturated color is a piece of a data line read as letters ("AN"), not text
    const bg0 = plotBackground(D, W, rect);
    const lineBits = w => { let ink = 0, col = 0; for (let y = Math.max(0, Math.floor(w.y0)); y < Math.min(H, Math.ceil(w.y1)); y++) for (let x = Math.max(0, Math.floor(w.x0)); x < Math.min(W, Math.ceil(w.x1)); x++) { const i = (y * W + x) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], bg0) < 60) continue; ink++; if (rgb2hsv(D[i], D[i + 1], D[i + 2])[1] > 0.35) col++; } return ink > 10 && col > ink * 0.45; };
    let inside = phrases.concat(words.filter(w => /^(19|20)\d\d$/.test(w.text))).filter(w => w.conf > 55 && legendish(w) &&
      w.x0 > left - 2 && w.x1 < right + 2 && w.y0 > top - 2 && w.y1 < bottom + 2 && !lineBits(w));
    // join words on the same line into phrases ("In" + "store")
    inside.sort((a, b) => a.x0 - b.x0);
    for (let i = 0; i < inside.length; i++) for (let j = i + 1; j < inside.length; j++) {
      if (inside[i].flipped || inside[j].flipped) continue;
      const a = inside[i], b = inside[j], h = Math.max(a.y1 - a.y0, b.y1 - b.y0);
      if (Math.abs((a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2) < h * 0.4 && b.x0 - a.x1 > -2 && b.x0 - a.x1 < h * 0.9) {
        inside[i] = { ...a, text: a.text + ' ' + b.text, x1: b.x1, y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) }; inside.splice(j, 1); j = i;
      }
    }
    // legend labels have their color swatch on the left (below, for words of a chart turned on its side)
    const hRef = median(words.map(w => w.flipped ? w.x1 - w.x0 : w.y1 - w.y0).filter(v => v > 3)) || 12;
    const swatchBox = w => {
      if (w.flipped) { const h = w.x1 - w.x0, ext = Math.max(h, hRef) * 4.5;
        return { x0: Math.max(0, Math.floor(w.x0 - h * 0.35)), x1: Math.min(W, Math.ceil(w.x1 + h * 0.35)), y0: Math.max(0, Math.floor(w.y0 - h * 0.3)), y1: Math.min(H, Math.ceil(w.y1 + ext)),
          sx0: Math.max(0, Math.floor(w.x0)), sx1: Math.min(W, Math.ceil(w.x1)), sy0: Math.ceil(w.y1), sy1: Math.min(H, Math.ceil(w.y1 + ext)) }; }
      const h = w.y1 - w.y0, ext = Math.max(h, hRef) * 4.5;
      return { x0: Math.max(0, Math.floor(w.x0 - ext)), x1: Math.min(W, Math.ceil(w.x1 + h * 0.3)), y0: Math.max(0, Math.floor(w.y0 - h * 0.35)), y1: Math.min(H, Math.ceil(w.y1 + h * 0.35)),
        sx0: Math.max(0, Math.floor(w.x0 - ext)), sx1: Math.floor(w.x0), sy0: Math.max(0, Math.floor(w.y0 - h * 0.35)), sy1: Math.min(H, Math.ceil(w.y1 + h * 0.35)) };
    };
    const legendWords = [];
    for (const w of inside) {
      const b = swatchBox(w);
      for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) textMask[y * W + x] = 1;
      legendWords.push(Object.assign({ w }, b));
    }
    // number labels printed on top of bars or points would read as ink, so mask them too
    // (only label-sized ones: bits of a sloped line read as "1" or "4" are tiny and must stay ink)
    const hLab = median(ax.yCol.map(q => q.y1 - q.y0).filter(v => v > 2)) || 8;
    for (const w of words) {
      if (w.x0 > left - 2 && w.x1 < right + 2 && w.y0 > top + 2 && w.y1 < bottom - 2 && parseNumber(w.text) && w.conf > 60 && (w.y1 - w.y0) >= hLab * 0.6 && !lineBits(w))
        for (let y = Math.max(0, Math.floor(w.y0)); y < Math.min(H, Math.ceil(w.y1)); y++) for (let x = Math.max(0, Math.floor(w.x0)); x < Math.min(W, Math.ceil(w.x1)); x++) textMask[y * W + x] = 2;
    }
    // words outside the plot that name things (legend above or beside the plot)
    const outsideWords = words.filter(w => w.conf > 55 && legendish(w) && !(w.x0 > left - 2 && w.x1 < right + 2 && w.y0 > top - 2 && w.y1 < bottom + 2));

    const bg = plotBackground(D, W, rect);
    const bgDark = bg[0] + bg[1] + bg[2] < 300;

    // colored ink: anything with real saturation that is clearly not the background
    const N = W * H, sat = new Float32Array(N), ink = new Uint8Array(N);
    let mono = false, inkCount = 0;
    const clusters = [], series0 = [], owner = new Int8Array(N).fill(-1);
    const minN = Math.max(15, (right - left) * 0.06);
    // the mark model, when it ran: one mask per series straight from it, and the color rules below are skipped
    const segUse = opts.seg && opts.seg.width === W && opts.seg.height === H && opts.useSeg !== false ? opts.seg : null;
    // opts.segMode 'full' takes the series straight from the model; the default keeps the color rules and lets the
    // model join or split their groups (segRefine, below)
    const fromSeg = !!segUse && opts.segMode === 'full' && segSeries(segUse, D, W, rect, textMask, bg, minN, owner, series0, clusters);
    if (!fromSeg) {
    const b0 = bg[0], b1 = bg[1], b2 = bg[2];
    for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
      const p = y * W + x, i = p * 4; if (textMask[p]) continue;
      // what the model calls text or a legend swatch is not series ink (opts.segClean). Its gridline class is left
      // alone: a flat run of a step line looks just like one, and gray gridlines are dropped by color anyway.
      if (segUse && segUse.cls && opts.segClean !== false && (segUse.cls[p] === 2 || segUse.cls[p] === 4)) continue;
      const r = D[i], g = D[i + 1], b = D[i + 2];
      if ((r - b0) * (r - b0) + (g - b1) * (g - b1) + (b - b2) * (b - b2) < 1600) continue;
      const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), s = mx ? (mx - mn) / mx : 0;
      sat[p] = s;
      if (s > 0.28 && mx > 45.9) { ink[p] = 1; inkCount++; }
    }
    // no colored ink at all: the series is black or gray. Use dark pixels, minus the long straight gridlines and spines.
    if (inkCount < 30) {
      mono = true;
      const dark = new Uint8Array(N);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x, i = p * 4; if (textMask[p]) continue; if (cdist([D[i], D[i + 1], D[i + 2]], bg) > 90) dark[p] = 1; }
      const rw = right - left, rh = bottom - top;
      // a gridline or spine is long and thin: the rows a few pixels away are mostly empty where it is dark.
      // (dark bars also make long dark rows, but they are just as dark 3 pixels up and down)
      const thinRow = y => { let n = 0, thick = 0; for (let x = left; x < right; x++) { const p = y * W + x; if (!dark[p]) continue; n++; if ((y - 3 >= top && dark[p - 3 * W]) && (y + 3 < bottom && dark[p + 3 * W])) thick++; } return n > rw * 0.5 && thick < n * 0.5; };
      const thinCol = x => { let n = 0, thick = 0; for (let y = top; y < bottom; y++) { const p = y * W + x; if (!dark[p]) continue; n++; if ((x - 3 >= left && dark[p - 3]) && (x + 3 < right && dark[p + 3])) thick++; } return n > rh * 0.6 && thick < n * 0.5; };
      const rows = [], cols = [];
      for (let y = top; y < bottom; y++) if (thinRow(y)) rows.push(y);
      for (let x = left; x < right; x++) if (thinCol(x)) cols.push(x);
      for (const y of rows) for (let x = left; x < right; x++) dark[y * W + x] = 0;
      for (const x of cols) for (let y = top; y < bottom; y++) dark[y * W + x] = 0;
      for (let p = 0; p < N; p++) if (dark[p]) { ink[p] = 1; inkCount++; }
    }

    // cluster ink colors into series
    const bins = new Map();
    // pale colors (pastel bars on a dark background) only count when nothing more saturated is there
    // saturated pixels first; paler ones (pastel series) join only where they are not the edge of a saturated color
    for (let p = 0; p < N; p++) if (ink[p] && (mono || sat[p] > 0.38)) {
      const i = p * 4, k = (D[i] >> 4) << 8 | (D[i + 1] >> 4) << 4 | (D[i + 2] >> 4);
      const b = bins.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += D[i]; b.g += D[i + 1]; b.b += D[i + 2]; bins.set(k, b);
    }
    if (!mono) {
      const strong = [...bins.values()].filter(b => b.n > 20).map(b => [b.r / b.n, b.g / b.n, b.b / b.n]);
      const pale = new Map();
      for (let p = 0; p < N; p++) if (ink[p] && sat[p] > 0.25 && sat[p] <= 0.38) {
        const i = p * 4, c = [D[i], D[i + 1], D[i + 2]];
        if (strong.some(q => cdist(q, c) < 70 && hueGap(q, c) < 20)) continue;
        const k = (D[i] >> 4) << 8 | (D[i + 1] >> 4) << 4 | (D[i + 2] >> 4);
        const b = pale.get(k) || { n: 0, r: 0, g: 0, b: 0 }; b.n++; b.r += D[i]; b.g += D[i + 1]; b.b += D[i + 2]; pale.set(k, b);
      }
      for (const [k, b] of pale) if (b.n > 20) { const o = bins.get(k); if (o) { o.n += b.n; o.r += b.r; o.g += b.g; o.b += b.b; } else bins.set(k, b); }
    }
    const binList = [...bins.values()].map(b => ({ n: b.n, c: [b.r / b.n, b.g / b.n, b.b / b.n] })).sort((a, b) => b.n - a.n);
    const mergeD = opts.mergeDist || 70;
    for (const b of binList) {
      // close in color, and not two different hues (Chart.js blue and teal are only 56 apart in RGB)
      const near = clusters.find(c => cdist(c.c, b.c) < mergeD && (mono || hueGap(c.c, b.c) < (opts.hueGap || 14)));
      if (near) { const t = near.n + b.n; near.c = near.c.map((v, j) => (v * near.n + b.c[j] * b.n) / t); near.n = t; }
      else clusters.push({ c: b.c, n: b.n });
    }
    // a cluster barely different from the background is noise or a shade of it (a dark theme's noise)
    const bgSat = rgb2hsv(bg[0], bg[1], bg[2])[1];
    const nearBg = c => cdist(c.c, bg) <= 45 || (bgSat > 0.2 && hueGap(c.c, bg) < 15 && cdist(c.c, bg) < 75);
    series0.push(...clusters.filter(c => c.n >= minN && !nearBg(c)).slice(0, 10));
    if (!series0.length) return { ok: false, code: 'no_marks', error: 'I found the axes but no data marks inside them.', rect, words };
    // gray bars or areas next to colored ones (Excel's third color is gray): solid blocks of unsaturated ink
    let gray = null;
    if (!mono) {
      const gm = new Uint8Array(N);
      for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x, i = p * 4; if (textMask[p] || ink[p]) continue;
        const r = D[i], g = D[i + 1], b = D[i + 2];
        if ((r - b0) * (r - b0) + (g - b1) * (g - b1) + (b - b2) * (b - b2) > 3600) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (!mx || (mx - mn) / mx < 0.2) gm[p] = 1; } }
      // gridlines are gray too: keep only pixels in a vertical run of three or more, so thin horizontal lines do not
      // join every gray bar into one big low fill shape
      const gm2 = new Uint8Array(N);
      for (let y = top + 2; y < bottom - 2; y++) for (let x = left; x < right; x++) { const p = y * W + x; if (gm[p] && ((gm[p - W] && gm[p + W]) || (gm[p - W] && gm[p - 2 * W]) || (gm[p + W] && gm[p + 2 * W]))) gm2[p] = 1; }
      const { comps: gc, lab: gl } = components(gm2, W, H, left, top, right, bottom);
      // (gray bars reach down past the top tick; a gray title or band above the plot does not)
      let solid = gc.filter(c => c.fill > 0.85 && c.w >= 5 && c.h >= 5 && c.n >= 60 && c.ya > top + 1 && c.yb > yTicks[0] + 2);
      const tot = solid.reduce((a, c) => a + c.n, 0);
      if (solid.length && tot >= minN * 3) {
        const ids = new Set(solid.map(c => c.id)); let r = 0, g2 = 0, b2 = 0, n = 0;
        for (let p = 0; p < N; p++) if (ids.has(gl[p])) { const i = p * 4; r += D[i]; g2 += D[i + 1]; b2 += D[i + 2]; n++; }
        gray = { c: [r / n, g2 / n, b2 / n], n, ids, lab: gl };
      }
    }
    const hsvOf = c => rgb2hsv(c[0], c[1], c[2]);
    // assign every ink pixel (including faint anti-aliased edges) to the nearest series by hue
    const sH = series0.map(s => hsvOf(s.c));
    // colors repeat a lot, so the answer is cached per color
    const ownCache = new Map();
    for (let p = 0; p < N; p++) if (ink[p]) {
      const i = p * 4, key = (D[i] << 16) | (D[i + 1] << 8) | D[i + 2];
      let o = ownCache.get(key);
      if (o === undefined) {
        const h = rgb2hsv(D[i], D[i + 1], D[i + 2]);
        let bi = -1, bd = 1e9;
        for (let j = 0; j < series0.length; j++) {
          const sh = sH[j]; let d;
          if (mono) d = cdist([D[i], D[i + 1], D[i + 2]], series0[j].c);
          else { const dh = Math.min(Math.abs(h[0] - sh[0]), 360 - Math.abs(h[0] - sh[0])); d = dh * 2 + Math.abs(h[2] - sh[2]) * 60 + (h[1] < .45 ? 20 : 0); }
          if (d < bd) { bd = d; bi = j; }
        }
        o = bd < (mono ? 120 : 70) ? bi : -1; ownCache.set(key, o);
      }
      owner[p] = o;
    }

    // anti-aliased edges of a line can form their own lighter cluster. If a cluster has the same hue as a bigger
    // one and most of its pixels touch that one, it is a fringe, not a series.
    for (let j = series0.length - 1; j > 0; j--) {
      const hj = hsvOf(series0[j].c);
      for (let k = 0; k < j; k++) {
        const hk = hsvOf(series0[k].c), dh = Math.min(Math.abs(hj[0] - hk[0]), 360 - Math.abs(hj[0] - hk[0]));
        // or a mix of that color and the background (the soft edge of a line on a dark theme shifts its hue)
        const v = series0[k].c.map((c, i) => c - bg[i]), u = series0[j].c.map((c, i) => c - bg[i]), vv = v.reduce((a, x) => a + x * x, 0) || 1;
        const al = u.reduce((a, x, i) => a + x * v[i], 0) / vv, res = Math.hypot(...u.map((x, i) => x - al * v[i]));
        const blend = al > 0.1 && al < 0.9 && res < 22;
        if (dh > 18 && !mono && !blend) continue;
        let tot = 0, touch = 0;
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x; if (owner[p] === j) { tot++; if (owner[p - 1] === k || owner[p + 1] === k || owner[p - W] === k || owner[p + W] === k || owner[p - 2] === k || owner[p + 2] === k || owner[p - 2 * W] === k || owner[p + 2 * W] === k) touch++; } }
        if (tot && touch / tot > 0.5) { for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x; if (owner[p] === j) owner[p] = k; else if (owner[p] > j) owner[p]--; } series0.splice(j, 1); sH.splice(j, 1); break; }
      }
    }

    // small clusters that live on the border between two big ones are blends of their colors (anti-aliasing,
    // a transparent fill over another band), not series of their own
    const maxN = Math.max(...series0.map(c => c.n));
    for (let j = series0.length - 1; j >= 0 && series0.length > 1; j--) {
      if (series0[j].n > maxN * 0.05) continue;
      const touchN = new Array(series0.length).fill(0); let tot = 0;
      for (let y = top + 2; y < bottom - 2; y++) for (let x = left + 2; x < right - 2; x++) {
        const p = y * W + x; if (owner[p] !== j) continue; tot++;
        for (const q of [p - 2, p + 2, p - 2 * W, p + 2 * W]) { const o = owner[q]; if (o >= 0 && o !== j) { touchN[o]++; break; } }
      }
      const best = touchN.indexOf(Math.max(...touchN)), hit = touchN.reduce((a, b) => a + b, 0);
      if (tot && hit / tot > 0.6 && best !== j) {
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) { const p = y * W + x; if (owner[p] === j) owner[p] = best > j ? best - 1 : best; else if (owner[p] > j) owner[p]--; }
        series0[best].n += series0[j].n; series0.splice(j, 1); sH.splice(j, 1);
      }
    }
    if (gray && series0.length < 10) {
      const gi = series0.length; series0.push({ c: gray.c, n: gray.n, gray: true });
      for (let p = 0; p < N; p++) if (gray.ids.has(gray.lab[p])) owner[p] = gi;
    }
    if (segUse && opts.segRefine !== false) segRefine(segUse, D, W, rect, minN, owner, series0);
    }
    // pixel <-> value helpers
    const Y = p => ycal.toValue(p);
    const X = p => xNumeric ? xcal.toValue(p) : p;
    const y0px = ycal.log ? null : ycal.toPixel(0);
    const baseLine = y0px != null && y0px > top - 2 && y0px < bottom + 2 ? y0px : (y0px != null && y0px >= bottom + 2 ? bottom : null);

    const masked = [];
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (textMask[y * W + x]) masked.push(y * W + x);
    // ---- look at every series' marks first, so stacked bars can be seen across colors ----
    const info = series0.map((s, j) => {
      const mask = new Uint8Array(N); let cnt = 0;
      for (let p = 0; p < N; p++) if (owner[p] === j) { mask[p] = 1; cnt++; }
      // gridlines drawn over bars cut them into pieces: close gaps of up to 2 pixels between pixels of the same series
      for (let x = left; x <= right; x++) { let last = -9; for (let y = top; y <= bottom; y++) { if (!mask[y * W + x]) continue; if (y - last > 1 && y - last <= 3) for (let k = last + 1; k < y; k++) { mask[k * W + x] = 1; cnt++; } last = y; } }
      // text or a legend drawn over a bar leaves a hole in it: fill masked pixels with this series on all four sides
      for (const p of masked) {
        if (mask[p]) continue;
        const x = p % W, y = (p / W) | 0;
        let a = x - 1; while (a > left && textMask[y * W + a]) a--;
        let b = x + 1; while (b < right && textMask[y * W + b]) b++;
        let fill = mask[y * W + a] && mask[y * W + b];
        if (fill) { let c = y - 1; while (c > top && textMask[c * W + x]) c--; let d = y + 1; while (d < bottom && textMask[d * W + x]) d++; fill = mask[c * W + x] && mask[d * W + x]; }
        if (fill) { mask[p] = 1; cnt++; }
      }
      // on a chart turned on its side the gridlines run the other way
      if (opts.flipped) for (let y = top; y <= bottom; y++) { let last = -9; for (let x = left; x <= right; x++) { if (!mask[y * W + x]) continue; if (x - last > 1 && x - last <= 3) for (let k = last + 1; k < x; k++) { mask[y * W + k] = 1; cnt++; } last = x; } }
      const { comps, lab } = components(mask, W, H, left, top, right + 1, bottom + 1);
      let big = comps.filter(c => c.n >= 6);
      // a line of another series (or a label) crossing a bar cuts it in two: join pieces that line up above each other
      // when the rows between them are someone else's ink
      const pieces = big.filter(c => c.fill > 0.6 && c.w >= 4).sort((a, b) => a.ya - b.ya);
      for (let a = 0; a < pieces.length; a++) for (let b = a + 1; b < pieces.length; b++) {
        const A = pieces[a], B = pieces[b];
        if (!A || !B) continue;
        // the lower piece can be wider when a legend swatch of the same color touches it
        const same = Math.abs(A.xa - B.xa) <= 2 && Math.abs(A.xb - B.xb) <= 2;
        if (!same && !(B.xa <= A.xa + 2 && B.xb >= A.xb - 2 && B.fill < 0.85)) continue;
        if (B.ya - A.yb > 40 || B.yb <= A.yb) continue;
        // column by column: from the last pixel of the upper piece to the first of the lower one
        let other = 0, tot = 0, bad = 0, txt = 0;
        for (let x = Math.max(A.xa, B.xa) + 1; x < Math.min(A.xb, B.xb); x++) {
          let ya = -1, yb = -1;
          for (let y = A.ya; y <= B.yb; y++) { const l = lab[y * W + x]; if (l === A.id) ya = y; else if (l === B.id && ya >= 0) { yb = y; break; } }
          if (ya < 0 || yb < 0) { bad++; continue; }
          if (yb - ya - 1 > 40) { bad++; continue; }
          for (let y = ya + 1; y < yb; y++) { const p = y * W + x; tot++; if (textMask[p]) txt++; if ((owner[p] >= 0 && owner[p] !== j) || textMask[p]) other++; }
        }
        // a wide gap only when a legend or label (masked text) fills it
        const gapMax = txt > tot * 0.8 ? 40 : 14;
        if (bad > (A.w * 0.1) || !tot || other < tot * 0.6 || tot / Math.max(1, Math.min(A.xb, B.xb) - Math.max(A.xa, B.xa) - 1) > gapMax) continue;
        const g0 = Math.min(A.yb, B.ya), g1 = Math.max(A.yb, B.ya);
        const n = A.n + B.n + other;
        Object.assign(A, { yb: B.yb, xa: same ? Math.min(A.xa, B.xa) : A.xa, xb: same ? Math.max(A.xb, B.xb) : A.xb, n, sx: A.sx + B.sx, sy: A.sy + B.sy, joined: true });
        A.w = A.xb - A.xa + 1; A.h = A.yb - A.ya + 1; A.fill = Math.min(1, A.n / (A.w * A.h)); A.cx = (A.xa + A.xb) / 2; A.cy = (A.ya + A.yb) / 2;
        for (let y = g0; y <= g1; y++) for (let x = A.xa; x <= A.xb; x++) if (!lab[y * W + x]) lab[y * W + x] = A.id;
        for (let y = B.ya; y <= B.yb; y++) for (let x = B.xa; x <= B.xb; x++) if (lab[y * W + x] === B.id) lab[y * W + x] = A.id;
        pieces[b] = null; big = big.filter(c => c !== B); b = a;
      }
      const rects = big.filter(c => c.fill > 0.8 && c.w >= 4 && c.h >= 2);
      return { s, j, mask, cnt, comps, big, rects, lab, color: hex(s.c) };
    });
    // one color cluster can hold two close palette colors (seaborn's orange and red). When its bars come in two
    // clearly different colors, it is two series.
    const meanAll = (c, lab) => { let r = 0, g = 0, b = 0, n = 0, best = 0; for (let y = c.ya; y <= c.yb; y++) for (let x = c.xa; x <= c.xb; x++) { const p = y * W + x; if (lab[p] !== c.id) continue; const i = p * 4, sv = rgb2hsv(D[i], D[i + 1], D[i + 2])[1]; if (sv < 0.3) continue; r += D[i]; g += D[i + 1]; b += D[i + 2]; n++; } return n ? [r / n, g / n, b / n] : null; };
    const meanOf = (c, lab) => { let r = 0, g = 0, b = 0, n = 0; for (let y = c.ya + 2; y <= c.yb - 2; y++) for (let x = c.xa + 2; x <= c.xb - 2; x++) { const p = y * W + x; if (lab[p] !== c.id) continue; const i = p * 4; r += D[i]; g += D[i + 1]; b += D[i + 2]; n++; } return n ? [r / n, g / n, b / n] : null; };
    for (let k = info.length - 1; k >= 0; k--) {
      const I = info[k];
      // bars, or dots of a scatter plot (blobs too small to be lines)
      const blobs = I.rects.length >= 4 ? I.rects : I.big.filter(c => c.n >= 12 && c.w < (right - left) * 0.05 && c.h < (bottom - top) * 0.08);
      if (blobs.length < 4 || (blobs !== I.rects && blobs.reduce((a, c) => a + c.n, 0) < I.cnt * 0.6)) continue;
      const groups = [];
      for (const c of blobs) { const m = blobs === I.rects ? meanOf(c, I.lab) : meanAll(c, I.lab); if (!m) continue; const g = groups.find(g => cdist(g.c, m) < 24); if (g) { g.items.push(c); g.c = g.c.map((v, i) => (v * (g.items.length - 1) + m[i]) / g.items.length); } else groups.push({ c: m, items: [c] }); }
      if (opts.debug) console.log('DBG split', I.color, blobs.length, groups.map(g => [g.c.map(Math.round).join(','), g.items.length]));
      if (groups.length < 2 || !groups.every(g => g.items.length >= 2) || groups.length > 4) continue;
      // two series differ in hue; the same color lighter or darker is anti-aliasing (thin line pieces next to markers)
      if (groups.some((g, a) => groups.some((h, b) => b > a && hueGap(g.c, h.c) < 12))) continue;
      const parts = groups.map(g => {
        const jj = series0.length; series0.push({ c: g.c, n: 0 });
        const ids = new Set(g.items.map(c => c.id)), mask = new Uint8Array(N); let cnt = 0;
        for (const c of g.items) for (let y = c.ya; y <= c.yb; y++) for (let x = c.xa; x <= c.xb; x++) { const p = y * W + x; if (ids.has(I.lab[p])) { mask[p] = 1; cnt++; owner[p] = jj; } }
        return { s: series0[jj], j: jj, mask, cnt, comps: g.items, big: g.items, rects: blobs === I.rects ? g.items : [], lab: I.lab, color: hex(g.c) };
      });
      info.splice(k, 1, ...parts);
    }

    // stacked bars: rectangles of different colors sitting right on top of each other in the same column
    const allRects = [];
    info.forEach(I => I.rects.forEach(c => allRects.push({ c, j: I.j })));
    const colsR = [];
    for (const r of allRects.sort((a, b) => a.c.cx - b.c.cx)) {
      const g = colsR.find(g => Math.min(g.xb, r.c.xb) - Math.max(g.xa, r.c.xa) > Math.min(g.xb - g.xa, r.c.w) * 0.7);
      if (g) { g.items.push(r); g.xa = Math.min(g.xa, r.c.xa); g.xb = Math.max(g.xb, r.c.xb); } else colsR.push({ xa: r.c.xa, xb: r.c.xb, items: [r] });
    }
    const stackedCols = colsR.filter(g => { if (new Set(g.items.map(r => r.j)).size < 2) return false;
      const it = [...g.items].sort((a, b) => a.c.ya - b.c.ya);
      for (let k = 1; k < it.length; k++) if (it[k].c.ya - it[k - 1].c.yb > 4) return false;
      return Math.abs(it[0].c.w - it[it.length - 1].c.w) <= Math.max(2, it[0].c.w * 0.15); });
    const multiBar = colsR.filter(g => g.items.length >= 1);
    if (opts.debug) console.log('DBG rect', rect, 'bg', bg, 'clusters', JSON.stringify(clusters.slice(0, 6).map(c => [c.c.map(Math.round), c.n])), 'minN', minN);
    if (opts.debug) console.log('DBG series', info.map(I => [I.color, I.cnt, I.rects.length, I.rects.map(c => [c.xa, c.ya, c.w, c.h, c.fill.toFixed(2)].join('/')).join(' ')]), 'cols', colsR.length, 'stacked', stackedCols.length);
    if (opts.debug > 1) info.forEach(I => console.log('DBG big', I.color, I.big.filter(c => c.n > 30).slice(0, 30).map(c => [c.xa, c.ya, c.w, c.h, c.fill.toFixed(2)].join('/')).join(' ')));
    // rectangles of equal height that all start at the same x are bars lying on their side
    const lefts = groupBy(allRects.filter(r => r.c.h >= 3 && r.c.w >= 6), r => r.c.xa, 2).sort((a, b) => b.length - a.length);
    const hbarHint = lefts.length && lefts[0].length >= 2 ? lefts[0].length : 0;
    const isStacked = force === 'stacked_bar' || (!force || force === 'auto') && stackedCols.length >= 2 && stackedCols.length >= multiBar.length * 0.6;

    const out = [];
    const ctx = { W, H, D, left, right, top, bottom, Y, X, ycal, xcal, xNumeric, xDate, xTick, xAnchor, xCats, xLabels, xSpacing, y0px, baseLine, bg, owner, opts, force, textMask };
    const wf = !force || force === 'auto' || force === 'waterfall' ? readWaterfall(ctx, info) : null;
    if (wf) out.push(wf);
    else if (isStacked) {
      readStacked(ctx, info, colsR, out);
    } else {
      for (const I of info) readSeries(ctx, I, out);
      // lines or bands that missed the data grid get the grid another series of the chart found
      // (the coarsest grid any series found, if the finer grids of the others contain it)
      const gl = out.filter(s => (s.type === 'line' || s.type === 'area') && s.gridOk === 1).sort((a, b) => a.points.length - b.points.length);
      const gs = gl.find(c => gl.every(o => c.points.every(p => o.points.some(q => Math.abs(q.px - p.px) < 3))));
      const miss = out.map((s, k) => (s.type === 'line' || s.type === 'area') && (!s.gridOk || (gs && s !== gs && s.points.length > gs.points.length)) ? k : -1).filter(k => k >= 0);
      if (gs && miss.length && xNumeric) {
        // carry an even grid on across the whole plot, so a longer series is not cut to the shorter one's span
        let gp = gs.points.map(p => p.px).sort((a, b) => a - b);
        const dd = gp.slice(1).map((v, k) => v - gp[k]), st = median(dd);
        if (gp.length >= 3 && dd.every(v => Math.abs(v - st) < st * 0.1)) { while (gp[0] - st >= left - 3) gp.unshift(gp[0] - st); while (gp[gp.length - 1] + st <= right + 3) gp.push(gp[gp.length - 1] + st); }
        ctx.gridPx = gp;
        for (const k of miss.reverse()) { const I = info.find(I => I.color === out[k].color); if (!I) continue; const tmp = []; readSeries(ctx, I, tmp); if (tmp.length === 1 && tmp[0].gridOk) out[k] = tmp[0]; }
        delete ctx.gridPx;
      }
      // a slope chart: most lines run straight between the same two x positions. A line partly hidden under another
      // one (or cut by a label) gets its two ends from the straight line through what was traced, if it is straight
      const ln = out.filter(s => s.type === 'line'), two = ln.filter(s => s.points.length === 2);
      if (xNumeric && ln.length >= 2 && two.length >= ln.length * 0.5 && two.length < ln.length) {
        const e0 = two[0].points[0].px, e1 = two[0].points[1].px;
        if (e1 - e0 > (right - left) * 0.3 && two.every(s => Math.abs(s.points[0].px - e0) < 3 && Math.abs(s.points[1].px - e1) < 3))
          for (const s of ln) {
            if (s.points.length === 2 || !s.trace || s.trace.length < 5) continue;
            const T = s.trace, n = T.length, mx = T.reduce((a, t) => a + t[0], 0) / n, my = T.reduce((a, t) => a + t[1], 0) / n;
            const sxx = T.reduce((a, t) => a + (t[0] - mx) ** 2, 0); if (sxx < 1) continue;
            const k = T.reduce((a, t) => a + (t[0] - mx) * (t[1] - my), 0) / sxx;
            const rms = Math.sqrt(T.reduce((a, t) => a + (t[1] - my - k * (t[0] - mx)) ** 2, 0) / n);
            if (rms > Math.max(2, s.thick || 2) || T[n - 1][0] - T[0][0] < (e1 - e0) * 0.3) continue;
            const sd = s.points[0].sd;
            s.points = [e0, e1].map(px => { const py = my + k * (px - mx); return { x: X(px), y: Y(py), px, py, sd }; });
          }
      }
      // a "series" drawn wholly above the top tick, next to other series that are not, is a title or a note in color
      if (out.length > 1 && yTicks.length) for (const q of out.slice()) { if (q.type === 'line' && q.points.length && q.points.every(p => p.py < yTicks[0] - 4) && out.some(o => o !== q && o.points.some(p => p.py >= yTicks[0]))) out.splice(out.indexOf(q), 1); }
      // dots in another color sitting on a line are that line's markers: they mark its data points exactly
      for (const sc of out.filter(q => q.type === 'scatter')) {
        const host = out.find(L => L.type === 'line' && L.trace && L.trace.length > 10 && sc.points.length >= 3 &&
          sc.points.filter(p => p.px >= L.trace[0][0] - 6 && p.px <= L.trace[L.trace.length - 1][0] + 6 && Math.abs(traceAt(L.trace, clamp(p.px, L.trace[0][0], L.trace[L.trace.length - 1][0])) - p.py) <= Math.max(4, (L.thick || 2) * 2)).length >= sc.points.length * 0.75);
        if (!host || out.filter(q => q.type === 'scatter').length > 1) continue;
        const pts = [...sc.points].sort((a, b) => a.px - b.px);
        host.points = pts.map(p => ({ x: xCats && xCats.length ? (xCats.reduce((b, c) => Math.abs(c.cx - p.px) < Math.abs(b.cx - p.px) ? c : b).label) : xNumeric ? X(p.px) : p.x, y: p.y, px: p.px, py: p.py, sd: p.sd || 1 }));
        host.gridOk = 1; host.markers = true; out.splice(out.indexOf(sc), 1);
      }
      // bars and a line with no readable x labels: the line's points sit over the bar centers
      const barsS = out.filter(q => q.type === 'bar' && !q.horizontal);
      if (barsS.length && !xNumeric) {
        const nB = Math.max(...barsS.map(q => q.points.length)), ref = barsS.filter(q => q.points.length === nB);
        const centers = Array.from({ length: nB }, (_, k) => ({ px: mean(ref.map(q => q.points[k].px)), x: ref[0].points[k].x }));
        for (const q of out) {
          if (q.type === 'line' && q.markers && !xCats) { const sp = median(centers.slice(1).map((c, k) => c.px - centers[k].px)) || 1e9; q.points.forEach(p => { const c = centers.reduce((b, c) => Math.abs(c.px - p.px) < Math.abs(b.px - p.px) ? c : b); if (Math.abs(c.px - p.px) < sp * 0.4) p.x = c.x; }); continue; }
          if (q.type !== 'line' || q.gridOk || !q.trace || q.trace.length < 5) continue;
          const lo = q.trace[0][0], hi = q.trace[q.trace.length - 1][0], cs = centers.filter(c => c.px >= lo - 3 && c.px <= hi + 3);
          if (cs.length >= 2 && cs.length >= nB * 0.6) { q.points = cs.map(c => { const py = traceAt(q.trace, clamp(c.px, lo, hi)); return { x: c.x, y: Y(py), px: c.px, py, sd: q.points[0] ? q.points[0].sd : 1 }; }); q.gridOk = 1; }
        }
      }
      groupLabels(ctx, out);
    }
    if (!out.length) return { ok: false, code: 'no_marks', error: 'I found the axes but could not make out lines, bars or dots.', rect, words };

    // names from the legend: a solid block of a series' color just before a word. Best matches are taken first.
    const cand = [];
    for (const L of legendWords.concat(outsideWords.map(w => Object.assign({ w, out: true }, swatchBox(w))))) {
      out.forEach((s, j) => {
        const sc = unhex(s.color); let hit = 0;
        for (let y = L.sy0; y < L.sy1; y++) for (let x = L.sx0; x < L.sx1; x++) { const i = (y * W + x) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], sc) < 35) hit++; }
        if (hit >= 8) cand.push({ j, hit, text: L.w.text, L });
      });
    }
    // a legend swatch in a color none of the found series has: a series I missed
    let orphans = 0;
    for (const L of legendWords.concat(outsideWords.map(w => Object.assign({ w, out: true }, swatchBox(w))))) {
      if (cand.some(c => c.text === L.w.text)) continue;
      const cols = [];
      for (let y = L.sy0; y < L.sy1; y++) for (let x = L.sx0; x < L.sx1; x++) { const i = (y * W + x) * 4, c = [D[i], D[i + 1], D[i + 2]]; if (rgb2hsv(c[0], c[1], c[2])[1] > 0.3 && cdist(c, bg) > 60) cols.push(c); }
      if (cols.length < 30) continue;
      const m = [0, 1, 2].map(k => median(cols.map(c => c[k])));
      if (Math.max(...m) >= 90 && cols.filter(c => cdist(c, m) < 30).length >= cols.length * 0.7 && out.every(s => cdist(unhex(s.color), m) > 60 && hueGap(unhex(s.color), m) > 20)) { orphans++; if (opts.debug) console.log("DBG orphan", L.w.text, m.map(Math.round), cols.length); }
    }
    cand.sort((a, b) => b.hit - a.hit);
    const named = new Set();
    for (const c of cand) if (!out[c.j].name && !named.has(c.text)) { out[c.j].name = c.text.replace(/[^\w\s.&%'-]/g, ''); named.add(c.text);
      // the legend's own marker is not a data point
      const q = out[c.j]; if (q.type === 'scatter' && q.points.length > 2) { const m = 3, L = c.L; q.points = q.points.filter(p => !(p.px >= L.sx0 - m && p.px <= L.sx1 + m && p.py >= L.sy0 - m && p.py <= L.sy1 + m)); } }
    out.forEach((s, j) => { if (!s.name) s.name = out.length > 1 ? 'Series ' + (j + 1) : (s.type === 'bar' ? 'Value' : 'Series'); });
    // a legend drawn on top of the data hides part of it: if the end of a bar or a data point sits under it, say so
    let hidden = 0; const ctxBottom = bottom;
    for (const L of legendWords) for (const s of out) for (const p of s.points) {
      if (p.px == null) continue;
      // a bar that is missing where the legend sits may be under it
      if (p.empty) { if (p.px >= L.x0 && p.px <= L.x1 && L.y1 >= ctxBottom - 4) hidden++; continue; }
      const xa = p.box ? Math.min(p.box[0], p.box[2]) : p.px, xb = p.box ? Math.max(p.box[0], p.box[2]) : p.px;
      if (xb >= L.x0 && xa <= L.x1 && p.py >= L.y0 - 2 && p.py <= L.y1 + 2) hidden++;
    }

    // a second y axis: if its labels are drawn in the color of a series, that series is measured against it
    let yRightCal = null;
    if (ax.yRight) {
      const R = ax.yRight; fixSeparators(R);
      let rl = R.map(q => ({ p: q.cy, v: q.v, w: q }));
      rl = fixMissingMinus(rl);
      yRightCal = fitAxis(rl);
      if (yRightCal) {
        const labColor = q => { let best = null, bs = -1; for (let y = Math.round(q.y0); y < q.y1; y++) for (let x = Math.round(q.x0); x < q.x1; x++) { const i = (y * W + x) * 4, sv = rgb2hsv(D[i], D[i + 1], D[i + 2]); if (sv[1] > bs) { bs = sv[1]; best = [D[i], D[i + 1], D[i + 2]]; } } return bs > 0.35 ? best : null; };
        const rc = R.map(labColor).filter(Boolean), lc = ax.yCol.map(labColor).filter(Boolean);
        out.forEach(s => {
          const sc = unhex(s.color);
          const onRight = rc.length >= 2 && median(rc.map(c => cdist(c, sc))) < 60, onLeft = lc.length >= 2 && median(lc.map(c => cdist(c, sc))) < 60;
          if (onRight && !onLeft) { s.axis = 'right'; s.points.forEach(p => { if (p.py != null) { p.yLeft = p.y; p.y = yRightCal.toValue(p.py); } }); }
        });
        // labels in plain gray say nothing. With exactly two series the usual layout is a guess worth making: bars on
        // the left and the line on the right, or the second legend entry on the right. The dual axis issue stays,
        // so a read like this is never marked reliable.
        if (!out.some(s => s.axis === 'right') && out.length === 2) {
          const bar = out.filter(s => s.type === 'bar');
          // colored labels that missed the 60 cut can still point at one series much more than the other
          const dR = out.map(q => rc.length >= 2 ? median(rc.map(c => cdist(c, unhex(q.color)))) : Infinity);
          const s = dR[0] < dR[1] * 0.6 ? out[0] : dR[1] < dR[0] * 0.6 ? out[1] : bar.length === 1 ? out.find(q => q.type !== 'bar') : bar.length ? null : out[1];
          if (s) { s.axis = 'right'; s.axisGuess = true; s.points.forEach(p => { if (p.py != null) { p.yLeft = p.y; p.y = yRightCal.toValue(p.py); } }); }
        }
      }
    }

    const yConf = mean(ax.yCol.map(q => q.conf != null ? q.conf : 100));
    return { ok: true, hbarHint, yConf, hidden, orphans, yOnRight, rect, series: out, notes, ycal, xcal, xNumeric, xDate, ax, yl, yPct, yUnit, bg, bgDark, mono, clusters, yRightCal, legendWords, xCats };
  }

  // ---------- one series: bars, histogram, area, step, dots or a line ----------
  function readSeries(ctx, I, out) {
    const { W, H, D, left, right, top, bottom, Y, X, xNumeric, xCats, xSpacing, y0px, bg, force } = ctx, opts = ctx.opts;
    const { s, mask, cnt, big, rects, color } = I;
    const plotW = right - left, plotH = bottom - top;
    // bars: solid rectangles with similar widths that sit on a shared baseline
    const wMed = median(rects.map(c => c.w));
    let barLike = rects.filter(c => Math.abs(c.w - wMed) < Math.max(2, wMed * 0.2));
    const baseOf = c => (y0px != null && Math.abs(c.ya - y0px) < Math.abs(c.yb - y0px)) ? c.ya : c.yb;
    // most bars stand on one baseline; a stray rectangle (a legend swatch) that does not is left out
    const bm = median(barLike.map(baseOf)), onBase = barLike.filter(c => Math.abs(baseOf(c) - bm) < 4);
    if (onBase.length >= 2 && onBase.length >= barLike.length * 0.7) barLike = onBase;
    const baseEdges = barLike.map(baseOf);
    const sharedBase = barLike.length >= 2 && (Math.max(...baseEdges) - Math.min(...baseEdges)) < 4;
    const barArea = barLike.reduce((a, c) => a + c.n, 0);
    // dots: many small blobs of about the same size
    // hollow markers (rings) count by the area they enclose
    const small = c => c.w < plotW * 0.05 && c.h < plotH * 0.08;
    for (const c of big) if (small(c) && c.filledN == null) {
      let n = 0;
      for (let y = c.ya; y <= c.yb; y++) { let a = -1, b = -1; for (let x = c.xa; x <= c.xb; x++) if (I.lab[y * W + x] === c.id) { if (a < 0) a = x; b = x; } if (a >= 0) n += b - a + 1; }
      c.filledN = n; c.filledFill = n / (c.w * c.h);
    }
    const dots = big.filter(c => small(c) && (c.fill > 0.35 || c.filledFill > 0.6));
    const dotArea = dots.reduce((a, c) => a + c.n, 0);
    // a legend swatch (a wide solid block in the series color) is not a marker and does not count against the dots
    const swatchArea = big.filter(c => !small(c) && c.fill > 0.9 && c.h <= 24 && c.w >= c.h * 1.5 && c.w <= c.h * 6).reduce((a, c) => a + c.n, 0);
    // per column, where the ink starts and ends (for areas and histograms)
    const colTop = new Float32Array(plotW + 1).fill(NaN), colBot = new Float32Array(plotW + 1).fill(NaN), colRuns = new Uint16Array(plotW + 1), colLen = new Float32Array(plotW + 1);
    for (let x = left; x <= right; x++) { let a = -1, runs = 0, prev = false, len = 0;
      for (let y = top; y <= bottom; y++) { const on = !!mask[y * W + x]; if (on) { if (a < 0) a = y; colBot[x - left] = y; len++; } if (on && !prev) runs++; prev = on; }
      if (a >= 0) colTop[x - left] = a; colRuns[x - left] = runs; colLen[x - left] = len; }
    const covered = [...colTop].filter(v => !isNaN(v)).length;
    const thick = median([...colLen].filter(v => v > 0));
    const mode = force && ['bar', 'grouped_bar', 'histogram', 'line', 'step', 'area', 'stacked_area', 'scatter', 'bar_line'].includes(force) ? force : null;

    // lollipops: a thin stem from the baseline with a dot at its far end; the value is the centre of the dot
    if (y0px != null && (!mode || mode === 'bar' || mode === 'lollipop')) {
      const lol = big.filter(c => c.h >= 8 && c.w <= Math.max(8, plotW * 0.06) && (Math.abs(c.yb + 1 - y0px) <= 3 || Math.abs(c.ya - y0px) <= 3)).sort((a, b) => a.cx - b.cx);
      if (lol.length >= 3 && lol.reduce((a, c) => a + c.n, 0) > cnt * 0.75) {
        const pts = [];
        for (const c of lol) {
          const up = Math.abs(c.yb + 1 - y0px) <= Math.abs(c.ya - y0px), rows = [];
          for (let y = c.ya; y <= c.yb; y++) { let n = 0; for (let x = c.xa; x <= c.xb; x++) if (I.lab[y * W + x] === c.id) n++; rows.push(n); }
          const stem = median(rows), head = Math.max(...rows);
          // a dot whose stem did not come out (jpeg turned the thin stem a lighter color) is still a value
          const lone = c.h <= c.w * 1.6;
          // or a bare stem whose dot came out as its own blob right at the stem's far end
          const dot = head < Math.max(4, stem * 1.8) && !lone ? big.find(d => d !== c && d.xa <= c.xb + 2 && d.xb >= c.xa - 2 && d.h <= d.w * 1.6 && (up ? Math.abs(d.yb - c.ya) <= 6 : Math.abs(d.ya - c.yb) <= 6)) : null;
          if (head < Math.max(4, stem * 1.8) && !lone && !dot) { pts.length = 0; break; }
          const hr = []; rows.forEach((n, i) => { if (lone || n > stem * 1.5) hr.push(c.ya + i); });
          const far = up ? hr.filter(y => y <= Math.min(...hr) + head * 1.3) : hr.filter(y => y >= Math.max(...hr) - head * 1.3);
          const cy = dot ? (dot.ya + dot.yb + 1) / 2 : lone ? (c.ya + c.yb + 1) / 2 : (Math.min(...far) + Math.max(...far) + 1) / 2;
          const cat = xCats && xCats.length ? xCats.reduce((b, q) => Math.abs(q.cx - c.cx) < Math.abs(b.cx - c.cx) ? q : b) : null;
          pts.push({ x: cat && Math.abs(cat.cx - c.cx) < Math.max(10, (xSpacing || 40) * 0.5) ? cat.label : xNumeric ? X(c.cx) : 'Bar ' + (pts.length + 1), y: Y(cy), px: c.cx, py: cy, sd: 0.8 });
        }
        if (pts.length >= 3) { out.push({ type: 'bar', lollipop: true, color, points: pts, explained: 1 }); return; }
      }
    }
    const barOk = barLike.length >= 2 && sharedBase && barArea > cnt * 0.6 && wMed > 3;
    if ((barOk && (!mode || ['bar', 'grouped_bar', 'histogram', 'bar_line'].includes(mode))) || (mode === 'bar' || mode === 'grouped_bar') && barLike.length >= 1) {
      const pts = measureBars(ctx, barLike.sort((a, b) => a.cx - b.cx), s.c);
      const cont = contiguous(barLike) || touchingWithGaps(barLike);
      if (cont && xNumeric) { probeTinyBins(ctx, pts, wMed, s.c); fillEmptyBins(ctx, pts, wMed); }
      out.push({ type: 'bar', color, points: pts, contiguous: cont, explained: barArea / Math.max(1, cnt) });
      return;
    }
    // a histogram drawn without gaps (or bars blurred together) is one wide blob with a flat bottom and a stepped top
    const mainC = big.length ? big.reduce((a, c) => c.n > a.n ? c : a) : null;
    if (opts.debug && mainC) console.log('DBG main', mainC.w, plotW, mainC.n, cnt, mainC.fill.toFixed(2));
    // solid: in each column the ink runs unbroken from its top down to the baseline
    let solidIn = 0, solidSpan = 0;
    if (mainC) for (let x = mainC.xa; x <= mainC.xb; x++) { const t = colTop[x - left], b = colBot[x - left]; if (!isNaN(t)) { solidIn += colLen[x - left]; solidSpan += b - t + 1; } }
    if (mainC && (mode === 'histogram' || mode === 'bar' || !mode) && mainC.w > plotW * 0.15 && mainC.n > cnt * 0.8 && solidIn > solidSpan * 0.9) {
      const bots = [], tops = [], lens = [];
      for (let x = mainC.xa; x <= mainC.xb; x++) {
        // the top is the first row whose ink carries on for 3 more rows, so a speck of noise does not count
        let t = NaN, b = NaN, len = 0;
        let first = NaN;
        for (let y = top; y <= bottom; y++) { const on = mask[y * W + x]; if (on) { len++; if (isNaN(first)) first = y; } if (isNaN(t) && on && y + 3 <= bottom && mask[(y + 1) * W + x] && mask[(y + 2) * W + x] && mask[(y + 3) * W + x]) t = y; if (on) b = y; }
        if (isNaN(t) && len > 0 && len < 5) t = first;   // a very short bar
        tops.push(t); bots.push(b); lens.push(len);
      }
      const bb = bots.filter(v => !isNaN(v)), bm = median(bb), lm = median(lens.filter(v => v > 0));
      const flatBottom = bb.length && quant(bb.map(v => Math.abs(v - bm)), 0.8) <= 2;
      // split into bars where the top jumps or where a column is mostly empty (a gap between bars)
      const segs = []; let cur = null;
      for (let k = 0; k < tops.length; k++) {
        const t = tops[k], gap = isNaN(t) || lens[k] < (bots[k] - t + 1) * 0.5;
        if (gap) { cur = null; continue; }
        if (cur && Math.abs(t - median(cur.t.slice(-6))) <= 2) { cur.t.push(t); cur.k1 = k; }
        else { cur = { k0: k, k1: k, t: [t] }; segs.push(cur); }
      }
      let good = segs.filter(g => g.k1 - g.k0 + 1 >= 3);
      // two neighbouring bins with the same count look like one wide bar: split runs that are a whole number of bins wide
      const w0 = quant(good.map(g => g.k1 - g.k0 + 1), 0.3);
      if (w0 >= 3) good = good.flatMap(g => { const n = Math.round((g.k1 - g.k0 + 1) / w0); if (n < 2 || Math.abs((g.k1 - g.k0 + 1) / w0 - n) > 0.2) return [g];
        const step = (g.k1 - g.k0 + 1) / n; return Array.from({ length: n }, (_, j) => ({ k0: Math.round(g.k0 + j * step), k1: Math.round(g.k0 + (j + 1) * step) - 1, t: g.t })); });
      const cover = good.reduce((a, g) => a + g.k1 - g.k0 + 1, 0) / tops.length;
      // real bars have flat tops and clear steps between them, and bins of one width; a sloped area edge cut into
      // short runs has neither
      const wds = good.map(g => g.k1 - g.k0 + 1), wm = mean(wds), cv = wds.length > 1 ? Math.sqrt(mean(wds.map(v => (v - wm) ** 2))) / wm : 0;
      const jumps = good.slice(1).map((g, k) => Math.abs(median(g.t) - median(good[k].t)));
      const crisp = good.length <= 2 || (median(jumps) >= 4 && cv < 0.35);
      if (flatBottom && good.length >= 2 && cover > 0.8 && crisp && median(good.map(g => bm - median(g.t))) > 4) {
        const pts = good.map(g => { const x0 = mainC.xa + g.k0, x1 = mainC.xa + g.k1, inner = g.t.slice(Math.floor(g.t.length * 0.2), Math.ceil(g.t.length * 0.8)) , cx = (x0 + x1) / 2, ty = subTop(D, W, H, s.c, bg, x0, x1, median(inner.length ? inner : g.t));
          return { x: xNumeric ? X(cx) : catLabel(xCats, cx, x1 - x0, xSpacing) || 'Bar', y: Y(ty), px: cx, py: ty, box: [x0, ty, x1, bm], sd: 0.45 }; });
        pts.forEach((p, k) => { if (p.x === 'Bar') p.x = 'Bar ' + (k + 1); });
        if (xNumeric) { const bw = median(good.map(g => g.k1 - g.k0 + 1)); probeTinyBins(ctx, pts, bw, s.c); fillEmptyBins(ctx, pts, bw); }
        out.push({ type: 'bar', color, points: pts, contiguous: good.every((g, k) => !k || g.k0 - good[k - 1].k1 <= 3), profile: true, explained: mainC.n / Math.max(1, cnt) });
        return;
      }
    }
    // the dashes of a dashed line are small blobs too, but they are long and thin, and a line runs smoothly through them
    let dashed = false;
    if (dots.length >= 5 && !mode) {
      const el = dots.map(c => Math.max(c.w, c.h) ** 2 / c.n);
      if (el.filter(v => v > 2.5).length >= dots.length * 0.4) {
        const trD = traceLine(mask, W, left, right, top, bottom, ctx.textMask);
        if (trD && trD.length > plotW * 0.3) {
          let adj = 0, jump = 0;
          for (let k = 1; k < trD.length; k++) if (trD[k][0] - trD[k - 1][0] === 1) { adj++; if (Math.abs(trD[k][1] - trD[k - 1][1]) > 8) jump++; }
          dashed = adj > 0 && jump / adj < 0.1;
        }
      }
    }
    // bubbles: round blobs of many sizes. Each one is a point at its centre (the size is a third value this does not read)
    const round = big.filter(c => c.w >= 5 && Math.abs(c.w - c.h) <= Math.max(2, Math.max(c.w, c.h) * 0.15) && (c.filledFill || c.fill) > 0.6 && (c.filledFill || c.fill) < 0.92 && c.w < plotW * 0.3);
    const roundArea = round.reduce((a, c) => a + c.n, 0), sizes = round.map(c => c.w).sort((a, b) => a - b);
    if (!dashed && !mode && round.length >= 3 && roundArea > (cnt - swatchArea) * 0.75 && sizes[sizes.length - 1] > sizes[0] * 1.6 && sizes[sizes.length - 1] > 14) {
      const pts = round.map(c => ({ x: X(c.cx), y: Y(c.cy), px: c.cx, py: c.cy, sd: 0.6, r: c.w / 2 })).sort((a, b) => a.px - b.px);
      out.push({ type: 'scatter', bubble: true, color, points: pts, size: median(sizes), touch: 0, merged: 0, explained: roundArea / Math.max(1, cnt) });
      return;
    }
    if (!dashed && ((dots.length >= 5 && dotArea > (cnt - swatchArea) * 0.7 && (!mode || mode === 'scatter')) || mode === 'scatter')) {
      const ds = dots.length ? dots : big;
      const area = c => c.filledN || c.n;
      const a1 = median(ds.map(area)), pts = [];
      // two markers overlapping by half cover only ~1.4 markers of area, but their blob is clearly longer than one
      const dm = median(ds.map(c => Math.max(c.w, c.h)));
      if (opts.debug > 1) console.log('DBG dots', color, 'a1', a1, 'dm', dm, ds.map(c => [Math.round(c.cx), Math.round(c.cy), c.w, c.h, area(c)].join('/')).join(' '), 'big', big.length, 'dots', dots.length);
      for (const c of ds) {
        const k = Math.max(1, Math.round(area(c) / a1), Math.max(c.w, c.h) > dm * 1.45 && area(c) > a1 * 1.2 ? 2 : 1);
        if (k === 1) { pts.push({ x: X(c.cx), y: Y(c.cy), px: c.cx, py: c.cy, sd: 0.45 }); continue; }
        // overlapping markers: split the blob's pixels into k groups (k-means), one per marker
        const P = []; for (let y = c.ya; y <= c.yb; y++) for (let x = c.xa; x <= c.xb; x++) if (I.lab[y * W + x] === c.id) P.push([x, y]);
        for (const m of kmeans(P, k)) pts.push({ x: X(m[0]), y: Y(m[1]), px: m[0], py: m[1], merged: true, sd: 0.45 + Math.sqrt(a1) * 0.25 });
      }
      // markers touching another series' ink: some of this series may hide under the other one
      let touch = 0;
      for (const c of ds) { let hit = false;
        for (let y = Math.max(top, c.ya - 2); y <= Math.min(bottom, c.yb + 2) && !hit; y++) for (let x = Math.max(left, c.xa - 2); x <= Math.min(right, c.xb + 2) && !hit; x++) { const o = ctx.owner[y * W + x]; if (o >= 0 && o !== I.j) hit = true; }
        if (hit) touch++; }
      out.push({ type: 'scatter', color, points: pts.sort((a, b) => a.px - b.px), size: Math.sqrt(a1), touch, merged: pts.filter(p => p.merged).length, explained: ds.reduce((a, c) => a + c.n, 0) / Math.max(1, cnt) });
      return;
    }
    // an area: the ink fills a tall band in most columns. Its top edge is the line.
    const filled = [...colLen].filter(v => v > 0);
    const areaLike = filled.length > plotW * 0.15 && median(filled) > Math.max(10, plotH * 0.08) && quant([...colRuns].filter(v => v > 0), 0.7) <= 1;
    let tr = null, isArea = false, stackedOn = false, lightFill = false;
    if ((areaLike && (!mode || mode === 'area' || mode === 'stacked_area')) || mode === 'area' || mode === 'stacked_area') {
      isArea = true; tr = [];
      let below = 0, belowN = 0;
      for (let x = left; x <= right; x++) { const t = colTop[x - left]; if (isNaN(t)) continue;
        tr.push([x, subTop(D, W, H, s.c, bg, x, x, t)]);
        const b = colBot[x - left]; if (b + 4 <= bottom) { belowN++; let hit = false; for (let d = 1; d <= 4 && !hit; d++) { const o = ctx.owner[(b + d) * W + x]; if (o >= 0 && o !== I.j) hit = true; } if (hit) below++; } }
      stackedOn = belowN > 10 && below / belowN > 0.6;
      if (stackedOn) I.bottomEdge = [...colBot];
    } else {
      tr = traceLine(mask, W, left, right, top, bottom, ctx.textMask);
      if (!tr || tr.length < Math.max(5, plotW * 0.12)) return;
      // a line with a light tint of its own color below it is an area drawn with transparency
      let tint = 0, tn = 0; const hs = rgb2hsv(...s.c);
      for (let k = 0; k < tr.length; k += 3) { const x = tr[k][0], y = Math.round(tr[k][1] + Math.max(6, thick * 2)); if (y >= bottom) continue; const i = (y * W + x) * 4, h = rgb2hsv(D[i], D[i + 1], D[i + 2]); tn++;
        if (cdist([D[i], D[i + 1], D[i + 2]], bg) > 12 && Math.min(Math.abs(h[0] - hs[0]), 360 - Math.abs(h[0] - hs[0])) < 25 && h[1] > 0.06) tint++; }
      lightFill = tn > 10 && tint / tn > 0.8;
    }
    // a step line: flat runs joined by vertical jumps
    const ys = tr.map(t => t[1]);
    const runs = stepRuns(ys, 0.8, 4);
    const flatShare = runs.reduce((a, r) => a + r.n, 0) / ys.length;
    const jumps = runs.slice(1).filter((r, k) => Math.abs(r.y - runs[k].y) > 3).length;
    // a step line jumps straight up or down: the next flat run starts right where the last one ended
    const sharp = runs.slice(1).filter((r, k) => Math.abs(r.y - runs[k].y) > 3 && r.i0 - (runs[k].i0 + runs[k].n) <= 6).length;
    if (!isArea && ((mode === 'step') || (!mode && runs.length >= 3 && flatShare > 0.9 && jumps >= 2 && jumps >= (runs.length - 1) * 0.6 && sharp >= jumps * 0.5 && runs.length < tr.length / 6))) {
      const sp = readStep(ctx, tr, runs, mask, s.c);
      out.push({ type: 'step', color, points: sp, trace: tr.map(t => [t[0], t[1]]), ambiguous: ctx.stepAmbiguous, explained: Math.min(1, tr.length * Math.max(2, thick || 2) / Math.max(1, cnt)) });
      return;
    }
    let pts = null;
    const sdLine = 0.35 + Math.min(1.5, (thick || 2) * 0.12);
    let gridOk = 0;
    // another series of this chart set the data grid: series of one chart share their x values
    if (ctx.gridPx && ctx.opts.grid !== false) {
      const lo = tr[0][0], hi = tr[tr.length - 1][0], g = ctx.gridPx.filter(x => x >= lo - 3 && x <= hi + 3);
      if (g.length >= 2 && lo >= ctx.gridPx[0] - 3 && hi <= ctx.gridPx[ctx.gridPx.length - 1] + 3) { pts = g.map(x => { const py = traceAt(tr, clamp(x, lo, hi)); return { x: X(x), y: Y(py), px: x, py }; }); gridOk = 1; }
    }
    if (pts || ctx.opts.grid === false) { /* grid given, or the ablation with no snapping to a data grid */ }
    else if (xNumeric && tr.length > 8 && ctx.xDate) { const g = fitGridDates(tr, ctx.xcal, Y); if (g) { pts = g.pts; gridOk = 1; } }
    else if (xNumeric && tr.length > 8 && ctx.xTick) { const g = fitGrid(tr, ctx.xcal, ctx.xTick, Y, ctx.xAnchor); if (g) { pts = g.pts; gridOk = 1; } }
    if (!pts && !xNumeric && xCats && xCats.length >= 2) {
      // a category axis: read the line right above each label
      const lo = tr[0][0], hi = tr[tr.length - 1][0];
      const cs = xCats.filter(c => c.cx >= lo - 2 && c.cx <= hi + 2);
      if (cs.length >= 2 && cs.length >= xCats.length * 0.6) { pts = cs.map(c => { const py = traceAt(tr, clamp(c.cx, lo, hi)); return { x: c.label, y: Y(py), px: c.cx, py }; }); gridOk = 1; }
    }
    if (!pts) pts = rdp(tr, ctx.opts.eps || 1.6).map(c => ({ x: X(c[0]), y: Y(c[1]), px: c[0], py: c[1] }));
    pts.forEach(p => { p.sd = sdLine; });
    if (isArea && stackedOn) {
      // a band stacked on another: its own value is the height of the band
      pts.forEach(p => {
        // the band's lower edge near this x (a few columns, since the very first and last columns are ragged)
        const k0 = Math.round(p.px) - left, bs = [];
        for (let d = -3; d <= 3; d++) { const v = I.bottomEdge[k0 + d]; if (v != null && !isNaN(v)) bs.push(v); }
        const ed = I.bottomEdge.slice(Math.max(0, k0 - 1), k0 + 2).filter(v => !isNaN(v));
        // at the plot's edge the columns on one side are missing: look a little further in
        if (bs.length < 3) for (let d = 4; d <= 8; d++) for (const k of [k0 - d, k0 + d]) { const v = I.bottomEdge[k]; if (v != null && !isNaN(v)) bs.push(v); }
        const b = bs.length >= 3 ? (ed.length ? median(ed) : median(bs)) : NaN;
        if (!isNaN(b)) { p.y = Y(p.py) - Y(b + 1); p.base = b + 1; }
      });
    }
    const s2 = { type: isArea ? 'area' : lightFill ? 'area' : 'line', color, points: pts, trace: tr.map(t => [t[0], t[1]]), thick, gridOk, explained: isArea ? 1 : Math.min(1, tr.length * Math.max(2, thick || 2) / Math.max(1, cnt)) };
    if (isArea && stackedOn) s2.stacked = true;
    // two lines in nearly the same color merge into one mask: many columns then have two separate runs
    s2.doubled = [...colRuns].filter(v => v >= 2).length / Math.max(1, covered);
    s2.coverage = tr.length / Math.max(1, plotW);
    // corners of the drawn line versus points given: many more corners means points were missed
    s2.corners = rdp(tr, 2.5).length;
    out.push(s2);
  }

  // k centers for a set of points: start from points far apart, then a few rounds of Lloyd's steps
  function kmeans(P, k) {
    if (P.length <= k) return P.map(p => [p[0], p[1]]);
    const C = [P[0]];
    while (C.length < k) { let bi = 0, bd = -1; P.forEach((p, i) => { const d = Math.min(...C.map(c => (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2)); if (d > bd) { bd = d; bi = i; } }); C.push(P[bi]); }
    let M = C.map(c => [c[0], c[1]]);
    for (let it = 0; it < 12; it++) {
      const S = M.map(() => [0, 0, 0]);
      for (const p of P) { let bi = 0, bd = Infinity; M.forEach((m, i) => { const d = (m[0] - p[0]) ** 2 + (m[1] - p[1]) ** 2; if (d < bd) { bd = d; bi = i; } }); S[bi][0] += p[0]; S[bi][1] += p[1]; S[bi][2]++; }
      M = M.map((m, i) => S[i][2] ? [S[i][0] / S[i][2], S[i][1] / S[i][2]] : m);
    }
    return M;
  }

  // follow one line across the plot, column by column
  // tm: the text mask. Columns where the line runs under a masked label are a gap to cross, not a sign the line ended.
  function traceLine(mask, W, left, right, top, bottom, tm) {
    const cols = [];
    for (let x = left; x <= right; x++) {
      const runs = []; let a = -1;
      for (let y = top; y <= bottom + 1; y++) { const on = y <= bottom && mask[y * W + x]; if (on && a < 0) a = y; if (!on && a >= 0) { runs.push([a, y - 1]); a = -1; } }
      cols.push(runs);
    }
    // a line two or more pixels thick: one pixel runs next to it are gridlines showing through a fill, not the line
    const singles = cols.filter(r => r.length === 1).map(r => r[0][1] - r[0][0] + 1);
    if (singles.length > 20 && median(singles) >= 2.5) for (let k = 0; k < cols.length; k++) if (cols[k].length > 1) { const f = cols[k].filter(r => r[1] > r[0]); if (f.length) cols[k] = f; }
    const thickL = singles.length ? median(singles) : 2;
    // start from the column with the most typical single run, then walk both ways
    // (a column whose run carries on smoothly a few columns each way, so a speck of noise is never the seed)
    const near = (k, c) => k >= 0 && k < cols.length && cols[k].some(r => Math.abs((r[0] + r[1]) / 2 - c) < 6);
    let seed = -1;
    for (let d = 0; d < cols.length && seed < 0; d++) for (const k of [(cols.length >> 1) + d, (cols.length >> 1) - d - 1]) {
      if (k < 0 || k >= cols.length || seed >= 0 || cols[k].length !== 1 || cols[k][0][1] - cols[k][0][0] >= 12) continue;
      const c = (cols[k][0][0] + cols[k][0][1]) / 2; let ok = true; for (let e = 1; e <= 4 && ok; e++) ok = near(k - e, c) && near(k + e, c);
      if (ok) seed = k;
    }
    if (seed < 0) for (let k = 0; k < cols.length; k++) if (cols[k].length === 1 && cols[k][0][1] - cols[k][0][0] < 12) { seed = k; break; }
    if (seed < 0) for (let k = 0; k < cols.length; k++) if (cols[k].length === 1) { seed = k; break; }
    if (seed < 0) return null;
    const trace = [];
    const pickRun = (runs, prev) => runs.reduce((b, r) => Math.abs((r[0] + r[1]) / 2 - prev) < Math.abs((b[0] + b[1]) / 2 - prev) ? r : b);
    const ys = new Array(cols.length).fill(null);
    for (const dir of [1, -1]) {
      let prev = (cols[seed][0][0] + cols[seed][0][1]) / 2, miss = 0, span = cols[seed][0];
      const dist = (r, a, b) => r[1] < a ? a - r[1] : r[0] > b ? r[0] - b : 0, hist = [];
      for (let k = seed; k >= 0 && k < cols.length; k += dir) {
        const runs = cols[k], hidden = tm && tm[Math.round(clamp(prev, top, bottom)) * W + left + k];
        if (!runs.length) { if (!hidden && ++miss > 40) break; continue; }
        // where the line is heading: when two runs touch the last one (the line crossing a gridline or another
        // series), the one that keeps the line's slope wins, so the trace does not turn off along the crossing
        const n = hist.length, slope = n >= 4 ? clamp((hist[n - 1][1] - hist[n - 4][1]) / Math.max(1, Math.abs(hist[n - 1][0] - hist[n - 4][0])), -6, 6) : 0;
        const pred = n ? hist[n - 1][1] + slope * Math.abs(k - hist[n - 1][0]) : prev, aim = n >= 4 && Math.abs(slope) >= 0.5 ? pred : prev;
        // the run nearest the last column's run; a vertical jump (a long run) can continue from either of its ends
        const r = runs.reduce((b, q) => dist(q, span[0], span[1]) < dist(b, span[0], span[1]) || (dist(q, span[0], span[1]) === dist(b, span[0], span[1]) && Math.abs((q[0] + q[1]) / 2 - aim) < Math.abs((b[0] + b[1]) / 2 - aim)) ? q : b);
        // a long run that is not a jump of the line (a gridline under a fill, crossing it): the line is where it was heading
        const c = r[1] - r[0] > Math.max(8, thickL * 3) && n >= 4 && runs.length === 1 && pred > r[0] && pred < r[1] ? pred : (r[0] + r[1]) / 2;
        // a lone run far from where the line was (a legend swatch, a label) is not the line
        const gap = dist(r, span[0], span[1]);
        if (gap > 30 + 3 * miss) { if (++miss > 40) break; continue; }
        ys[k] = c; prev = r[0] <= prev && prev <= r[1] ? prev : c; miss = 0; span = r; if (r[1] - r[0] < 14) hist.push([k, c]);
      }
    }
    ys.forEach((y, k) => { if (y != null) trace.push([left + k, y]); });
    return trace;
  }

  // runs of nearly constant value in a sequence (flat tops of bars, flat parts of a step line)
  function stepRuns(vals, tol, minLen) {
    const runs = []; let i0 = 0;
    for (let i = 1; i <= vals.length; i++) {
      const seg = vals.slice(i0, i).filter(v => !isNaN(v));
      if (i < vals.length && !isNaN(vals[i]) && seg.length && Math.abs(vals[i] - median(seg)) <= tol) continue;
      if (seg.length >= minLen) runs.push({ i0, n: i - i0, y: median(seg) });
      i0 = i;
    }
    return runs;
  }

  // the top edge of a bar to a fraction of a pixel: the row just above is partly covered
  function subTop(D, W, H, col, bg, xa, xb, yTop) {
    const ry = yTop - 1; if (ry < 0) return yTop;
    let t = 0, n = 0; const full = cdist(col, bg) || 1;
    const a = xb - xa >= 4 ? xa + 2 : xa, b = xb - xa >= 4 ? xb - 2 : xb;
    for (let x = a; x <= b; x++) { const i = (ry * W + x) * 4; t += clamp(1 - cdist([D[i], D[i + 1], D[i + 2]], col) / full, 0, 1); n++; }
    const cov = n ? t / n : 0; return cov > 0.08 && cov < 0.95 ? yTop - cov : yTop;
  }

  function catLabel(xCats, cx, w, xSpacing) {
    if (!xCats || !xCats.length) return null;
    const near = xCats.reduce((b, q) => Math.abs(q.cx - cx) < Math.abs(b.cx - cx) ? q : b);
    return Math.abs(near.cx - cx) < Math.max(w, xSpacing * 0.5) ? near.label : null;
  }
  // grouped bars: the bars of one category sit side by side. Find the groups by the gaps between bars and give each
  // bar its group's label (by order when the counts match, since a group's middle can sit between labels)
  function groupLabels(ctx, out) {
    const bars = out.filter(s => s.type === 'bar' && !s.stacked); if (bars.length < 2) return;
    const all = bars.flatMap(s => s.points.filter(p => p.box && !p.empty)).sort((a, b) => a.px - b.px);
    if (all.length < 4) return;
    // the gaps inside a group are small and alike; the gaps between groups are clearly bigger
    const gaps = all.slice(1).map((p, k) => p.box[0] - all[k].box[2] - 1), sg = [...gaps].sort((a, b) => a - b);
    let thr = Infinity, jump = 0;
    for (let k = 1; k < sg.length; k++) { const d = sg[k] - sg[k - 1]; if (d > jump && d >= 3) { jump = d; thr = (sg[k] + sg[k - 1]) / 2; } }
    const groups = [[all[0]]];
    for (let k = 1; k < all.length; k++) { if (gaps[k - 1] > thr) groups.push([]); groups[groups.length - 1].push(all[k]); }
    const L = ctx.xCats || ctx.xLabels; if (!L || !L.length) return;
    const centers = groups.map(g => (g[0].box[0] + g[g.length - 1].box[2]) / 2);
    if (ctx.opts.debug) console.log('DBG groups', groups.length, L.map(q => q.label + '@' + Math.round(q.cx)), centers.map(Math.round));
    const val = q => ctx.xNumeric && !ctx.xDate && q.n ? q.n.v : q.label;
    const names = groups.map(() => null);
    if (groups.length === L.length) L.forEach((q, k) => { names[k] = val(q); });
    else {
      // each label goes to the nearest free group, closest pairs first; a group without a label keeps a placeholder
      const pairs = []; L.forEach(q => centers.forEach((c, k) => pairs.push({ q, k, d: Math.abs(q.cx - c) })));
      pairs.sort((a, b) => a.d - b.d); const usedL = new Set();
      for (const pr of pairs) if (names[pr.k] == null && !usedL.has(pr.q) && pr.d < (centers.length > 1 ? Math.abs(centers[1] - centers[0]) * 0.6 : 1e9)) { names[pr.k] = val(pr.q); usedL.add(pr.q); }
      names.forEach((n, k) => { if (n == null) names[k] = ctx.xNumeric && !ctx.xDate ? +ctx.X(centers[k]).toFixed(3) : 'Group ' + (k + 1); });
    }
    groups.forEach((g, k) => g.forEach(p => { p.x = names[k]; }));
    // a category whose bar is missing in one series is a zero there
    bars.forEach(s => { s.points = s.points.filter(p => !p.empty); groups.forEach((g, k) => { if (!s.points.some(p => p.x === g[0].x) && ctx.y0px != null && groups.length === L.length) s.points.push({ x: g[0].x, y: 0, px: centers[k], py: ctx.y0px, empty: true, sd: 0.5 }); }); s.points.sort((a, b) => a.px - b.px); });
  }
  // a bar on a number or date axis: the label it stands on (a year, a month) when there is one, else its position
  function barX(ctx, cx, w) {
    const L = ctx.xLabels;
    if (L && L.length) {
      const near = L.reduce((b, q) => Math.abs(q.cx - cx) < Math.abs(b.cx - cx) ? q : b);
      if (Math.abs(near.cx - cx) < Math.max(w * 0.6, 3)) return ctx.xDate ? near.label : (near.n ? near.n.v : near.label);
    }
    return ctx.X(cx);
  }
  function contiguous(bars) {
    if (bars.length < 3) return false;
    const s = [...bars].sort((a, b) => a.xa - b.xa);
    return s.slice(1).every((c, k) => c.xa - s[k].xb <= 3);
  }

  // bars of one width standing edge to edge, except where a whole bar is missing
  function touchingWithGaps(bars) {
    if (bars.length < 3) return false;
    const s = [...bars].sort((a, b) => a.xa - b.xa), w = median(s.map(c => c.w));
    return s.slice(1).every((c, k) => { const g = c.xa - s[k].xb - 1; return g <= 3 || Math.abs(g / w - Math.round(g / w)) < 0.15; }) && s.slice(1).some((c, k) => c.xa - s[k].xb <= 3);
  }
  // bins with a count of one or two out of hundreds are a pixel tall or less, too thin to be a component.
  // Past the first and last bar, look just above the base for a sliver of the bars' color, bin by bin.
  function probeTinyBins(ctx, pts, w, col) {
    const { W, H, D, bg, left, right } = ctx;
    const P = pts.filter(p => !p.empty && p.box).sort((a, b) => a.px - b.px); if (P.length < 3) return;
    const sat = rgb2hsv(col[0], col[1], col[2])[1]; if (sat < 0.25) return;
    const base = median(P.map(p => p.box[3])) + 1, full = cdist(col, bg) || 1;
    const step = (P[P.length - 1].px - P[0].px) / Math.max(1, Math.round((P[P.length - 1].px - P[0].px) / w));
    const sliver = (xa, xb) => { let h = 0; for (let y = Math.round(base) - 1; y >= Math.round(base) - 8 && y >= 0; y--) { let t = 0, n = 0;
      // how much of the bar color is mixed into the background here (a gray axis line is not a mix of the two)
      for (let x = Math.round(xa) + 2; x <= Math.round(xb) - 2; x++) { const i = (y * W + x) * 4, u = [D[i] - bg[0], D[i + 1] - bg[1], D[i + 2] - bg[2]], v = [col[0] - bg[0], col[1] - bg[1], col[2] - bg[2]];
        const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] || 1, al = (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / vv, res = Math.hypot(u[0] - al * v[0], u[1] - al * v[1], u[2] - al * v[2]);
        t += res < 30 ? clamp(al, 0, 1) : 0; n++; }
      const c = n ? t / n : 0; if (c < 0.15) break; h += c; } return h; };
    const add = [];
    for (const dir of [1, -1]) {
      let edge = dir > 0 ? P[P.length - 1] : P[0], miss = 0, k = 1;
      const found = [];
      while (miss < 3) {
        const cx = edge.px + dir * k * step, xa = cx - w / 2, xb = cx + w / 2; if (xa < left || xb > right) break;
        const h = sliver(xa, xb);
        if (h >= 0.6) { found.push({ cx, h }); miss = 0; } else miss++;
        k++;
      }
      for (const f of found) add.push({ x: ctx.X(f.cx), y: ctx.Y(base - f.h) - ctx.Y(base), px: f.cx, py: base - f.h, box: [Math.round(f.cx - w / 2), Math.round(base - f.h), Math.round(f.cx + w / 2), Math.round(base - 1)], sd: 0.5, tiny: true });
    }
    pts.push(...add); pts.sort((a, b) => a.px - b.px);
  }
  // a histogram bin with a count of zero draws nothing; put it back where the run of bins has a hole
  function fillEmptyBins(ctx, pts, w) {
    const P = pts.filter(p => !p.empty && p.box).sort((a, b) => a.px - b.px), add = [];
    for (let k = 1; k < P.length; k++) {
      const gap = P[k].box[0] - P[k - 1].box[2] - 1, n = Math.round(gap / w);
      for (let j = 1; j <= n && gap > w * 0.6; j++) { const px = P[k - 1].px + j * (P[k].px - P[k - 1].px) / (n + 1); add.push({ x: ctx.X(px), y: 0, px, py: ctx.y0px, empty: true, sd: 0.5 }); }
    }
    pts.push(...add); pts.sort((a, b) => a.px - b.px);
  }
  // a waterfall: floating bars, each starting at the level where the one before it ended. Up and down steps are
  // usually two colors, so the bars of every color are read together. The value of each bar is its signed change.
  function readWaterfall(ctx, info) {
    const { Y, xCats, y0px } = ctx;
    const R = [];
    info.forEach(I => (I.rects || []).forEach(c => { if (c.fill == null || c.fill > 0.85) R.push(Object.assign({ color: I.color }, c)); }));
    if (R.length < 3) return null;
    const wMed = median(R.map(c => c.w)), B = R.filter(c => Math.abs(c.w - wMed) < Math.max(2, wMed * 0.2)).sort((a, b) => a.cx - b.cx);
    if (B.length < 3 || B.length < R.length * 0.8 || wMed < 4) return null;
    // two bars in one column are a stacked bar, not a step
    if (B.some((c, k) => k && c.xa < B[k - 1].xb - 2)) return null;
    const bases = B.map(c => c.yb);
    if (Math.max(...bases) - Math.min(...bases) < 4) return null;
    let L = y0px != null ? y0px : Math.max(...bases) + 1, links = 0;
    const pts = [];
    for (const c of B) {
      const top = c.ya, bot = c.yb + 1, dBot = Math.abs(bot - L), dTop = Math.abs(top - L);
      // a bar standing on the baseline away from the running level is a total: its value is the level itself
      const total = y0px != null && Math.abs(bot - y0px) <= 2 && Math.min(dBot, dTop) > 3 && pts.length;
      const up = total || dBot <= dTop;
      if (Math.min(dBot, dTop) <= 3 || total) links++;
      const cat = xCats && xCats.length ? xCats.reduce((b, q) => Math.abs(q.cx - c.cx) < Math.abs(b.cx - c.cx) ? q : b) : null;
      pts.push({ x: cat && Math.abs(cat.cx - c.cx) < wMed ? cat.label : 'Bar ' + (pts.length + 1), y: (up ? 1 : -1) * (Y(top) - Y(bot)), px: c.cx, py: up ? top : bot, sd: 0.6, total: !!total || undefined });
      L = up ? top : bot;
    }
    if (links < B.length * 0.8) return null;
    const cnt = {}; B.forEach(c => { cnt[c.color] = (cnt[c.color] || 0) + 1; });
    return { type: 'bar', waterfall: true, name: 'Change', color: Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0], points: pts, explained: 1 };
  }

  function measureBars(ctx, barLike, col) {
    const { W, H, D, Y, X, xNumeric, xCats, xSpacing, y0px, bg } = ctx;
    const pts = barLike.map((c, k) => {
      const upward = y0px == null || c.ya < y0px - 1;
      let edge = upward ? c.ya : c.yb + 1;
      // the row just past the edge is partly covered; its color tells how far the bar really reaches
      { const ry = upward ? c.ya - 1 : c.yb + 1, xa = c.xa + 2, xb = c.xb - 2;
        if (ry >= 0 && ry < H && xb > xa) { let t = 0, n = 0; const full = cdist(col, bg) || 1;
          for (let x = xa; x <= xb; x++) { const i = (ry * W + x) * 4; t += Math.min(1, Math.max(0, 1 - cdist([D[i], D[i + 1], D[i + 2]], col) / full)); n++; }
          const cov = n ? t / n : 0; if (cov > 0.08 && cov < 0.95 && ctx.opts.subpixel !== false) edge += upward ? -cov : cov; } }
      const label = catLabel(xCats, c.cx, c.w, xSpacing) || 'Bar ' + (k + 1);
      return { x: xNumeric ? barX(ctx, c.cx, c.w) : label, y: Y(edge), px: c.cx, py: edge, box: [c.xa, c.ya, c.xb, c.yb], sd: 0.35 };
    });
    if (xCats && xCats.length > pts.length && pts.every(p => !/^Bar \d/.test(p.x)) && y0px != null) {
      // a category with a label but no visible bar has a value of zero
      for (const c of xCats) if (!pts.some(p => p.x === c.label)) pts.push({ x: c.label, y: 0, px: c.cx, py: y0px, empty: true, sd: 0.5 });
      pts.sort((a, b) => a.px - b.px);
    }
    return pts;
  }

  function readStacked(ctx, info, colsR, out) {
    const { Y, X, xNumeric, xCats, xSpacing, y0px } = ctx;
    // a column much thinner than the others is a legend swatch, not a bar
    const cw = median(colsR.map(g => g.xb - g.xa + 1));
    const cols = colsR.filter(g => g.items.length >= 1 && g.xb - g.xa + 1 >= cw * 0.55).sort((a, b) => (a.xa + a.xb) - (b.xa + b.xb));
    const bySeries = info.map(I => ({ type: 'bar', color: I.color, stacked: true, points: [] }));
    for (const g of cols) {
      // a small swatch lying across a bar is not one of its segments
      const it = g.items.filter(r => r.c.w >= (g.xb - g.xa + 1) * 0.6).sort((a, b) => b.c.yb - a.c.yb);    // bottom first
      const cx = (g.xa + g.xb) / 2, label = xNumeric ? barX(ctx, cx, g.xb - g.xa) : (catLabel(xCats, cx, g.xb - g.xa, xSpacing) || 'Bar ' + (cols.indexOf(g) + 1));
      it.forEach((r, k) => {
        // split the gap between touching segments evenly (white separator lines)
        const below = it[k - 1], above = it[k + 1];
        let bot = below ? (below.c.ya + r.c.yb + 1) / 2 : r.c.yb + 1;
        // the lowest segment stands on zero (its first pixels can sit under the axis line or past the plot edge)
        if (!below && y0px != null && Math.abs(bot - y0px) <= Math.max(8, (ctx.bottom - ctx.top) * 0.03)) bot = y0px;
        const topE = above ? (r.c.ya + above.c.yb + 1) / 2 : r.c.ya;
        const pt = { x: label, y: Y(topE) - Y(bot), px: cx, py: topE, base: bot, box: [r.c.xa, r.c.ya, r.c.xb, r.c.yb], sd: 0.5 };
        const S = bySeries[r.j];
        if (!S.points.some(p => p.px === cx)) S.points.push(pt);
      });
      bySeries.forEach(S => { if (!S.points.some(p => p.px === cx)) S.points.push({ x: label, y: 0, px: cx, py: y0px, empty: true, sd: 0.5 }); });
    }
    bySeries.forEach(S => { if (S.points.some(p => !p.empty)) out.push(S); });
  }

  // values of a step line: one per flat run, plus the stub at whichever end has one
  function readStep(ctx, tr, runs, mask, col) {
    const { Y, X, xNumeric, xTick, xCats, xSpacing, W, top, bottom, D, bg } = ctx;
    const x0 = tr[0][0], x1 = tr[tr.length - 1][0];
    const segs = runs.map(r => ({ a: tr[r.i0][0], b: tr[r.i0 + r.n - 1][0], y: r.y }));
    const m = segs.length;
    // the data x values are where the line jumps, plus both ends
    const B = [x0]; for (let k = 1; k < m; k++) B.push((segs[k - 1].b + segs[k].a) / 2); B.push(x1);
    // the vertical extent of ink around y in a column, and the line's own thickness away from the ends
    const extent = (x, y) => { let best = null; for (const dx of [0, 1, -1, 2, -2]) { const xx = Math.round(x + dx); if (xx < 0 || xx >= W) continue;
      let a = Math.round(y), b = a; if (!mask[a * W + xx]) { let d = 1; while (d < 4 && !mask[(a + d) * W + xx] && !mask[(a - d) * W + xx]) d++; if (d >= 4) continue; a = b = mask[(a + d) * W + xx] ? a + d : a - d; }
      while (a - 1 > top && mask[(a - 1) * W + xx]) a--; while (b + 1 < bottom && mask[(b + 1) * W + xx]) b++;
      if (!best || b - a > best[1] - best[0]) best = [a, b]; } return best; };
    const mid = segs.reduce((q, s) => s.b - s.a > q.b - q.a ? s : q), e0 = extent((mid.a + mid.b) / 2, mid.y), thick = e0 ? e0[1] - e0[0] + 1 : 2;
    // a stub is a vertical stroke at an end, longer than the line is thick: its far end is the value it shows
    const stub = (x, y) => { const e = extent(x, y); if (!e || e[1] - e[0] + 1 < thick + 2.5) return null; return Math.abs(e[0] - y) > Math.abs(e[1] - y) ? e[0] + thick / 2 - 0.5 : e[1] - thick / 2 + 0.5; };
    // a stub at the very edge of the plot is often clipped to half its width and drawn faint: look for pixels that
    // are a blend of the line color and the background in the end columns
    const blend = i => { if (!col || !D || !bg) return false; let num = 0, den = 0; for (let c = 0; c < 3; c++) { const d = col[c] - bg[c]; num += (D[i + c] - bg[c]) * d; den += d * d; }
      const al = den ? num / den : 0; if (al < 0.25 || al > 1.3) return false; let res = 0; for (let c = 0; c < 3; c++) res += (D[i + c] - bg[c] - al * (col[c] - bg[c])) ** 2; return Math.sqrt(res) < 16 + 10 * al; };
    const faint = (x, y, side) => { let best = null; for (const dx of [0, side, 2 * side, 3 * side]) { const xx = Math.round(x + dx); if (xx < 0 || xx >= W) continue; let a = Math.round(y), b = a, gap = 0;
        for (let yy = a - 1; yy > top && gap <= 1; yy--) { if (blend((yy * W + xx) * 4) || mask[yy * W + xx]) { a = yy; gap = 0; } else gap++; }
        gap = 0; for (let yy = b + 1; yy < bottom && gap <= 1; yy++) { if (blend((yy * W + xx) * 4) || mask[yy * W + xx]) { b = yy; gap = 0; } else gap++; }
        if (!best || b - a > best[1] - best[0]) best = [a, b]; } return best; };
    const stubF = (x, y, side) => { const e = faint(x, y, side); if (!e || e[1] - e[0] + 1 < thick + 3.5) return null; return Math.abs(e[0] - y) > Math.abs(e[1] - y) ? e[0] + thick / 2 - 0.5 : e[1] - thick / 2 + 0.5; };
    let head = stub(x0, segs[0].y), tail = stub(x1, segs[m - 1].y);
    if (head == null && tail == null) { const hf = stubF(x0, segs[0].y, -1), tf = stubF(x1, segs[m - 1].y, 1); if ((hf == null) !== (tf == null)) { head = hf; tail = tf; } }
    // no clear stub at either end: a stub of a pixel or so still shows which end carries the extra value
    const grow = (x, y) => { const e = extent(x, y); return e ? e[1] - e[0] + 1 - thick : 0; };
    const hg = head == null && tail == null ? grow(x0, segs[0].y) : 0, tg = head == null && tail == null ? grow(x1, segs[m - 1].y) : 0;
    const softPre = hg >= 1 && tg <= 0, softPost = tg >= 1 && hg <= 0;
    const post = tail != null || (head == null && !softPre);
    ctx.stepAmbiguous = head == null && tail == null && !softPre && !softPost;
    // snap the data x values onto their grid
    const xs = B.map(px => X(px));
    let snapped = xs;
    if (xNumeric && ctx.xDate) {
      const d = median(xs.slice(1).map((v, k) => v - xs[k]));
      const iso = v => { const t = new Date(Math.round(v) * 864e5); return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()]; };
      if (d > 25 && d < 400) { const mo = d > 300 ? 12 : d > 80 ? 3 : 1; snapped = xs.map(v => { const [y, mth, dd] = iso(v + (dd => 0)()); const a = Date.UTC(y, mth, 1) / 864e5, b = Date.UTC(y, mth + 1, 1) / 864e5; return v - a < b - v ? a : b; }); if (mo > 1) snapped = snapped; }
      else { const st = d > 5 ? 7 : 1, o = Math.round(xs[0]); snapped = xs.map(v => o + Math.round((v - o) / st) * st); }
    } else if (xNumeric && xTick) {
      const d = median(xs.slice(1).map((v, k) => Math.abs(v - xs[k])).filter(v => v > 0));
      if (d > 0) { const st = [1, 2, 2.5, 4, 5, 10, 12, 0.5, 0.2, 0.1].map(q => xTick / q).reduce((b, c) => Math.abs(Math.log(c / d)) < Math.abs(Math.log(b / d)) ? c : b);
        const q = xTick / 10; let o = Math.round(xs[0] / q) * q; o = o - Math.floor(o / st) * st; if (Math.abs(o - st) < q / 2) o = 0;
        snapped = xs.map(v => +(o + Math.round((v - o) / st) * st).toFixed(6)); }
    }
    // the data x positions: category labels when there are any, else the jump positions snapped to the grid
    let G = null, gx = null;
    if (!xNumeric && xCats && xCats.length >= 2) { const c = xCats.filter(q => q.cx >= x0 - xSpacing * 0.3 && q.cx <= x1 + xSpacing * 0.3); if (c.length >= 2) { G = c.map(q => q.cx); gx = c.map(q => q.label); } }
    else if (xNumeric && ctx.xcal) { const u = []; snapped.forEach(v => { if (!u.some(w => Math.abs(w - v) < 1e-9)) u.push(v); }); const px = u.map(v => ctx.xcal.toPixel(v)); if (px.every(isFinite) && u.length >= 2) { G = px; gx = u; } }
    if (G) {
      // the line's height just right (or left) of each data x, away from the jumps
      const yAt = (a, b) => { const v = tr.filter(t => t[0] >= Math.min(a, b) && t[0] <= Math.max(a, b)).map(t => t[1]); return v.length ? median(v) : null; };
      const n = G.length, gap = k => k + 1 < n ? G[k + 1] - G[k] : G[k] - G[k - 1];
      const right = k => yAt(G[k] + gap(k) * 0.2, G[k] + gap(k) * 0.8), left = k => yAt(G[k] - gap(k - 1 < 0 ? 0 : k - 1) * 0.8, G[k] - gap(k - 1 < 0 ? 0 : k - 1) * 0.2);
      const vals = post ? G.map((g, k) => k < n - 1 ? right(k) : (tail != null ? tail : left(k))) : G.map((g, k) => k === 0 ? (head != null ? head : right(0)) : left(k));
      if (vals.every(v => v != null)) return vals.map((py, k) => ({ x: gx[k], y: Y(py), px: G[k], py, sd: 0.5 }));
    }
    const xAt = k => xNumeric ? snapped[k] : catLabel(xCats, B[k], 1, xSpacing) || X(B[k]);
    const vals = post ? segs.map(s => s.y).concat([tail != null ? tail : segs[m - 1].y]) : [head != null ? head : segs[0].y].concat(segs.map(s => s.y));
    return vals.map((py, k) => ({ x: xAt(k), y: Y(py), px: B[k], py, sd: 0.5 }));
  }

  // ---------- the main entry point ----------
  // img: {data, width, height} (RGBA). words: [{text, conf, x0, y0, x1, y1}] in image pixels.
  // opts.type: 'auto' or a chart family to force. opts.calib: manual axis calibration.
  // grainy pictures (noise, a scan) break solid areas into specks. Flat regions of a clean chart have neighbouring
  // pixels that match exactly, so the typical step between neighbours tells how grainy the picture is.
  function noiseLevel(img) {
    const { width: W, height: H, data: D } = img, d = [];
    for (let k = 0; k < 6000; k++) { const x = 1 + ((k * 7919) % (W - 2)), y = 1 + ((k * 104729) % (H - 2)), i = (y * W + x) * 4;
      d.push(Math.abs(D[i] - D[i + 4]) + Math.abs(D[i + 1] - D[i + 5]) + Math.abs(D[i + 2] - D[i + 6])); }
    return median(d) / 3;
  }
  // hybrid median: the median of (median of the + shape, median of the x shape, the pixel itself). Removes specks
  // like a 3x3 median but keeps thin lines in any direction.
  function median3(img) {
    const { width: W, height: H, data: D } = img, O = new Uint8ClampedArray(D);
    const m5 = (a, b, c, d, e) => { const v = [a, b, c, d, e].sort((p, q) => p - q); return v[2]; };
    const m3 = (a, b, c) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) for (let c = 0; c < 3; c++) {
      const i = (y * W + x) * 4 + c, r = W * 4, v = D[i];
      O[i] = m3(m5(v, D[i - 4], D[i + 4], D[i - r], D[i + r]), m5(v, D[i - r - 4], D[i - r + 4], D[i + r - 4], D[i + r + 4]), v);
    }
    return { width: W, height: H, data: O };
  }

  // the main entry point reads the chart twice: once as is, once with the colors split more finely and no tick
  // snapping. A read that does not change is far more often right, so how much the two agree feeds the confidence.
  // with the mark model there are two reads: the color groups checked by the model, and the model's own groups.
  // The more confident one is kept (opts.segPick=false keeps the first)
  function extract(img, words, opts = {}) {
    if (!opts.seg || opts.segMode || opts.segPick === false) return extractOne(img, words, opts);
    const a = extractOne(img, words, opts);
    let b = null; try { b = extractOne(img, words, Object.assign({}, opts, { segMode: 'full' })); } catch (e) { b = null; }
    if (!b || !b.ok) return a;
    // do the two reads tell the same story (type, series, points within 1% of the axis span)
    let agree = 0;
    if (a.ok && a.chartType === b.chartType && a.series.length === b.series.length) {
      const span = a.axis && a.axis.yRange ? Math.abs(a.axis.yRange[1] - a.axis.yRange[0]) || 1 : 100;
      agree = a.series.every((s, k) => s.points.length === b.series[k].points.length && s.points.every((p, i) => typeof p.y !== 'number' || Math.abs(p.y - b.series[k].points[i].y) <= span * 0.01)) ? 1 : 0.5;
    }
    // both reads are scored with the agreement known, then the more confident one is kept
    // (pies keep their own confidence, the mark model plays no part in reading them)
    const rescore = (r, m) => { if (!r.ok || !r.features || r.chartType === 'pie' || r.chartType === 'donut') return; r.features.seg_agree = agree; r.features.seg_model = m; r.confidence = confidence(r.features, r.chartType); r.reliable = r.confidence >= THRESH && !r.issues.some(i => HARD.has(i.code)); };
    rescore(a, 0); rescore(b, 1);
    const ca = a.ok ? a.confidence || 0 : -1, cb = b.confidence || 0;
    const r = cb > ca ? b : a;
    r.segRead = r === b ? 'model' : 'color';
    return r;
  }
  function extractOne(img, words, opts = {}) {
    const r = extract1(img, words, opts);
    if (!r.ok || opts.second || opts.check === false || r.chartType === 'pie' || r.chartType === 'donut' || !r.features) return r;
    // (the second read also runs on a copy at 70% size, so it is not just the same pixels again)
    let r2 = null; try { const k = 0.7, sm = scaleImg(img, k), sw = words.map(w => Object.assign({}, w, { x0: w.x0 * k, x1: w.x1 * k, y0: w.y0 * k, y1: w.y1 * k }));
      r2 = extract1(sm, sw, Object.assign({}, opts, { seg: opts.seg && segScale(opts.seg, sm.width, sm.height), second: true, hueGap: 24, mergeDist: 55, snap: false })); } catch (e) { r2 = null; }
    const span = r.axis && r.axis.yRange ? Math.abs(r.axis.yRange[1] - r.axis.yRange[0]) || 1 : 1;
    let agree = 0, diff = 1;
    if (r2 && r2.ok && r2.chartType === r.chartType && r2.series.length === r.series.length) {
      agree = 0.5; const ds = [];
      const used = new Set();
      for (const s of r.series) {
        const o = r2.series.filter((q, k) => !used.has(k)).reduce((b, q) => !b || cdist(unhex(q.color), unhex(s.color)) < cdist(unhex(b.color), unhex(s.color)) ? q : b, null);
        if (!o) { ds.push(1); continue; } used.add(r2.series.indexOf(o));
        if (o.points.length !== s.points.length) { ds.push(1); continue; }
        ds.push(mean(s.points.map((p, k) => Math.min(1, Math.abs(p.y - o.points[k].y) / span))));
      }
      diff = Math.max(...ds);
      if (diff < 0.01) agree = 1;
    }
    r.features.agree = agree; r.features.alt_diff = Math.min(1, diff);
    r.confidence = confidence(r.features, r.chartType);
    r.reliable = r.confidence >= THRESH && !r.issues.some(i => HARD.has(i.code));
    return r;
  }

  // a slanted "2016-05" often reads as two words, "2016-" and "05" just to its right and a little higher.
  // Put them back together so the date row can be read.
  function joinSlantedDates(words) {
    const used = new Set(), out = [];
    for (const a of words) {
      if (used.has(a)) continue;
      const m = /^(\d{4})([-/.])(\d?)$/.exec(a.text);
      if (!m) { out.push(a); continue; }
      const h = a.y1 - a.y0;
      const b = words.find(q => q !== a && !used.has(q) && /^\d{1,2}$/.test(q.text) && Math.abs(q.x0 - a.x1) <= h * 0.5 && q.y1 >= a.y0 - h * 0.4 && q.y0 <= a.y0 + h * 0.3);
      if (!b) { out.push(a); continue; }
      used.add(b);
      const mm = b.text.length === 2 ? b.text : m[3] + b.text;
      out.push(Object.assign({}, a, { text: m[1] + m[2] + mm, x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), conf: Math.min(a.conf, b.conf) }));
    }
    return out.filter(w => !used.has(w));
  }

  // area-averaged resize (k < 1)
  function scaleImg(img, k) {
    const W = img.width, H = img.height, w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k)), D = img.data, O = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const xa = Math.floor(x / k), xb = Math.min(W, Math.floor((x + 1) / k)), ya = Math.floor(y / k), yb = Math.min(H, Math.floor((y + 1) / k));
      let r = 0, g = 0, b = 0, n = 0; for (let yy = ya; yy < Math.max(yb, ya + 1); yy++) for (let xx = xa; xx < Math.max(xb, xa + 1); xx++) { const i = (yy * W + xx) * 4; r += D[i]; g += D[i + 1]; b += D[i + 2]; n++; }
      const o = (y * w + x) * 4; O[o] = r / n; O[o + 1] = g / n; O[o + 2] = b / n; O[o + 3] = 255;
    }
    return { width: w, height: h, data: O };
  }

  function extract1(img, words, opts = {}) {
    const t0 = Date.now();
    if (opts.denoise !== false && noiseLevel(img) > 3) img = median3(img);
    // OCR sometimes reads big solid shapes (bars, slices) as letters. Real words on a chart are about as tall as the
    // other words, so very tall, unsure "words" are dropped.
    const hm = median(words.map(w => w.y1 - w.y0).filter(h => h > 2));
    words = words.filter(w => !(w.y1 - w.y0 > hm * 2.6 && (w.conf || 0) < 85 && !parseNumber(w.text)));
    // and "words" far wider than their letters could ever be (a bar read as "{TE")
    words = words.filter(w => !((w.x1 - w.x0) > (w.y1 - w.y0) * (1.2 * w.text.length + 2) && (w.conf || 0) < 90));
    words = joinSlantedDates(words);
    const type = opts.type || 'auto';
    let res = null;
    if (type === 'pie' || type === 'donut' || type === 'auto') {
      res = readPie(img, words, { force: type !== 'auto', debug: opts.debug });
      if (!res && type !== 'auto') return finish({ ok: false, code: 'no_pie', error: 'I could not find a round pie or donut in the picture.' }, opts, t0);
    }
    if (!res) {
      const horiz = type === 'hbar' || type === 'stacked_hbar' || !!(opts.calib && opts.calib.axis === 'x');
      const vert = type !== 'auto' && !horiz;
      let v = null, h = null;
      if (!horiz) v = core(img, words, opts);
      // try the chart on its side when the vertical read did not find a numeric axis or found bars lying down
      const wantH = horiz || (!vert && (!v.ok || looksHorizontal(v, img, words)));
      if (wantH) {
        h = readHorizontal(img, words, opts);
        // dots against month names on the side are a dot plot of categories, not a time axis
        if (h && h.ok && h.xDate && h.series.length && h.series.every(s => s.type === 'scatter')) { const h2 = readHorizontal(img, words, Object.assign({}, opts, { noDates: true })); if (h2 && h2.ok) h = h2; }
        // read on its side, only bars make sense (a line or area chart turned sideways is a misread), or dots
        // against category labels (a dot plot)
        const dotPlot = h && h.ok && !h.xNumeric && h.series.length && h.series.every(s => s.type === 'scatter');
        if (dotPlot) h.dotPlot = true;
        if (h && h.ok && (horiz || h.series.some(s => s.type === 'bar') || (dotPlot && (!v || !v.ok)))) res = h;
      }
      if (!res) res = v && v.ok ? v : (h && h.ok && (horiz || h.series.some(s => s.type === 'bar')) ? h : (v || h));
      // no value axis anywhere: the numbers printed on the bars can stand in for it
      if (!res.ok && !opts.calib) {
        const ls = labelScale(img, words);
        if (ls) {
          const o2 = Object.assign({}, opts, { calib: ls.calib });
          const r2 = ls.orient === 'h' ? readHorizontal(img, words, o2) : core(img, words, o2);
          if (r2 && r2.ok && r2.series.some(s => s.type === 'bar')) { r2.notes.push('There is no value axis, so the scale comes from the numbers printed on the bars.'); r2.labelScale = true; res = r2; }
        }
      }
    }
    return finish(res, opts, t0, img, words);
  }

  // ---------- a scale from the value labels printed on the bars ----------
  // Some bar charts have no value axis at all, only a number at the end of each bar. With the bars' shared
  // starting edge as zero, those numbers give the scale. Returns a calibration for the axis-by-hand path, or null.
  function labelScale(img, words) {
    const W = img.width, H = img.height, D = img.data, N = W * H;
    const bg = plotBackground(D, W, { left: 0, right: W - 1, top: 0, bottom: H - 1 });
    const m = new Uint8Array(N), wm = new Uint8Array(N);
    for (const w of words) for (let y = Math.max(0, Math.floor(w.y0)); y < Math.min(H, Math.ceil(w.y1)); y++) for (let x = Math.max(0, Math.floor(w.x0)); x < Math.min(W, Math.ceil(w.x1)); x++) wm[y * W + x] = 1;
    for (let p = 0, i = 0; p < N; p++, i += 4) { if (wm[p]) continue; const c = [D[i], D[i + 1], D[i + 2]]; if (cdist(c, bg) > 50 && rgb2hsv(c[0], c[1], c[2])[1] > 0.2) m[p] = 1; }
    const rects = components(m, W, H, 0, 0, W, H).comps.filter(c => c.fill > 0.8 && c.w >= 4 && c.h >= 4 && c.n >= 60);
    if (rects.length < 2) return null;
    const lead = t => { const q = String(t).replace(/[−\u2013]/g, '-').match(/^\(?-?[$€£]?\d[\d,]*\.?\d*\s*(k|K|M|B|bn|million|billion)?%?/); return q ? parseNumber(q[0]) : null; };
    const nums = words.map(w => ({ w, n: lead(w.text), cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2 })).filter(q => q.n);
    const out = [];
    for (const orient of ['h', 'v']) {
      // bars: rects in the same row (h) or column (v) joined, so stacked segments make one bar
      const key = orient === 'h' ? (r => [r.ya, r.yb]) : (r => [r.xa, r.xb]);
      const bars = [];
      for (const r of rects) {
        const [a, b] = key(r);
        const g = bars.find(g => Math.min(g.b, b) - Math.max(g.a, a) > 0.6 * Math.min(g.b - g.a, b - a));
        if (g) { g.a = Math.min(g.a, a); g.b = Math.max(g.b, b); g.s = Math.min(g.s, orient === 'h' ? r.xa : -r.yb); g.e = Math.max(g.e, orient === 'h' ? r.xb + 1 : -r.ya + 1); }
        else bars.push({ a, b, s: orient === 'h' ? r.xa : -r.yb, e: orient === 'h' ? r.xb + 1 : -r.ya + 1 });
      }
      if (bars.length < 2) continue;
      const starts = bars.map(g => g.s), base = median(starts);
      if (starts.filter(v => Math.abs(v - base) <= 2).length < Math.max(2, bars.length * 0.7)) continue;
      const pairs = [];
      for (const g of bars) {
        const mid = (g.a + g.b) / 2, th = g.b - g.a;
        // the number right after the end of the bar, level with it
        let best = null, bd = 1e9;
        for (const q of nums) {
          const along = orient === 'h' ? q.w.x0 - g.e : -q.w.y1 - g.e, across = orient === 'h' ? Math.abs(q.cy - mid) : Math.abs(q.cx - mid);
          if (along < -4 || along > Math.max(40, th * 2.5) || across > Math.max(th * 0.6, 6)) continue;
          if (along < bd) { bd = along; best = q; }
        }
        if (best) pairs.push({ p: orient === 'h' ? g.e : -g.e, v: best.n.v });
      }
      if (pairs.length < 2) continue;
      const basePx = orient === 'h' ? base : -base;
      const f = fitAxis(pairs.concat([{ p: basePx, v: 0 }]), { log: false });
      if (!f || f.inliers < Math.min(pairs.length + 1, 4) || f.inliers < (pairs.length + 1) * 0.8) continue;
      const cal = pairs.filter(q => Math.abs(f.toValue(q.p) - q.v) <= Math.abs(f.slope) * 2).concat([{ p: basePx, v: 0 }]);
      out.push({ orient, n: pairs.length, calib: orient === 'h' ? { axis: 'x', y: cal.map(q => ({ p: q.p, v: q.v, y: H - 1 })) } : { y: cal.map(q => ({ p: q.p, v: q.v, x: Math.max(0, Math.min(...bars.map(g => g.a)) - 3) })) } });
    }
    out.sort((a, b) => b.n - a.n);
    return out[0] || null;
  }

  // do the words contain a real numeric axis (a column or a row of 3+ numbers that line up)?
  function hasStrongAxes(words, W, H) {
    const ax = findAxes(words, W, H);
    const colOk = ax.yCol && ax.yCol.length >= 3 && ax.yCol.fit && ax.yCol.fit.inliers >= 3;
    const rowNums = ax.xRow ? ax.xRow.filter(q => q.n) : [];
    const rowOk = rowNums.length >= 3 && fitAxis(rowNums.map(q => ({ p: q.cx, v: q.n.v })));
    return !!(colOk || (rowOk && fitAxis(rowNums.map(q => ({ p: q.cx, v: q.n.v }))).inliers >= 3));
  }

  // the vertical read found bars whose shared edge is vertical (they lie down), or found no value axis at all
  function looksHorizontal(v, img, words) {
    if (!v.ok) return true;
    if (v.series.some(s => s.type === 'bar')) return false;
    // flat rectangles stacked vertically that all start at the same x
    return v.hbarHint >= 2;
  }

  function readHorizontal(img, words, opts) {
    const W = img.width, H = img.height;
    const fimg = flipImg(img);
    // only numbers and words inside the chart go to the vertical reader; the category names are matched afterwards
    const fw = joinPhrases(words).map(w => flipWord(w, W, H));
    if (opts.calib && opts.calib.axis === 'x') opts = Object.assign({}, opts, { calib: { yLog: opts.calib.yLog, y: opts.calib.y.map(q => ({ p: W - 1 - q.p, v: q.v, x: q.y != null ? H - 1 - q.y : undefined })) } });
    const r = core(fimg, fw, Object.assign({}, opts, { seg: opts.seg && segFlip(opts.seg), type: opts.type === 'stacked_hbar' ? 'stacked_bar' : opts.type === 'hbar' ? 'bar' : opts.type, xWords: catWordsH(fw, W), flipped: true }));
    if (!r.ok) return r;
    // map everything back: flipped (x', y') -> original (W-1-y', H-1-x')
    const back = (px, py) => [W - 1 - py, H - 1 - px];
    r.series.forEach(s => {
      s.points.forEach(p => {
        if (p.px != null && p.py != null) { const [x, y] = back(p.px, p.py); p.px = x; p.py = y; }
        if (p.box) { const b = p.box; p.box = [W - 1 - b[3], H - 1 - b[2], W - 1 - b[1], H - 1 - b[0]]; }
        if (p.base != null) p.base = W - 1 - p.base;
      });
      if (s.trace) s.trace = s.trace.map(([x, y]) => back(x, y));
      if (s.type === 'bar') s.points.sort((a, b) => a.py - b.py);   // top to bottom
    });
    // category names: words left of the plot, level with each bar
    const rc = r.rect; const plotLeft = W - 1 - rc.bottom;
    const cats = words.filter(w => w.x1 < plotLeft + 4 && !/^[-\u2013]$/.test(w.text)).map(w => ({ ...w, cy: (w.y0 + w.y1) / 2 }));
    const lines = groupBy(cats, q => q.cy, 4).map(g => ({ text: g.sort((a, b) => a.x0 - b.x0).map(q => q.text).join(' '), cy: g.k, x1: Math.max(...g.map(q => q.x1)) }));
    r.series.forEach(s => s.points.forEach(p => {
      if (r.xNumeric || (typeof p.x === 'string' && !/^Bar \d/.test(p.x))) return;
      const near = lines.reduce((b, q) => !b || Math.abs(q.cy - p.py) < Math.abs(b.cy - p.py) ? q : b, null);
      const hgt = p.box ? p.box[3] - p.box[1] : 10;
      if (near && Math.abs(near.cy - p.py) < Math.max(hgt * 0.8, 6) && /[A-Za-z0-9]/.test(near.text)) p.x = near.text.replace(/[^\w\s.\-%/&'$€£]/g, '');
    }));
    r.rect = { left: W - 1 - rc.bottom, right: W - 1 - rc.top, top: H - 1 - rc.right, bottom: H - 1 - rc.left };
    r.orient = 'h';
    return r;
  }
  // in the flipped picture, the category names that sat left of the plot now sit below it, lined up by their
  // original right (or left) edge. Those become the x labels of the vertical read.
  function catWordsH(fw, H2) {
    const ws = fw.filter(w => w.conf > 40 && !/^[-\u2013_.|]+$/.test(w.text)).map(w => ({ ...w, cx: (w.x0 + w.x1) / 2, cy: (w.y0 + w.y1) / 2, h: w.y1 - w.y0, n: parseNumber(w.text) }));
    let best = null;
    for (const key of [q => q.y0, q => q.y1]) {
      for (const g of groupBy(ws, key, 4)) {
        if (g.length < 2 || g.k < H2 * 0.35) continue;
        if (!best || g.length > best.length || (g.length === best.length && g.k > best.k)) best = g;
      }
    }
    return best ? best.sort((a, b) => a.cx - b.cx) : [];
  }
  // words on one line next to each other become one phrase ("Q1" + "2023")
  function joinPhrases(words) {
    const ws = [...words].sort((a, b) => a.x0 - b.x0).map(w => ({ ...w })), out = [];
    for (const w of ws) {
      const h = w.y1 - w.y0;
      const prev = out.find(o => Math.abs((o.y0 + o.y1) / 2 - (w.y0 + w.y1) / 2) < h * 0.4 && w.x0 - o.x1 > -2 && w.x0 - o.x1 < h * 0.8 && /[A-Za-z]/.test(o.text + w.text) && !(parseNumber(o.text) && parseNumber(w.text)));
      if (prev) { prev.text += ' ' + w.text; prev.x1 = w.x1; prev.y0 = Math.min(prev.y0, w.y0); prev.y1 = Math.max(prev.y1, w.y1); prev.conf = Math.min(prev.conf, w.conf); }
      else out.push(w);
    }
    return out;
  }

  // ---------- results: chart type, error bars, confidence ----------
  function finish(r, opts, t0, img, words) {
    if (!r || !r.ok) return Object.assign({ ok: false, error: 'I could not read this chart.', code: 'unknown' }, r || {}, { ms: Date.now() - t0, confidence: 0, reliable: false });
    if (r.chartType === 'pie' || r.chartType === 'donut') {
      r.issues = [];
      if (!r.features.usedLabels && r.series[0].points.some(p => /^Slice \d/.test(p.x))) r.issues.push({ code: 'pie_names', text: 'I could not match every slice to a name.' });
      if (r.features.legendExtra) r.issues.push({ code: 'pie_legend', text: `The legend lists ${r.features.legendExtra} more name${r.features.legendExtra > 1 ? 's' : ''} than I found slices, so two slices in the same color were probably read as one.` });
      // many slivers mean the colors fell apart (grain, a gradient), not a pie of many tiny shares
      if (r.features.tiny >= 3) r.issues.push({ code: 'pie_slivers', text: `${r.features.tiny} slices are under 1%, which usually means the colors did not separate cleanly.` });
      r.confidence = pieConfidence(r.features);
      r.reliable = r.confidence >= THRESH && !r.issues.some(i => i.code === 'pie_legend' || i.code === 'pie_slivers');
      r.ms = Date.now() - t0;
      r.flags = pieFlags(r);
      return r;
    }
    const S = r.series;
    const types = new Set(S.map(s => s.type));
    let ct;
    if (S.some(s => s.waterfall)) ct = 'waterfall';
    else if (r.dotPlot || (r.orient === 'h' && S.length && S.every(s => s.type === 'scatter'))) ct = 'dot_plot';
    else if (S.length && S.every(s => s.lollipop)) ct = 'lollipop';
    else if (r.orient === 'h') ct = S.some(s => s.stacked) ? 'stacked_hbar' : 'hbar';
    else if (S.some(s => s.type === 'bar' && s.stacked)) ct = 'stacked_bar';
    else if (types.has('bar') && (types.has('line') || types.has('area'))) ct = 'bar_line';
    else if (types.has('bar')) ct = S.filter(s => s.type === 'bar').length > 1 ? 'grouped_bar' : (S[0].contiguous && (r.xNumeric || S[0].profile) ? 'histogram' : 'bar');
    else if (types.has('area')) ct = S.some(s => s.stacked) ? 'stacked_area' : 'area';
    else if (types.has('step')) ct = 'step';
    else if (types.has('scatter') && !types.has('line')) ct = 'scatter';
    else ct = 'line';
    if (opts.type && opts.type !== 'auto') ct = opts.type;
    r.chartType = ct;
    // 100% stacked bars: when most columns add up to 100, a column short of it with one segment missing (under the
    // legend, or too thin to see) gets that segment back as what is left
    if ((ct === 'stacked_bar' || ct === 'stacked_hbar') && r.yPct && S.length >= 2) {
      const n = Math.min(...S.map(s => s.points.length));
      if (S.every(s => s.points.length === n) && n >= 2) {
        const col = k => S.map(s => s.points[k]), sum = k => col(k).reduce((a, p) => a + (p.empty ? 0 : p.y), 0);
        const full = [...Array(n).keys()].filter(k => col(k).every(p => !p.empty && p.y > 0.5));
        if (full.length >= Math.max(2, n * 0.6) && full.every(k => Math.abs(sum(k) - 100) <= 2))
          for (let k = 0; k < n; k++) {
            const miss = col(k).filter(p => p.empty || p.y <= 0.5);
            if (miss.length !== 1 || sum(k) > 98) continue;
            miss[0].y = 100 - sum(k) + (miss[0].empty ? 0 : miss[0].y); miss[0].empty = false; miss[0].guess = true;
          }
      }
    }
    // error bars from pixel resolution plus the axis fit
    const yc = r.ycal;
    S.forEach(s => {
      const cal = s.axis === 'right' && r.yRightCal ? r.yRightCal : yc;
      s.points.forEach(p => {
        if (p.py == null || p.empty) { p.err = [Math.abs(yc.slope) * 1.0, Math.abs(yc.slope) * 1.0]; return; }
        const pyV = r.orient === 'h' ? null : p.py;
        const b = cal.band(pyV != null ? pyV : cal.mp, p.sd || 0.5);
        if (p.base != null) { const b2 = cal.band(p.base, 0.5); p.err = [Math.hypot(b[0], b2[0]), Math.hypot(b[1], b2[1])]; }
        else p.err = b;
        if (W8 && W8.band_k) p.err = p.err.map(v => v * W8.band_k);
        delete p.sd;
      });
    });
    // honesty and reliability issues
    r.issues = [];
    const ax = r.ax, ycal = r.ycal;
    const issue = (code, text) => { if (!r.issues.some(i => i.code === code && i.text === text)) r.issues.push({ code, text }); r.nIssues = (r.nIssues || 0) + 1; };
    if (ycal.inliers < 3) issue('few_labels', 'Only two axis labels lined up, so one misread label would shift every value.');
    if (ycal.inliers < ycal.total) r.notes.push(`Ignored ${ycal.total - ycal.inliers} axis label(s) that did not fit the scale.`);
    if (ycal.rsdPx > 2.5) issue('axis_noise', 'The axis labels do not sit evenly, so the scale itself is uncertain.');
    for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) if (cdist(unhex(S[a].color), unhex(S[b].color)) < 60) issue('similar_colors', 'Two series have nearly the same color and may be mixed up.');
    S.forEach(s => {
      if (s.type === 'line' && s.doubled > 0.25) issue('merged_lines', `"${s.name}" looks like two lines in the same color merged together.`);
      if (s.type === 'step' && s.ambiguous) issue('step_ambiguous', `I cannot tell whether each value of "${s.name}" starts or ends its step, so its values may be shifted by one step.`);
      if ((s.type === 'line' || s.type === 'area') && s.coverage < 0.25) issue('short_trace', `I could only follow "${s.name}" across ${Math.round(s.coverage * 100)}% of the plot.`);
    });
    if (r.hidden) issue('legend_over_data', `The legend covers ${r.hidden} data point${r.hidden > 1 ? 's' : ''}, so ${r.hidden > 1 ? 'those values are' : 'that value is'} a guess.`);
    if (r.orphans) issue('legend_extra', `The legend shows ${r.orphans} more color${r.orphans > 1 ? 's' : ''} than the series I found, so a series may be missing.`);
    if (r.mono && S.length > 1) issue('mono', 'The series are all gray or black, so I cannot tell them apart by color.');
    if (ax && ax.yRight && !S.some(s => s.axis === 'right')) issue('dual_axis', 'There is a second scale on the right and I could not tell which series uses it. Every value is read against the left axis.');
    const guess = S.find(s => s.axisGuess);
    if (guess) { issue('dual_axis', `There is a second scale on the right and its labels do not say which series uses it. I read "${guess.name}" against it because that is the usual layout, so check it.`); delete guess.axisGuess; }
    if (r.xDate && r.xDate.noYear) r.notes.push('The x axis shows no year, so dates are given as month and day.');
    // x labels that did not read (often because they are drawn at an angle): the caller can OCR them again rotated
    const junk = c => !/[A-Za-z]{3}|\d{2}/.test(c.label) || ((c.label.match(/[A-Za-z]/g) || []).length <= 2 && !/\d/.test(c.label));
    // a date cut short ("2016-") or the same label over and over is a slanted date that read as its first part
    const cut = c => /^\d{4}[-/.]\d?$/.test(c.label), dup = r.xCats ? r.xCats.length - new Set(r.xCats.map(c => c.label)).size : 0;
    r.xWeak = r.orient !== 'h' && !r.xNumeric && (!r.xCats || r.xCats.length < 2 || r.xCats.filter(junk).length > r.xCats.length * 0.3 ||
      r.xCats.filter(cut).length > r.xCats.length * 0.3 || dup > r.xCats.length * 0.3);
    r.features = chartFeatures(r, img);
    r.confidence = confidence(r.features, ct);
    r.reliable = r.confidence >= THRESH && !r.issues.some(i => HARD.has(i.code));
    // output: dates as ISO strings, numbers as numbers
    if (r.xDate) S.forEach(s => s.points.forEach(p => { if (typeof p.x === 'number') { p.xv = p.x; p.x = r.xDate.noYear ? isoDay(p.x).slice(5) : isoDay(p.x); } }));
    r.flags = honesty(r);
    r.axis = { yLog: ycal.log, yPct: r.yPct, yUnit: r.yUnit, xNumeric: r.xNumeric, xDate: !!r.xDate, orient: r.orient || 'v',
      yRange: r.orient === 'h' ? [ycal.toValue(r.rect.left - 0), ycal.toValue(r.rect.right)] : [ycal.toValue(r.rect.bottom), ycal.toValue(r.rect.top)],
      xRange: r.xNumeric ? [r.xcal.toValue(r.rect.left), r.xcal.toValue(r.rect.right)] : null, yRight: !!(ax && ax.yRight) };
    if (r.orient === 'h') r.axis.yRange = [Math.min(...r.axis.yRange), Math.max(...r.axis.yRange)];
    r.calib = { y: r.yl.filter(q => isFinite(q.p)).map(q => ({ p: q.p, v: q.v })), x: r.xNumeric && r.ax.xRow ? r.ax.xRow.filter(q => q.n).map(q => ({ p: q.cx, v: q.n.v })) : [] };
    if (r.orient === 'h') { const Hh = img.height, Ww = img.width; r.calib = { y: r.calib.y.map(q => ({ p: Ww - 1 - q.p, v: q.v })), x: [] }; r.calib.axis = 'x'; }
    r.toPx = { x: v => r.xNumeric ? r.xcal.toPixel(v) : v, y: v => ycal.toPixel(v) };
    r.ms = Date.now() - t0;
    // the internal pieces are not part of the result
    for (const k of ['ycal', 'xcal', 'yl', 'bg', 'clusters', 'yRightCal', 'legendWords', 'xCats', 'nIssues']) delete r[k];
    r.dbg = { ax: undefined };
    delete r.ax;
    return r;
  }

  // ---------- confidence ----------
  // features that predict whether a read is right. The weights below were fit on the dev split only
  // (bench/calibrate.py) and then frozen before the test split was scored.
  function chartFeatures(r, img) {
    const S = r.series, yc = r.ycal;
    const f = {};
    f.y_inliers = Math.min(yc.inliers, 8);
    f.y_outliers = yc.total - yc.inliers;
    f.y_rsd = Math.min(yc.rsdPx, 5);
    f.x_ok = r.xNumeric ? Math.min(r.xcal.inliers, 8) : (r.xCats ? 1 : 0);
    f.n_series = S.length;
    f.min_cov = Math.min(...S.map(s => s.coverage != null ? s.coverage : 1));
    f.doubled = Math.max(...S.map(s => s.doubled || 0));
    let minC = 999; for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) minC = Math.min(minC, cdist(unhex(S[a].color), unhex(S[b].color)));
    f.min_color = Math.min(minC, 200) / 100;
    f.unnamed_bars = S.reduce((a, s) => a + s.points.filter(p => typeof p.x === 'string' && /^Bar \d/.test(p.x)).length, 0);
    f.mono = r.mono ? 1 : 0;
    f.issues = r.nIssues != null ? r.nIssues : (r.issues || []).length;   // counts every time a check fired, so the confidence fit on dev still sees what it saw
    f.px = img ? Math.min(img.width, 1600) / 1000 : 1;
    f.y_conf = (r.yConf != null ? r.yConf : 90) / 100;
    f.grid = S.filter(s => s.type === 'line' || s.type === 'area').length ? mean(S.filter(s => s.type === 'line' || s.type === 'area').map(s => s.gridOk || 0)) : 1;
    f.explained = Math.min(...S.map(s => s.explained != null ? s.explained : 1));
    const cats = r.xCats ? r.xCats.length : 0;
    f.bar_mismatch = cats ? Math.max(0, ...S.filter(s => s.type === 'bar').map(s => Math.abs(s.points.length - cats))) : 0;
    const R = r.rect, P = S.flatMap(s => s.points.filter(p => p.py != null && p.px != null));
    f.out_of_plot = P.length ? P.filter(p => p.py < R.top - 3 || p.py > R.bottom + 3 || p.px < R.left - 3 || p.px > R.right + 3).length / P.length : 0;
    f.label_scale = r.labelScale ? 1 : 0;
    f.hidden = Math.min(r.hidden || 0, 5);
    // signs of a broken read: stacked bands below zero, the same x twice in one series, far more points than labels
    const st = S.filter(s => s.stacked).flatMap(s => s.points.filter(p => !p.empty));
    const span = Math.abs(yc.toValue(R.top) - yc.toValue(R.bottom)) || 1;
    f.neg_band = st.length ? st.filter(p => p.y < -0.01 * span).length / st.length : 0;
    f.dup_x = mean(S.map(s => { const xs = s.points.map(p => String(p.x)); return xs.length ? 1 - new Set(xs).size / xs.length : 0; }));
    const nLab = r.xCats ? r.xCats.length : (r.ax && r.ax.xRow ? r.ax.xRow.length : 0);
    f.many_pts = nLab ? Math.min(5, Math.max(...S.map(s => s.points.length)) / Math.max(2, nLab) / 4) : 0;
    f.x_weak = r.xWeak ? 1 : 0;
    f.orphans = Math.min(3, r.orphans || 0);
    // the only scale found is on the right: if there is a left one too (a dual axis chart), it was missed
    f.y_right_only = r.yOnRight && r.orient !== 'h' ? 1 : 0;
    f.under = Math.min(5, Math.max(0, ...S.filter(s => s.corners).map(s => s.corners / Math.max(2, s.points.length))));
    f.sc_touch = Math.min(10, S.reduce((a, s) => a + (s.touch || 0), 0));
    f.sc_merged = Math.min(10, S.reduce((a, s) => a + (s.merged || 0), 0));
    f.no_grid_line = S.filter(s => (s.type === 'line' || s.type === 'area') && !s.gridOk).length;
    f.calib = 0;
    const rf = img ? renderFit(r, img) : null;
    f.rr_recall = rf ? rf.recall : 1; f.rr_prec = rf ? rf.prec : 1;
    return f;
  }
  // draw the read back onto the plot and compare it with the picture. Per series: of the pixels in its color inside
  // the plot, the share the drawing covers (recall), and of the drawn pixels, the share that really have that color
  // (precision). The worst series counts. A missed piece of line or a phantom bar shows up here even when the axis is fine.
  function renderFit(r, img) {
    const R = r.rect, W = img.width, D = img.data;
    const x0 = Math.max(0, Math.round(R.left)), x1 = Math.min(W - 1, Math.round(R.right)), y0 = Math.max(0, Math.round(R.top)), y1 = Math.min(img.height - 1, Math.round(R.bottom));
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 8 || h < 8) return null;
    let recall = 1, prec = 1, any = false;
    const grow = (m, k) => {
      const t = new Uint8Array(w * h), o = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= k) t[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= k) t[y * w + x] = 1; } }
      for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (t[y * w + x]) last = y; if (y - last <= k) o[y * w + x] = 1; } last = 1e9; for (let y = h - 1; y >= 0; y--) { if (t[y * w + x]) last = y; if (last - y <= k) o[y * w + x] = 1; } }
      return o;
    };
    for (const s of r.series) {
      // waterfalls and lollipops are drawn in more than one color or shape, so a plain redraw says nothing about them
      if (!['bar', 'line', 'area', 'step', 'scatter'].includes(s.type) || !s.color || s.waterfall || s.lollipop) continue;
      const c = unhex(s.color), mask = new Uint8Array(w * h);
      let nm = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = ((y + y0) * W + x + x0) * 4; if (Math.hypot(D[i] - c[0], D[i + 1] - c[1], D[i + 2] - c[2]) < 45) { mask[y * w + x] = 1; nm++; } }
      if (nm < 20) continue;
      const draw = new Uint8Array(w * h);
      const dot = (cx, cy, rad) => { for (let y = Math.max(0, Math.round(cy - rad - y0)); y <= Math.min(h - 1, Math.round(cy + rad - y0)); y++) for (let x = Math.max(0, Math.round(cx - rad - x0)); x <= Math.min(w - 1, Math.round(cx + rad - x0)); x++) if ((x + x0 - cx) ** 2 + (y + y0 - cy) ** 2 <= rad * rad + 0.5) draw[y * w + x] = 1; };
      const box = (a, b, cc, d) => { for (let y = Math.max(0, Math.round(Math.min(b, d)) - y0); y <= Math.min(h - 1, Math.round(Math.max(b, d)) - y0); y++) for (let x = Math.max(0, Math.round(Math.min(a, cc)) - x0); x <= Math.min(w - 1, Math.round(Math.max(a, cc)) - x0); x++) draw[y * w + x] = 1; };
      const P = s.points.filter(p => !p.empty && p.px != null && p.py != null);
      if (s.type === 'bar') P.forEach(p => p.box && box(...p.box));
      else if (s.type === 'scatter') P.forEach(p => dot(p.px, p.py, Math.max(2, (s.size || 6) / 2)));
      else {
        const rad = Math.max(1, (s.thick || 2) / 2);
        const pts = [...P].sort((a, b) => a.px - b.px);
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          // a step holds its value to the next point (the other way round is tried below)
          const segs = s.type === 'step' ? (s.stepPre ? [[a.px, a.py, a.px, b.py], [a.px, b.py, b.px, b.py]] : [[a.px, a.py, b.px, a.py], [b.px, a.py, b.px, b.py]]) : [[a.px, a.py, b.px, b.py]];
          for (const [ax, ay, bx, by] of segs) { const n = Math.ceil(Math.hypot(bx - ax, by - ay)); for (let t = 0; t <= n; t++) dot(ax + (bx - ax) * t / Math.max(1, n), ay + (by - ay) * t / Math.max(1, n), rad); }
        }
      }
      const score = () => {
        let nd = 0; for (let k = 0; k < draw.length; k++) nd += draw[k];
        if (!nd) return [0, 0];
        const gd = grow(draw, 2), gm = grow(mask, 2);
        let hit = 0, ok = 0;
        for (let k = 0; k < draw.length; k++) { if (mask[k] && gd[k]) hit++; if (draw[k] && gm[k]) ok++; }
        return [hit / nm, ok / nd];
      };
      let sc = score();
      // an area can be an edge line over a lighter fill, or a solid band in the series color: the better fit counts
      if (s.type === 'area') {
        const pts = [...P].sort((a, b) => a.px - b.px);
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k];
          for (let x = Math.round(a.px); x <= Math.round(b.px); x++) { const t = (x - a.px) / Math.max(1, b.px - a.px), ba = a.base != null ? a.base : y1, bb = b.base != null ? b.base : y1; box(x, a.py + (b.py - a.py) * t, x, ba + (bb - ba) * t); }
        }
        const s2 = score(); if (s2[0] * s2[1] > sc[0] * sc[1]) sc = s2;
      }
      if (s.type === 'step' && !s.stepPre) {
        draw.fill(0); s.stepPre = true;
        const pts = [...P].sort((a, b) => a.px - b.px), rad = Math.max(1, (s.thick || 2) / 2);
        for (let k = 1; k < pts.length; k++) { const a = pts[k - 1], b = pts[k]; for (const [ax, ay, bx, by] of [[a.px, a.py, a.px, b.py], [a.px, b.py, b.px, b.py]]) { const n = Math.ceil(Math.hypot(bx - ax, by - ay)); for (let t = 0; t <= n; t++) dot(ax + (bx - ax) * t / Math.max(1, n), ay + (by - ay) * t / Math.max(1, n), rad); } }
        delete s.stepPre;
        const s2 = score(); if (s2[0] * s2[1] > sc[0] * sc[1]) sc = s2;
      }
      recall = Math.min(recall, sc[0]); prec = Math.min(prec, sc[1]); any = true;
    }
    return any ? { recall, prec } : null;
  }
  let W8 = null, THRESH = 0.5;
  const HARD = new Set(['dual_axis', 'mono', 'step_ambiguous', 'legend_over_data']);
  // a small boosted tree model (bench/calibrate.py): each tree is [feature, threshold, left, right, value] rows
  function treeScore(T, x) { let i = 0; while (T[i][0] >= 0) i = x[T[i][0]] <= T[i][1] ? T[i][2] : T[i][3]; return T[i][4]; }
  function confidence(f, ct) {
    if (W8 && W8.gbm) {
      const G = W8.gbm, x = G.feats.map(k => k.startsWith('type:') ? (ct === k.slice(5) ? 1 : 0) : (f[k] || 0));
      let z = G.init; for (const T of G.trees) z += G.lr * treeScore(T, x);
      return 1 / (1 + Math.exp(-z));
    }
    if (!W8) {
      // hand set until calibrate.py has been run: strong axes and clean traces mean a good read
      let z = 1.5 + 0.35 * (f.y_inliers - 3) - 0.6 * f.y_outliers - 0.5 * Math.max(0, f.y_rsd - 1) - 2.5 * Math.max(0, 0.5 - f.min_cov) * 2
        - 2 * Math.max(0, f.doubled - 0.2) - 1.5 * Math.max(0, 0.6 - f.min_color) - 0.3 * f.unnamed_bars - 1.2 * f.mono - 0.4 * f.issues;
      return 1 / (1 + Math.exp(-z));
    }
    let z = W8.b; for (const k in W8.w) z += W8.w[k] * (f[k] || 0); if (W8.type && W8.type[ct] != null) z += W8.type[ct];
    return 1 / (1 + Math.exp(-z));
  }
  function pieConfidence(f) {
    if (W8 && W8.pie) { let z = W8.pie.b; for (const k in W8.pie.w) z += W8.pie.w[k] * (f[k] || 0); return 1 / (1 + Math.exp(-z)); }
    const z = 2 + 4 * (f.ringCover - 0.95) * 10 - 6 * Math.max(0, f.sepUnknown - 0.05) + (f.usedLabels ? 2 : 0) - (f.slices > 9 ? 1 : 0);
    return 1 / (1 + Math.exp(-z));
  }
  function setCalibration(w) { W8 = w; if (w && w.threshold != null) THRESH = w.threshold; }

  // ---------- honesty checks ----------
  function honesty(r) {
    const flags = [];
    const yc = r.ycal, S = r.series, ax = r.ax;
    const h = r.orient === 'h';
    const lo = h ? Math.min(yc.toValue(r.rect.left), yc.toValue(r.rect.right)) : yc.toValue(r.rect.bottom), hi = h ? Math.max(yc.toValue(r.rect.left), yc.toValue(r.rect.right)) : yc.toValue(r.rect.top);
    const bars = S.filter(s => s.type === 'bar');
    const y0px = yc.log ? null : yc.toPixel(0);
    if (bars.length && !yc.log && lo > 0 && !h) {
      const b = bars[0].points.filter(p => !p.empty && p.box);
      if (b.length) {
        const vs = b.map(p => p.y), mn = Math.min(...vs), mx = Math.max(...vs);
        let base = yc.toValue(median(b.map(p => p.box[3] + 1)));
        const near = r.yl.map(q => q.v).reduce((a, v) => Math.abs(v - base) < Math.abs(a - base) ? v : a, Infinity);
        if (Math.abs(near - base) < Math.abs(hi - lo) * 0.01) base = near;
        else { const lv = r.yl.map(q => q.v).sort((a, b) => a - b), st = median(lv.slice(1).map((v, i) => v - lv[i])) || 1, q = st / 10; base = Math.round(base / q) * q; }
        if (base > 0) {
          const visual = (mx - base) / Math.max(1e-9, mn - base), real = mx / Math.max(1e-9, mn);
          flags.push({ level: 'warn', code: 'truncated', title: 'The bars do not start at zero', text: `The bars stand on ${fmt(base)}, not 0. The tallest bar looks ${visual.toFixed(1)}x the shortest, but it is only ${((real - 1) * 100).toFixed(0)}% bigger.` });
        }
      }
    }
    if (h && bars.length && !yc.log && lo > 0) flags.push({ level: 'warn', code: 'truncated', title: 'The bars do not start at zero', text: `The value axis starts at ${fmt(lo)}, so the bar lengths exaggerate the differences.` });
    if (yc.log) flags.push({ level: 'info', code: 'log', title: 'This is a log scale', text: 'Equal steps on the axis mean multiplying, not adding. A small rise near the top can be a huge change.' });
    if (ax && ax.yRight) flags.push({ level: 'warn', code: 'dual', title: 'Two y axes', text: 'There is a second scale on the right. Lines on different axes can be made to cross or line up wherever the designer wants.' });
    if (S.some(s => s.type === 'line' || s.type === 'area') && !yc.log && lo > 0 && (hi - lo) / Math.max(Math.abs(hi), 1e-9) < 0.25)
      flags.push({ level: 'info', code: 'zoomed', title: 'Zoomed in axis', text: `The axis covers ${fmt(lo)} to ${fmt(hi)}. Changes look bigger than they are relative to the full value.` });
    if (S.some(s => s.type === 'area') && !yc.log && lo > 0) flags.push({ level: 'warn', code: 'area_base', title: 'The area does not start at zero', text: 'The filled area hides how much sits below the bottom of the axis, so its size misleads.' });
    // uneven intervals: the x labels are not evenly spaced in value but are evenly spaced on screen (category axis of years with gaps)
    if (!r.xNumeric && r.xCats && r.xCats.length >= 4) {
      const yrs = r.xCats.map(c => /^\d{4}$/.test(c.label) ? +c.label : null);
      if (yrs.every(v => v != null)) { const d = yrs.slice(1).map((v, i) => v - yrs[i]); if (new Set(d).size > 1 && d.every(v => v > 0))
        flags.push({ level: 'warn', code: 'uneven', title: 'Uneven time steps', text: `The years on the x axis jump by ${[...new Set(d)].join(', ')} but are drawn the same distance apart, which bends the trend.` }); }
    }
    return flags;
  }
  function pieFlags(r) {
    const flags = [];
    const P = r.series[0].points;
    if (P.length > 7) flags.push({ level: 'info', code: 'pie_many', title: 'Many slices', text: `${P.length} slices are hard to compare by angle. A sorted bar chart shows the same shares more clearly.` });
    const s = P.map(p => p.y).sort((a, b) => b - a);
    if (s.length >= 2 && s[0] - s[1] < 3 && s[0] > 0) flags.push({ level: 'info', code: 'pie_close', title: 'Close slices', text: `The two biggest slices differ by only ${(s[0] - s[1]).toFixed(1)} points, which the eye cannot judge from angles.` });
    return flags;
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

  // ---------- finding charts on a page ----------
  // A page from a PDF or a screenshot can hold several charts. Charts are dense clusters of non-background
  // pixels that contain both a plot (long lines or filled shapes) and small text. Returns boxes, biggest first.
  function findCharts(img, opts = {}) {
    const W = img.width, H = img.height, D = img.data;
    const f = Math.max(1, Math.ceil(Math.max(W, H) / 800)), w = Math.ceil(W / f), h = Math.ceil(H / f);
    const bg = plotBackground(D, W, { left: 0, right: W - 1, top: 0, bottom: H - 1 });
    const m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let on = 0; for (let dy = 0; dy < f && y * f + dy < H; dy++) for (let dx = 0; dx < f && x * f + dx < W; dx++) { const i = ((y * f + dy) * W + x * f + dx) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], bg) > 30) { on = 1; break; } }
      m[y * w + x] = on;
    }
    // join nearby ink: dilate a lot horizontally and vertically, then take blobs
    const R = Math.max(4, Math.round(Math.min(w, h) * 0.02));
    const d1 = new Uint8Array(w * h), d2 = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { let last = -1e9; for (let x = 0; x < w; x++) { if (m[y * w + x]) last = x; if (x - last <= R) d1[y * w + x] = 1; } last = 1e9; for (let x = w - 1; x >= 0; x--) { if (m[y * w + x]) last = x; if (last - x <= R) d1[y * w + x] = 1; } }
    for (let x = 0; x < w; x++) { let last = -1e9; for (let y = 0; y < h; y++) { if (d1[y * w + x]) last = y; if (y - last <= R) d2[y * w + x] = 1; } }
    const { comps } = components(d2, w, h, 0, 0, w, h);
    const boxes = comps.filter(c => c.w > w * 0.12 && c.h > h * 0.08 && c.w * c.h > w * h * 0.03).map(c => ({ x: c.xa * f, y: c.ya * f, w: Math.min(W, (c.w + 1) * f) , h: Math.min(H, (c.h + 1) * f), area: c.w * c.h }));
    // a chart needs a plot: long straight runs (axes) or big filled areas, not just a paragraph of text
    const out = boxes.filter(b => {
      let longRuns = 0, rows = 0;
      for (let y = b.y; y < b.y + b.h; y += 2) { let run = 0, best = 0; for (let x = b.x; x < b.x + b.w; x++) { const i = (y * W + x) * 4; if (cdist([D[i], D[i + 1], D[i + 2]], bg) > 30) { run++; if (run > best) best = run; } else run = 0; } rows++; if (best > b.w * 0.4) longRuns++; }
      let colorful = 0, n = 0;
      for (let y = b.y; y < b.y + b.h; y += 3) for (let x = b.x; x < b.x + b.w; x += 3) { const i = (y * W + x) * 4; n++; if (rgb2hsv(D[i], D[i + 1], D[i + 2])[1] > 0.3) colorful++; }
      b.axes = longRuns >= 1;
      return longRuns >= 1 || colorful / n > 0.03;
    }).sort((a, b) => b.area - a.area);
    // a legend beside a pie or a plot is a small box of swatches and words with no axis line. It belongs to the chart next to it.
    for (let k = out.length - 1; k > 0; k--) {
      const s = out[k]; if (s.axes) continue;
      const host = out.slice(0, k).find(a => a.area > s.area * 4 && (() => {
        const gx = Math.max(a.x - (s.x + s.w), s.x - (a.x + a.w)), gy = Math.max(a.y - (s.y + s.h), s.y - (a.y + a.h));
        const oy = Math.min(a.y + a.h, s.y + s.h) - Math.max(a.y, s.y), ox = Math.min(a.x + a.w, s.x + s.w) - Math.max(a.x, s.x);
        return (gx < a.w * 0.35 && oy > s.h * 0.5) || (gy < a.h * 0.35 && ox > s.w * 0.5);
      })());
      if (!host) continue;
      const x1 = Math.max(host.x + host.w, s.x + s.w), y1 = Math.max(host.y + host.h, s.y + s.h);
      host.x = Math.min(host.x, s.x); host.y = Math.min(host.y, s.y); host.w = x1 - host.x; host.h = y1 - host.y; host.area += s.area;
      out.splice(k, 1);
    }
    const pad = Math.round(Math.min(W, H) * 0.01);
    // the biggest ones, then in reading order: top to bottom, left to right
    return out.slice(0, opts.max || 12).sort((a, b) => Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.5 ? a.y - b.y : a.x - b.x).map(b => ({ x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), w: Math.min(W - Math.max(0, b.x - pad), b.w + 2 * pad), h: Math.min(H - Math.max(0, b.y - pad), b.h + 2 * pad) }));
  }

  // ---------- what the numbers say ----------
  function insights(res) {
    const cards = [];
    for (const s of res.series) {
      const P = s.points.filter(p => isFinite(p.y) && !p.empty); if (P.length < 2) continue;
      const ys = P.map(p => p.y);
      if (s.type === 'line' || s.type === 'area' || s.type === 'step') {
        const a = ys[0], b = ys[ys.length - 1], hi = Math.max(...ys), lo = Math.min(...ys);
        const iH = ys.indexOf(hi), iL = ys.indexOf(lo);
        let peak = ys[0], dd = 0, ddFrom = 0, ddTo = 0, pk = 0;
        ys.forEach((v, k) => { if (v > peak) { peak = v; pk = k; } const d = peak > 0 ? (v - peak) / peak : 0; if (d < dd) { dd = d; ddFrom = pk; ddTo = k; } });
        const xs = P.map((p, k) => typeof p.xv === 'number' ? p.xv / 365.25 + 1970 : typeof p.x === 'number' ? p.x : k);
        const n = xs.length, mx = xs.reduce((u, v) => u + v, 0) / n, my = ys.reduce((u, v) => u + v, 0) / n;
        let sxy = 0, sxx = 0, syy = 0; xs.forEach((x, k) => { sxy += (x - mx) * (ys[k] - my); sxx += (x - mx) ** 2; syy += (ys[k] - my) ** 2; });
        const slope = sxx ? sxy / sxx : 0, r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : 0;
        const years = P.every(p => typeof p.x === 'number') && xs.every(x => Number.isInteger(+x.toFixed(6)) && x > 1900 && x < 2100);
        const span = xs[n - 1] - xs[0];
        const c = { series: s.name, color: s.color, items: [] };
        if (a !== 0) c.items.push(['Change', `${fmt(a)} to ${fmt(b)}, ${b >= a ? 'up' : 'down'} ${Math.abs((b - a) / Math.abs(a) * 100).toFixed(1)}%`]);
        if (years && span > 0 && a > 0 && b > 0) c.items.push(['Yearly growth (CAGR)', `${((Math.pow(b / a, 1 / span) - 1) * 100).toFixed(1)}% a year over ${span} years`]);
        c.items.push(['High and low', `${fmt(hi)} at ${fx(P[iH].x)}, ${fmt(lo)} at ${fx(P[iL].x)}`]);
        if (dd < -0.05) c.items.push(['Biggest drop', `${(dd * 100).toFixed(1)}% from ${fx(P[ddFrom].x)} to ${fx(P[ddTo].x)}`]);
        c.items.push(['Trend', `${slope >= 0 ? '+' : ''}${fmt(slope)} per ${P[0].xv != null ? 'year' : 'step on x'}, and the straight line explains ${(r2 * 100).toFixed(0)}% of the movement`]);
        cards.push(c);
      } else if (s.type === 'bar' || s.type === 'pie') {
        const sorted = [...P].sort((u, v) => v.y - u.y), tot = ys.reduce((u, v) => u + v, 0);
        cards.push({ series: s.name, color: s.color, items: [
          ['Largest', `${sorted[0].x} at ${fmt(sorted[0].y)}${s.type === 'pie' ? '%' : ''}`],
          ['Smallest', `${sorted[sorted.length - 1].x} at ${fmt(sorted[sorted.length - 1].y)}${s.type === 'pie' ? '%' : ''}`],
          ['Gap', `the largest is ${(sorted[0].y / Math.max(1e-9, sorted[sorted.length - 1].y)).toFixed(2)}x the smallest`],
          s.type === 'pie' ? ['Top two', `${sorted[0].x} and ${sorted[1].x} make up ${fmt(sorted[0].y + sorted[1].y)}% together`] : ['Total and average', `${fmt(tot)} total, ${fmt(tot / P.length)} on average`],
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

  // ---------- a plain text description of the chart, for screen readers ----------
  const NAMES = { bar: 'bar chart', hbar: 'horizontal bar chart', grouped_bar: 'grouped bar chart', stacked_bar: 'stacked bar chart', stacked_hbar: 'stacked horizontal bar chart',
    line: 'line chart', step: 'step chart', area: 'area chart', stacked_area: 'stacked area chart', scatter: 'scatter plot', pie: 'pie chart', donut: 'donut chart', histogram: 'histogram', bar_line: 'bar and line chart' };
  function describe(res) {
    if (!res || !res.ok) return '';
    const S = res.series, kind = NAMES[res.chartType] || 'chart';
    const pct = res.axis && res.axis.yPct ? '%' : '';
    const parts = [];
    if (res.chartType === 'pie' || res.chartType === 'donut') {
      const P = [...S[0].points].sort((a, b) => b.y - a.y);
      parts.push(`A ${kind} with ${P.length} slices.`);
      parts.push(P.slice(0, 6).map(p => `${p.x} ${p.y.toFixed(1)}%`).join(', ') + (P.length > 6 ? `, and ${P.length - 6} more.` : '.'));
      return parts.join(' ');
    }
    parts.push(`A ${kind} with ${S.length} series${S.length === 1 ? '' : ` (${S.map(s => s.name).join(', ')})`}.`);
    if (res.axis) parts.push(`The value axis runs from ${fmt(Math.min(...res.axis.yRange))}${pct} to ${fmt(Math.max(...res.axis.yRange))}${pct}${res.axis.yLog ? ' on a log scale' : ''}.`);
    for (const s of S.slice(0, 4)) {
      const P = s.points.filter(p => isFinite(p.y) && !p.empty); if (!P.length) continue;
      const hi = P.reduce((a, p) => p.y > a.y ? p : a), lo = P.reduce((a, p) => p.y < a.y ? p : a);
      if (s.type === 'scatter') { parts.push(`${s.name}: ${P.length} points, y from ${fmt(lo.y)} to ${fmt(hi.y)}.`); continue; }
      const first = P[0], last = P[P.length - 1];
      if (s.type === 'bar') parts.push(`${s.name}: highest is ${fx(hi.x)} at ${fmt(hi.y)}${pct}, lowest is ${fx(lo.x)} at ${fmt(lo.y)}${pct}.`);
      else parts.push(`${s.name} goes from ${fmt(first.y)}${pct} at ${fx(first.x)} to ${fmt(last.y)}${pct} at ${fx(last.x)}, peaking at ${fmt(hi.y)}${pct} at ${fx(hi.x)}.`);
    }
    if (!res.reliable) parts.push('Unchart was not confident in this reading, so check the numbers.');
    return parts.join(' ');
  }

  // x labels drawn at an angle do not read flat. rot holds the strip under the plot read turned 30, 45 and 90
  // degrees ({deg: words}); the turn with the most good labels replaces the flat reading of that strip if the
  // chart then reads better. Returns {res, words}.
  function withRotated(img, words, res, rot, opts = {}) {
    const good = w => w.conf > 60 && (parseNumber(w.text) || parseDatePart(w.text) || /[A-Za-z]{3}/.test(w.text));
    let extra = [], best = 0;
    for (const deg of [30, 45, 90]) { const ws = (rot && rot[deg]) || [], n = ws.filter(good).length; if (n > best) { best = n; extra = ws.filter(good); } }
    if (best < 2) return { res, words };
    const kept = words.filter(w => !(w.y0 > res.rect.bottom && !(w.conf > 80 && good(w))));
    let r2; try { r2 = extract(img, kept.concat(extra), opts); } catch (e) { r2 = null; }
    if (r2 && r2.ok && (!r2.xWeak || r2.confidence > res.confidence + 0.05)) return { res: r2, words: kept.concat(extra) };
    return { res, words };
  }

  const api = { extract, withRotated, insights, describe, warp, guessQuad, _homography: homography, parseNumber, parseDatePart, parseDateRow, fitAxis, fmt, deskew, rotate, findCharts, readPie, flipImg, setCalibration,
    _findAxes: findAxes, _groupBy: groupBy, _stepRuns: stepRuns, _fixSeparators: fixSeparators, _fixPowers: fixPowers, _fixMissingMinus: fixMissingMinus, _confidence: confidence };
  root.Unchart = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
