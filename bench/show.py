"""Draw a result's points over its chart, to see what went wrong: python3 bench/show.py <set dir> <results.json> <file> [out.png]"""
import json, sys, os
from PIL import Image, ImageDraw
d, rp, f = sys.argv[1:4]
out = sys.argv[4] if len(sys.argv) > 4 else "/tmp/show.png"
imgdir = os.path.join(d, "images") if os.path.isdir(os.path.join(d, "images")) else d
im = Image.open(os.path.join(imgdir, f)).convert("RGB")
r = json.load(open(rp))[f]
if r.get("angle"): im = im.rotate(-r["angle"], expand=True, fillcolor=im.getpixel((0, 0)))
g = ImageDraw.Draw(im)
cols = [(255, 0, 255), (0, 200, 0), (255, 120, 0), (0, 120, 255), (200, 0, 0)]
for k, s in enumerate(r.get("series", [])):
    c = cols[k % len(cols)]
    P = [(p["px"], p["py"]) for p in s["points"] if p.get("px") is not None and p.get("py") is not None]
    for x, y in P: g.rectangle([x - 3, y - 3, x + 3, y + 3], outline=c, width=2)
    if s["type"] in ("line", "area", "step") and len(P) > 1: g.line(P, fill=c, width=1)
if r.get("rect"): R = r["rect"]; g.rectangle([R["left"], R["top"], R["right"], R["bottom"]], outline=(0, 160, 160))
im.save(out)
print(r.get("chartType"), r.get("code"), [(s["type"], s["name"], len(s["points"])) for s in r.get("series", [])], r.get("axis", {}).get("yRange"))
