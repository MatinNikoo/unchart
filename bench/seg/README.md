# The mark model

How the model in `vendor/seg/unchart_marks.onnx` was made. What it does and how well is in
[`results/v4/dev_progress.md`](../../results/v4/dev_progress.md).

```bash
pip install -r requirements-model.txt
# training charts with a label for every pixel (data/ is gitignored)
python3 bench/seg/gen.py data/seg/train 0 8000          # matplotlib looks, about 0.6 s a chart
python3 bench/seg/gen.py data/seg/train 8000 8000       # the harder half
python3 bench/seg/gen_web.py specs data/seg/train 20000 3000
node bench/seg/gen_web.js data/seg/train data/seg/train/web_specs_20000.json
python3 bench/seg/gen_web.py degrade data/seg/train 20000 3000
python3 bench/seg/gen_web.py specs data/seg/train 23000 3000
node bench/seg/gen_web.js data/seg/train data/seg/train/web_specs_23000.json
python3 bench/seg/gen_web.py degrade data/seg/train 23000 3000
# train (rerun the same line to resume), export, score
python3 bench/seg/train.py --iters 20000 --crop 192 --out data/seg/ckpt_b
python3 bench/seg/export.py data/seg/ckpt_b/it20000.pt vendor/seg/unchart_marks.onnx
python3 bench/seg/eval_pix.py vendor/seg/unchart_marks.onnx results/v4/seg_val.json --n 150
SEG=vendor/seg/unchart_marks.onnx sh bench/devrun.sh mytag
```

The frozen model was trained in two stages because the second half of the data was made while the first run was
going. The run in `results/v4/train_log_b.csv` started on the first 11,000 charts and picked up the rest as they were
written (the chart list is read again every 500 steps). Training on CPU is not bit for bit repeatable, so a rerun gives
a model close to this one, not the same file.
