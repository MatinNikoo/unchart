# scores the one Chromium run of engine v4 on each test set, then two node replays of the same OCR for comparison:
# engine v3 as it was frozen for v3 (results/v4/engine_v3.js with its calibration) and engine v4 without the model.
# The replays are for the comparison only, nothing was changed after them.
set -e
o=results/v4
s() { python3 bench/score.py $1 $2 $3 --out ${2%.json}_scored.json --quiet | tail -1; }
s dataset/synthetic-test3 $o/test3.json
s dataset/synthetic-families-test3 $o/families_test3.json
s dataset/real-owid $o/owid_test.json "--split test"
s data/real-fred $o/fred.json
for v in v3 noseg; do
  if [ $v = v3 ]; then E="ENGINE=$PWD/results/v4/engine_v3.js CAL=$PWD/results/v4/calibration_v3.json"; else E=""; fi
  env $E node bench/run_node.js dataset/synthetic-test3 $o/test3_$v.json > /dev/null; s dataset/synthetic-test3 $o/test3_$v.json
  env $E node bench/run_node.js dataset/synthetic-families-test3 $o/families_test3_$v.json > /dev/null; s dataset/synthetic-families-test3 $o/families_test3_$v.json
  env $E node bench/run_node.js dataset/real-owid $o/owid_test_$v.json --split test > /dev/null; s dataset/real-owid $o/owid_test_$v.json "--split test"
  env $E node bench/run_node.js data/real-fred $o/fred_$v.json > /dev/null; s data/real-fred $o/fred_$v.json
done
# and engine v4 with the model replayed in node too, so the three replays see exactly the same words
o=results/v4
SEG=vendor/seg/unchart_marks.onnx node bench/run_node.js dataset/synthetic-test3 $o/test3_node.json > /dev/null; s dataset/synthetic-test3 $o/test3_node.json
SEG=vendor/seg/unchart_marks.onnx node bench/run_node.js dataset/synthetic-families-test3 $o/families_test3_node.json > /dev/null; s dataset/synthetic-families-test3 $o/families_test3_node.json
SEG=vendor/seg/unchart_marks.onnx node bench/run_node.js dataset/real-owid $o/owid_test_node.json --split test > /dev/null; s dataset/real-owid $o/owid_test_node.json "--split test"
SEG=vendor/seg/unchart_marks.onnx node bench/run_node.js data/real-fred $o/fred_node.json > /dev/null; s data/real-fred $o/fred_node.json
