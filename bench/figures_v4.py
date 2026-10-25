"""The README figures for the shipped default (rules only) on the held out sets of test v3.
python3 bench/figures_v4.py   writes docs/img/by_family.png and docs/img/confidence_*.png"""
import json, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "docs", "img")
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
ink, accent, gray = "#111114", "#FF5A1F", "#9a9aa0"
good = lambda r: bool(r["ok"] and r["type_ok"] and r["count_ok"] and r["err"] <= 0.02)


def rows(f):
    return [r for r in json.load(open(os.path.join(ROOT, "results", "v4", f)))["rows"] if r["readable"]]


syn = rows("test3_rules_scored.json")
fams = sorted({r["family"] for r in syn})
rr = [np.mean([good(r) for r in syn if r["family"] == f]) for f in fams]
sc = [np.mean([good(r) and r["reliable"] for r in syn if r["family"] == f]) for f in fams]
o = np.argsort(rr)
fig, ax = plt.subplots(figsize=(7, 4.6), dpi=130)
ax.barh([fams[i].replace("_", " ") for i in o], [rr[i] * 100 for i in o], color=gray, height=.6, label="read right")
ax.barh([fams[i].replace("_", " ") for i in o], [sc[i] * 100 for i in o], color=ink, height=.6, label="read right and marked reliable")
ax.set_xlabel("share of charts (%)"); ax.set_xlim(0, 100); ax.set_title("Synthetic test v3 (held out), by family", loc="left")
for i, k in enumerate(o):
    ax.text(rr[k] * 100 + 1, i, f"{rr[k] * 100:.0f}%", va="center", fontsize=8)
ax.legend(frameon=False, loc="lower right", fontsize=8)
fig.tight_layout(); fig.savefig(os.path.join(IMG, "by_family.png")); plt.close(fig)

for name, f in (("synthetic_test3", "test3_rules_scored.json"), ("owid_test", "owid_test_rules_scored.json")):
    R = rows(f)
    conf = np.array([r["confidence"] for r in R]); y = np.array([good(r) for r in R], float)
    edges = [0, .2, .4, .6, .8, .9, 1.0001]
    fig, axs = plt.subplots(1, 2, figsize=(9, 3.8), dpi=130)
    axs[0].plot([0, 1], [0, 1], color=gray, lw=1, ls="--")
    pts = []
    for a, b in zip(edges[:-1], edges[1:]):
        m = (conf >= a) & (conf < b)
        if m.sum():
            pts.append((conf[m].mean(), y[m].mean(), int(m.sum())))
    axs[0].plot([p[0] for p in pts], [p[1] for p in pts], "o-", color=accent)
    for p in pts:
        axs[0].annotate(str(p[2]), (p[0], p[1]), textcoords="offset points", xytext=(4, -10), fontsize=7, color=gray)
    axs[0].set_xlabel("confidence Unchart gave"); axs[0].set_ylabel("share read right"); axs[0].set_title("Confidence against how often it was right", loc="left")
    axs[0].set_xlim(0, 1); axs[0].set_ylim(0, 1.02)
    ans = sorted([r for r in R if r["ok"]], key=lambda r: -r["confidence"])
    cov = [i / len(R) for i in range(1, len(ans) + 1)]
    acc = [np.mean([good(r) for r in ans[:i]]) for i in range(1, len(ans) + 1)]
    axs[1].plot(np.array(cov) * 100, np.array(acc) * 100, color=ink)
    thr = sum(r["reliable"] for r in ans) / len(R)
    axs[1].axvline(thr * 100, color=accent, lw=1); axs[1].text(thr * 100 + 1, 5, "where it stops\nanswering", color=accent, fontsize=8)
    axs[1].set_xlabel("charts answered (%)"); axs[1].set_ylabel("answered charts read right (%)"); axs[1].set_ylim(0, 102); axs[1].set_xlim(0, 100)
    axs[1].set_title("Answering fewer charts, more of them right", loc="left")
    fig.tight_layout(); fig.savefig(os.path.join(IMG, f"confidence_{name}.png")); plt.close(fig)
