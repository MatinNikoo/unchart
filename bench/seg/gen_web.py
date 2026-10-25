"""Training charts from the web renderers (Chart.js, Vega-Lite, ECharts, Plotly) for the mark model.

python3 bench/seg/gen_web.py specs <out dir> <first idx> <count>     write the specs
node bench/seg/gen_web.js <out dir> <specs json>                     draw them, once per series recolored
python3 bench/seg/gen_web.py degrade <out dir> <first idx> <count>   degrade and write <idx>.png / <idx>_lab.png

A web chart can not hide one group of artists without moving the layout, so here each series is drawn again in a
far away color and the pixels that change are that series. Text and gridlines are not told apart in these charts,
so their label is 5 (not a series, class unknown). Series pixels outside the plot box are legend swatches (3).
"""
import os, sys, json
import numpy as np
from PIL import Image

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, ".."))
sys.path.insert(0, H)
import specs as SP
import gen as G

WEB = ["chartjs", "vegalite", "echarts", "plotly"]
TPL = json.load(open(os.path.join(H, "..", "plotly_templates.json")))
BASE = {
    "chartjs": {"default": ["#36A2EB", "#FF6384", "#4BC0C0", "#FF9F40", "#9966FF", "#FFCD56", "#C9CBCF"],
                "custom": ["#3366cc", "#dc3912", "#109618", "#ff9900", "#990099", "#0099c6"]},
    "vegalite": ["#4c78a8", "#f58518", "#e45756", "#72b7b2", "#54a24b", "#eeca3b", "#b279a2", "#ff9da6", "#9d755d", "#bab0ac"],
    "echarts": ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272", "#fc8452", "#9a60b4", "#ea7ccc"],
    "plotly": ["#636efa", "#EF553B", "#00cc96", "#ab63fa", "#FFA15A", "#19d3f3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52"],
}


def to_hex(c):
    if c.startswith("rgb("): return "#" + "".join(f"{int(v):02x}" for v in c[4:-1].split(","))
    return c.lower()


def spec_for(idx):
    rng = np.random.default_rng(SP.seed_for("train", 50000 + idx))
    r = WEB[int(rng.integers(len(WEB)))]
    fams = [f for f in SP.SUPPORT[r] if f not in ("pie", "donut")]
    s = SP.make_spec("train", idx, r, fams[int(rng.integers(len(fams)))], rng)
    if s["family"] == "line" and rng.random() < 0.3:
        G.owid_lines(s, rng); s["end_labels"] = False; s["legend"] = "auto"
        for q in s["series"]: q["y"] = [None if v != v else v for v in q["y"]]   # json has no NaN
    s["readable"] = True; s.pop("noticks", None)
    k = len(s["series"])
    if rng.random() < 0.5: pal = G.rand_palette(rng, k, 0.45 if idx >= 23000 else 0.25)
    else:
        b = BASE[r]
        if r == "chartjs": b = b.get(s["look"], b["default"])
        if r == "plotly": b = [to_hex(c) for c in (TPL.get(s["look"], {}).get("layout", {}).get("colorway") or BASE["plotly"])]
        pal = [b[j % len(b)] for j in range(k)]
    s["palette"] = pal
    s["id"] = f"w{idx:05d}"
    return s


if __name__ == "__main__":
    cmd, out, a, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    os.makedirs(out, exist_ok=True)
    if cmd == "specs":
        S = []
        for i in range(a, a + n):
            s = spec_for(i); s["idx"] = i; S.append(s)
        json.dump(S, open(os.path.join(out, f"web_specs_{a}.json"), "w"))
        print(len(S), "specs")
    else:
        meta = []
        for i in range(a, a + n):
            rp, lp = os.path.join(out, f"{i:05d}_raw.png"), os.path.join(out, f"{i:05d}_rlab.png")
            if not os.path.exists(rp) or not os.path.exists(lp): continue
            rng = np.random.default_rng(SP.seed_for("train-web-degrade", i))
            img = np.asarray(Image.open(rp).convert("RGB")); lab = np.asarray(Image.open(lp).convert("RGB"))[:, :, 0].copy()
            im2, lab2, kind = G.degrade(img, lab, rng, i >= 23000)
            Image.fromarray(im2).save(os.path.join(out, f"{i:05d}.png")); Image.fromarray(lab2).save(os.path.join(out, f"{i:05d}_lab.png"))
            os.remove(rp); os.remove(lp)
            meta.append({"idx": i, "degradation": kind})
        with open(os.path.join(out, f"meta_web_{a}.jsonl"), "w") as f:
            for m in meta: f.write(json.dumps(m) + "\n")
        print(len(meta), "charts")
