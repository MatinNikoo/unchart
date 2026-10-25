// The chart renderer: every chart type with every kind of option must give a well formed SVG with no broken numbers.
const test = require('node:test');
const assert = require('node:assert');
const RM = require('../src/remake.js');
const PR = require('../src/presets.js');

const years = Array.from({ length: 12 }, (_, i) => 2014 + i);
const LINE = { xName: 'Year', cols: [{ name: 'Online', color: '#1f4fd8' }, { name: 'Stores', color: '#ff5a1f', axis: 'right' }, { name: 'Other' }],
  rows: years.map((x, i) => ({ x, vals: [2 + i * 0.9 + (i % 3), 5 + i * 0.4, 3 + Math.sin(i)], errs: [[0.2, 0.2], [0.1, 0.1], null] })) };
const CATS = { xName: 'City', cols: [{ name: 'Score' }, { name: 'Last year' }], rows: ['Austin', 'Denver', 'Boston', 'Seattle', 'Miami'].map((x, i) => ({ x, vals: [78 + i * 2, 70 + i, ] })) };
const PIE = { xName: 'Slice', pie: true, cols: [{ name: 'Share' }], rows: [['Search', 42], ['Social', 23], ['Direct', 18], ['Email', 11], ['Other', 6]].map(([x, v]) => ({ x, vals: [v] })) };
const DATES = { xName: 'Date', cols: [{ name: 'Rate' }], rows: Array.from({ length: 30 }, (_, i) => ({ x: new Date(Date.UTC(2020, 0, 1) + i * 864e5 * 30).toISOString().slice(0, 10), vals: [1 + i * 0.1] })) };

const sane = (svg, what) => {
  assert.ok(/^<svg /.test(svg) && /<\/svg>$/.test(svg.trim()), what + ' is an svg');
  assert.ok(!/NaN|undefined|Infinity|\[object/.test(svg), what + ' has a broken number');
  const opens = (svg.match(/<(g|defs|clipPath|linearGradient|radialGradient|pattern|filter|text)[ >]/g) || []).length, closes = (svg.match(/<\/(g|defs|clipPath|linearGradient|radialGradient|pattern|filter|text)>/g) || []).length;
  assert.strictEqual(opens, closes, what + ' balances its tags');
};

test('every type draws from line data, categories and dates', () => {
  for (const type of RM.TYPES) for (const [nm, T] of [['line', LINE], ['cats', CATS], ['dates', DATES]]) {
    const o = RM.render(T, { type });
    sane(o.svg, `${type} on ${nm}`);
    assert.ok(o.width > 0 && o.height > 0);
  }
});

test('a pie draws from shares and from series data', () => {
  for (const type of ['pie', 'donut']) { sane(RM.render(PIE, { type }).svg, type); sane(RM.render(CATS, { type }).svg, type + ' from a series'); }
});

test('every look and every layout keeps the chart valid', () => {
  for (const [T, pie] of [[LINE, false], [PIE, true]]) {
    for (const st of PR.STYLES) { const o = Object.assign({ type: pie ? 'pie' : 'line' }, {}); const s = JSON.parse(JSON.stringify(RM.DEFAULTS)); Object.assign(s, o); Object.keys(st.set).forEach(k => { s[k] = typeof st.set[k] === 'object' && !Array.isArray(st.set[k]) ? Object.assign({}, s[k], st.set[k]) : st.set[k]; }); sane(RM.render(T, s).svg, 'look ' + st.id); }
    for (const ly of PR.LAYOUTS.filter(l => !!l.pie === pie)) { const s = JSON.parse(JSON.stringify(RM.DEFAULTS)); s.type = pie ? 'pie' : 'line'; Object.keys(ly.set).forEach(k => { s[k] = typeof ly.set[k] === 'object' && !Array.isArray(ly.set[k]) ? Object.assign({}, s[k], ly.set[k]) : ly.set[k]; }); sane(RM.render(T, s).svg, 'layout ' + ly.id); }
  }
});

test('format options reach the drawing', () => {
  const base = { type: 'bar' };
  const r = o => RM.render(CATS, Object.assign({}, base, o)).svg;
  assert.match(r({ fm: { s0: { fill: { t: 'grad', c: '#112233', ang: 90 } } } }), /linearGradient/);
  assert.match(r({ fm: { s0: { fill: { t: 'pat', pat: 'diag', c: '#112233' } } } }), /<pattern/);
  assert.match(r({ fm: { s0: { shadow: { on: true, blur: 4, dy: 3 } } } }), /<filter/);
  assert.match(r({ bar: { rad: 8 } }), /rx="/);
  assert.match(r({ ax: { y: { fmt: '0.0' } } }), />80\.0</);
  assert.match(r({ ax: { y: { min: 50, max: 90, major: 10 } } }), />50</);
  assert.match(r({ dl: { on: true, fmt: '0.00' } }), />78\.00</);
  assert.match(r({ title: 'A title', tx: { title: { size: 30, c: '#ff0000' } } }), /fill="#ff0000"/);
  assert.match(r({ refs: [{ id: 'r1', axis: 'y', kind: 'line', v: 80, text: 'Target' }] }), />Target</);
  assert.match(r({ ann: [{ id: 'a1', kind: 'text', fx: 0.2, fy: 0.2, fw: 0.3, text: 'Hello there' }] }), /Hello/);
});

test('rendering is deterministic and does not change its input', () => {
  const o = { type: 'line', ln: { smooth: true }, dl: { on: true } }, before = JSON.stringify([LINE, o]);
  const a = RM.render(LINE, o).svg.replace(/uc\d+/g, 'ID'), b = RM.render(LINE, o).svg.replace(/uc\d+/g, 'ID');
  assert.strictEqual(a, b);
  assert.strictEqual(JSON.stringify([LINE, o]), before);
});

test('alt text and the geometry used by the editor', () => {
  const o = RM.render(LINE, { type: 'line' });
  assert.ok(o.alt && o.alt.length > 20);
  assert.ok(o.geom.colors.length === 3 && o.geom.plot && o.geom.th && o.geom.els.title === undefined);
  assert.strictEqual(RM.render(LINE, { alt: 'My words' }).alt, 'My words');
});

test('silly axis limits and units never hang or break the drawing', () => {
  const T = { xName: 'x', cols: [{ name: 'a' }], rows: [1, 2, 3, 4].map(x => ({ x, vals: [x * 2] })) };
  for (const ax of [{ y: { min: 1e9 } }, { y: { max: -5 }}, { y: { min: 10, max: 2 } }, { x: { min: 1e9 } }, { x: { major: 1e-9 } }, { y: { major: 1e-12 } }, { y: { minor: 1e-12 } }, { y: { log: true, min: -4 } }]) {
    const t = Date.now(), o = RM.render(T, { type: 'line', ax });
    assert.ok(Date.now() - t < 500, JSON.stringify(ax) + ' took too long');
    sane(o.svg, JSON.stringify(ax));
  }
});

test('projections draw their start marker and band', () => {
  const T = { xName: 'Year', cols: [{ name: 'A' }, { name: 'B' }], rows: Array.from({ length: 10 }, (_, i) => ({ x: 2016 + i, vals: [2 + i * 0.9, 3 + i * 0.4] })) };
  for (const trend of ['linear', 'growth']) for (const type of ['line', 'area', 'scatter', 'step']) { const o = RM.render(T, { type, trend }); sane(o.svg, type + ' ' + trend); assert.ok(o.projections.some(Boolean)); }
});

test('long pie center text and wide value labels stay inside the picture', () => {
  const inside = (svg, what) => {
    const W = +svg.match(/viewBox="0 0 ([\d.]+)/)[1];
    for (const m of svg.matchAll(/<text x="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*>([^<]*)<\/text>/g)) {
      const x = +m[1], w = m[3].length * 4, a = m[2];
      const lo = a === 'middle' ? x - w : a === 'end' ? x - w * 2 : x, hi = a === 'middle' ? x + w : a === 'end' ? x : x + w * 2;
      assert.ok(lo > -2 && hi < W + 2, what + ' text "' + m[3] + '" leaves the picture');
    }
  };
  const o = RM.render(PIE, { type: 'donut', pie: { hole: 60, center: 'Total share of all visits this year' } });
  sane(o.svg, 'pie center'); inside(o.svg, 'pie center');
  const h = RM.render(CATS, { type: 'hbar', ax: { y: { fmt: { code: '#,##0.00', unit: 'M' } } } });
  sane(h.svg, 'hbar units'); inside(h.svg, 'hbar units');
  const d = RM.render(DATES, { type: 'line', ax: { x: { min: 1e9 } } });
  sane(d.svg, 'date limit');
});

test('absurd margins and padding keep a drawable plot', () => {
  for (const type of ['bar', 'hbar', 'line', 'pie']) for (const v of [1e9, -1e9, 5000]) {
    const o = RM.render(CATS, { type, lay: { m: { t: v, l: v, r: v, b: v }, pad: { t: v, l: v, r: v, b: v } } });
    sane(o.svg, type + ' margin ' + v);
    assert.ok(!/(width|height)="-\d/.test(o.svg), type + ' has a negative size at margin ' + v);
  }
});
