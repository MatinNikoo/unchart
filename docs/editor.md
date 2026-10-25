# The chart editor

After Unchart reads a chart it can draw it again from the table. The Remake tab is an editor for that picture. It is meant to get a chart to something you would put in a report or a slide deck, and every setting is kept in one small description of the chart, so what you see is what the PNG, the SVG, the PDF and the XLSX chart are made from.

Everything runs in the page. Nothing is uploaded.

## Working in the picture

- Hover to see what is under the pointer, click to pick it. The title, subtitle, note, axis titles, tick labels, legend, gridlines, axes, data labels, plot area, chart area, every series and every slice can be picked, and so can a single bar, point or slice (pick the series, then click the point).
- Picking something opens its Format tab, with the same groups of settings a spreadsheet's Format pane has. The Element menu above the picture does the same by name, and `[` and `]` step through the elements.
- Double click a title, subtitle or text box to edit its words in place.
- Text boxes, shapes, the legend and callouts can be dragged. Selected shapes show handles to resize them. The arrow keys nudge the picked item (Shift for ten pixels).

## The tabs

### Design
The chart type (line, steps, area, stacked area, 100% stacked area, bars, stacked bars, 100% stacked bars, horizontal bars, horizontal stacked, horizontal 100%, bars and line, lollipop, dots, pie, donut), a gallery of 14 looks and a gallery of quick layouts (each drawn live from your data), the background, the palette (12, including a colorblind safe one and the colors of the original picture) and saved themes.

### Series
The name, color, order and visibility of every series or slice, line width, dash, smoothing, markers, data labels and their number format, error bars, a trend or growth projection, the index to 100 view, a highlight for one series and a second value axis.

### Axes
For the value axis the minimum, maximum, major and minor unit, zero baseline, log scale (base 10 or 2), reversed order, display units (hundreds up to trillions) with a label, number format, where the other axis crosses, tick marks inside, outside or across, label position (next to the axis or none) and the side. For the category or x axis the number or date format, range, tick label angle, showing every nth label, tick marks, whether ticks sit between categories and where the labels go (at the edge of the plot, next to the axis line or at the top). Gridlines can be turned on or off for each axis, major and minor.

### Text
The font (nine families, any installed font by name, or a font file you add for this session), the base text size and the title, subtitle, note and axis titles.

### Format
The settings of whatever is picked. Which groups show depends on what it is.

- Fill, as none, solid, gradient (linear with an angle, or radial) or one of 12 patterns, with transparency.
- Border, with color, width, dash (solid, dash, dot, dash dot, long dash, long dash dot) and transparency.
- Effects, shadow, glow and soft edges, each with its own color and size.
- Rounded corners for the chart area, bars, the legend and shapes.
- Bars, with the gap between bars and between groups, overlap, and a color for negative values or a different color for every bar.
- Lines, with marker shape (circle, square, diamond, two triangles, plus, cross, star, dash), size, hollow markers, marker color and border and smoothing. Smoothing is monotone, so a curve never overshoots its points.
- Text, with font, size, weight, italic, color, alignment, letter spacing, line height and angle.
- Data labels, with position (the options that make sense for the chart type), what they show (value, category, series name), the number format and a separator, plus a box with its own fill and border. Pie labels can sit inside or outside with leader lines.
- Pies and donuts, with the start angle, hole size, text in the hole and its size, labels inside, outside with leader lines or best fit, and pulling slices out.
- A single point, with its own fill, border and label.

Copy format (Ctrl Shift C) and Paste format (Ctrl Shift V) move a format from one element to another. Reset puts the picked element back to its automatic look.

### Add
Text boxes, rectangles, ellipses, lines and arrows, callouts that point at a data point or a slice, reference lines and bands on either axis (a target, a threshold, a recession or any stretch of time), each with its own text and style. Everything added is listed so you can pick it again.

### Layout
The size in pixels or a preset (blog, social post, square and portrait posts, slide, A4 portrait and landscape, banner), the shape, the margins and the padding around the plot, the alignment of the title and the legend, the legend at the top, bottom, left, right or floating where you drop it, and shortcuts to the chart and plot area.

### Export
See below.

## Number formats

The number format boxes take Excel's codes, so `#,##0.0`, `0.0%`, `$#,##0`, `#,##0.0,,"M"` and `+#,##0;-#,##0;0` do what they do in a spreadsheet, with sections for negatives and zero, colors in brackets ignored, quoted text and `E+00`. Dates take `yyyy`, `mmm yyyy`, `dd mmm`, `dddd` and the rest. A code without a digit placeholder is read as General, so a typo never prints the same words at every tick. The European number style (comma for the decimal point) from the Reading tab is applied everywhere.

## Looks, layouts and themes

A look changes how the chart is drawn (colors, fonts, fills, grid, spacing) and keeps what it says. A layout only moves things, the legend, labels, gridlines and axis lines, and keeps the look. Applying a look replaces the last one, so they do not stack.

A theme is the look of the chart you have now. Save it under a name, apply it to any other chart, export it as a small JSON file, import one, or set it as the default for new charts. Themes live in the browser, so export one if you want to keep it or share it. Titles and data are never part of a theme.

Save chart settings writes everything about the chart except the data, and Open chart settings applies it to another table.

## Exports

- PNG at 1x, 2x or 4x, with an optional transparent background.
- SVG, with real text, so it opens in Illustrator, Figma or Inkscape. The title and the alt text are inside it as its title and description.
- PDF, a raster image at three times the size on a page of the chart's shape. For a vector PDF, Print or save as vector PDF opens the print dialog with the SVG alone on the page.
- Copy image (PNG, ready to paste into slides or a document) and Copy SVG code.
- XLSX, with the data and a native chart that follows the editor. See below.
- The table as CSV, TSV, JSON and the other formats from the Export tab of the main page.

### The XLSX chart

It is a real Excel chart, not a picture, and it takes the editor's settings. The type (line, area, stacked area, bars, stacked, 100% stacked, horizontal, bars and line, scatter, pie, donut), colors, gradient, pattern and solid fills, outlines and dashes, shadows, glow and soft edges, bar gap and overlap, markers, smoothing, data labels with their position and format, error bars, axis range, units and number formats, log scale, crossing, tick marks, titles, legend position, fonts, the chart and plot area fill and border, gridlines, reference lines, text boxes and shapes, and the alt text. I checked the files with openpyxl and LibreOffice.

What Excel cannot draw the same way.

- Step lines come out as straight lines between the points.
- A reference band is two dashed lines at its edges and not a shaded strip, and reference lines on the category axis are left out.
- A callout keeps its text box but not the pointer to the point.
- Projections (the dotted forward trend) are not in the native chart.
- Shadows and the other effects follow what Excel offers for a series, so soft edges on a single point are dropped.
- Excel lays out its own legend, tick labels and margins, so the picture will not match pixel for pixel. Positions of text boxes and shapes come from the geometry of the redrawn chart.

## Checking the chart before you publish it

The Export tab has an accessibility check.

- Series colors are compared as seen with normal vision, with red, green and blue blindness (simulated with the Machado matrices) and in grayscale, using CIEDE2000. Two colors closer than a difference of 10 under any of those are flagged by name.
- Text contrast is checked against the background (4.5 to 1, or 3 to 1 for large text) and one click sets every faint text to full contrast.
- Text under 11 px is flagged, and so are charts with more than six series.
- Preview as shows the chart through each of those color vision filters while you work.
- Alt text can be written by you or made from the data. Left empty, every export still carries one made from the data.

## Keyboard

| Keys | Action |
| --- | --- |
| Ctrl Z, Ctrl Shift Z (or Ctrl Y) | Undo and redo, in the editor |
| Ctrl Shift C, Ctrl Shift V | Copy and paste format |
| Ctrl D | Duplicate the picked text box or shape |
| Arrow keys, Shift and arrow keys | Nudge by 1 or 10 pixels |
| Delete | Remove the picked item, hide a series or slice, clear a title |
| `[` and `]` | Previous and next element |
| Escape | Close the gallery, then pick the whole chart. In full screen it leaves full screen first |

## Limits

- Fonts you add are kept for the session only. A font that is only on your computer will not be in a PNG opened on another one, so use the PNG or the SVG with text converted if that matters.
- The PDF made by the button is raster. Use the print route for vector.
- Themes stay in the browser that saved them unless you export them.
- A date axis needs a date in every row, otherwise the x values are treated as categories.
- Pies draw their first value column only.

## From a script

The editor is on the page as `window.unchartEditor`. `unchartEditor.spec` is the current description of the chart, `unchartEditor.change(d => { d.title = 'Sales'; })` edits it (and is undoable), and `unchartEditor.out.svg` is the picture. `UnchartRemake.render(table, spec)` does the drawing without a page, the same code, so a spec saved with Save chart settings can be rendered from Node.

## Tests

`npm test` draws every chart type from line, category and date data, with every look and layout and with absurd limits, margins and formats, and checks the numbers and the tags in the SVG, the number format engine, the PDF structure and the XLSX chart XML. `npm run test:ui` opens the page in Chromium and goes through the editor, every chart type on every example, text, fonts, axes, galleries, themes, fills, effects, bar and marker settings, annotations (dragging and resizing with the mouse), reference lines, copy and paste format, undo, the accessibility check, every export (PNG sizes, SVG, PDF, clipboard, and the XLSX read back with openpyxl), full screen, and six window sizes from 1360 to 320 pixels wide. After each change it checks that no text overlaps, nothing leaves the picture and no controls overlap or push the page sideways. Screenshots go to `test/shots/editor`.
