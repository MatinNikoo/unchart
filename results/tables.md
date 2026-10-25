# Benchmark results

Made by `bench/report.py` from the scored files in this folder.
Read right: type, count and values right (error at most 2%), whether or not the reader trusted it. Success: read right and marked reliable. Silent wrong: marked reliable but wrong. Definitions in docs/benchmark.md.

| Set | Charts | Read right | Success | Median error (all charts) | Median error (answered) | Refused | Failed | Silent wrong | Wrong type | Axis misread | False flag | Error bar coverage | Time per chart |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Synthetic test v2 (held out) | 545 | 62.7% | 35.4% | 0.38% | 0.15% | 60.3% | 4.7% | 3.4% | 6.2% | 21.9% | 27.3% | 85.2% | 1.3 s |
| Newer families test (held out) | 112 | 51.8% | 30.4% | 0.63% | 0.16% | 65.2% | 6.2% | 2.7% | 5.4% | 33.3% | 21.4% | 72.2% | 1.3 s |
| Synthetic test v1 (engine v1 run) | 543 | 61.0% | 36.3% | 0.32% | 0.17% | 58.0% | 7.6% | 5.1% | 4.6% | 20.7% | 24.7% | 87.4% | 1.0 s |
| Our World in Data (held out) | 130 | 30.8% | 6.2% | 6.45% | 0.15% | 90.8% | 9.2% | 3.1% | 14.6% | 35.3% | 24.6% | 61.0% | 3.1 s |
| FRED | 58 | 55.2% | 22.4% | 1.78% | 0.92% | 72.4% | 3.4% | 0.0% | 0.0% | 23.2% | 32.8% | 24.5% | 1.9 s |
| Newer families (dev) | 112 | 51.8% | 23.2% | 0.70% | 0.16% | 75.9% | 13.4% | 0.0% | 3.6% | 32.1% | 28.6% | 79.5% | 0.4 s |
| Synthetic dev | 337 | 74.1% | 40.9% | 0.25% | 0.15% | 57.9% | 4.6% | 0.9% | 4.3% | 20.3% | 33.2% | 87.4% | 0.2 s |
| Our World in Data (dev) | 40 | 42.5% | 15.0% | 5.45% | 0.11% | 85.0% | 12.5% | 0.0% | 0.0% | 25.7% | 27.5% | 82.1% | 0.9 s |
| v1 set: matplotlib | 60 | 100.0% | 63.3% | 0.16% | 0.14% | 36.7% | 0.0% | 0.0% | 0.0% | 0.0% | 36.7% | 98.6% | 0.5 s |
| v1 set: Chart.js and JPEG | 50 | 100.0% | 50.0% | 0.16% | 0.16% | 50.0% | 0.0% | 0.0% | 0.0% | 0.0% | 50.0% | 96.8% | 0.4 s |
| v1 set: truncated bars | 20 | 100.0% | 15.0% | 0.05% | 0.07% | 85.0% | 0.0% | 0.0% | 0.0% | 0.0% | 85.0% | 98.0% | 0.4 s |

### Synthetic test v2 (held out), by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| area | 37 | 64.9% | 35.1% | 0.76% | 64.9% | 0.0% | 13.5% |
| bar | 42 | 77.5% | 65.0% | 0.19% | 32.5% | 2.5% | 7.5% |
| bar_line | 37 | 32.4% | 13.5% | 11.14% | 78.4% | 8.1% | 18.9% |
| donut | 37 | 64.9% | 40.5% | 0.17% | 48.6% | 8.1% | 0.0% |
| grouped_bar | 42 | 57.1% | 33.3% | 0.39% | 64.3% | 2.4% | 11.9% |
| hbar | 42 | 75.6% | 43.9% | 0.16% | 48.8% | 7.3% | 4.9% |
| histogram | 42 | 58.5% | 51.2% | 0.31% | 41.5% | 7.3% | 9.8% |
| line | 42 | 55.0% | 7.5% | 1.07% | 92.5% | 0.0% | 0.0% |
| pie | 37 | 78.4% | 51.4% | 0.10% | 45.9% | 0.0% | 0.0% |
| scatter | 42 | 59.5% | 21.4% | 0.41% | 76.2% | 0.0% | 0.0% |
| stacked_area | 34 | 32.4% | 0.0% | 5.91% | 94.1% | 5.9% | 8.8% |
| stacked_bar | 37 | 62.9% | 37.1% | 0.38% | 51.4% | 5.7% | 5.7% |
| stacked_hbar | 37 | 91.4% | 65.7% | 0.11% | 34.3% | 0.0% | 0.0% |
| step | 37 | 66.7% | 27.8% | 0.62% | 72.2% | 0.0% | 5.6% |

### by renderer

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| chartjs | 70 | 63.6% | 42.4% | 0.35% | 56.1% | 1.5% | 4.5% |
| echarts | 67 | 57.6% | 24.2% | 0.56% | 69.7% | 4.5% | 18.2% |
| excel_like | 42 | 64.3% | 42.9% | 0.31% | 54.8% | 0.0% | 0.0% |
| matplotlib | 112 | 65.2% | 34.8% | 0.48% | 61.6% | 3.6% | 3.6% |
| plotly | 70 | 64.7% | 33.8% | 0.25% | 61.8% | 4.4% | 4.4% |
| seaborn | 30 | 63.3% | 43.3% | 0.35% | 53.3% | 3.3% | 10.0% |
| sheets_like | 42 | 71.4% | 40.5% | 0.28% | 52.4% | 4.8% | 4.8% |
| slide | 42 | 82.9% | 56.1% | 0.12% | 41.5% | 2.4% | 4.9% |
| vegalite | 70 | 41.8% | 17.9% | 3.94% | 74.6% | 4.5% | 6.0% |

### by damage

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| blur | 61 | 55.7% | 34.4% | 0.70% | 60.7% | 3.3% | 8.2% |
| clean | 182 | 75.7% | 48.6% | 0.17% | 46.9% | 4.0% | 5.6% |
| down | 59 | 55.2% | 29.3% | 0.94% | 69.0% | 1.7% | 1.7% |
| jpeg | 51 | 56.9% | 23.5% | 0.88% | 74.5% | 0.0% | 5.9% |
| noise | 64 | 63.5% | 33.3% | 0.45% | 61.9% | 4.8% | 1.6% |
| rotate | 63 | 67.2% | 29.5% | 0.38% | 68.9% | 1.6% | 13.1% |
| scan | 65 | 39.7% | 22.2% | 1.22% | 68.3% | 6.3% | 7.9% |

### by width of the picture

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| under 500 px | 40 | 51.3% | 28.2% | 1.64% | 71.8% | 0.0% | 2.6% |
| 500 to 800 px | 214 | 66.8% | 29.9% | 0.43% | 65.9% | 2.8% | 5.2% |
| 800 px and up | 291 | 61.3% | 40.5% | 0.30% | 54.6% | 4.2% | 7.4% |

### line and area charts, by number of series (more series means more overlap)

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| 1 series | 89 | 64.4% | 28.7% | 0.75% | 71.3% | 0.0% | 8.0% |
| 2 series | 17 | 52.9% | 5.9% | 0.93% | 94.1% | 0.0% | 5.9% |
| 3 series | 17 | 37.5% | 0.0% | 2.59% | 100.0% | 0.0% | 12.5% |
| 4 series | 27 | 37.0% | 0.0% | 2.99% | 92.6% | 7.4% | 0.0% |

### by how the value axis is written

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| plain | 265 | 64.5% | 39.0% | 0.30% | 56.8% | 3.5% | 5.4% |
| thousands | 97 | 60.0% | 33.7% | 0.61% | 61.1% | 4.2% | 9.5% |
| currency | 45 | 66.7% | 22.2% | 0.60% | 75.6% | 2.2% | 4.4% |
| pct | 47 | 72.7% | 40.9% | 0.27% | 56.8% | 0.0% | 4.5% |
| suffix | 50 | 52.0% | 28.0% | 0.36% | 68.0% | 4.0% | 4.0% |
| dec | 41 | 56.1% | 34.1% | 0.85% | 58.5% | 4.9% | 9.8% |

### by axis scale

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| log scale | 1 | 100.0% | 0.0% | 0.38% | 100.0% | 0.0% | 0.0% |
| linear | 544 | 62.7% | 35.5% | 0.38% | 60.2% | 3.4% | 6.2% |

### by label visibility

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| axis numbers shown | 534 | 62.7% | 35.4% | 0.38% | 60.3% | 3.4% | 6.2% |
| axis numbers hidden (should be refused) | 11 | n/a | n/a | n/a | n/a | n/a | n/a |

Charts with hidden axis numbers that were refused: 11 of 11.

### Newer families test (held out), by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| bubble | 14 | 42.9% | 7.1% | 0.44% | 92.9% | 0.0% | 14.3% |
| dot_plot | 14 | 21.4% | 0.0% | 100.00% | 100.0% | 0.0% | 7.1% |
| dual_axis | 14 | 7.1% | 0.0% | 37.78% | 100.0% | 0.0% | 0.0% |
| errorbar | 14 | 85.7% | 78.6% | 0.16% | 14.3% | 7.1% | 7.1% |
| lollipop | 14 | 64.3% | 57.1% | 0.17% | 28.6% | 14.3% | 7.1% |
| slope | 14 | 35.7% | 14.3% | 2.41% | 85.7% | 0.0% | 7.1% |
| stacked100 | 14 | 57.1% | 21.4% | 1.37% | 64.3% | 0.0% | 0.0% |
| waterfall | 14 | 100.0% | 64.3% | 0.20% | 35.7% | 0.0% | 0.0% |

### Newer families (dev), by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| bubble | 14 | 42.9% | 7.1% | 0.76% | 92.9% | 0.0% | 14.3% |
| dot_plot | 14 | 14.3% | 0.0% | 100.00% | 100.0% | 0.0% | 7.1% |
| dual_axis | 14 | 14.3% | 7.1% | 35.46% | 92.9% | 0.0% | 0.0% |
| errorbar | 14 | 85.7% | 57.1% | 0.13% | 42.9% | 0.0% | 7.1% |
| lollipop | 14 | 50.0% | 42.9% | 24.43% | 57.1% | 0.0% | 0.0% |
| slope | 14 | 35.7% | 14.3% | 1.09% | 85.7% | 0.0% | 0.0% |
| stacked100 | 14 | 71.4% | 7.1% | 1.14% | 85.7% | 0.0% | 0.0% |
| waterfall | 14 | 100.0% | 50.0% | 0.16% | 50.0% | 0.0% | 0.0% |

### Held out Our World in Data charts, by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| hbar | 15 | 53.3% | 40.0% | 0.54% | 46.7% | 13.3% | 26.7% |
| line | 82 | 36.6% | 1.2% | 3.14% | 97.6% | 1.2% | 0.0% |
| stacked_area | 17 | 5.9% | 0.0% | 42.83% | 100.0% | 0.0% | 64.7% |
| stacked_bar | 8 | 12.5% | 12.5% | 40.99% | 75.0% | 12.5% | 25.0% |
| stacked_hbar | 8 | 0.0% | 0.0% | 94.44% | 100.0% | 0.0% | 25.0% |

### Confidence on Synthetic test v2 (held out)

| Confidence | Charts | Mean confidence | Read right |
|---|---|---|---|
| 0.0 to 0.2 | 65 | 0.06 | 3.1% |
| 0.2 to 0.4 | 30 | 0.29 | 20.0% |
| 0.4 to 0.6 | 53 | 0.49 | 37.7% |
| 0.6 to 0.8 | 85 | 0.73 | 63.5% |
| 0.8 to 0.9 | 125 | 0.86 | 79.2% |
| 0.9 to 1.0 | 176 | 0.93 | 87.5% |

When it says reliable it is right 89.2% of the time. Of the 174 answered charts that were read wrong, 86.8% were flagged. Brier score 0.152.

### Confidence on Our World in Data (held out)

| Confidence | Charts | Mean confidence | Read right |
|---|---|---|---|
| 0.0 to 0.2 | 39 | 0.07 | 0.0% |
| 0.2 to 0.4 | 28 | 0.29 | 28.6% |
| 0.4 to 0.6 | 12 | 0.49 | 25.0% |
| 0.6 to 0.8 | 32 | 0.71 | 53.1% |
| 0.8 to 0.9 | 7 | 0.83 | 57.1% |
| 0.9 to 1.0 | 12 | 0.92 | 66.7% |

When it says reliable it is right 66.7% of the time. Of the 78 answered charts that were read wrong, 94.9% were flagged. Brier score 0.185.

### Confidence on Newer families test (held out)

| Confidence | Charts | Mean confidence | Read right |
|---|---|---|---|
| 0.0 to 0.2 | 17 | 0.06 | 11.8% |
| 0.2 to 0.4 | 8 | 0.27 | 0.0% |
| 0.4 to 0.6 | 9 | 0.46 | 44.4% |
| 0.6 to 0.8 | 18 | 0.72 | 33.3% |
| 0.8 to 0.9 | 27 | 0.85 | 63.0% |
| 0.9 to 1.0 | 33 | 0.93 | 87.9% |

When it says reliable it is right 87.2% of the time. Of the 47 answered charts that were read wrong, 89.4% were flagged. Brier score 0.195.

### Unchart and DePlot on the same 27 charts from Synthetic test v1 (engine v1 run)

| Tool | Charts | Read right (type not checked) | Median error | Within 5% | No answer | Time per chart |
|---|---|---|---|---|---|---|
| Unchart | 27 | 70.4% | 0.29% | 85.2% | 3.7% | 1.1 s |
| DePlot | 27 | 14.8% | 15.20% | 29.6% | 0.0% | 93.8 s |

### Unchart and DePlot on the same 5 charts from FRED

| Tool | Charts | Read right (type not checked) | Median error | Within 5% | No answer | Time per chart |
|---|---|---|---|---|---|---|
| Unchart | 5 | 60.0% | 0.88% | 80.0% | 0.0% | 2.0 s |
| DePlot | 5 | 0.0% | 11.70% | 0.0% | 0.0% | 330.3 s |

### Bars that do not start at zero

| Set | Skipped zero, flagged | Started at zero, flagged anyway |
|---|---|---|
| v1_truncated_set | 10 of 10 | 0 of 10 |
| synthetic_test2 | 0 of 0 | 6 of 146 |
| synthetic_dev | 0 of 0 | 4 of 94 |

