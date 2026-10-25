"""Training charts for the mark model, with a label for every pixel.

python3 bench/seg/gen.py <out dir> <first idx> <count>

Each chart is drawn with matplotlib, then drawn again with one group of artists hidden at a time (each series, the
text, the gridlines and axes, the legend). A pixel belongs to the group whose hiding changes it the most, so the
label says what is visible on top. Labels go in one 8 bit png per chart:
  0 background, 1 text, 2 gridlines / axes / other lines, 3 legend swatches, 10 + j series j
These charts use their own seeds ("unchart-train-...") and only the dev looks plus random palettes, never a test look.
"""
import os, sys, json, colorsys
import numpy as np
from PIL import Image, ImageFilter
import matplotlib
matplotlib.use("Agg")
import matplotlib.colors as mc

H = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(H, ".."))
import specs as SP
import render_py as RP

SP.PREFIX["train"] = "r"
SP.LOOKS["train"] = dict(SP.LOOKS["dev"], owid_like=["owid"])
PYR = ["matplotlib", "seaborn", "excel_like", "sheets_like", "slide", "owid_like"]
FAMS = [f for f in SP.FAMILIES + SP.NEW_FAMILIES if f not in ("pie", "donut")]
SUPPORT = dict(SP.SUPPORT, owid_like=["line", "line", "line", "step", "stacked_area", "area", "hbar", "stacked_bar"])
SUPPORT = {r: [f for f in v if f not in ("pie", "donut")] for r, v in SUPPORT.items()}
NAMES = ["France", "Germany", "Brazil", "India", "China", "Japan", "Kenya", "Chile", "Peru", "Spain", "Italy", "Egypt",
         "Canada", "Mexico", "Norway", "Ghana", "Vietnam", "Poland", "World", "Africa", "Europe", "Asia"]


def rand_palette(rng, k, twin=0.25):
    # random colors, sometimes with near twins (same hue, a bit lighter or darker), to teach continuity over color
    pal = []
    for j in range(max(k, 1)):
        if j and rng.random() < twin:
            h, l, s = colorsys.rgb_to_hls(*mc.to_rgb(pal[int(rng.integers(len(pal)))]))
            c = colorsys.hls_to_rgb((h + rng.normal(0, 0.03)) % 1, float(np.clip(l + rng.choice([-1, 1]) * rng.uniform(0.06, 0.18), 0.15, 0.8)), s)
        else:
            c = colorsys.hls_to_rgb(rng.random(), rng.uniform(0.25, 0.65), rng.uniform(0.35, 1))
        pal.append(mc.to_hex(c))
    return pal


def owid_lines(s, rng):
    # many long lines with flat runs and late starts, labels at their ends
    k, n = int(rng.integers(2, 13)), int(rng.integers(20, 150))
    y0 = int(rng.integers(1800, 2024 - n)) if n < 220 else 1800
    s["x"] = [float(y0 + i) for i in range(n)]; s["xkind"] = "num"
    lo, hi = 0, float(rng.choice([1, 10, 100, 1000, 50000]))
    ser = []
    for j in range(k):
        y = SP.walk(rng, n, lo, hi, smooth=float(rng.uniform(0.1, 0.5)))
        if rng.random() < 0.3:   # flat steps, like yearly scores
            y = np.repeat(y[::5], 5)[:n]
        y = list(map(float, y))
        if rng.random() < 0.25:
            st = int(rng.integers(1, n // 2)); y[:st] = [float("nan")] * st
        ser.append({"name": NAMES[j % len(NAMES)], "y": y})
    s["series"] = ser; s["end_labels"] = rng.random() < 0.8; s["legend"] = "none" if s["end_labels"] else "auto"
    s["marker"] = False; s["dash"] = [False] * k; s["annotate"] = False; s["ylog"] = False; s["dual"] = False; s["fmt"] = "plain"


def spec_for(idx):
    rng = np.random.default_rng(SP.seed_for("train", 30000 + idx))
    hard = idx >= 8000   # the second batch: more crossing lines, closer colors, rougher pictures
    r = PYR[int(rng.integers(len(PYR)))] if rng.random() < (0.75 if hard else 0.9) else "owid_like"
    fams = SUPPORT[r]
    fam = fams[int(rng.integers(len(fams)))]
    s = SP.make_spec("train", idx, r, fam, rng)
    if r == "owid_like" and fam == "line": owid_lines(s, rng)
    elif fam == "line" and rng.random() < (0.5 if hard else 0.3):
        owid_lines(s, rng); s["end_labels"] = rng.random() < 0.4; s["legend"] = "none" if s["end_labels"] else "auto"
    if rng.random() < (0.5 if hard else 0.35): s["palette"] = rand_palette(rng, max(len(s["series"]), len(s.get("x") or [])), 0.45 if hard else 0.25)
    s["hard"] = hard
    s["readable"] = True; s.pop("noticks", None)
    return s, rng


def close(c, ref, tol=0.02):
    try:
        a = np.array(mc.to_rgba_array(c))[:, :3]
    except Exception:
        return False
    return len(a) > 0 and bool(np.abs(a[0] - np.array(mc.to_rgb(ref))).max() < tol)


def groups(fig, col, fam):
    G = {}
    add = lambda k, a: G.setdefault(k, []).append(a)
    for ax in fig.axes:
        for t in ax.texts: add("text", t)
        for t in (ax.title, ax._left_title, ax._right_title, ax.xaxis.label, ax.yaxis.label): add("text", t)
        for axis in (ax.xaxis, ax.yaxis):
            for tk in axis.get_major_ticks() + axis.get_minor_ticks():
                add("text", tk.label1); add("text", tk.label2)
                add("grid", tk.gridline); add("grid", tk.tick1line); add("grid", tk.tick2line)
            add("text", axis.get_offset_text())
        for sp in ax.spines.values(): add("grid", sp)
        lg = ax.get_legend()
        if lg:
            for t in lg.get_texts(): add("text", t)
            for h in lg.legend_handles: add("legend", h)
            add("legend", lg.legendPatch)
        arts = list(ax.lines) + list(ax.patches) + list(ax.collections)
        for a in arts:
            cs = []
            if isinstance(a, matplotlib.lines.Line2D): cs = [a.get_color(), a.get_markerfacecolor()]
            elif isinstance(a, matplotlib.patches.Patch): cs = [a.get_facecolor()]
            else:
                fc = a.get_facecolor(); cs = [fc] if len(fc) else []
                cs.append(a.get_edgecolor())
            j = next((j for j, c in enumerate(col) for q in cs if close(q, c)), None)
            if fam == "waterfall" and isinstance(a, matplotlib.patches.Rectangle):
                j = 0 if close(a.get_facecolor(), "#2CA02C") or close(a.get_facecolor(), col[0]) else 1
            add(("s", j) if j is not None else "grid", a)
    return G


def grab(fig):
    fig.canvas.draw()
    return np.asarray(fig.canvas.buffer_rgba())[:, :, :3].astype(np.int16)


def label_pass(fig, ax, ax2, col, fam, store):
    G = groups(fig, col, fam)
    full = grab(fig)
    keys = [k for k in G if k != "text"] + ["text"]   # text last, so it wins ties with the legend
    best = np.zeros(full.shape[:2], np.int16); lab = np.zeros(full.shape[:2], np.uint8)
    for k in keys:
        vis = [a.get_visible() for a in G[k]]
        for a in G[k]: a.set_visible(False)
        d = np.abs(grab(fig) - full).max(2)
        for a, v in zip(G[k], vis): a.set_visible(v)
        code = 1 if k == "text" else 2 if k == "grid" else 3 if k == "legend" else 10 + k[1]
        m = (d > 30) & (d >= best)
        lab[m] = code; best = np.maximum(best, np.where(d > 30, d, 0))
    store["img"] = full.astype(np.uint8); store["lab"] = lab
    bb = ax.get_window_extent(); hgt = full.shape[0]
    store["plot"] = [int(bb.x0), int(hgt - bb.y1), int(bb.x1), int(hgt - bb.y0)]


def resize_lab(lab, w, h):
    # each label keeps the pixels it covers at least 35% of, so thin lines survive a downscale
    out = np.zeros((h, w), np.uint8); best = np.zeros((h, w), np.float32)
    for v in np.unique(lab):
        if v == 0: continue
        m = np.asarray(Image.fromarray(((lab == v) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), np.float32) / 255
        sel = (m > 0.35) & (m > best); out[sel] = v; best[sel] = m[sel]
    return out


def degrade(img, lab, rng, hard=False):
    if hard and rng.random() < 0.35:   # two in a row: a downscaled, blurred, recompressed copy of a copy
        img, lab, k1 = degrade(img, lab, rng)
        img, lab, k2 = degrade(img, lab, rng)
        return img, lab, k1 + "+" + k2
    im = Image.fromarray(img); L = Image.fromarray(lab)
    kind = SP.pick(rng, ["clean", "clean", "jpeg", "down", "blur", "noise", "rotate", "scan", "down_jpeg"])
    if kind in ("down", "down_jpeg") or rng.random() < 0.15:
        f = float(rng.uniform(0.45, 0.8)); w, h = max(1, int(im.width * f)), max(1, int(im.height * f))
        im = im.resize((w, h), Image.BILINEAR); L = Image.fromarray(resize_lab(np.asarray(L), w, h))
    if kind in ("rotate", "scan"):
        ang = float(rng.uniform(0.3, 2.5) * rng.choice([-1, 1]))
        if kind == "scan":
            a = np.asarray(im).astype(np.float32); a = 235 * (a / 255) ** 1.1 + 12; a = a * np.array([1.0, 0.985, 0.94])
            im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        bg = im.getpixel((2, 2)) if kind == "rotate" else (232, 228, 214)
        im = im.rotate(ang, resample=Image.BICUBIC, expand=True, fillcolor=bg); L = L.rotate(ang, resample=Image.NEAREST, expand=True, fillcolor=0)
    if kind in ("blur", "scan"): im = im.filter(ImageFilter.GaussianBlur(float(rng.uniform(0.5, 1.2))))
    if kind in ("noise", "scan"):
        a = np.asarray(im).astype(np.float32) + rng.normal(0, float(rng.uniform(4, 12)), (im.height, im.width, 1))
        im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    q = int(rng.integers(30, 80)) if kind in ("jpeg", "down_jpeg", "scan") else None
    if q:
        import io
        b = io.BytesIO(); im.save(b, "JPEG", quality=q); b.seek(0); im = Image.open(b).convert("RGB")
    return np.asarray(im), np.asarray(L), kind


def make(idx, out):
    s, rng = spec_for(idx)
    store = {}
    hook = lambda fig, ax, ax2, col: label_pass(fig, ax, ax2, col, s["family"], store)
    RP.render(s, os.devnull, rng, hook=hook)
    img, lab, kind = degrade(store["img"], store["lab"], rng, s["hard"])
    Image.fromarray(img).save(os.path.join(out, f"{idx:05d}.png"))
    Image.fromarray(lab).save(os.path.join(out, f"{idx:05d}_lab.png"))
    k = int(lab.max()) - 9 if lab.max() >= 10 else 0
    return {"idx": idx, "family": s["family"], "renderer": s["renderer"], "look": s["look"], "degradation": kind, "series": len(s["series"]), "plot": store["plot"], "inst": k}


if __name__ == "__main__":
    out, a, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    os.makedirs(out, exist_ok=True)
    meta = []
    for i in range(a, a + n):
        try: meta.append(make(i, out))
        except Exception as e: print("skip", i, repr(e)[:120], flush=True)
        if (i - a) % 200 == 199: print(i, flush=True)
    with open(os.path.join(out, f"meta_{a}.jsonl"), "w") as f:
        for m in meta: f.write(json.dumps(m) + "\n")
