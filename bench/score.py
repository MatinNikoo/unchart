"""Scores extraction results against the true data behind each chart.

python3 bench/score.py <set dir> <results.json> [--split dev|test] [--out results/x_scored.json] [--quiet]

Every chart counts, including the ones the reader failed on or refused. The metrics are defined in docs/benchmark.md.
The main ones per chart are err (mean point error as a share of the value axis range, 1.0 for a failure), success
(right type, every series and point found, err at most 2%, not refused), refused, silent wrong (marked reliable but
wrong) and axis_miss (the values are off by a common scale or shift).
"""
import json, os, sys, re, math
from datetime import date
import numpy as np
from scipy.optimize import linear_sum_assignment

BARS = {"bar", "hbar", "grouped_bar", "stacked_bar", "stacked_hbar", "histogram"}
# the families added later are scored like the family they read as (a lollipop is a bar per category, a bubble
# chart is a scatter plot of the bubble centres, a slope chart is a line with two points)
BASE = {"stacked100": "stacked_bar", "lollipop": "bar", "dot_plot": "hbar", "slope": "line", "waterfall": "bar", "bubble": "scatter",
        "errorbar": "bar", "dual_axis": "line"}
# chart types that count as right for them
ALSO = {"lollipop": {"scatter"}, "dot_plot": {"scatter", "grouped_bar", "stacked_hbar"}, "errorbar": {"bar"}, "waterfall": set()}
LINES = {"line", "step", "area", "stacked_area"}
IMG_H = {}   # picture heights, filled by main() when the images are there


def v1_truth(t):
    """the three v1 sets (charts, charts2, charts3) use an older truth format: put it in the new one"""
    if "family" in t: return t
    xs = t.get("x", [])
    fam = t["type"]
    out = {"file": t["file"], "family": fam, "renderer": "v1_" + str(t.get("style", "")), "readable": True,
           "xkind": "cat" if any(isinstance(v, str) for v in xs) else "num", "x": xs,
           "degradation": {"kind": "jpeg" if t["file"].lower().endswith((".jpg", ".jpeg")) else "clean"}}
    out["series"] = [{"name": f"s{j}", "y": y, **({"x": xs} if fam == "scatter" else {})} for j, y in enumerate(t["series"])]
    return out


def bad_render(t):
    # ECharts can only stack series on a category x axis. Given a number x axis it draws the stacked areas as
    # broken polygons that do not match the data (found on dev chart d0278, see dataset/README.md). These charts
    # are left out by this rule on their settings, in dev and test alike, and listed in the scored output.
    # Vega-Lite drew histograms whose value axis starts below zero as thin ticks at the counts, not bars (dev d0240).
    vl = (t.get("render", {}).get("vlim") or [0])[0]
    return (t.get("renderer") == "echarts" and t.get("family") == "stacked_area" and t.get("xkind") == "num") or \
        (t.get("renderer") == "vegalite" and t.get("family") == "histogram" and vl < 0)



def days(s):
    s = str(s)
    m = re.match(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$", s)
    if m: return (date(int(m[1]), int(m[2]), int(m[3] or 1)) - date(1970, 1, 1)).days
    m = re.match(r"^(\d{2})-(\d{2})$", s)        # month-day with no year
    if m: return ("md", int(m[1]), int(m[2]))
    return None


def norm_label(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


def value_span(t, axis="left"):
    r = t.get("render", {})
    lim = r.get("vlim_right") if axis == "right" else r.get("vlim")
    if lim and None not in lim[:2] and lim[1] > lim[0]:
        if t.get("ylog"): return ("log", math.log10(max(lim[0], 1e-12)), math.log10(lim[1]))
        return ("lin", lim[0], lim[1])
    ser = [s for s in t["series"] if (s.get("axis", "left") == axis)] or t["series"]
    ys = [v for s in ser for v in s["y"] if v is not None]
    lo, hi = min(ys), max(ys)
    if t["family"] in BARS or t["family"] in ("bar_line",): lo, hi = min(lo, 0), max(hi, 0)
    if t.get("ylog"): return ("log", math.log10(max(min(ys), 1e-12)), math.log10(max(ys)))
    if hi - lo < 1e-12: hi = lo + 1
    return ("lin", lo, hi)


def verr(est, tru, span):
    kind, lo, hi = span
    if est is None or not np.isfinite(est): return 1.0
    if kind == "log":
        if est <= 0 or tru <= 0: return 1.0
        return min(1.0, abs(math.log10(est) - math.log10(tru)) / (hi - lo))
    return min(1.0, abs(est - tru) / (hi - lo))


def pair_bars(tru_vals, tru_cats, ext, span):
    """error of one extracted bar series against one true series, plus matched pairs"""
    pts = [p for p in ext["points"]]
    pairs = []
    if tru_cats is not None:
        lab = {norm_label(p["x"]): p for p in pts if isinstance(p["x"], str)}
        hits = sum(1 for c in tru_cats if norm_label(c) in lab)
        if hits >= max(2, 0.6 * len(tru_cats)) and len(set(norm_label(c) for c in tru_cats)) == len(tru_cats):
            errs = []
            # a category whose name was misread ("Sall" for "Sal 1") takes the leftover bar in the same place in order
            used = {id(p) for c in tru_cats for p in [lab.get(norm_label(c))] if p}
            left = [p for p in pts if id(p) not in used]
            missing = [k for k, c in enumerate(tru_cats) if norm_label(c) not in lab]
            spare = dict(zip(missing, left)) if len(left) == len(missing) else {}
            for k, (c, v) in enumerate(zip(tru_cats, tru_vals)):
                p = lab.get(norm_label(c)) or spare.get(k)
                e = verr(p["y"], v, span) if p else 1.0
                errs.append(e)
                if p: pairs.append((v, p["y"], p.get("err")))
            extra = max(0, len(pts) - len(tru_vals)) if not spare else 0
            return float(np.mean(errs + [1.0] * extra)), pairs, len(pts) == len(tru_vals)
    n = max(len(pts), len(tru_vals))
    errs = []
    for i in range(n):
        if i < len(pts) and i < len(tru_vals):
            errs.append(verr(pts[i]["y"], tru_vals[i], span)); pairs.append((tru_vals[i], pts[i]["y"], pts[i].get("err")))
        else: errs.append(1.0)
    return float(np.mean(errs)), pairs, len(pts) == len(tru_vals)


def ext_x(p, mode, t0=None):
    x = p.get("x")
    if mode == "date":
        if p.get("xv") is not None: return float(p["xv"])
        d = days(x)
        if isinstance(d, tuple): return d
        if isinstance(x, (int, float)): return float(x)
        return d
    return float(x) if isinstance(x, (int, float)) else None


def pair_line(t, ts, ext, span):
    """error of one extracted line against one true series"""
    xk = t["xkind"]
    tx = ts.get("x", t.get("x"))
    ty = np.array([np.nan if v is None else v for v in ts["y"]], float)
    pts = sorted([p for p in ext["points"] if p.get("px") is not None], key=lambda p: p["px"])
    if len(pts) < 2: return 1.0, [], False, False
    ey = np.array([p["y"] for p in pts], float)
    x_miss = False
    if xk == "cat":
        if len(pts) == len(ty):
            e = [verr(a, b, span) for a, b in zip(ey, ty)]
            return float(np.mean(e)), list(zip(ty, ey, [p.get("err") for p in pts])), True, False
        tx_n = np.linspace(0, 1, len(ty)); ex_n = (np.array([p["px"] for p in pts]) - pts[0]["px"]) / max(1e-9, pts[-1]["px"] - pts[0]["px"])
        yi = np.interp(tx_n, ex_n, ey)
        return float(np.mean([verr(a, b, span) for a, b in zip(yi, ty)])), [], False, False
    if xk == "date":
        txd = np.array([days(v) for v in tx], float)
        ex = [ext_x(p, "date") for p in pts]
        if all(isinstance(v, tuple) for v in ex):       # month-day without a year: put them in the truth's year
            y0 = date.fromordinal(date(1970, 1, 1).toordinal() + int(txd[0])).year
            exd = []
            for v in ex:
                try: exd.append((date(y0, v[1], v[2]) - date(1970, 1, 1)).days)
                except ValueError: exd.append(np.nan)
            exd = np.array(exd, float)
            for k in range(1, len(exd)):
                while exd[k] < exd[k - 1] - 180: exd[k] += 365
            ex = exd
        elif all(isinstance(v, float) for v in ex if v is not None) and all(v is not None for v in ex) and 1700 < np.nanmedian(ex) < 2300:
            # the reader saw plain year numbers: compare in decimal years
            txd = 1970 + txd / 365.2425; ex = np.array(ex, float)
        else:
            ex = np.array([v if isinstance(v, (int, float)) else np.nan for v in ex], float)
        tx = txd
    else:
        tx = np.array(tx, float)
        ex = np.array([ext_x(p, "num") if ext_x(p, "num") is not None else np.nan for p in pts], float)
    ok = np.isfinite(ex) & np.isfinite(ey)
    if ok.sum() < 2: x_miss = True
    else:
        ex, ey = ex[ok], ey[ok]
        o = np.argsort(ex); ex, ey = ex[o], ey[o]
        tr = np.nanmax(tx) - np.nanmin(tx)
        ov = min(ex.max(), np.nanmax(tx)) - max(ex.min(), np.nanmin(tx))
        if tr > 0 and ov < 0.5 * tr: x_miss = True
    if x_miss:
        # the x axis was misread: still judge the shape by position along the plot
        ex = np.array([p["px"] for p in pts], float); ey = np.array([p["y"] for p in pts], float)
        ex = (ex - ex.min()) / max(1e-9, np.ptp(ex)); tx = (tx - np.nanmin(tx)) / max(1e-9, np.nanmax(tx) - np.nanmin(tx))
    m = np.isfinite(ty) & np.isfinite(tx)
    tx, ty = tx[m], ty[m]
    yi = np.interp(tx, ex, ey)
    cov = (tx >= ex.min() - 1e-6 - 0.02 * np.ptp(tx)) & (tx <= ex.max() + 1e-6 + 0.02 * np.ptp(tx))
    e = np.array([verr(a, b, span) for a, b in zip(yi, ty)])
    e[~cov] = np.maximum(e[~cov], 0.5)
    # error bars: the nearest extracted point's band
    pairs = []
    errs = [p.get("err") for p in pts]
    pxs = np.array([ext_x(p, "date" if xk == "date" else "num") if not x_miss else 0 for p in pts], dtype=object)
    for a, b, xx in zip(ty, yi, tx):
        k = int(np.argmin(np.abs(ex - xx)))
        pairs.append((a, b, errs[k] if k < len(errs) and abs(ex[k] - xx) < 0.02 * max(1e-9, np.ptp(ex)) else None))
    return float(e.mean()), pairs, True, x_miss


def scatter_err(t, ext_series):
    T = np.array([(x, y) for s in t["series"] for x, y in zip(s["x"], s["y"])], float)
    E = np.array([(p["x"], p["y"]) for s in ext_series for p in s["points"] if isinstance(p["x"], (int, float))], float)
    if len(E) == 0: return 1.0, False
    xl = t.get("render", {}).get("xlim") or [T[:, 0].min(), T[:, 0].max()]
    yl = t.get("render", {}).get("vlim") or [T[:, 1].min(), T[:, 1].max()]
    sx, sy = max(1e-9, xl[1] - xl[0]), max(1e-9, yl[1] - yl[0])
    if t.get("ylog"):
        T = T.copy(); E = E.copy(); T[:, 1] = np.log10(np.maximum(T[:, 1], 1e-12)); E[:, 1] = np.log10(np.maximum(E[:, 1], 1e-12)); sy = math.log10(yl[1]) - math.log10(max(yl[0], 1e-12))
    d = np.sqrt(((E[None, :, 0] - T[:, None, 0]) / sx) ** 2 + ((E[None, :, 1] - T[:, None, 1]) / sy) ** 2)
    a, b = np.minimum(d.min(1), 1).mean(), np.minimum(d.min(0), 1).mean()
    return float((a + b) / 2), abs(len(E) - len(T)) <= max(1, 0.05 * len(T))


def pie_err(t, ext):
    tv = np.array(t["series"][0]["y"], float); tv = tv / tv.sum() * 100
    ev = np.array([p["y"] for p in ext["points"]], float)
    n = max(len(tv), len(ev))
    best = 1.0
    # match by name when the names were read, else by order around the circle (either direction, any start)
    lab = {norm_label(p["x"]): p["y"] for p in ext["points"]}
    if sum(norm_label(c) in lab for c in t["x"]) >= 0.7 * len(tv):
        e = [abs(lab.get(norm_label(c), 0) - v) / 100 for c, v in zip(t["x"], tv)]
        best = float(np.mean(e + [abs(v) / 100 for k, v in lab.items() if k not in {norm_label(c) for c in t["x"]}] or [0]))
        if len(ev) != len(tv): best = max(best, float(np.mean(e)))
    a = np.zeros(n); a[:len(tv)] = tv
    for seq in (ev, ev[::-1]):
        b = np.zeros(n); b[:len(seq)] = seq
        for k in range(n):
            best = min(best, float(np.mean(np.abs(np.roll(b, k) - a)) / 100))
    return best, len(ev) == len(tv), list(zip(sorted(tv), sorted(ev[:len(tv)]) if len(ev) >= len(tv) else sorted(ev), [None] * len(tv)))


def score_chart(t, r):
    fam0 = t["family"]; fam = BASE.get(fam0, fam0)
    row = {"file": t["file"], "family": fam0, "renderer": t.get("renderer", "?"), "look": t.get("look", ""), "degradation": t.get("degradation", {}).get("kind", t.get("degrade", "clean")),
           "readable": t.get("readable", True), "pred": None, "ok": False, "reliable": False, "confidence": 0.0, "err": 1.0, "success": False,
           "type_ok": False, "count_ok": False, "axis_miss": None, "x_miss": False, "ms": None, "cover_n": 0, "cover_in": 0, "code": None,
           "trunc_true": None, "trunc_flag": None, "cover_ratios": []}
    if r is None: row["code"] = "missing"; return row
    row["ms"] = r.get("ms_total") or ((r.get("ms_ocr") or 0) + (r.get("ms_extract") or 0))
    row["ok"], row["reliable"], row["confidence"], row["pred"], row["code"] = bool(r.get("ok")), bool(r.get("reliable")), float(r.get("confidence") or 0), r.get("chartType"), r.get("code")
    r_vlim = t.get("render", {}).get("vlim")
    if fam in ("bar", "grouped_bar", "stacked_bar", "bar_line") and r_vlim and not t.get("ylog"):
        row["trunc_true"] = r_vlim[0] > 1e-9 * max(1, abs(r_vlim[1]))
        row["trunc_flag"] = any(f.get("code") == "truncated" for f in (r.get("flags") or []))
    if not r.get("ok"):
        return row
    # with a single series, stacked or grouped bars are plain bars and a stacked area is an area
    SAME1 = {"stacked_bar": "bar", "grouped_bar": "bar", "stacked_hbar": "hbar", "stacked_area": "area"}
    one = len(t.get("series", [])) == 1
    row["type_ok"] = (row["pred"] in (fam, fam0) or (one and SAME1.get(fam) == row["pred"]) or row["pred"] in ALSO.get(fam0, set())) and (fam0 != "waterfall" or row["pred"] == "waterfall")
    ext = r["series"]
    pairs = []
    if fam in ("pie", "donut"):
        ps = [s for s in ext if s["type"] == "pie"]
        if not ps: return row
        e, cnt, pairs = pie_err(t, ps[0])
        row.update(err=e, count_ok=cnt)
    elif fam == "scatter":
        e, cnt = scatter_err(t, [s for s in ext if s["type"] == "scatter"] or ext)
        row.update(err=e, count_ok=cnt and len([s for s in ext if s["type"] == "scatter"]) == len(t["series"]))
    else:
        T = t["series"]
        if fam == "histogram":
            # empty bins at either end draw nothing, so no reader can know they exist; they are not scored.
            # End bins under a pixel tall (a count of 1 out of 900) are drawn by some renderers and rounded away
            # by others, so a read with or without them is fine. Without counts as the default.
            y = T[0]["y"]
            lim = t.get("render", {}).get("vlim") or [0, max(y)]
            px1 = (lim[1] - lim[0]) / (0.75 * IMG_H.get(t["file"], t.get("h", 400)))
            def trim(th):
                a, b = 0, len(y)
                while a < b and (not y[a] or y[a] < th): a += 1
                while b > a and (not y[b - 1] or y[b - 1] < th): b -= 1
                return y[a:b]
            strict = trim(1e-12)
            nb = max([len(s["points"]) for s in ext if s["type"] == "bar"] or [0])
            # drop sub-pixel end bins one at a time (right end first) while the read has fewer bins
            ys = list(strict)
            while len(ys) > nb and ys and (ys[-1] < px1 or ys[0] < px1):
                if ys[-1] < px1: ys.pop()
                else: ys.pop(0)
            T = [dict(T[0], y=ys if len(ys) == nb else strict)]
        if fam == "bar_line":
            groups = [([T[0]], "bar"), ([T[1]], "line")]
        elif fam in BARS:
            groups = [(T, "bar")]
        else:
            groups = [(T, "line")]
        errs, cnt_ok = [], True
        for ts_list, kind in groups:
            cand = [s for s in ext if (s["type"] == "bar") == (kind == "bar")] or ext
            M = np.ones((len(ts_list), len(cand)))
            info = {}
            for i, ts in enumerate(ts_list):
                span = value_span(t, ts.get("axis", "left"))
                for j, es in enumerate(cand):
                    if kind == "bar":
                        cats = t.get("x") if t.get("xkind") == "cat" and fam != "histogram" else None
                        e, pr, c = pair_bars(ts["y"], cats, es, span); info[i, j] = (pr, c, False)
                    else:
                        e, pr, c, xm = pair_line(t, ts, es, span); info[i, j] = (pr, c, xm)
                    M[i, j] = e
            ri, ci = linear_sum_assignment(M) if len(cand) else ([], [])
            got = dict(zip(ri, ci))
            for i in range(len(ts_list)):
                if i in got:
                    errs.append(M[i, got[i]]); pr, c, xm = info[i, got[i]]; pairs += pr; cnt_ok &= bool(c); row["x_miss"] |= bool(xm)
                else: errs.append(1.0); cnt_ok = False
            if len(cand) != len(ts_list) and kind == "bar": cnt_ok = False
            if kind == "line" and len([s for s in ext if s["type"] != "bar"]) != len(ts_list): cnt_ok = False
        row.update(err=float(np.mean(errs)), count_ok=cnt_ok)
    # a misread axis shows up as a common scale or shift in all the recovered values
    if len(pairs) >= 3 and fam not in ("pie", "donut"):
        a = np.array([p[0] for p in pairs], float); b = np.array([p[1] for p in pairs], float)
        sp = value_span(t)
        if sp[0] == "log":
            ok = (a > 0) & (b > 0); a, b = np.log10(a[ok]), np.log10(b[ok])
        if len(a) >= 3 and np.ptp(a) > 0:
            k, c0 = np.polyfit(a, b, 1); mid = (a.min() + a.max()) / 2
            rng = sp[2] - sp[1]
            row["axis_miss"] = bool(abs(k - 1) > 0.05 or abs(k * mid + c0 - mid) > 0.03 * rng)
    # do the error bars hold the truth?
    for a, b, e in pairs:
        if e is None or b is None or not np.isfinite(b): continue
        row["cover_n"] += 1
        lo, hi = (e if isinstance(e, (list, tuple)) else (e, e))
        w = hi if a > b else lo
        if w > 0: row["cover_ratios"].append(round(abs(a - b) / w, 4))
        if b - lo - 1e-9 * abs(b) <= a <= b + hi + 1e-9 * abs(b): row["cover_in"] += 1
    row["success"] = bool(row["ok"] and row["type_ok"] and row["count_ok"] and row["err"] <= 0.02 and row["reliable"] and t.get("readable", True))
    return row


def summarize(rows):
    if not rows: return {}
    n = len(rows)
    R = [r for r in rows if r["readable"]]
    U = [r for r in rows if not r["readable"]]
    refused = lambda r: (not r["ok"]) or (not r["reliable"])
    answered = [r for r in R if not refused(r)]
    errs = np.array([r["err"] if r["ok"] else 1.0 for r in R])
    s = {
        "n": n, "n_readable": len(R),
        "success": float(np.mean([r["success"] for r in R])) if R else None,
        # right type, count and values whether or not the reader trusted its own answer
        "read_right": float(np.mean([r["ok"] and r["type_ok"] and r["count_ok"] and r["err"] <= 0.02 for r in R])) if R else None,
        "median_err_all": float(np.median(errs)) if R else None,
        "mean_err_all": float(np.mean(errs)) if R else None,
        "within_1pct_all": float(np.mean(errs <= 0.01)) if R else None,
        "within_2pct_all": float(np.mean(errs <= 0.02)) if R else None,
        "fail": float(np.mean([not r["ok"] for r in R])) if R else None,
        "refused": float(np.mean([refused(r) for r in R])) if R else None,
        "median_err_answered": float(np.median([r["err"] for r in answered])) if answered else None,
        "success_answered": float(np.mean([r["success"] for r in answered])) if answered else None,
        "silent_wrong": float(np.mean([(not refused(r)) and (r["err"] > 0.05 or not r["type_ok"] or not r["count_ok"]) for r in R])) if R else None,
        "wrong_type": float(np.mean([r["ok"] and not r["type_ok"] for r in R])) if R else None,
        "axis_miss": float(np.mean([bool(r["axis_miss"]) for r in R if r["axis_miss"] is not None])) if any(r["axis_miss"] is not None for r in R) else None,
        "x_miss": float(np.mean([r["x_miss"] for r in R if r["ok"]])) if any(r["ok"] for r in R) else None,
        # refusals that were not needed: the read was right but flagged anyway
        "false_flag": float(np.mean([r["ok"] and not r["reliable"] and r["err"] <= 0.02 and r["type_ok"] and r["count_ok"] for r in R])) if R else None,
        "unreadable_refused": float(np.mean([refused(r) for r in U])) if U else None, "n_unreadable": len(U),
        "ms_median": float(np.median([r["ms"] for r in rows if r["ms"]])) if any(r["ms"] for r in rows) else None,
        "cover": (sum(r["cover_in"] for r in R) / max(1, sum(r["cover_n"] for r in R))) if R else None,
    }
    tr = [r for r in rows if r["trunc_true"] is not None and r["ok"]]
    if tr:
        pos = [r for r in tr if r["trunc_true"]]; neg = [r for r in tr if not r["trunc_true"]]
        s["trunc_caught"] = f"{sum(r['trunc_flag'] for r in pos)}/{len(pos)}"
        s["trunc_false"] = f"{sum(r['trunc_flag'] for r in neg)}/{len(neg)}"
    return s


def main():
    a = sys.argv[1:]
    d, rp = a[0], a[1]
    split = a[a.index("--split") + 1] if "--split" in a else None
    outp = a[a.index("--out") + 1] if "--out" in a else None
    truth = [v1_truth(t) for t in json.load(open(os.path.join(d, "truth.json")))]
    res = json.load(open(rp))
    idir = os.path.join(d, "images") if os.path.isdir(os.path.join(d, "images")) else d
    try:
        from PIL import Image
        for t in truth:
            if t.get("family") == "histogram" and os.path.exists(os.path.join(idir, t["file"])):
                IMG_H[t["file"]] = Image.open(os.path.join(idir, t["file"])).size[1]
    except ImportError:
        pass
    keep = [t for t in truth if (not split or t.get("split", split) == split) and t["file"] in res]
    bad = [t["file"] for t in keep if bad_render(t)]
    rows = [score_chart(t, res.get(t["file"])) for t in keep if not bad_render(t)]
    by = {}
    for key in ("family", "renderer", "degradation"):
        by[key] = {k: summarize([r for r in rows if r[key] == k]) for k in sorted({r[key] for r in rows})}
    out = {"results": os.path.relpath(rp, os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "overall": summarize(rows), "by": by, "rows": rows, "excluded_bad_render": bad}
    if "--quiet" not in a:
        print(f"{'file':12} {'family':13} {'pred':13} {'err':>7} ok rel  conf  succ")
        for r in rows:
            print(f"{r['file']:12} {r['family']:13} {str(r['pred']):13} {r['err']*100:6.2f}% {'y' if r['ok'] else '-'}  {'y' if r['reliable'] else '-'}  {r['confidence']:.2f}  {'Y' if r['success'] else '.'} {r['code'] or ''}")
    o = out["overall"]
    pc = lambda v: "n/a" if v is None else f"{v*100:.1f}%"
    print(f"\nALL n={o['n']} success {pc(o['success'])} median err {pc(o['median_err_all'])} refused {pc(o['refused'])} fail {pc(o['fail'])} silent wrong {pc(o['silent_wrong'])} wrong type {pc(o['wrong_type'])} axis miss {pc(o['axis_miss'])} false flag {pc(o['false_flag'])} cover {pc(o['cover'])}")
    for k, v in by["family"].items():
        print(f"  {k:13} n={v['n']:3d} success {pc(v['success'])} median err {pc(v['median_err_all'])} refused {pc(v['refused'])} silent {pc(v['silent_wrong'])} type {pc(v['wrong_type'])}")
    if outp:
        os.makedirs(os.path.dirname(outp) or ".", exist_ok=True)
        json.dump(out, open(outp, "w"), indent=1)


if __name__ == "__main__":
    main()
