"""Real charts from Our World in Data, with the exact numbers behind them.

Each grapher chart has a PNG export and a "filtered" CSV with only the data drawn in that chart,
so the CSV is the ground truth for the PNG. Charts and data are CC BY 4.0 (ourworldindata.org).
Picks charts at random from the sitemap with a fixed seed, keeps the chart types Unchart is meant
to read, and splits them into dev (25%) and a frozen test part (75%).

python3 bench/real/fetch_owid.py [n_target]
"""
import csv, hashlib, io, json, os, random, re, sys, time, urllib.request

H = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(H, "..", "..", "dataset", "real-owid")
UA = {"User-Agent": "unchart-benchmark/1.0 (github.com/MatinNikoo/unchart)"}
QUOTA = {"LineChart": 110, "StackedArea": 20, "StackedBar": 10, "DiscreteBar": 20, "StackedDiscreteBar": 10}
FAM = {"LineChart": "line", "StackedArea": "stacked_area", "StackedBar": "stacked_bar", "DiscreteBar": "hbar", "StackedDiscreteBar": "stacked_hbar"}


def get(u, tries=3):
    for k in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60).read()
        except Exception as e:
            if k == tries - 1: raise
            time.sleep(3 * (k + 1))


def num(v):
    try: return float(v)
    except ValueError: return None


def truth_from(slug, cfg, rows, head):
    t_col = head[2]
    vcols = head[3:]
    ct = cfg.get("chartTypes")
    ctype = cfg.get("type", "LineChart") if ct is None else ct[0]
    ents = []
    for r in rows:
        if r[0] not in ents: ents.append(r[0])
    xkind = "num" if t_col == "Year" else "date"
    def tx(v): return float(v) if xkind == "num" else (v + "-01" if len(v) == 7 else v)
    if ctype in ("LineChart", "StackedArea"):
        if len(ents) > 1 and len(vcols) > 1: return None, "facets"
        if len(ents) > 12 or len(vcols) > 12: return None, "too many series"
        series = []
        keys = [(e, vcols[0]) for e in ents] if len(ents) > 1 else [(ents[0], c) for c in vcols]
        for e, c in keys:
            ci = head.index(c)
            pts = [(tx(r[2]), num(r[ci])) for r in rows if r[0] == e and num(r[ci]) is not None]
            if len(pts) >= 2: series.append({"name": e if len(ents) > 1 else c, "x": [p[0] for p in pts], "y": [p[1] for p in pts]})
        if not series or max(len(s["x"]) for s in series) < 4: return None, "too few points"
        return {"family": FAM[ctype], "xkind": xkind, "series": series}, None
    if ctype == "StackedBar":
        if len(ents) > 1 and len(vcols) > 1: return None, "facets"
        keys = [(e, vcols[0]) for e in ents] if len(ents) > 1 else [(ents[0], c) for c in vcols]
        xs = sorted({tx(r[2]) for r in rows}, key=lambda v: str(v) if xkind == "date" else v)
        if len(xs) > 30 or len(xs) < 2: return None, "bar count"
        series = []
        for e, c in keys:
            ci = head.index(c); m = {tx(r[2]): num(r[ci]) for r in rows if r[0] == e}
            series.append({"name": e if len(ents) > 1 else c, "y": [m.get(x) or 0.0 for x in xs]})
        return {"family": "stacked_bar", "xkind": "cat", "x": [str(int(x)) if xkind == "num" else x for x in xs], "series": series}, None
    if ctype in ("DiscreteBar", "StackedDiscreteBar"):
        # the bars show each entity at the latest time in the filtered data
        last = {}
        key = (lambda v: v) if xkind == "date" else float
        for r in rows:
            if r[0] not in last or key(r[2]) > key(last[r[0]][2]): last[r[0]] = r
        if len(last) > 16 or len(last) < 2: return None, "bar count"
        if ctype == "DiscreteBar":
            vals = [(e, num(last[e][3])) for e in last if num(last[e][3]) is not None]
            vals.sort(key=lambda q: -q[1])
            return {"family": "hbar", "xkind": "cat", "x": [e for e, _ in vals], "series": [{"name": vcols[0], "y": [v for _, v in vals]}], "order_assumed": "value desc"}, None
        tot = {e: sum(num(last[e][head.index(c)]) or 0 for c in vcols) for e in last}
        order = sorted(last, key=lambda e: -tot[e])
        return {"family": "stacked_hbar", "xkind": "cat", "x": order, "order_assumed": "total desc",
                "series": [{"name": c, "y": [num(last[e][head.index(c)]) or 0.0 for e in order]} for c in vcols]}, None
    return None, "type"


def order_bars(t, cfg):
    """sort the bars like the grapher does: by a chosen column, by name, or by value (total) high to low"""
    by, desc = cfg.get("sortBy"), (cfg.get("sortOrder") or "desc") != "asc"
    S = t["series"]
    if by == "column" and cfg.get("sortColumnSlug"):
        ids = [str(d.get("variableId")) for d in cfg.get("dimensions", []) if d.get("property") == "y"]
        k = ids.index(str(cfg["sortColumnSlug"])) if str(cfg["sortColumnSlug"]) in ids else 0
        key = [S[min(k, len(S) - 1)]["y"][i] for i in range(len(t["x"]))]
    elif by == "entityName":
        key = t["x"]; desc = (cfg.get("sortOrder") or "asc") == "desc"
    else:
        key = [sum(s["y"][i] or 0 for s in S) for i in range(len(t["x"]))]
    o = sorted(range(len(t["x"])), key=lambda i: key[i], reverse=desc)
    t["x"] = [t["x"][i] for i in o]
    for s in S: s["y"] = [s["y"][i] for i in o]
    t["sort"] = by or "value"
    t.pop("order_assumed", None)


def main():
    n_target = int(sys.argv[1]) if len(sys.argv) > 1 else sum(QUOTA.values())
    os.makedirs(os.path.join(OUT, "images"), exist_ok=True)
    sm = get("https://ourworldindata.org/sitemap.xml").decode()
    slugs = sorted(set(re.findall(r"<loc>https://ourworldindata.org/grapher/([^<?/]+)</loc>", sm)))
    random.Random(2026).shuffle(slugs)
    tp = os.path.join(OUT, "truth.json")
    truth = json.load(open(tp)) if os.path.exists(tp) else []
    done = {t["slug"] for t in truth}
    have = {k: sum(1 for t in truth if t["owid_type"] == k) for k in QUOTA}
    log = open(os.path.join(H, "fetch_owid.log"), "a")
    for slug in slugs:
        if len(truth) >= n_target or all(have[k] >= QUOTA[k] for k in QUOTA): break
        if slug in done: continue
        try:
            cfg = json.loads(get(f"https://ourworldindata.org/grapher/{slug}.config.json"))
        except Exception as e:
            print(slug, "config", e, file=log); continue
        ct = cfg.get("chartTypes")
        ctype = cfg.get("type", "LineChart") if ct is None else (ct[0] if ct else None)
        if ctype not in QUOTA or have[ctype] >= QUOTA[ctype]: continue
        if cfg.get("stackMode") == "relative" or (cfg.get("yAxis") or {}).get("canChangeScaleType"): continue
        time.sleep(0.5)
        try:
            raw = get(f"https://ourworldindata.org/grapher/{slug}.csv?v=1&csvType=filtered&useColumnShortNames=false&tab=chart").decode("utf-8")
        except Exception as e:
            print(slug, "csv", e, file=log); continue
        rd = list(csv.reader(io.StringIO(raw)))
        head, rows = rd[0], rd[1:]
        if len(head) < 4 or head[2] not in ("Year", "Day", "Month") or not rows: print(slug, "csv shape", head[:4], file=log); continue
        t, why = truth_from(slug, cfg, rows, head)
        if not t: print(slug, "skip", why, file=log); continue
        time.sleep(0.5)
        try:
            png = get(f"https://ourworldindata.org/grapher/{slug}.png?tab=chart")
        except Exception as e:
            print(slug, "png", e, file=log); continue
        fn = f"o{len(truth):04d}.png"
        open(os.path.join(OUT, "images", fn), "wb").write(png)
        meta = {}
        try: meta = json.loads(get(f"https://ourworldindata.org/grapher/{slug}.metadata.json")).get("chart", {})
        except Exception: pass
        ya = cfg.get("yAxis") or {}
        t.update({"file": fn, "id": fn[:-4], "slug": slug, "owid_type": ctype, "renderer": "owid", "look": "owid", "degradation": {"kind": "clean"},
                  "ylog": ya.get("scaleType") == "log", "readable": True, "title": meta.get("title") or cfg.get("title"),
                  "source": f"https://ourworldindata.org/grapher/{slug}", "citation": meta.get("citation"), "license": "CC BY 4.0",
                  "fetched": time.strftime("%Y-%m-%d")})
        truth.append(t); have[ctype] += 1
        print(fn, ctype, slug, flush=True)
        json.dump(truth, open(tp, "w"), indent=0)
        time.sleep(0.5)
    # horizontal bar charts: put the bars in the order the chart draws them (its sort setting)
    for t in truth:
        if t["family"] in ("hbar", "stacked_hbar") and "sort" not in t:
            try: cfg = json.loads(get(f"https://ourworldindata.org/grapher/{t['slug']}.config.json"))
            except Exception as e: print(t["slug"], "config", e, file=log); continue
            order_bars(t, cfg); time.sleep(0.5)
    json.dump(truth, open(tp, "w"), indent=0)
    # split: a fixed hash of the slug decides dev or test, so adding charts never moves old ones
    for t in truth:
        t["split"] = "dev" if int(hashlib.sha256(t["slug"].encode()).hexdigest(), 16) % 4 == 0 else "test"
    json.dump(truth, open(tp, "w"), indent=0)
    man = {t["file"]: hashlib.sha256(open(os.path.join(OUT, "images", t["file"]), "rb").read()).hexdigest() for t in truth}
    json.dump({"files": man, "truth_sha256": hashlib.sha256(open(tp, "rb").read()).hexdigest()}, open(os.path.join(OUT, "manifest.json"), "w"), indent=0)
    print(len(truth), "charts", have)


if __name__ == "__main__":
    main()
