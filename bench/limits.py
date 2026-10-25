"""The breakdowns quoted under Limits in the README, for the shipped default (rules only) on the held out sets.
python3 bench/limits.py   writes results/limits.json (needs the truth files, which are in the repo)"""
import json, os
from collections import defaultdict
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, "results", "v4")
right = lambda r: bool(r["ok"] and r["type_ok"] and r["count_ok"] and r["err"] <= 0.02)


def load(name):
    return [r for r in json.load(open(os.path.join(R, name)))["rows"] if r["readable"]]


def share(rows):
    return {"k": sum(map(right, rows)), "n": len(rows), "rate": round(sum(map(right, rows)) / len(rows), 4)} if rows else None


out = {}
syn = load("test3_rules_scored.json")
T = {t["file"]: t for t in json.load(open(os.path.join(ROOT, "dataset", "synthetic-test3", "truth.json")))}
out["synthetic_test_v3"] = {
    "all": share(syn),
    "by_degradation": {d: share([r for r in syn if T[r["file"]]["degradation"]["kind"] == d]) for d in sorted({T[r["file"]]["degradation"]["kind"] for r in syn})},
    "random_palette": share([r for r in syn if "palette" in T[r["file"]]]), "usual_palette": share([r for r in syn if "palette" not in T[r["file"]]]),
    "by_family": {f: share([r for r in syn if r["family"] == f]) for f in sorted({r["family"] for r in syn})}}
fam = load("families_test3_rules_scored.json")
out["families_test_v3"] = {"by_family": {f: share([r for r in fam if r["family"] == f]) for f in sorted({r["family"] for r in fam})}}
ow = load("owid_test_rules_scored.json")
OT = {t["file"]: t for t in json.load(open(os.path.join(ROOT, "dataset", "real-owid", "truth.json")))}
out["owid_test"] = {"by_chart_type": {k: share([r for r in ow if OT[r["file"]].get("owid_type", OT[r["file"]].get("family")) == k]) for k in sorted({OT[r["file"]].get("owid_type", OT[r["file"]].get("family")) for r in ow})}}
for name, f in (("synthetic_test_v3", "test3_rules_scored.json"), ("families_test_v3", "families_test3_rules_scored.json"), ("owid_test", "owid_test_rules_scored.json"), ("fred", "fred_rules_scored.json")):
    out.setdefault(name, {})["error_bar_coverage"] = round(json.load(open(os.path.join(R, f)))["overall"]["cover"], 4)
json.dump(out, open(os.path.join(ROOT, "results", "limits.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
