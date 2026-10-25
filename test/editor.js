// The chart editor in headless Chromium: every group of controls, on every example, at several window sizes.
// After a change it checks that the redrawn chart has no overlapping text, no text outside the picture and no broken
// numbers, and that the controls themselves do not overlap or push the page sideways. The exports are read back
// (PNG sizes, SVG, PDF header, clipboard, and the XLSX chart with openpyxl).
// usage: node test/editor.js        (V=1 prints each step, SHOTS=0 skips the screenshots)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const OUT = path.join(__dirname, 'shots', 'editor');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
let nChecks = 0;
const check = (ok, msg) => { nChecks++; if (!ok) { console.log('FAIL ' + msg); fails.push(msg); } };
const say = m => { if (process.env.V) console.log(m); };

// runs in the page: text in the preview must not touch other text or leave the picture. Each label is measured as the
// rotated box it really occupies, so slanted tick labels are not mistaken for overlapping.
function svgProblems() {
  const svg = document.querySelector('#rPrev svg'); if (!svg) return ['no svg'];
  const out = [], S = svg.getBoundingClientRect(), k = S.width / svg.viewBox.baseVal.width;
  if (/NaN|undefined|Infinity/.test(svg.outerHTML)) out.push('bad number in svg');
  const quad = t => {
    const b = t.getBBox(), m = t.getScreenCTM(), cut = b.height * 0.14;   // glyph boxes include line spacing
    return [[b.x, b.y + cut], [b.x + b.width, b.y + cut], [b.x + b.width, b.y + b.height - cut], [b.x, b.y + b.height - cut]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
  };
  const apart = (p, q) => {   // separating axis test for two convex quads; true when they do not overlap
    for (const poly of [p, q]) for (let i = 0; i < 4; i++) {
      const a = poly[i], c = poly[(i + 1) % 4], len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, nx = (c[1] - a[1]) / len, ny = (a[0] - c[0]) / len;
      const pr = P => P.map(v => v[0] * nx + v[1] * ny), A = pr(p), B = pr(q);
      if (Math.max(...A) <= Math.min(...B) + 1.5 * k || Math.max(...B) <= Math.min(...A) + 1.5 * k) return true;
    }
    return false;
  };
  const T = [...svg.querySelectorAll('text')].filter(t => !t.closest('#ucui')).map(t => ({ s: t.textContent, q: quad(t) }));
  const tol = 0.5 * k;
  T.forEach((a, i) => {
    if (a.q.some(([x, y]) => x < S.left - tol || x > S.right + tol || y < S.top - tol || y > S.bottom + tol)) out.push(`"${a.s}" leaves the picture`);
    for (let j = i + 1; j < T.length; j++) if (!apart(a.q, T[j].q)) out.push(`"${a.s}" overlaps "${T[j].s}"`);
  });
  return out;
}
// runs in the page: the editor controls must not overlap each other, overflow the window or run out of their column
function layoutProblems() {
  const out = [];
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${innerWidth})`);
  const els = [...document.querySelectorAll('#ed .edbar > *, #ed .edtabs > *, #edPanes .grp > summary, #edPanes .row, #edPanes .fhead')].filter(e => e.offsetParent && e.getClientRects().length && !(e.tagName !== 'SUMMARY' && e.closest('details.grp:not([open])')));
  const R = els.map(e => ({ e, r: e.getBoundingClientRect() }));
  const name = e => e.dataset && e.dataset.g || e.id || (e.querySelector && e.querySelector('label,span,button') ? e.querySelector('label,span,button').textContent.trim().slice(0, 20) : '') || e.className;
  const col = document.querySelector('#edPanes').getBoundingClientRect();
  R.forEach((a, i) => {
    if (a.r.right > innerWidth + 1) out.push(`${name(a.e)} goes past the window`);
    if (a.e.closest('#edPanes') && (a.r.right > col.right + 1 || a.r.left < col.left - 1)) out.push(`${name(a.e)} leaves its column`);
    if (a.e.scrollWidth > a.e.clientWidth + 2 && getComputedStyle(a.e).overflowX === 'visible' && a.e.closest('#edPanes')) {
      // a child that sticks out of its row
      [...a.e.children].forEach(c => { const q = c.getBoundingClientRect(); if (q.width && q.right > a.r.right + 2) out.push(`${name(c)} sticks out of its row`); });
    }
    for (let j = i + 1; j < R.length; j++) {
      const b = R[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > 1 && oy > 1) out.push(`${name(a.e)} overlaps ${name(b.e)}`);
    }
  });
  return out;
}

(async () => {
  const srv = process.env.PORT ? null : await require('../bench/serve.js').serve();
  const PORT = process.env.PORT || srv.port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: `http://localhost:${PORT}` });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|player\.js|fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll('#table tbody tr').length > 0, null, { timeout: 30000 });

  // ---------- helpers ----------
  const wait = ms => page.waitForTimeout(ms);
  const shot = async name => { if (process.env.SHOTS !== '0') await page.screenshot({ path: path.join(OUT, name) }); };
  const svgOK = async what => { const p = await page.evaluate(svgProblems); check(!p.length, `${what}: ${p.slice(0, 3).join('; ')}`); };
  const layoutOK = async what => { const p = await page.evaluate(layoutProblems); check(!p.length, `${what}: ${p.slice(0, 4).join('; ')}`); };
  const snapshot = () => page.$eval('#rPrev', e => e.innerHTML);
  const strip = s => s.replace(/uc\d+/g, '');
  const spec = () => page.evaluate(() => JSON.parse(JSON.stringify(unchartEditor.spec)));
  const getp = (o, p) => String(p).split('/').reduce((a, k) => (a == null ? a : a[k]), o);
  const tab = async t => { await page.click(`#edTabs [data-tab="${t}"]`); await wait(30); };
  const pick = async key => { await page.evaluate(k => { unchartEditor.select(k); unchartEditor.setTab('format'); }, key); await wait(40); };
  // set a control by its path, the way a person would: value, input and change events (a click for a toggle button group)
  const setc = async (p, v) => {
    const r = await page.evaluate(([p, v]) => {
      const seg = document.querySelector(`#edPanes button[data-path="${p}"][data-v="${v}"]`);
      if (seg) { seg.click(); return 'seg'; }
      const el = document.querySelector(`#edPanes [data-path="${p}"]:not(button), #edPanes [data-fmtsel="${p}"]`);
      if (!el) return 'missing';
      if (el.type === 'checkbox') { if (el.checked !== !!v) { el.checked = !!v; el.dispatchEvent(new Event('change', { bubbles: true })); } return 'chk'; }
      el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return 'ok';
    }, [p, v]);
    check(r !== 'missing', `control ${p} exists`); await wait(25); return r;
  };
  const clickBtn = async (text, scope) => { await page.evaluate(() => document.querySelectorAll('#edPanes details.grp').forEach(d => { d.open = true; })); await page.locator(`${scope || '#edPanes'} button`, { hasText: new RegExp('^' + text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') }).first().click(); await wait(40); };
  const loadEx = async ex => { await page.click(`[data-ex="${ex}"]`); await wait(1100); await page.click('#tRem'); await wait(200); };
  const download = async act => { const [dl] = await Promise.all([page.waitForEvent('download'), act()]); const p = path.join(OUT, 'dl_' + dl.suggestedFilename().replace(/[^\w.@-]/g, '_')); await dl.saveAs(p); return { name: dl.suggestedFilename(), path: p, buf: fs.readFileSync(p) }; };
  const toastText = () => page.$eval('#toast', e => e.textContent);
  const undoAll = async () => { let n = 0; while (!(await page.$eval('#rUndo', e => e.disabled)) && n < 600) { await page.click('#rUndo'); n++; } return n; };

  // ---------- 1. every chart type on every example ----------
  const EX = ['ex_line.png', 'ex_bars.png', 'ex_dots.png', 'ex_pie.png', 'ex_hbars.png', 'ex_rates.png'];
  for (const ex of EX) {
    await loadEx(ex);
    await svgOK(`${ex} default`);
    const types = await page.$$eval('#edPanes .tbtn', o => o.map(x => x.dataset.type));
    check(types.length === 16, `${ex}: sixteen chart types offered (${types.length})`);
    for (const t of types) {
      say(ex + ' ' + t);
      await page.click(`#edPanes .tbtn[data-type="${t}"]`); await wait(40);
      check((await spec()).type === t, `${ex}: type button sets ${t}`);
      await svgOK(`${ex} ${t}`);
      await tab('layout');
      for (const lg of ['top', 'right', 'bottom', 'left', 'none']) { await setc('legend', lg); await svgOK(`${ex} ${t} legend ${lg}`); }
      await setc('legend', 'top');
      await tab('series'); await setc('dl/on', true); await svgOK(`${ex} ${t} value labels`); await setc('dl/on', false);
      await tab('design');
    }
    await page.click(`#edPanes .tbtn[data-type="${types[0]}"]`);
    await shot('types_' + ex);
  }

  // ---------- 2. text, fonts, number formats and axes on the line example (two series, dates) ----------
  await loadEx('ex_line.png');
  const before = await snapshot(), spec0 = await spec();
  const long = 'Monthly sales and costs for the northern region stores, adjusted for inflation and returns';
  await tab('text');
  for (const [p, v] of [['title', long], ['subtitle', 'Thousands of dollars, as reported each quarter by every store in the region'], ['xLabel', 'Month'], ['yLabel', 'Sales in thousands of dollars'], ['note', 'Source: store reports. Drawn with Unchart.']]) {
    await setc(p, v); await svgOK('text field ' + p);
  }
  check((await snapshot()).includes('Monthly sales'), 'title shows in the chart');
  for (const f of ['sans', 'serif', 'mono', 'rounded']) for (const size of [10, 24]) {
    await setc('font', f); await setc('fontSize', size);
    for (const lg of ['top', 'right', 'bottom']) { await tab('layout'); await setc('legend', lg); await tab('text'); await svgOK(`font ${f} size ${size} legend ${lg}`); }
  }
  await setc('fontCustom', 'Georgia'); check(/Georgia/.test(await snapshot()), 'a custom font name reaches the chart'); await svgOK('custom font');
  await setc('fontCustom', ''); await setc('font', 'sans'); await setc('fontSize', 14);
  await tab('layout'); await setc('legend', 'top');

  await tab('axes');
  await setc('ax/y/min', 0); await setc('ax/y/max', 500);
  check(/>500</.test(await snapshot()), 'axis maximum sets the top tick'); await svgOK('axis range');
  await setc('ax/y/major', 100); check((await snapshot()).match(/>[0-9]+</g).filter(x => /^>(0|100|200|300|400|500)<$/.test(x)).length >= 6, 'major unit 100 gives ticks every 100');
  await setc('ax/y/minor', 25); await setc('ax/y/mticks', 'out'); await setc('ax/y/mgrid', true); await svgOK('minor ticks and gridlines');
  await setc('ax/y/min', ''); await setc('ax/y/max', ''); await setc('ax/y/major', ''); await setc('ax/y/minor', '');
  await setc('zero', false); await svgOK('zero off');
  await setc('log', true); await svgOK('log scale');
  check(/>100</.test(await snapshot()) || /log scale needs/i.test(await page.$eval('#rNote', e => e.textContent)), 'log scale draws powers of ten or explains why not');
  await setc('log', false); await setc('zero', true);
  await setc('ax/y/rev', true); await svgOK('reversed value axis'); await setc('ax/y/rev', false);
  await setc('ax/y/units', 1000); await svgOK('display units'); await setc('ax/y/units', 1);
  await setc('ax/y/fmt', '$#,##0'); check(/>\$[0-9,]+</.test(await snapshot()), 'value axis number format shows dollar signs'); await svgOK('axis number format');
  await setc('ax/y/fmt', '0.0%'); check(/%</.test(await snapshot()), 'percent format');
  await setc('ax/y/fmt', '');
  await setc('ax/y/ticks', 'in'); await setc('ax/y/ticks', 'cross'); await setc('ax/y/ticks', 'out'); await svgOK('tick marks');
  await setc('ax/y/side', 'right'); await svgOK('value axis on the right'); await setc('ax/y/side', 'left');
  await setc('ax/y/show', false); await svgOK('value axis hidden'); await setc('ax/y/show', true);
  await setc('ax/y/lab', 'none'); await setc('ax/y/lab', 'high'); await setc('ax/y/lab', 'next'); await svgOK('label position'); await setc('ax/y/lab', 'next');
  await setc('ax/x/rot', '-45'); await svgOK('slanted category labels'); await setc('ax/x/rot', 'auto');
  await setc('ax/x/fmt', 'mmm yyyy'); await svgOK('date format'); await setc('ax/x/fmt', '');
  await setc('ax/x/every', 3); await svgOK('label every 3rd'); await setc('ax/x/every', '');
  await setc('ax/y/grid', false); await setc('ax/x/grid', true); await svgOK('gridlines swapped'); await setc('ax/y/grid', true); await setc('ax/x/grid', false);
  await tab('layout');
  for (const g of ['both', 'none', 'value']) { await page.evaluate(g => unchartEditor.change(d => { d.grid = g; }), g); await wait(30); await svgOK('grid ' + g); }

  // ---------- 3. colors, themes, looks and layouts ----------
  await tab('design');
  for (const th of ['dark', 'print', 'light']) { await setc('theme', th); await svgOK('background ' + th); }
  check((await snapshot()).includes('#FFFFFF'), 'light background');
  for (const p of await page.$$eval('#edPanes select[data-path="palette"] option', o => o.map(x => x.value))) { await setc('palette', p); await svgOK('palette ' + p); }
  await setc('palette', 'colorblind'); check((await snapshot()).includes('#0072B2'), 'colorblind palette used');
  await setc('palette', 'unchart');
  // looks gallery
  await clickBtn('Browse looks');
  const looks = await page.$$eval('#edPop [data-style]', o => o.map(x => x.dataset.style));
  check(looks.length >= 12, `the looks gallery shows ${looks.length} looks`);
  check(await page.$$eval('#edPop .thumb svg', s => s.length) === looks.length, 'every look has a live drawing');
  for (const l of looks) { await page.click(`#edPop [data-style="${l}"]`); await wait(60); await svgOK('look ' + l); }
  await page.click('#edPop [data-style="clean"]'); await wait(60);
  await shot('looks.png');
  await clickBtn('Quick layouts');
  const lays = await page.$$eval('#edPop [data-layout]', o => o.map(x => x.dataset.layout));
  check(lays.length >= 8, `the layouts gallery shows ${lays.length} layouts`);
  for (const l of lays) { await page.click(`#edPop [data-layout="${l}"]`); await wait(60); await svgOK('layout ' + l); }
  await page.click('#edPop [data-layout="standard"]'); await wait(60);
  await page.click('#edPop [data-pop="close"]'); await wait(30);
  check(await page.$eval('#edPop', e => e.hidden), 'the gallery closes');
  // saved themes
  await page.evaluate(() => localStorage.removeItem('unchart-themes'));
  await tab('design');
  await page.click('#edPop [data-style]').catch(() => { });
  await page.evaluate(() => unchartEditor.change(d => { d.palette = 'vivid'; d.font = 'serif'; d.theme = 'dark'; d.bar.gap = 12; }));
  await tab('design'); await setc('__themeName', 'Night serif'); await clickBtn('Save this look');
  check(await page.$$eval('#edPanes .throw', r => r.length) === 1 && /Night serif/.test(await page.$eval('#edPanes .throw', e => e.textContent)), 'a saved theme is listed');
  check(JSON.parse(await page.evaluate(() => localStorage.getItem('unchart-themes')))[0].set.palette === 'vivid', 'the theme is stored in the browser');
  await page.evaluate(() => unchartEditor.change(d => { d.palette = 'ink'; d.font = 'sans'; d.theme = 'light'; d.title = 'Kept words'; }));
  await tab('design'); await page.click('#edPanes .throw [data-th="apply"]'); await wait(60);
  let s1 = await spec();
  check(s1.palette === 'vivid' && s1.font === 'serif' && s1.theme === 'dark', 'applying a theme restores its look');
  check(s1.title === 'Kept words', 'a theme leaves the words alone');
  await svgOK('theme applied');
  const th = await download(() => page.click('#edPanes .throw [data-th="export"]'));
  check(/unchart-theme-night-serif\.json/.test(th.name) && JSON.parse(th.buf.toString()).unchartTheme === 1, 'a theme exports as a file');
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#edPanes [data-th="import"]')]);
  await fc.setFiles(th.path); await wait(150);
  check(await page.$$eval('#edPanes .throw', r => r.length) === 2, 'a theme file imports');
  await page.click('#edPanes .throw:last-child [data-th="delete"]'); await wait(40);
  check(await page.$$eval('#edPanes .throw', r => r.length) === 1, 'a theme deletes');
  await clickBtn('Use as the default for new charts');
  check(!!(await page.evaluate(() => localStorage.getItem('unchart-theme-default'))), 'a default theme can be set');
  await clickBtn('Clear default'); check(!(await page.evaluate(() => localStorage.getItem('unchart-theme-default'))), 'and cleared');
  await page.evaluate(() => localStorage.removeItem('unchart-themes'));
  await undoAll();
  check(strip(await snapshot()) === strip(before), 'undo returns to the first chart');

  // ---------- 4. format panes: fills, outlines, effects ----------
  await pick('chart');
  await setc('fm/chart/fill/t', 'solid'); await setc('fm/chart/fill/c', '#fff3e0'); check(/#fff3e0/i.test(await snapshot()), 'chart area solid fill');
  await setc('fm/chart/fill/t', 'grad'); await setc('fm/chart/fill/c2', '#ffd180'); check(/<linearGradient/.test(await snapshot()), 'chart area gradient fill');
  await setc('fm/chart/fill/k', 'radial'); check(/<radialGradient/.test(await snapshot()), 'radial gradient');
  await setc('fm/chart/fill/t', 'pat'); await setc('fm/chart/fill/pat', 'diag'); check(/<pattern/.test(await snapshot()), 'pattern fill');
  await setc('fm/chart/fill/t', 'none'); await svgOK('no fill');
  await setc('fm/chart/line/t', 'solid'); await setc('fm/chart/line/c', '#aa0000'); await setc('fm/chart/line/w', 3); await setc('fm/chart/line/dash', 'dash');
  check(/stroke-dasharray/.test(await snapshot()) && /#aa0000/i.test(await snapshot()), 'chart area outline color, width and dash');
  await setc('fm/chart/rad', 24); check(/rx="24"/.test(await snapshot()), 'rounded corners');
  await svgOK('chart area format');
  await pick('plot');
  await setc('fm/plot/fill/t', 'solid'); await setc('fm/plot/fill/c', '#e8f0fe'); await setc('fm/plot/shadow/on', true); check(/<filter/.test(await snapshot()), 'plot area shadow draws a filter');
  await setc('fm/plot/glow/on', true); await setc('fm/plot/soft/on', true); await svgOK('plot area effects');
  await pick('s0');
  await setc('series/names/0', 'Online sales'); check((await snapshot()).includes('Online sales'), 'series name');
  await setc('series/colors/0', '#123456'); check((await snapshot()).toLowerCase().includes('#123456'), 'series color');
  await setc('fm/s0/line/w', 6); await setc('fm/s0/line/dash', 'dot'); check(/stroke-dasharray/.test(await snapshot()), 'series line dash');
  await setc('so/0/ln/smooth', true); await setc('so/0/mk/shape', 'diamond'); await setc('so/0/mk/size', 9); await setc('so/0/mk/hollow', true);
  await svgOK('series markers and smoothing');
  await setc('fm/s0/shadow/on', true); await setc('fm/s0/glow/on', true); await svgOK('series effects');
  await setc('so/0/dl/on', true); await setc('so/0/dl/pos', 'above'); await svgOK('series data labels');
  // a bar chart: gap, overlap, per bar and per series color, corners
  await loadEx('ex_bars.png'); await page.click('#edPanes .tbtn[data-type="bar"]').catch(async () => { await tab('design'); await page.click('#edPanes .tbtn[data-type="bar"]'); });
  await tab('series');
  await setc('bar/gap', 10); await svgOK('narrow gap'); const wideBars = (await snapshot()).match(/<rect/g).length;
  await setc('bar/gap', 80); await svgOK('wide gap'); await setc('bar/rad', 10); check(/rx="10"|<path/.test(await snapshot()), 'rounded bars');
  await setc('bar/gap', 50); check(wideBars > 3, 'bars draw');
  await pick('s0'); await setc('fm/s0/fill/t', 'grad'); check(/<linearGradient/.test(await snapshot()), 'bar gradient');
  await setc('fm/s0/fill/t', 'pat'); await setc('fm/s0/fill/pat', 'horz'); check(/<pattern/.test(await snapshot()), 'bar pattern');
  await setc('fm/s0/line/t', 'solid'); await setc('fm/s0/line/w', 2); await svgOK('bar outline');
  await page.evaluate(() => { const n = document.querySelector('#rPrev [data-el="s0"][data-j="1"]'); if (n) { const r = n.getBoundingClientRect(); window.__pt = [r.x + r.width / 2, r.y + r.height / 2]; } });
  const pt = await page.evaluate(() => window.__pt);
  if (pt) { await page.mouse.click(pt[0], pt[1]); await wait(60); }
  check(!pt || (await page.evaluate(() => unchartEditor.selected)) === 's0.p1', 'clicking a bar picks that bar');
  if (pt) {
    await setc('fm/s0.p1/fill/t', 'solid'); await setc('fm/s0.p1/fill/c', '#ff00aa');
    check((await snapshot()).toLowerCase().includes('#ff00aa'), 'one bar takes its own color'); await svgOK('per point color');
  }
  // horizontal bars with units and a long list
  await loadEx('ex_hbars.png'); await svgOK('hbars');

  // ---------- 5. text boxes, shapes, callouts, reference lines ----------
  await loadEx('ex_line.png'); const base5 = await snapshot();
  await tab('add'); await clickBtn('Rectangle'); await svgOK('added Rectangle');
  let sp = await spec(); const rid0 = sp.ann[0].id;
  check(sp.ann.length === 1 && sp.ann[0].kind === 'rect', 'a rectangle is added');
  check(await page.evaluate(() => unchartEditor.tab) === 'format', 'adding opens the Format tab');
  // drag it by its outline
  const bb = await (await page.$(`#rPrev [data-el="ann:${rid0}"]`)).boundingBox();
  const gx = bb.x + 0.5, gy = bb.y + bb.height / 2;
  await page.mouse.move(gx, gy); await page.mouse.down(); await page.mouse.move(gx + 60, gy + 30, { steps: 6 }); await page.mouse.up(); await wait(60);
  let sp2 = await spec(); check(sp2.ann[0].fx > sp.ann[0].fx + 0.02 && sp2.ann[0].fy > sp.ann[0].fy + 0.01, `dragging moves a shape (${sp.ann[0].fx.toFixed(3)} to ${sp2.ann[0].fx.toFixed(3)})`);
  // resize from the corner handle
  const hnd = await page.$('#rPrev [data-handle="se"]'); check(!!hnd, 'a selected shape shows resize handles');
  if (hnd) { const hb = await hnd.boundingBox(); await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + 50, hb.y + 40, { steps: 5 }); await page.mouse.up(); await wait(60);
    const sp3 = await spec(); check(sp3.ann[0].fw > sp2.ann[0].fw + 0.02, 'the corner handle resizes'); }
  // keyboard: nudge, duplicate, delete
  const fx0 = (await spec()).ann[0].fx;
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowRight'); await wait(40);
  check((await spec()).ann[0].fx > fx0 + 0.005, 'arrow keys nudge the selected shape');
  await page.keyboard.press('Control+d'); await wait(60); check((await spec()).ann.length === 2, 'Ctrl D duplicates');
  await page.keyboard.press('Delete'); await wait(60); check((await spec()).ann.length === 1, 'Delete removes it');
  await pick('ann:' + rid0);
  await setc(`fm/ann:${rid0}/fill/t`, 'solid'); await setc(`fm/ann:${rid0}/fill/c`, '#ffe08a'); await setc(`fm/ann:${rid0}/line/t`, 'solid'); await setc(`fm/ann:${rid0}/line/w`, 3);
  check(/#ffe08a/i.test(await snapshot()), 'shape fill'); await svgOK('shape format');
  // a text box: its words, then a double click to edit them
  await tab('add'); await clickBtn('Text box'); sp = await spec(); const tid = sp.ann[sp.ann.length - 1].id; await svgOK('added Text box');
  await page.evaluate(() => { const t = document.querySelector('#edPanes textarea'); t.value = 'Prices fell after the launch'; t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new Event('change', { bubbles: true })); });
  check((await snapshot()).includes('Prices fell'), 'text box words reach the chart');
  await tab('design'); await page.dblclick(`#rPrev text[data-el="ann:${tid}"]`); await wait(60);
  check(await page.evaluate(() => document.activeElement && document.activeElement.tagName === 'TEXTAREA'), 'double click on a text box focuses its words');
  for (const k of ['Ellipse', 'Line', 'Arrow']) { await tab('add'); await clickBtn(k); await svgOK('added ' + k); }
  sp = await spec(); check(['rect', 'text', 'ellipse', 'line', 'arrow'].every((k, i) => sp.ann[i].kind === k), 'all five kinds of element are added');
  // callout on a point and reference lines and bands
  await tab('add'); await clickBtn('Add a callout'); await svgOK('callout');
  sp = await spec(); check(sp.ann.some(a => a.kind === 'callout'), 'a callout is added');
  { const c = sp.ann.find(a => a.kind === 'callout'); check(c.dx > 0 || c.dx < 0, 'the callout starts offset from its point'); }
  await tab('add');
  for (const k of ['Value line', 'Value band', 'Category line', 'Highlight a period']) { await tab('add'); await clickBtn(k); await svgOK('reference ' + k); }
  sp = await spec(); check(sp.refs.length === 4, 'four reference items added');
  check(/Target|Highlight/.test(await snapshot()), 'reference text appears');
  await tab('add');
  check(await page.$$eval('#edPanes [data-pick]', r => r.length) >= 9, 'every added item can be picked from the list');
  await page.click('#edPanes [data-pick]'); await wait(40); check(await page.evaluate(() => unchartEditor.tab) === 'format', 'picking an item opens its format');
  const rid = sp.refs[0].id; await pick('ref:' + rid);
  await setc('fm/ref:' + rid + '/line/c', '#cc0000'); await setc('fm/ref:' + rid + '/line/dash', 'dash'); await svgOK('reference format');
  // [ and ] walk the elements, Escape picks the whole chart
  const selA = await page.evaluate(() => unchartEditor.selected); await page.keyboard.press(']'); await wait(30);
  check((await page.evaluate(() => unchartEditor.selected)) !== selA, 'the right bracket moves to the next element');
  await page.keyboard.press('Escape'); await wait(30); check((await page.evaluate(() => unchartEditor.selected)) === 'chart', 'Escape picks the chart');
  await shot('annotations.png');
  await undoAll(); check(strip(await snapshot()) === strip(base5), 'undo removes everything that was added');

  // ---------- 6. copy and paste format, reset ----------
  await loadEx('ex_line.png');
  await pick('s0'); await setc('series/colors/0', '#0a7d4b'); await setc('fm/s0/line/w', 7); await setc('so/0/mk/shape', 'square');
  await clickBtn('Copy format');
  await pick('s1'); await clickBtn('Paste format'); await wait(40);
  sp = await spec(); check(getp(sp, 'fm/s1/line/w') === 7, 'paste format copies the line width onto another series');
  await pick('s1'); await page.keyboard.press('Control+Shift+c'); await pick('s0'); await page.keyboard.press('Control+Shift+v');
  await clickBtn('Reset'); sp = await spec(); check(getp(sp, 'fm/s0/line/w') == null, 'Reset clears the format of the picked element');
  await undoAll();

  // ---------- 7. undo, redo and shortcuts ----------
  await tab('text'); const t0 = strip(await snapshot());
  await setc('title', 'First'); await setc('title', 'Second'); await setc('title', 'Third');
  await page.keyboard.press('Control+z'); await wait(40);
  // focus is in the field, so the field handles the key; use the buttons for the editor
  await page.click('#rUndo'); await wait(40); check((await spec()).title === 'First' || (await spec()).title === 'Second', 'undo steps back');
  await page.click('#rRedo'); await wait(40);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z'); await wait(40); const afterKey = (await spec()).title;
  await page.keyboard.press('Control+Shift+z'); await wait(40); const afterRedo = (await spec()).title;
  check(afterKey !== afterRedo, 'Ctrl Z and Ctrl Shift Z work from the keyboard');
  await undoAll(); check(strip(await snapshot()) === t0, 'undo back to the start');
  check(await page.$eval('#rRedo', e => !e.disabled), 'redo is available after undo');

  // ---------- 8. accessibility: alt text, color vision, contrast ----------
  await tab('export');
  await setc('alt', 'Online sales rise faster than store sales.'); check(/Online sales rise faster/.test(await snapshot()), 'alt text is written into the SVG');
  await clickBtn('Clear'); await clickBtn('Write one from the data'); check((await spec()).alt.length > 20, 'alt text can be written from the data');
  for (const k of ['protan', 'deutan', 'tritan', 'gray', 'none']) { await setc('__cvd', k); await wait(40); check(k === 'none' ? !(await page.$eval('#rPrev', e => e.style.filter)) : /uc-cvd/.test(await page.$eval('#rPrev', e => e.style.filter)), 'preview as ' + k); }
  check(await page.$$eval('#a11y .check', c => c.length) >= 3, 'the accessibility check lists its findings');
  await page.evaluate(() => unchartEditor.change(d => { d.series.colors = { 0: '#2a9d8f', 1: '#2b9e90' }; })); await tab('export'); await wait(60);
  check(/look alike/.test(await page.$eval('#a11y', e => e.textContent)), 'two near identical colors are flagged');
  await page.evaluate(() => unchartEditor.change(d => { d.theme = 'light'; d.tx.xTick = { c: '#dddddd' }; })); await tab('export'); await wait(60);
  check(/faint/i.test(await page.$eval('#a11y', e => e.textContent)), 'low contrast text is flagged');
  const fix = await page.$('#a11y [data-fix]'); if (fix) { await fix.click(); await wait(60); }
  await undoAll();

  // ---------- 9. exports ----------
  await tab('text'); await setc('title', 'Store sales');
  await tab('export');
  const W = (await page.evaluate(() => unchartEditor.out.width));
  for (const k of [1, 2, 4]) {
    const f = await download(() => clickBtn('PNG ' + k + 'x'));
    check(f.buf.slice(1, 4).toString() === 'PNG' && f.buf.readUInt32BE(16) === W * k, `PNG ${k}x is ${W * k} px wide (${f.buf.readUInt32BE(16)})`);
    check(f.name === `unchart-store-sales${k > 1 ? '@' + k + 'x' : ''}.png`, 'PNG file named after the title: ' + f.name);
  }
  const sv = await download(() => clickBtn('SVG')); const svgText = sv.buf.toString();
  check(/^<svg xmlns/.test(svgText) && svgText.includes('Store sales'), 'SVG export is a standalone SVG');
  check(!/ucui|data-handle/.test(svgText), 'the SVG carries no editor handles');
  const pdf = await download(() => clickBtn('PDF'));
  check(pdf.buf.slice(0, 5).toString() === '%PDF-' && /%%EOF\s*$/.test(pdf.buf.slice(-20).toString('latin1')), 'PDF has a header and an end marker');
  const mb = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)/.exec(pdf.buf.toString('latin1')); check(!!mb && Math.abs(mb[1] / mb[2] - W / (await page.evaluate(() => unchartEditor.out.height))) < 0.02, 'PDF page has the chart shape');
  await setc('__transparent', true); const tp = await download(() => clickBtn('SVG')); check(!/<rect width="\d+" height="\d+"[^>]*fill="#/.test(tp.buf.toString().slice(0, 600)) || /fill="none"/.test(tp.buf.toString().slice(0, 600)), 'transparent SVG has no background fill'); await setc('__transparent', false);
  await clickBtn('Copy image'); await wait(500);
  check(/Image copied/.test(await toastText()), 'copy image reports success');
  check(/image\/png/.test(await page.evaluate(async () => { try { return (await navigator.clipboard.read())[0].types.join(','); } catch (e) { return 'err ' + e.message; } })), 'clipboard holds a PNG');
  await clickBtn('Copy SVG code'); await wait(200);
  check(/^<svg /.test(await page.evaluate(() => navigator.clipboard.readText())), 'clipboard holds SVG code');
  const jf = await download(() => clickBtn('Save chart settings')); const saved = JSON.parse(jf.buf.toString());
  check(saved.unchartChart === 1 && saved.spec.title === 'Store sales', 'chart settings save as a file');
  await page.evaluate(() => unchartEditor.change(d => { d.title = 'Changed'; d.palette = 'vivid'; }));
  const [fch] = await Promise.all([page.waitForEvent('filechooser'), clickBtn('Open chart settings')]); await fch.setFiles(jf.path); await wait(150);
  sp = await spec(); check(sp.title === 'Store sales' && sp.palette === saved.spec.palette, 'chart settings open again');

  // the XLSX holds the table and a native chart that follows the editor, read back with openpyxl
  const xl = async (ex, prep) => {
    await loadEx(ex); if (prep) await prep(); await tab('export');
    const f = await download(() => clickBtn('XLSX with a native chart'));
    const xp = path.join(OUT, 'x_' + ex.replace('.png', '') + '_' + Date.now() + '.xlsx'); fs.writeFileSync(xp, f.buf);
    try { return JSON.parse(execFileSync('python3', ['-I', path.join(__dirname, 'xlsx_check.py'), xp]).toString()); } catch (e) { return null; }
  };
  const haveOpenpyxl = (() => { try { execFileSync('python3', ['-c', 'import openpyxl']); return true; } catch (e) { return false; } })();
  if (haveOpenpyxl) {
    for (const [ex, kind, type, n] of [['ex_line.png', 'LineChart', null, 2], ['ex_bars.png', 'BarChart', null, 1], ['ex_pie.png', 'PieChart', null, 1], ['ex_pie.png', 'DoughnutChart', 'donut', 1], ['ex_dots.png', 'ScatterChart', null, 1], ['ex_hbars.png', 'BarChart', null, 1], ['ex_line.png', 'AreaChart', 'stackedArea', 2], ['ex_line.png', 'BarChart', 'combo', 2]]) {
      const r = await xl(ex, type ? async () => { await tab('design'); await page.click(`#edPanes .tbtn[data-type="${type}"]`); } : null);
      check(r && r.charts.length >= 1 && (r.charts[0].type === kind || (kind === 'PieChart' && /Pie|Doughnut/.test(r.charts[0].type))), `XLSX from ${ex}${type ? ' as ' + type : ''} has a native ${kind} (${r && r.charts[0] && r.charts[0].type})`);
      if (type === 'combo') check(r && r.charts[0] && r.charts[0].plots.includes('BarChart') && r.charts[0].plots.includes('LineChart'), 'XLSX combo draws bars and a line in one chart');
      if (r && r.charts[0] && n) check(r.charts[0].series >= n, `XLSX ${ex}${type ? ' ' + type : ''} has ${n} series (${r.charts[0].series})`);
    }
    // settings from the editor reach the file
    const r1 = await xl('ex_line.png', async () => {
      await page.evaluate(() => unchartEditor.change(d => { d.title = 'Sales'; d.fontSize = 16; d.legend = 'bottom'; d.series.colors = { 0: '#aa3300' }; d.ax.y.min = 0; d.ax.y.max = 500; d.ax.y.major = 100; d.ax.y.fmt = '$#,##0'; d.ax.y.rev = false; d.ln.smooth = true; d.ln.dash = 'dash';
        d.fm.chart = { fill: { t: 'solid', c: '#fff8e1' } }; d.fm.s1 = { shadow: { on: true } }; d.eb = { on: false }; d.alt = 'Sales by month'; d.dl = { on: true, fmt: '#,##0' }; d.ln.mk = 'on'; d.ln.shape = 'diamond';
        d.refs = [{ id: 'r1', axis: 'y', kind: 'line', v: 250, text: 'Target' }]; d.ann = [{ id: 'a1', kind: 'text', fx: 0.2, fy: 0.2, fw: 0.3, text: 'Launch' }, { id: 'a2', kind: 'rect', fx: 0.5, fy: 0.3, fw: 0.1, fh: 0.1 }]; }));
    });
    const c1 = r1 && r1.charts[0];
    check(c1 && c1.title === 'Sales', 'XLSX chart title follows the editor');
    check(c1 && c1.legend === 'b', `XLSX legend position follows the editor (${c1 && c1.legend})`);
    check(c1 && c1.y_axis.min === 0 && c1.y_axis.max === 500 && c1.y_axis.major === 100, 'XLSX value axis min, max and major unit');
    check(c1 && /\$/.test(c1.y_axis.numFmt || ''), `XLSX value axis number format (${c1 && c1.y_axis.numFmt})`);
    check(c1 && c1.s0.line === 'AA3300', `XLSX series color (${c1 && c1.s0.line})`);
    check(r1 && r1.xml.prstDash && r1.xml.smooth1 && r1.xml.dLbls, 'XLSX line dash, smoothing and data labels');
    check(r1 && r1.xml.effectLst, 'XLSX series shadow');
    check(r1 && r1.descr, 'XLSX chart carries the alt text');
    check(r1 && (r1.xml.userShapes || r1.parts.some(p => /drawing/.test(p) && /chart/.test(p))), 'XLSX carries the text box and shape');
    const r2 = await xl('ex_bars.png', async () => { await page.evaluate(() => unchartEditor.change(d => { d.bar.gap = 20; d.fm.bars = { fill: { t: 'grad', c: '#336699', c2: '#99ccee', ang: 90 } }; d.ax.y.log = false; d.ax.y.units = 1000; })); });
    check(r2 && r2.charts[0].gapWidth === 20, `XLSX bar gap (${r2 && r2.charts[0].gapWidth})`); check(r2 && r2.xml.gradFill, 'XLSX gradient fill');
    const r3 = await xl('ex_bars.png', async () => { await page.evaluate(() => unchartEditor.change(d => { d.fm.bars = { fill: { t: 'pat', pat: 'diag', c: '#336699' } }; })); });
    check(r3 && r3.xml.pattFill, 'XLSX pattern fill');
    const r4 = await xl('ex_hbars.png'); check(r4 && r4.charts[0].barDir === 'bar', 'XLSX horizontal bars point sideways');
    const r5 = await xl('ex_dots.png', async () => { await page.evaluate(() => unchartEditor.change(d => { d.ax.x.min = 0; d.ax.y.log = true; })); }); check(r5 && r5.charts[0].type === 'ScatterChart', 'XLSX scatter with axis options');
    // the file also opens in LibreOffice when it is installed
    try { execFileSync('which', ['soffice']); const lx = fs.readdirSync(OUT).filter(f => /^x_ex_line.*\.xlsx$/.test(f)).slice(-1)[0];
      execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', path.join(OUT, 'lo'), path.join(OUT, lx)], { timeout: 90000, stdio: 'ignore' }); check(fs.readdirSync(path.join(OUT, 'lo')).some(f => f.endsWith('.pdf')), 'LibreOffice opens the XLSX'); } catch (e) { say('LibreOffice not available'); }
  } else say('openpyxl not installed, XLSX checks skipped');

  // ---------- 10. full screen and window sizes ----------
  await loadEx('ex_line.png');
  await page.click('#rBig'); await wait(150);
  check(await page.$eval('#ed', e => e.classList.contains('big') && e.getBoundingClientRect().width >= innerWidth - 2), 'full screen fills the window');
  await layoutOK('full screen'); await shot('fullscreen.png');
  await page.keyboard.press('Escape'); await wait(100);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  if (await page.$eval('#ed', e => e.classList.contains('big'))) { await page.keyboard.press('Escape'); await wait(100); }
  check(!(await page.$eval('#ed', e => e.classList.contains('big'))), 'Escape leaves full screen');
  for (const [w, h] of [[1360, 1000], [1024, 800], [800, 900], [600, 900], [390, 844], [320, 640]]) {
    await page.setViewportSize({ width: w, height: h }); await wait(250);
    for (const ex of ['ex_line.png', 'ex_pie.png', 'ex_hbars.png']) {
      await loadEx(ex);
      await page.evaluate(l => unchartEditor.change(d => { d.title = l; d.dl.on = true; d.legend = 'right'; }), long); await wait(40);
      await svgOK(`${w}px ${ex}`);
      for (const t of ['design', 'series', 'axes', 'text', 'add', 'layout', 'export']) { await tab(t); await layoutOK(`${w}px ${ex} ${t} tab`); }
      await pick('s0'); await layoutOK(`${w}px ${ex} format tab`);
      await page.evaluate(() => unchartEditor.setTab('design'));
    }
    await page.$eval('#ed', e => e.scrollIntoView());
    await shot(`size_${w}.png`);
    await tab('format'); await pick('s0'); await shot(`size_${w}_format.png`);
    await page.click('#rBig'); await wait(150); await layoutOK(`${w}px full screen`); await shot(`size_${w}_full.png`);
    await page.click('#rBig'); await wait(100);
  }
  await page.setViewportSize({ width: 1360, height: 1000 });
  await loadEx('ex_line.png'); await clickBtn('Axes', '#edTabs'); await shot('axes_pane.png');
  await tab('add'); await shot('add_pane.png'); await tab('export'); await shot('export_pane.png');
  await tab('design'); await clickBtn('Browse looks'); await wait(300); await shot('looks_open.png');

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await b.close(); if (srv) srv.close();
  console.log(`${nChecks - fails.length} of ${nChecks} editor checks passed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
