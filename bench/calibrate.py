"""Fit the confidence model and the error bar scale on the dev split only, and save them to src/calibration.json.

python3 bench/calibrate.py results/v4/calib_rules/dev_syn_scored.json results/v4/calib_rules/dev_owid_scored.json

The inputs are the dev reads replayed in node from cached OCR words with the hand-set confidence
(node bench/run_node.js <set> <out> --nocal, then bench/score.py), saved in results/v4/calib_rules/ for the shipped fit so the fit can be rerun.

The confidence comes from the reader's own features (how many axis labels lined up, how much of each line was traced,
how close series colors are, ...) and predicts "this chart was read right" (right type, right count, error within 2%).
For axis charts it is a small boosted tree model (150 trees of depth 2), which beat a logistic regression in
cross-validation on dev (AUC 0.78 against 0.71). Pies use a logistic regression on their own features.

The threshold is picked with 5-fold cross-validation on dev: every dev chart gets a confidence from a model that
never saw it, and the threshold is the lowest one where at most 2% of all dev charts would come back wrong but marked
reliable. The final model is then fit on all of dev. The error bar scale k is the factor that makes 95% of the true
values fall inside the reported bars on dev charts that were read right. Everything is frozen before test is scored.
"""
import json, math, os, sys
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import StratifiedKFold

H = os.path.dirname(os.path.abspath(__file__))
FEATS = ["y_inliers", "y_outliers", "y_rsd", "x_ok", "n_series", "min_cov", "doubled", "min_color", "unnamed_bars", "mono", "issues", "px",
         "y_conf", "grid", "explained", "bar_mismatch", "out_of_plot", "label_scale", "hidden", "neg_band", "dup_x", "many_pts", "x_weak",
         "no_grid_line", "sc_touch", "sc_merged", "under", "orphans", "y_right_only", "agree", "alt_diff", "seg_agree", "seg_model"]
PIE = ["ringCover", "slices", "sepUnknown", "usedLabels", "pctLabels", "tiny"]
TARGET = 0.02          # most dev charts allowed to come back wrong but marked reliable
HARD = {"dual_axis", "mono", "step_ambiguous", "legend_over_data", "pie_legend", "pie_slivers"}


def good(row):
    return row["type_ok"] and row["count_ok"] and row["err"] <= 0.02


def wrong(row):
    return (not row["type_ok"]) or (not row["count_ok"]) or row["err"] > 0.05


def fit(X, y, C=0.5):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    m = LogisticRegression(C=C, max_iter=5000).fit((X - mu) / sd, y)
    # fold the scaling into the weights so the engine can use raw features
    w = m.coef_[0] / sd
    return float(m.intercept_[0] - (w * mu).sum()), w


def prob(b, w, X):
    return 1 / (1 + np.exp(-(b + X @ w)))


def gbm(X, y):
    return GradientBoostingClassifier(n_estimators=150, max_depth=2, learning_rate=0.05, subsample=0.8, random_state=0).fit(X, y)


def export_gbm(m, names):
    """the fitted trees as plain rows [feature, threshold, left, right, value] for the engine"""
    trees = []
    for est in m.estimators_[:, 0]:
        t = est.tree_
        trees.append([[int(t.feature[i]) if t.children_left[i] >= 0 else -1, float(t.threshold[i]), int(t.children_left[i]), int(t.children_right[i]),
                       float(t.value[i][0][0])] for i in range(t.node_count)])
    x0 = np.zeros((1, len(names)))
    raw = float(m.decision_function(x0)[0])
    tot = sum(est.tree_.value[est.apply(x0)[0]][0][0] for est in m.estimators_[:, 0])
    return {"feats": names, "lr": m.learning_rate, "init": raw - m.learning_rate * float(tot), "trees": trees}


def cv_gbm(X, y, k=5):
    p = np.zeros(len(y))
    for tr, te in StratifiedKFold(k, shuffle=True, random_state=0).split(X, y):
        p[te] = gbm(X[tr], y[tr]).predict_proba(X[te])[:, 1]
    return p


def cv_probs(X, y, k=5):
    p = np.zeros(len(y))
    if len(set(y)) < 2 or min(np.bincount(y)) < k:
        b, w = fit(X, y); return prob(b, w, X)
    for tr, te in StratifiedKFold(k, shuffle=True, random_state=0).split(X, y):
        b, w = fit(X[tr], y[tr]); p[te] = prob(b, w, X[te])
    return p


def main():
    global FEATS
    # --dry prints the cross-validated numbers without writing calibration.json; --drop a,b leaves features out
    dry = "--dry" in sys.argv
    if "--drop" in sys.argv: FEATS = [f for f in FEATS if f not in sys.argv[sys.argv.index("--drop") + 1].split(",")]
    args = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] != "--drop"]
    sys.argv = sys.argv[:1] + args
    rows, res, n_all = [], {}, 0
    for p in sys.argv[1:]:
        s = json.load(open(p))
        rp = s.get("results") or p.replace("_scored.json", ".json")
        if not os.path.isabs(rp): rp = os.path.join(os.path.dirname(os.path.abspath(p)), rp)
        r = json.load(open(rp))
        for row in s["rows"]:
            if not row["readable"]: continue
            n_all += 1
            rr = r.get(row["file"])
            if rr and rr.get("ok") and rr.get("features"): rows.append((row, rr))
    hard = lambda rr: any(i.get("code") in HARD for i in (rr.get("issues") or []))
    axis = [(row, rr) for row, rr in rows if rr["chartType"] not in ("pie", "donut")]
    pies = [(row, rr) for row, rr in rows if rr["chartType"] in ("pie", "donut")]
    out = {"fit_on": [os.path.basename(p) for p in sys.argv[1:]], "n": len(axis), "n_pie": len(pies)}
    types = sorted({rr["chartType"] for _, rr in axis})
    X = np.array([[rr["features"].get(k, 0) for k in FEATS] + [1.0 if rr["chartType"] == t else 0.0 for t in types] for _, rr in axis], float)
    y = np.array([good(row) for row, _ in axis], int)
    m = gbm(X, y)
    out["gbm"] = export_gbm(m, FEATS + ["type:" + t for t in types])
    out["base_rate"] = float(y.mean())
    P = cv_gbm(X, y)
    # the exported trees must give the same answers as sklearn
    G = out["gbm"]
    def mine(x):
        z = G["init"]
        for T in G["trees"]:
            i = 0
            while T[i][0] >= 0: i = T[i][2] if x[T[i][0]] <= T[i][1] else T[i][3]
            z += G["lr"] * T[i][4]
        return 1 / (1 + math.exp(-z))
    assert max(abs(mine(x) - q) for x, q in zip(X, m.predict_proba(X)[:, 1])) < 1e-6
    pie_P = np.ones(len(pies))
    if len(pies) >= 5 and len({good(row) for row, _ in pies}) == 2:
        Xp = np.array([[rr["features"].get(k, 0) for k in PIE] for _, rr in pies], float)
        yp = np.array([good(row) for row, _ in pies], int)
        bp, wp = fit(Xp, yp)
        out["pie"] = {"b": bp, "w": {k: float(c) for k, c in zip(PIE, wp)}}
        pie_P = cv_probs(Xp, yp)
    # threshold from the cross-validated confidences: answered = confident and no hard issue
    allp = list(zip(list(P) + list(pie_P), [x for x in axis + pies]))
    curve = []
    for th in np.round(np.arange(0.30, 0.96, 0.01), 2):
        ans = [(row, rr) for p, (row, rr) in allp if p >= th and not hard(rr)]
        curve.append({"t": float(th), "silent": sum(wrong(r) for r, _ in ans) / max(1, n_all), "success": sum(good(r) for r, _ in ans) / max(1, n_all)})
    ok = [c for c in curve if c["silent"] <= TARGET]
    pick = min(ok, key=lambda c: c["t"]) if ok else max(curve, key=lambda c: c["t"])
    out["threshold"] = pick["t"]
    out["cv"] = {"target_silent": TARGET, "silent": pick["silent"], "success": pick["success"], "n_dev": n_all}
    out["cv_curve"] = curve[::5]
    # error bar scale: smallest k so that 95% of matched true values sit inside k times the reported bar,
    # on charts read right (a wrong read has no meaningful bars to cover)
    # every chart counts the same: a long line chart with a thousand points would otherwise set k on its own
    ratios, wts = [], []
    for p in sys.argv[1:]:
        s = json.load(open(p))
        for row in s["rows"]:
            cr = row.get("cover_ratios", []) if row["readable"] and not wrong(row) else []
            if cr: ratios += cr; wts += [1.0 / len(cr)] * len(cr)
    if ratios:
        o = np.argsort(ratios); cw = np.cumsum(np.array(wts)[o]); cw /= cw[-1]
        out["band_k"] = float(max(1.0, np.array(ratios)[o][np.searchsorted(cw, 0.95)]))
        out["band_n"] = len(ratios)
    if not dry: json.dump(out, open(os.path.join(H, "..", "src", "calibration.json"), "w"))
    print(json.dumps({k: v for k, v in out.items() if k not in ("w", "type", "pie", "gbm", "cv_curve")}, indent=1))


if __name__ == "__main__":
    main()
