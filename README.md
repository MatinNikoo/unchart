# Unchart

Paste a picture of a chart and get the numbers behind it back.

People retype numbers off charts all the time. They come from a PDF report, a slide, a paper, a screenshot of a dashboard, and the data itself is nowhere to be found. Unchart reads the chart the way a person would. It finds the axis labels, works out the scale, follows every line and measures every bar. Then it gives you a table you can paste into Sheets, says what the numbers show, and tells you if the chart is designed to mislead.

It all runs in your browser. Your image never leaves your computer.

**Try it** at [matinnikoo.github.io/unchart](https://matinnikoo.github.io/unchart/)

## What it does

* **Gets the data back.** Line charts, bar charts and scatter plots, with several series told apart by color. For line charts it finds the actual data points, not just a trace, so a yearly chart comes back as one row per year.
* **Rebuilds the chart on top of the original.** What it found is drawn in magenta over your image, so you can see right away that it matched.
* **Says what the numbers show.** Change, yearly growth, high and low, biggest drop, trend strength, correlation for scatter plots.
* **Checks if the chart is honest.** Bars that skip zero (with how much bigger the gaps look than they are), two y axes, log scales and zoomed in axes.
* **Redraws it honestly.** The Remake tab draws a clean version from the recovered numbers as a line, area or bar chart, in three looks. A chart that skipped zero animates down to a fair baseline so you watch the gaps shrink to their real size. Copy it as an image or save a PNG.
* **Projects where it's heading.** A straight line or steady growth fit carries the trend forward with a 90% band, and says how much of the past movement it explains. For scatter plots it draws the fitted line and where 90% of new points would land.
* **Finds the moments.** When one series crosses another, and the biggest single move in each.
* **Lets you drag a point back.** If it misread something, grab the point on the chart and pull it into place. The table, reading and remake all update.
* **Measures anything you hover.** A crosshair shows the x and y value under your cursor.
* **Exports anywhere.** Sheets or Excel, CSV, Python (pandas), R, Markdown and JSON.
* **Lets you fix things.** Any number or series name in the table can be edited, and the overlay and insights update.
* **Works on PDFs.** Open a PDF, go to the page, drag a box around the chart.

## How well it works

I tested it on 130 charts where I know the true numbers, made three different ways so it isn't tuned to one look. That's 60 charts from matplotlib in six styles, 30 from Chart.js, 20 compressed and shrunk JPEG screenshots, and 20 bar charts for the honesty check. The error is the average distance between the recovered and true values, as a share of the axis range.

| Set | Charts | Median error | Worst chart | Exact number of points |
|---|---|---|---|---|
| matplotlib, six styles | 60 | 0.23% | 0.88% | 90% of line charts, all bar charts |
| Chart.js and JPEG screenshots | 50 | 0.17% | 0.81% | 96% of line charts, all bar charts |
| Bar charts for the honesty check | 20 | 0.05% | 0.38% | all |

On the honesty set it caught all 10 bar charts whose axis skips zero and raised no false alarms on the other 10. Across all 130 charts it never flagged a chart that was fine.

Every one of the 130 charts came back within 1% of the true values, and the median error is 0.17%, about a third of a pixel on a typical chart. A chart takes about one second. Reading the text is most of that. The tracing itself takes under a tenth of a second.

Here is how to rerun everything.

```bash
npm install
npx playwright install chromium
npm run serve            # in one terminal
node bench/run.js        # in another, then
python3 bench/score.py results_charts.json
DIR=charts2 node bench/run.js && DIR=charts2 python3 bench/score.py results_charts2.json
```

## How it works

**Reading the labels.** Regular OCR is bad at charts. Tick labels are tiny, often a single digit, and sit next to gridlines it mistakes for text. So Unchart finds the glyphs itself. It looks for small dark shapes that aren't part of long lines, judging each against its own surroundings so gray labels on gray panels still count, and groups them into labels. Then it pastes every label, enlarged and cleaned up, onto one blank sheet and reads them all in a single pass with tesseract.js, using a reader that only knows number characters. Labels on dark charts get flipped one by one.

**Fitting the scale.** OCR boxes land a pixel or two off, so each label is first snapped to the tick mark or gridline beside it, which sits exactly on its value. That one step roughly halved the error. The numbers on each axis are fit with a robust line that ignores misreads, so one label read as 20M instead of 2011 doesn't matter. It also fixes the usual OCR slips. A minus sign that went missing, a 09 that lost its decimal point, a 4.000 that should be 4,000. It detects log scales and refuses any reading where values grow downward.

**Tracing the data.** Colors inside the plot are grouped into series, and faint anti-aliased edges are merged back into the line they belong to. Lines are followed column by column, always taking the run that continues the line, so crossings and legends don't pull it off course. Then it tries grids of x values from coarse to fine and keeps the coarsest one whose straight segments reproduce the drawn line. That's how it gets the real data points back. Bars are measured as rectangles standing on a shared baseline, and the half-covered row at the top of each bar is read to a fraction of a pixel, and a category with no bar is a zero. Dots are counted, and overlapping dots are split by size.

**The honesty check** compares how big the differences look with how big they are. If bars stand on 40 instead of 0, a bar that is 15% taller can look twice as tall, and it says so.

## Files

| Path | What it is |
|---|---|
| `index.html` | The app |
| `src/engine.js` | Scale fitting, tracing, honesty checks and insights. No dependencies |
| `src/ocr.js` | Finding and reading the labels |
| `src/remake.js` | Clean redraws, honest baselines and projections |
| `vendor/` | tesseract.js and its English model, and pdf.js. Bundled so nothing loads from elsewhere |
| `bench/` | Test chart makers, the true data, the runner, the scorer and saved results |
| `examples/` | The three example charts (made up data) and their saved results |

One note on `vendor/worker.min.js`. tesseract.js 5.1.1 has a bug when you hand it the language model directly instead of a URL (it joins the model's bytes where it should join its name). The bundled copy fixes that one line.

## Limits

* Horizontal bars, stacked bars, pie charts and area fills aren't supported yet.
* Two series in nearly the same color will be read as one.
* The axes need visible numbers. A chart with no tick labels has no scale to read.
* Dates written as words (Jan, Feb) come back as categories, not dates.

## What's next

A browser extension, so you can right click any chart on any page. Batch mode for long PDFs with many charts. Horizontal and stacked bars.

## License

MIT. tesseract.js and pdf.js are Apache 2.0.
