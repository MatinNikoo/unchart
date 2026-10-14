"""Make a varied set of charts with known data, so extraction can be scored against the truth."""
import json, os, random
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mt

OUT = os.path.join(os.path.dirname(__file__), "charts")
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
random.seed(7)

STYLES = ["default", "seaborn-v0_8-whitegrid", "ggplot", "bmh", "seaborn-v0_8-white", "fivethirtyeight"]
PALETTES = [None, ["#1f77b4", "#d62728", "#2ca02c"], ["#3b5bdb", "#f08c00", "#2f9e44"], ["#7048e8", "#e8590c", "#0c8599"]]


def scale_pick():
    kind = random.choice(["small", "big", "neg", "pct", "dec"])
    if kind == "small": lo, hi = 0, random.choice([10, 50, 100])
    elif kind == "big": lo, hi = 0, random.choice([5000, 20000, 1_000_000])
    elif kind == "neg": lo, hi = -random.choice([20, 50]), random.choice([30, 80])
    elif kind == "pct": lo, hi = 0, 100
    else: lo, hi = 0, random.choice([1, 2.5])
    return kind, lo, hi


def fmt_axis(ax, kind):
    if kind == "big":
        ax.yaxis.set_major_formatter(mt.FuncFormatter(lambda v, p: f"{v:,.0f}"))
    elif kind == "pct":
        ax.yaxis.set_major_formatter(mt.FuncFormatter(lambda v, p: f"{v:.0f}%"))


def line_chart(i):
    kind, lo, hi = scale_pick()
    n = random.choice([8, 12, 20, 40])
    k = random.choice([1, 1, 2, 3])
    x = np.arange(n) + random.choice([0, 2000, 2010]) * (n < 25)
    series = []
    for s in range(k):
        walk = np.cumsum(rng.normal(0, 1, n))
        walk = (walk - walk.min()) / (np.ptp(walk) + 1e-9)
        y = lo + (hi - lo) * (0.1 + 0.8 * walk)
        series.append(y)
    return "line", kind, x, series


def bar_chart(i):
    kind, lo, hi = scale_pick()
    if kind == "neg": lo = 0
    n = random.choice([4, 6, 8, 12])
    cats = random.sample(["North", "South", "East", "West", "Apple", "Kiwi", "Plum", "Fig", "Q1", "Q2", "Q3", "Q4", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Alpha", "Beta", "Gamma"], n)
    y = lo + (hi - lo) * rng.uniform(0.15, 0.95, n)
    return "bar", kind, cats, [y]


def scatter_chart(i):
    kind, lo, hi = scale_pick()
    n = random.choice([15, 30, 60])
    x = rng.uniform(0, 100, n)
    y = lo + (hi - lo) * np.clip(0.1 + 0.8 * (x / 100) + rng.normal(0, .12, n), 0.02, 0.98)
    return "scatter", kind, x, [y]


def draw(i, spec):
    typ, kind, x, series = spec
    style = random.choice(STYLES)
    pal = random.choice(PALETTES)
    w, h = random.choice([(8, 4.5), (6.4, 4.8), (10, 4), (7, 5)])
    with plt.style.context(style):
        fig, ax = plt.subplots(figsize=(w, h), dpi=random.choice([90, 110, 140]))
        names = random.sample(["Revenue", "Users", "Cost", "Sessions", "Signups", "Churn"], len(series))
        for s, y in enumerate(series):
            c = pal[s] if pal else None
            if typ == "line":
                ax.plot(x, y, color=c, lw=random.choice([1.5, 2, 2.5]), label=names[s], marker=random.choice([None, None, "o"]) if len(x) < 25 else None)
            elif typ == "bar":
                ax.bar(x, y, color=c or "#4c72b0", width=random.choice([.6, .7, .8]))
            else:
                ax.scatter(x, y, color=c, s=random.choice([18, 30, 45]))
        fmt_axis(ax, kind)
        if len(series) > 1: ax.legend()
        if random.random() < .5: ax.set_title(random.choice(["Monthly trend", "Results by group", "Growth since launch", "Weekly numbers"]))
        if typ == "bar" and len(x) > 8: plt.setp(ax.get_xticklabels(), rotation=random.choice([0, 45]))
        fig.tight_layout()
        p = os.path.join(OUT, f"c{i:03d}.png")
        fig.savefig(p)
        plt.close(fig)
    truth = {"file": f"c{i:03d}.png", "type": typ, "scale": kind,
             "x": [str(v) for v in x] if typ == "bar" else [float(v) for v in x],
             "series": [[float(v) for v in y] for y in series], "style": style}
    return truth


if __name__ == "__main__":
    makers = [line_chart] * 3 + [bar_chart] * 2 + [scatter_chart]
    truths = [draw(i, random.choice(makers)(i)) for i in range(60)]
    json.dump(truths, open(os.path.join(OUT, "truth.json"), "w"), indent=1)
    print(len(truths), "charts")
