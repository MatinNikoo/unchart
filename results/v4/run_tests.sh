# engine v4 (frozen, see results/v4/freeze.txt) on the test sets, once, in Chromium with the OCR saved for node replays
export PORT=34199
node bench/run.js dataset/synthetic-test3 results/v4/test3.json --cache
node bench/run.js dataset/synthetic-families-test3 results/v4/families_test3.json --cache
node bench/run.js dataset/real-owid results/v4/owid_test.json --split test --cache
node bench/run.js data/real-fred results/v4/fred.json --cache
