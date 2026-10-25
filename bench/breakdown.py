"""Sorts every dev chart that was not read right (or was read right but refused) into one cause.

usage: python3 bench/breakdown.py <set dir> <run.json> [--split dev] [--name tag]  (prints json)

causes, checked in this order
  ok          read right and accepted
  refused_ok  read right but the confidence check refused it
  no_axis     no value axis came out (the tick numbers did not read)
  fail_other  the reader gave up for another reason (code kept in 'code')
  type        wrong chart type
  axis        the value axis is off (all values share a scale or shift error), so tick labels were misread or misplaced
  right_axis  a series drawn against a second value axis on the right was read against the left one
  x_labels    the x labels (categories or numbers) did not match
  marks       right type and axis, but points missing, extra or off (a wrong count is checked before the axis,
              since a missing point shifts the pairing and fakes an axis error)
"""
import json, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import score as S

# the scorer fits true = k * read + c over the matched points to flag a misread axis; keep those pairs
cap = {}
_pf = np.polyfit
def _polyfit(a, b, d, *k, **kw):
    cap["ab"] = (np.array(a, float), np.array(b, float))
    return _pf(a, b, d, *k, **kw)
S.np.polyfit = _polyfit

def axis_fixes(t):
    """True when one common scale and shift explains most matched points (a real axis error), False when a few
    points are far off and drag the fit (a marks error that only looks like an axis error)"""
    if "ab" not in cap: return False
    tru, est = cap["ab"]
    sp = S.value_span(t); rng = (sp[2] - sp[1]) or 1
    if sp[0] == "log": rng = np.ptp(tru) or 1
    if np.ptp(est) == 0: return False
    k, c0 = _pf(est, tru, 1)
    raw = np.mean(np.abs(est - tru) <= 0.02 * rng); fixed = np.mean(np.abs(k * est + c0 - tru) <= 0.02 * rng)
    return bool(fixed >= 0.8 and fixed >= raw + 0.2)

def main():
    sd, runf = sys.argv[1], sys.argv[2]
    split = sys.argv[sys.argv.index("--split") + 1] if "--split" in sys.argv else None
    truth = [S.v1_truth(t) for t in json.load(open(os.path.join(sd, "truth.json")))]
    idir = os.path.join(sd, "images") if os.path.isdir(os.path.join(sd, "images")) else sd
    from PIL import Image
    for t in truth:
        if t.get("family") == "histogram": S.IMG_H[t["file"]] = Image.open(os.path.join(idir, t["file"])).size[1]
    res = json.load(open(runf))
    out = []
    for t in truth:
        if split and t.get("split") != split: continue
        if t["file"] not in res or S.bad_render(t) or not t.get("readable", True): continue
        r = res.get(t["file"])
        cap.clear()
        row = S.score_chart(t, r)
        right = row["ok"] and row["type_ok"] and row["count_ok"] and row["err"] <= 0.02
        info = {"file": t["file"], "family": t["family"], "degradation": row["degradation"], "err": round(row["err"], 4)}
        if right: cause = "ok" if row["reliable"] else "refused_ok"
        elif not row["ok"]:
            cause = "no_axis" if row["code"] == "no_axis" else "fail_other"; info["code"] = row["code"]
        elif not row["type_ok"]: cause = "type"; info["pred"] = row["pred"]
        elif any(ts.get("axis") == "right" for ts in t["series"]) and not any(es.get("axis") == "right" for es in r["series"]): cause = "right_axis"
        elif not row["count_ok"]: cause = "marks"; info["count_ok"] = False
        elif row["axis_miss"] and axis_fixes(t): cause = "axis"
        elif row["x_miss"]: cause = "x_labels"
        else: cause = "marks"; info["count_ok"] = row["count_ok"]
        info["cause"] = cause
        out.append(info)
    json.dump(out, sys.stdout)

if __name__ == "__main__":
    main()
