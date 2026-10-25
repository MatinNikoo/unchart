# Unchart chart benchmark

Charts with the exact numbers behind them, for scoring any tool that turns a chart image back into data.
I made it to test Unchart, but nothing in it is specific to Unchart. The protocol and metrics are in
[`docs/benchmark.md`](../docs/benchmark.md), and `bench/score.py` scores any results file in the format below.

| Folder | Charts | Source | License |
|---|---|---|---|
| `synthetic-dev` | 340 | drawn by `bench/` with matplotlib, seaborn, Chart.js, Vega-Lite, ECharts and Plotly | MIT, like the rest of the repo |
| `synthetic-test` | 548 | same, new seeds and looks held out from dev | MIT |
| `synthetic-test2` | 548 | the same 14 families drawn again with new seeds, plus a few looks used nowhere else (test set v2) | MIT |
| `synthetic-families-dev` | 112 | 8 newer families (100% stacked bars, lollipops, dot plots, slope charts, waterfalls, bubbles, bars with error bars, two y axes) drawn with matplotlib and the Excel, Sheets and slide looks | MIT |
| `synthetic-families-test` | 112 | the same 8 families with new seeds and the test looks | MIT |
| `synthetic-test3` | 318 | the 14 families again for engine v4 (test set v3): new seeds, looks no earlier set used (matplotlib petroff and seaborn-v0_8 colorblind, muted, white, poster and bright, Office 2019, a retro Sheets palette, a charcoal slide, Vega carbon themes) and a random palette on a third of the charts | MIT |
| `synthetic-families-test3` | 112 | the 8 newer families with the test v3 seeds and looks | MIT |
| `real-owid` | 170 | Our World in Data grapher charts (`split` field: 40 dev, 130 test) | CC BY 4.0, Our World in Data and the sources named in each chart |

The mark model's training charts (`bench/seg/gen.py` and `bench/seg/gen_web.py`, 22,000 charts with a label for every
pixel) are not in the repo, they rebuild from their seeds in a few hours. They use the dev looks and random palettes
only, with seeds of their own (`unchart-train-<n>`), so nothing from a test set is in them.

FRED charts are scored too but are not included, because FRED's terms do not allow redistributing its graphs.
`bench/real/fetch_fred.py` downloads them for yourself.

## Getting the full sets
This folder holds the truth file, the manifest and ten sample pictures of each set, so you can look at them and check the format.
The full sets are zips (each under 24 MB, 175 MB in all) on the GitHub release `dataset-v1`. `python3 bench/get_dataset.py`
downloads them, checks them against the sha256 in `release.json` and unpacks them here. `python3 bench/get_dataset.py synthetic-test3`
fetches one set. `release.json` also lists `legacy-charts`, the pictures of the three first version sets in `charts/`,
`charts2/` and `charts3/`. The undamaged renders the synthetic images were made from (`raw/`) are not in the release,
`bench/build.py` draws them again from `specs.json`.

## Files
Each folder has `images/`, `truth.json` and `manifest.json` (a sha256 for every image and for the truth file, so you can
check that you are scoring the same frozen set). The synthetic folders also have `specs.json`, the full recipe for every
chart, and `bench/build.py` rebuilds them from it.

## Truth format
`truth.json` is a list with one entry per chart, like this one.

```json
{
  "file": "d0012.png",
  "family": "line",
  "xkind": "date",
  "x": ["2019-01-01", "2019-02-01", "..."],
  "series": [{"name": "Revenue", "y": [12.5, 13.1, "..."], "axis": "left"}],
  "readable": true,
  "ylog": false,
  "renderer": "plotly", "look": "plotly_dark",
  "degradation": {"kind": "jpeg", "q": 41},
  "render": {"vlim": [0, 40]}
}
```

- `family`: one of `bar`, `hbar`, `grouped_bar`, `stacked_bar`, `stacked_hbar`, `line`, `step`, `area`, `stacked_area`,
  `scatter`, `pie`, `donut`, `histogram`, `bar_line`, and in the families sets `stacked100`, `lollipop`, `dot_plot`, `slope`,
  `waterfall` (each value is the signed change of its bar), `bubble` (series carry a `size`, not scored), `errorbar` (series
  carry an `err`, not scored) and `dual_axis`.
- `xkind`: `num`, `cat` (labels in `x`) or `date` (ISO dates). Series can carry their own `x` (scatter plots, OWID lines
  where countries cover different years).
- Bars are listed in the order they are drawn: left to right, or top to bottom for horizontal bars.
- Stacked charts list each segment's own value, not the running total.
- Pies list the raw values; shares are the values over their sum.
- Histograms: `x` holds the bin edges and `series[0].y` the counts.
- `render.vlim` is the value axis range the renderer drew (`vlim_right` for a second axis, `xlim` for scatter x).
- `readable: false` marks the few charts whose value axis numbers are hidden on purpose. No tool can read those, and the
  right answer is to say so.
- OWID entries add `slug`, `title`, `citation`, `source` and `license`.

## Known bad charts
ECharts can only stack series on a category x axis. The ECharts stacked area charts with a number x axis came out as
broken polygons that do not match their data (I found this on dev chart `d0278`). `bench/score.py` leaves out every
chart with `renderer: echarts`, `family: stacked_area` and `xkind: num` by that rule, and lists them under
`excluded_bad_render` in its output. The same goes for Vega-Lite histograms whose value axis starts below zero, which
came out as thin ticks at each count instead of bars (dev `d0240`). That is 3 dev charts and 5 test charts in all. They
stay in the folders so the manifests do not change.
Histogram end bins that would be under a pixel tall are drawn by some renderers and rounded away by others, so a read
with or without them counts as right.

## Results format
`bench/score.py <folder> <results.json>` reads a JSON object keyed by file name, like this one.

```json
{"d0012.png": {"ok": true, "chartType": "line", "reliable": true, "confidence": 0.91,
  "series": [{"name": "Revenue", "type": "line", "points": [{"x": "2019-01-01", "y": 12.4, "px": 81.5, "py": 300.2}]}]}}
```
`px` is the point's horizontal pixel position, used to order points along a line. A tool that never refuses can set
`reliable: true` everywhere, and one with no chart type can leave `chartType` empty (it then fails the type check, so
compare such tools on success without the type, as the README does for DePlot).

## Attribution
Our World in Data charts are by Our World in Data (ourworldindata.org), licensed CC BY 4.0. Each chart's original data
source is in its `citation` field.
