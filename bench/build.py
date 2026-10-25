"""Build the synthetic benchmark.

python3 bench/build.py specs dev|test     write the specs (data, family, renderer, look)
python3 bench/build.py py dev|test        draw the matplotlib / seaborn / excel / sheets / slide charts
node bench/render_web.js dev|test         draw the Chart.js / Vega-Lite / ECharts / Plotly charts
python3 bench/build.py degrade dev|test   apply the degradations and write truth.json
"""
import json, os, sys, hashlib
import numpy as np

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, H)
import specs as SP

OUT = os.path.join(H, "..", "dataset")
PY = {"matplotlib", "seaborn", "excel_like", "sheets_like", "slide"}
COUNTS = {
    "dev": {"matplotlib": 70, "seaborn": 18, "excel_like": 28, "sheets_like": 28, "slide": 28,
            "chartjs": 42, "vegalite": 42, "echarts": 42, "plotly": 42},
    "test2": {"matplotlib": 112, "seaborn": 30, "excel_like": 42, "sheets_like": 42, "slide": 42,
              "chartjs": 70, "vegalite": 70, "echarts": 70, "plotly": 70},
    "families-dev": {"matplotlib": 40, "excel_like": 24, "sheets_like": 24, "slide": 24},
    "families-test": {"matplotlib": 40, "excel_like": 24, "sheets_like": 24, "slide": 24},
    # test set v3, made once for engine v4 after everything was frozen
    "test3": {"matplotlib": 60, "seaborn": 18, "excel_like": 24, "sheets_like": 24, "slide": 24,
              "chartjs": 42, "vegalite": 42, "echarts": 42, "plotly": 42},
    "families-test3": {"matplotlib": 40, "excel_like": 24, "sheets_like": 24, "slide": 24},
    "test": {"matplotlib": 112, "seaborn": 30, "excel_like": 42, "sheets_like": 42, "slide": 42,
             "chartjs": 70, "vegalite": 70, "echarts": 70, "plotly": 70},
}


def d(split, *p):
    return os.path.join(OUT, "synthetic-" + split, *p)


def cmd_specs(split):
    S = SP.build(split, COUNTS[split])
    os.makedirs(d(split, "raw"), exist_ok=True)
    json.dump(S, open(d(split, "specs.json"), "w"), indent=0)
    print(len(S), "specs")


def cmd_py(split, only=None):
    import render_py
    S = json.load(open(d(split, "specs.json")))
    info = {}
    ip = d(split, "raw", "info_py.json")
    if os.path.exists(ip): info = json.load(open(ip))
    for s in S:
        if s["renderer"] not in PY or (only and s["id"] not in only): continue
        rng = np.random.default_rng(SP.seed_for(split + "-draw", int(s["id"][1:])))
        info[s["id"]] = render_py.render(s, d(split, "raw", s["id"] + ".png"), rng)
    json.dump(info, open(ip, "w"))
    print(len(info), "drawn")


def degrade(im, kind, seed):
    from PIL import Image, ImageFilter
    rng = np.random.default_rng(seed)
    im = im.convert("RGB")
    meta = {"kind": kind}
    if kind == "jpeg":
        meta["q"] = int(rng.integers(30, 71)); return im, "jpg", meta
    if kind == "down":
        f = float(rng.uniform(0.5, 0.75)); meta["scale"] = round(f, 3)
        return im.resize((max(1, int(im.width * f)), max(1, int(im.height * f))), Image.BILINEAR), "png", meta
    if kind == "blur":
        r = float(rng.uniform(0.6, 1.2)); meta["sigma"] = round(r, 2)
        return im.filter(ImageFilter.GaussianBlur(r)), "png", meta
    if kind == "noise":
        sd = float(rng.uniform(5, 12)); meta["sd"] = round(sd, 1)
        a = np.asarray(im).astype(np.float32) + rng.normal(0, sd, (im.height, im.width, 1))
        return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)), "png", meta
    if kind == "rotate":
        ang = float(rng.uniform(0.7, 2.5) * rng.choice([-1, 1])); meta["deg"] = round(ang, 2)
        bg = im.getpixel((2, 2))
        return im.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=bg), "png", meta
    if kind == "scan":
        ang = float(rng.uniform(0.3, 1.2) * rng.choice([-1, 1])); meta["deg"] = round(ang, 2)
        a = np.asarray(im).astype(np.float32)
        a = 235 * (a / 255) ** 1.1 + 12                      # washed out, paper colored
        a = a * np.array([1.0, 0.985, 0.94])
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        im = im.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=(232, 228, 214))
        im = im.filter(ImageFilter.GaussianBlur(0.6))
        a = np.asarray(im).astype(np.float32) + rng.normal(0, 6, (im.height, im.width, 1))
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        meta["q"] = 75
        return im, "jpg", meta
    return im, "png", meta


def cmd_degrade(split):
    from PIL import Image
    S = json.load(open(d(split, "specs.json")))
    info = {}
    for f in ("info_py.json", "info_web.json"):
        p = d(split, "raw", f)
        if os.path.exists(p): info.update(json.load(open(p)))
    os.makedirs(d(split, "images"), exist_ok=True)
    truth = []
    for s in S:
        if s["id"] not in info: print("missing", s["id"]); continue
        im = Image.open(d(split, "raw", s["id"] + ".png"))
        out, ext, meta = degrade(im, s["degrade"], s["dseed"])
        fn = f"{s['id']}.{ext}"
        if ext == "jpg": out.save(d(split, "images", fn), quality=meta.get("q", 75))
        else: out.save(d(split, "images", fn), optimize=True)
        t = {k: v for k, v in s.items() if k not in ("dseed",)}
        t.update({"file": fn, "render": info[s["id"]], "degradation": meta})
        truth.append(t)
    json.dump(truth, open(d(split, "truth.json"), "w"))
    # the manifest freezes the set: any change to an image or to the truth shows up as a different hash
    man = {"files": {}, "truth_sha256": hashlib.sha256(open(d(split, "truth.json"), "rb").read()).hexdigest()}
    for t in truth: man["files"][t["file"]] = hashlib.sha256(open(d(split, "images", t["file"]), "rb").read()).hexdigest()
    json.dump(man, open(d(split, "manifest.json"), "w"), indent=0)
    print(len(truth), "charts")


if __name__ == "__main__":
    c, split = sys.argv[1], sys.argv[2]
    only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
    {"specs": cmd_specs, "py": lambda s: cmd_py(s, only), "degrade": cmd_degrade}[c](split)
