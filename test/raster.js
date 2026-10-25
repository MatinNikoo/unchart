// Tiny in-memory drawing helpers so the engine can be tested in node without a browser.
// Charts come with the OCR words a reader would return for their labels.
const COLORS = [[31, 119, 180], [255, 127, 14], [44, 160, 44], [214, 39, 40], [148, 103, 189]];
const CATS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Omega', 'Kappa', 'Sigma'];

function blank(w, h, c = [255, 255, 255]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = c[0]; data[i * 4 + 1] = c[1]; data[i * 4 + 2] = c[2]; data[i * 4 + 3] = 255; }
  return { width: w, height: h, data };
}
function rect(img, x0, y0, x1, y1, c) {
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(img.height - 1, Math.round(y1)); y++)
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(img.width - 1, Math.round(x1)); x++) {
      const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    }
}
function line(img, x0, y0, x1, y1, c, w = 2) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
  for (let k = 0; k <= n; k++) { const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n; rect(img, x - w / 2 + 0.5, y - w / 2 + 0.5, x + w / 2 - 0.5, y + w / 2 - 0.5, c); }
}
function paste(dst, src, ox, oy) {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = (y * src.width + x) * 4, o = ((y + oy) * dst.width + x + ox) * 4;
    dst.data[o] = src.data[i]; dst.data[o + 1] = src.data[i + 1]; dst.data[o + 2] = src.data[i + 2];
  }
}
const word = (text, x0, y0, x1, y1) => ({ text: String(text), conf: 95, x0, y0, x1, y1 });

// a frame with a y axis of numbers on the left; returns helpers to place values
function frame(o, W = 640, H = 400, left = 60) {
  const img = blank(W, H), top = 30, bottom = 340, right = W - 20, words = [];
  const Y = v => bottom - (v - o.lo) / (o.hi - o.lo) * (bottom - top);
  for (let v = o.lo; v <= o.hi + 1e-9; v += o.step) {
    const y = Math.round(Y(v));
    rect(img, left, y, right, y, [225, 225, 225]);
    rect(img, left - 6, y, left - 1, y, [60, 60, 60]);
    words.push(word(v, left - 40, y - 5, left - 10, y + 5));
  }
  rect(img, left, top, left, bottom, [0, 0, 0]); rect(img, left, bottom, right, bottom, [0, 0, 0]);
  return { img, words, Y, top, bottom, left, right };
}

function barChart(vals, o) {
  const f = frame(o), n = vals.length, step = (f.right - f.left) / n;
  vals.forEach((v, i) => {
    const cx = f.left + step * (i + 0.5);
    rect(f.img, cx - 22, Math.round(f.Y(v)), cx + 22, f.bottom - 1, COLORS[0]);
    f.words.push(word(CATS[i], cx - 18, f.bottom + 8, cx + 18, f.bottom + 20));
  });
  return { img: f.img, words: f.words, truth: vals };
}

function stackedChart(S, o) {
  const f = frame(o), n = S[0].length, step = (f.right - f.left) / n;
  for (let i = 0; i < n; i++) {
    const cx = f.left + step * (i + 0.5); let base = 0;
    S.forEach((s, j) => { rect(f.img, cx - 22, Math.round(f.Y(base + s[i])), cx + 22, Math.round(f.Y(base)) - 1, COLORS[j]); base += s[i]; });
    f.words.push(word(CATS[i], cx - 18, f.bottom + 8, cx + 18, f.bottom + 20));
  }
  return { img: f.img, words: f.words };
}

function lineChart(ys, o) {
  const f = frame(o), n = ys.length, X = i => f.left + 20 + i * (f.right - f.left - 40) / (n - 1);
  for (let i = 0; i < n; i++) {
    const x = Math.round(X(i));
    rect(f.img, x, f.bottom + 1, x, f.bottom + 5, [60, 60, 60]);
    f.words.push(word(i, x - 4, f.bottom + 8, x + 4, f.bottom + 20));
    if (i) line(f.img, X(i - 1), f.Y(ys[i - 1]), X(i), f.Y(ys[i]), COLORS[0], 2);
  }
  return { img: f.img, words: f.words };
}

function hbarChart(vals, o) {
  const W = 640, H = 400, left = 110, right = 610, top = 30, bottom = 340, img = blank(W, H), words = [];
  const X = v => left + (v - o.lo) / (o.hi - o.lo) * (right - left);
  for (let v = o.lo; v <= o.hi + 1e-9; v += o.step) {
    const x = Math.round(X(v)); rect(img, x, top, x, bottom, [225, 225, 225]); rect(img, x, bottom + 1, x, bottom + 5, [60, 60, 60]);
    words.push(word(v, x - 8, bottom + 9, x + 8, bottom + 21));
  }
  rect(img, left, top, left, bottom, [0, 0, 0]); rect(img, left, bottom, right, bottom, [0, 0, 0]);
  const step = (bottom - top) / vals.length;
  vals.forEach((v, i) => {
    const cy = top + step * (i + 0.5);
    rect(img, left + 1, cy - 20, Math.round(X(v)), cy + 20, COLORS[0]);
    words.push(word(CATS[i], left - 70, cy - 6, left - 12, cy + 6));
  });
  return { img, words, truth: vals };
}

// o.colors: slice colors (repeat one to get two touching slices in the same color); o.sep: white lines between slices
function pieChart(shares, donut, o = {}) {
  const C = o.colors || COLORS;
  const img = blank(600, 420), cx = 300, cy = 210, r = 160, tot = shares.reduce((a, b) => a + b, 0);
  const cum = []; let s = 0; for (const v of shares) { s += v / tot; cum.push(s); }
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const d = Math.hypot(x - cx, y - cy); if (d > r || (donut && d < r * 0.5)) continue;
    let a = Math.atan2(y - cy, x - cx) + Math.PI / 2; if (a < 0) a += 2 * Math.PI;
    const f = a / (2 * Math.PI), k = cum.findIndex(c => f < c);
    rect(img, x, y, x, y, C[k < 0 ? shares.length - 1 : k]);
  }
  if (o.sep) [0].concat(cum.slice(0, -1)).forEach(f => { const a = f * 2 * Math.PI - Math.PI / 2; line(img, cx, cy, Math.round(cx + r * Math.cos(a)), Math.round(cy + r * Math.sin(a)), [255, 255, 255], 2); });
  return { img, words: [] };
}

module.exports = { blank, rect, line, paste, word, barChart, stackedChart, lineChart, hbarChart, pieChart };
