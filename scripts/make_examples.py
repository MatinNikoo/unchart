"""Three example charts for the app. The data is made up and labeled as an example."""
import numpy as np, matplotlib, json
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mt
plt.rcParams["font.family"] = "DejaVu Sans"

# a spreadsheet style line chart, two series
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

# bars on an axis that does not start at zero
cats = ["Austin", "Denver", "Boston", "Seattle", "Miami", "Chicago"]
v = [78.4, 81.2, 79.6, 84.1, 76.9, 80.3]
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.bar(cats, v, color="#0f9d58", width=.62)
ax.set_ylim(75, 86)
ax.set_title("Customer satisfaction by store", loc="left", fontsize=13)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
fig.tight_layout(); fig.savefig("examples/ex_bars.png"); plt.close(fig)

# a dark dashboard scatter
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

# a donut with a legend, like a marketing dashboard
src = ["Search", "Social", "Direct", "Email", "Other"]
share = [42.0, 23.0, 18.0, 11.0, 6.0]
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.pie(share, colors=["#4285F4", "#EA4335", "#FBBC04", "#34A853", "#9AA0A6"], startangle=90, counterclock=False,
       wedgeprops={"width": 0.42, "edgecolor": "white", "linewidth": 2})
ax.legend(src, loc="center left", bbox_to_anchor=(1, .5), frameon=False)
ax.set_title("Where visitors come from", loc="left", fontsize=13); ax.set_aspect("equal")
fig.tight_layout(); fig.savefig("examples/ex_pie.png"); plt.close(fig)

# stacked horizontal bars
teams = ["Design", "Sales", "Support", "Engineering"]
parts = {"Meetings": [9, 14, 6, 7], "Focus work": [24, 12, 18, 26], "Admin": [5, 9, 12, 4]}
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
left = np.zeros(4)
for (k, v), c in zip(parts.items(), ["#4472C4", "#ED7D31", "#A5A5A5"]):
    ax.barh(teams[::-1], v[::-1], left=left, color=c, height=.6, label=k); left += np.array(v[::-1])
ax.set_title("Hours per week by team", loc="left", fontsize=13)
ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, -0.07), ncol=3); ax.grid(axis="x", color="#e0e0e0"); ax.set_axisbelow(True)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
fig.tight_layout(); fig.savefig("examples/ex_hbars.png"); plt.close(fig)

# two monthly series on a date axis
import matplotlib.dates as mdates
mo = np.arange(np.datetime64("2021-01"), np.datetime64("2025-01")).astype("datetime64[D]")
r1 = [2.8 + 0.02 * i + (0.14 * (i - 14) if i > 14 else 0) - (0.004 * (i - 30) ** 2 if i > 30 else 0) for i in range(len(mo))]
r2 = [0.5 + (0.09 * (i - 15) if i > 15 else 0) - (0.002 * (i - 34) ** 2 if i > 34 else 0) for i in range(len(mo))]
r1 = [round(v, 2) for v in r1]; r2 = [round(max(v, 0.5), 2) for v in r2]
fig, ax = plt.subplots(figsize=(8, 4.4), dpi=110)
ax.plot(mo.astype("O"), r1, color="#7048e8", lw=2.2, label="Loan rate")
ax.plot(mo.astype("O"), r2, color="#e8590c", lw=2.2, label="Savings rate")
ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
ax.set_title("Loan and savings rates (%)", loc="left", fontsize=13)
ax.grid(axis="y", color="#e0e0e0"); ax.set_axisbelow(True); ax.legend(frameon=False)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
fig.tight_layout(); fig.savefig("examples/ex_rates.png"); plt.close(fig)
json.dump(json.load(open("examples/truth.json")) + [
    {"file": "ex_pie.png", "family": "donut", "x": src, "series": [{"name": "Share", "y": share}]},
    {"file": "ex_hbars.png", "family": "stacked_hbar", "x": teams, "xkind": "cat", "series": [{"name": k, "y": v} for k, v in parts.items()]},
    {"file": "ex_rates.png", "family": "line", "xkind": "date", "x": [str(d) for d in mo], "series": [{"name": "Loan rate", "y": r1}, {"name": "Savings rate", "y": r2}]}],
    open("examples/truth.json", "w"))
