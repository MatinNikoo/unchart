# Benchmark protocol

This is how the numbers in the README were made, and what they mean. The benchmark asks one question.

Does Unchart recover the numbers behind a chart to within 2% of the axis range, on charts it was not built on, and does
it say so when it can't?

## Sets

| Set | Charts | Where the charts come from | Truth | Where |
|---|---|---|---|---|
| `charts`, `charts2`, `charts3` | 60, 50, 20 | the original v1 benchmark (matplotlib, Chart.js, JPEG, truncated bars) | the data they were drawn from | three sample pictures each in the repo, the rest in the release zip |
| `dataset/synthetic-dev` | 340 | 9 renderers, 14 chart families, 7 kinds of damage | the data they were drawn from | sample in the repo, full set in the release zip |
| `dataset/synthetic-test` | 548 | same renderers with new seeds, plus looks that never appear in dev | same | sample in the repo, full set in the release zip |
| `dataset/real-owid` | 170 (40 dev, 130 test) | Our World in Data charts, picked at random from their sitemap | the CSV of exactly the data drawn in each chart | sample in the repo, full set in the release zip (CC BY 4.0) |
| FRED | 58 | FRED's own chart images of public domain series | the CSV of the same series and dates | no, fetched by `bench/real/fetch_fred.py` |
| `dataset/synthetic-test2` | 548 | test set v2, the same 14 families with new seeds, the test looks and a few new ones | the data they were drawn from | sample in the repo, full set in the release zip |
| `dataset/synthetic-families-dev`, `-test` | 112, 112 | 8 newer families drawn with matplotlib and the Excel, Sheets and slide looks | same | sample in the repo, full set in the release zip |
| `dataset/synthetic-test3`, `synthetic-families-test3` | 318, 112 | test set v3, the 14 families and the 8 newer ones with new seeds, looks no earlier set used and a random palette on a third of the charts | same | sample in the repo, full set in the release zip |

The repo keeps the truth files, the manifests and about ten sample images per set. Each full set is one zip (the largest is
split in two) on the GitHub release page, and `python3 bench/get_dataset.py` downloads and unpacks them into `dataset/`.
Counts below are charts scored, after the charts left out by the `bad_render` rule (see below).

### Synthetic charts
`bench/specs.py` writes a spec per chart with the family, the data, the renderer and the look. The renderers are
matplotlib (8 styles), seaborn (3 themes per split), Excel-like and Google Sheets-like looks (matplotlib with their fonts,
palettes and gridlines), presentation slides (big fonts, dark or tinted backgrounds), and Chart.js, Vega-Lite (with the
vega-themes design systems), ECharts and Plotly (with Plotly's own templates) drawn in headless Chromium. Every renderer
reports the axis range it actually used, so errors can be measured against the real axis.

The families are vertical bars, horizontal bars, grouped bars, stacked bars (vertical and horizontal), lines (one to four series,
dashed, with markers, on number, year, category and date axes, some on log scales, some with a second y axis), step lines,
areas, stacked areas, scatter plots (one to three series, different marker shapes), pies, donuts, histograms and bars with a line.
Value axes use plain numbers, thousands separators, currency, percent, K and M suffixes, decimals and negative ranges.

About 3% of the charts have their value axis numbers hidden. Those have `"readable": false` in the truth file, because no
reader can recover a scale that is not printed. The right answer there is to refuse.

Each chart gets one kind of damage (`bench/build.py degrade`). The kinds are none (a third of charts), JPEG at quality 30 to 70, downscaling to 50 to 75%,
Gaussian blur, pixel noise, rotation by 0.7 to 2.5 degrees, and a scan look (washed out, paper tint, small rotation, blur, noise, JPEG).

### Dev and test
Tuning only ever looked at dev. The test split uses different random seeds and also looks that never appear in dev:
matplotlib Solarize_Light2, tableau-colorblind10, seaborn-v0_8 darkgrid and ticks, seaborn colorblind, dark and bright
palettes, the Office 2007 palette, a newer Sheets palette, white and gray slides, dark and pastel Chart.js, seven
vega-themes (vox, fivethirtyeight, latimes, urbaninstitute, googlecharts, powerbi, dark), dark and vintage ECharts and four
Plotly templates (seaborn, simple_white, plotly_dark, presentation).

The test split was drawn and frozen on 2026-10-20 before any tuning, apart from the 9 test images described below, with a sha256 per image in
`dataset/synthetic-test/manifest.json` (manifest sha256 `fb00cae36a6da37a26a78ff0d9993c9652b851b51418f4b511622fb4bafcc5b5`).
The OWID set was split by a hash of each chart's slug (one in four to dev) and frozen on 2026-10-22, with manifest sha256
`d22484f042d4bed0364fb6f1553cd7cdb89860870dd97ec629ea47c2d6ef5aad`.
The confidence model and the error bar scale were fit on dev only (`bench/calibrate.py`, inputs saved in
`results/v4/calib_rules/` for the shipped fit) and frozen with the engine before the test splits were run once on 2026-10-23. The sha256 of the
frozen engine, OCR code and calibration is in `results/freeze.txt`. The only change after that is the order in which
`findCharts` lists the charts it finds on a PDF page, which is not on the benchmark path.

Two things touched the test split before that run, and I want them on record. I looked at 9 test v1 images in a contact
sheet to check whether two chart generator bugs I had found on dev (below) also hit test, so test v1 was not unseen
before tuning. And the test split has looks that dev does not, so it is harder on purpose; the confidence was fit on dev
and that shows in the results.

### Test reuse
The held out sets were not each used once. This is the full list.

| Set | Scored with | Reader changed in between |
|---|---|---|
| Synthetic test v1 | engine v1 | |
| Synthetic test v2 | engine v2 | yes, rework after v1 was seen |
| Synthetic test v3 and the newer families test v3 | engine v4 | yes, rework and a trained model |
| Our World in Data test (130) | engines v1, v2 and v4 | yes, between each run |
| FRED (58) | engines v1, v2 and v4 | yes, between each run |

The synthetic sets got a fresh draw each round, but Our World in Data test and FRED did not, because real charts can't be
redrawn. Between those runs I changed the reader, working on dev and the Our World in Data dev charts only. I did not
inspect the failures on the Our World in Data test charts or on FRED, I only read the summary rates. Even so, a reader changed
twice and scored three times on the same 188 real charts is not a clean held out result, and the gains on those two sets
(Our World in Data 30.8% to 40.0%, FRED 55.2% to 56.9%) should be read with that in mind. Only the Our World in Data gain
is large enough to mean much, and its interval is wide (see below).

The choice to ship without the mark model was made after the test v3 replays of both variants had been seen, so the
default rows are a selection on test data.

### Charts left out
Some drawn charts do not match their own data, because of a charting library quirk. They are left out by a rule on
their settings (`bad_render` in `bench/score.py`), in dev and test alike, and listed under `excluded_bad_render` in each
scored file. ECharts can only stack series on a category x axis, so its stacked areas on a number x axis came out as
broken polygons (1 dev chart, 5 test charts). Vega-Lite drew histograms whose value axis starts below zero as thin
ticks at the counts instead of bars (2 dev charts, none in test).

### Real charts
Our World in Data. `bench/real/fetch_owid.py` shuffles the grapher sitemap with a fixed seed and keeps line charts,
stacked areas, stacked bars, single bar charts and stacked horizontal bars until it has 170. For each it downloads the PNG
export and the "filtered" CSV, which holds exactly the data drawn in that chart. Charts and data are CC BY 4.0;
`truth.json` keeps each chart's title, source citation and URL. Horizontal bar charts are put in the order the chart sorts them.
These charts were designed by other people with their own conventions (unit words on axes like "80 years", labels at the
end of lines instead of legends, no value axis on bar charts), so they test generalization better than anything synthetic.

FRED. `bench/real/fetch_fred.py` fetches 64 frozen chart specs (series, dates, size) of public domain series from BLS,
BEA, Census, the Federal Reserve Board and EIA, as the PNG that FRED draws and the CSV of the same request. FRED's terms do
not allow redistributing its graphs, so these images are not in the repo. Running the script fetches them fresh;
58 of 64 downloaded when I ran it. Graphs by FRED, Federal Reserve Bank of St. Louis.

## Metrics
All computed by `bench/score.py`, per chart, then summarized. Every chart counts. A failure or refusal is never dropped.

Point error is, for each true point, the gap to the recovered value as a share of the value axis range (from the
renderer for synthetic charts; for real charts the range of the true data, including zero for bars). Bars are matched
by label when the labels were read; a bar whose label was misread takes the leftover true category in the same place in
order, so a misread name is not counted as a wrong value. Lines are compared at each true x by interpolating the
recovered line, and a true x the recovered line does not reach counts at least 50%. Scatter plots use the mean nearest
neighbour distance in both directions, scaled by both axis ranges. Pies compare shares in percentage points, by slice
name or by order around the circle. Series are matched with the Hungarian algorithm. A missing point or series counts as
100%. The chart error is the mean over its points, and a chart with no answer counts as 100%.

Histogram bins with a count of zero at either end draw nothing, so they are not scored. End bins so small that they
would be under one pixel tall are drawn by some renderers and rounded away by others, so a read with or without them
is accepted.

With a single series, stacked or grouped bars count as plain bars and a stacked area counts as an area.

These are the summary numbers.

| Metric | Meaning |
|---|---|
| Read right | right chart type, every series and point found, chart error at most 2%, whether or not the reader trusted it |
| Success | read right and marked reliable |
| Refused | no numbers came back, or they came back flagged as not reliable |
| Silent wrong | marked reliable but the type, the count or the values were wrong (error above 5%); the number that matters most for trust |
| False flag | read right but flagged as not reliable anyway |
| Wrong type | the detected chart family differs from the truth |
| Axis misread | recovered values off from the truth by a common scale or shift (slope more than 5% from 1, or offset more than 3% of the range) |
| Error bar coverage | share of true values inside the reported ± bars |
| Misleading chart flags | for bar charts, whether the "bars do not start at zero" warning fired, against the truth |
| Runtime | the whole pipeline per chart in headless Chromium, OCR included |

Charts with hidden axis numbers (`readable: false`) are kept out of these rates and reported on their own, as the share
that was refused.

## Rerun
```bash
npm ci && pip install -r requirements.txt
python3 bench/get_dataset.py   # the full benchmark charts, the repo holds ten per set
npm run bench          # builds nothing, runs every set through Chromium and scores it (roughly half an hour on 2 idle cores)
npm run bench:fred     # fetches the FRED charts first
```
`npm run bench:build` regenerates the synthetic sets from their seeds. The images are already in the repo, and the
manifests let you check that a rebuild gives the same files.

Dev numbers come from the same Chromium run, but they are in sample for the confidence model, so only the test sets
say how well it generalizes. `bench/ablate.py` replays the cached OCR on dev in node to switch parts off one at a time.

## Engine v1 on test set v1 (kept as it was)
The first frozen run, scored once on 2026-10-23. All files are in `results/v1/` (`tables.md` has every breakdown).

| Set | Charts | Read right | Success | Silent wrong | Refused | Median error |
|---|---|---|---|---|---|---|
| Synthetic test v1 | 543 | 61.0% | 36.3% | 5.1% | 58.0% | 0.32% |
| Our World in Data test | 130 | 33.1% | 9.2% | 3.8% | 86.9% | 9.78% |
| FRED | 58 | 46.6% | 24.1% | 0.0% | 70.7% | 2.16% |

That was not good enough, so I went back to work on the reader using dev and the Our World in Data dev charts only.
Synthetic test v1 has been seen now, so the next engine is scored on a brand new synthetic test set v2 made with new
seeds after the work was done. The Our World in Data test charts and FRED are scored one more time as they are.

## Engine v2 on test set v2
Between the two runs I worked on dev and the Our World in Data dev charts only, then refit the confidence model on dev
(synthetic dev, Our World in Data dev and the newer families dev) and froze the engine on 2026-10-23 at 14:23 UTC
(`results/v2/freeze.txt` has the sha256 of the engine, OCR code, calibration, scorer and the manifests). Test set v2 was
drawn before the freeze from new seeds (`seed_for("test2", ...)`), with the test looks plus matplotlib
seaborn-v0_8-pastel, grayscale and seaborn-v0_8-dark, seaborn darkgrid with the pastel palette, the Office 2013 palette,
the classic Sheets palette, the navy slide look and two more Plotly templates (gridon and xgridoff). Nothing in it was
looked at before it was scored. Each held out set was run once through Chromium and scored once.

| Set | Charts | Read right | Success | Silent wrong | Refused | Median error |
|---|---|---|---|---|---|---|
| Synthetic test v2 | 545 | 62.7% | 35.4% | 3.4% | 60.3% | 0.38% |
| Newer families test | 112 | 51.8% | 30.4% | 2.7% | 65.2% | 0.63% |
| Our World in Data test | 130 | 30.8% | 6.2% | 3.1% | 90.8% | 6.45% |
| FRED | 58 | 55.2% | 22.4% | 0.0% | 72.4% | 1.78% |

Dev for comparison, replayed in node from the cached OCR with the frozen engine (so in sample for the confidence), gives
synthetic dev 74.1% read right, Our World in Data dev 42.5%, newer families dev 51.8%. By family on synthetic dev
the read right rate runs from 38% (stacked areas) to 92% (grouped bars), far from the 99% I aimed for on every family.

One scorer change came after the freeze. One ECharts line chart in test v2 did not report the top of its axis, which
crashed the scorer, so a missing axis limit now falls back to the range of the data. Three test v2 charts are left out
by the existing `bad_render` rule. The DePlot samples are in `results/deplot_*`.


## Engine v4 on test set v3
Engine v4 adds the mark model and the dev fixes in [`results/v4/dev_progress.md`](../results/v4/dev_progress.md). I
worked on dev only, refit the confidence model on dev and froze the engine (`results/v4/freeze.txt`). Then I drew test
set v3 (`synthetic-test3` and `synthetic-families-test3`) from new seeds (`seed_for("test3", ...)`), with looks no
earlier set used and a random palette on a third of the charts, and ran it, the Our World in Data test split and the
same 58 FRED charts once through Chromium.

One thing to put on record. The first freeze had a bug that refused every pie (the pick between the two reads scored
pies with the axis model). I saw it in the dev table while the test runs were going, stopped them after about 100
test v3 charts, deleted that output without scoring it, fixed the bug, froze again and ran everything from the start.
The calibration did not change.

| Set | Charts | Read right | Success | Silent wrong | Refused | Median error |
|---|---|---|---|---|---|---|
| Synthetic test v3 | 318 | 69.8% | 42.0% | 5.6% | 51.8% | 0.30% |
| Newer families test v3 | 112 | 61.6% | 38.4% | 0.9% | 60.7% | 0.54% |
| Our World in Data test | 130 | 37.7% | 11.5% | 3.1% | 85.4% | 5.69% |
| FRED | 58 | 56.9% | 29.3% | 1.7% | 63.8% | 1.68% |

Success is read right and marked reliable. The 2% silent wrong target held on the newer families and FRED but not on
synthetic test v3 (5.6%), so the confidence check is again too trusting on looks it has not seen.

To see where the change from v3 came from, the same OCR words were replayed in node through engine v3 (as it stood
at the end of the v3 work, `results/v4/engine_v3.js` with its calibration), engine v4 without the model and engine v4 with it. These
replays were run after the scoring above and changed nothing (`results/v4/score_tests.sh`).

| Set | Engine v3 | Engine v4, no model | Engine v4 |
|---|---|---|---|
| Synthetic test v3 | 68.5% | 69.8% | 70.8% |
| Newer families test v3 | 60.7% | 64.3% | 61.6% |
| Our World in Data test | 31.5% | 40.0% | 37.7% |
| FRED | 56.9% | 56.9% | 56.9% |

Only the Our World in Data gain over v3 (31.5% to 40.0%, 130 charts) is plausibly real. On the synthetic set 68.5% against
69.8% is four charts out of 305, well inside the noise, and the newer families moved by 4 charts out of 112. The model is
a wash: one more synthetic chart in a hundred, a few fewer newer family and Our World in Data charts. It did better on dev
(74.4% against 72.9% of 480 charts), so part of its dev gain was fitting dev. Scores by family and damage are in the `by` field of each
`results/v4/*_scored.json`.

Every rate in the README has a Wilson 95% interval in [`results/intervals.md`](../results/intervals.md), made by
`bench/intervals.py` from the scored files. With 305 readable synthetic charts the interval on read right is about 10 points wide
(64.5% to 74.7%), on Our World in Data 17 points and on FRED 25. Most differences between engine versions on the real sets are
smaller than that.


## Fixes after the test scores
Two bugs turned up in the shipped tree after every score above was final, and I fixed them. The chart finder merged a pie's
legend into the chart box on `examples/ex_pie.png`, which made the app and the command line find a second chart that does
not exist, and the same warning could be listed twice. Neither changes what a chart is read as. I replayed the cached OCR
words of synthetic test v3, the newer families test v3, Our World in Data test and FRED through the fixed engine and compared
every chart with the scored run: no chart differs apart from timings and the repeated warnings, and every headline number is
identical (`results/v4/post_fix_replay.json`, made with `bench/replay_check.py`). The new hashes are at the end of
`results/v4/freeze.txt`. The only other code changed after the freeze is the display of x values such as `2020.333333`
in the table and the exports, which is outside the reader.

## Shipping without the mark model
The model is a wash on test, so the app and the command line read with the rules alone unless the experimental switch is
on. The confidence model and the error bar scale were refit on the dev reads made without the model
(`results/v4/calib_rules/`, result in `src/calibration.json`). The previous fit
is kept as `src/calibration_model.json` and is what the experimental switch uses. On dev cross validation the refit
accepts 45.8% of charts as right at 1.67% silent wrong, against 37.5% for the model.

I made this choice after I had seen the test v3 replays of both variants. It is a selection on test data, so the
rules only rows below are not a clean held out result. Both are shown, and the rules only one is the default.
`src/calibration.json` and `bench/harness.html` (then `harness.html` in the repo root) changed after the freeze above, on purpose, and the
new hashes are in `results/v4/freeze.txt`. The reader itself was the frozen one at that point.

| Set | Setting | Read right | Success | Silent wrong | Refused |
|---|---|---|---|---|---|
| Synthetic test v3 | Rules only (default) | 69.8% | 52.5% | 7.5% | 39.3% |
| | Rules only, model calibration | 69.8% | 38.0% | 3.9% | 57.7% |
| | Mark model (Chromium run) | 69.8% | 42.0% | 5.6% | 51.8% |
| Newer families test v3 | Rules only (default) | 64.3% | 44.6% | 4.5% | 50.9% |
| | Rules only, model calibration | 64.3% | 34.8% | 0.9% | 64.3% |
| | Mark model (Chromium run) | 61.6% | 38.4% | 0.9% | 60.7% |
| Our World in Data test | Rules only (default) | 40.0% | 14.6% | 4.6% | 80.8% |
| | Mark model (Chromium run) | 37.7% | 11.5% | 3.1% | 85.4% |
| FRED | Rules only (default) | 56.9% | 34.5% | 1.7% | 58.6% |
| | Mark model (Chromium run) | 56.9% | 29.3% | 1.7% | 63.8% |

The "model calibration" row is an ablation, the rules only reads judged by the confidence model fit on model reads.
It shows that most of the extra silent errors come from the refit accepting more charts, not from the reads
changing. Read right does not depend on the calibration. Rules only rows were replayed in node on the cached OCR words
(`results/v4/*_rules_scored.json`), so they match a Chromium run apart from rounding in the resized copies.
The summary is built by `results/v4/summarize.py`.
