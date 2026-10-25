"""Test inputs for test/ui.js: a PDF page with two charts, and a phone photo of a chart on a screen."""
import os
import numpy as np, cv2
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
H = os.path.dirname(os.path.abspath(__file__))
# a report page: a paragraph, a bar chart, more text, a line chart
fig = plt.figure(figsize=(8.5, 11))
fig.text(0.08, 0.95, "Quarterly report", fontsize=18, weight="bold")
fig.text(0.08, 0.91, "Sales grew in every region except the West. The chart below shows the totals.", fontsize=10)
a = fig.add_axes([0.12, 0.58, 0.8, 0.28]); a.bar(["North", "South", "East", "West"], [42, 55, 61, 38], color="#4472C4"); a.set_title("Sales by region")
fig.text(0.08, 0.50, "Signups climbed steadily through the year.", fontsize=10)
b = fig.add_axes([0.12, 0.12, 0.8, 0.3]); b.plot(range(2015, 2025), [3, 4, 4.5, 6, 7.2, 7, 8.4, 9.1, 10.5, 12], color="#ED7D31", lw=2); b.set_title("Signups (thousands)")
fig.savefig(os.path.join(H, "two_charts.pdf")); plt.close(fig)
# a photo: the bar example shown on a screen, shot at an angle on a dark desk, a bit blurry and noisy
img = cv2.imread(os.path.join(H, "..", "..", "examples", "ex_bars.png"))
h, w = img.shape[:2]
W, Hh = 1100, 820
dst = np.float32([[120, 90], [1010, 140], [980, 700], [90, 730]])
M = cv2.getPerspectiveTransform(np.float32([[0, 0], [w, 0], [w, h], [0, h]]), dst)
out = cv2.warpPerspective(img, M, (W, Hh), borderValue=(38, 36, 34))
out = cv2.GaussianBlur(out, (3, 3), 0.8)
rng = np.random.default_rng(1)
out = np.clip(out.astype(np.float32) * 0.92 + rng.normal(0, 4, out.shape), 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(H, "photo.jpg"), out, [cv2.IMWRITE_JPEG_QUALITY, 85])
print("ok")
