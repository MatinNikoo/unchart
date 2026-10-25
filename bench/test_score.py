"""Checks that the scorer does what docs/benchmark.md says, on answers made from the truth itself.

python3 bench/test_score.py
"""
import copy, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from score import score_chart, summarize

H = os.path.dirname(os.path.abspath(__file__))
truth = json.load(open(os.path.join(H, "..", "dataset", "synthetic-dev", "truth.json")))


def perfect(t):
    """an answer that copies the truth"""
    f = t["family"]
    if f in ("pie", "donut"):
        return {"ok": True, "reliable": True, "chartType": f, "series": [{"type": "pie", "points": [{"x": c, "y": v} for c, v in zip(t["x"], t["series"][0]["y"])]}]}
    S = []
    for j, s in enumerate(t["series"]):
        kind = "scatter" if f == "scatter" else ("bar" if f in ("bar", "hbar", "grouped_bar", "stacked_bar", "stacked_hbar", "histogram") or (f == "bar_line" and j == 0) else "line")
        xs = s.get("x", t.get("x"))
        if f == "histogram": xs = [(a + b) / 2 for a, b in zip(t["x"][:-1], t["x"][1:])]
        pts = [{"x": x, "y": y, "px": float(i), "py": 0.0} for i, (x, y) in enumerate(zip(xs, s["y"])) if y is not None]
        if f == "histogram":   # empty end bins draw nothing, so a perfect reader cannot list them
            while pts and not pts[0]["y"]: pts.pop(0)
            while pts and not pts[-1]["y"]: pts.pop()
        S.append({"type": kind, "points": pts})
    return {"ok": True, "reliable": True, "chartType": f, "series": S}


def main():
    fams, bad = {}, []
    for t in truth:
        if t["family"] in fams or not t.get("readable", True): continue
        fams[t["family"]] = t
    rows = []
    for f, t in fams.items():
        r = score_chart(t, perfect(t))
        if not r["success"]: bad.append((f, r["err"], r["type_ok"], r["count_ok"]))
        rows.append(r)
        # a confident answer with every value 30% of the axis too high is a silent wrong read
        w = perfect(t)
        lo, hi = (t.get("render", {}).get("vlim") or [0, 1])
        for s in w["series"]:
            for p in s["points"]: p["y"] = p["y"] + 0.3 * (hi - lo) if f not in ("pie", "donut") else p["y"]
        if f not in ("pie", "donut"):
            rw = score_chart(t, w)
            assert not rw["success"] and rw["err"] > 0.05, (f, rw["err"])
        # the same answer flagged as not reliable counts as refused, not silent
        w["reliable"] = False
        rr = score_chart(t, w)
        assert not rr["success"]
    assert not bad, bad
    s = summarize(rows)
    assert s["success"] == 1.0 and s["silent_wrong"] == 0.0
    # a missing answer is a failure, not dropped
    m = score_chart(truth[0], None)
    assert m["err"] == 1.0 and not m["success"]
    print(f"scorer checks passed on {len(rows)} families")


if __name__ == "__main__":
    main()
