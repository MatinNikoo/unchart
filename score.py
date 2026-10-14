"""Score the extracted numbers against the true data behind each chart."""
import json, os, sys, itertools
import numpy as np

H = os.path.dirname(__file__)
DIR = os.environ.get('DIR', 'charts')
truth = {t["file"]: t for t in json.load(open(os.path.join(H, DIR + '/truth.json')))}
res = json.load(open(os.path.join(H, sys.argv[1] if len(sys.argv) > 1 else "results.json")))


def line_err(tx, ty, s, span):
    pts = sorted((p["x"], p["y"]) for p in s["points"] if isinstance(p["x"], (int, float)))
    if len(pts) < 2: return 1.0
    ex, ey = np.array(pts).T
    yi = np.interp(tx, ex, ey)
    covered = (tx >= ex.min() - 1e-6) & (tx <= ex.max() + 1e-6)
    e = np.abs(yi - ty) / span
    e[~covered] = np.maximum(e[~covered], 0.5)
    return float(e.mean())


rows = []
for f, t in truth.items():
    r = res.get(f)
    if r is None: continue
    span = max(max(y) for y in t["series"]) - min(min(y) for y in t["series"])
    span = max(span, 1e-9)
    if not r["ok"]:
        rows.append((f, t["type"], 1.0, False, r.get("error")));
        continue
    ext = [s for s in r["series"]]
    if t["type"] == "line":
        tx = np.array(t["x"])
        lines = [s for s in ext if s["type"] == "line"]
        k = len(t["series"])
        best = 1.0
        if lines:
            for perm in itertools.permutations(range(len(lines)), min(k, len(lines))):
                errs = [line_err(tx, np.array(t["series"][i]), lines[j], span) for i, j in enumerate(perm)]
                errs += [1.0] * (k - len(perm))
                best = min(best, float(np.mean(errs)))
        exact = all(len(s["points"]) == len(tx) for s in lines) and len(lines) == k
        rows.append((f, "line", best, exact, f"{len(lines)}/{k} series"))
    elif t["type"] == "bar":
        bars = [s for s in ext if s["type"] == "bar"]
        ty = np.array(t["series"][0])
        if not bars: rows.append((f, "bar", 1.0, False, "no bars")); continue
        ey = np.array([p["y"] for p in bars[0]["points"]])
        n = min(len(ey), len(ty))
        e = np.abs(ey[:n] - ty[:n]) / max(ty.max(), 1e-9)
        err = float(np.concatenate([e, np.ones(abs(len(ey) - len(ty)))]).mean())
        rows.append((f, "bar", err, len(ey) == len(ty), f"{len(ey)}/{len(ty)} bars"))
    else:
        sc = [s for s in ext if s["type"] == "scatter"]
        tx, ty = np.array(t["x"]), np.array(t["series"][0])
        if not sc: rows.append((f, "scatter", 1.0, False, "no dots: " + ",".join(s["type"] for s in ext))); continue
        E = np.array([(p["x"], p["y"]) for s in sc for p in s["points"]])
        xs = max(np.ptp(tx), 1e-9)
        d = np.sqrt(((E[None, :, 0] - tx[:, None]) / xs) ** 2 + ((E[None, :, 1] - ty[:, None]) / span) ** 2).min(1)
        rows.append((f, "scatter", float(np.minimum(d, 1).mean()), abs(len(E) - len(tx)) <= max(1, .05 * len(tx)), f"{len(E)}/{len(tx)} points"))

print(f"{'file':10} {'type':8} {'error':>7}  exact  note")
for f, ty, e, ex, note in rows: print(f"{f:10} {ty:8} {e*100:6.2f}%  {'yes' if ex else 'no ':5}  {note}")
for ty in ["line", "bar", "scatter"]:
    E = [e for _, t2, e, _, _ in rows if t2 == ty]
    X = [x for _, t2, _, x, _ in rows if t2 == ty]
    if E: print(f"{ty:8} n={len(E):2d}  median error {np.median(E)*100:.2f}%  mean {np.mean(E)*100:.2f}%  within 2%: {np.mean(np.array(E)<.02)*100:.0f}%  exact count: {np.mean(X)*100:.0f}%")
E = [e for *_, e, _, _ in [(r[0], r[1], r[2], r[3], r[4]) for r in rows]]
print(f"ALL      n={len(E):2d}  median error {np.median(E)*100:.2f}%  within 2%: {np.mean(np.array(E)<.02)*100:.0f}%  failures: {sum(1 for r in rows if r[2]>=.999)}")
