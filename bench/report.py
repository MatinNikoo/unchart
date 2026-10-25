"""Collect every scored set into results/summary.json, results/tables.md and the figures in docs/img.

python3 bench/report.py
"""
import json, os, glob, math
import numpy as np

H = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(H, "..")
R = os.path.join(ROOT, "results")
IMG = os.path.join(ROOT, "docs", "img")
SETS = {"synthetic_test2": "dataset/synthetic-test2", "families_test": "dataset/synthetic-families-test",
        "synthetic_test": "dataset/synthetic-test", "owid_test": "dataset/real-owid", "fred": "data/real-fred", "families_dev": "dataset/synthetic-families-dev",
        "synthetic_dev": "dataset/synthetic-dev", "owid_dev": "dataset/real-owid",
        "v2_charts": "charts", "v2_charts2": "charts2", "v2_charts3": "charts3"}
NAMES = {"synthetic_test2": "Synthetic test v2 (held out)", "families_test": "Newer families test (held out)", "families_dev": "Newer families (dev)",
         "synthetic_test": "Synthetic test v1 (engine v1 run)", "owid_test": "Our World in Data (held out)", "fred": "FRED",
         "synthetic_dev": "Synthetic dev", "owid_dev": "Our World in Data (dev)", "v2_charts": "v1 set: matplotlib",
         "v2_charts2": "v1 set: Chart.js and JPEG", "v2_charts3": "v1 set: truncated bars"}


def load(name):
    p = os.path.join(R, name + "_scored.json")
    if not os.path.exists(p): return None
    s = json.load(open(p))
    tp = os.path.join(ROOT, SETS[name], "truth.json")
    truth = {t["file"]: t for t in json.load(open(tp))} if os.path.exists(tp) else {}
    for r in s["rows"]:
        t = truth.get(r["file"], {})
        r["n_series"] = len(t.get("series", []))
        r["ylog"] = bool(t.get("ylog"))
        r["fmt"] = t.get("fmt", "")
        r["width"] = (t.get("w") or 0) * (t.get("degradation", {}).get("scale", 1) or 1)
    return s


def summ(rows):
    from score import summarize
    return summarize(rows)


def pct(v, d=1): return "n/a" if v is None else f"{v * 100:.{d}f}%"


def table(groups, title):
    out = [f"### {title}", "", "| | Charts | Read right | Success | Median error | Refused | Silent wrong | Wrong type |", "|---|---|---|---|---|---|---|---|"]
    for k, rows in groups:
        if not rows: continue
        s = summ(rows)
        out.append(f"| {k} | {s['n']} | {pct(s['read_right'])} | {pct(s['success'])} | {pct(s['median_err_all'], 2)} | {pct(s['refused'])} | {pct(s['silent_wrong'])} | {pct(s['wrong_type'])} |")
    return "\n".join(out) + "\n"


def main():
    import sys; sys.path.insert(0, H)
    os.makedirs(IMG, exist_ok=True)
    data = {k: load(k) for k in SETS}
    summary, md = {}, ["# Benchmark results", "", "Made by `bench/report.py` from the scored files in this folder.",
                       "Read right: type, count and values right (error at most 2%), whether or not the reader trusted it. "
                       "Success: read right and marked reliable. Silent wrong: marked reliable but wrong. Definitions in docs/benchmark.md.", ""]
    md.append("| Set | Charts | Read right | Success | Median error (all charts) | Median error (answered) | Refused | Failed | Silent wrong | Wrong type | Axis misread | False flag | Error bar coverage | Time per chart |")
    md.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for k, s in data.items():
        if not s: continue
        o = summ(s["rows"]); summary[k] = {"all": o}
        md.append(f"| {NAMES[k]} | {o['n']} | {pct(o['read_right'])} | {pct(o['success'])} | {pct(o['median_err_all'], 2)} | {pct(o['median_err_answered'], 2)} | {pct(o['refused'])} | {pct(o['fail'])} | "
                  f"{pct(o['silent_wrong'])} | {pct(o['wrong_type'])} | {pct(o['axis_miss'])} | {pct(o['false_flag'])} | {pct(o['cover'])} | {o['ms_median'] / 1000:.1f} s |" if o.get("ms_median") else
                  f"| {NAMES[k]} | {o['n']} | {pct(o['read_right'])} | {pct(o['success'])} | {pct(o['median_err_all'], 2)} | {pct(o['median_err_answered'], 2)} | {pct(o['refused'])} | {pct(o['fail'])} | {pct(o['silent_wrong'])} | {pct(o['wrong_type'])} | {pct(o['axis_miss'])} | {pct(o['false_flag'])} | {pct(o['cover'])} | n/a |")
    md.append("")
    MAIN = "synthetic_test2" if data.get("synthetic_test2") else "synthetic_test"
    T = data.get(MAIN)
    if T:
        rows = T["rows"]
        for key, title in [("family", f"{NAMES[MAIN]}, by chart family"), ("renderer", "by renderer"), ("degradation", "by damage")]:
            g = sorted({r[key] for r in rows})
            md.append(table([(k, [r for r in rows if r[key] == k]) for k in g], title))
            summary[MAIN]["by_" + key] = {k: summ([r for r in rows if r[key] == k]) for k in g}
        bins = [("under 500 px", 0, 500), ("500 to 800 px", 500, 800), ("800 px and up", 800, 1e9)]
        md.append(table([(n, [r for r in rows if a <= r["width"] < b]) for n, a, b in bins], "by width of the picture"))
        md.append(table([(f"{k} series", [r for r in rows if r["n_series"] == k and r["family"] in ("line", "area", "stacked_area", "step")]) for k in range(1, 5)], "line and area charts, by number of series (more series means more overlap)"))
        md.append(table([(k, [r for r in rows if r["fmt"] == k]) for k in ["plain", "thousands", "currency", "pct", "suffix", "dec"]], "by how the value axis is written"))
        md.append(table([("log scale", [r for r in rows if r["ylog"]]), ("linear", [r for r in rows if not r["ylog"]])], "by axis scale"))
        md.append(table([("axis numbers shown", [r for r in rows if r["readable"]]), ("axis numbers hidden (should be refused)", [r for r in rows if not r["readable"]])], "by label visibility"))
        u = [r for r in rows if not r["readable"]]
        if u: md.append(f"Charts with hidden axis numbers that were refused: {sum((not r['ok']) or (not r['reliable']) for r in u)} of {len(u)}.\n")
    for fk in ("families_test", "families_dev"):
        Fm = data.get(fk)
        if Fm:
            g = sorted({r["family"] for r in Fm["rows"]})
            md.append(table([(k, [r for r in Fm["rows"] if r["family"] == k]) for k in g], f"{NAMES[fk]}, by chart family"))
            summary[fk]["by_family"] = {k: summ([r for r in Fm["rows"] if r["family"] == k]) for k in g}
    O = data.get("owid_test")
    if O:
        g = sorted({r["family"] for r in O["rows"]})
        md.append(table([(k, [r for r in O["rows"] if r["family"] == k]) for k in g], "Held out Our World in Data charts, by chart family"))
    # confidence: does "reliable" mean right?
    for k in (MAIN, "owid_test", "families_test"):
        s = data.get(k)
        if not s: continue
        rows = [r for r in s["rows"] if r["readable"]]
        good = lambda r: r["ok"] and r["type_ok"] and r["count_ok"] and r["err"] <= 0.02
        conf = np.array([r["confidence"] for r in rows]); y = np.array([good(r) for r in rows], float)
        edges = [0, .2, .4, .6, .8, .9, 1.0001]
        rel = []
        for a, b in zip(edges[:-1], edges[1:]):
            m = (conf >= a) & (conf < b)
            if m.sum(): rel.append({"bin": f"{a:.1f} to {min(b, 1):.1f}", "n": int(m.sum()), "mean_conf": float(conf[m].mean()), "right": float(y[m].mean())})
        acc = [r for r in rows if r["reliable"]]
        bad = [r for r in rows if r["ok"] and not good(r)]
        summary[k]["reliability"] = {"bins": rel, "right_when_reliable": float(np.mean([good(r) for r in acc])) if acc else None,
                                     "right_when_flagged": float(np.mean([good(r) for r in rows if r["ok"] and not r["reliable"]])) if any(r["ok"] and not r["reliable"] for r in rows) else None,
                                     "bad_reads_caught": float(np.mean([not r["reliable"] for r in bad])) if bad else None, "n_bad": len(bad),
                                     "brier": float(np.mean((conf - y) ** 2))}
        md.append(f"### Confidence on {NAMES[k]}\n")
        md.append("| Confidence | Charts | Mean confidence | Read right |\n|---|---|---|---|")
        for q in rel: md.append(f"| {q['bin']} | {q['n']} | {q['mean_conf']:.2f} | {pct(q['right'])} |")
        rr = summary[k]["reliability"]
        md.append(f"\nWhen it says reliable it is right {pct(rr['right_when_reliable'])} of the time. Of the {rr['n_bad']} answered charts that were read wrong, "
                  f"{pct(rr['bad_reads_caught'])} were flagged. Brier score {rr['brier']:.3f}.\n")
    # DePlot on the same charts
    for k in ("synthetic_test", "owid_test", "fred"):
        dp = os.path.join(R, f"deplot_{k}_scored.json")
        if not os.path.exists(dp) or not data.get(k): continue
        D = json.load(open(dp))["rows"]
        files = {r["file"] for r in D}
        U = [r for r in data[k]["rows"] if r["file"] in files and r["readable"]]
        Dd = [r for r in D if r["readable"]]
        if len(Dd) < 5: continue   # too few charts to say anything
        ok_nt = lambda r: r["ok"] and r["count_ok"] and r["err"] <= 0.02
        cmp = {}
        for tool, rows in (("Unchart", U), ("DePlot", Dd)):
            e = np.array([r["err"] if r["ok"] else 1.0 for r in rows])
            cmp[tool] = {"n": len(rows), "success_no_type": float(np.mean([ok_nt(r) for r in rows])), "median_err": float(np.median(e)),
                         "within_5pct": float(np.mean(e <= 0.05)), "no_answer": float(np.mean([not r["ok"] for r in rows])),
                         "ms_median": float(np.median([r["ms"] for r in rows if r["ms"]])) if any(r["ms"] for r in rows) else None,
                         "by_family": {f: float(np.median([r["err"] if r["ok"] else 1.0 for r in rows if r["family"] == f])) for f in sorted({r["family"] for r in rows})}}
        summary.setdefault("deplot", {})[k] = cmp
        md.append(f"### Unchart and DePlot on the same {cmp['DePlot']['n']} charts from {NAMES[k]}\n")
        md.append("| Tool | Charts | Read right (type not checked) | Median error | Within 5% | No answer | Time per chart |\n|---|---|---|---|---|---|---|")
        for tool in ("Unchart", "DePlot"):
            c = cmp[tool]; md.append(f"| {tool} | {c['n']} | {pct(c['success_no_type'])} | {pct(c['median_err'], 2)} | {pct(c['within_5pct'])} | {pct(c['no_answer'])} | {c['ms_median'] / 1000:.1f} s |" if c["ms_median"] else f"| {tool} | {c['n']} | {pct(c['success_no_type'])} | {pct(c['median_err'], 2)} | {pct(c['within_5pct'])} | {pct(c['no_answer'])} | n/a |")
        md.append("")
    # misleading chart flags: the v1 truncated bar set says which bars skip zero; the synthetic bar charts all start at zero
    hon = {}
    t3 = os.path.join(R, "v2_charts3.json")
    if os.path.exists(t3):
        res = json.load(open(t3)); tr = {t["file"]: t for t in json.load(open(os.path.join(ROOT, "charts3", "truth.json")))}
        fl = {f: any(x.get("code") == "truncated" for x in (r.get("flags") or [])) for f, r in res.items()}
        hon["v1_truncated_set"] = {"skips_zero_caught": sum(fl[f] for f in fl if tr[f]["scale"] == "trunc"), "skips_zero": sum(tr[f]["scale"] == "trunc" for f in fl),
                                   "false_flags": sum(fl[f] for f in fl if tr[f]["scale"] != "trunc"), "starts_at_zero": sum(tr[f]["scale"] != "trunc" for f in fl)}
    for k in (MAIN, "synthetic_dev"):
        if data.get(k):
            rows = [r for r in data[k]["rows"] if r["trunc_true"] is not None and r["ok"]]
            hon[k] = {"skips_zero_caught": sum(r["trunc_flag"] for r in rows if r["trunc_true"]), "skips_zero": sum(r["trunc_true"] for r in rows),
                      "false_flags": sum(r["trunc_flag"] for r in rows if not r["trunc_true"]), "starts_at_zero": sum(not r["trunc_true"] for r in rows)}
    summary["honesty_flags"] = hon
    md.append("### Bars that do not start at zero\n")
    md.append("| Set | Skipped zero, flagged | Started at zero, flagged anyway |\n|---|---|---|")
    for k, h in hon.items(): md.append(f"| {k} | {h['skips_zero_caught']} of {h['skips_zero']} | {h['false_flags']} of {h['starts_at_zero']} |")
    md.append("")
    json.dump(summary, open(os.path.join(R, "summary.json"), "w"), indent=1)
    open(os.path.join(R, "tables.md"), "w").write("\n".join(md) + "\n")
    figures(data, summary)
    print("\n".join(md[:14]))


def figures(data, summary):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
    ink, accent, gray = "#111114", "#FF5A1F", "#9a9aa0"
    MAIN = "synthetic_test2" if data.get("synthetic_test2") else "synthetic_test"
    T = data.get(MAIN)
    if T:
        rows = T["rows"]; fams = sorted({r["family"] for r in rows})
        rr_ = [summ([r for r in rows if r["family"] == f])["read_right"] or 0 for f in fams]
        sc = [summ([r for r in rows if r["family"] == f])["success"] or 0 for f in fams]
        o = np.argsort(rr_)
        fig, ax = plt.subplots(figsize=(7, 4.6), dpi=130)
        ax.barh([fams[i].replace("_", " ") for i in o], [rr_[i] * 100 for i in o], color=gray, height=.6, label="read right")
        ax.barh([fams[i].replace("_", " ") for i in o], [sc[i] * 100 for i in o], color=ink, height=.6, label="read right and marked reliable")
        ax.set_xlabel("share of charts (%)"); ax.set_xlim(0, 100); ax.set_title(f"{NAMES[MAIN]}, by family", loc="left")
        for i, k in enumerate(o): ax.text(rr_[k] * 100 + 1, i, f"{rr_[k] * 100:.0f}%", va="center", fontsize=8)
        ax.legend(frameon=False, loc="lower right", fontsize=8)
        fig.tight_layout(); fig.savefig(os.path.join(IMG, "by_family.png")); plt.close(fig)
    for k in (MAIN, "owid_test"):
        rr = summary.get(k, {}).get("reliability")
        if not rr: continue
        s = data[k]; rows = [r for r in s["rows"] if r["readable"]]
        good = lambda r: r["ok"] and r["type_ok"] and r["count_ok"] and r["err"] <= 0.02
        fig, axs = plt.subplots(1, 2, figsize=(9, 3.8), dpi=130)
        b = rr["bins"]
        axs[0].plot([0, 1], [0, 1], color=gray, lw=1, ls="--")
        axs[0].plot([q["mean_conf"] for q in b], [q["right"] for q in b], "o-", color=accent)
        for q in b: axs[0].annotate(str(q["n"]), (q["mean_conf"], q["right"]), textcoords="offset points", xytext=(4, -10), fontsize=7, color=gray)
        axs[0].set_xlabel("confidence Unchart gave"); axs[0].set_ylabel("share read right"); axs[0].set_title("Confidence against how often it was right", loc="left")
        axs[0].set_xlim(0, 1); axs[0].set_ylim(0, 1.02)
        # answer only the most confident charts: how many get answered vs how many of those are right
        ans = sorted([r for r in rows if r["ok"]], key=lambda r: -r["confidence"])
        cov, acc = [], []
        for i in range(1, len(ans) + 1):
            cov.append(i / len(rows)); acc.append(np.mean([good(r) for r in ans[:i]]))
        axs[1].plot(np.array(cov) * 100, np.array(acc) * 100, color=ink)
        thr = sum(r["reliable"] for r in ans) / len(rows)
        axs[1].axvline(thr * 100, color=accent, lw=1); axs[1].text(thr * 100 + 1, 5, "where it stops\nanswering", color=accent, fontsize=8)
        axs[1].set_xlabel("charts answered (%)"); axs[1].set_ylabel("answered charts read right (%)"); axs[1].set_ylim(0, 102); axs[1].set_xlim(0, 100)
        axs[1].set_title("Answering fewer charts, more of them right", loc="left")
        fig.tight_layout(); fig.savefig(os.path.join(IMG, f"confidence_{k}.png")); plt.close(fig)


if __name__ == "__main__":
    main()
