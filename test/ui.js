// End to end check of the app in headless Chromium: every example, every tab, the editing tools, uploads (image,
// PDF with two charts, a tilted photo) and the exports. Saves screenshots to test/shots/ and fails on any page error.
// usage: node test/ui.js   (or PORT=8790 node test/ui.js to use a server that is already running)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const fails = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails.push(msg); };

(async () => {
  // serves the repo itself unless PORT points at a server that is already running
  const srv = process.env.PORT ? null : await require('../bench/serve.js').serve();
  const PORT = process.env.PORT || srv.port;
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1360, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // ../player.js only exists on the website the app is embedded in
  page.on('console', m => { if (m.type() === 'error' && !/favicon|player\.js|fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400 && !/player\.js|favicon/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => document.querySelectorAll('#table tbody tr').length > 0, null, { timeout: 30000 });
  const rows = () => page.$$eval('#table tbody tr', r => r.length);
  const kpi = id => page.$eval('#' + id, e => e.textContent.trim());

  // examples
  for (const [ex, type] of [['ex_line.png', 'Line'], ['ex_bars.png', 'Bars'], ['ex_dots.png', 'Dots'], ['ex_pie.png', 'Donut'], ['ex_hbars.png', 'Stacked bars'], ['ex_rates.png', 'Line']]) {
    await page.click(`[data-ex="${ex}"]`); await page.waitForTimeout(1300);
    check(await rows() > 0 && (await kpi('sType')) === type, `example ${ex}: ${await rows()} rows, read as ${await kpi('sType')}`);
    await page.screenshot({ path: path.join(OUT, 'example_' + ex) });
  }
  // tabs on the bar example (it has the truncated axis warning)
  await page.click('[data-ex="ex_bars.png"]'); await page.waitForTimeout(1300);
  for (const t of ['tIns', 'tRem', 'tHon', 'tExp', 'tData']) { await page.click('#' + t); await page.waitForTimeout(300); }
  await page.click('#tHon'); await page.waitForTimeout(200);
  check(/ISSUE/.test(await kpi('honBadge')), 'bar example flags the truncated axis');
  await page.click('[data-fix="truncated"]'); await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'honest_redraw.png') });
  check(/starts at zero/.test(await page.$eval('#rNote', e => e.textContent)), 'honest redraw note shown');
  await page.click('#tIns'); await page.waitForTimeout(300);
  check((await page.$eval('#altText', e => e.textContent)).startsWith('A bar chart'), 'alt text describes the chart');
  await page.screenshot({ path: path.join(OUT, 'reading.png'), fullPage: true });

  // exports
  await page.click('#tExp');
  for (const f of ['csv', 'latex', 'md', 'pandas', 'r', 'json']) { await page.click(`[data-f="${f}"]`); await page.waitForTimeout(100); check((await page.$eval('#code', e => e.textContent)).length > 20, 'export ' + f); }
  await page.click('#tData');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlXlsx')]);
  const xp = path.join(OUT, 'unchart.xlsx'); await dl.saveAs(xp);
  check(fs.readFileSync(xp).slice(0, 2).toString() === 'PK', 'xlsx download is a zip workbook');

  // type override on the line example: read it as dots, then back
  await page.click('[data-ex="ex_line.png"]'); await page.waitForTimeout(1300); await page.click('#tData');
  await page.selectOption('#rType', 'scatter'); await page.waitForTimeout(800);
  check((await kpi('sType')) === 'Dots', 'type override to dots');
  await page.selectOption('#rType', 'auto'); await page.waitForTimeout(800);
  check((await kpi('sType')) === 'Line', 'type back to auto');

  // editing: pick a point, nudge it, undo, delete, add
  const getBox = () => page.$eval('#sel', e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cw: e.width, ch: e.height }; });
  let box = await getBox();
  const p0 = await page.evaluate(() => { const r = JSON.parse(JSON.stringify(window.UNCHART_EXAMPLES['ex_line.png'])).series[0].points[3]; return [r.px, r.py, r.y]; });
  const sx = x => box.x + x / box.cw * box.w, sy = y => box.y + y / box.ch * box.h;
  const cell = () => page.$eval('#table td[data-r="3"][data-c="0"], #table td[data-r="3"][data-c="1"]', e => e.textContent);
  const before = await page.$$eval('#table tbody tr', r => r.map(t => t.textContent).join('|'));
  await page.mouse.move(sx(p0[0]), sy(p0[1])); await page.mouse.down(); await page.mouse.move(sx(p0[0]), sy(p0[1]) - 30, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(300);
  const moved = await page.$$eval('#table tbody tr', r => r.map(t => t.textContent).join('|'));
  check(moved !== before, 'dragging a point changes the table');
  await page.keyboard.press('Control+z'); await page.waitForTimeout(300);
  check((await page.$$eval('#table tbody tr', r => r.map(t => t.textContent).join('|'))) === before, 'undo restores it');
  await page.keyboard.press('Control+Shift+z'); await page.waitForTimeout(300);
  check((await page.$$eval('#table tbody tr', r => r.map(t => t.textContent).join('|'))) === moved, 'redo brings the edit back');
  await page.mouse.click(sx(p0[0]), sy(p0[1]) - 30); await page.waitForTimeout(200);
  const nBefore = await page.evaluate(() => document.querySelector('#sPoints').textContent);
  await page.keyboard.press('Delete'); await page.waitForTimeout(300);
  check(+(await kpi('sPoints')) === +nBefore - 1, 'Delete removes the picked point');
  await page.keyboard.press('a'); await page.mouse.move(sx(p0[0] + 18), sy(p0[1] + 38)); await page.mouse.move(sx(p0[0] + 20), sy(p0[1] + 40)); await page.waitForTimeout(150);
  check(await page.$eval('#loupe', e => !e.hidden && e.getBoundingClientRect().width > 100), 'magnifier shows while adding a point');
  await page.screenshot({ path: path.join(OUT, 'loupe.png') });
  await page.mouse.click(sx(p0[0] + 20), sy(p0[1] + 40)); await page.waitForTimeout(300);
  check(+(await kpi('sPoints')) === +nBefore, 'add point mode adds a point');
  await page.keyboard.press('Escape');
  check(await page.$eval('#loupe', e => e.hidden), 'magnifier hides when the tool is off');
  await page.keyboard.press('?'); await page.waitForTimeout(200);
  check(await page.$eval('#help', e => !e.hidden), '? opens the shortcuts');
  await page.keyboard.press('Escape');
  await page.click('#showErr'); await page.waitForTimeout(200);
  check((await page.$$eval('#table td.pm', t => t.filter(e => /±/.test(e.textContent)).length)) > 0, 'error bars shown in the table');
  await page.selectOption('#numStyle', 'eu'); await page.waitForTimeout(200);
  check(/\d,\d/.test(await page.$eval('#table tbody', e => e.textContent)), 'European number style');
  await page.selectOption('#numStyle', 'us');
  await page.screenshot({ path: path.join(OUT, 'editing.png') });

  // a real upload: a chart image through the file picker (runs the OCR)
  const fileIn = await page.$('#file');
  const upload = async (f, wait = 90000) => {
    // forget the last result's time, so the wait below is for this file
    await page.evaluate(() => { document.querySelector('#time').textContent = ''; });
    await fileIn.setInputFiles(f);
    await page.waitForFunction(() => (document.querySelector('#time').textContent || '').match(/^\d+\.\d s$/) || document.querySelector('#errbox .err'), null, { timeout: wait });
    await page.waitForTimeout(500);
  };
  await upload(path.join(__dirname, '..', 'examples', 'ex_bars.png'), 120000);
  check(await rows() === 6, `uploaded bar chart reads 6 bars (${await rows()} rows, ${await kpi('sType')})`);
  // resample a line, then the manual axis
  await upload(path.join(__dirname, '..', 'examples', 'ex_rates.png'));
  check(await page.$eval('#stepRow', e => !e.hidden), 'resample control shown for a line');
  await page.fill('#stepIn', '91'); await page.click('#stepGo'); await page.waitForTimeout(300);
  await page.click('#tExp'); await page.click('[data-f="csv"]');
  check((await page.$eval('#code', e => e.textContent)).split('\n').length > 10, 'resampled export');
  await page.click('#tData');
  // fix axis by hand: click the 1 and 7 ticks of the rates chart and type their values
  await page.click('[data-mode="calib"]');
  box = await getBox();
  // tick positions from the example's own reading
  const ex = await page.evaluate(() => window.UNCHART_EXAMPLES['ex_rates.png'].calib.y);
  const lo = ex[ex.length - 1], hi = ex[0];
  for (const t of [lo, hi]) {
    await page.mouse.click(sx(45), sy(t.p)); await page.waitForTimeout(150);
    await page.fill('#calibIn', String(t.v)); await page.click('#calibOk'); await page.waitForTimeout(400);
  }
  check(!(await page.$eval('#errbox', e => /could not/.test(e.textContent))) && await rows() > 5, 'manual axis with two clicks');
  await page.screenshot({ path: path.join(OUT, 'manual_axis.png') });

  // a PDF with two charts: both are found and the first is read
  const pdf = path.join(__dirname, 'fixtures', 'two_charts.pdf');
  if (fs.existsSync(pdf)) {
    await upload(pdf, 150000);
    check(await page.$$eval('[data-box]', b => b.length) === 2, 'two charts found in the PDF');
    check(await rows() > 0, 'first chart of the PDF read');
    await page.click('[data-box="1"]');
    await page.waitForFunction(() => (document.querySelector('#time').textContent || '').match(/^\d+\.\d s$/), null, { timeout: 90000 }); await page.waitForTimeout(500);
    check(await rows() > 0, 'second chart of the PDF read');
    await page.screenshot({ path: path.join(OUT, 'pdf.png') });
  } else check(false, 'missing test/fixtures/two_charts.pdf');
  // a photo of a screen taken at an angle: straighten it with the four corners, then read
  const photo = path.join(__dirname, 'fixtures', 'photo.jpg');
  if (fs.existsSync(photo)) {
    await upload(photo, 150000);
    await page.click('[data-mode="warp"]'); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'photo_corners.png') });
    await page.click('#cropgo');
    await page.waitForFunction(() => (document.querySelector('#time').textContent || '').match(/^\d+\.\d s$/) || document.querySelector('#errbox .err'), null, { timeout: 120000 }); await page.waitForTimeout(500);
    check(await rows() > 0, 'straightened photo reads');
    await page.screenshot({ path: path.join(OUT, 'photo_read.png') });
  } else check(false, 'missing test/fixtures/photo.jpg');
  // narrow screen
  await page.setViewportSize({ width: 390, height: 900 }); await page.click('[data-ex="ex_pie.png"]'); await page.waitForTimeout(1300);
  await page.screenshot({ path: path.join(OUT, 'phone.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, 'no sideways scroll on a phone (' + overflow + ' px)');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
  await b.close(); if (srv) srv.close();
  console.log(fails.length ? `${fails.length} check(s) failed` : 'all UI checks passed');
  process.exit(fails.length ? 1 : 0);
})();
