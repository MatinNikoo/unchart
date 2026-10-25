"""How well the check for bars that skip zero works.

python3 bench/misleading.py

Recall comes from the 20 old v1 charts in charts3 (10 bar charts that skip zero, 10 that start at zero), read by the
shipped default (results/v4/charts3.json, made with node bench/run.js charts3 results/v4/charts3.json). That is a small sample.
False flags come from the held out synthetic sets, where every bar chart starts at zero, so any flag there is a false one.
Writes results/misleading.json.
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, "results")

res = json.load(open(os.path.join(R, "v4", "charts3.json")))
truth = {t["file"]: t for t in json.load(open(os.path.join(ROOT, "charts3", "truth.json")))}
flag = {f: any(x.get("code") == "truncated" for x in (r.get("flags") or [])) for f, r in res.items()}
out = {"charts3": {"skips_zero": sum(truth[f]["scale"] == "trunc" for f in flag), "skips_zero_flagged": sum(flag[f] for f in flag if truth[f]["scale"] == "trunc"),
                   "starts_at_zero": sum(truth[f]["scale"] != "trunc" for f in flag), "starts_at_zero_flagged": sum(flag[f] for f in flag if truth[f]["scale"] != "trunc"),
                   "engine": "v4 default"}}
for name, f in (("synthetic_test_v2", "synthetic_test2_scored.json"), ("synthetic_test_v3", "v4/test3_rules_scored.json")):
    rows = [r for r in json.load(open(os.path.join(R, f)))["rows"] if r["trunc_true"] is not None and r["ok"]]
    out[name] = {"bar_charts_that_start_at_zero": sum(not r["trunc_true"] for r in rows), "flagged_anyway": sum(r["trunc_flag"] for r in rows if not r["trunc_true"]),
                 "skip_zero_charts": sum(bool(r["trunc_true"]) for r in rows)}
json.dump(out, open(os.path.join(R, "misleading.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
