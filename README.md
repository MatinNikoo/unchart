# Unchart

Paste a picture of a chart and get the numbers back.

![Unchart](social.png)

I kept retyping numbers off charts in PDFs and slides, so I built this. It reads the axis labels, fits the scale, traces the lines, bars and dots, and gives you a table you can paste into Sheets. It also flags charts that are drawn to mislead and can redraw them honestly. Everything runs in the browser, nothing gets uploaded.

**Try it** at [matinnikoo.github.io/unchart](https://matinnikoo.github.io/unchart/)

Besides the table, it can project a trend with a 90% band, point out where two series cross, and export to CSV, Python, R or JSON. If it misreads a point you can drag it back into place.

## Accuracy

I tested it on 130 charts with known numbers, made with matplotlib, Chart.js and compressed JPEG screenshots so it isn't tuned to one look. Error is the average gap between recovered and true values, as a share of the axis range.

| Set | Charts | Median error | Worst chart |
|---|---|---|---|
| matplotlib, six styles | 60 | 0.23% | 0.88% |
| Chart.js and JPEG screenshots | 50 | 0.17% | 0.81% |
| Bar charts for the honesty check | 20 | 0.05% | 0.38% |

It caught all 10 bar charts that skip zero and didn't flag any chart that was fine. A chart takes about a second.

## How it works

Normal OCR struggles with tick labels, so Unchart finds the small glyphs itself, puts them all on one clean sheet and reads them in one pass with tesseract.js. Each label is snapped to its tick mark, then the axis is fit with a line that ignores misreads. Colors in the plot become series. Lines are traced and snapped back to their real data points, and bars are measured down to a fraction of a pixel.

To rerun the benchmark

```bash
npm install && npx playwright install chromium
npm run serve
node run.js && python3 score.py results_charts.json
```

## Limits

Horizontal, stacked and pie charts aren't supported yet. Two series in nearly the same color get merged, and the axes need visible numbers.

## License

MIT. tesseract.js and pdf.js are Apache 2.0. The bundled `vendor/worker.min.js` has a one line fix for a tesseract.js 5.1.1 bug when the language model is passed in directly.
