# Dev progress, engine v3 (dev splits only)

Everything here is on the dev splits. That means synthetic-dev (328 readable charts), synthetic-families-dev (112) and
the dev split of the Our World in Data set (40). Test v2 and the OWID test split were not opened or run for any of this.
Read right means the right chart type, every series and point found, and error within 2%, whether or not the
confidence check accepted it. Numbers are node replays of the cached OCR (`bench/run_node.js`), causes come from
`bench/breakdown.py`, and the tables come from `python3 bench/dev_table.py <tags>` over the step files (one per tag, kept in `results_extra` on the release page).

## Where v2 went wrong

`results/v3/failure_breakdown.json`. Of 480 readable dev charts, v2 read 318 right (66%) and 152 of those were refused
by the confidence check. The 162 wrong reads split like this.

| cause | charts |
|---|---|
| marks (points missing, extra or off, with the axis fine) | 89 |
| labels (no value axis 28, right axis 12, x labels 11, value axis scale 4) | 55 |
| chart type | 18 |

My first count put labels on top (78 against 66), but that was wrong. The scorer flags an axis error whenever the read
values share a scale or a shift, and a few far off points fake that. Now a chart only counts as an axis error when one
scale and shift fixes at least 80% of its points. With that check marks is the biggest bucket, not labels.

## What I changed, one step at a time (read right %)

| family | v2 | + slope and dual axis rules | + PP-OCR | + 100% stacked fill |
|---|---|---|---|---|
| area | 68.2 | 68.2 | 77.3 | 77.3 |
| bar | 84.6 | 84.6 | 92.3 | 92.3 |
| bar_line | 63.6 | 63.6 | 63.6 | 63.6 |
| donut | 87.0 | 87.0 | 87.0 | 87.0 |
| grouped_bar | 92.3 | 92.3 | 92.3 | 92.3 |
| hbar | 82.6 | 82.6 | 73.9 | 73.9 |
| histogram | 75.0 | 75.0 | 75.0 | 75.0 |
| line | 73.1 | 73.1 | 73.1 | 73.1 |
| pie | 78.3 | 78.3 | 82.6 | 82.6 |
| scatter | 72.0 | 72.0 | 72.0 | 72.0 |
| stacked_area | 38.1 | 38.1 | 42.9 | 42.9 |
| stacked_bar | 78.3 | 78.3 | 78.3 | 78.3 |
| stacked_hbar | 68.2 | 68.2 | 81.8 | 81.8 |
| step | 68.2 | 68.2 | 77.3 | 77.3 |
| **synthetic-dev** | **74.1** | **74.1** | **76.8** | **76.8** |
| bubble | 42.9 | 42.9 | 50.0 | 50.0 |
| dot_plot | 14.3 | 14.3 | 14.3 | 14.3 |
| dual_axis | 14.3 | 35.7 | 42.9 | 42.9 |
| errorbar | 85.7 | 85.7 | 92.9 | 92.9 |
| lollipop | 50.0 | 50.0 | 50.0 | 50.0 |
| slope | 35.7 | 42.9 | 42.9 | 42.9 |
| stacked100 | 71.4 | 71.4 | 71.4 | 92.9 |
| waterfall | 100.0 | 100.0 | 100.0 | 100.0 |
| **families-dev** | **51.8** | **55.4** | **58.0** | **60.7** |
| **OWID dev** (5 families, 28 of 40 are lines) | **42.5** | **42.5** | **42.5** | **42.5** |

Tags in the step files, in column order, are base, base3, v3a, v3b. The same PP run read in Chromium (tag chromium)
gives 76.8 / 61.6 / 42.5. All dev charts together go from 318 to 337 read right out of 480 (66.3% to 70.2%).
Label failures drop from 55 to 29 (`results/v3/failure_breakdown_after.json`).

What each step is
* Slope charts. When most lines run straight between the same two x positions, a line that was partly hidden gets
  its two ends from the straight fit through what was traced.
* Dual axis. When the right axis labels are gray, or their color only loosely matches one series, I guess the usual
  layout (bars left and line right, or the second series right). The dual axis issue stays on, so these reads are
  never marked reliable. They are only right more often.
* PP-OCR. The PP-OCRv5 English mobile recognizer reads every label box next to tesseract, in the browser with
  onnxruntime-web. Where the two disagree, the reading that sits on the straight (or log) line through the labels of
  the same column or row wins, and otherwise PP wins. PP readings under 80% confidence are dropped, because those are
  mostly specks and bits of lines read as 1 or 7. A PP reading of a whole word label at 97% or more replaces the
  tesseract words in that box.
* 100% stacked fill. When most columns of a percent stacked chart add up to 100, a column with exactly one missing
  segment (under the legend, usually) gets that segment back as 100 minus the rest.

## OCR variants I tried (node replay, read right %)

`results/v3/ocr_variants.txt`. Same engine for all of them.

| variant | synthetic-dev | families-dev | OWID dev |
|---|---|---|---|
| tesseract only | 74.1 | 55.4 | 42.5 |
| PP, conf floor 70 | 76.5 | 57.1 | 42.5 |
| PP, conf floor 80 | 76.8 | 57.1 | 42.5 |
| PP, conf floor 90 | 76.5 | 57.1 | 42.5 |
| PP floor 80 + PP word labels (kept) | 77.1 | 57.1 | 42.5 |
| same with a Lanczos resampler | 76.5 | 57.1 | 42.5 |
| same with per label Otsu binarization | 75.0 | 53.6 | 42.5 |
| ties go to tesseract | 75.6 | 57.1 | 42.5 |

PP with no confidence floor at all made line charts worse, since every short line piece came back as a number. The
resampler barely matters (bicubic and Lanczos are one chart apart). Binarizing each label hurts, it throws away the
anti aliasing the model was trained on. PP also costs a few labels tesseract had right (two hbar charts, a percent
axis where PP read 80% as 8094), so the merge is a net gain, not a free one.

## Re-render and compare

I added a redraw check (`renderFit` in the engine). It draws each read series back onto the plot box and measures how
much of that series' color it covers and how much of the drawing lands on that color. As a feature for the confidence
model it did not help. Cross validated accepted right at most 2% silent wrong went from 36.3% without it to 33.1%
with both parts, and 37.3% with only the coverage part (`results/v3/rr_ablation.txt`). That is inside the noise of 480 charts, so I left it out
of the model. The features are still in the output for debugging. It fails mostly where a plain one color redraw is
the wrong picture, like waterfalls, translucent areas and lines with big markers.

What did raise auto accept was refitting the confidence model on the new reads. With 5 fold cross validation on dev, at
the same 2% silent wrong target, accepted right went from 32.7% (v2 calibration) to 39.8% (`src/calibration.json`,
threshold 0.88). The in sample accepted numbers in `dev_table.txt` are higher than that, but they are fit on the same
charts, so the cross validated number is the one to trust.

## Old regression sets

charts, charts2 and charts3 read in Chromium with PP on, scored with the v1 metric. Median error 0.17%, 0.16% and
0.05% against 0.16%, 0.16% and 0.05% for v2, all within 2% (`results/v3/old_sets/`).

## Where this tops out

Dev gains flattened after these steps. Each new rule I looked at fixes one or two charts, and the hard cases left are
not one problem.
* Marks are now 95 of the 143 wrong reads. Most are one off failures. Two series swapped in two columns of a stacked
  bar, a legend sitting on the top segment, bubbles that overlap, lines of close colors crossing, sloped lines cut by
  their own end labels. On OWID dev it is almost all line charts with 6 to 11 colored lines and labels at their
  ends, and none of the OCR work moved it.
* Labels are down to 29. Dates on the x axis are most of what is left, along with right axis labels the box finder
  never sees.
* Type errors (19) are mostly scans and downscaled pictures where the thin white gaps between bars blur away and the
  bars read as one area. I tried reading those again as a histogram and the bar reader still saw one shape, so I
  took that rule out.

My estimate is that this engine design can reach roughly 85% read right on clean and mildly degraded synthetic
charts with a lot more case by case work, and around 60% on OWID style multi line charts. Getting to 99% per family
would need a learned mark extractor (a segmentation model that gives a mask per series) instead of color clustering
and hand rules, plus a date aware reader for x labels. With 14 to 26 dev charts per family, a single chart is 4 to 7
points, so 99% can not even be measured on these splits. Showing it would take a few hundred dev charts per family.
