# The first benchmark

This is the first version of the benchmark, 130 charts from matplotlib and Chart.js. The charts are in `charts/`, `charts2/` and `charts3/` at the top of the repo because the current scripts still read them. Here are the scripts that drew them (`make_charts.py`, `make_chartjs.js`), the old runner and scorer (`run.js`, `score.py`) and what they printed (`results_charts*.json`, `score_charts*.txt`). Run them from the top of the repo, for example `node legacy/run.js` with a static server on port 8790 (`npm run serve`) and then `python3 legacy/score.py results_charts.json`.
The repo keeps three sample pictures in each of those folders. `python3 bench/get_dataset.py legacy-charts` unpacks the rest from the release.
