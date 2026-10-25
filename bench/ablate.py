"""Ablations on the dev split: switch off one part of the reader at a time and score the result.

python3 bench/ablate.py            (needs the OCR cache from `node bench/run.js <set> <out> --cache`)

Runs bench/run_node.js, which replays the cached OCR words, so every variant sees the same text and only the
image side changes. Writes results/ablation.json and results/ablation.md. Dev only: these are not test numbers.
"""
import json, os, subprocess, sys
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(H, "..")
sys.path.insert(0, H)
from score import score_chart, summarize, bad_render, IMG_H

VARIANTS = [
    ("full reader", []),
    ("no snapping labels to tick marks", ["--opts", '{"snap":false}']),
    ("no snapping lines to a data grid", ["--opts", '{"grid":false}']),
    ("no sub-pixel bar edges", ["--opts", '{"subpixel":false}']),
    ("no smoothing of grainy pictures", ["--opts", '{"denoise":false}']),
    ("no second read (agreement feature)", ["--opts", '{"check":false}']),
    ("no rotated label pass", ["--opts", '{"rotated":false}']),
    ("hand-set confidence instead of the fitted one", ["--nocal"]),
]


def main():
    sets = [("synthetic-dev", "dataset/synthetic-dev", None), ("owid-dev", "dataset/real-owid", "dev")]
    out, md = {}, ["# Ablations on dev", "", "Each row switches off one part of the reader. Dev charts only, OCR replayed from cache.", "",
                   "| Variant | Set | Charts | Success | Read right (any flag) | Silent wrong | Median error |", "|---|---|---|---|---|---|---|"]
    for name, args in VARIANTS:
        for sname, d, split in sets:
            tmp = os.path.join(ROOT, ".cache", "ablate.json")
            cmd = ["node", os.path.join(H, "run_node.js"), os.path.join(ROOT, d), tmp] + (["--split", split] if split else []) + args
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
            truth = json.load(open(os.path.join(ROOT, d, "truth.json")))
            from PIL import Image
            for t in truth:
                if t.get("family") == "histogram": IMG_H[t["file"]] = Image.open(os.path.join(ROOT, d, "images", t["file"])).size[1]
            res = json.load(open(tmp))
            rows = [score_chart(t, res.get(t["file"])) for t in truth if t["file"] in res and not bad_render(t)]
            s = summarize(rows)
            out.setdefault(name, {})[sname] = s
            md.append(f"| {name} | {sname} | {s['n']} | {s['success'] * 100:.1f}% | {s['read_right'] * 100:.1f}% | {s['silent_wrong'] * 100:.1f}% | {s['median_err_all'] * 100:.2f}% |")
            print(md[-1], flush=True)
    json.dump(out, open(os.path.join(ROOT, "results", "ablation.json"), "w"), indent=1)
    open(os.path.join(ROOT, "results", "ablation.md"), "w").write("\n".join(md) + "\n")


if __name__ == "__main__":
    main()
