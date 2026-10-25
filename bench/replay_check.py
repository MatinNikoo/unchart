"""Checks that a later engine reads the frozen test sets the same way as the run that was scored.

It compares two result files chart by chart (timings left out, and the list of issues compared as a set because a
later fix stopped one warning from being listed twice), and it scores the new file and compares the headline numbers.

usage: python3 bench/replay_check.py <set dir> <old results> <new results> [--split test]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP = {"ms", "ms_ocr", "ms_seg", "ms_extract", "ms_total", "ms_total", "dbg"}


def norm(v, key=None):
    if isinstance(v, dict):
        return {k: norm(x, k) for k, x in v.items() if k not in SKIP}
    if isinstance(v, list):
        if key == "issues":
            return sorted({json.dumps(i, sort_keys=True) for i in v})
        return [norm(x) for x in v]
    return v


def first_diff(a, b, path=""):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            d = first_diff(a.get(k), b.get(k), path + "/" + k)
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_diff(x, y, path + f"/{i}")
            if d:
                return d
        return None
    return None if a == b else path


def main():
    a = sys.argv[1:]
    split = a[a.index("--split") + 1] if "--split" in a else None
    d, old, new = a[0], a[1], a[2]
    O, N = json.load(open(old)), json.load(open(new))
    diffs = []
    for k in sorted(set(O) | set(N)):
        p = first_diff(norm(O.get(k)), norm(N.get(k)))
        if p:
            diffs.append((k, p))
    # score both with the same scorer and compare the headline numbers
    def score(res):
        out = res.replace(".json", "_check_scored.json")
        cmd = [sys.executable, os.path.join(HERE, "score.py"), d, res, "--out", out, "--quiet"] + (["--split", split] if split else [])
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
        o = json.load(open(out))["overall"]
        os.remove(out)
        return o
    so, sn = score(old), score(new)
    keys = ["n", "n_readable", "read_right", "success", "refused", "silent_wrong", "median_err_all", "success_answered", "within_2pct_all"]
    same = all(so.get(k) == sn.get(k) for k in keys)
    rep = {"set": d, "charts": len(N), "charts_that_differ": len(diffs), "first_differences": diffs[:10], "headline_identical": same,
           "old": {k: so.get(k) for k in keys}, "new": {k: sn.get(k) for k in keys}}
    print(json.dumps(rep, indent=1))
    sys.exit(0 if same and not diffs else 1)


if __name__ == "__main__":
    main()
