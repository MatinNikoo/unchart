# Ablations on dev

Each row switches off one part of the reader. Dev charts only, OCR replayed from cache.

| Variant | Set | Charts | Success | Read right (any flag) | Silent wrong | Median error |
|---|---|---|---|---|---|---|
| full reader | synthetic-dev | 337 | 45.7% | 72.0% | 0.0% | 0.27% |
| full reader | owid-dev | 40 | 15.0% | 42.5% | 0.0% | 4.60% |
| no snapping labels to tick marks | synthetic-dev | 337 | 45.1% | 71.0% | 0.0% | 0.33% |
| no snapping labels to tick marks | owid-dev | 40 | 15.0% | 42.5% | 0.0% | 4.52% |
| no snapping lines to a data grid | synthetic-dev | 337 | 39.9% | 70.1% | 0.0% | 0.27% |
| no snapping lines to a data grid | owid-dev | 40 | 7.5% | 45.0% | 0.0% | 3.96% |
| no sub-pixel bar edges | synthetic-dev | 337 | 45.7% | 72.0% | 0.0% | 0.28% |
| no sub-pixel bar edges | owid-dev | 40 | 15.0% | 42.5% | 0.0% | 4.62% |
| no smoothing of grainy pictures | synthetic-dev | 337 | 46.0% | 72.0% | 0.0% | 0.27% |
| no smoothing of grainy pictures | owid-dev | 40 | 15.0% | 42.5% | 0.0% | 4.60% |
| no second read (agreement feature) | synthetic-dev | 337 | 15.9% | 72.0% | 0.0% | 0.27% |
| no second read (agreement feature) | owid-dev | 40 | 2.5% | 42.5% | 0.0% | 4.60% |
| no rotated label pass | synthetic-dev | 337 | 44.8% | 71.0% | 0.3% | 0.28% |
| no rotated label pass | owid-dev | 40 | 15.0% | 42.5% | 0.0% | 4.60% |
| hand-set confidence instead of the fitted one | synthetic-dev | 337 | 67.1% | 72.0% | 11.9% | 0.27% |
| hand-set confidence instead of the fitted one | owid-dev | 40 | 40.0% | 42.5% | 22.5% | 4.60% |
