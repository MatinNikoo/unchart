"""Figures for the mark model: the training curve and what the model sees on one dev chart.

python3 bench/seg/figures.py   (needs results/v4/train_log_b.csv and data/seg/b20000.onnx or vendor/seg/unchart_marks.onnx)
"""
import os, csv
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

R = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
IMG = os.path.join(R, "docs", "img")
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False})
ink, accent, gray = "#111114", "#FF5A1F", "#9a9aa0"

rows = list(csv.DictReader(open(os.path.join(R, "results", "v4", "train_log_b.csv"))))
tr = [r for r in rows if r["split"] == "train"]; va = [r for r in rows if r["split"] == "val"]
fig, (a, b) = plt.subplots(1, 2, figsize=(9, 3.4), dpi=130)
a.plot([int(r["iter"]) for r in tr], [float(r["ce"]) for r in tr], color=gray, lw=1, label="train (crops)")
a.plot([int(r["iter"]) for r in va], [float(r["ce"]) for r in va], color=ink, lw=1.6, label="held out (crops)")
a.set_xlabel("iteration"); a.set_ylabel("class loss"); a.set_ylim(0, 0.8); a.legend(frameon=False, fontsize=8)
a.set_title("Mark model training", loc="left")
for k, c, lab in [("iou_series", ink, "series"), ("iou_text", accent, "text"), ("iou_grid", gray, "gridlines")]:
    b.plot([int(r["iter"]) for r in va], [float(r[k]) for r in va], color=c, lw=1.6, label=lab)
b.set_xlabel("iteration"); b.set_ylabel("IoU on held out crops"); b.set_ylim(0, 1); b.legend(frameon=False, fontsize=8, loc="lower right")
b.set_title("Per class overlap", loc="left")
fig.tight_layout(); fig.savefig(os.path.join(IMG, "mark_model_training.png")); plt.close(fig)

# one dev chart: the picture, the series pixels, and the groups the embedding makes
import onnxruntime as ort
m = os.path.join(R, "vendor", "seg", "unchart_marks.onnx")
S = ort.InferenceSession(m)
f = os.path.join(R, "dataset", "real-owid", "images", "o0009.png")
im = np.asarray(Image.open(f).convert("RGB")); h, w = im.shape[:2]; ph, pw = -(-h // 16) * 16, -(-w // 16) * 16
x = np.pad(im, ((0, ph - h), (0, pw - w), (0, 0)), mode="edge").astype(np.float32).transpose(2, 0, 1)[None] / 255
c, e = S.run(None, {"image": x}); c = c[0][:, :h, :w]; e = e[0][:, :h, :w]
cls = c.argmax(0)
z = np.exp(c - c.max(0)); ps = z[1] / z.sum(0)
P = np.argwhere((cls == 1) & (ps > 0.9)); E = e[:, P[:, 0], P[:, 1]].T; g = -np.ones(len(P), int); cens = []
while (g == -1).any() and len(cens) < 30:
    s = np.flatnonzero(g == -1)[0]; cen = E[s]
    for _ in range(5):
        mm = (g == -1) & (np.linalg.norm(E - cen, axis=1) < 1.5)
        if mm.any(): cen = E[mm].mean(0)
    mm = (g == -1) & (np.linalg.norm(E - cen, axis=1) < 1.5); mm[s] = True; g[mm] = len(cens); cens.append(cen)
sizes = np.bincount(g); keep = np.argsort(-sizes)[:8]
pal = ["#111114", "#FF5A1F", "#2E86AB", "#3BB273", "#8E44AD", "#E1BC29", "#7A7A7A", "#C0392B"]
G = np.full((h, w, 3), 255, np.uint8)
for j, k in enumerate(keep):
    q = P[g == k]; G[q[:, 0], q[:, 1]] = tuple(int(pal[j][i:i + 2], 16) for i in (1, 3, 5))
C = np.full((h, w, 3), 255, np.uint8); C[cls == 1] = (17, 17, 20); C[cls == 2] = (255, 90, 31); C[cls == 3] = (170, 170, 175)
fig, ax = plt.subplots(1, 3, figsize=(12, 3.2), dpi=130)
for a, img, t in zip(ax, [im, C, G], ["picture (Our World in Data, dev)", "classes: series, text, gridlines", "biggest groups of series pixels"]):
    a.imshow(img); a.set_title(t, loc="left", fontsize=9); a.axis("off")
fig.tight_layout(); fig.savefig(os.path.join(IMG, "mark_model_example.png")); plt.close(fig)
print("saved")
