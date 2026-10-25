"""Picture of what the mark model saw: python3 bench/seg/viz.py <image> <cached .bin from .cache/seg> <out.png>"""
import sys, struct
import numpy as np
from PIL import Image
im = np.asarray(Image.open(sys.argv[1]).convert("RGB"))
b = open(sys.argv[2], "rb").read(); w, h, k = struct.unpack("<III", b[:12])
inst = np.frombuffer(b[12:12 + w * h * 2], np.int16).reshape(h, w)
rng = np.random.default_rng(3); pal = rng.integers(30, 230, (64, 3)).astype(np.uint8)
vis = np.full((h, w, 3), 255, np.uint8); m = inst >= 0; vis[m] = pal[inst[m] % 64]
if im.shape[:2] != (h, w): im = np.asarray(Image.fromarray(im).resize((w, h)))
Image.fromarray(np.concatenate([im, vis], 1)).save(sys.argv[3])
print(k, "series groups")
