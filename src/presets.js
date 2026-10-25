// Looks and layouts for the chart editor. A look (style) replaces everything about how the chart is drawn and keeps what it
// says. A layout only moves elements around (legend, labels, gridlines, axes) and keeps the look.
(function (root) {
  'use strict';
  // the parts of a chart spec that make up its look. Data, text, series names and added elements are not in this list.
  const LOOK_KEYS = ['theme', 'palette', 'font', 'fontCustom', 'fontSize', 'grid', 'tx', 'fm', 'bar', 'ln', 'ar', 'pie', 'lay', 'dl', 'eb', 'legend'];
  const AX_LOOK = ['show', 'ticks', 'mticks', 'grid', 'mgrid', 'lab', 'side', 'trot'];
  const bg = c => ({ chart: { fill: { t: 'solid', c } } });
  const STYLES = [
    { id: 'clean', name: 'Clean', set: {} },
    { id: 'dark', name: 'Dark', set: { theme: 'dark' } },
    { id: 'paper', name: 'Paper', set: { theme: 'print', palette: 'accent', font: 'serif' } },
    { id: 'editorial', name: 'Editorial', set: { palette: 'editorial', font: 'serif', fm: Object.assign(bg('#FFF8F0'), { grid: { line: { c: '#E6D9CE', w: 1 } }, axisX: { line: { c: '#33302E', w: 1.5 } } }), tx: { title: { size: 24, wt: 700 }, subtitle: { size: 15 } } } },
    { id: 'minimal', name: 'Minimal', set: { grid: 'none', legend: 'bottom', dl: { on: true }, ax: { y: { show: false } }, fm: { axisX: { line: { c: '#BDBDC4', w: 1 } } } } },
    { id: 'bold', name: 'Bold', set: { palette: 'vivid', font: 'rounded', fontSize: 16, ln: { w: 4, size: 11, mk: 'on' }, bar: { gap: 25 }, tx: { title: { size: 28, wt: 800 } } } },
    { id: 'pastel', name: 'Pastel', set: { palette: 'pastel', bar: { rad: 6, gap: 50 }, fm: bg('#FBFAF7') } },
    { id: 'soft', name: 'Soft', set: { bar: { rad: 8, gap: 50 }, fm: { bars: { fill: { t: 'grad', ang: 90 }, shadow: { on: true, dy: 3, blur: 6, tr: 75 } }, plot: { fill: { t: 'solid', c: '#F4F6FB' } }, chart: { rad: 12 } } } },
    { id: 'glass', name: 'Glass', set: { palette: 'sunset', ar: { tr: 40 }, fm: { areas: { fill: { t: 'grad', ang: 90, tr: 20, tr2: 95 } }, lines: { shadow: { on: true, dy: 2, blur: 4, tr: 70 } } } } },
    { id: 'blueprint', name: 'Blueprint', set: { font: 'mono', palette: 'colorblind', fm: Object.assign(bg('#0B3D91'), { grid: { line: { c: '#4F7BC4', w: 1, dash: 'dot' } } }) } },
    { id: 'terminal', name: 'Terminal', set: { font: 'mono', palette: 'vivid', fm: Object.assign(bg('#06100A'), { grid: { line: { c: '#17361F', w: 1 } } }), tx: { title: { c: '#5BFF8A' } } } },
    { id: 'hatched', name: 'Hatched', set: { palette: 'ink', fm: { bars: { fill: { t: 'pat', pat: 'diag' }, line: { w: 1.5 } }, areas: { fill: { t: 'pat', pat: 'horz', tr: 0 } } } } },
    { id: 'grayscale', name: 'Grayscale', set: { palette: 'ink', font: 'serif', theme: 'light' } },
    { id: 'contrast', name: 'High contrast', set: { palette: 'colorblind', fontSize: 16, ln: { w: 4, size: 10, mk: 'on' }, fm: { grid: { line: { c: '#8A8A92', w: 1 } }, axisX: { line: { c: '#16161A', w: 2 } } }, bar: { gap: 30 } } },
  ];
  const LAYOUTS = [
    { id: 'standard', name: 'Standard', set: { legend: 'top', grid: 'value', dl: { on: false } } },
    { id: 'direct', name: 'Direct labels', set: { legend: 'bottom', grid: 'none', dl: { on: true }, ax: { y: { show: false } } } },
    { id: 'right', name: 'Legend at right', set: { legend: 'right', grid: 'value' } },
    { id: 'bottom', name: 'Legend below, labels', set: { legend: 'bottom', dl: { on: true }, grid: 'value' } },
    { id: 'grid', name: 'Full grid', set: { grid: 'both', ax: { x: { ticks: 'out' }, y: { ticks: 'out', mticks: 'out', mgrid: true } } } },
    { id: 'axes', name: 'Axis lines and ticks', set: { grid: 'none', ax: { x: { ticks: 'out' }, y: { ticks: 'out' } }, fm: { axisY: { line: { c: '#9A9AA2', w: 1 } } } } },
    { id: 'slides', name: 'Slides', set: { fontSize: 18, dl: { on: true }, legend: 'bottom', width: 1200 } },
    { id: 'compact', name: 'Compact', set: { fontSize: 11, legend: 'none', width: 640, grid: 'value' } },
    { id: 'pie-out', name: 'Pie, labels outside', pie: true, set: { legend: 'none', dl: { on: true, cat: true }, pie: { lab: 'outside', leader: true } } },
    { id: 'pie-in', name: 'Pie, labels inside', pie: true, set: { legend: 'right', dl: { on: true, cat: false }, pie: { lab: 'inside' } } },
    { id: 'donut-c', name: 'Donut with center', pie: true, set: { legend: 'right', dl: { on: true }, pie: { lab: 'inside', hole: 62, center: 'Total' } } },
  ];
  // what a style resets before it is applied. Labels and the legend belong to the layout, so a style leaves them alone.
  const RESET_KEYS = LOOK_KEYS.filter(k => !['dl', 'legend', 'eb'].includes(k));
  root.UnchartPresets = { LOOK_KEYS, RESET_KEYS, AX_LOOK, STYLES, LAYOUTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.UnchartPresets;
})(typeof window !== 'undefined' ? window : globalThis);
