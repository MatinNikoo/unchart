"""Contact sheet of chart images, for looking at a set by eye."""
import sys, json
from PIL import Image, ImageDraw
out, files = sys.argv[1], sys.argv[2:]
W = 4; T = []
for f in files:
    im = Image.open(f).convert("RGB"); t = im.resize((400, int(400 * im.height / im.width)))
    ImageDraw.Draw(t).text((3, 3), f.split("/")[-1], fill=(255, 0, 255)); T.append(t)
h = max(t.height for t in T)
sheet = Image.new("RGB", (400 * W, h * ((len(T) + W - 1) // W)), "white")
for i, t in enumerate(T): sheet.paste(t, ((i % W) * 400, (i // W) * h))
sheet.save(out)
