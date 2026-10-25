"""Packs every set in dataset/ into zips of at most 22 MB for a GitHub release, and writes dataset/release.json.

python3 bench/pack_dataset.py <out dir>

The three first version sets (charts, charts2, charts3, pictures only) go into legacy-charts.zip and unpack next to the dataset folder.
Each zip holds <set>/images/... and, in the first part, truth.json, manifest.json and specs.json. A set that is bigger than
the limit is split into part1, part2 and so on. The raw (undegraded) renders are not packed, bench/build.py makes them again from specs.json.
dataset/release.json lists every zip with its size and sha256, which bench/get_dataset.py checks after downloading.
"""
import hashlib, json, os, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "dataset")
LIMIT = 22 * 1024 * 1024
META = ["truth.json", "manifest.json", "specs.json"]


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    out = os.path.abspath(sys.argv[1])
    os.makedirs(out, exist_ok=True)
    rel = {}
    for name in sorted(os.listdir(D)):
        sd = os.path.join(D, name)
        if not os.path.isdir(sd) or name.startswith("."):
            continue
        imgs = sorted(os.listdir(os.path.join(sd, "images")))
        want = len(json.load(open(os.path.join(sd, "manifest.json")))["files"])
        if len(imgs) != want:
            sys.exit(f"{name} has {len(imgs)} images but its manifest lists {want}; unpack the full set first (bench/get_dataset.py)")
        meta = [m for m in META if os.path.exists(os.path.join(sd, m))]
        sizes = {f: os.path.getsize(os.path.join(sd, "images", f)) for f in imgs}
        m0 = sum(os.path.getsize(os.path.join(sd, m)) for m in meta)
        n = max(1, -(-(sum(sizes.values()) + m0) // LIMIT))   # equal parts rather than full parts and a small rest
        cap = (sum(sizes.values()) + m0) / n * 1.02
        parts, cur, size = [], [], m0
        for f in imgs:
            s = sizes[f]
            if cur and size + s > cap and len(parts) < n - 1:
                parts.append(cur); cur, size = [], 0
            cur.append(f); size += s
        parts.append(cur)
        rel[name] = []
        for i, files in enumerate(parts):
            zn = f"{name}.zip" if len(parts) == 1 else f"{name}-part{i + 1}.zip"
            zp = os.path.join(out, zn)
            with zipfile.ZipFile(zp, "w", zipfile.ZIP_STORED) as z:   # pictures are already compressed
                if i == 0:
                    for m in meta:
                        z.write(os.path.join(sd, m), f"{name}/{m}")
                for f in files:
                    z.write(os.path.join(sd, "images", f), f"{name}/images/{f}")
            rel[name].append({"zip": zn, "bytes": os.path.getsize(zp), "sha256": sha(zp), "images": len(files)})
            print(zn, round(os.path.getsize(zp) / 1e6, 1), "MB", len(files), "images")
    # the three first version sets (charts, charts2, charts3) sit in the repo root with their pictures next to truth.json
    if len(os.listdir(os.path.join(ROOT, "charts"))) < 61:
        sys.exit("charts holds only a sample; unpack the full first version sets first")
    zn = "legacy-charts.zip"
    zp = os.path.join(out, zn)
    n = 0
    with zipfile.ZipFile(zp, "w", zipfile.ZIP_STORED) as z:
        for d in ("charts", "charts2", "charts3"):
            for f in sorted(os.listdir(os.path.join(ROOT, d))):
                if f != "truth.json":
                    z.write(os.path.join(ROOT, d, f), f"{d}/{f}"); n += 1
    rel["legacy-charts"] = [{"zip": zn, "bytes": os.path.getsize(zp), "sha256": sha(zp), "images": n, "root": True}]
    print(zn, round(os.path.getsize(zp) / 1e6, 1), "MB", n, "images")
    json.dump(rel, open(os.path.join(D, "release.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
