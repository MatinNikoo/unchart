"""Collects the scored test runs into results/v4/test_summary.json and prints a table.
v4_model is the Chromium run made with the mark model on. v4_rules_default is the shipped default (rules only, with the
confidence model fit on rules only reads), replayed in node on the same OCR words.
v4_rules_model_calibration is rules only with the calibration fit on the model reads, kept as an ablation."""
import json, os
H = os.path.dirname(os.path.abspath(__file__))
out = {}
for name in ["test3", "families_test3", "owid_test", "fred"]:
    for v, suf in [("v4_model", ""), ("v4_model_node_replay", "_node"), ("v4_rules_model_calibration", "_noseg"), ("v4_rules_default", "_rules"), ("v3_engine", "_v3")]:
        p = os.path.join(H, f"{name}{suf}_scored.json")
        if not os.path.exists(p): continue
        a = json.load(open(p))["overall"]
        out.setdefault(name, {})[v] = {k: a.get(k) for k in ["n", "n_readable", "read_right", "success", "silent_wrong", "success_answered", "median_err_all", "refused"]}
# test v3 charts drawn with a random palette against the rest (engine v4, Chromium run)
T = {t["file"]: t for t in json.load(open(os.path.join(H, "..", "..", "dataset", "synthetic-test3", "truth.json")))}
# the Chromium run with the mark model on (the experimental setting)
rows = [r for r in json.load(open(os.path.join(H, "test3_scored.json")))["rows"] if r["readable"]]
right = lambda r: r["type_ok"] and r["count_ok"] and r["err"] <= 0.02
for k, sel in [("random_palette", True), ("look_palette", False)]:
    rs = [r for r in rows if ("palette" in T[r["file"]]) == sel]
    out.setdefault("test3_by_palette", {})[k] = {"n": len(rs), "read_right_n": sum(map(right, rs)), "read_right": sum(map(right, rs)) / len(rs)}
json.dump(out, open(os.path.join(H, "test_summary.json"), "w"), indent=1)
for name, d in out.items():
    if name == "test3_by_palette": print(name, d); continue
    for v, a in d.items():
        f = lambda x: "n/a" if x is None else f"{100 * x:.1f}"
        print(f"{name:15} {v:12} n={a['n']:4} read right {f(a['read_right'])}  accepted right {f(a['success'])}  silent wrong {f(a['silent_wrong'])}  right when accepted {f(a['success_answered'])}  median err {f(a['median_err_all'])}")
