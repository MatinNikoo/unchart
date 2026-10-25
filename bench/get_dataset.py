"""Downloads the benchmark charts that are too big for the repo and unpacks them into dataset/.

python3 bench/get_dataset.py                 all sets
python3 bench/get_dataset.py synthetic-test3 just that set
python3 bench/get_dataset.py --from <dir>    unpack zips you already have in <dir> instead of downloading

The zips are attached to the GitHub release named in RELEASE below. dataset/release.json says which zips make up each set
and their sha256, which are checked before anything is unpacked. FRED charts are not in the release, see bench/real/fetch_fred.py.
"""
import hashlib, json, os, sys, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, "dataset")
RELEASE = "https://github.com/MatinNikoo/unchart/releases/download/dataset-v1/"


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def main():
    a = sys.argv[1:]
    src = a[a.index("--from") + 1] if "--from" in a else None
    names = [x for x in a if not x.startswith("--") and x != src]
    rel = json.load(open(os.path.join(D, "release.json")))
    for name, zips in rel.items():
        if names and name not in names:
            continue
        have = os.path.join(D, name, "images")
        if name == "legacy-charts":
            have = os.path.join(ROOT, "charts")
            if os.path.isdir(have) and len(os.listdir(have)) > 20:
                print(name, "already complete")
                continue
        elif os.path.isdir(have) and len(os.listdir(have)) >= sum(z["images"] for z in zips):
            print(name, "already complete")
            continue
        for z in zips:
            p = os.path.join(src, z["zip"]) if src else os.path.join(D, ".download", z["zip"])
            if not src:
                os.makedirs(os.path.dirname(p), exist_ok=True)
                if not os.path.exists(p):
                    print("downloading", z["zip"])
                    urllib.request.urlretrieve(RELEASE + z["zip"], p)
            if sha(p) != z["sha256"]:
                sys.exit(f"{p} does not match the checksum in dataset/release.json")
            with zipfile.ZipFile(p) as zf:
                zf.extractall(ROOT if z.get("root") else D)
            print("unpacked", z["zip"])


if __name__ == "__main__":
    main()
