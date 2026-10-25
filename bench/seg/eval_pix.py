"""Pixel scores of the mark model on the held out training charts (every 40th), whole pictures, not crops.

python3 bench/seg/eval_pix.py data/seg/b20000.onnx results/v4/seg_val.json [--n 200]
Per class IoU (web charts only count for series vs not series, their text and gridlines are not labeled), and how well
the series groups match: for each true series the share of its pixels that land in its best matching group.
"""
import sys, os, glob, json
import numpy as np
from PIL import Image
import onnxruntime as ort

model, out = sys.argv[1], sys.argv[2]
RAD = float(os.environ.get("RAD", 1.5))
n = int(sys.argv[sys.argv.index("--n") + 1]) if "--n" in sys.argv else 200
files = sorted(f[:-8] for f in glob.glob("data/seg/train/*_lab.png") if int(os.path.basename(f)[:5]) % 40 == 0)
rng = np.random.default_rng(0); files = [files[i] for i in sorted(rng.choice(len(files), min(n, len(files)), replace=False))]
so = ort.SessionOptions(); so.intra_op_num_threads = 2
S = ort.InferenceSession(model, so)
I = np.zeros(5); U = np.zeros(5); purity = []; clean = []
for f in files:
    im = np.asarray(Image.open(f + ".png").convert("RGB")); lab = np.asarray(Image.open(f + "_lab.png"))
    h, w = lab.shape; ph, pw = -(-h // 16) * 16, -(-w // 16) * 16
    x = np.pad(im, ((0, ph - h), (0, pw - w), (0, 0)), mode="edge").astype(np.float32).transpose(2, 0, 1)[None] / 255
    c, e = S.run(None, {"image": x}); pr = c[0].argmax(0)[:h, :w]; emb = e[0][:, :h, :w]
    t = np.zeros_like(lab, dtype=np.int64); t[lab == 1] = 2; t[lab == 2] = 3; t[lab == 3] = 4; t[lab >= 10] = 1
    web = (lab == 5).any()
    for k in range(5):
        if web and k != 1: continue
        tk, pk = t == k, pr == k
        if web and k == 1: tk = lab >= 10
        I[k] += (tk & pk).sum(); U[k] += (tk | pk).sum()
    # grouping: cluster predicted series pixels like src/seg.js does (greedy, radius RAD) and score both ways
    # (sure pixels first, the soft edges then join the nearest group, as in src/seg.js)
    z = c[0][:, :h, :w]; z = np.exp(z - z.max(0)); ps = z[1] / z.sum(0)
    P = np.argwhere((pr == 1) & (ps > 0.9)); Q = np.argwhere((pr == 1) & (ps <= 0.9))
    if len(P) and (lab >= 10).any():
        E = emb[:, P[:, 0], P[:, 1]].T; g = -np.ones(len(P), int); k = 0; cens = []
        while (g == -1).any() and k < 30:
            s = np.flatnonzero(g == -1)[0]; cen = E[s]
            for _ in range(5):
                m = (g == -1) & (np.linalg.norm(E - cen, axis=1) < RAD)
                if m.any(): cen = E[m].mean(0)
            m = (g == -1) & (np.linalg.norm(E - cen, axis=1) < RAD); m[s] = True; g[m] = k; k += 1; cens.append(cen)
        G = -np.ones(lab.shape, int); G[P[:, 0], P[:, 1]] = g
        if len(Q):
            EQ = emb[:, Q[:, 0], Q[:, 1]].T; D = np.linalg.norm(EQ[:, None, :] - np.array(cens)[None], axis=2)
            gq = D.argmin(1); gq[D.min(1) >= 2 * RAD] = -1; G[Q[:, 0], Q[:, 1]] = gq
        g = np.unique(G[G >= 0])
        for v in np.unique(lab[lab >= 10]):
            q = G[(lab == v) & (G >= 0)]
            if len(q) >= 20: purity.append(np.bincount(q).max() / len(q))
        for k in np.unique(g):
            q = lab[(G == k) & (lab >= 10)]
            if len(q) >= 20: clean.append(np.bincount(q).max() / len(q))
iou = (I / np.maximum(U, 1)).round(4).tolist()
res = {"model": os.path.basename(model), "charts": len(files), "iou": dict(zip(["background", "series", "text", "gridline", "legend"], iou)),
       "series_groups": {"n": len(purity), "mean_share_in_best_group": round(float(np.mean(purity)), 4), "share_above_0.9": round(float(np.mean(np.array(purity) > 0.9)), 4),
       "groups_n": len(clean), "group_share_of_main_series": round(float(np.mean(clean)), 4), "groups_above_0.9": round(float(np.mean(np.array(clean) > 0.9)), 4)}, "radius": RAD}
json.dump(res, open(out, "w"), indent=1); print(json.dumps(res))
