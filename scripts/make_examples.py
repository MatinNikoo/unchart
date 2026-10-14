"""Three example charts for the app. The data is made up and labeled as an example."""
import numpy as np, matplotlib, json
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mt
plt.rcParams["font.family"] = "DejaVu Sans"

# 1. a spreadsheet style line chart, two series
yrs = np.arange(2016, 2026)
a = [1.8, 2.4, 3.1, 3.0, 4.6, 6.2, 7.9, 8.4, 10.1, 12.7]
b = [3.2, 3.5, 3.9, 4.4, 4.1, 4.8, 5.2, 5.9, 6.1, 6.6]
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.plot(yrs, a, color="#1a73e8", lw=2.4, marker="o", ms=5, label="Online")
ax.plot(yrs, b, color="#e8710a", lw=2.4, marker="o", ms=5, label="Stores")
ax.set_title("Sales by channel ($ millions)", loc="left", fontsize=13, color="#202124")
ax.grid(axis="y", color="#e0e0e0"); ax.set_axisbelow(True)
for s in ["top", "right", "left"]: ax.spines[s].set_visible(False)
ax.tick_params(colors="#5f6368", length=0); ax.legend(frameon=False, loc="upper left")
ax.set_xticks(yrs[::1]); fig.tight_layout(); fig.savefig("examples/ex_line.png"); plt.close(fig)

# 2. bars on an axis that does not start at zero
cats = ["Austin", "Denver", "Boston", "Seattle", "Miami", "Chicago"]
v = [78.4, 81.2, 79.6, 84.1, 76.9, 80.3]
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.bar(cats, v, color="#0f9d58", width=.62)
ax.set_ylim(75, 86)
ax.set_title("Customer satisfaction by store", loc="left", fontsize=13)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
fig.tight_layout(); fig.savefig("examples/ex_bars.png"); plt.close(fig)

# 3. a dark dashboard scatter
rng = np.random.default_rng(4)
x = rng.uniform(5, 95, 28); y = 12 + 0.9 * x + rng.normal(0, 9, 28)
with plt.style.context("dark_background"):
    fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
    fig.patch.set_facecolor("#14171c"); ax.set_facecolor("#14171c")
    ax.scatter(x, y, color="#ff5c8a", s=34)
    ax.set_title("Ad spend vs revenue per campaign ($k)", loc="left", fontsize=13)
    ax.grid(color="#2a2f37"); ax.set_axisbelow(True)
    for s in ["top", "right"]: ax.spines[s].set_visible(False)
    fig.tight_layout(); fig.savefig("examples/ex_dots.png", facecolor=fig.get_facecolor()); plt.close(fig)
json.dump([{"file": "ex_line.png", "type": "line", "x": [float(t) for t in yrs], "series": [a, b], "scale": "ex", "style": "ex"},
           {"file": "ex_bars.png", "type": "bar", "x": cats, "series": [v], "scale": "ex", "style": "ex"},
           {"file": "ex_dots.png", "type": "scatter", "x": [float(t) for t in x], "series": [[float(t) for t in y]], "scale": "ex", "style": "ex"}],
          open("examples/truth.json", "w"))
