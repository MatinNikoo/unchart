# How Unchart reads a chart

This is the longer version of the "how it works" part of the README. The numbers it refers to are in
[`results/tables.md`](../results/tables.md), made by `bench/report.py`, and the benchmark rules are in
[`benchmark.md`](benchmark.md).

I wanted to find out whether a reader that runs entirely in the browser, with plain image processing and an off the
shelf OCR, can get the numbers back out of a chart to within 2% of the axis range, and whether it can tell when it can't.
The second half matters more to me. A tool that is wrong 5% of the time and never says which 5% means you have to
check every number again before it goes into a spreadsheet.

## Pipeline

Everything below is in `src/ocr.js` (text) and `src/engine.js` (everything else). In headless Chromium on two CPU cores a chart takes a median of 2.3 seconds on the synthetic test set, 4.7 seconds on Our World in Data and 3.0 seconds on FRED with the default reader, most of it OCR (`results/timing.json`, measured by `bench/timing.py` on a sample of each set). The mark model adds 1.7 to 2.3 seconds (the median of its own step, by set).

### Straighten
A photo or a scan is rarely level. `deskew` finds the small rotation that makes the long straight lines in the picture
(axes, gridlines, bar edges) line up with the pixel grid and rotates the picture back. For a phone photo of a screen the
app also has a four corner tool that warps the chart back to a rectangle (a homography).

If the picture is grainy, a hybrid median filter cleans it first. It takes the median of the plus shaped and x shaped
neighbours and the pixel itself, which removes specks like a normal median filter but keeps one pixel lines in any
direction. A plain 3x3 median erased thin lines and dashes on dev, so I switched.

### Read the text
Tesseract on the whole picture misses most tick labels, because they are tiny and sit next to lines. So Unchart finds
label sized groups of glyphs itself (connected components that are about as tall as text, judged against their own
surroundings so gray text on a gray panel still counts), copies each one onto a clean white sheet at a fixed height
with its contrast stretched, and reads the sheet in one pass, once with a numbers only character set and once with
everything. The page itself is also read once for longer words like titles and legends. When the x labels come out as
junk, which usually means they are drawn at an angle, the strip under the plot is read again turned by 30, 45 and 90
degrees and the best turn wins. When no value axis comes out of the text at all, the whole picture is read once more at
twice its size, which rescued a few small and blurry charts on dev. Labels only four or five pixels tall stay unreadable,
and I tried matching digit shapes against templates drawn from common fonts before giving that up, because at that size
a 6, an 8 and a 0 are the same few gray pixels.

### Find the axes
Numbers stacked in a column become the value axis, numbers or dates spread in a row become the x axis. The x row is the
one with the most numbers or dates close under the plot, so a line of notes under an Our World in Data chart does not
win just because it has more words.

The axis is a straight line fit from pixel to value, done in two passes. The first pass keeps every label within 2% of
the value range of a line through some pair of labels. The second looks again at those labels in pixels and keeps the
line most of them hit within a pixel or two, so one label that is 5 px off (snapped onto a bar top instead of its tick)
can not bend the scale. Labels are snapped to their tick mark or gridline first when that makes them line up better.

OCR mistakes on tick labels are very regular, so several are fixed on purpose and each fix has a test. They are a minus
sign lost below zero, a comma read as a point in 4,000, European decimals, superscript powers of ten read as
"103", a decimal point dropped ("15" for 1.5, only when a label that kept its point proves it), a tick mark glued to the
label as a trailing dash, and scientific notation.

### Find the series
Inside the plot, text is masked out (legend words with the swatch to their left, number labels on bars). Pieces of a
colored line that OCR read as letters are left alone, since their pixels are mostly one saturated color. Then every
colored pixel is binned by color, and bins that are close in color and in hue become one series. Hue matters because
Chart.js blue and teal are only 56 apart in RGB. Anti-aliased edges that are a mix of a series color and the background
are folded back into their series. Gray bars next to colored ones (Excel's third color) are found as solid gray blocks.

Each series is then classified by the shape of its pixels.

- bars: solid rectangles of one width on a shared base. Pieces of one bar cut apart by another series' line or by a
  legend are joined back when the gap between them is someone else's ink.
- stacked bars: rectangles of different colors touching in one column. Legend swatches lying across a bar are dropped.
- histograms: one wide solid blob with a flat bottom and a stepped top, cut where the top jumps. Bins of a count or two
  that are a pixel tall are looked for just above the base past the last bar.
- lines: traced column by column. Where two runs of ink touch the last one (the line crossing a gridline that shows
  through a fill, or crossing another series), the one that keeps the line's recent slope wins, so the trace does not
  turn off along the crossing. Then the trace is snapped to the data grid. The grid is the coarsest regular x grid (years,
  quarters, months, days, or a fraction of the tick step) whose straight segments reproduce the drawn line, and all lines
  of one chart share it. Grids are tried both on multiples of the step and through the first tick label (a slope chart
  with 2013 and 2018 has a step of 5 that does not start at a multiple of 5). Without a grid the corners of the trace
  are used. Dots in another color sitting on a line are that line's markers and give its points directly, and a line
  over bars with no readable x labels is read above the bar centers.
- steps: flat runs joined by sharp vertical jumps between most of them. Whether each value starts or ends its step
  shows only at the ends of the line, where one end has a short vertical stub. Stubs are found even when they are a pixel
  long or clipped to half their width at the edge of the plot (pixels that are a blend of the line color and the
  background). With no stub at either end the read is marked as not reliable.
- areas and stacked areas: the top edge is the line, and a band stacked on another one is measured from the band below.
- scatter: blobs about the size of one marker. A blob two markers big, or clearly longer than one marker, is split with
  k-means. Hollow markers count by the area they enclose.
- pies and donuts: found as the biggest round blob, then read by sampling colors around the circle at six radii.
  Separators (thin lines in a color no slice has, at the same angle on most radii) split two touching slices that share a
  color, and printed percentages are used when they agree with the angles.

Horizontal bar charts are read by flipping the picture on its diagonal and reading it as a vertical chart. Dot plots
(dots against category labels on the left) are read the same way.

The newer families are measured on their own sets (`dataset/synthetic-families-*`).

- waterfalls: bars of every color are read together; when each bar starts where the one before it ended, the value of
  each bar is its signed change, and a bar standing on the baseline away from the running level is a total.
- lollipops: a thin stem from the baseline with a dot at its end, read as a bar whose value is the center of the dot.
- bubbles: round blobs of many sizes, read as points at their centers. The size is a third value that is not read.
- 100% stacked bars, slope charts, bars with error bars and lines on two y axes go through the normal readers.

### The mark model (optional, off by default)
The rules read charts alone unless this model is switched on (the "experimental mark model" box in the app, `--mark-model` on the command line). It was a wash on test, so it is not the default, and it brings its own confidence calibration (`src/calibration_model.json`).

A small U-Net (`bench/seg/model.py`, 773K parameters, 3.1 MB as ONNX, run with onnxruntime-web in the page) labels
every pixel as background, series, text, gridline or legend swatch, and gives every series pixel an 8 number embedding
trained so that pixels of one series sit close together and different series sit apart (the discriminative loss of
De Brabandere et al. 2017). It was trained on 22,000 charts drawn by the benchmark's own renderers with a label for
every pixel (`bench/seg/gen.py`, `bench/seg/gen_web.js`), never on a test chart. On held out training charts it finds
series pixels with an IoU of 0.945, text 0.60 and gridlines 0.51 (`results/v4/seg_val.json`). Grouping series pixels
by their embedding is weaker. A true series keeps on average 88% of its pixels in its best group.

The reader uses it twice. First the color groups from above, with pixels the model calls text or legend left out, two
color groups joined when the model calls them one series, and one color group split when the model sees two series in
it that only touch where they cross. Second, the model's own groups straight as the series. Both reads are measured the
same way, and the one the confidence model trusts more is kept. Pies do not use it. In headless Chromium on one thread
it takes a median of 1.7 seconds per chart on test v3. The details and the dev numbers are in [`results/v4/dev_progress.md`](../results/v4/dev_progress.md).

### Error bars
Each value gets a 95% band from two sources: where exactly the mark's edge is (about a third of a pixel for a bar edge,
more for a thick line or a merged marker) and how well the axis labels fit their line (the usual band for a prediction
from a fitted line, in pixels, turned into value units). The bands are then scaled by one factor fit on dev so that 95%
of true values fall inside them on charts that were read right.

### Confidence and refusing
I spent the most time on this part. The reader computes about thirty features of its own read: how many axis
labels fit and how tightly, how much of each line it could trace, whether series colors are close, whether more corners
were drawn than points given, stacked bands below zero, duplicate x values, legend swatches in colors no series has,
markers touching another series, whether a second read agrees, and (with the mark model) whether the color read and the
model read agree. The second read runs on a copy of the picture at
70% size with colors split more finely and no tick snapping. A read that does not change under that is much more
often right.

A small boosted tree model (150 trees of depth 2, `bench/calibrate.py`) turns those features into a probability that
the chart was read right. It was fit on the dev charts only, synthetic and Our World in Data. The threshold for calling
a read reliable was picked with 5 fold cross validation on dev so that at most 2% of dev charts would come back wrong
but marked reliable. The test sets did not stay under that target. Wrong but marked reliable came out at 3.4% on synthetic test v2 and 7.5% on test v3 (5.6% with the mark model), and [`results/intervals.md`](../results/intervals.md) has the intervals. Some problems always mark the read as not reliable no matter what the model says. They are a legend
covering data, series that are all gray, two y axes where I could not tell which series uses which, a step line where I
can not tell if values start or end their steps, and pies with more legend names than slices.

When it refuses, the app still shows the numbers, with a banner that says why it does not trust them, and you can fix
the axis by hand or drag points. How often it refuses is in the README. On Our World in Data it refuses about four charts
in five.

### Checks for misleading charts
Separate from reading, the app checks for charts drawn to mislead: bars that do not start at zero, log scales, zoomed in
line axes, areas that do not start at zero, uneven time steps on a category axis, two y axes, pies with many or nearly
equal slices. Each one comes with a plain explanation and, where it makes sense, a redraw that removes the trick. It does not
check 3D effects or pictures sized by area.

## What I learned from the failures
- On clean pictures dev is read right about nine times in ten. Almost all of the gap to that is damage: scans,
  downscaling, JPEG and blur, where the tick labels stop being readable before the marks do.
- Most wrong reads on dev came from bad text. The measurements were fine. A dropped decimal point or a minus sign turns a
  perfect trace into a wrong chart, and nothing in the pixels shows it. That is why the label fixes have to be proven
  by another label before they are used.
- Counting is harder than measuring. Overlapping scatter markers and pie slices that share a color are the most common
  reason a read with tiny error still has the wrong number of points.
- A learned mark finder helps less than I hoped. It fixed the charts where color grouping was the problem (bubbles,
  slope charts, many line Our World in Data charts) but those were a small part of what was left, and picking between
  two reads made the confidence check's job harder.
- Real charts are a different world. Our World in Data charts have many overlapping countries, labels at the ends of
  lines and their own unit words, and the success rate there is much lower than on synthetic charts. The benchmark
  tables list them separately.

## Ablations
`bench/ablate.py` switches off one part at a time on dev and scores the result, with the OCR replayed from cache so
every variant sees the same text. The table is in [`results/ablation.md`](../results/ablation.md).
