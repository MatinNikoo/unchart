"""Real FRED charts (drawn by FRED itself) with the CSV of the same series as ground truth.

FRED's terms do not allow redistributing its graphs or caching its content, so these images are
NOT part of the released dataset. This script fetches them fresh into data/real-fred (gitignored)
when you want to score them. Only series from public domain sources (BLS, BEA, Census, Federal
Reserve Board, EIA, Treasury) are used. Graphs: FRED, Federal Reserve Bank of St. Louis.

python3 bench/real/fetch_fred.py
"""
import csv, hashlib, io, json, os, random, sys, time, urllib.request

H = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(H, "..", "..", "data", "real-fred")
UA = {"User-Agent": "unchart-benchmark/1.0 (github.com/MatinNikoo/unchart)"}
# (series, source). all public domain per FRED's series notes
SERIES = [("UNRATE", "BLS"), ("CPIAUCSL", "BLS"), ("PAYEMS", "BLS"), ("CIVPART", "BLS"), ("U6RATE", "BLS"), ("PPIACO", "BLS"),
          ("JTSJOL", "BLS"), ("AHETPI", "BLS"), ("GDP", "BEA"), ("GDPC1", "BEA"), ("PCE", "BEA"), ("PSAVERT", "BEA"),
          ("HOUST", "Census"), ("RSAFS", "Census"), ("FEDFUNDS", "Federal Reserve Board"), ("DGS10", "Federal Reserve Board"),
          ("DGS2", "Federal Reserve Board"), ("INDPRO", "Federal Reserve Board"), ("TCU", "Federal Reserve Board"),
          ("M2SL", "Federal Reserve Board"), ("DEXUSEU", "Federal Reserve Board"), ("WALCL", "Federal Reserve Board"),
          ("DCOILWTICO", "EIA"), ("GASREGW", "EIA")]
PAIRS = [("DGS10", "DGS2"), ("UNRATE", "U6RATE"), ("FEDFUNDS", "DGS10"), ("GDP", "PCE")]


def specs(n=64):
    rng = random.Random(7)
    out = []
    for i in range(n):
        if rng.random() < 0.2:
            ids = list(rng.choice(PAIRS))
        else:
            ids = [rng.choice(SERIES)[0]]
        y1 = rng.randint(1995, 2021)
        span = rng.choice([2, 3, 5, 8, 12, 20])
        y0 = max(1980, y1 - span)
        w, h = rng.choice([(1024, 623), (800, 450), (900, 500), (700, 420)])
        out.append({"id": f"f{i:04d}", "ids": ids, "cosd": f"{y0}-01-01", "coed": f"{y1}-12-31", "w": w, "h": h})
    return out


def get(u):
    for k in range(3):
        try: return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
        except Exception:
            if k == 2: raise
            time.sleep(4 * (k + 1))


def main():
    os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
    S = specs()
    json.dump(S, open(os.path.join(H, "fred_specs.json"), "w"), indent=0)
    truth = []
    for s in S:
        q = f"id={','.join(s['ids'])}&cosd={s['cosd']}&coed={s['coed']}"
        try:
            raw = get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?{q}").decode()
            time.sleep(0.6)
            png = get(f"https://fred.stlouisfed.org/graph/fredgraph.png?{q}&width={s['w']}&height={s['h']}")
            time.sleep(0.6)
        except Exception as e:
            print(s["id"], "failed", e); continue
        rd = list(csv.reader(io.StringIO(raw)))
        head, rows = rd[0], rd[1:]
        series = []
        for j, sid in enumerate(head[1:], 1):
            pts = [(r[0], float(r[j])) for r in rows if r[j] not in ("", ".")]
            series.append({"name": sid, "x": [p[0] for p in pts], "y": [p[1] for p in pts]})
        fn = s["id"] + ".png"
        open(os.path.join(OUT, "images", fn), "wb").write(png)
        truth.append({"id": s["id"], "file": fn, "family": "line", "xkind": "date", "series": series, "renderer": "fred", "look": "fred",
                      "degradation": {"kind": "clean"}, "readable": True, "ylog": False, "source": "https://fred.stlouisfed.org/graph/?" + q,
                      "split": "dev" if int(hashlib.sha256(s["id"].encode()).hexdigest(), 16) % 4 == 0 else "test",
                      "fetched": time.strftime("%Y-%m-%d")})
        print(fn, s["ids"], len(series[0]["x"]), flush=True)
    json.dump(truth, open(os.path.join(OUT, "truth.json"), "w"))
    print(len(truth), "charts")


if __name__ == "__main__":
    main()
