"""Chart specs for the benchmark: the data, the chart family, the renderer and the look.

Every spec is drawn by one renderer (matplotlib, seaborn, Chart.js, Vega-Lite, ECharts, Plotly)
and then degraded. The numbers in a spec are the ground truth.
The test split uses its own seed and some looks that never appear in the dev split.
"""
import os, hashlib, colorsys
import numpy as np

H = os.path.dirname(os.path.abspath(__file__))

FAMILIES = ["bar", "hbar", "grouped_bar", "stacked_bar", "stacked_hbar", "line", "step", "area",
            "stacked_area", "scatter", "pie", "donut", "histogram", "bar_line"]

# families added later, drawn by the matplotlib based renderers only and scored as their own sets
NEW_FAMILIES = ["stacked100", "lollipop", "dot_plot", "slope", "waterfall", "bubble", "errorbar", "dual_axis"]
PY_ONLY = {"matplotlib", "excel_like", "sheets_like", "slide"}

# which renderer can draw which family
SUPPORT = {
    "matplotlib": FAMILIES, "excel_like": FAMILIES, "sheets_like": FAMILIES, "slide": FAMILIES,
    "seaborn": ["bar", "hbar", "grouped_bar", "line", "scatter", "histogram"],
    "chartjs": [f for f in FAMILIES if f != "histogram"] + ["histogram"],
    "vegalite": FAMILIES, "echarts": FAMILIES, "plotly": FAMILIES,
}

# looks per split. some looks only exist in test, so tuning on dev cannot learn them
LOOKS = {
    "dev": {
        "matplotlib": ["default", "ggplot", "bmh", "seaborn-v0_8-whitegrid", "fivethirtyeight", "dark_background", "classic"],
        "seaborn": ["darkgrid/deep", "whitegrid/muted", "whitegrid/deep"],
        "excel_like": ["office2013"], "sheets_like": ["classic"], "slide": ["navy"],
        "chartjs": ["default", "custom"], "vegalite": ["default", "excel", "ggplot2", "quartz"],
        "echarts": ["light"], "plotly": ["plotly", "plotly_white", "ggplot2"],
    },
    # test set v2: new seeds, the test looks plus a few never used anywhere before
    "test2": {
        "matplotlib": ["default", "ggplot", "Solarize_Light2", "tableau-colorblind10", "seaborn-v0_8-darkgrid", "seaborn-v0_8-ticks", "fast",
                       "dark_background", "seaborn-v0_8-pastel", "grayscale", "seaborn-v0_8-dark"],
        "seaborn": ["ticks/colorblind", "white/dark", "whitegrid/bright", "darkgrid/pastel"],
        "excel_like": ["office2007", "office2013"], "sheets_like": ["material", "classic"], "slide": ["white", "gray", "navy"],
        "chartjs": ["dark", "pastel"], "vegalite": ["vox", "fivethirtyeight", "latimes", "urbaninstitute", "googlecharts", "powerbi", "dark"],
        "echarts": ["dark", "vintage"], "plotly": ["seaborn", "simple_white", "plotly_dark", "presentation", "gridon", "xgridoff"],
    },
    # test set v3 (engine v4): new seeds, looks no earlier split used, and a random palette on a third of the charts
    "test3": {
        "matplotlib": ["petroff10", "petroff8", "seaborn-v0_8-colorblind", "seaborn-v0_8-muted", "seaborn-v0_8-white", "seaborn-v0_8-poster",
                       "seaborn-v0_8-bright", "bmh", "Solarize_Light2"],
        "seaborn": ["white/colorblind", "ticks/muted", "darkgrid/bright"],
        "excel_like": ["office2019"], "sheets_like": ["retro"], "slide": ["charcoal", "white"],
        "chartjs": ["default", "pastel"], "vegalite": ["carbonwhite", "carbong10", "carbong90", "googlecharts"],
        "echarts": ["light", "vintage"], "plotly": ["simple_white", "gridon", "plotly"],
    },
    "test": {
        "matplotlib": ["default", "ggplot", "Solarize_Light2", "tableau-colorblind10", "seaborn-v0_8-darkgrid",
                       "seaborn-v0_8-ticks", "fast", "dark_background"],
        "seaborn": ["ticks/colorblind", "white/dark", "whitegrid/bright"],
        "excel_like": ["office2007"], "sheets_like": ["material"], "slide": ["white", "gray"],
        "chartjs": ["dark", "pastel"], "vegalite": ["vox", "fivethirtyeight", "latimes", "urbaninstitute", "googlecharts", "powerbi", "dark"],
        "echarts": ["dark", "vintage"], "plotly": ["seaborn", "simple_white", "plotly_dark", "presentation"],
    },
}

CATS = {
    "regions": ["North", "South", "East", "West", "Central", "Pacific", "Mountain", "Atlantic"],
    "fruit": ["Apple", "Banana", "Cherry", "Kiwi", "Mango", "Plum", "Fig", "Grape", "Lemon", "Pear"],
    "months": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    "quarters": ["Q1 2023", "Q2 2023", "Q3 2023", "Q4 2023", "Q1 2024", "Q2 2024", "Q3 2024", "Q4 2024"],
    "years": [str(y) for y in range(2015, 2027)],
    "teams": ["Sales", "Marketing", "Support", "Product", "Finance", "Legal", "Design", "Ops"],
    "cities": ["Austin", "Boston", "Chicago", "Denver", "Miami", "Seattle", "Phoenix", "Dallas", "Atlanta"],
    "products": ["Basic", "Plus", "Pro", "Team", "Enterprise", "Starter"],
}
SERIES_NAMES = ["Revenue", "Costs", "Users", "Online", "Stores", "Mobile", "Desktop", "Target", "Actual", "Forecast",
                "Group A", "Group B", "Group C", "2023", "2024", "Exports", "Imports"]

# value scales: (name, lo, hi, format). the format is how tick labels are written
SCALES = [("small", 0, 50, "plain"), ("small100", 0, 100, "plain"), ("big", 0, 60000, "thousands"),
          ("currency", 0, 9000, "currency"), ("pct", 0, 100, "pct"), ("suffix", 0, 4.5e6, "suffix"),
          ("dec", 0, 2.4, "dec"), ("neg", -40, 60, "plain"), ("negbig", -3000, 5000, "thousands")]

def seed_for(split, idx):
    return int(hashlib.sha256(f"unchart-{split}-{idx}".encode()).hexdigest()[:8], 16)


def pick(rng, xs):
    return xs[int(rng.integers(len(xs)))]


def walk(rng, n, lo, hi, smooth=0.25):
    w = np.cumsum(rng.normal(0, 1, n)) * smooth + rng.normal(0, 0.15, n)
    w = (w - w.min()) / (np.ptp(w) + 1e-9)
    return lo + (hi - lo) * (0.1 + 0.8 * w)


def rnd(v, scale):
    # data people chart is usually rounded a bit
    if scale in ("big", "currency", "negbig"): return [float(round(x)) for x in v]
    if scale == "suffix": return [float(round(x, -3)) for x in v]
    if scale == "dec": return [float(round(x, 3)) for x in v]
    return [float(round(x, 2)) for x in v]


PREFIX = {"dev": "d", "test": "t", "test2": "u", "families-dev": "g", "families-test": "h", "test3": "v", "families-test3": "k"}
LOOKSET = {"families-dev": "dev", "families-test": "test2", "families-test3": "test3"}


def make_spec(split, idx, renderer, family, rng):
    look = pick(rng, LOOKS[LOOKSET.get(split, split)][renderer])
    s = {"id": f"{PREFIX.get(split, split[0])}{idx:04d}", "split": split, "renderer": renderer, "look": look, "family": family,
         "xkind": "cat", "readable": True, "legend": "auto", "grid": bool(rng.random() < 0.7),
         "title": pick(rng, ["", "", "Results by group", "Monthly trend", "Quarterly numbers", "How we did this year"]),
         "w": int(pick(rng, [640, 720, 800, 900, 1000])), "h": int(pick(rng, [380, 420, 450, 500])),
         "annotate": False, "value_labels": False, "ylog": False, "yrev": False, "dual": False}
    scale = pick(rng, SCALES)
    if family in ("pie", "donut"):
        scale = ("share", 0, 100, "plain")
    if family == "stacked100":
        scale = ("pct", 0, 100, "pct")
    if family in ("waterfall", "dual_axis", "bubble") and scale[0] in ("neg", "negbig", "dec"):
        scale = ("small100", 0, 100, "plain")
    s["scale"], s["fmt"] = scale[0], scale[3]
    lo, hi = scale[1], scale[2]
    cats_kind = pick(rng, list(CATS))

    def cats(n):
        c = CATS[cats_kind]
        if n > len(c): c = [f"{c[0][:3]} {i + 1}" for i in range(n)]
        if cats_kind in ("months", "quarters", "years"):
            st = int(rng.integers(0, len(c) - n + 1)); return c[st:st + n]
        return [c[i] for i in sorted(rng.choice(len(c), n, replace=False))]

    names = list(rng.choice(SERIES_NAMES, 6, replace=False))
    bar_lo = 0 if lo >= 0 else lo

    if family in ("bar", "hbar"):
        n = int(rng.integers(3, 11))
        if lo < 0 and rng.random() < 0.6:
            y = rng.uniform(lo * 0.9, hi * 0.95, n)
        else:
            y = rng.uniform(max(lo, 0) + (hi - max(lo, 0)) * 0.12, hi * 0.95, n); s["scale"] = s["scale"].replace("neg", "")
        s["x"] = cats(n); s["series"] = [{"name": names[0], "y": rnd(y, scale[0])}]
        s["value_labels"] = bool(rng.random() < 0.25)
    elif family in ("grouped_bar", "stacked_bar", "stacked_hbar"):
        k, n = int(rng.integers(2, 5)), int(rng.integers(3, 9))
        top = hi if family == "grouped_bar" else hi / k
        base = max(lo, 0)
        s["x"] = cats(n); s["series"] = [{"name": names[j], "y": rnd(rng.uniform(base + (top - base) * 0.15, top * 0.95, n), scale[0])} for j in range(k)]
        if family == "grouped_bar" and scale[0] in ("neg", "negbig") and rng.random() < 0.5:
            s["series"] = [{"name": names[j], "y": rnd(rng.uniform(lo * 0.8, hi * 0.9, n), scale[0])} for j in range(k)]
    elif family in ("line", "step", "area", "stacked_area"):
        k = 1 if family in ("area", "step") else int(rng.integers(1, 5)) if family == "line" else int(rng.integers(2, 5))
        n = int(pick(rng, [6, 8, 10, 12, 16, 24, 40, 60])) if family == "line" else int(rng.integers(6, 21))
        xk = pick(rng, ["num", "num", "year", "cat", "date"])
        if family in ("stacked_area", "area") and xk == "cat": xk = "num"
        if xk == "num":
            x0, st = pick(rng, [0, 1, 10, 100]), pick(rng, [1, 1, 2, 5, 0.5])
            s["x"] = [float(x0 + st * i) for i in range(n)]; s["xkind"] = "num"
        elif xk == "year":
            y0 = int(rng.integers(1990, 2026 - n)) if n < 30 else 1990
            s["x"] = [float(y0 + i) for i in range(n)]; s["xkind"] = "num"
        elif xk == "cat":
            n = min(n, 12); s["x"] = cats(n) if cats_kind in ("months", "quarters", "years") and len(CATS[cats_kind]) >= n else CATS["months"][:n]
        else:
            freq = pick(rng, ["MS", "D", "W"])
            start = np.datetime64(f"{int(rng.integers(2015, 2024))}-{int(rng.integers(1, 13)):02d}-01")
            if freq == "MS":
                s["x"] = [str(np.datetime64(start, "M") + i) + "-01" for i in range(n)]
            elif freq == "D":
                s["x"] = [str(start + i) for i in range(n)]
            else:
                s["x"] = [str(start + 7 * i) for i in range(n)]
            s["xkind"] = "date"
        top = hi if family != "stacked_area" else hi / k
        base = max(lo, 0) if family in ("area", "stacked_area") else lo
        s["series"] = [{"name": names[j], "y": rnd(walk(rng, n, base + (top - base) * (0.05 if family == "stacked_area" else 0), top), scale[0])} for j in range(k)]
        if family == "line":
            s["marker"] = bool(rng.random() < 0.35 and n <= 24)
            s["dash"] = [bool(rng.random() < 0.25) for _ in range(k)]
            if rng.random() < 0.12 and k == 1 and scale[0] in ("small", "small100", "big", "currency"):
                s["ylog"] = True
                ex = rng.uniform(-0.2, 0.2) + np.linspace(0, rng.uniform(2, 4), n) + np.cumsum(rng.normal(0, .08, n))
                s["series"][0]["y"] = [float(round(10 ** (1 + v), 3)) for v in ex]; s["fmt"] = "plain"; s["scale"] = "log"
            if rng.random() < 0.08 and k == 2 and not s["ylog"]:
                s["dual"] = True
                s["series"][1]["y"] = rnd(walk(rng, n, 1000, 9000), "big"); s["series"][1]["axis"] = "right"
            if rng.random() < 0.15: s["annotate"] = True
        if family == "step": s["where"] = pick(rng, ["post", "pre"])
    elif family == "scatter":
        k = int(rng.integers(1, 4))
        xr = pick(rng, [(0, 100), (0, 10), (1990, 2025), (-50, 50), (0, 5000)])
        s["xkind"] = "num"; s["series"] = []
        s["xfmt"] = "thousands" if xr[1] == 5000 else "plain"
        for j in range(k):
            n = int(rng.integers(10, 70 // k + 10))
            x = rng.uniform(xr[0], xr[1], n)
            t = (x - xr[0]) / (xr[1] - xr[0])
            y = lo + (hi - lo) * np.clip(0.15 + 0.6 * t * rng.uniform(.3, 1.2) + rng.normal(0, .12, n) + 0.1 * j, 0.03, 0.97)
            s["series"].append({"name": names[j], "x": [float(round(v, 3)) for v in x], "y": rnd(y, scale[0])})
        s["marker_shapes"] = bool(rng.random() < 0.5)
        if rng.random() < 0.1 and scale[0] in ("small100", "big"):
            s["ylog"] = True
            for se in s["series"]: se["y"] = [float(round(10 ** (0.5 + 3.5 * rng.random()), 2)) for _ in se["y"]]
            s["fmt"] = "plain"; s["scale"] = "log"
    elif family in ("pie", "donut"):
        n = int(rng.integers(3, 8))
        v = rng.dirichlet(np.ones(n) * 1.6) * 100
        v = np.maximum(v, 3); v = v / v.sum() * 100
        s["x"] = cats(n); s["series"] = [{"name": "Share", "y": [float(round(q, 2)) for q in v]}]
        s["value_labels"] = bool(rng.random() < 0.5)
        s["legend"] = pick(rng, ["legend", "labels"])
    elif family == "histogram":
        nb = int(rng.integers(6, 26))
        data = rng.normal(0, 1, int(rng.integers(200, 3000)))
        if rng.random() < 0.4: data = rng.gamma(2, 1, len(data))
        edges = np.linspace(data.min(), data.max(), nb + 1)
        e0 = float(np.floor(edges[0])); w = float(pick(rng, [0.25, 0.5, 1, 2]))
        w = max(w, round((data.max() - e0) / nb, 1) or 0.1)
        edges = [round(e0 + w * i, 4) for i in range(nb + 1)]
        counts, _ = np.histogram(data, bins=edges)
        s["x"] = edges; s["xkind"] = "num"; s["series"] = [{"name": "Count", "y": [float(c) for c in counts]}]
        s["scale"], s["fmt"] = "count", "plain"
        s["edgecolor"] = bool(rng.random() < 0.5)
    elif family == "bar_line":
        n = int(rng.integers(4, 11))
        s["x"] = cats(n)
        base = max(lo, 0)
        s["series"] = [{"name": names[0], "y": rnd(rng.uniform(base + (hi - base) * 0.2, hi * 0.8, n), scale[0]), "kind": "bar"},
                       {"name": names[1], "y": rnd(walk(rng, n, base + (hi - base) * 0.3, hi * 0.95), scale[0]), "kind": "line"}]
        if rng.random() < 0.3:
            s["dual"] = True; s["series"][1]["axis"] = "right"
            s["series"][1]["y"] = [float(round(v, 1)) for v in rng.uniform(5, 95, n)]
    elif family == "stacked100":
        k, n = int(rng.integers(2, 5)), int(rng.integers(3, 9))
        raw = rng.uniform(0.15, 1, (k, n)); sh = raw / raw.sum(0) * 100
        s["x"] = cats(n); s["series"] = [{"name": names[j], "y": [float(round(v, 2)) for v in sh[j]]} for j in range(k)]
    elif family == "lollipop":
        n = int(rng.integers(4, 12))
        s["x"] = cats(n); s["series"] = [{"name": names[0], "y": rnd(rng.uniform(lo + (hi - lo) * 0.15 if lo >= 0 else lo * 0.8, hi * 0.95, n), scale[0])}]
    elif family == "dot_plot":
        k, n = int(rng.integers(1, 3)), int(rng.integers(4, 10))
        base = max(lo, 0)
        s["x"] = cats(n); s["series"] = [{"name": names[j], "y": rnd(rng.uniform(base + (hi - base) * 0.1, hi * 0.95, n), scale[0])} for j in range(k)]
    elif family == "slope":
        k = int(rng.integers(2, 7))
        y0 = int(rng.integers(2010, 2021)); s["x"] = [str(y0), str(y0 + int(rng.integers(2, 6)))]
        base = max(lo, 0)
        s["series"] = [{"name": names[j % len(names)] if j < len(names) else f"Item {j + 1}", "y": rnd(rng.uniform(base + (hi - base) * 0.1, hi * 0.95, 2), scale[0])} for j in range(k)]
    elif family == "waterfall":
        n = int(rng.integers(4, 9))
        d = rng.uniform((hi - lo) * 0.05, (hi - lo) * 0.25, n) * rng.choice([1, 1, -1], n)
        d[0] = abs(d[0]) + (hi - lo) * 0.3
        tot = np.cumsum(d)
        if tot.min() < 0: d[0] += -tot.min() + (hi - lo) * 0.05
        s["x"] = cats(n); s["series"] = [{"name": "Change", "y": rnd(d, scale[0])}]
    elif family == "bubble":
        k = int(rng.integers(1, 3)); s["xkind"] = "num"; s["series"] = []
        xr = pick(rng, [(0, 100), (0, 10), (1990, 2025)])
        for j in range(k):
            n = int(rng.integers(6, 16))
            x = rng.uniform(xr[0] + (xr[1] - xr[0]) * 0.05, xr[1] - (xr[1] - xr[0]) * 0.05, n)
            y = rng.uniform(lo + (hi - lo) * 0.1, lo + (hi - lo) * 0.9, n)
            s["series"].append({"name": names[j], "x": [float(round(v, 3)) for v in x], "y": rnd(y, scale[0]), "size": [float(round(v, 1)) for v in rng.uniform(5, 100, n)]})
        s["xfmt"] = "plain"
    elif family == "errorbar":
        n = int(rng.integers(3, 9)); base = max(lo, 0)
        y = rng.uniform(base + (hi - base) * 0.3, hi * 0.8, n)
        s["x"] = cats(n); s["series"] = [{"name": names[0], "y": rnd(y, scale[0]), "err": rnd(rng.uniform(0.03, 0.12, n) * (hi - base), scale[0])}]
    elif family == "dual_axis":
        n = int(rng.integers(6, 16))
        y0 = int(rng.integers(1995, 2026 - n)); s["x"] = [float(y0 + i) for i in range(n)]; s["xkind"] = "num"
        base = max(lo, 0)
        s["series"] = [{"name": names[0], "y": rnd(walk(rng, n, base, hi), scale[0])},
                       {"name": names[1], "y": [float(round(v, 1)) for v in walk(rng, n, 2, 40)], "axis": "right"}]
        s["dual"] = True
    # charts with their axis numbers hidden cannot be read. the right answer is to say so
    if family not in ("pie", "donut") and family not in NEW_FAMILIES and rng.random() < 0.03:
        s["readable"] = False; s["noticks"] = True
    if family in ("line", "scatter", "bar", "area") and not s["ylog"] and rng.random() < 0.03 and family != "bar":
        s["yrev"] = True
    return s


DEGR = ["clean", "clean", "clean", "jpeg", "down", "blur", "noise", "rotate", "scan"]


def build(split, n_per_renderer):
    base = {"dev": 1000, "test": 5000, "test2": 9000, "families-dev": 13000, "families-test": 17000, "test3": 41000, "families-test3": 45000}[split]
    specs, idx = [], 0
    for renderer, n in n_per_renderer.items():
        fams = NEW_FAMILIES if split.startswith("families") else SUPPORT.get(renderer, ["line"])
        for k in range(n):
            rng = np.random.default_rng(seed_for(split, base + idx))
            s = make_spec(split, idx, renderer, fams[k % len(fams)], rng)
            if split.endswith("test3") and rng.random() < 0.33:
                # a palette nobody chose: random hues, sometimes two close ones
                pr = np.random.default_rng(seed_for(split + "-palette", base + idx)); pal = []
                for j in range(max(len(s["series"]), len(s.get("x") or []))):
                    if j and pr.random() < 0.3: h0 = pal[int(pr.integers(len(pal)))]; c = colorsys.hls_to_rgb((h0[0] + pr.normal(0, 0.03)) % 1, min(0.8, max(0.15, h0[1] + pr.choice([-1, 1]) * pr.uniform(0.08, 0.18))), h0[2])
                    else: c = colorsys.hls_to_rgb(pr.random(), pr.uniform(0.25, 0.6), pr.uniform(0.4, 1))
                    pal.append(colorsys.rgb_to_hls(*c))
                s["palette"] = ["#" + "".join(f"{int(round(v * 255)):02x}" for v in colorsys.hls_to_rgb(*q)) for q in pal]
            s["degrade"] = pick(rng, DEGR)
            s["dseed"] = int(rng.integers(1 << 30))
            specs.append(s); idx += 1
    return specs
