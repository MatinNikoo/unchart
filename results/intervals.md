Wilson 95% intervals on the held out test sets, computed by `bench/intervals.py` from the scored files.
Rates are over the readable charts. Read right, success, refused and silent wrong are defined in `bench/score.py`.

| Set | Engine | Charts | Read right | Success | Refused | Silent wrong |
|---|---|---|---|---|---|---|
| Synthetic, 14 types | v1 | 543 (526 readable) | 61.0% (56.8 to 65.1) | 36.3% (32.3 to 40.5) | 58.0% (53.7 to 62.1) | 5.1% (3.6 to 7.4) |
| Synthetic, 14 types | v2 | 545 (534 readable) | 62.7% (58.6 to 66.7) | 35.4% (31.5 to 39.5) | 60.3% (56.1 to 64.4) | 3.4% (2.1 to 5.3) |
| Synthetic, 14 types | v4 default (rules only) | 318 (305 readable) | 69.8% (64.5 to 74.7) | 52.5% (46.9 to 58.0) | 39.3% (34.0 to 44.9) | 7.5% (5.1 to 11.1) |
| Synthetic, 14 types | v4 with mark model | 318 (305 readable) | 69.8% (64.5 to 74.7) | 42.0% (36.6 to 47.6) | 51.8% (46.2 to 57.4) | 5.6% (3.5 to 8.7) |
| Our World in Data | v1 | 130 (130 readable) | 33.1% (25.6 to 41.5) | 9.2% (5.4 to 15.4) | 86.9% (80.1 to 91.7) | 3.8% (1.7 to 8.7) |
| Our World in Data | v2 | 130 (130 readable) | 30.8% (23.5 to 39.2) | 6.2% (3.2 to 11.7) | 90.8% (84.6 to 94.6) | 3.1% (1.2 to 7.6) |
| Our World in Data | v4 default (rules only) | 130 (130 readable) | 40.0% (32.0 to 48.6) | 14.6% (9.6 to 21.7) | 80.8% (73.2 to 86.6) | 4.6% (2.1 to 9.7) |
| Our World in Data | v4 with mark model | 130 (130 readable) | 37.7% (29.8 to 46.3) | 11.5% (7.1 to 18.2) | 85.4% (78.3 to 90.4) | 3.1% (1.2 to 7.6) |
| FRED | v1 | 58 (58 readable) | 46.6% (34.3 to 59.2) | 24.1% (15.0 to 36.5) | 70.7% (58.0 to 80.8) | 0.0% (0.0 to 6.2) |
| FRED | v2 | 58 (58 readable) | 55.2% (42.5 to 67.3) | 22.4% (13.6 to 34.7) | 72.4% (59.8 to 82.2) | 0.0% (0.0 to 6.2) |
| FRED | v4 default (rules only) | 58 (58 readable) | 56.9% (44.1 to 68.8) | 34.5% (23.6 to 47.3) | 58.6% (45.8 to 70.4) | 1.7% (0.3 to 9.1) |
| FRED | v4 with mark model | 58 (58 readable) | 56.9% (44.1 to 68.8) | 29.3% (19.2 to 42.0) | 63.8% (50.9 to 74.9) | 1.7% (0.3 to 9.1) |
| 8 newer types | v2 | 112 (112 readable) | 51.8% (42.6 to 60.8) | 30.4% (22.6 to 39.4) | 65.2% (56.0 to 73.4) | 2.7% (0.9 to 7.6) |
| 8 newer types | v4 default (rules only) | 112 (112 readable) | 64.3% (55.1 to 72.6) | 44.6% (35.8 to 53.9) | 50.9% (41.8 to 60.0) | 4.5% (1.9 to 10.0) |
| 8 newer types | v4 with mark model | 112 (112 readable) | 61.6% (52.4 to 70.1) | 38.4% (29.9 to 47.6) | 60.7% (51.5 to 69.3) | 0.9% (0.2 to 4.9) |
