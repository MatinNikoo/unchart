"""Wilson 95% intervals for every headline rate, from the scored result files.
Writes results/intervals.json and results/intervals.md. Rates in a scored file are taken over the readable charts
(the few charts whose axis numbers are hidden on purpose are scored separately), so the interval uses n_readable.
usage: python3 bench/intervals.py"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Z = 1.959964

# (set, engine and setting, scored file)
ROWS = [
    ("Synthetic, 14 types", "v1", "results/v1/synthetic_test_scored.json"),
    ("Synthetic, 14 types", "v2", "results/synthetic_test2_scored.json"),
    ("Synthetic, 14 types", "v4 default (rules only)", "results/v4/test3_rules_scored.json"),
    ("Synthetic, 14 types", "v4 with mark model", "results/v4/test3_scored.json"),
    ("Our World in Data", "v1", "results/v1/owid_test_scored.json"),
    ("Our World in Data", "v2", "results/owid_test_scored.json"),
    ("Our World in Data", "v4 default (rules only)", "results/v4/owid_test_rules_scored.json"),
    ("Our World in Data", "v4 with mark model", "results/v4/owid_test_scored.json"),
    ("FRED", "v1", "results/v1/fred_scored.json"),
    ("FRED", "v2", "results/fred_scored.json"),
    ("FRED", "v4 default (rules only)", "results/v4/fred_rules_scored.json"),
    ("FRED", "v4 with mark model", "results/v4/fred_scored.json"),
    ("8 newer types", "v2", "results/families_test_scored.json"),
    ("8 newer types", "v4 default (rules only)", "results/v4/families_test3_rules_scored.json"),
    ("8 newer types", "v4 with mark model", "results/v4/families_test3_scored.json"),
]
METRICS = [("read_right", "Read right"), ("success", "Success"), ("refused", "Refused"), ("silent_wrong", "Silent wrong")]


def wilson(k, n, z=Z):
    if n == 0:
        return (None, None)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (max(0.0, c - h), min(1.0, c + h))


def main():
    out, md = [], []
    md.append("| Set | Engine | Charts | Read right | Success | Refused | Silent wrong |")
    md.append("|---|---|---|---|---|---|---|")
    for name, eng, f in ROWS:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            continue
        o = json.load(open(p))["overall"]
        n = o["n_readable"]
        row = {"set": name, "engine": eng, "file": f, "n": o["n"], "n_readable": n}
        cells = []
        for key, label in METRICS:
            k = round(o[key] * n)
            lo, hi = wilson(k, n)
            row[key] = {"k": k, "n": n, "rate": k / n, "lo": lo, "hi": hi}
            cells.append(f"{100 * k / n:.1f}% ({100 * lo:.1f} to {100 * hi:.1f})")
        out.append(row)
        md.append(f"| {name} | {eng} | {o['n']} ({n} readable) | " + " | ".join(cells) + " |")
    json.dump(out, open(os.path.join(ROOT, "results", "intervals.json"), "w"), indent=1)
    open(os.path.join(ROOT, "results", "intervals.md"), "w").write(
        "Wilson 95% intervals on the held out test sets, computed by `bench/intervals.py` from the scored files.\n"
        "Rates are over the readable charts. Read right, success, refused and silent wrong are defined in `bench/score.py`.\n\n"
        + "\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
