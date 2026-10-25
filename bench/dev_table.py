import json, sys, os, collections
# usage: python3 bench/dev_table.py tagA tagB [..]  read right per family per set (ok+refused_ok), and accepted right (ok)
S=os.environ.get('STEPS') or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'results', 'v3', 'steps')
tags=sys.argv[1:]
for st in ['syn','fam','owid']:
    D={t:json.load(open(os.path.join(S, f'bk_{t}_{st}.json'))) for t in tags}
    fams=sorted({x['family'] for x in D[tags[0]]})
    rr=lambda d,f=None:[x for x in d if f is None or x['family']==f]
    def cell(d):
        n=len(d); r=sum(x['cause'] in('ok','refused_ok') for x in d); a=sum(x['cause']=='ok' for x in d); return f"{100*r/n:5.1f}/{100*a/n:5.1f}"
    print(f"{st:13}"+''.join(f"{t:>14}" for t in tags), ' (read right/accepted right %)')
    for f in fams+[None]: print(f"  {(f or 'ALL'):11}"+''.join(f"{cell(rr(D[t],f)):>14}" for t in tags), f"n={len(rr(D[tags[0]],f))}")
