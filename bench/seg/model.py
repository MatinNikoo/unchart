"""The mark model. A small U-Net that gives every pixel a class and an 8 number embedding.

classes: 0 background, 1 series ink, 2 text, 3 gridlines and other lines, 4 legend swatches
pixels of the same series get embeddings close together, different series far apart, so crossing lines and
lines of near the same color can still be told apart.
"""
import torch
import torch.nn as nn
import torch.nn.functional as F

NCLS, EDIM = 5, 8


def cbr(i, o, d=1, s=1):
    return nn.Sequential(nn.Conv2d(i, o, 3, s, d, dilation=d, bias=False), nn.BatchNorm2d(o), nn.ReLU(inplace=True))


class Net(nn.Module):
    def __init__(self, c=(32, 48, 80, 112), f=12, z=16):
        super().__init__()
        a, b, cc, d = c
        self.stem = cbr(3, a, s=2)                       # half resolution from here
        self.e1 = nn.Sequential(cbr(a, a), cbr(a, a))
        self.e2 = nn.Sequential(cbr(a, b), cbr(b, b))
        self.e3 = nn.Sequential(cbr(b, cc), cbr(cc, cc))
        self.e4 = nn.Sequential(cbr(cc, d), cbr(d, d, 2), cbr(d, d, 4))
        self.d3 = nn.Sequential(cbr(d + cc, cc), cbr(cc, cc))
        self.d2 = nn.Sequential(cbr(cc + b, b), cbr(b, b))
        self.d1 = nn.Sequential(cbr(b + a, a), cbr(a, a))
        self.full = nn.Sequential(cbr(3, f), cbr(f, f))  # full resolution features for thin lines and small text
        self.fuse = cbr(a + f, z)
        self.fuse_e = cbr(a + f, z)                      # the embedding gets its own last layer
        self.cls = nn.Conv2d(z, NCLS, 1)
        self.emb = nn.Conv2d(z, EDIM, 1)

    def forward(self, x):
        up = lambda t, r: F.interpolate(t, size=r.shape[-2:], mode="bilinear", align_corners=False)
        s = self.stem(x)
        e1 = self.e1(s)
        e2 = self.e2(F.max_pool2d(e1, 2))
        e3 = self.e3(F.max_pool2d(e2, 2))
        e4 = self.e4(F.max_pool2d(e3, 2))
        d3 = self.d3(torch.cat([up(e4, e3), e3], 1))
        d2 = self.d2(torch.cat([up(d3, e2), e2], 1))
        d1 = self.d1(torch.cat([up(d2, e1), e1], 1))
        z = torch.cat([up(d1, x), self.full(x)], 1)
        return self.cls(self.fuse(z)), self.emb(self.fuse_e(z))


def disc_loss(emb, inst, dv=0.5, dd=3.0, cap=3000):
    """discriminative loss (De Brabandere et al. 2017) over the series pixels of each image"""
    tot, n = emb.new_zeros(()), 0
    for e, m in zip(emb, inst):
        ids = [int(v) for v in torch.unique(m) if v >= 0]
        if not ids: continue
        e = e.flatten(1).t(); m = m.flatten()
        means, var = [], e.new_zeros(())
        for i in ids:
            p = (m == i).nonzero().flatten()
            if len(p) > cap: p = p[torch.randperm(len(p), device=p.device)[:cap]]
            ei = e[p]; mu = ei.mean(0); means.append(mu)
            var = var + F.relu((ei - mu).norm(dim=1) - dv).pow(2).mean()
        M = torch.stack(means); var = var / len(ids)
        dist = e.new_zeros(())
        if len(ids) > 1:
            D = torch.cdist(M, M); k = len(ids)
            dist = F.relu(2 * dd - D[~torch.eye(k, dtype=torch.bool)]).pow(2).mean()
        tot = tot + var + dist + 0.001 * M.norm(dim=1).mean(); n += 1
    return tot / max(n, 1)


def load_ckpt(path):
    """Loads a training checkpoint without running any code stored in it. Only tensors, plain numbers and the
    numpy scalars the optimizer saves are allowed, so a swapped .pt file can't do anything but fail."""
    import numpy as np
    core = getattr(np, "_core", None) or np.core
    allowed = [core.multiarray.scalar, np.dtype] + [type(np.dtype(t)) for t in ("float64", "float32", "int64", "int32")]
    with torch.serialization.safe_globals(allowed):
        return torch.load(path, weights_only=True, map_location="cpu")
