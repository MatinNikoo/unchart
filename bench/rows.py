"""Print scored rows, filtered: python3 bench/rows.py scored.json [family] [--bad]"""
import json, sys
s = json.load(open(sys.argv[1]))
fam = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
for r in s["rows"]:
    if fam and r["family"] != fam: continue
    if "--bad" in sys.argv and r["success"]: continue
    print(f"{r['file']:10} {r['family']:12} {str(r['pred']):12} err {r['err']*100:6.2f}% ok {int(r['ok'])} rel {int(r['reliable'])} type {int(r['type_ok'])} cnt {int(r['count_ok'])} ax {r['axis_miss']} xm {int(r['x_miss'])} {r['renderer']:10} {r['degradation']:7} {r['code'] or ''}")
