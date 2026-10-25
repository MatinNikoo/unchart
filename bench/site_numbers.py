"""The numbers on the proof strip of index.html, from the scored files of the shipped default (rules only) and results/timing.json.
python3 bench/site_numbers.py   writes results/site_numbers.json"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, "results")
FILES = {"synthetic_test_v3": "v4/test3_rules_scored.json", "families_test_v3": "v4/families_test3_rules_scored.json",
         "owid_test": "v4/owid_test_rules_scored.json", "fred": "v4/fred_rules_scored.json"}
o = {k: json.load(open(os.path.join(R, f)))["overall"] for k, f in FILES.items()}
rng = lambda key: [round(100 * min(v[key] for v in o.values()), 1), round(100 * max(v[key] for v in o.values()), 1)]
out = {"held_out_charts": sum(v["n"] for v in o.values()), "by_set": {k: v["n"] for k, v in o.items()},
       "read_right_pct": rng("read_right"), "refused_pct": rng("refused"), "silent_wrong_pct": rng("silent_wrong"),
       "median_seconds": json.load(open(os.path.join(R, "timing.json")))["all"]["median_s"]}
json.dump(out, open(os.path.join(R, "site_numbers.json"), "w"), indent=1)
print(json.dumps(out))
