"""Time per chart for the shipped default (rules only) in headless Chromium, on a fixed sample of every set.

python3 bench/timing.py            (needs the repo served on port 8790, for example npm run serve)

Takes every 10th chart of synthetic test v3, every 4th test chart of Our World in Data and all of FRED, reads them with
node bench/run.js and writes results/timing.json with the median and the 90th percentile of the total time (OCR, finding the
series, checks) in seconds. The run is on two CPU cores with nothing else going, so a faster machine reads faster.
"""
import json, os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SETS = [("synthetic_test_v3", "dataset/synthetic-test3", None, 10), ("owid_test", "dataset/real-owid", "test", 4), ("fred", "data/real-fred", None, 1)]


def main():
    out = {}
    os.makedirs(os.path.join(ROOT, "results", "timing"), exist_ok=True)
    for key, d, split, step in SETS:
        truth = [t for t in json.load(open(os.path.join(ROOT, d, "truth.json"))) if not split or t.get("split") == split]
        ids = [t["file"] for t in truth][::step]
        res = os.path.join(ROOT, "results", "timing", key + ".json")
        subprocess.run(["node", os.path.join(HERE, "run.js"), os.path.join(ROOT, d), res, "--ids", ",".join(ids)] + (["--split", split] if split else []),
                       check=True, stdout=subprocess.DEVNULL, cwd=ROOT)
        r = json.load(open(res))
        ms = np.array([v["ms_total"] for v in r.values() if v.get("ms_total")]) / 1000
        out[key] = {"charts": len(ms), "median_s": round(float(np.median(ms)), 2), "p90_s": round(float(np.percentile(ms, 90)), 2), "max_s": round(float(ms.max()), 2)}
        print(key, out[key])
    allms = np.concatenate([np.array([v["ms_total"] for v in json.load(open(os.path.join(ROOT, "results", "timing", k + ".json"))).values() if v.get("ms_total")]) / 1000 for k, *_ in SETS])
    out["all"] = {"charts": len(allms), "median_s": round(float(np.median(allms)), 2), "p90_s": round(float(np.percentile(allms, 90)), 2)}
    json.dump(out, open(os.path.join(ROOT, "results", "timing.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
