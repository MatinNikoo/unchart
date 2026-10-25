"""Run google/deplot (Pix2Struct, chart to table) on charts and write results in Unchart's result format,
so bench/score.py scores both tools the same way.

python3 bench/deplot.py <set dir> <out.json> [--split test] [--sample N] [--seed 0] [--model google/deplot]

DePlot never refuses and does not report a chart type, so it is always counted as answered, and the
comparison table uses success without the chart type check for both tools.
"""
import json, os, re, sys, time, random
import torch
from PIL import Image
from transformers import Pix2StructForConditionalGeneration, Pix2StructProcessor

MON = {m: i + 1 for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}


def num(s):
    s = str(s).strip().replace(",", "").replace("$", "").replace("€", "").replace("£", "")
    mult = 1
    if s.endswith("%"): s = s[:-1]
    m = re.match(r"^(-?\d*\.?\d+)\s*([kKmMbB]|thousand|million|billion)?\b", s)
    if not m: return None
    suf = (m[2] or "").lower()[:1]
    mult = {"k": 1e3, "t": 1e3, "m": 1e6, "b": 1e9}.get(suf, 1)
    try: return float(m[1]) * mult
    except ValueError: return None


def as_x(s):
    s = str(s).strip()
    m = re.match(r"^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$", s)
    if m: return f"{int(m[1]):04d}-{int(m[2]):02d}-{int(m[3] or 1):02d}"
    m = re.match(r"^([A-Za-z]{3})[a-z]*\.? ?'?(\d{2}|\d{4})$", s)
    if m and m[1].lower() in MON:
        y = int(m[2]); y = y + (2000 if y < 50 else 1900) if y < 100 else y
        return f"{y:04d}-{MON[m[1].lower()]:02d}-01"
    v = num(s)
    if v is not None and re.match(r"^-?[\d.,]+$", s): return v
    return s


def parse_table(txt):
    rows = [r.strip() for r in txt.replace("<0x0A>", "\n").split("\n") if r.strip()]
    rows = [r for r in rows if not r.upper().startswith("TITLE")]
    cells = [[c.strip() for c in r.split("|")] for r in rows]
    if len(cells) < 2: return None
    head, body = cells[0], cells[1:]
    k = len(head) - 1
    if k < 1: return None
    series = []
    for j in range(1, k + 1):
        pts = []
        for i, r in enumerate(body):
            if j >= len(r): continue
            v = num(r[j])
            if v is None: continue
            pts.append({"x": as_x(r[0]), "y": v, "px": i, "py": 0})
        if pts: series.append({"type": "deplot", "name": head[j], "points": pts})
    return series


def main():
    a = sys.argv[1:]
    d, outp = a[0], a[1]
    split = a[a.index("--split") + 1] if "--split" in a else None
    n = int(a[a.index("--sample") + 1]) if "--sample" in a else None
    model = a[a.index("--model") + 1] if "--model" in a else "google/deplot"
    truth = [t for t in json.load(open(os.path.join(d, "truth.json"))) if not split or t.get("split", split) == split]
    if n and n < len(truth):
        rnd = random.Random(int(a[a.index("--seed") + 1]) if "--seed" in a else 0)
        # stratified by family so every family is in the sample
        fams = sorted({t["family"] for t in truth}); pick = []
        per = max(1, n // len(fams))
        for f in fams:
            ts = [t for t in truth if t["family"] == f]; rnd.shuffle(ts); pick += ts[:per]
        truth = sorted(pick, key=lambda t: t["file"])
    imgdir = os.path.join(d, "images") if os.path.isdir(os.path.join(d, "images")) else d
    torch.set_num_threads(2)
    proc = Pix2StructProcessor.from_pretrained(model)
    net = Pix2StructForConditionalGeneration.from_pretrained(model).eval()
    out = json.load(open(outp)) if os.path.exists(outp) else {}
    for t in truth:
        if t["file"] in out: continue
        im = Image.open(os.path.join(imgdir, t["file"])).convert("RGB")
        t0 = time.time()
        inp = proc(images=im, text="Generate underlying data table of the figure below:", return_tensors="pt")
        with torch.no_grad():
            ids = net.generate(**inp, max_new_tokens=512)
        txt = proc.decode(ids[0], skip_special_tokens=True)
        ms = (time.time() - t0) * 1000
        S = parse_table(txt)
        if t["family"] in ("pie", "donut") and S:
            S = [{"type": "pie", "name": "Share", "points": [{"x": p["x"], "y": p["y"]} for p in S[0]["points"]]}]
            tot = sum(p["y"] for p in S[0]["points"]) or 1
            if abs(tot - 100) > 5: S[0]["points"] = [{"x": p["x"], "y": p["y"] / tot * 100} for p in S[0]["points"]]
        out[t["file"]] = {"ok": bool(S), "code": None if S else "unparsed", "chartType": None, "reliable": True, "confidence": 1.0,
                          "series": S or [], "ms_total": ms, "raw": txt}
        print(t["file"], t["family"], f"{ms/1000:.1f}s", (txt[:90] + "...") if len(txt) > 90 else txt, flush=True)
        json.dump(out, open(outp, "w"))
    json.dump(out, open(outp, "w"))


if __name__ == "__main__":
    main()
