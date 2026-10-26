"""Unchart (the shipped default, rules only) against DePlot on the same charts.

python3 bench/vs_deplot.py

Reads the Unchart default run on the charts DePlot was run on (results/vs_deplot/*_unchart.json, made with
node bench/run.js <set> <out> --ids ...) and the DePlot runs (results/deplot_*.json), scores both with bench/score.py,
and writes results/vs_deplot.json and results/vs_deplot.md. DePlot does not name the chart type and never refuses,
so both tools are compared on read right with the type left out. Fisher's exact test gives the p value for the
difference in read right. The samples are small, so read the p values before the percentages.
"""
import json, math, os, subprocess, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
R = os.path.join(ROOT, "results")
SETS = [
    ("Synthetic test v1 (27 charts)", "dataset/synthetic-test", "synthetic_test", "synthetic_test_scored.json"),
    ("FRED (5 charts)", "data/real-fred", "fred", "v1/fred_scored.json"),
]


def score(setdir, res):
    fd, out = tempfile.mkstemp(suffix=".json")
    os.close(fd)
    subprocess.run([sys.executable, os.path.join(HERE, "score.py"), os.path.join(ROOT, setdir), res, "--out", out, "--quiet"], check=True, stdout=subprocess.DEVNULL)
    d = json.load(open(out))
    os.remove(out)
    return d


def fisher(a, b, c, d):
    """two sided Fisher exact p for the table [[a, b], [c, d]]"""
    n, r1, c1 = a + b + c + d, a + b, a + c
    pr = lambda x: math.comb(r1, x) * math.comb(n - r1, c1 - x) / math.comb(n, c1)
    p0 = pr(a)
    return sum(pr(x) for x in range(max(0, c1 - (n - r1)), min(r1, c1) + 1) if pr(x) <= p0 * (1 + 1e-9))


def summary(rows):
    rows = [r for r in rows if r["readable"]]
    right = lambda r: bool(r["ok"] and r["count_ok"] and r["err"] <= 0.02)
    e = np.array([r["err"] if r["ok"] else 1.0 for r in rows])
    refused = [(not r["ok"]) or (not r["reliable"]) for r in rows]
    ms = [r["ms"] for r in rows if r.get("ms")]
    return {"n": len(rows), "read_right_k": int(sum(right(r) for r in rows)), "median_err": float(np.median(e)),
            "within_5pct": float(np.mean(e <= 0.05)), "refused_k": int(sum(refused)),
            "silent_wrong_k": int(sum((not rf) and (r["err"] > 0.05 or not r["count_ok"]) for r, rf in zip(rows, refused))),
            "ms_median": float(np.median(ms)) if ms else None}


def main():
    out = {"sets": {}}
    md = ["Unchart (shipped default, rules only) and DePlot on the same charts. Read right leaves the chart type out because DePlot does not name one.",
          "Fisher p is the two sided exact test on read right. These samples are small and the differences are not significant at the 5% level when p is above 0.05.", ""]
    md.append("| Set | Tool | Charts | Read right | Median error | Within 5% | Refused | Silent wrong | Time per chart |")
    md.append("|---|---|---|---|---|---|---|---|---|")
    for name, setdir, key, v1 in SETS:
        up = os.path.join(R, "vs_deplot", key + "_unchart.json")
        dp = os.path.join(R, f"deplot_{key}.json")
        if not (os.path.exists(up) and os.path.exists(dp)):
            continue
        U, D = score(setdir, up), score(setdir, dp)
        su, sd = summary(U["rows"]), summary(D["rows"])
        a, b = su["read_right_k"], su["n"] - su["read_right_k"]
        c, d = sd["read_right_k"], sd["n"] - sd["read_right_k"]
        p = fisher(a, b, c, d)
        # how hard the subset is: the earlier v1 engine run on the whole set against the same run on the subset
        sub = None
        v1p = os.path.join(R, v1)
        if os.path.exists(v1p):
            V = json.load(open(v1p))["rows"]
            files = {r["file"] for r in D["rows"]}
            right = lambda r: bool(r["ok"] and r["count_ok"] and r["err"] <= 0.02)
            whole = [r for r in V if r["readable"]]
            part = [r for r in whole if r["file"] in files]
            sub = {"engine": "v1", "whole_n": len(whole), "whole_read_right": float(np.mean([right(r) for r in whole])),
                   "subset_n": len(part), "subset_read_right": float(np.mean([right(r) for r in part]))}
        out["sets"][key] = {"name": name, "unchart": su, "deplot": sd, "fisher_p": p, "subset_difficulty": sub}
        for tool, s in (("Unchart v4", su), ("DePlot", sd)):
            md.append(f"| {name} | {tool} | {s['n']} | {s['read_right_k']} of {s['n']} ({100 * s['read_right_k'] / s['n']:.1f}%) | {100 * s['median_err']:.2f}% | {100 * s['within_5pct']:.1f}% | "
                      f"{s['refused_k']} | {s['silent_wrong_k']} | {s['ms_median'] / 1000:.1f} s |" if s["ms_median"] else
                      f"| {name} | {tool} | {s['n']} | {s['read_right_k']} of {s['n']} | {100 * s['median_err']:.2f}% | {100 * s['within_5pct']:.1f}% | {s['refused_k']} | {s['silent_wrong_k']} | n/a |")
        md.append(f"| | Fisher p | | {'below 0.001' if p < 0.001 else format(p, '.3f')} | | | | | |")
        if sub:
            md.append(f"| | Subset check | | the v1 engine read right {100 * sub['subset_read_right']:.1f}% of these {sub['subset_n']} and {100 * sub['whole_read_right']:.1f}% of all {sub['whole_n']} readable charts in the set | | | | | |")
    json.dump(out, open(os.path.join(R, "vs_deplot.json"), "w"), indent=1)
    open(os.path.join(R, "vs_deplot.md"), "w").write("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
