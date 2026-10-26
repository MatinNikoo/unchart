"""Train the mark model on the charts from gen.py.

python3 bench/seg/train.py --data data/seg/train --out data/seg/ckpt --iters 20000
reruns pick up from <out>/last.pt. The loss curve goes to results/v4/train_log.csv.
"""
import os, sys, glob, json, time, argparse, csv
import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import Net, disc_loss, load_ckpt

ap = argparse.ArgumentParser()
ap.add_argument("--data", default="data/seg/train")
ap.add_argument("--out", default="data/seg/ckpt")
ap.add_argument("--log", default="results/v4/train_log_b.csv")
ap.add_argument("--iters", type=int, default=20000)
ap.add_argument("--bs", type=int, default=8)
ap.add_argument("--crop", type=int, default=224)
ap.add_argument("--lr", type=float, default=2e-3)
ap.add_argument("--threads", type=int, default=2)
ap.add_argument("--val", type=int, default=40, help="every Nth chart is held out")
ap.add_argument("--disc", type=float, default=0.5, help="weight of the embedding loss")
ap.add_argument("--restart", action="store_true", help="a new cosine schedule from the checkpoint's iteration")
A = ap.parse_args()
torch.set_num_threads(A.threads)
os.makedirs(A.out, exist_ok=True); os.makedirs(os.path.dirname(A.log), exist_ok=True)

def listing():
    fs = sorted(f[:-8] for f in glob.glob(os.path.join(A.data, "*_lab.png")))
    return [f for f in fs if int(os.path.basename(f)) % A.val], [f for f in fs if int(os.path.basename(f)) % A.val == 0]
train, val = listing()
CW = torch.tensor([1.0, 2.0, 5.0, 4.0, 4.0])


def to_targets(lab):
    cls = np.zeros(lab.shape, np.int64)
    cls[lab == 1] = 2; cls[lab == 2] = 3; cls[lab == 3] = 4; cls[lab >= 10] = 1
    cls[lab == 5] = -100   # web charts: not a series, but text and gridlines are not told apart
    inst = np.where(lab >= 10, lab.astype(np.int64) - 10, -1)
    return cls, inst


def sample(f, rng, crop):
    im = np.asarray(Image.open(f + ".png").convert("RGB")); lab = np.asarray(Image.open(f + "_lab.png"))
    h, w = lab.shape
    if h < crop or w < crop:
        ph, pw = max(0, crop - h), max(0, crop - w)
        im = np.pad(im, ((0, ph), (0, pw), (0, 0)), mode="edge"); lab = np.pad(lab, ((0, ph), (0, pw))); h, w = lab.shape
    # crops centred on a series pixel, on text or gridline pixels, or anywhere
    u = rng.random()
    ys, xs = np.nonzero(lab >= 10) if u < 0.45 else np.nonzero((lab >= 1) & (lab <= 3)) if u < 0.7 else ((), ())
    if len(ys):
        k = rng.integers(len(ys)); cy, cx = ys[k], xs[k]
        y0 = int(np.clip(cy - rng.integers(crop), 0, h - crop)); x0 = int(np.clip(cx - rng.integers(crop), 0, w - crop))
    else:
        y0, x0 = int(rng.integers(h - crop + 1)), int(rng.integers(w - crop + 1))
    im = im[y0:y0 + crop, x0:x0 + crop].astype(np.float32); lab = lab[y0:y0 + crop, x0:x0 + crop]
    # color changes keep every label: channel swaps, inverted themes, brightness
    if rng.random() < 0.4: im = im[:, :, rng.permutation(3)]
    if rng.random() < 0.1: im = 255 - im
    if rng.random() < 0.3: im = np.clip(im * rng.uniform(0.85, 1.1) + rng.uniform(-15, 15), 0, 255)
    if rng.random() < 0.3: im = im[:, ::-1]; lab = lab[:, ::-1]
    cls, inst = to_targets(lab)
    return np.ascontiguousarray(im.transpose(2, 0, 1)) / 255.0, cls, inst


def batch(fs, rng, crop):
    S = [sample(f, rng, crop) for f in fs]
    return (torch.tensor(np.stack([s[0] for s in S]), dtype=torch.float32), torch.tensor(np.stack([s[1] for s in S])),
            torch.tensor(np.stack([s[2] for s in S])))


def losses(net, x, c, i):
    lc, le = net(x)
    ce = F.cross_entropy(lc, c, weight=CW, ignore_index=-100)
    unk = c == -100
    if unk.any(): ce = ce + 0.5 * -torch.log1p(-lc.softmax(1)[:, 1][unk].clamp(max=1 - 1e-4)).mean()
    # dice on the series class keeps thin lines from being drowned by background
    p = lc.softmax(1)[:, 1]; t = (c == 1).float()
    dice = 1 - (2 * (p * t).sum() + 1) / (p.sum() + t.sum() + 1)
    dl = disc_loss(le, i)
    return ce, dice, dl, lc


net = Net()
opt = torch.optim.AdamW(net.parameters(), lr=A.lr, weight_decay=1e-4)
it0 = 0
lp = os.path.join(A.out, "last.pt")
if os.path.exists(lp):
    ck = load_ckpt(lp); net.load_state_dict(ck["net"]); it0 = ck["it"]
    if "opt" in ck: opt.load_state_dict(ck["opt"])
    print("resume at", it0, flush=True)
# warm up again after every resume (the optimizer state may be fresh)
c0 = it0 if A.restart else 0
sched = lambda it: A.lr * min(1, (it + 1) / 300, (it - it0 + 1) / 200) * 0.5 * (1 + np.cos(np.pi * min(1, (it - c0) / max(1, A.iters - c0))))
new = not os.path.exists(A.log)
logf = open(A.log, "a", newline=""); W = csv.writer(logf)
if new: W.writerow(["iter", "split", "ce", "dice", "disc", "iou_bg", "iou_series", "iou_text", "iou_grid", "iou_legend", "sec_per_iter"]); logf.flush()

vrng = np.random.default_rng(7)
VB = [batch(val[k:k + 8], vrng, 320) for k in range(0, min(len(val), 96), 8)]


def validate(it):
    # mean loss terms and the IoU of each class over the held out crops (web pixels of unknown class left out)
    net.eval(); r = np.zeros(3); I = np.zeros(5); U = np.zeros(5)
    with torch.no_grad():
        for x, c, i in VB:
            ce, dice, dl, lc = losses(net, x, c, i)
            r += [ce.item(), dice.item(), dl.item()]
            pr = lc.argmax(1); ok = c != -100
            for k in range(5): I[k] += ((pr == k) & (c == k)).sum().item(); U[k] += (((pr == k) | (c == k)) & ok).sum().item()
    net.train(); r /= len(VB); iou = I / np.maximum(U, 1)
    W.writerow([it, "val", *np.round(r, 4), *np.round(iou, 4), ""]); logf.flush()
    return r, iou[1]


rng = np.random.default_rng(it0 + 1)
t0, acc = time.time(), np.zeros(3)
for it in range(it0, A.iters):
    for g in opt.param_groups: g["lr"] = sched(it)
    x, c, i = batch([train[k] for k in rng.integers(len(train), size=A.bs)], rng, A.crop)
    ce, dice, dl, _ = losses(net, x, c, i)
    loss = 2 * ce + dice + A.disc * dl
    opt.zero_grad(); loss.backward(); torch.nn.utils.clip_grad_norm_(net.parameters(), 5); opt.step()
    acc += [ce.item(), dice.item(), dl.item()]
    if (it + 1) % 50 == 0:
        sp = (time.time() - t0) / 50; t0 = time.time()
        W.writerow([it + 1, "train", *np.round(acc / 50, 4), "", "", "", "", "", round(sp, 2)]); logf.flush(); acc[:] = 0
    if (it + 1) % 500 == 0 or it + 1 == A.iters:
        r, iou = validate(it + 1)
        train = listing()[0]   # the generator may still be adding charts
        print(f"it {it + 1} val ce {r[0]:.3f} dice {r[1]:.3f} disc {r[2]:.3f} iou {iou:.3f}", flush=True)
        torch.save({"net": net.state_dict(), "opt": opt.state_dict(), "it": it + 1}, lp + ".tmp"); os.replace(lp + ".tmp", lp)
        if (it + 1) % 2500 == 0: torch.save({"net": net.state_dict(), "it": it + 1}, os.path.join(A.out, f"it{it + 1}.pt"))
