# Benchmark results

Made by `bench/report.py` from the scored files in this folder.
Read right: type, count and values right (error at most 2%), whether or not the reader trusted it. Success: read right and marked reliable. Silent wrong: marked reliable but wrong. Definitions in docs/benchmark.md.

| Set | Charts | Read right | Success | Median error (all charts) | Median error (answered) | Refused | Failed | Silent wrong | Wrong type | Axis misread | False flag | Error bar coverage | Time per chart |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Synthetic test (held out) | 543 | 61.0% | 36.3% | 0.32% | 0.17% | 58.0% | 7.6% | 5.1% | 4.6% | 20.7% | 24.7% | 87.4% | 1.0 s |
| Our World in Data (held out) | 130 | 33.1% | 9.2% | 9.78% | 0.16% | 86.9% | 13.1% | 3.8% | 10.0% | 33.3% | 23.8% | 62.0% | 2.1 s |
| FRED | 58 | 46.6% | 24.1% | 2.16% | 0.87% | 70.7% | 17.2% | 0.0% | 0.0% | 31.2% | 22.4% | 26.4% | 1.8 s |
| Synthetic dev | 337 | 72.0% | 45.7% | 0.28% | 0.16% | 53.7% | 7.0% | 0.3% | 4.0% | 16.4% | 26.2% | 90.8% | 1.0 s |
| Our World in Data (dev) | 40 | 42.5% | 15.0% | 4.60% | 0.11% | 85.0% | 12.5% | 0.0% | 0.0% | 20.0% | 27.5% | 82.4% | 2.4 s |
| v1 set: matplotlib | 60 | 100.0% | 86.7% | 0.16% | 0.16% | 13.3% | 0.0% | 0.0% | 0.0% | 0.0% | 13.3% | 99.2% | 1.1 s |
| v1 set: Chart.js and JPEG | 50 | 100.0% | 80.0% | 0.16% | 0.15% | 20.0% | 0.0% | 0.0% | 0.0% | 0.0% | 20.0% | 98.3% | 1.0 s |
| v1 set: truncated bars | 20 | 100.0% | 90.0% | 0.05% | 0.05% | 10.0% | 0.0% | 0.0% | 0.0% | 0.0% | 10.0% | 99.0% | 1.0 s |

### Held out synthetic test, by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| area | 37 | 45.5% | 15.2% | 0.77% | 72.7% | 9.1% | 18.2% |
| bar | 42 | 87.8% | 75.6% | 0.16% | 22.0% | 2.4% | 2.4% |
| bar_line | 37 | 28.6% | 17.1% | 2.86% | 74.3% | 5.7% | 8.6% |
| donut | 37 | 81.1% | 32.4% | 0.08% | 64.9% | 2.7% | 0.0% |
| grouped_bar | 42 | 61.9% | 26.2% | 0.32% | 71.4% | 2.4% | 7.1% |
| hbar | 42 | 82.9% | 68.3% | 0.15% | 29.3% | 2.4% | 0.0% |
| histogram | 42 | 55.0% | 45.0% | 0.36% | 42.5% | 12.5% | 12.5% |
| line | 42 | 51.3% | 20.5% | 1.03% | 79.5% | 0.0% | 0.0% |
| pie | 37 | 67.6% | 32.4% | 0.14% | 62.2% | 5.4% | 0.0% |
| scatter | 42 | 53.7% | 39.0% | 0.69% | 48.8% | 12.2% | 0.0% |
| stacked_area | 32 | 46.9% | 9.4% | 2.21% | 90.6% | 0.0% | 3.1% |
| stacked_bar | 37 | 73.0% | 48.6% | 0.32% | 45.9% | 2.7% | 5.4% |
| stacked_hbar | 37 | 69.4% | 50.0% | 0.15% | 38.9% | 11.1% | 2.8% |
| step | 37 | 40.0% | 14.3% | 8.77% | 82.9% | 2.9% | 5.7% |

### by renderer

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| chartjs | 70 | 64.3% | 37.1% | 0.25% | 60.0% | 1.4% | 4.3% |
| echarts | 65 | 50.8% | 27.9% | 0.49% | 67.2% | 4.9% | 4.9% |
| excel_like | 42 | 62.5% | 40.0% | 0.45% | 52.5% | 7.5% | 10.0% |
| matplotlib | 112 | 60.0% | 38.2% | 0.48% | 56.4% | 5.5% | 4.5% |
| plotly | 70 | 61.8% | 30.9% | 0.23% | 64.7% | 4.4% | 7.4% |
| seaborn | 30 | 76.7% | 60.0% | 0.24% | 33.3% | 6.7% | 0.0% |
| sheets_like | 42 | 74.4% | 46.2% | 0.24% | 48.7% | 5.1% | 5.1% |
| slide | 42 | 80.5% | 51.2% | 0.14% | 41.5% | 4.9% | 0.0% |
| vegalite | 70 | 40.3% | 17.9% | 5.54% | 73.1% | 7.5% | 3.0% |

### by damage

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| blur | 49 | 56.2% | 31.2% | 0.77% | 56.2% | 10.4% | 2.1% |
| clean | 173 | 69.6% | 44.0% | 0.17% | 50.6% | 5.4% | 4.2% |
| down | 76 | 43.8% | 19.2% | 3.80% | 75.3% | 5.5% | 2.7% |
| jpeg | 63 | 49.2% | 27.9% | 0.83% | 62.3% | 9.8% | 9.8% |
| noise | 77 | 75.0% | 41.7% | 0.24% | 54.2% | 1.4% | 0.0% |
| rotate | 53 | 71.7% | 45.3% | 0.19% | 52.8% | 1.9% | 5.7% |
| scan | 52 | 45.1% | 33.3% | 1.43% | 64.7% | 2.0% | 9.8% |

### by width of the picture

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| under 500 px | 45 | 46.5% | 11.6% | 3.80% | 86.0% | 2.3% | 2.3% |
| 500 to 800 px | 208 | 59.5% | 38.5% | 0.42% | 57.6% | 3.9% | 3.4% |
| 800 px and up | 290 | 64.4% | 38.5% | 0.25% | 54.0% | 6.5% | 5.8% |

### line and area charts, by number of series (more series means more overlap)

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| 1 series | 85 | 45.6% | 19.0% | 0.77% | 74.7% | 5.1% | 10.1% |
| 2 series | 21 | 63.2% | 15.8% | 0.52% | 84.2% | 0.0% | 5.3% |
| 3 series | 21 | 38.1% | 14.3% | 2.89% | 85.7% | 0.0% | 0.0% |
| 4 series | 21 | 40.0% | 0.0% | 2.30% | 100.0% | 0.0% | 0.0% |

### by how the value axis is written

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| plain | 259 | 65.2% | 37.2% | 0.24% | 56.1% | 6.3% | 5.1% |
| thousands | 84 | 63.7% | 37.5% | 0.42% | 57.5% | 3.8% | 1.2% |
| currency | 52 | 60.0% | 38.0% | 0.38% | 58.0% | 4.0% | 8.0% |
| pct | 42 | 54.8% | 35.7% | 0.38% | 57.1% | 7.1% | 2.4% |
| suffix | 49 | 52.2% | 41.3% | 0.92% | 54.3% | 2.2% | 6.5% |
| dec | 57 | 50.9% | 25.5% | 1.07% | 70.9% | 3.6% | 3.6% |

### by axis scale

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| linear | 543 | 61.0% | 36.3% | 0.32% | 58.0% | 5.1% | 4.6% |

### by label visibility

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| axis numbers shown | 526 | 61.0% | 36.3% | 0.32% | 58.0% | 5.1% | 4.6% |
| axis numbers hidden (should be refused) | 17 | n/a | n/a | n/a | n/a | n/a | n/a |

Charts with hidden axis numbers that were refused: 17 of 17.

### Held out Our World in Data charts, by chart family

| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |
|---|---|---|---|---|---|---|---|
| hbar | 15 | 53.3% | 46.7% | 0.54% | 40.0% | 13.3% | 6.7% |
| line | 82 | 40.2% | 4.9% | 3.23% | 92.7% | 2.4% | 0.0% |
| stacked_area | 17 | 5.9% | 0.0% | 39.08% | 100.0% | 0.0% | 52.9% |
| stacked_bar | 8 | 12.5% | 12.5% | 40.99% | 75.0% | 12.5% | 25.0% |
| stacked_hbar | 8 | 0.0% | 0.0% | 100.00% | 100.0% | 0.0% | 12.5% |

### Confidence on Synthetic test (held out)

| Confidence | Charts | Mean confidence | Read right |
|---|---|---|---|
| 0.0 to 0.2 | 73 | 0.04 | 5.5% |
| 0.2 to 0.4 | 38 | 0.30 | 31.6% |
| 0.4 to 0.6 | 39 | 0.50 | 30.8% |
| 0.6 to 0.8 | 56 | 0.71 | 50.0% |
| 0.8 to 0.9 | 94 | 0.86 | 74.5% |
| 0.9 to 1.0 | 226 | 0.94 | 86.3% |

When it says reliable it is right 86.4% of the time. Of the 165 answered charts that were read wrong, 81.8% were flagged. Brier score 0.160.

### Confidence on Our World in Data (held out)

| Confidence | Charts | Mean confidence | Read right |
|---|---|---|---|
| 0.0 to 0.2 | 45 | 0.06 | 2.2% |
| 0.2 to 0.4 | 17 | 0.29 | 29.4% |
| 0.4 to 0.6 | 19 | 0.48 | 31.6% |
| 0.6 to 0.8 | 23 | 0.70 | 52.2% |
| 0.8 to 0.9 | 9 | 0.85 | 77.8% |
| 0.9 to 1.0 | 17 | 0.94 | 70.6% |

When it says reliable it is right 70.6% of the time. Of the 70 answered charts that were read wrong, 92.9% were flagged. Brier score 0.167.

### Bars that do not start at zero

| Set | Skipped zero, flagged | Started at zero, flagged anyway |
|---|---|---|
| v1_truncated_set | 10 of 10 | 0 of 10 |
| synthetic_test | 0 of 0 | 4 of 142 |
| synthetic_dev | 0 of 0 | 2 of 92 |

