Unchart (shipped default, rules only) and DePlot on the same charts. Read right leaves the chart type out because DePlot does not name one.
Fisher p is the two sided exact test on read right. These samples are small and the differences are not significant at the 5% level when p is above 0.05.

| Set | Tool | Charts | Read right | Median error | Within 5% | Refused | Silent wrong | Time per chart |
|---|---|---|---|---|---|---|---|---|
| Synthetic test v1 (27 charts) | Unchart v4 | 27 | 23 of 27 (85.2%) | 0.18% | 88.9% | 9 | 2 | 2.3 s |
| Synthetic test v1 (27 charts) | DePlot | 27 | 4 of 27 (14.8%) | 15.20% | 29.6% | 0 | 20 | 93.8 s |
| | Fisher p | | below 0.001 | | | | | |
| | Subset check | | the v1 engine read right 70.4% of these 27 and 61.6% of all 526 readable charts in the set | | | | | |
| FRED (5 charts) | Unchart v4 | 5 | 3 of 5 (60.0%) | 0.88% | 80.0% | 4 | 0 | 3.9 s |
| FRED (5 charts) | DePlot | 5 | 0 of 5 (0.0%) | 11.70% | 0.0% | 0 | 5 | 330.3 s |
| | Fisher p | | 0.167 | | | | | |
| | Subset check | | the v1 engine read right 60.0% of these 5 and 46.6% of all 58 readable charts in the set | | | | | |
