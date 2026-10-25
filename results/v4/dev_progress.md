# Dev progress, engine v4 (dev splits only)

Same dev splits as v3. Synthetic-dev (328 readable charts), synthetic-families-dev (112) and the dev split of the Our
World in Data set (40). Read right means the right chart type, every series and point found, and error within 2%,
whether or not the confidence check accepted it. Numbers are node replays of the cached OCR (`bench/run_node.js`, with
`SEG=vendor/seg/unchart_marks.onnx` for the model), causes from `bench/breakdown.py`, tables from
`STEPS=<step files> python3 bench/dev_table.py <tags>` (the step files are in `results_extra` on the release page). The one command for a tag is `sh bench/devrun.sh <tag>`.

## The plan and what happened

v3 stopped at 70.2% read right on all 480 dev charts, and the biggest bucket of wrong reads was marks (lines crossing,
close colors, series split or merged). So I trained a model to find the series instead of grouping pixels by color.

### Training data
`bench/seg/gen.py` draws charts with the same matplotlib renderers as the benchmark, then draws each chart again with one
group of artists hidden at a time (each series, the text, the gridlines and axes, the legend). The group whose hiding
changes a pixel the most owns it, so every pixel gets a label for what is on top. `bench/seg/gen_web.js` does the
Chart.js, Vega-Lite, ECharts and Plotly charts by drawing each series again in a far away color, since hiding things
there moves the layout. In those charts text and gridlines are not told apart, so they only teach series against not
series. Then the same damage as the benchmark (JPEG, blur, noise, downscale, rotation, scans), and for the second half
of the data two kinds of damage in a row.

22,000 charts in all. 16,000 matplotlib based (half of them a harder mix with more Our World in Data style line charts,
up to 12 lines with labels at their ends, and palettes with near twin colors) and 6,000 web. Their seeds are
`unchart-train-<n>`, they use only the dev looks plus random palettes, and nothing from a test set or derived from one.

### Model
`bench/seg/model.py`, a small U-Net. It starts at half resolution, goes down to 1/16, and comes back up with a few full
resolution features for thin lines and small text. 773K parameters, 3.1 MB as ONNX (fp32). Two heads, a class per
pixel (background, series, text, gridline, legend swatch) and an 8 number embedding trained with the discriminative
loss of De Brabandere et al. (2017), so pixels of one series sit close and different series sit apart. Trained 20,000
steps of 8 crops (192 px) on 2 CPU cores, about 6 hours. The loss curve is `results/v4/train_log_b.csv`.

![training](../../docs/img/mark_model_training.png)

An earlier smaller model (552K, `results/v4/train_log.csv`) never learned the text and gridline classes. It shared one
last layer between the classes and the embedding and weighted series pixels three times. Splitting the heads, weighting
text and gridlines up and centering a quarter of the crops on them fixed that.

### How good the model is on its own
`bench/seg/eval_pix.py` on 150 held out training charts (every 40th chart is held out, whole pictures)
(`results/v4/seg_val.json`).

| class | IoU |
|---|---|
| background | 0.978 |
| series | 0.945 |
| text | 0.600 |
| gridline | 0.510 |
| legend swatch | 0.000 |

The series mask is good. Text and gridlines are thin and the model only half finds them, and legend swatches it never
predicts. The grouping is the weak part. A true series has on average 88% of its pixels in its best matching group, but
only 61% of series have more than 90% there. Pixels of one series spread out in the embedding, mostly on anti aliased
edges and on Our World in Data style charts with ten or more lines. A fine tune with four times the weight on the
embedding loss (4,000 more steps, `results/v4/train_log_c.csv`) did not move it, so I kept the main run.

![example](../../docs/img/mark_model_example.png)

### How the reader uses it
Using the model's groups straight as the series (`segMode: 'full'`) was worse than the color rules overall, 68.3% on
synthetic dev against 79.9%, because the color rules split a chart with clean distinct colors perfectly and the model
sometimes cuts one series in two. It was better on bubbles, lollipops, dot plots, slope charts and error bars. So the
reader now does both.

1. The color rules, with two checks from the model. Pixels the model calls text or a legend swatch are not series ink.
   Two color groups the model sees as one series join (a line and its lighter rim), and one color group the model sees
   as two series splits, but only when the two parts touch for less than 15% of their pixels (two lines of one color
   only touch where they cross, a line on top of its own fill touches everywhere).
2. The model's own groups.

Both reads go through the same measuring, and the one the confidence model trusts more is kept. Whether the two reads
agree is a new confidence feature, and a strong one.

### Other fixes on dev (no model)
* Pies. On scans one slice color can split into two shades that flip back and forth around the circle. Shades that
  flip like that are merged. Slivers under 2 degrees, or under 3 in a color no slice has or that is a blend of its two
  neighbours, go to the neighbours. Pies and donuts went from 82.6% and 87.0% to 100% on dev.
* Lollipops whose stem and dot came apart under JPEG are put back together.
* Dot plots against month names are read as categories, not as a time axis.
* Slanted dates that OCR splits into "2016-" and "05" are joined again, a cut date marks the x labels as weak so they
  get read again rotated, and Vega-Lite's "Thu 02" day labels parse.
* Year axes. Our World in Data data is yearly, and a coarser grid passes the fit test whenever the line is flat
  between its points. On a year axis spanning at least six years the one year grid now wins when it fits.

## Results (read right % / accepted right %, in sample)

`results/v4/dev_table.txt`. base is engine v3. rules5 is v3 plus the fixes above except the year grid. v4noseg is the
final engine without the model, v4d the final engine.

| family | v3 | rules5 | v4 no model | v4 |
|---|---|---|---|---|
| synthetic-dev (328) | 76.8 | 79.6 | 79.6 | 79.3 |
| families-dev (112) | 60.7 | 63.4 | 63.4 | 68.8 |
| OWID dev (40) | 42.5 | 42.5 | 45.0 | 50.0 |
| all 480 | 70.2 | 72.7 | 72.9 | 74.4 |

Per family rows are in `dev_table.txt`. The model helps where the color rules group wrong: bubbles 50.0 to 71.4,
slope charts 42.9 to 57.1, lollipops 57.1 to 64.3, Our World in Data lines 50.0 to 57.1, stacked areas 47.6 to 57.1,
histograms 75.0 to 83.3. It hurts bars with a line (63.6 to 54.5), grouped bars (92.3 to 84.6) and synthetic line
charts (76.9 to 73.1), where a confident model read beats a right color read.

Accepted right at most 2% wrong and accepted, 5 fold cross validated on dev, is the number to use for the confidence
check. With the model it is 37.5% (the calibration log of that round), down from 39.8% for v3. The same check fit on the
reads without the model gives 45.8% (a dry run). So the model gets more charts right but makes
the confidence check's job harder, because picking between two reads adds a second way to be confidently wrong. I kept
the model in the frozen engine since more right reads is what the plan was for, and the test results below show both.

The calibration was fit on dev reads that were themselves made with an earlier calibration (round files in `results_extra`),
so the pick between the two reads at fit time is close to the pick at run time. The error bar scale comes from the
uncalibrated reads (also in `results_extra`) and now counts every chart once, not every point once, since a single Our World
in Data chart with a thousand yearly points otherwise set it alone. It came out at 2.28.

## Where this tops out

Read right went from 70.2% to 74.4% on dev, most of it from rules. The model's part is about seven charts out of 480.
It is not near 99%, and I do not think this design gets there. What is left (the `bk_v4d` step files) is
spread thin. Too many or too few points when no data grid fits (noise, scans, x labels read wrong), bars blurred into
one shape and read as an area, values a little over 2% off on stacked bars, series hidden under other series, tick
labels that never read. Each fix I tried in the last rounds moved one or two charts. Getting much higher would take a
reader that is learned end to end, which needs a GPU, or a lot more case by case rules.

## Shipping without the model

On test the model was a wash (see the README), and it costs 1.7 seconds and 3.1 MB. The default is now the rules alone. The
confidence model and the error bar scale were refit on dev reads made without the model (`results/v4/calib_rules`). Dev cross validation accepted 45.8% of charts as right at 1.67% silent wrong, against 37.5% with the model.
The cut came out at 0.85 and the error bar scale at 2.414. The model stays as an experimental switch with its own calibration,
`src/calibration_model.json`.

The choice was made after the test v3 replays of both variants had been seen, so it is a selection on test data. The default
accepts more charts and is wrong on more of them than the model run was (synthetic 7.5% against 5.6%). Both are in the README.
