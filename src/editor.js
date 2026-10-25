// The chart editor: format panes for every element of the redrawn chart, in the style of the Format Chart panes in
// PowerPoint and Excel. Click an element in the picture (or pick it from the list) and its options open on the Format tab.
// The chart is one JSON object (the spec). Every control reads and writes a path in it, and every change goes through
// one place, so undo, redo, saved themes and the XLSX export all see the same thing.
(function (root) {
  'use strict';
  const RM = root.UnchartRemake, ST = root.UnchartStyle, PR = root.UnchartPresets;
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = ST.esc;
  const getp = (o, p) => p.split('/').reduce((a, k) => a == null ? undefined : a[k], o);
  function setp(o, p, v) {
    const ks = p.split('/'); let a = o;
    for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; }
    if (v === undefined || v === null) delete a[ks[ks.length - 1]]; else a[ks[ks.length - 1]] = v;
  }
  const P = (...a) => a.join('/');
  const TABS = [['design', 'Design'], ['series', 'Series'], ['axes', 'Axes'], ['text', 'Text'], ['format', 'Format'], ['add', 'Add'], ['layout', 'Layout'], ['export', 'Export']];
  const DASHES = [['', 'Automatic'], ['solid', 'Solid'], ['dash', 'Dash'], ['dot', 'Dot'], ['dashdot', 'Dash dot'], ['long', 'Long dash'], ['longdot', 'Long dash dot']];
  const TICKS = [['none', 'None'], ['out', 'Outside'], ['in', 'Inside'], ['cross', 'Across']];
  const WEIGHTS = [['', 'Automatic'], ['400', 'Regular'], ['500', 'Medium'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold']];
  const SIZES = [['', 'Same as chart'], ['640', 'Small, 640 px'], ['800', 'Medium, 800 px'], ['1200', 'Large, 1200 px'], ['1600', 'Wide, 1600 px']];
  const SIZE_PRESETS = [['', 'Custom'], ['800x450', 'Blog, 800 by 450'], ['1200x675', 'Social post, 1200 by 675'], ['1080x1080', 'Square post, 1080 by 1080'], ['1080x1350', 'Portrait post, 1080 by 1350'], ['1920x1080', 'Slide, 1920 by 1080'], ['1000x1414', 'A4 portrait'], ['1414x1000', 'A4 landscape'], ['1600x500', 'Banner, 1600 by 500']];
  const COMMON_FONTS = ['Inter', 'Helvetica Neue', 'Helvetica', 'Arial', 'Verdana', 'Trebuchet MS', 'Tahoma', 'Segoe UI', 'Calibri', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Source Sans Pro', 'Futura', 'Gill Sans', 'Georgia', 'Palatino', 'Garamond', 'Cambria', 'Baskerville', 'Times New Roman', 'Courier New', 'Consolas', 'Menlo', 'Impact'];
  const ELEMENT_NAMES = { chart: 'Chart area', plot: 'Plot area', title: 'Title', subtitle: 'Subtitle', note: 'Source note', legend: 'Legend', xTitle: 'Horizontal axis title', yTitle: 'Vertical axis title', y2Title: 'Right axis title',
    xTick: 'Horizontal axis labels', yTick: 'Vertical axis labels', y2Tick: 'Right axis labels', axisX: 'Category axis', axisY: 'Value axis', axisY2: 'Right value axis', grid: 'Gridlines', gridM: 'Minor gridlines', label: 'Data labels', eb: 'Error bars', pieCenter: 'Center text' };
  const TEXT_KEYS = ['title', 'subtitle', 'note', 'legend', 'xTitle', 'yTitle', 'y2Title', 'xTick', 'yTick', 'y2Tick', 'label', 'pieCenter'];
  const isSeries = k => /^s\d+$/.test(k), isPoint = k => /^s\d+\.p\d+$/.test(k), isSlice = k => /^sl\d+$/.test(k);
  const uid = () => Math.random().toString(36).slice(2, 7);
  const SVGNS = 'http://www.w3.org/2000/svg';

  function init(ctx) {
    const { $, S } = ctx, E = ctx.E;
    const ED = { tmp: {}, spec: clone(RM.DEFAULTS), hist: [], fut: [], sel: 'chart', tab: 'design', fonts: [], clip: null, cvd: 'none', pop: '', before: null, drag: null };
    const root_ = $('ed'), prev = $('rPrev'), pane = $('edPanes');
    const whens = new Map(), metas = new Map();
    // paths that start with two underscores are kept beside the chart (a name being typed, a menu choice), never in its settings
    const rd = p => p.startsWith('__') ? ED.tmp[p.slice(2)] : getp(ED.spec, p);
    const wr = (d, p, v) => { if (p.startsWith('__')) ED.tmp[p.slice(2)] = v; else setp(d, p, v); };
    const readC = c => c.get ? c.get() : rd(c.path);
    const putC = (c, d, v, path) => { if (c.put) c.put(d, v); else wr(d, path || c.path, v); };
    let table = null, out = null, pending = 0, hover = null;

    // ---------- history ----------
    const snap = () => JSON.stringify(ED.spec);
    function pushHist(before) { if (before == null || before === snap()) return; ED.hist.push(before); if (ED.hist.length > 200) ED.hist.shift(); ED.fut = []; syncUndo(); }
    function syncUndo() { $('rUndo').disabled = !ED.hist.length; $('rRedo').disabled = !ED.fut.length; }
    function restore(json) { ED.spec = JSON.parse(json); structural(); }
    function undo() { if (!ED.hist.length) return; ED.fut.push(snap()); restore(ED.hist.pop()); }
    function redo() { if (!ED.fut.length) return; ED.hist.push(snap()); restore(ED.fut.pop()); }
    // one undoable change
    function change(f) { const b = snap(); f(ED.spec); pushHist(b); structural(); }

    // ---------- the table behind the chart ----------
    const isPieType = () => ['pie', 'donut'].includes(ED.spec.type);
    function chartTable() {
      let T = ctx.getTable(); if (!T) return null;
      if (T.pie && !isPieType()) T = Object.assign({}, T, { rows: [...T.rows].sort((a, b) => b.vals[0] - a.vals[0]) });
      if (ED.spec.index) {
        const first = T.cols.map((_, j) => { const r = T.rows.find(q => q.vals[j] != null && q.vals[j] !== 0); return r ? r.vals[j] : null; });
        T = Object.assign({}, T, { rows: T.rows.map(r => ({ x: r.x, vals: r.vals.map((v, j) => v == null || !first[j] ? null : v / first[j] * 100) })) });
      }
      return T;
    }
    const specOpts = extra => Object.assign({}, ED.spec, { euro: S.euro, xDate: !!(S.res && S.res.axis && S.res.axis.xDate), fontFaces: ED.fonts.map(f => ({ family: f.family, src: f.src })) }, extra || {});
    const horizType = () => ['hbar', 'hstacked', 'hstacked100'].includes(ED.spec.type);
    const barType = () => ['bar', 'hbar', 'stacked', 'hstacked', 'stacked100', 'hstacked100', 'combo', 'lollipop'].includes(ED.spec.type);
    const stackType = () => ['stacked', 'stacked100', 'hstacked', 'hstacked100', 'stackedArea', 'stackedArea100'].includes(ED.spec.type);
    const numX = () => { const T = ctx.getTable(); return !!T && (T.rows.every(r => typeof r.x === 'number') || E.isDateCol(T.rows.map(r => r.x))); };
    const dateX = () => { const T = ctx.getTable(); return !!T && E.isDateCol(T.rows.map(r => r.x)); };
    const nSeries = () => { const T = ctx.getTable(); return T ? T.cols.length : 0; };

    // ---------- drawing ----------
    const NS_TYPES = { bar: 'bar', grouped_bar: 'bar', histogram: 'bar', bar_line: 'combo', hbar: 'hbar', stacked_bar: 'stacked', stacked_hbar: 'hstacked', line: 'line', step: 'step', area: 'area', stacked_area: 'stackedArea', scatter: 'scatter', pie: 'pie', donut: 'donut' };
    function defaultsFor(R) {
      const pie = R.chartType === 'pie' || R.chartType === 'donut';
      const t = NS_TYPES[R.chartType] || (R.series.every(s => s.type === 'scatter') ? 'scatter' : R.series.some(s => s.type === 'bar') ? 'bar' : 'line');
      const d = Object.assign(clone(RM.DEFAULTS), { type: t, index: false, legend: pie ? 'right' : 'top' });
      d.dl.on = pie;
      let th = null; try { th = JSON.parse(localStorage.getItem('unchart-theme-default') || 'null'); } catch (e) { th = null; }
      if (th && th.set) applyLookTo(d, th.set, true);
      return d;
    }
    function fresh() {
      const R = S.res; if (!R || !R.ok || ED.for === S.canvas) return;
      ED.for = S.canvas; ED.spec = defaultsFor(R); ED.hist = []; ED.fut = []; ED.sel = 'chart'; structural();
    }
    function render(extra) {
      table = chartTable();
      if (!table || $('pRem').hidden) return;
      out = RM.render(table, specOpts(Object.assign({ hit: true }, extra))); S.edOut = out;
      prev.innerHTML = out.svg; decorate();
      prev.style.filter = ED.cvd === 'none' ? '' : `url(#uc-cvd-${ED.cvd})`;
      if (extra) return;
      $('rNote').textContent = notesText();
      if (ED.tab === 'export') drawChecks();
      if (ED.tab === 'design' && ED.pop) drawPop();
      if (ED.tab === 'design') drawThumbsSoon();
    }
    function renderSoon() { if (pending) return; pending = requestAnimationFrame(() => { pending = 0; render(); }); }
    function notesText() {
      const notes = out.notes.slice(), R = S.res, F = (R && R.flags) || [], e = ED.spec;
      if (F.some(f => f.code === 'truncated') && ['bar', 'hbar', 'stacked'].includes(e.type) && e.zero && e.yMin == null && !(e.ax && e.ax.y && e.ax.y.min != null)) notes.unshift('The original chart cut off the bottom of its axis. This version starts at zero, so the bars compare fairly.');
      if (ctx.isPie(R) && !isPieType()) notes.push('The slices are drawn as bars, largest first, because lengths are easier to compare than angles.');
      if (e.index) notes.push('Each series is divided by its first value and multiplied by 100, so they share one scale and their growth compares directly.');
      const vt = ctx.getTable(); if (vt && vt.resampled) notes.push(`Resampled every ${ctx.fmt(vt.resampled)}${vt.resampledDays ? ' days' : ''} on x.`);
      const vis = table.cols;
      (out.projections || []).forEach((p, i) => { if (!p) return; const q = p.pts[p.pts.length - 1], ser = (e.series.order || vis.map((_, j) => j)).filter(j => !(e.series.hidden || []).includes(j))[i], nm = (e.series.names || {})[ser] || vis[ser].name;
        if (p.fit) { notes.push(`${nm} rises about ${ctx.fmt(p.slope)} for every 1 on x. The straight line explains ${(Math.max(0, p.r2) * 100).toFixed(0)}% of the spread, and the band shows where 90% of new points would land.`); return; }
        notes.push(`${nm} heads to about ${ctx.fmt(q.y)} by ${ctx.fmt(q.x)}, with a 90% band of ${ctx.fmt(q.lo)} to ${ctx.fmt(q.hi)}. The ${p.kind === 'growth' ? 'growth curve' : 'straight line'} explains ${(Math.max(0, p.r2) * 100).toFixed(0)}% of the past movement.`); });
      if (out.projections && out.projections.some(p => p && !p.fit)) notes.push('A projection only carries the past forward. It cannot see anything about to change.');
      return notes.join(' ');
    }

    // ---------- the selection box over the picture ----------
    const keyBox = key => {
      const svg = prev.querySelector('svg'); if (!svg) return null;
      let b = out && out.geom.els[key.replace(/\.p\d+$/, '')];
      if (isPoint(key)) { const [s, j] = key.slice(1).split('.p'); const n = svg.querySelector(`[data-el="s${s}"][data-j="${j}"]`); if (n) { const q = n.getBBox(); return [q.x, q.y, q.x + q.width, q.y + q.height]; } }
      if (isSeries(key) || isSlice(key)) { const ns = svg.querySelectorAll(`[data-el="${key}"]`); let u = null; ns.forEach(n => { try { const q = n.getBBox(); if (!q.width && !q.height) return; const r = [q.x, q.y, q.x + q.width, q.y + q.height]; u = u ? [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])] : r; } catch (e) { /* not drawn */ } }); return u; }
      if (b) return b;
      const ns = svg.querySelectorAll(`[data-el="${key}"]`); let u = null; ns.forEach(n => { try { const q = n.getBBox(); const r = [q.x, q.y, q.x + q.width, q.y + q.height]; u = u ? [Math.min(u[0], r[0]), Math.min(u[1], r[1]), Math.max(u[2], r[2]), Math.max(u[3], r[3])] : r; } catch (e) { /* not drawn */ } });
      return u;
    };
    const annOf = key => (ED.spec.ann || []).find(a => 'ann:' + a.id === key);
    const refOf = key => (ED.spec.refs || []).find(a => 'ref:' + a.id === key);
    function decorate() {
      const svg = prev.querySelector('svg'); if (!svg) return;
      const old = svg.querySelector('#ucui'); if (old) old.remove();
      const g = document.createElementNS(SVGNS, 'g'); g.id = 'ucui'; g.setAttribute('pointer-events', 'none');
      const box = (key, hot) => { const b = keyBox(key); if (!b) return null; const r = document.createElementNS(SVGNS, 'rect'), p = 3;
        r.setAttribute('x', b[0] - p); r.setAttribute('y', b[1] - p); r.setAttribute('width', Math.max(2, b[2] - b[0] + 2 * p)); r.setAttribute('height', Math.max(2, b[3] - b[1] + 2 * p));
        r.setAttribute('fill', hot ? 'rgba(255,90,31,.06)' : 'none'); r.setAttribute('stroke', '#FF5A1F'); r.setAttribute('stroke-width', hot ? 1 : 1.5); r.setAttribute('stroke-dasharray', hot ? '2 3' : '5 3'); r.setAttribute('vector-effect', 'non-scaling-stroke'); g.appendChild(r); return b; };
      if (hover && hover !== ED.sel) box(hover, true);
      const b = box(ED.sel, false);
      if (b && annOf(ED.sel)) handles(g, annOf(ED.sel), b);
      svg.appendChild(g);
    }
    function handles(g, a, b) {
      const pts = [];
      if (a.kind === 'line' || a.kind === 'arrow') { const W = out.width, H = out.height; pts.push(['start', (a.fx || 0) * W, (a.fy || 0) * H], ['end', ((a.fx || 0) + (a.fw || 0)) * W, ((a.fy || 0) + (a.fh || 0)) * H]); }
      else if (a.kind === 'rect' || a.kind === 'ellipse') pts.push(['nw', b[0], b[1]], ['ne', b[2], b[1]], ['sw', b[0], b[3]], ['se', b[2], b[3]]);
      else if (a.kind === 'text') pts.push(['e', b[2], (b[1] + b[3]) / 2]);
      pts.forEach(([h, x, y]) => { const r = document.createElementNS(SVGNS, 'rect'); r.setAttribute('x', x - 4.5); r.setAttribute('y', y - 4.5); r.setAttribute('width', 9); r.setAttribute('height', 9); r.setAttribute('rx', 2);
        r.setAttribute('fill', '#fff'); r.setAttribute('stroke', '#FF5A1F'); r.setAttribute('stroke-width', 1.5); r.dataset.handle = h; r.style.pointerEvents = 'all'; r.style.cursor = h === 'e' ? 'ew-resize' : 'nwse-resize'; g.appendChild(r); });
    }
    function labelOf(key) {
      if (ELEMENT_NAMES[key]) return ELEMENT_NAMES[key];
      const T = ctx.getTable(); if (!T) return key;
      if (isPoint(key)) { const [s, j] = key.slice(1).split('.p').map(Number); return `${T.cols[s] ? T.cols[s].name : 'Series'}, ${T.rows[j] ? String(T.rows[j].x) : ''}`; }
      if (isSeries(key)) return 'Series ' + (((ED.spec.series.names || {})[+key.slice(1)]) || (T.cols[+key.slice(1)] || {}).name || key);
      if (isSlice(key)) { const k = +key.slice(2); return 'Slice ' + (((ED.spec.slices.names || {})[k]) || (T.rows[k] ? T.rows[k].x : k)); }
      if (key.startsWith('ann:')) { const a = annOf(key); return a ? ({ text: 'Text box', callout: 'Callout', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow' }[a.kind] || 'Shape') + (a.text ? ': ' + a.text.slice(0, 22) : '') : key; }
      if (key.startsWith('ref:')) { const r = refOf(key); return r ? (r.kind === 'band' ? 'Band' : 'Reference line') + (r.text ? ': ' + r.text : '') : key; }
      return key;
    }
    const valueHint = (key, j) => {
      const T = ctx.getTable(); if (!T || j == null) return '';
      const row = T.rows[j]; if (!row) return '';
      if (isSlice(key)) return `${row.x}: ${ctx.fmt(row.vals[0])}%`;
      const i = +key.slice(1).split('.')[0]; return `${T.cols[i].name} at ${typeof row.x === 'number' ? ctx.fmt(row.x) : row.x}: ${ctx.fmt(row.vals[i])}`;
    };

    // ---------- selecting ----------
    function select(key, quiet) {
      if (!key) key = 'chart';
      ED.sel = key; void quiet;
      const el = $('edSel'); if (el && [...el.options].some(o => o.value === key)) el.value = key;
      if (ED.tab === 'format') buildPane(); decorate(); syncHead();
    }
    function syncHead() { $('edHint').textContent = ED.hintOverride || labelOf(ED.sel); }
    function elementList() {
      const e = ED.spec, T = ctx.getTable(), L = [['chart', ELEMENT_NAMES.chart], ['plot', ELEMENT_NAMES.plot], ['title', 'Title'], ['subtitle', 'Subtitle']];
      if (!T) return L;
      if (out && out.geom && out.geom.legend) L.push(['legend', 'Legend']);
      if (!isPieType()) { L.push(['axisX', ELEMENT_NAMES.axisX], ['axisY', ELEMENT_NAMES.axisY]); if (T.cols.some(c => c.axis === 'right') && e.dual !== false) L.push(['axisY2', ELEMENT_NAMES.axisY2]); L.push(['grid', ELEMENT_NAMES.grid]); }
      if (isPieType()) T.rows.forEach((r, k) => { if (!(e.slices.hidden || []).includes(k)) L.push(['sl' + k, 'Slice ' + (((e.slices.names || {})[k]) || r.x)]); });
      else T.cols.forEach((c, i) => { if (!(e.series.hidden || []).includes(i)) L.push(['s' + i, 'Series ' + (((e.series.names || {})[i]) || c.name)]); });
      L.push(['label', 'Data labels'], ['note', 'Source note']);
      (e.refs || []).forEach(r => L.push(['ref:' + r.id, labelOf('ref:' + r.id)]));
      (e.ann || []).forEach(a => L.push(['ann:' + a.id, labelOf('ann:' + a.id)]));
      if (ED.sel && !L.some(l => l[0] === ED.sel)) L.push([ED.sel, labelOf(ED.sel)]);
      return L;
    }
    function fillElementList() {
      const el = $('edSel'), L = elementList(), cur = ED.sel;
      el.innerHTML = L.map(([k, n]) => `<option value="${esc(k)}">${esc(n)}</option>`).join(''); el.value = cur;
    }

    // ---------- controls ----------
    const K = {
      txt: (label, path, o) => Object.assign({ k: 'txt', label, path }, o),
      area: (label, path, o) => Object.assign({ k: 'area', label, path }, o),
      num: (label, path, o) => Object.assign({ k: 'num', label, path }, o),
      rng: (label, path, o) => Object.assign({ k: 'rng', label, path }, o),
      sel: (label, path, o) => Object.assign({ k: 'sel', label, path }, o),
      chk: (label, path, o) => Object.assign({ k: 'chk', label, path }, o),
      col: (label, path, o) => Object.assign({ k: 'col', label, path }, o),
      seg: (label, path, o) => Object.assign({ k: 'seg', label, path }, o),
      fmt: (label, path, o) => Object.assign({ k: 'fmt', label, path }, o),
      btn: (label, act, o) => Object.assign({ k: 'btn', label, act }, o),
      note: (text, o) => Object.assign({ k: 'note', text }, o),
      btns: (list, o) => Object.assign({ k: 'btns', list }, o),
    };
    function ctl(c) {
      const row = document.createElement('div'), id = 'c' + uid();
      if (!c.path && c.get) c.path = '__' + id;
      row.className = 'row' + (c.k === 'chk' || c.k === 'note' || c.k === 'btn' || c.k === 'btns' ? ' wide' : '') + (c.cls ? ' ' + c.cls : '');
      const path = c.path || '', tip = c.tip ? ` title="${esc(c.tip)}"` : '';
      const lab = c.label ? `<label for="${id}"${tip}>${esc(c.label)}</label>` : '';
      switch (c.k) {
        case 'txt': row.innerHTML = `${lab}<input id="${id}" type="text" data-path="${path}" maxlength="${c.max || 200}" ${c.ph ? `placeholder="${esc(c.ph)}"` : ''} autocomplete="off" spellcheck="${c.spell ? 'true' : 'false'}"${c.list ? ` list="${c.list}"` : ''}>`; break;
        case 'area': row.innerHTML = `${lab}<textarea id="${id}" rows="${c.rows || 3}" data-path="${path}" maxlength="${c.max || 400}" spellcheck="true"></textarea>`; break;
        case 'num': row.innerHTML = `${lab}<span class="nwrap"><input id="${id}" type="text" inputmode="decimal" data-path="${path}" ${c.ph ? `placeholder="${esc(c.ph)}"` : 'placeholder="auto"'} autocomplete="off">${c.unit ? `<i>${esc(c.unit)}</i>` : ''}</span>`; break;
        case 'rng': row.innerHTML = `${lab}<span class="rwrap"><input id="${id}" type="range" min="${c.min}" max="${c.max}" step="${c.step || 1}" data-path="${path}"><output></output></span>`; break;
        case 'sel': row.innerHTML = `${lab}<select id="${id}" data-path="${path}">${c.opts.map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select>`; break;
        case 'chk': row.innerHTML = `<label class="tog"${tip}><input id="${id}" type="checkbox" data-path="${path}"> ${esc(c.label)}</label>`; break;
        case 'col': row.innerHTML = `${lab}<span class="cwrap"><input id="${id}" type="color" data-path="${path}"><button type="button" class="chip tiny" data-auto="${path}" title="Go back to the automatic color">Auto</button></span>`; break;
        case 'seg': row.innerHTML = `${lab}<span class="seg s" role="group" aria-label="${esc(c.label || '')}">${c.opts.map(([v, n]) => `<button type="button" data-path="${path}" data-v="${esc(v)}" aria-pressed="false">${esc(n)}</button>`).join('')}</span>`; break;
        case 'fmt': { const list = (c.date ? ST.DATE_CODES : ST.NUMBER_CODES).concat([['Custom', '__custom']]); row.innerHTML = `${lab}<span class="fwrap"><select id="${id}" data-fmtsel="${path}">${list.map(([n, v]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('')}</select><input type="text" data-path="${path}" data-fmt="1" placeholder="${c.date ? 'yyyy-mm-dd' : '#,##0.00'}" aria-label="${esc(c.label || 'Format code')} code" autocomplete="off" spellcheck="false"></span>`; break; }
        case 'btn': row.innerHTML = `<button type="button" class="btn ${c.cls2 || ''}" data-act="1">${esc(c.label)}</button>`; break;
        case 'btns': row.innerHTML = `<span class="btnrow">${c.list.map((b, i) => `<button type="button" class="chip" data-act="${i}"${b.tip ? ` title="${esc(b.tip)}"` : ''}>${esc(b.label)}</button>`).join('')}</span>`; break;
        case 'note': row.innerHTML = `<p class="hint">${esc(c.text)}</p>`; break;
        default: break;
      }
      metas.set(row, c); if (c.when) whens.set(row, c.when);
      return row;
    }
    function group(title, ctls, open) {
      const d = document.createElement('details'); d.className = 'grp'; d.open = open !== false; d.dataset.g = title;
      const s = document.createElement('summary'); s.textContent = title; d.appendChild(s);
      const b = document.createElement('div'); b.className = 'gb'; ctls.filter(Boolean).forEach(c => b.appendChild(ctl(c))); d.appendChild(b); return d;
    }
    function readCtl(el) {
      const c = metas.get(el.closest('.row')) || {};
      if (el.type === 'checkbox') return el.checked;
      if (el.type === 'range') return +el.value;
      if (el.dataset.v != null) return el.dataset.v;
      if (c.k === 'num') { const t = String(el.value).trim().replace(',', '.'); if (t === '') return null; const v = parseFloat(t); return isFinite(v) ? (c.scale ? v / c.scale : v) : undefined; }
      if (c.k === 'sel' && c.num) return el.value === '' ? null : +el.value;
      if (c.k === 'sel' && c.bool) return el.value === '' ? null : el.value === 'true';
      if (c.k === 'sel' && c.auto && el.value === '') return null;
      return el.value;
    }
    function syncCtl(row) {
      const c = metas.get(row); if (!c) return;
      const w = whens.get(row); if (w) row.hidden = !w(ED.spec);
      if (!c.path && !c.get) return;
      let v = readC(c); if (v === undefined && c.def !== undefined) v = typeof c.def === 'function' ? c.def() : c.def;
      const inp = row.querySelector('[data-path]:not(button)'), act = document.activeElement;
      if (c.k === 'seg') row.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v) === String(v == null ? '' : v)));
      else if (c.k === 'fmt') { const sel = row.querySelector('select'), t = row.querySelector('input'); if (act !== t) t.value = v || ''; const known = (c.date ? ST.DATE_CODES : ST.NUMBER_CODES).some(([, code]) => code === (v || '')); sel.value = known ? (v || '') : '__custom'; }
      else if (inp && inp !== act) {
        if (inp.type === 'checkbox') inp.checked = !!v;
        else if (inp.type === 'range') { inp.value = v == null ? (c.min || 0) : v; row.querySelector('output').textContent = inp.value + (c.unit || ''); }
        else if (c.k === 'num') inp.value = v == null ? '' : String(c.scale ? +(v * c.scale).toPrecision(6) : v);
        else if (c.k === 'col') inp.value = ST.isHex(v) ? v : ST.isHex(typeof c.def === 'function' ? c.def() : c.def) ? (typeof c.def === 'function' ? c.def() : c.def) : '#888888';
        else if (c.k === 'sel') { inp.value = v == null ? '' : String(v); if (inp.value !== (v == null ? '' : String(v)) && c.num && v != null) { let best = null; [...inp.options].forEach(o => { if (o.value !== '' && (best == null || Math.abs(+o.value - v) < Math.abs(+best - v))) best = o.value; }); if (best != null) inp.value = best; } }
        else inp.value = v == null ? '' : v;
      } else if (inp && inp.type === 'range') row.querySelector('output').textContent = inp.value + (c.unit || '');
      if (c.k === 'col') { const b = row.querySelector('[data-auto]'); b.hidden = !ST.isHex(readC(c)) || !!c.noAuto; }
    }
    function syncAll() { pane.querySelectorAll('.row').forEach(syncCtl); }
    // structural change: the controls that exist may be different now
    function structural() {
      syncUndo(); fillElementList();
      if (ED.tab === 'series' || ED.tab === 'format' || ED.tab === 'add' || ED.tab === 'axes' || ED.tab === 'export' || ED.tab === 'design') buildPane(); else syncAll();
      render(); syncHead();
    }
    // writing a control back to the spec
    function onCtl(e) {
      const el = e.target.closest('[data-path]'), selEl = e.target.closest('[data-fmtsel]');
      if (selEl) { if (e.type !== 'change') return; const code = selEl.value; const path = selEl.dataset.fmtsel; if (code === '__custom') { selEl.closest('.fwrap').querySelector('input').focus(); return; } change(d => wr(d, path, code || null)); return; }
      if (!el || !pane.contains(el)) return;
      const row = el.closest('.row'), c = metas.get(row) || {};
      if (el.tagName === 'BUTTON') {
        if (e.type !== 'click') return;
        const bv = el.dataset.v === '' ? null : (c.num ? +el.dataset.v : el.dataset.v);
        // a setting that is not part of the chart (like the color vision preview) does not belong in the undo history
        if (/^__/.test(el.dataset.path)) { putC(c, ED.spec, bv, el.dataset.path); if (c.after) c.after(bv); syncAll(); return; }
        change(d => putC(c, d, bv, el.dataset.path)); if (c.after) c.after(bv); return;
      }
      const live = e.type === 'input' && (el.type === 'range' || el.type === 'color' || el.type === 'text' || el.tagName === 'TEXTAREA' || c.k === 'num');
      const v = readCtl(el); if (v === undefined) return;
      if (live) { if (ED.before == null) ED.before = snap(); putC(c, ED.spec, c.live && v === '' ? null : v, el.dataset.path); if (c.k === 'rng') row.querySelector('output').textContent = el.value + (c.unit || ''); if (c.after) c.after(v); renderSoon(); relive(c); return; }
      if (e.type === 'change') {
        const before = ED.before != null ? ED.before : snap(); ED.before = null;
        putC(c, ED.spec, v, el.dataset.path); if (c.after) c.after(v); pushHist(before);
        if (c.rebuild) structural(); else { fillElementListSoon(); syncAll(); render(); syncUndo(); }
      }
    }
    const relive = c => { if (c && c.rebuild === 'live') structural(); };
    let efl = 0; const fillElementListSoon = () => { if (efl) return; efl = setTimeout(() => { efl = 0; fillElementList(); }, 60); };
    function onClick(e) {
      const a = e.target.closest('[data-auto]');
      if (a && pane.contains(a)) { const c = metas.get(a.closest('.row')); change(d => (c ? putC(c, d, null, a.dataset.auto) : wr(d, a.dataset.auto, null))); return; }
      const b = e.target.closest('[data-act]');
      if (b && pane.contains(b)) { const c = metas.get(b.closest('.row')); if (!c) return; if (c.k === 'btn') c.act(); else if (c.k === 'btns') c.list[+b.dataset.act].act(); return; }
      if (e.target.closest('button[data-path]')) onCtl(e);
    }
    pane.addEventListener('input', onCtl); pane.addEventListener('change', onCtl); pane.addEventListener('click', onClick);

    // ---------- format pieces ----------
    const eff = (path, d) => () => { const v = getp(ED.spec, path); return v != null ? v : typeof d === 'function' ? d() : d; };
    function fillCtls(key, o = {}) {
      const p = f => P('fm', key, 'fill', f), t = () => getp(ED.spec, p('t')) || o.autoKind || 'solid';
      const colorPath = o.colorPath || p('c');
      return [
        K.sel(o.label || 'Fill', p('t'), { opts: o.noAuto ? [['none', 'No fill'], ['solid', 'Solid'], ['grad', 'Gradient'], ['pat', 'Pattern']] : [['', 'Automatic'], ['none', 'No fill'], ['solid', 'Solid'], ['grad', 'Gradient'], ['pat', 'Pattern']], auto: true, rebuild: true }),
        K.col('Color', colorPath, { def: o.def, when: () => t() !== 'none' }),
        K.col('Second color', p('c2'), { def: () => ST.mix(getp(ED.spec, colorPath) || (typeof o.def === 'function' ? o.def() : o.def) || '#888888', '#ffffff', 0.55), when: () => getp(ED.spec, p('t')) === 'grad' }),
        K.rng('Angle', p('ang'), { min: 0, max: 360, step: 15, unit: '°', when: () => getp(ED.spec, p('t')) === 'grad' && getp(ED.spec, p('k')) !== 'radial' }),
        K.seg('Shape', p('k'), { opts: [['', 'Linear'], ['radial', 'Radial']], when: () => getp(ED.spec, p('t')) === 'grad' }),
        K.sel('Pattern', p('pat'), { opts: Object.entries(ST.PATTERNS), when: () => getp(ED.spec, p('t')) === 'pat' }),
        K.col('Pattern color', p('pc'), { def: o.def, when: () => getp(ED.spec, p('t')) === 'pat' }),
        K.col('Background', p('pb'), { def: '#ffffff', when: () => getp(ED.spec, p('t')) === 'pat' }),
        K.rng('Transparency', p('tr'), { min: 0, max: 100, unit: '%', when: () => t() !== 'none' }),
        K.rng('End transparency', p('tr2'), { min: 0, max: 100, unit: '%', when: () => getp(ED.spec, p('t')) === 'grad' }),
      ];
    }
    function lineCtls(key, o = {}) {
      const p = f => P('fm', key, 'line', f), t = () => getp(ED.spec, p('t'));
      return [
        K.sel(o.label || 'Outline', p('t'), { opts: [['', 'Automatic'], ['none', 'No line'], ['solid', 'Solid line']], auto: true, rebuild: true }),
        K.col('Color', o.colorPath || p('c'), { def: o.def || (() => out && out.geom.th ? out.geom.th.fg : '#16161A'), when: () => t() !== 'none', noAuto: !!o.colorPath }),
        K.num('Width', p('w'), { unit: 'px', ph: o.wph || 'auto', when: () => t() !== 'none' }),
        K.sel('Dash', p('dash'), { opts: DASHES, auto: true, when: () => t() !== 'none' }),
        K.rng('Transparency', p('tr'), { min: 0, max: 100, unit: '%', when: () => t() !== 'none' }),
      ];
    }
    function effectCtls(key) {
      const p = (g, f) => P('fm', key, g, f), on = g => () => !!getp(ED.spec, p(g, 'on'));
      return [
        K.chk('Shadow', p('shadow', 'on'), { rebuild: true }),
        K.col('Color', p('shadow', 'c'), { def: '#000000', when: on('shadow') }), K.rng('Blur', p('shadow', 'blur'), { min: 0, max: 30, unit: ' px', def: ST.FX.shadow.blur, when: on('shadow') }),
        K.rng('Distance across', p('shadow', 'dx'), { min: -30, max: 30, unit: ' px', def: ST.FX.shadow.dx, when: on('shadow') }), K.rng('Distance down', p('shadow', 'dy'), { min: -30, max: 30, unit: ' px', def: ST.FX.shadow.dy, when: on('shadow') }),
        K.rng('Transparency', p('shadow', 'tr'), { min: 0, max: 100, unit: '%', def: ST.FX.shadow.tr, when: on('shadow') }),
        K.chk('Glow', p('glow', 'on'), { rebuild: true }),
        K.col('Color', p('glow', 'c'), { def: '#FFB020', when: on('glow') }), K.rng('Size', p('glow', 'r'), { min: 1, max: 30, unit: ' px', def: ST.FX.glow.r, when: on('glow') }), K.rng('Transparency', p('glow', 'tr'), { min: 0, max: 100, unit: '%', def: ST.FX.glow.tr, when: on('glow') }),
        K.chk('Soft edges', p('soft', 'on'), { rebuild: true }), K.rng('Radius', p('soft', 'r'), { min: 1, max: 20, unit: ' px', def: ST.FX.soft.r, when: on('soft') }),
      ];
    }
    function textCtls(key, o = {}) {
      const p = f => P('tx', key, f), baseSize = o.size || (() => out && out.geom.tc[key] ? out.geom.tc[key].size : 12), baseCol = () => (out && out.geom.tc[key] && out.geom.tc[key].c) || '#16161A';
      return [
        K.sel('Font', p('font'), { opts: [['', 'Same as chart']].concat(Object.entries(RM.FONT_NAMES)), auto: true }),
        K.txt('Other font', p('font'), { ph: 'Any installed font, for example Inter', list: 'edFonts', live: true, when: () => !RM.FONT_NAMES[getp(ED.spec, p('font'))] }),
        K.num('Size', p('size'), { unit: 'px', ph: String(typeof baseSize === 'function' ? baseSize() : baseSize) }),
        K.sel('Weight', p('wt'), { opts: WEIGHTS, num: true }),
        K.chk('Italic', p('it')),
        K.col('Color', p('c'), { def: baseCol }),
        K.seg('Align', p('al'), { opts: [['', 'Auto'], ['start', 'Left'], ['middle', 'Center'], ['end', 'Right']], when: () => o.align !== false }),
        K.num('Letter spacing', p('ls'), { unit: 'px', ph: '0' }),
        K.num('Line height', p('lh'), { ph: '1.28', when: () => !!o.lh }),
        o.rot ? K.num('Rotation', p('rot'), { unit: '°', ph: 'auto' }) : null,
      ];
    }
    const seriesColorPath = i => P('series', 'colors', i);
    const colorOfSeries = i => () => { const g = out && out.geom.colors.find(c => c.key === 's' + i); return g ? g.color : '#1F4FD8'; };
    const colorOfSlice = k => () => { const g = out && out.geom.colors.find(c => c.key === 'sl' + k); return g ? g.color : '#1F4FD8'; };
    const kindOfSeries = i => { const g = out && out.geom.colors.find(c => c.key === 's' + i); return g ? g.kind : 'bar'; };

    function dlCtls(path, o = {}) {
      const p = f => P(path, f), bars = barType() || o.bars, posOpts = stackType() ? [['auto', 'Center'], ['center', 'Center'], ['inEnd', 'Inside end'], ['inBase', 'Inside base']] : barType() ? [['auto', 'Outside end'], ['outEnd', 'Outside end'], ['inEnd', 'Inside end'], ['center', 'Center'], ['inBase', 'Inside base']] : [['auto', 'Above'], ['above', 'Above'], ['below', 'Below'], ['left', 'Left'], ['right', 'Right'], ['center', 'Center']];
      return [
        K.chk('Show data labels', p('on'), { rebuild: true }),
        !isPieType() ? K.sel('Position', p('pos'), { opts: posOpts, when: () => !!getp(ED.spec, p('on')) }) : null,
        K.chk('Value', p('val'), { def: true, when: () => !!getp(ED.spec, p('on')) }),
        isPieType() ? null : K.chk('Category name', p('cat'), { when: () => !!getp(ED.spec, p('on')) }),
        isPieType() ? K.chk('Category name', p('cat'), { when: () => !!getp(ED.spec, p('on')) }) : null,
        K.chk('Series name', p('ser'), { when: () => !!getp(ED.spec, p('on')) }),
        K.fmt('Number format', p('fmt'), { when: () => !!getp(ED.spec, p('on')) }),
        K.txt('Separator', p('sep'), { max: 6, ph: ', ', when: () => !!getp(ED.spec, p('on')) }),
      ].filter(Boolean).concat(bars ? [] : []);
    }

    // ---------- panes ----------
    const PANE_BUILDERS = {
      design: () => designPane(), series: () => seriesPane(), axes: () => axesPane(), text: () => textPane(), format: () => formatPane(), add: () => addPane(), layout: () => layoutPane(), export: () => exportPane(),
    };
    function buildPane() {
      const keepOpen = {}; pane.querySelectorAll('details.grp').forEach(d => { keepOpen[ED.tab + '|' + d.dataset.g] = d.open; });
      whens.clear(); metas.clear();
      const host = document.createElement('div'); host.className = 'pbody'; host.dataset.pane = ED.tab;
      const groups = PANE_BUILDERS[ED.tab]();
      groups.forEach(g => { if (!g) return; const k = ED.tab + '|' + g.dataset.g; if (k in ED.open) g.open = ED.open[k]; if (k in keepOpen) g.open = keepOpen[k]; host.appendChild(g); });
      pane.replaceChildren(host); syncAll();
      pane.scrollTop = pane.scrollTop;
    }
    ED.open = {};
    pane.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.grp')) ED.open[ED.tab + '|' + d.dataset.g] = d.open; }, true);

    // Design: chart type, looks, layouts, colors, saved themes
    const TYPE_ICONS = {
      line: 'M3 20L12 10l8 6 9-12', step: 'M3 20h7v-8h7v-6h10', area: 'M3 22l9-12 8 6 9-12v18z', stackedArea: 'M3 22l9-8 8 3 9-8v13z M3 14l9-6 8 2 9-6', stackedArea100: 'M3 6h26v16H3z M3 14l9-4 8 3 9-5',
      bar: 'M5 22V12h5v10zM13 22V6h5v16zM21 22V14h5v8z', stacked: 'M5 22V13h6v9zM5 13V8h6v5zM15 22V10h6v12zM15 10V5h6v5z', stacked100: 'M5 22V8h8v14zM15 22V8h8v14z M5 15h8 M15 12h8', hbar: 'M4 6h14v5H4zM4 13h22v5H4z', hstacked: 'M4 5h10v6H4zM14 5h8v6h-8zM4 14h14v6H4zM18 14h8v6h-8z', hstacked100: 'M4 5h26v6H4zM4 14h26v6H4z M16 5v6 M12 14v6',
      combo: 'M5 22V12h5v10zM13 22V8h5v14zM21 22V15h5v7z M3 8l9 4 8-6 8 5', lollipop: 'M7 22V10M16 22V6M25 22V13 M7 10m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M16 6m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0 M25 13m-2.2 0a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0',
      scatter: 'M6 19m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M12 11m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M18 16m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M24 7m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0 M27 15m-1.8 0a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0',
      pie: 'M16 3a10 10 0 1 0 10 10H16z M19 1a10 10 0 0 1 8 8h-8z', donut: 'M16 3a10 10 0 1 0 10 10A10 10 0 0 0 16 3z M16 8a5 5 0 1 1-5 5a5 5 0 0 1 5-5z',
    };
    const typeAvail = t => { const T = ctx.getTable(); if (!T) return true; if (t === 'scatter' && !numX()) return false; if (['stacked', 'stacked100', 'hstacked', 'hstacked100', 'stackedArea', 'stackedArea100'].includes(t) && T.cols.length < 2) return true; return true; };
    function designPane() {
      const G = [];
      const gt = document.createElement('div'); gt.className = 'types'; gt.setAttribute('role', 'group'); gt.setAttribute('aria-label', 'Chart type');
      gt.innerHTML = RM.TYPES.map(t => `<button type="button" class="tbtn" data-type="${t}" aria-pressed="${ED.spec.type === t}" title="${esc(RM.TYPE_NAMES[t])}"><svg viewBox="0 0 32 26" fill="${/^(area|stackedArea|pie|donut)/.test(t) ? 'currentColor' : 'none'}" fill-opacity="${/^(area|stackedArea|pie|donut)/.test(t) ? '.25' : '0'}" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="${TYPE_ICONS[t]}"/></svg><span>${esc(RM.TYPE_NAMES[t])}</span></button>`).join('');
      const g1 = group('Chart type', []); g1.querySelector('.gb').appendChild(gt); G.push(g1);
      G.push(group('Looks', [{ k: 'btns', list: [{ label: 'Browse looks', act: () => togglePop('styles') }, { label: 'Quick layouts', act: () => togglePop('layouts') }] }, K.note('A look changes how the chart is drawn and keeps what it says. A layout moves the legend, labels and gridlines.')]));
      G.push(group('Colors', [
        K.seg('Background', 'theme', { opts: [['light', 'Light'], ['dark', 'Dark'], ['print', 'Paper']] }),
        K.sel('Palette', 'palette', { opts: Object.entries(RM.PALETTES).map(([k, p]) => [k, p.name]), after: () => { change(d => { d.series.colors = {}; d.slices.colors = {}; }); } }),
        { k: 'btn', label: 'Reset series colors to the palette', act: () => change(d => { d.series.colors = {}; d.slices.colors = {}; }) },
      ]));
      const themes = loadThemes(), tg = group('Saved themes', [
        K.txt('Name', '__themeName', { max: 40, ph: 'My theme' }),
        K.btns([{ label: 'Save this look', act: saveTheme }, { label: 'Use as the default for new charts', act: setDefaultTheme }, { label: 'Clear default', act: clearDefaultTheme }]),
      ]);
      const list = document.createElement('div'); list.className = 'thlist';
      list.innerHTML = themes.length ? themes.map(t => `<div class="throw" data-id="${t.id}"><span>${esc(t.name)}</span><button class="chip tiny" type="button" data-th="apply">Apply</button><button class="chip tiny" type="button" data-th="export">Export</button><button class="chip tiny" type="button" data-th="delete" aria-label="Delete ${esc(t.name)}">Delete</button></div>`).join('') : '<p class="hint">Nothing saved yet. A theme keeps the palette, fonts, colors, gridlines, bars, lines and legend, but not your text or data.</p>';
      tg.querySelector('.gb').appendChild(list);
      const imp = document.createElement('div'); imp.className = 'btnrow'; imp.innerHTML = '<button class="chip" type="button" data-th="import">Import a theme file</button>'; tg.querySelector('.gb').appendChild(imp);
      G.push(tg);
      return G;
    }
    // looks and layouts as a gallery of small live drawings
    function togglePop(kind) { ED.pop = ED.pop === kind ? '' : kind; drawPop(); }
    const thumbCache = new Map();
    function thumbFor(set, mode) {
      const T = chartTable(); if (!T) return '';
      const base = clone(ED.spec); if (mode === 'style') applyLookTo(base, set, false); else mergeInto(base, set);
      base.width = 360; base.aspect = 1.55; base.title = base.title ? base.title : ''; base.fontSize = Math.max(base.fontSize, 14);
      base.fm = base.fm || {}; return RM.render(T, Object.assign({}, specOpts(), base, { width: 360, aspect: 1.55, euro: S.euro })).svg;
    }
    function drawPop() {
      const el = $('edPop'); if (!ED.pop || !table) { el.hidden = true; el.innerHTML = ''; return; }
      const items = ED.pop === 'styles' ? PR.STYLES : PR.LAYOUTS.filter(l => !!l.pie === isPieType() || !l.pie && true).filter(l => !l.pie || isPieType());
      el.hidden = false;
      el.innerHTML = `<div class="popt"><span class="k">${ED.pop === 'styles' ? 'Looks' : 'Quick layouts'}</span><button class="chip tiny" type="button" data-pop="close">Close</button></div><div class="thumbs">` + items.map(it => `<button type="button" class="thumb" data-${ED.pop === 'styles' ? 'style' : 'layout'}="${it.id}" aria-label="${esc(it.name)}"><span class="tsvg">${thumbFor(it.set, ED.pop === 'styles' ? 'style' : 'layout')}</span><span class="tname">${esc(it.name)}</span></button>`).join('') + '</div>';
    }
    let thumbT = 0; function drawThumbsSoon() { if (!ED.pop) return; clearTimeout(thumbT); thumbT = setTimeout(drawPop, 200); }
    $('edPop').addEventListener('click', e => {
      if (e.target.closest('[data-pop="close"]')) { ED.pop = ''; drawPop(); return; }
      const s = e.target.closest('[data-style]'), l = e.target.closest('[data-layout]');
      if (s) { const st = PR.STYLES.find(x => x.id === s.dataset.style); change(d => applyLookTo(d, st.set, false)); toast(`Look: ${st.name}.`); }
      if (l) { const ly = PR.LAYOUTS.find(x => x.id === l.dataset.layout); change(d => mergeInto(d, ly.set)); toast(`Layout: ${ly.name}.`); }
    });
    const toast = m => ctx.toast(m);
    function mergeInto(d, set) { Object.keys(set).forEach(k => { const v = set[k]; if (v && typeof v === 'object' && !Array.isArray(v)) d[k] = ST.merge(d[k] || {}, v); else d[k] = clone(v); }); }
    // a look replaces the look keys, so applying two in a row does not stack them
    function applyLookTo(d, set, keepData) {
      PR.RESET_KEYS.forEach(k => {
        if (k === 'fm') { Object.keys(d.fm || {}).forEach(q => { if (!/^(s\d|sl\d|ref:|ann:)/.test(q)) delete d.fm[q]; }); }
        else if (k === 'tx') { Object.keys(d.tx || {}).forEach(q => { if (!/^(ann:|ref:)/.test(q)) delete d.tx[q]; }); }
        else d[k] = clone(RM.DEFAULTS[k]);
      });
      d.ax = d.ax || { x: {}, y: {}, y2: {} };
      ['x', 'y', 'y2'].forEach(a => { PR.AX_LOOK.forEach(q => { if (d.ax[a]) delete d.ax[a][q]; }); });
      if (set) mergeInto(d, set);
      void keepData;
    }

    // saved themes live in the browser, and can be exported and imported as files
    function loadThemes() { try { const t = JSON.parse(localStorage.getItem('unchart-themes') || '[]'); return Array.isArray(t) ? t : []; } catch (e) { return []; } }
    function storeThemes(t) { try { localStorage.setItem('unchart-themes', JSON.stringify(t)); } catch (e) { toast('This browser will not keep saved themes. Use Export to keep one as a file.'); } }
    function lookOf(spec) {
      const o = {}; PR.LOOK_KEYS.forEach(k => { if (spec[k] !== undefined) o[k] = clone(spec[k]); });
      if (o.fm) Object.keys(o.fm).forEach(q => { if (/^(s\d|sl\d|ref:|ann:)/.test(q)) delete o.fm[q]; });
      if (o.tx) Object.keys(o.tx).forEach(q => { if (/^(ann:|ref:)/.test(q)) delete o.tx[q]; });
      const ax = {}; ['x', 'y', 'y2'].forEach(a => { const s = (spec.ax || {})[a] || {}; ax[a] = {}; PR.AX_LOOK.forEach(q => { if (s[q] !== undefined) ax[a][q] = s[q]; }); }); o.ax = ax;
      return o;
    }
    function saveTheme() {
      const name = String(ED.tmp.themeName || '').trim() || 'Theme ' + (loadThemes().length + 1), t = loadThemes(); ED.tmp.themeName = '';
      t.push({ id: uid(), name, set: lookOf(ED.spec) }); storeThemes(t); toast(`Saved the theme ${name}.`); buildPane();
    }
    function setDefaultTheme() { try { localStorage.setItem('unchart-theme-default', JSON.stringify({ name: 'Default', set: lookOf(ED.spec) })); toast('New charts will start with this look.'); } catch (e) { toast('This browser will not keep it.'); } }
    function clearDefaultTheme() { try { localStorage.removeItem('unchart-theme-default'); } catch (e) { /* nothing stored */ } toast('New charts start from the plain look again.'); }
    pane.addEventListener('click', e => {
      const t = e.target.closest('[data-th]'); if (!t) return; const row = t.closest('.throw'), id = row && row.dataset.id, themes = loadThemes(), th = themes.find(x => x.id === id);
      if (t.dataset.th === 'apply' && th) { change(d => { applyLookTo(d, th.set, false); mergeInto(d, { ax: th.set.ax || {} }); }); toast(`Applied ${th.name}.`); }
      if (t.dataset.th === 'delete') { storeThemes(themes.filter(x => x.id !== id)); buildPane(); }
      if (t.dataset.th === 'export' && th) ctx.download(JSON.stringify({ unchartTheme: 1, name: th.name, set: th.set }, null, 1), 'application/json', 'unchart-theme-' + th.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json');
      if (t.dataset.th === 'import') pickFile('.json,application/json').then(async f => { try { const j = JSON.parse(await f.text()); if (!j.unchartTheme || !j.set) throw 0; const all = loadThemes(); all.push({ id: uid(), name: String(j.name || 'Imported').slice(0, 40), set: j.set }); storeThemes(all); buildPane(); toast('Theme imported.'); } catch (er) { toast('That file is not an Unchart theme.'); } });
    });
    const pickFile = accept => new Promise(res => { const i = document.createElement('input'); i.type = 'file'; i.accept = accept; i.onchange = () => i.files[0] && res(i.files[0]); i.click(); });

    // Series: the list, then the options that belong to bars, lines, pies and labels
    function seriesPane() {
      const T = ctx.getTable(), e = ED.spec, G = [], pie = isPieType();
      if (!T) return [group('Series', [K.note('Open a chart first.')])];
      const key = pie ? 'slices' : 'series', o = e[key] = e[key] || {}, n = pie ? T.rows.length : T.cols.length;
      const order = Array.isArray(o.order) && o.order.length === n ? o.order : Array.from({ length: n }, (_, i) => i);
      const pal = out ? out.geom.colors : [];
      const list = document.createElement('div'); list.className = 'serlist'; list.id = 'rSer';
      list.innerHTML = order.map((i, pos) => { const nm = (o.names || {})[i] != null ? o.names[i] : pie ? String(T.rows[i].x) : T.cols[i].name, g = pal.find(c => c.key === (pie ? 'sl' : 's') + i), col = (o.colors || {})[i] || (g ? g.color : '#1F4FD8');
        return `<div class="serrow" data-i="${i}"><input type="color" value="${col}" aria-label="Color for ${esc(nm)}" data-k="color"><input type="text" value="${esc(nm)}" aria-label="Name" data-k="name"><button type="button" data-k="fmt" title="Format this ${pie ? 'slice' : 'series'}" aria-label="Format ${esc(nm)}">Format</button><input type="checkbox" ${(o.hidden || []).includes(i) ? '' : 'checked'} aria-label="Show ${esc(nm)}" data-k="show"><button type="button" data-k="up" aria-label="Move up" ${pos ? '' : 'disabled'}>↑</button><button type="button" data-k="down" aria-label="Move down" ${pos < n - 1 ? '' : 'disabled'}>↓</button></div>`; }).join('');
      const g0 = group(pie ? 'Slices' : 'Series', [K.note(pie ? 'Click a slice in the picture to format it.' : 'Click a series in the picture, or press Format, to open its fill, line, markers and effects.')]); g0.querySelector('.gb').appendChild(list); G.push(g0);
      if (!pie && barType()) G.push(group('Bars', [K.rng('Gap between bars', 'bar/gap', { min: 0, max: 300, unit: '%' }), K.rng('Overlap', 'bar/overlap', { min: -100, max: 100, unit: '%', when: () => !stackType() && nSeries() > 1 }),
        K.rng('Rounded corners', 'bar/rad', { min: 0, max: 40, unit: ' px', when: () => ED.spec.type !== 'lollipop' }), K.chk('Different color for each bar', 'bar/vary', { when: () => nSeries() === 1 }), K.col('Negative bars', 'bar/neg', { def: '#D61F69' })]));
      if (!pie && !barType() || ED.spec.type === 'combo') G.push(group('Lines and markers', [K.num('Line width', 'ln/w', { unit: 'px', ph: 'auto' }), K.sel('Dash', 'ln/dash', { opts: DASHES.slice(1) }), K.chk('Smooth the lines', 'ln/smooth', { tip: 'A curve that never overshoots the points', when: () => !['step', 'scatter'].includes(ED.spec.type) }),
        K.sel('Markers', 'ln/mk', { opts: [['auto', 'Automatic'], ['on', 'Always'], ['off', 'None']], when: () => ED.spec.type !== 'scatter' }), K.sel('Marker shape', 'ln/shape', { opts: Object.entries(ST.MARKERS).filter(m => m[0] !== 'none') }), K.num('Marker size', 'ln/size', { unit: 'px', ph: 'auto' })]));
      if (['area'].includes(ED.spec.type)) G.push(group('Areas', [K.rng('Fill transparency', 'ar/tr', { min: 0, max: 100, unit: '%' })]));
      if (pie) G.push(group('Pie', [K.rng('Start angle', 'pie/start', { min: 0, max: 359, unit: '°' }), K.rng('Hole size', 'pie/hole', { min: 15, max: 90, unit: '%', when: () => ED.spec.type === 'donut' }), K.rng('Pull slices out', 'pie/ex', { min: 0, max: 40, unit: '%' }),
        K.sel('Labels', 'pie/lab', { opts: [['inside', 'Inside'], ['outside', 'Outside with leader lines'], ['best', 'Best fit']] }), K.chk('Leader lines', 'pie/leader', { def: true, when: () => ED.spec.pie && ED.spec.pie.lab !== 'inside' }),
        K.txt('Center text', 'pie/center', { max: 40, ph: 'For example Total', when: () => ED.spec.type === 'donut' }), K.num('Center text size', 'pie/cs', { unit: 'px', ph: 'auto', when: () => ED.spec.type === 'donut' })]));
      G.push(group('Data labels', dlCtls('dl'), false));
      if (!pie) G.push(group('Error bars', [K.chk('Show the reading error (±)', 'eb/on', { rebuild: true, tip: 'The 95% error bar Unchart works out for every number it reads' }), K.num('Width', 'eb/w', { unit: 'px', ph: '1.4', when: () => !!(ED.spec.eb && ED.spec.eb.on) }), K.num('Cap size', 'eb/cap', { unit: 'px', ph: '4', when: () => !!(ED.spec.eb && ED.spec.eb.on) }), K.col('Color', 'eb/c', { def: '#16161A', when: () => !!(ED.spec.eb && ED.spec.eb.on) })], false));
      if (!pie) G.push(group('Analysis', [K.sel('Projection', 'trend', { opts: [['off', 'Off'], ['linear', 'Straight line'], ['growth', 'Steady growth']], when: () => numX() && ['line', 'area', 'scatter', 'step'].includes(ED.spec.type) }),
        K.chk('Index to 100', 'index', { when: () => nSeries() > 1 && !S.table.pie, tip: 'Divide each series by its first value' }),
        K.sel('Focus on a series', 'focus/s', { opts: [['', 'Show all equally']].concat(T.cols.map((c, i) => [String(i), c.name])), after: v => { ED.spec.focus.s = v === '' || v == null ? null : +v; } }), K.rng('Dim the others by', 'focus/dim', { min: 10, max: 95, unit: '%', when: () => ED.spec.focus && ED.spec.focus.s != null && ED.spec.focus.s !== '' }),
        K.chk('Second value axis for the series the original put on the right', 'dual', { def: true, when: () => T.cols.some(c => c.axis === 'right') })], false));
      return G;
    }
    pane.addEventListener('change', e => seriesRowEvent(e));
    pane.addEventListener('input', e => seriesRowEvent(e));
    pane.addEventListener('click', e => { if (e.target.closest('.serrow button')) seriesRowEvent(e); });
    function seriesRowEvent(e) {
      const row = e.target.closest('.serrow'); if (!row) return; const i = +row.dataset.i, k = e.target.dataset.k, pie = isPieType();
      if (e.type === 'click') {
        if (k === 'fmt') { select((pie ? 'sl' : 's') + i); setTab('format'); return; }
        if (k !== 'up' && k !== 'down') return;
        change(d => { const o = d[pie ? 'slices' : 'series'], n = pie ? ctx.getTable().rows.length : ctx.getTable().cols.length, ord = Array.isArray(o.order) && o.order.length === n ? o.order.slice() : Array.from({ length: n }, (_, j) => j), p = ord.indexOf(i), q = k === 'up' ? p - 1 : p + 1; if (q >= 0 && q < n) { [ord[p], ord[q]] = [ord[q], ord[p]]; o.order = ord; } });
        const again = pane.querySelector(`.serrow[data-i="${i}"] [data-k="${k}"]`); if (again && !again.disabled) again.focus(); return;
      }
      if (k !== 'color' && k !== 'name' && k !== 'show') return;
      const o = ED.spec[pie ? 'slices' : 'series'];
      if (e.type === 'input' && k !== 'show') { if (ED.before == null) ED.before = snap(); if (k === 'color') (o.colors = o.colors || {})[i] = e.target.value; else (o.names = o.names || {})[i] = e.target.value; renderSoon(); return; }
      if (e.type === 'change') { const before = ED.before != null ? ED.before : snap(); ED.before = null;
        if (k === 'color') (o.colors = o.colors || {})[i] = e.target.value; if (k === 'name') (o.names = o.names || {})[i] = e.target.value;
        if (k === 'show') { const h = new Set(o.hidden || []); e.target.checked ? h.delete(i) : h.add(i); o.hidden = [...h]; }
        pushHist(before); fillElementList(); render(); syncUndo(); }
    }

    // Axes: value axis, category axis, right axis
    function axesPane() {
      const G = [], T = ctx.getTable(); if (!T) return [group('Axes', [K.note('Open a chart first.')])];
      if (isPieType()) return [group('Axes', [K.note('A pie has no axes. Switch the type to bars or lines to set them.')])];
      const hz = horizType(), real = ED.spec.type;
      G.push(group(hz ? 'Value axis (across)' : 'Value axis (up)', axisYCtls()));
      G.push(group(hz ? 'Category axis (down)' : 'Category axis (across)', axisXCtls(), false));
      if (T.cols.some(c => c.axis === 'right') && ED.spec.dual !== false) G.push(group('Right axis', [K.num('Minimum', 'ax/y2/min', {}), K.num('Maximum', 'ax/y2/max', {}), K.num('Major unit', 'ax/y2/major', {}), K.fmt('Number format', 'ax/y2/fmt', {}), K.sel('Tick marks', 'ax/y2/ticks', { opts: TICKS }), K.txt('Title', 'y2Label', { max: 80 })], false));
      void real;
      G.push(group('Gridlines', [K.chk('Major gridlines (value axis)', 'ax/y/grid', { def: () => ED.spec.grid === 'value' || ED.spec.grid === 'both' }), K.chk('Minor gridlines (value axis)', 'ax/y/mgrid'), K.chk('Major gridlines (category axis)', 'ax/x/grid', { def: () => ED.spec.grid === 'both' }), K.chk('Minor gridlines (category axis)', 'ax/x/mgrid'),
        K.btns([{ label: 'Format gridlines', act: () => { select('grid'); setTab('format'); } }, { label: 'Format minor gridlines', act: () => { select('gridM'); setTab('format'); } }])], false));
      return G;
    }
    function axisYCtls() {
      const log = () => ['line', 'step', 'scatter'].includes(ED.spec.type);
      return [
        K.chk('Show the axis', 'ax/y/show', { def: true }),
        K.num('Minimum', 'ax/y/min', { after: v => { ED.spec.yMin = v; } }), K.num('Maximum', 'ax/y/max', { after: v => { ED.spec.yMax = v; } }),
        K.num('Major unit', 'ax/y/major'), K.num('Minor unit', 'ax/y/minor'),
        K.chk('Start at zero', 'zero', { when: () => !ED.spec.log }),
        K.chk('Logarithmic scale', 'log', { when: log, after: v => { setp(ED.spec, 'ax/y/log', v ? true : null); } }), K.seg('Log base', 'ax/y/base', { opts: [['10', '10'], ['2', '2']], num: true, when: () => log() && !!ED.spec.log }),
        K.chk('Values in reverse order', 'ax/y/rev'),
        K.sel('Display units', 'ax/y/units', { opts: ST.UNITS.map(([n, v]) => [String(v), n]), num: true }), K.chk('Show the unit on the axis', 'ax/y/unitLab', { when: () => (ED.spec.ax.y.units || 1) !== 1 }),
        K.fmt('Number format', 'ax/y/fmt'),
        K.sel('Horizontal axis crosses at', 'ax/y/crossMode', { opts: [['auto', 'Automatic (zero)'], ['value', 'A value']], rebuild: true, after: v => { if (v !== 'value') setp(ED.spec, 'ax/y/cross', 'auto'); else if (typeof ED.spec.ax.y.cross !== 'number') setp(ED.spec, 'ax/y/cross', 0); }, def: () => typeof ED.spec.ax.y.cross === 'number' ? 'value' : 'auto' }),
        K.num('Crossing value', 'ax/y/cross', { when: () => typeof ED.spec.ax.y.cross === 'number' }),
        K.sel('Tick marks', 'ax/y/ticks', { opts: TICKS }), K.sel('Minor tick marks', 'ax/y/mticks', { opts: TICKS }),
        K.sel('Labels', 'ax/y/lab', { opts: [['next', 'Next to the axis'], ['none', 'None']] }),
        K.seg('Axis position', 'ax/y/side', { opts: [['left', 'Left'], ['right', 'Right']], when: () => !horizType() }),
        K.txt('Axis title', horizType() ? 'xLabel' : 'yLabel', { max: 80, ph: 'No title' }),
        K.btns([{ label: 'Format axis line', act: () => { select('axisY'); setTab('format'); } }, { label: 'Format labels', act: () => { select('yTick'); setTab('format'); } }]),
      ];
    }
    function axisXCtls() {
      const numeric = () => numX() && !barType();
      return [
        K.chk('Show the axis', 'ax/x/show', { def: true }),
        K.fmt('Label format', 'ax/x/fmt', { date: dateX(), when: () => numX() }),
        K.num('Minimum', 'ax/x/min', { when: numeric }), K.num('Maximum', 'ax/x/max', { when: numeric }), K.num('Major unit', 'ax/x/major', { when: () => numeric() && !dateX() }),
        K.chk('Categories in reverse order', 'ax/x/rev', { when: () => !numeric() }),
        K.sel('Label angle', 'ax/x/rot', { opts: [['auto', 'Automatic'], ['0', 'Flat'], ['-45', 'Slanted up'], ['45', 'Slanted down'], ['-90', 'Vertical up'], ['90', 'Vertical down']], when: () => !horizType() && !numeric() }),
        K.num('Show every nth label', 'ax/x/every', { ph: 'auto', when: () => !numeric() }),
        K.sel('Label position', 'ax/x/lab', { opts: [['low', 'At the edge of the plot'], ['next', 'Next to the axis line'], ['high', 'At the top']], when: () => !horizType() }),
        K.sel('Tick marks', 'ax/x/ticks', { opts: TICKS }), K.sel('Minor tick marks', 'ax/x/mticks', { opts: TICKS, when: () => false }),
        K.sel('Ticks sit', 'ax/x/between', { opts: [['auto', 'Automatic'], ['between', 'Between categories'], ['on', 'On categories']], when: () => !numeric() && !horizType() }),
        K.txt('Axis title', horizType() ? 'yLabel' : 'xLabel', { max: 80, ph: 'No title' }),
        K.btns([{ label: 'Format axis line', act: () => { select('axisX'); setTab('format'); } }, { label: 'Format labels', act: () => { select('xTick'); setTab('format'); } }]),
      ];
    }

    // Text: fonts, and the words of the chart
    function textPane() {
      const G = [];
      const fam = [
        K.sel('Font', 'font', { opts: Object.entries(RM.FONT_NAMES), when: () => !ED.spec.fontCustom }),
        K.txt('Any font on this computer', 'fontCustom', { ph: 'For example Inter or Garamond', list: 'edFonts', live: true, max: 60 }),
        K.num('Base size', 'fontSize', { unit: 'px', ph: '14' }),
        { k: 'btns', list: [{ label: 'Add a font file', act: addFont, tip: 'TTF, OTF or WOFF. It is embedded in SVG and PNG exports.' }, { label: 'Clear custom font', act: () => change(d => { d.fontCustom = ''; }) }] },
      ];
      if (ED.fonts.length) fam.push(K.note('Added fonts: ' + ED.fonts.map(f => f.family).join(', ') + '. They stay for this visit, so add them again next time.'));
      G.push(group('Font', fam));
      G.push(group('Words', [K.area('Title', 'title', { rows: 2, max: 140 }), K.area('Subtitle', 'subtitle', { rows: 2, max: 200 }), K.area('Source note', 'note', { rows: 2, max: 240 }),
        K.txt('Horizontal axis title', horizType() ? 'yLabel' : 'xLabel', { max: 80 }), K.txt('Vertical axis title', horizType() ? 'xLabel' : 'yLabel', { max: 80 }),
        K.txt('Right axis title', 'y2Label', { max: 80, when: () => ctx.getTable() && ctx.getTable().cols.some(c => c.axis === 'right') && ED.spec.dual !== false })]));
      const rows = TEXT_KEYS.filter(k => k !== 'pieCenter' || ED.spec.type === 'donut').map(k => `<div class="throw"><span>${esc(ELEMENT_NAMES[k])}</span><button class="chip tiny" type="button" data-fmtkey="${k}">Format</button></div>`).join('');
      const g = group('Text styles', [K.note('Every kind of text has its own font, size, weight, color and alignment.')]); const l = document.createElement('div'); l.className = 'thlist'; l.innerHTML = rows; g.querySelector('.gb').appendChild(l); G.push(g);
      return G;
    }
    pane.addEventListener('click', e => { const b = e.target.closest('[data-fmtkey]'); if (b) { select(b.dataset.fmtkey); setTab('format'); } });
    async function addFont() {
      const f = await pickFile('.ttf,.otf,.woff,.woff2,font/*'); if (!f) return;
      if (f.size > 4e6) { toast('That font file is large. Fonts over 4 MB are not embedded.'); return; }
      const src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      const family = f.name.replace(/\.[^.]+$/, '').replace(/[^\w \-]+/g, ' ').trim() || 'Added font';
      try { const ff = new FontFace(family, `url(${src})`); await ff.load(); document.fonts.add(ff); } catch (e) { toast('The browser could not read that font file.'); return; }
      ED.fonts = ED.fonts.filter(x => x.family !== family).concat([{ family, src }]); change(d => { d.fontCustom = family; }); toast(`Using ${family}.`);
    }

    // Format: the pane for whatever is selected
    function formatPane() {
      const key = ED.sel || 'chart', G = [], e = ED.spec;
      const head = document.createElement('div'); head.className = 'fhead';
      head.innerHTML = `<b>${esc(labelOf(key))}</b>`;
      const reset = () => change(d => { resetFormat(d, key); });
      const acts = [{ label: 'Copy format', act: () => copyFormat(key), tip: 'Ctrl Shift C' }, { label: 'Paste format', act: () => pasteFormat(key), tip: 'Ctrl Shift V' }, { label: 'Reset', act: reset }];
      const first = group('Selected', [K.btns(acts)]); first.dataset.g = 'Selected'; first.querySelector('.gb').prepend(head); G.push(first);
      if (key === 'chart') {
        G.push(group('Fill', fillCtls('chart', { def: () => out && out.geom.th ? out.geom.th.bg : '#ffffff' })), group('Border', lineCtls('chart', { wph: '0' })), group('Corners', [K.rng('Rounded corners', 'fm/chart/rad', { min: 0, max: 60, unit: ' px' })]));
      } else if (key === 'plot') {
        G.push(group('Fill', fillCtls('plot', { def: () => out && out.geom.th ? out.geom.th.bg : '#ffffff' })), group('Border', lineCtls('plot', { wph: '1' })), group('Effects', effectCtls('plot'), false));
      } else if (TEXT_KEYS.includes(key) || key.startsWith('ann:') && ['text', 'callout'].includes((annOf(key) || {}).kind) || key.startsWith('ref:') && false) {
        const words = { title: 'title', subtitle: 'subtitle', note: 'note', xTitle: horizType() ? 'yLabel' : 'xLabel', yTitle: horizType() ? 'xLabel' : 'yLabel', y2Title: 'y2Label' };
        if (words[key]) G.push(group('Text', [K.area('Words', words[key], { rows: 2 })]));
        if (key === 'pieCenter') G.push(group('Text', [K.txt('Words', 'pie/center', {})]));
        if (key.startsWith('ann:')) G.push(annGroups(key)); else G.push(group('Font', textCtls(key, { lh: key === 'title' || key === 'subtitle' || key === 'note', rot: ['xTick', 'yTitle', 'y2Title', 'yTick'].includes(key) })));
        if (key === 'xTick') G.push(group('Tick labels', [K.sel('Angle', 'ax/x/rot', { opts: [['auto', 'Automatic'], ['0', 'Flat'], ['-45', 'Slanted up'], ['45', 'Slanted down'], ['-90', 'Vertical up'], ['90', 'Vertical down']] }), K.fmt('Number format', 'ax/x/fmt', { date: dateX() })], false));
        if (key === 'yTick') G.push(group('Number format', [K.fmt('Number format', 'ax/y/fmt'), K.sel('Display units', 'ax/y/units', { opts: ST.UNITS.map(([n, v]) => [String(v), n]), num: true })], false));
        if (key === 'label') G.push(group('Data labels', dlCtls('dl')), group('Label box', fillCtls('label', { noAuto: false, def: () => out && out.geom.th ? out.geom.th.bg : '#ffffff' }).concat(lineCtls('label'))));
        if (key === 'legend') G.push(...legendGroups());
      } else if (key === 'legend') { G.push(...legendGroups(), group('Font', textCtls('legend'))); }
      else if (key === 'axisX' || key === 'axisY' || key === 'axisY2') {
        G.push(group('Line', lineCtls(key, { def: () => out && out.geom.th ? out.geom.th.axis : '#9A9AA2' })));
        G.push(group('Options', key === 'axisY' ? axisYCtls() : key === 'axisX' ? axisXCtls() : [K.num('Minimum', 'ax/y2/min'), K.num('Maximum', 'ax/y2/max'), K.num('Major unit', 'ax/y2/major'), K.fmt('Number format', 'ax/y2/fmt'), K.sel('Tick marks', 'ax/y2/ticks', { opts: TICKS })], false));
      } else if (key === 'grid' || key === 'gridM') {
        G.push(group('Line', lineCtls(key, { def: () => out && out.geom.th ? out.geom.th.grid : '#E3E3E8' })), group('Show', [K.chk('Value axis lines', key === 'grid' ? 'ax/y/grid' : 'ax/y/mgrid', { def: () => key === 'grid' && (ED.spec.grid === 'value' || ED.spec.grid === 'both') }), K.chk('Category axis lines', key === 'grid' ? 'ax/x/grid' : 'ax/x/mgrid', { def: () => key === 'grid' && ED.spec.grid === 'both' })]));
      } else if (key === 'eb') {
        G.push(group('Error bars', [K.chk('Show', 'eb/on'), K.num('Width', 'eb/w', { ph: '1.4' }), K.num('Cap size', 'eb/cap', { ph: '4' }), K.col('Color', 'eb/c', { def: '#16161A' })]));
      } else if (isSeries(key)) G.push(...seriesGroups(+key.slice(1)));
      else if (isPoint(key)) G.push(...pointGroups(key));
      else if (isSlice(key)) G.push(...sliceGroups(+key.slice(2)));
      else if (key.startsWith('ref:')) G.push(...refGroups(key));
      else if (key.startsWith('ann:')) G.push(annGroups(key), ...annFormat(key));
      return G;
    }
    function legendGroups() {
      const T = ctx.getTable(), pie = isPieType();
      const entries = pie ? T.rows.map((r, k) => [k, String(((ED.spec.slices.names || {})[k]) || r.x)]) : T.cols.map((c, i) => [i, ((ED.spec.series.names || {})[i]) || c.name]);
      return [group('Legend', [K.sel('Position', 'legend', { opts: [['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right'], ['left', 'Left'], ['custom', 'Floating, drag it'], ['none', 'Off']] }),
        K.seg('Align', 'lay/lal', { opts: [['start', 'Left'], ['middle', 'Center'], ['end', 'Right']], when: () => ['top', 'bottom'].includes(ED.spec.legend) }), K.note('Drag the legend in the picture to float it over the chart.')]),
      group('Entries', entries.map(([k, n]) => K.chk(n, null, { rebuild: false, get: () => !((ED.spec.lg.hide) || []).includes(k), put: (d, v) => { const h = new Set(d.lg.hide || []); v ? h.delete(k) : h.add(k); d.lg.hide = [...h]; } })), false), group('Box', fillCtls('legend', { def: () => out && out.geom.th ? out.geom.th.bg : '#ffffff' }).concat(lineCtls('legend')), false)];
    }
    function seriesGroups(i) {
      const key = 's' + i, kind = kindOfSeries(i), G = [], c = colorOfSeries(i), T = ctx.getTable();
      G.push(group('Series', [K.txt('Name', P('series', 'names', i), { def: () => T.cols[i].name, ph: T.cols[i].name, max: 60 }), K.chk('Show in the chart', null, { rebuild: true, get: () => !(ED.spec.series.hidden || []).includes(i), put: (d, v) => { const h = new Set(d.series.hidden || []); v ? h.delete(i) : h.add(i); d.series.hidden = [...h]; } }), K.sel('Axis', P('so', i, 'axis'), { opts: [['', 'As the original'], ['left', 'Left'], ['right', 'Right']], auto: true, when: () => ['line', 'combo', 'bar'].includes(ED.spec.type) }),
        K.sel('Drawn as', P('so', i, 'kind'), { opts: [['', 'As the original'], ['bar', 'Bars'], ['line', 'Line'], ['area', 'Area']], auto: true, when: () => ED.spec.type === 'combo' }),
        K.btns([{ label: 'Highlight this series', act: () => change(d => { d.focus = { s: i, dim: 70 }; }) }, { label: 'Clear highlight', act: () => change(d => { d.focus = { s: null, dim: 70 }; }) }])]));
      if (kind === 'bar' || kind === 'lolli') {
        G.push(group('Fill', fillCtls(key, { colorPath: seriesColorPath(i), def: c })), group('Border', lineCtls(key, { wph: '0' })));
        if (kind === 'bar' && barType()) G.push(group('Bars', [K.rng('Gap between bars', 'bar/gap', { min: 0, max: 300, unit: '%' }), K.rng('Overlap', 'bar/overlap', { min: -100, max: 100, unit: '%', when: () => !stackType() && nSeries() > 1 }), K.rng('Rounded corners', 'bar/rad', { min: 0, max: 40, unit: ' px' })], false));
        if (kind === 'lolli') G.push(group('Marker', markerCtls(i, true)));
      } else if (kind === 'area') {
        G.push(group('Fill', fillCtls(key, { colorPath: seriesColorPath(i), def: c, autoKind: 'solid' })), group('Line', lineCtls(key, { wph: '0' })));
      } else if (kind === 'dot') {
        G.push(group('Marker', markerCtls(i, true)), group('Fill', fillCtls(key, { colorPath: seriesColorPath(i), def: c })), group('Border', lineCtls(key, { wph: '0' })));
      } else {
        G.push(group('Line', [K.col('Color', seriesColorPath(i), { def: c, noAuto: false })].concat(lineCtls(key, { colorPath: null, label: 'Line style', wph: 'auto' }).filter(x => !(x.label === 'Color')), [K.chk('Smooth the line', P('so', i, 'ln', 'smooth'), { tip: 'A curve that never overshoots the points', when: () => !['step'].includes(ED.spec.type) })])), group('Markers', markerCtls(i, false)));
      }
      G.push(group('Effects', effectCtls(key), false));
      const dlp = P('so', i, 'dl'); G.push(group('Data labels', [K.sel('Labels for this series', P(dlp, 'on'), { opts: [['', 'As the chart'], ['true', 'Show'], ['false', 'Hide']], bool: true, auto: true, rebuild: true }), K.sel('Position', P(dlp, 'pos'), { opts: stackType() ? [['auto', 'Center'], ['inEnd', 'Inside end'], ['inBase', 'Inside base']] : barType() ? [['auto', 'Outside end'], ['inEnd', 'Inside end'], ['center', 'Center'], ['inBase', 'Inside base']] : [['auto', 'Above'], ['below', 'Below'], ['left', 'Left'], ['right', 'Right'], ['center', 'Center']] }), K.fmt('Number format', P(dlp, 'fmt'))], false));
      void T; return G;
    }
    function markerCtls(i, always) {
      const p = f => P('so', i, 'mk', f);
      return [K.sel('Shape', p('shape'), { opts: Object.entries(ST.MARKERS).map(([k, n]) => [k, n]), auto: true }), K.num('Size', p('size'), { unit: 'px', ph: 'auto' }), K.chk('Hollow', p('hollow')), K.col('Fill color', p('c'), { def: colorOfSeries(i) }), K.col('Border color', p('lc'), { def: colorOfSeries(i) }), K.num('Border width', p('lw'), { unit: 'px', ph: '1' }),
        always ? null : K.sel('Show markers', p('mode'), { opts: [['', 'As the chart'], ['on', 'Always'], ['off', 'Never']], auto: true })].filter(Boolean);
    }
    function pointGroups(key) {
      const [s, j] = key.slice(1).split('.p').map(Number), T = ctx.getTable(), kind = kindOfSeries(s), G = [];
      G.push(group('Point', [K.note(`${T.cols[s].name} at ${T.rows[j] ? T.rows[j].x : ''}: ${T.rows[j] ? ctx.fmt(T.rows[j].vals[s]) : ''}`), K.txt('Label text', P('pl', `s${s}.${j}`, 'text'), { ph: 'Value', max: 60 }), K.chk('Hide this label', P('pl', `s${s}.${j}`, 'hide'), { after: v => { setp(ED.spec, P('pl', `s${s}.${j}`, 'show'), v ? false : null); } }),
        K.btns([{ label: 'Add a callout here', act: () => addCallout(s, j) }])]));
      G.push(group('Fill', fillCtls(key, { def: colorOfSeries(s) })));
      if (kind === 'bar' || kind === 'dot' || kind === 'lolli') G.push(group('Border', lineCtls(key, { wph: '0' })));
      G.push(group('Effects', effectCtls(key), false));
      return G;
    }
    function sliceGroups(k) {
      const key = 'sl' + k, c = colorOfSlice(k), T = ctx.getTable();
      return [group('Slice', [K.txt('Name', P('slices', 'names', k), { ph: String(T.rows[k].x), max: 60 }), K.chk('Show in the chart', null, { rebuild: true, get: () => !(ED.spec.slices.hidden || []).includes(k), put: (d, v) => { const h = new Set(d.slices.hidden || []); v ? h.delete(k) : h.add(k); d.slices.hidden = [...h]; } }), K.rng('Pull out', P('slices', 'ex', k), { min: 0, max: 60, unit: '%' }), K.txt('Label text', P('pl', key, 'text'), { ph: 'Automatic', max: 60 })]),
        group('Fill', fillCtls(key, { colorPath: P('slices', 'colors', k), def: c })), group('Border', lineCtls(key, { def: () => out && out.geom.th ? out.geom.th.bg : '#ffffff', wph: '1.5' })), group('Effects', effectCtls(key), false)];
    }
    function refGroups(key) {
      const r = refOf(key); if (!r) return [group('Reference', [K.note('This line is gone. Pick another element.')])];
      const i = ED.spec.refs.indexOf(r), p = f => P('refs', i, f), vAx = r.axis !== 'x', cat = !vAx && !numX();
      const T = ctx.getTable();
      const G = [group('Reference', [K.seg('Axis', p('axis'), { opts: [['y', 'Value'], ['x', 'Category']], rebuild: true }), K.seg('Kind', p('kind'), { opts: [['line', 'Line'], ['band', 'Band']], rebuild: true }),
        cat ? K.sel('At', p('v'), { opts: T.rows.map((q, j) => [String(j), String(q.x)]), num: true }) : K.num(r.kind === 'band' ? 'From' : 'At', p('v'), dateX() && !vAx ? { ph: 'days since 1970', tip: 'For a date axis this is the day number. Press Today to fill in a date.' } : {}),
        r.kind === 'band' ? (cat ? K.sel('To', p('v2'), { opts: T.rows.map((q, j) => [String(j), String(q.x)]), num: true }) : K.num('To', p('v2'), {})) : null,
        dateX() && !vAx ? K.txt('Or a date', null, { ph: 'yyyy-mm-dd', max: 10, get: () => '', put: (d, v) => { const t = /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + 'T00:00:00Z') / 864e5 : NaN; if (isFinite(t)) d.refs[i].v = t; } }) : null,
        K.txt('Label', p('text'), { max: 60 }), K.seg('Label at', p('pos'), { opts: [['start', 'Start'], ['middle', 'Middle'], ['end', 'End']] }),
        K.btns([{ label: 'Delete', act: () => { change(d => { d.refs.splice(i, 1); }); select('chart'); } }, { label: 'Duplicate', act: () => { change(d => { d.refs.push(Object.assign(clone(r), { id: uid() })); }); } }])])];
      if (r.kind === 'band') G.push(group('Fill', fillCtls(key, { def: () => (getp(ED.spec, P('fm', key, 'line', 'c')) || '#16161A') })), group('Border', lineCtls(key, { wph: '0' })));
      else G.push(group('Line', lineCtls(key, { def: () => '#16161A', wph: '1.5' })));
      G.push(group('Label font', textCtls(key, { align: false })));
      return G;
    }
    // annotations
    function annGroups(key) {
      const a = annOf(key); if (!a) return group('Annotation', [K.note('This item is gone. Pick another element.')]);
      const i = ED.spec.ann.indexOf(a), p = f => P('ann', i, f), T = ctx.getTable();
      const ctls = [];
      if (a.kind === 'text' || a.kind === 'callout' || a.kind === 'rect' || a.kind === 'ellipse') ctls.push(K.area('Words', p('text'), { rows: 3, max: 400 }));
      if (a.kind === 'callout') {
        ctls.push(K.sel('Points at series', p('s'), { opts: (isPieType() ? [] : T.cols.map((c, j) => [String(j), c.name])), num: true, when: () => !isPieType() }), K.sel('At', p('j'), { opts: T.rows.map((r, j) => [String(j), String(r.x)]), num: true, when: () => !isPieType() }),
          K.sel('At slice', p('sl'), { opts: T.rows.map((r, j) => [String(j), String(r.x)]), num: true, when: () => isPieType() }), K.num('Box across', p('dx'), { unit: 'px', ph: '0' }), K.num('Box down', p('dy'), { unit: 'px', ph: '-50' }), K.num('Box width', p('fw'), { unit: '%', scale: 100, ph: '20' }));
      } else {
        ctls.push(K.num('Left', p('fx'), { unit: '%', scale: 100 }), K.num('Top', p('fy'), { unit: '%', scale: 100 }), a.kind === 'line' || a.kind === 'arrow' ? K.num('Across', p('fw'), { unit: '%', scale: 100 }) : K.num('Width', p('fw'), { unit: '%', scale: 100 }), a.kind === 'line' || a.kind === 'arrow' ? K.num('Down', p('fh'), { unit: '%', scale: 100 }) : (a.kind === 'text' ? null : K.num('Height', p('fh'), { unit: '%', scale: 100 })));
      }
      ctls.push(K.btns([{ label: 'Duplicate', act: () => { const c = Object.assign(clone(a), { id: uid(), fx: Math.min(0.9, (a.fx || 0.5) + 0.03), fy: Math.min(0.9, (a.fy || 0.5) + 0.03) }); change(d => { d.ann.push(c); if (ED.spec.fm['ann:' + a.id]) d.fm['ann:' + c.id] = clone(ED.spec.fm['ann:' + a.id]); if (ED.spec.tx['ann:' + a.id]) d.tx['ann:' + c.id] = clone(ED.spec.tx['ann:' + a.id]); }); select('ann:' + c.id); } },
        { label: 'Bring forward', act: () => change(d => { const j = d.ann.indexOf(d.ann.find(x => x.id === a.id)); if (j < d.ann.length - 1) { [d.ann[j], d.ann[j + 1]] = [d.ann[j + 1], d.ann[j]]; } }) }, { label: 'Send back', act: () => change(d => { const j = d.ann.indexOf(d.ann.find(x => x.id === a.id)); if (j > 0) { [d.ann[j], d.ann[j - 1]] = [d.ann[j - 1], d.ann[j]]; } }) },
        { label: 'Delete', act: () => { change(d => { d.ann.splice(i, 1); }); select('chart'); } }]));
      return group('Annotation', ctls);
    }
    function annFormat(key) {
      const a = annOf(key); if (!a) return [];
      const th = () => out && out.geom.th ? out.geom.th : { bg: '#fff', fg: '#16161A' };
      const G = [];
      if (a.kind === 'line' || a.kind === 'arrow') G.push(group('Line', lineCtls(key, { def: () => th().fg, wph: '1.5' })));
      else { G.push(group('Fill', fillCtls(key, { def: () => a.kind === 'callout' ? th().bg : th().fg })), group('Border', lineCtls(key, { def: () => a.kind === 'callout' ? th().axis : th().fg, wph: a.kind === 'callout' ? '1' : '1.5' })), group('Corners', [K.rng('Rounded corners', P('fm', key, 'rad'), { min: 0, max: 40, unit: ' px', when: () => a.kind !== 'ellipse' })], false)); }
      G.push(group('Effects', effectCtls(key), false));
      if (a.kind !== 'line' && a.kind !== 'arrow') G.push(group('Font', textCtls(key, { lh: true })));
      return G;
    }
    // the box starts on the side of the point that has room: toward the middle of the plot, above unless the point is near the top
    function addCallout(s, j) {
      const id = uid(), P = out && out.geom.pts[`s${s}.${j}`], pl = out && out.geom.plot;
      const dx = P && pl ? (P[0] < (pl.L + pl.R) / 2 ? 80 : -80) : -70, dy = P && pl ? (P[1] < pl.T + 80 ? 60 : -55) : -55;
      change(d => { d.ann = d.ann || []; d.ann.push({ id, kind: 'callout', s, j, text: 'Note', dx, dy, fw: 0.2 }); }); select('ann:' + id); setTab('format');
    }
    function resetFormat(d, key) {
      delete d.fm[key]; delete d.tx[key];
      if (isSeries(key)) { const i = +key.slice(1); delete d.so[i]; if (d.series.colors) delete d.series.colors[i]; Object.keys(d.fm).forEach(q => { if (q.startsWith(key + '.p')) delete d.fm[q]; }); }
      if (isSlice(key)) { const k = +key.slice(2); if (d.slices.colors) delete d.slices.colors[k]; if (d.slices.ex) delete d.slices.ex[k]; }
      if (key === 'legend') { d.legend = 'top'; d.lay.lal = 'start'; d.lg = { hide: [], sym: 'auto' }; }
      if (key === 'axisY') d.ax.y = {}; if (key === 'axisX') d.ax.x = {};
    }
    function copyFormat(key) {
      const e = ED.spec; ED.clip = { kind: isSeries(key) ? 'series' : isPoint(key) ? 'point' : isSlice(key) ? 'slice' : key.startsWith('ann:') ? 'ann' : key.startsWith('ref:') ? 'ref' : key, fm: clone(e.fm[key] || {}), tx: clone(e.tx[key] || {}), so: isSeries(key) ? clone(e.so[+key.slice(1)] || {}) : null, color: isSeries(key) ? (e.series.colors || {})[+key.slice(1)] : null };
      toast('Format copied. Select another element of the same kind and paste.');
    }
    function pasteFormat(key) {
      const c = ED.clip; if (!c) { toast('Copy a format first.'); return; }
      const kind = isSeries(key) ? 'series' : isPoint(key) ? 'point' : isSlice(key) ? 'slice' : key.startsWith('ann:') ? 'ann' : key.startsWith('ref:') ? 'ref' : key;
      const ok = c.kind === kind || (TEXT_KEYS.includes(c.kind) && TEXT_KEYS.includes(key)) || (['series', 'point', 'slice'].includes(c.kind) && ['series', 'point', 'slice'].includes(kind));
      if (!ok) { toast('That format came from a different kind of element.'); return; }
      change(d => { d.fm[key] = clone(c.fm); if (Object.keys(c.tx || {}).length) d.tx[key] = clone(c.tx); else delete d.tx[key];
        if (isSeries(key) && c.so) d.so[+key.slice(1)] = clone(c.so); if (isSeries(key) && c.color) (d.series.colors = d.series.colors || {})[+key.slice(1)] = c.color; });
      toast('Format pasted.');
    }

    // Add: text boxes, shapes, callouts, reference lines and bands
    function addPane() {
      const G = [], e = ED.spec;
      const add = (kind, extra) => () => { const id = uid(); change(d => { d.ann = d.ann || []; d.ann.push(Object.assign({ id, kind }, extra)); }); select('ann:' + id); setTab('format'); };
      G.push(group('Text and shapes', [K.btns([
        { label: 'Text box', act: add('text', { fx: 0.12, fy: 0.2, fw: 0.28, text: 'Double click or use the Format tab to change this text' }) },
        { label: 'Rectangle', act: add('rect', { fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.18 }) },
        { label: 'Ellipse', act: add('ellipse', { fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.18 }) },
        { label: 'Line', act: add('line', { fx: 0.2, fy: 0.3, fw: 0.2, fh: 0 }) },
        { label: 'Arrow', act: add('arrow', { fx: 0.2, fy: 0.3, fw: 0.2, fh: 0.12 }) },
      ]), K.note('Drag them in the picture. Corners resize them. The arrow keys nudge the selected one, and Delete removes it.')]));
      const T = ctx.getTable(), pie = isPieType();
      G.push(group('Callout', [K.sel('On', '__calS', { opts: pie ? T.rows.map((r, k) => ['sl' + k, String(r.x)]) : T.cols.map((c, i) => [String(i), c.name]), def: '0' }), pie ? null : K.sel('At', '__calJ', { opts: T.rows.map((r, j) => [String(j), String(r.x)]), def: '0' }),
        K.btn('Add a callout', () => { const s = ED.tmp.calS, j = ED.tmp.calJ; if (pie) { const sl = +(String(s || 'sl0').slice(2)); const id = uid(); change(d => { d.ann.push({ id, kind: 'callout', sl, text: 'Note', dx: -60, dy: -50, fw: 0.2 }); }); select('ann:' + id); setTab('format'); } else addCallout(+(s || 0), +(j || 0)); })].filter(Boolean)));
      const vNum = numX() && !dateX(), cats = T.rows.map((r, j) => [String(j), String(r.x)]);
      const newRef = (axis, kind) => () => { const id = uid(), Tt = T; let v, v2; const nums = Tt.cols.flatMap((c, i) => Tt.rows.map(r => r.vals[i])).filter(x => x != null && isFinite(x)), lo = Math.min(...nums), hi = Math.max(...nums);
        // lines and bands start in different places, and a second one of the same kind moves on to the next free spot
        const same = (ED.spec.refs || []).filter(r => r.axis === axis && r.kind === kind).length;
        const spots = kind === 'band' ? [0.55, 0.15, 0.75, 0.35] : [0.3, 0.8, 0.12, 0.62], k = spots[same % spots.length];
        const at = (a, b, f) => a + (b - a) * f;
        if (axis === 'y') { v = +at(lo, hi, k).toPrecision(3); v2 = +at(lo, hi, Math.min(1, k + 0.18)).toPrecision(3); } else if (numX()) { const xs = Tt.rows.map(r => dateX() ? Date.parse(r.x) / 864e5 : r.x), a = Math.min(...xs), b = Math.max(...xs); v = +at(a, b, k).toPrecision(8); v2 = +at(a, b, Math.min(1, k + 0.18)).toPrecision(8); } else { const n = Tt.rows.length; v = Math.min(n - 1, Math.floor(n * k)); v2 = Math.min(n - 1, v + 1); }
        change(d => { d.refs = d.refs || []; d.refs.push({ id, axis, kind, v, v2: kind === 'band' ? v2 : null, text: kind === 'band' ? 'Highlight' : 'Target', pos: 'end' }); }); select('ref:' + id); setTab('format'); };
      G.push(group('Reference lines and bands', [K.btns([{ label: 'Value line', act: newRef('y', 'line') }, { label: 'Value band', act: newRef('y', 'band') }, { label: 'Category line', act: newRef('x', 'line') }, { label: 'Highlight a period', act: newRef('x', 'band') }]), K.note('A line marks a target or a threshold. A band shades a range of values, or a stretch of time such as a recession.')]));
      void vNum; void cats;
      const items = [...(e.refs || []).map(r => ['ref:' + r.id, labelOf('ref:' + r.id)]), ...(e.ann || []).map(a => ['ann:' + a.id, labelOf('ann:' + a.id)])];
      const g = group('On this chart', [K.note(items.length ? 'Pick one to edit it.' : 'Nothing added yet.')]); const l = document.createElement('div'); l.className = 'thlist';
      l.innerHTML = items.map(([k, n]) => `<div class="throw"><span>${esc(n)}</span><button class="chip tiny" type="button" data-pick="${esc(k)}">Edit</button></div>`).join(''); g.querySelector('.gb').appendChild(l); G.push(g);
      return G;
    }
    pane.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (b) { select(b.dataset.pick); setTab('format'); } });

    // Layout: size, margins, positions
    function layoutPane() {
      const G = [];
      G.push(group('Size', [K.sel('Preset', null, { opts: SIZE_PRESETS, rebuild: true, get: () => { const k = ED.spec.width + 'x' + ED.spec.height; return SIZE_PRESETS.some(p => p[0] === k) ? k : ''; }, put: (d, v) => { if (v) { const [w, h] = v.split('x').map(Number); d.width = w; d.height = h; } } }),
        K.num('Width', 'width', { unit: 'px', ph: '800' }), K.num('Height', 'height', { unit: 'px', ph: 'from the shape' }),
        K.sel('Shape', 'aspect', { opts: [['1.7778', 'Wide 16:9'], ['1.3333', '4:3'], ['1', 'Square'], ['0.8', 'Tall 4:5'], ['2.3333', 'Banner 21:9']], num: true, when: () => !ED.spec.height, after: () => { } })]));
      G.push(group('Margins', [K.num('Top', 'lay/m/t', { unit: 'px', ph: '0' }), K.num('Right', 'lay/m/r', { unit: 'px', ph: '0' }), K.num('Bottom', 'lay/m/b', { unit: 'px', ph: '0' }), K.num('Left', 'lay/m/l', { unit: 'px', ph: '0' }), K.note('Extra space around everything, on top of the automatic margin.')], false));
      G.push(group('Plot padding', [K.num('Top', 'lay/pad/t', { unit: 'px', ph: '0' }), K.num('Right', 'lay/pad/r', { unit: 'px', ph: '0' }), K.num('Bottom', 'lay/pad/b', { unit: 'px', ph: '0' }), K.num('Left', 'lay/pad/l', { unit: 'px', ph: '0' })], false));
      G.push(group('Titles and legend', [K.seg('Title and notes', 'lay/tal', { opts: [['start', 'Left'], ['middle', 'Center'], ['end', 'Right']] }), K.sel('Legend', 'legend', { opts: [['top', 'Top'], ['bottom', 'Bottom'], ['right', 'Right'], ['left', 'Left'], ['custom', 'Floating'], ['none', 'Off']] }), K.seg('Legend align', 'lay/lal', { opts: [['start', 'Left'], ['middle', 'Center'], ['end', 'Right']], when: () => ['top', 'bottom'].includes(ED.spec.legend) }),
        K.num('Floating legend, across', 'lay/lx', { unit: '%', scale: 100, when: () => ED.spec.legend === 'custom' }), K.num('Floating legend, down', 'lay/ly', { unit: '%', scale: 100, when: () => ED.spec.legend === 'custom' })]));
      G.push(group('Chart and plot area', [K.btns([{ label: 'Format chart area', act: () => { select('chart'); setTab('format'); } }, { label: 'Format plot area', act: () => { select('plot'); setTab('format'); } }])]));
      return G;
    }

    // Export: files, the clipboard, alt text and the accessibility check
    function exportPane() {
      const G = [], T = ctx.getTable();
      const png = s => () => exportPNG(s);
      G.push(group('Picture', [K.btns([{ label: 'PNG 1x', act: png(1) }, { label: 'PNG 2x', act: png(2) }, { label: 'PNG 4x', act: png(4) }, { label: 'SVG', act: exportSVG }, { label: 'PDF', act: exportPDF }]),
        K.chk('Transparent background for PNG and SVG', '__transparent'), K.btns([{ label: 'Copy image', act: copyImage }, { label: 'Copy SVG code', act: copySVG }, { label: 'Print or save as vector PDF', act: printChart }])]));
      G.push(group('Spreadsheet', [K.btns([{ label: 'XLSX with a native chart', act: () => ctx.downloadXlsx() }, { label: 'Copy data for Sheets', act: () => ctx.copyData() }]), K.note('The chart in the XLSX follows this editor: type, colors, fills, gaps, markers, labels, axes, legend and the text boxes.')]));
      G.push(group('Chart file', [K.btns([{ label: 'Save chart settings', act: saveChartFile }, { label: 'Open chart settings', act: openChartFile }]), K.note('A small JSON file with every setting here, but not the data. Open it on another chart to restyle it the same way.')], false));
      G.push(group('Alt text', [K.area('Description for screen readers', 'alt', { rows: 4, max: 800 }), K.btns([{ label: 'Write one from the data', act: () => change(d => { d.alt = out ? RM.render(table, specOpts({ alt: '' })).alt : ''; }) }, { label: 'Clear', act: () => change(d => { d.alt = ''; }) }]), K.note('Left empty, exports carry a short description made from the data.')]));
      const a = document.createElement('div'); a.id = 'a11y'; const g = group('Accessibility check', [K.seg('Preview as', '__cvd', { opts: [['none', 'Normal'], ['protan', 'Red blind'], ['deutan', 'Green blind'], ['tritan', 'Blue blind'], ['gray', 'Gray']], after: v => { ED.cvd = v; render(); } })]); g.querySelector('.gb').appendChild(a); G.push(g);
      void T; return G;
    }
    function drawChecks() {
      const el = $('a11y'); if (!el || !out) return;
      const items = [], cols = out.geom.colors, th = out.geom.th;
      // pairs of series colors that look alike to someone with a color vision deficiency
      const bad = [];
      for (const kind of ['normal', 'protan', 'deutan', 'tritan', 'gray']) {
        const cs = cols.map(c => ({ n: c.name, c: kind === 'normal' ? c.color : ST.simulate(c.color, kind) }));
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) { const d = ST.deltaE(cs[i].c, cs[j].c); if (d < 10) bad.push({ kind, a: cs[i].n, b: cs[j].n, d }); }
      }
      const NAMES = { normal: 'normal vision', protan: 'red blindness', deutan: 'green blindness', tritan: 'blue blindness', gray: 'grayscale' };
      if (!bad.length) items.push(['ok', 'Series colors stay apart', `Every pair of colors stays distinguishable under normal vision, red, green and blue blindness, and in grayscale (CIEDE2000 difference of 10 or more).`]);
      else { const seen = new Set(); bad.forEach(b => { const k = b.a + '|' + b.b; if (seen.has(k)) return; seen.add(k); const w = bad.filter(x => x.a === b.a && x.b === b.b).map(x => NAMES[x.kind]); items.push(['warn', `${b.a} and ${b.b} look alike`, `Under ${w.join(', ')} these two are hard to tell apart (difference ${Math.min(...bad.filter(x => x.a === b.a && x.b === b.b).map(x => x.d)).toFixed(1)}, 10 or more is comfortable).`, 'Use the colorblind safe palette', () => change(d => { d.palette = 'colorblind'; d.series.colors = {}; d.slices.colors = {}; })]); }); }
      if (cols.length > 6) items.push(['info', 'Many series', 'More than six colors are hard to match back to the legend. Direct data labels, or fewer series, read more easily.']);
      // text contrast
      const low = Object.entries(out.geom.tc).filter(([k, t]) => ST.isHex(t.c) && ST.contrast(t.c, th.bg) < ((t.size >= 18 || (t.size >= 14 && t.wt >= 700)) ? 3 : 4.5) && out.geom.els[k]);
      if (low.length) items.push(['warn', 'Some text is faint', low.map(([k, t]) => `${ELEMENT_NAMES[k] || k} ${ST.contrast(t.c, th.bg).toFixed(1)}:1`).join(', ') + '. Text needs 4.5:1 against the background (3:1 when large).', 'Use full contrast text', () => change(d => { low.forEach(([k]) => { d.tx[k] = Object.assign(d.tx[k] || {}, { c: th.fg }); }); })]);
      else items.push(['ok', 'Text contrast', 'All text meets 4.5:1 against the background (3:1 for large text).']);
      const small = Object.entries(out.geom.tc).filter(([k, t]) => t.size < 11 && out.geom.els[k]);
      if (small.length) items.push(['warn', 'Small text', small.map(([k, t]) => `${ELEMENT_NAMES[k] || k} ${t.size}px`).join(', ') + '. Under 11 px is hard to read once the picture is scaled down.']);
      items.push([ED.spec.alt && ED.spec.alt.trim() ? 'ok' : 'info', ED.spec.alt && ED.spec.alt.trim() ? 'Alt text written' : 'Alt text is automatic', ED.spec.alt && ED.spec.alt.trim() ? 'Your description is in the SVG, and in the XLSX chart.' : 'Exports carry a description made from the data. Write your own above if the chart makes a point it should state.']);
      el.innerHTML = items.map(([lv, t, d, bl, fn], i) => `<div class="check ${lv}"><span class="dot">${lv === 'ok' ? '✓' : lv === 'warn' ? '!' : 'i'}</span><div><b>${esc(t)}</b><span>${esc(d)}</span>${bl ? `<div class="fixbtn"><button class="btn go" type="button" data-fix="${i}">${esc(bl)}</button></div>` : ''}</div></div>`).join('');
      el.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => items[+b.dataset.fix][4]());
    }

    // ---------- exports ----------
    const nameOf = () => 'unchart-' + (ED.spec.title ? ED.spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'chart' : 'chart');
    const exportSpec = () => specOpts(ED.tmp.transparent ? { transparent: true } : {});
    function cleanSvg() { const o = RM.render(table, exportSpec()); return o; }
    async function exportPNG(scale) { if (!table) return; const o = cleanSvg(), b = await RM.toPNG(o.svg, o.width, o.height, scale); ctx.download(b, 'image/png', `${nameOf()}${scale > 1 ? '@' + scale + 'x' : ''}.png`); toast(`PNG at ${scale}x, ${o.width * scale} by ${o.height * scale} px.`); }
    function exportSVG() { if (!table) return; ctx.download(cleanSvg().svg, 'image/svg+xml', nameOf() + '.svg'); }
    async function exportPDF() {
      if (!table) return; const o = cleanSvg(), c = await RM.toCanvas(o.svg, o.width, o.height, 3);
      const g = c.getContext('2d'), px = g.getImageData(0, 0, c.width, c.height), th = out.geom.th;
      const bytes = await E.pdf(px, o.width, o.height, th ? th.bg : '#ffffff');
      ctx.download(bytes, 'application/pdf', nameOf() + '.pdf'); toast('PDF saved. For a vector PDF use Print.');
    }
    async function copyImage() { if (!table) return; const o = cleanSvg();
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': RM.toPNG(o.svg, o.width, o.height, 2) })]); toast('Image copied. Paste it into slides or a doc.'); } catch (e) { toast('Copying images is blocked here. Use Download PNG.'); } }
    async function copySVG() { if (!table) return; try { await navigator.clipboard.writeText(cleanSvg().svg); toast('SVG code copied.'); } catch (e) { toast('Copying is blocked here. Use Download SVG.'); } }
    function printChart() {
      if (!table) return; const o = cleanSvg(), f = document.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      f.srcdoc = `<!doctype html><title>${esc(ED.spec.title || 'Chart')}</title><style>@page{margin:12mm}html,body{margin:0;background:#fff}svg{width:100%;height:auto;display:block}</style>${o.svg}`;
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('Printing is blocked here. Use the PDF button.'); } setTimeout(() => f.remove(), 4000); }; document.body.appendChild(f);
    }
    function saveChartFile() { const s = clone(ED.spec); ctx.download(JSON.stringify({ unchartChart: 1, spec: s }, null, 1), 'application/json', nameOf() + '.unchart.json'); }
    function openChartFile() { pickFile('.json,application/json').then(async f => { try { const j = JSON.parse(await f.text()); if (!j.unchartChart || !j.spec) throw 0; change(d => { const keep = { type: d.type, index: d.index }; Object.keys(d).forEach(k => delete d[k]); Object.assign(d, clone(RM.DEFAULTS), j.spec); if (!RM.TYPES.includes(d.type)) d.type = keep.type; }); toast('Chart settings opened.'); } catch (er) { toast('That file is not an Unchart chart file.'); } }); }

    // ---------- tabs ----------
    function setTab(t) {
      ED.tab = t; $('edTabs').querySelectorAll('button').forEach(b => { b.setAttribute('aria-selected', b.dataset.tab === t); b.tabIndex = b.dataset.tab === t ? 0 : -1; });
      buildPane(); if (t === 'format') syncHead(); if (t === 'export') drawChecks();
    }
    $('edTabs').innerHTML = TABS.map(([k, n]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === ED.tab}" tabindex="${k === ED.tab ? 0 : -1}">${n}</button>`).join('');
    $('edTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
    $('edTabs').addEventListener('keydown', e => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; const i = TABS.findIndex(t => t[0] === ED.tab), j = (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length; setTab(TABS[j][0]); $('edTabs').querySelector(`[data-tab="${TABS[j][0]}"]`).focus(); });
    $('edSel').addEventListener('change', e => { select(e.target.value); });
    // the chart type buttons sit in the Design pane
    pane.addEventListener('click', e => { const b = e.target.closest('[data-type]'); if (!b) return; change(d => { d.type = b.dataset.type; if (['pie', 'donut'].includes(d.type) && d.legend === 'top') d.legend = 'right'; }); });
    // shared datalist of font names
    const dl = document.createElement('datalist'); dl.id = 'edFonts'; dl.innerHTML = COMMON_FONTS.map(f => `<option value="${f}">`).join(''); document.body.appendChild(dl);
    // color vision filters for the preview
    const filt = document.createElementNS(SVGNS, 'svg'); filt.setAttribute('width', 0); filt.setAttribute('height', 0); filt.setAttribute('aria-hidden', 'true'); filt.style.position = 'absolute';
    filt.innerHTML = '<defs>' + ['protan', 'deutan', 'tritan'].map(k => `<filter id="uc-cvd-${k}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${ST.CVD[k].map(r => r.join(' ') + ' 0 0').join(' ')} 0 0 0 1 0"/></filter>`).join('') + '<filter id="uc-cvd-gray" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0"/></filter></defs>';
    document.body.appendChild(filt);

    // ---------- pointer interaction on the picture ----------
    const svgOf = () => prev.querySelector('svg');
    const unit = () => { const s = svgOf(); if (!s) return 1; const r = s.getBoundingClientRect(); return out.width / r.width; };
    function keyFromNode(n) {
      const el = n.dataset.el, j = n.dataset.j;
      if (/^s\d+$/.test(el) && j != null && (ED.sel === el || ED.sel.startsWith(el + '.p'))) return `${el}.p${j}`;
      if (/^sl\d+$/.test(el)) return el;
      if (el === 'label' && j != null) return 'label';
      return el;
    }
    prev.addEventListener('pointerdown', ev => {
      const svg = svgOf(); if (!svg || ev.button) return;
      const h = ev.target.closest('[data-handle]');
      const n = ev.target.closest('[data-el]'); const key = h ? ED.sel : n ? keyFromNode(n) : 'chart';
      if (!h) { select(key); if (ED.tab !== 'format' && !ED.keepTab) { /* picking in the picture opens the Format tab */ setTab('format'); } }
      const a = annOf(key), movable = a || key === 'legend';
      if (!movable && !h) return;
      ev.preventDefault(); prev.setPointerCapture(ev.pointerId);
      ED.drag = { key, handle: h ? h.dataset.handle : null, x: ev.clientX, y: ev.clientY, before: snap(), moved: false, start: a ? { fx: a.fx, fy: a.fy, fw: a.fw, fh: a.fh, dx: a.dx, dy: a.dy } : { lx: ED.spec.lay.lx, ly: ED.spec.lay.ly }, box: keyBox(key) };
    });
    prev.addEventListener('pointermove', ev => {
      const d = ED.drag;
      if (!d) { const n = ev.target.closest && ev.target.closest('[data-el]'); const hv = n ? keyFromNode(n) : null; if (hv !== hover) { hover = hv; decorate(); const j = n && n.dataset.j; ED.hintOverride = hv && hv !== ED.sel ? labelOf(hv) + (j != null && (isSeries(n.dataset.el) || isSlice(n.dataset.el)) ? ' · ' + valueHint(n.dataset.el, +j) : '') : ''; syncHead(); } return; }
      const k = unit(), dx = (ev.clientX - d.x) * k, dy = (ev.clientY - d.y) * k, W = out.width, H = out.height, a = annOf(d.key);
      if (!d.moved && Math.hypot(dx, dy) < 3) return; d.moved = true;
      if (a) {
        if (d.handle) {
          const s = d.start;
          if (a.kind === 'line' || a.kind === 'arrow') { if (d.handle === 'end') { a.fw = s.fw + dx / W; a.fh = s.fh + dy / H; } else { a.fx = s.fx + dx / W; a.fy = s.fy + dy / H; a.fw = s.fw - dx / W; a.fh = s.fh - dy / H; } }
          else if (a.kind === 'text') a.fw = Math.max(0.06, s.fw + dx / W);
          else { const w0 = s.fw, h0 = s.fh; if (d.handle.includes('e')) a.fw = Math.max(0.02, w0 + dx / W); if (d.handle.includes('s')) a.fh = Math.max(0.02, h0 + dy / H); if (d.handle.includes('w')) { a.fx = s.fx + dx / W; a.fw = Math.max(0.02, w0 - dx / W); } if (d.handle.includes('n')) { a.fy = s.fy + dy / H; a.fh = Math.max(0.02, h0 - dy / H); } }
        } else if (a.kind === 'callout') { a.dx = Math.round((+d.start.dx || 0) + dx); a.dy = Math.round((+d.start.dy || -50) + dy); }
        else { a.fx = clampN(d.start.fx + dx / W, -0.2, 1.1); a.fy = clampN(d.start.fy + dy / H, -0.2, 1.1); }
      } else if (d.key === 'legend') { ED.spec.legend = 'custom'; ED.spec.lay.lx = clampN(d.start.lx + dx / W, 0, 0.95); ED.spec.lay.ly = clampN(d.start.ly + dy / H, 0, 0.95); if (d.start.lx == null) { const b = d.box; ED.spec.lay.lx = clampN(b[0] / W + dx / W, 0, 0.95); ED.spec.lay.ly = clampN(b[1] / H + dy / H, 0, 0.95); } }
      render({});
    });
    const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
    const endDrag = ev => { const d = ED.drag; if (!d) return; ED.drag = null; try { prev.releasePointerCapture(ev.pointerId); } catch (e) { /* already released */ } if (d.moved) { pushHist(d.before); structural(); } };
    prev.addEventListener('pointerup', endDrag); prev.addEventListener('pointercancel', endDrag);
    prev.addEventListener('pointerleave', () => { if (!ED.drag && hover) { hover = null; ED.hintOverride = ''; decorate(); syncHead(); } });
    // double click on the title, subtitle or a text box focuses its words
    prev.addEventListener('dblclick', ev => {
      // the first click redraws the picture, so the event can land on the container: look under the pointer instead
      const n = ev.target.closest('[data-el]') || (document.elementsFromPoint(ev.clientX, ev.clientY).find(x => x.dataset && x.dataset.el && prev.contains(x)));
      if (!n) return; const k = keyFromNode(n); select(k); setTab('format'); const f = pane.querySelector('textarea, input[type=text]'); if (f) { f.focus(); f.select(); } });

    // ---------- keyboard ----------
    function key(e) {
      const mod = e.ctrlKey || e.metaKey, k = e.key;
      if (mod && !e.shiftKey && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return true; }
      if (mod && ((e.shiftKey && k.toLowerCase() === 'z') || k.toLowerCase() === 'y')) { e.preventDefault(); redo(); return true; }
      if (mod && e.shiftKey && k.toLowerCase() === 'c') { e.preventDefault(); copyFormat(ED.sel); return true; }
      if (mod && e.shiftKey && k.toLowerCase() === 'v') { e.preventDefault(); pasteFormat(ED.sel); return true; }
      if (mod && k.toLowerCase() === 'd' && annOf(ED.sel)) { e.preventDefault(); const a = annOf(ED.sel); const c = Object.assign(clone(a), { id: uid(), fx: Math.min(0.9, (a.fx || 0.5) + 0.03), fy: Math.min(0.9, (a.fy || 0.5) + 0.03) }); change(d => { d.ann.push(c); if (d.fm['ann:' + a.id]) d.fm['ann:' + c.id] = clone(d.fm['ann:' + a.id]); }); select('ann:' + c.id); return true; }
      if (mod) return false;
      if (k === 'Delete' || k === 'Backspace') {
        if (annOf(ED.sel)) { e.preventDefault(); const id = ED.sel.slice(4); change(d => { d.ann = d.ann.filter(a => a.id !== id); delete d.fm[ED.sel]; delete d.tx[ED.sel]; }); select('chart'); return true; }
        if (refOf(ED.sel)) { e.preventDefault(); const id = ED.sel.slice(4); change(d => { d.refs = d.refs.filter(a => a.id !== id); delete d.fm[ED.sel]; }); select('chart'); return true; }
        if (ED.sel === 'legend') { e.preventDefault(); change(d => { d.legend = 'none'; }); select('chart'); return true; }
        if (isSeries(ED.sel) || isSlice(ED.sel)) { e.preventDefault(); const pie = isSlice(ED.sel), i = +ED.sel.slice(pie ? 2 : 1); change(d => { const o = d[pie ? 'slices' : 'series']; o.hidden = [...new Set([...(o.hidden || []), i])]; }); select('chart'); return true; }
        if (ED.sel === 'title' || ED.sel === 'subtitle' || ED.sel === 'note') { e.preventDefault(); change(d => { d[ED.sel] = ''; }); return true; }
        return false;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k) && (annOf(ED.sel) || refOf(ED.sel))) {
        e.preventDefault(); const st = e.shiftKey ? 10 : 1, a = annOf(ED.sel), dx = k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, dy = k === 'ArrowUp' ? -st : k === 'ArrowDown' ? st : 0;
        if (a) { change(d => { const q = d.ann.find(x => x.id === a.id); if (q.kind === 'callout') { q.dx = (+q.dx || 0) + dx; q.dy = (+q.dy || -50) + dy; } else { q.fx = (q.fx || 0) + dx / out.width; q.fy = (q.fy || 0) + dy / out.height; } }); }
        return true;
      }
      if (k === '[' || k === ']') { const L = elementList().map(l => l[0]), i = L.indexOf(ED.sel), j = (i + (k === ']' ? 1 : -1) + L.length) % L.length; select(L[j]); return true; }
      if (k === 'Escape') { if (ED.pop) { ED.pop = ''; drawPop(); return true; } if (ED.sel !== 'chart') { select('chart'); return true; } return false; }
      return false;
    }

    // ---------- the description the XLSX writer draws a native chart from ----------
    // Everything is resolved here (colors, widths, merged group and series formats), so the writer only translates.
    function xlsxSpec() {
      const e = ED.spec, T = ctx.getTable(), o = out; if (!T || !o) return null;
      const th = o.geom.th, pie = isPieType(), G = o.geom, fm = k => ST.merge({}, e.fm[k]);
      const kinds = { bar: 'bars', line: 'lines', area: 'areas', dot: 'dots', lolli: 'bars' };
      const txt = (key, size) => { const t = e.tx[key] || {}, c = G.tc[key] || {}; return { size: +(t.size || c.size || size) || size, wt: t.wt || c.wt || 400, it: !!t.it, c: ST.isHex(t.c) ? t.c : (c.c || th.fg), font: t.font ? (RM.FONTS[t.font] ? RM.FONTS[t.font].split(',')[0].replace(/["']/g, '').trim() : t.font) : null }; };
      const famName = () => { const f = e.fontCustom || RM.FONTS[e.font] || RM.FONTS.sans; return String(f).split(',')[0].replace(/["']/g, '').trim(); };
      const palSeries = G.colors.filter(c => !pie);
      const ser = palSeries.map(c => { const i = +c.key.slice(1), so = e.so[i] || {}, f = ST.merge(ST.merge({}, fm(kinds[c.kind] || 'lines')), fm(c.key));
        const mk = ST.merge(ST.merge({}, e.ln && e.ln.shape ? { shape: e.ln.shape } : {}), so.mk || {});
        const dpts = {}; Object.keys(e.fm).forEach(q => { const m = /^s(\d+)\.p(\d+)$/.exec(q); if (m && +m[1] === i) dpts[+m[2]] = ST.merge({}, e.fm[q]); });
        const dl = ST.merge(ST.merge({}, e.dl), so.dl || {});
        return { j: i, name: c.name, kind: c.kind, color: c.color, fill: f.fill || {}, line: f.line || {}, shadow: f.shadow, glow: f.glow, soft: f.soft, marker: { shape: mk.shape || 'circle', size: mk.size || e.ln.size || 0, hollow: !!mk.hollow, c: mk.c, lc: mk.lc, lw: mk.lw, mode: mk.mode || e.ln.mk || 'auto' },
          smooth: !!(so.ln && so.ln.smooth != null ? so.ln.smooth : e.ln.smooth), lw: (e.ln.w || 0), dash: (f.line && f.line.dash) || e.ln.dash || 'solid',
          axis: (so.axis || (T.cols[i] || {}).axis || 'left'), dl: dl.on ? dl : null, dpts, err: e.eb && e.eb.on ? i : null }; });
      const slices = pie ? G.colors.map(c => { const k = +c.key.slice(2); return { k, name: c.name, color: c.color, fill: ST.merge({}, e.fm[c.key]).fill || {}, line: ST.merge({}, e.fm[c.key]).line || {}, ex: (e.slices.ex || {})[k] || e.pie.ex || 0 }; }) : [];
      const ax = (a, def) => Object.assign({}, def, (e.ax || {})[a]);
      const refs = (e.refs || []).filter(r => r.axis !== 'x').map(r => ({ kind: r.kind, v: +r.v, v2: r.v2 != null ? +r.v2 : null, text: r.text || '', line: ST.merge({}, e.fm['ref:' + r.id]).line || {}, c: txt('ref:' + r.id, 12).c }));
      const ann = (e.ann || []).map(a => ({ kind: a.kind, text: a.text || '', fx: a.fx, fy: a.fy, fw: a.fw, fh: a.fh, pt: a.kind === 'callout' ? (G.pts[a.sl != null ? 'sl' + a.sl : `s${a.s}.${a.j}`] || null) : null, dx: a.dx, dy: a.dy,
        f: ST.merge({}, e.fm['ann:' + a.id]), t: txt('ann:' + a.id, 13), box: G.els['ann:' + a.id] || null }));
      const pal = (RM.PALETTES[e.palette] || RM.PALETTES.unchart)[th.dark ? 'dark' : 'light'];
      const vals = T.rows.map(r => r.vals[0]);
      const vary = !pie && T.cols.length === 1 && (e.bar.vary || (ST.isHex(e.bar.neg) && vals.some(v => v < 0))) && barType() ? vals.map((v, k) => v < 0 && ST.isHex(e.bar.neg) ? e.bar.neg : e.bar.vary ? pal[k % pal.length] : null) : null;
      return { type: e.type, W: o.width, H: o.height, th: { bg: th.bg, fg: th.fg, grid: th.grid, axis: th.axis, muted: th.muted }, font: famName(), size: e.fontSize || 14,
        title: e.title, subtitle: e.subtitle, xTitle: horizType() ? e.yLabel : e.xLabel, yTitle: horizType() ? e.xLabel : e.yLabel, y2Title: e.y2Label,
        tx: { title: txt('title', Math.round((e.fontSize || 14) * 1.45)), xTitle: txt('xTitle', e.fontSize || 14), yTitle: txt('yTitle', e.fontSize || 14), y2Title: txt('y2Title', e.fontSize || 14), xTick: txt('xTick', 12), yTick: txt('yTick', 12), y2Tick: txt('y2Tick', 12), legend: txt('legend', e.fontSize || 14), label: txt('label', 12), note: txt('note', 12), subtitle: txt('subtitle', 14) },
        els: G.els, plot: G.plot, legend: e.legend === 'none' || !G.legend ? null : { pos: e.legend, hide: (e.lg && e.lg.hide) || [], f: fm('legend') },
        chart: fm('chart'), plotF: fm('plot'), grid: fm('grid'), gridM: fm('gridM'), axisF: { x: fm('axisX'), y: fm('axisY'), y2: fm('axisY2') },
        ser, slices, bar: e.bar, ln: e.ln, ar: e.ar, pie: e.pie, dl: e.dl, gridMode: e.grid, zero: e.zero, log: !!e.log, yMin: e.yMin, yMax: e.yMax, dual: e.dual !== false,
        ax: { x: ax('x', {}), y: ax('y', {}), y2: ax('y2', {}) }, refs, ann, vary, pieBox: G.pie ? [G.pie.cx - G.pie.R, G.pie.cy - G.pie.R, G.pie.cx + G.pie.R, G.pie.cy + G.pie.R] : null, ebc: ST.isHex(e.eb.c) ? e.eb.c : null, ebw: e.eb.w, labelF: fm('label'), note: e.note, alt: o.alt };
    }

    // ---------- exports for the XLSX and the app ----------
    function sync() { structural(); }
    return {
      get spec() { return ED.spec; }, get out() { return out; }, get tab() { return ED.tab; }, get selected() { return ED.sel; },
      fresh, render, sync, undo, redo, key, select, setTab, snapshot: snap, change,
      push: () => { ED.hist.push(snap()); if (ED.hist.length > 200) ED.hist.shift(); ED.fut = []; syncUndo(); },
      // apply a patch as one undoable step (the Honesty tab's fixes use it)
      patch(p, extra) { change(d => Object.assign(d, clone(p))); if (extra) render(extra); },
      xlsxSpec, table: chartTable, isPie: isPieType, fonts: () => ED.fonts, themes: loadThemes, lookOf, applyLookTo,
    };
  }
  root.UnchartEditor = { init, getp, setp, TABS, ELEMENT_NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.UnchartEditor;
})(typeof window !== 'undefined' ? window : globalThis);
