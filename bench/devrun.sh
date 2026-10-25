#!/bin/sh
# node replay of the three dev splits plus the cause breakdown, saved as results/v4/steps/bk_<tag>_{syn,fam,owid}.json
# usage: [SEG=vendor/seg/unchart_marks.onnx] sh bench/devrun.sh <tag> [extra run_node args]
set -e
tag=$1; shift
out=results/v4/steps; mkdir -p $out
node bench/run_node.js dataset/synthetic-dev $out/run_${tag}_syn.json "$@"
node bench/run_node.js dataset/synthetic-families-dev $out/run_${tag}_fam.json "$@"
node bench/run_node.js dataset/real-owid $out/run_${tag}_owid.json --split dev "$@"
python3 bench/breakdown.py dataset/synthetic-dev $out/run_${tag}_syn.json > $out/bk_${tag}_syn.json
python3 bench/breakdown.py dataset/synthetic-families-dev $out/run_${tag}_fam.json > $out/bk_${tag}_fam.json
python3 bench/breakdown.py dataset/real-owid $out/run_${tag}_owid.json --split dev > $out/bk_${tag}_owid.json
STEPS=$out python3 bench/dev_table.py $tag
