"""Export a checkpoint to ONNX for the browser. python3 bench/seg/export.py data/seg/ckpt/last.pt vendor/seg/unchart_marks.onnx"""
import sys, os, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import Net, load_ckpt

ck, out = sys.argv[1], sys.argv[2]
net = Net(); net.load_state_dict(load_ckpt(ck)["net"]); net.eval()
os.makedirs(os.path.dirname(out), exist_ok=True)
x = torch.rand(1, 3, 448, 800)
torch.onnx.export(net, x, out, input_names=["image"], output_names=["cls", "emb"], opset_version=17, dynamo=False,
                  dynamic_axes={"image": {2: "h", 3: "w"}, "cls": {2: "h", 3: "w"}, "emb": {2: "h", 3: "w"}})
print(out, os.path.getsize(out))
