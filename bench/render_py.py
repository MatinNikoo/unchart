"""Draw a spec with matplotlib or seaborn. Returns the axis limits the renderer actually used."""
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mt
import matplotlib.dates as mdates

PAL = {
    "office2013": ["#4472C4", "#ED7D31", "#A5A5A5", "#FFC000", "#5B9BD5", "#70AD47", "#264478"],
    "office2007": ["#4F81BD", "#C0504D", "#9BBB59", "#8064A2", "#4BACC6", "#F79646", "#2C4D75"],
    "classic": ["#4285F4", "#DB4437", "#F4B400", "#0F9D58", "#AB47BC", "#00ACC1", "#FF7043"],
    "material": ["#4285F4", "#EA4335", "#FBBC04", "#34A853", "#FF6D01", "#46BDC6", "#7BAAF7"],
    "navy": ["#5DADE2", "#F5B041", "#58D68D", "#EC7063", "#AF7AC5", "#F4D03F"],
    "white": ["#0B5394", "#E69138", "#6AA84F", "#CC0000", "#674EA7", "#45818E"],
    "gray": ["#1F77B4", "#D62728", "#2CA02C", "#9467BD", "#FF7F0E", "#17BECF"],
    "office2019": ["#5B9BD5", "#ED7D31", "#A5A5A5", "#FFC000", "#4472C4", "#70AD47", "#255E91"],
    "retro": ["#E76F51", "#2A9D8F", "#E9C46A", "#264653", "#F4A261", "#8AB17D"],
    "charcoal": ["#7FDBFF", "#FF851B", "#2ECC40", "#FF4136", "#B10DC9", "#FFDC00"],
    "owid": ["#6D3E91", "#C05917", "#58AC8C", "#286BBB", "#883039", "#BC8E5A", "#00295B", "#C15065", "#18470F", "#9A5129", "#E56E5A", "#A2559C"],
}


def fmt_func(fmt):
    if fmt == "thousands": return mt.FuncFormatter(lambda v, p: f"{v:,.0f}")
    if fmt == "currency": return mt.FuncFormatter(lambda v, p: ("-" if v < 0 else "") + f"${abs(v):,.0f}")
    if fmt == "pct": return mt.FuncFormatter(lambda v, p: f"{v:.0f}%")
    if fmt == "suffix":
        def f(v, p):
            a = abs(v)
            if a >= 1e6: return f"{v / 1e6:g}M"
            if a >= 1e3: return f"{v / 1e3:g}K"
            return f"{v:g}"
        return mt.FuncFormatter(f)
    return None


def setup(spec):
    """returns (rc dict, style list, palette, extra) for the look"""
    r, look = spec["renderer"], spec["look"]
    rc, styles, pal = {}, ["default"], None
    if r == "matplotlib":
        styles = [look]
    elif r == "seaborn":
        import seaborn as sns
        theme, palname = look.split("/")
        rc = dict(sns.axes_style(theme)); pal = sns.color_palette(palname).as_hex()
        rc.update({"axes.prop_cycle": matplotlib.cycler(color=pal)})
    elif r == "excel_like":
        pal = PAL[look]
        rc = {"font.family": "Carlito", "font.size": 10, "axes.edgecolor": "#BFBFBF", "axes.spines.top": False, "axes.spines.right": False,
              "axes.spines.left": False, "axes.grid": True, "axes.grid.axis": "y", "grid.color": "#D9D9D9" if look == "office2013" else "#868686",
              "xtick.color": "#595959", "ytick.color": "#595959", "ytick.major.size": 0, "axes.titlesize": 14, "axes.titlecolor": "#595959",
              "legend.frameon": False, "axes.prop_cycle": matplotlib.cycler(color=pal)}
    elif r == "sheets_like":
        pal = PAL[look]
        rc = {"font.family": "Liberation Sans", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
              "axes.edgecolor": "#333333", "axes.grid": True, "axes.grid.axis": "y", "grid.color": "#CCCCCC", "xtick.color": "#444444",
              "ytick.color": "#444444", "ytick.major.size": 0, "xtick.major.size": 0, "axes.titlelocation": "left", "axes.titleweight": "bold",
              "legend.frameon": False, "axes.prop_cycle": matplotlib.cycler(color=pal)}
    elif r == "slide":
        pal = PAL[look]
        bg = {"navy": "#1B2A41", "white": "#FFFFFF", "gray": "#EEEEEE", "charcoal": "#2B2B2B"}[look]
        fg = "#FFFFFF" if look in ("navy", "charcoal") else "#222222"
        rc = {"font.family": "Inter", "font.size": 16, "figure.facecolor": bg, "axes.facecolor": bg, "axes.edgecolor": fg,
              "axes.labelcolor": fg, "xtick.color": fg, "ytick.color": fg, "text.color": fg, "axes.spines.top": False,
              "axes.spines.right": False, "axes.titlesize": 22, "axes.titleweight": "bold", "lines.linewidth": 3.5,
              "grid.color": {"navy": "#3A4A61", "charcoal": "#444444"}.get(look, "#CCCCCC"), "legend.frameon": False, "axes.prop_cycle": matplotlib.cycler(color=pal),
              "savefig.facecolor": bg}
    elif r == "owid_like":
        # the look of Our World in Data line charts: no box, light dashed gridlines, labels at the line ends
        pal = PAL["owid"]
        rc = {"font.family": "Inter", "font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "axes.spines.left": False,
              "axes.edgecolor": "#999999", "axes.grid": True, "axes.grid.axis": "y", "grid.color": "#DDDDDD", "grid.linestyle": "--",
              "xtick.color": "#666666", "ytick.color": "#666666", "ytick.major.size": 0, "axes.titlelocation": "left", "axes.titlesize": 15,
              "legend.frameon": False, "axes.prop_cycle": matplotlib.cycler(color=pal), "lines.linewidth": 1.5}
    if spec.get("palette"): pal = spec["palette"]
    return rc, styles, pal


def to_dates(xs):
    return np.array([np.datetime64(x) for x in xs]).astype("datetime64[D]").astype("O")


def render(spec, path, rng, hook=None):
    rc, styles, pal = setup(spec)
    fam = spec["family"]
    w, h = spec["w"], spec["h"]
    if spec["renderer"] == "slide": w, h = 1100, 620
    dpi = int(rng.choice([80, 100, 120]))
    info = {"dpi": dpi}
    rc = dict(rc, **{"axes.formatter.useoffset": False, "axes.formatter.limits": (-7, 9)})
    with plt.style.context(styles), matplotlib.rc_context(rc):
        fig, ax = plt.subplots(figsize=(w / 100, h / 100), dpi=dpi)
        cyc = pal or plt.rcParams["axes.prop_cycle"].by_key()["color"]
        S, X = spec["series"], spec.get("x")
        k = len(S)
        col = [cyc[j % len(cyc)] for j in range(max(k, len(X) if fam in ("pie", "donut") else k))]
        vaxis = "x" if fam in ("hbar", "stacked_hbar", "dot_plot") else "y"
        ax2 = None
        if fam in ("bar", "hbar"):
            y = S[0]["y"]; c = col[0]
            if fam == "bar":
                bars = ax.bar(X, y, width=float(rng.choice([.6, .7, .8])), color=c)
            else:
                bars = ax.barh(X[::-1], y[::-1], height=float(rng.choice([.6, .7, .8])), color=c)
            if spec["value_labels"]:
                f0 = fmt_func(spec["fmt"])
                ax.bar_label(bars, labels=[f0(v, 0) if f0 else f"{v:g}" for v in (y if fam == "bar" else y[::-1])], padding=2, fontsize=8)
        elif fam == "grouped_bar":
            n = len(X); bw = 0.8 / k
            for j, s in enumerate(S):
                ax.bar(np.arange(n) - 0.4 + bw * (j + .5), s["y"], width=bw * .95, color=col[j], label=s["name"])
            ax.set_xticks(np.arange(n)); ax.set_xticklabels(X)
        elif fam == "stacked_bar":
            b = np.zeros(len(X))
            for j, s in enumerate(S):
                ax.bar(X, s["y"], bottom=b, width=.65, color=col[j], label=s["name"]); b += np.array(s["y"])
        elif fam == "stacked_hbar":
            b = np.zeros(len(X))
            for j, s in enumerate(S):
                ax.barh(X[::-1], s["y"][::-1], left=b, height=.65, color=col[j], label=s["name"]); b += np.array(s["y"][::-1])
        elif fam in ("line", "step", "area", "stacked_area"):
            xk = spec["xkind"]
            xs = to_dates(X) if xk == "date" else (np.arange(len(X)) if xk == "cat" else np.array(X))
            if fam == "stacked_area":
                ax.stackplot(xs, *[s["y"] for s in S], labels=[s["name"] for s in S], colors=col[:k], alpha=float(rng.choice([1, 1, .85])))
            for j, s in enumerate(S):
                tgt = ax
                if s.get("axis") == "right":
                    ax2 = ax.twinx(); tgt = ax2
                    if rng.random() < 0.5:
                        ax2.tick_params(axis="y", colors=col[j]); ax.tick_params(axis="y", colors=col[0])
                    if spec["grid"]: ax2.grid(False)
                if fam == "line":
                    tgt.plot(xs, s["y"], color=col[j], lw=float(rng.choice([1.5, 2, 2.5])), label=s["name"],
                             ls="--" if spec.get("dash", [False] * k)[j] else "-", marker="o" if spec.get("marker") else None, ms=5)
                elif fam == "step":
                    tgt.step(xs, s["y"], where=spec["where"], color=col[j], lw=2, label=s["name"])
                elif fam == "area":
                    a = float(rng.choice([1.0, 0.35, 0.5]))
                    tgt.fill_between(xs, s["y"], 0 if min(s["y"]) >= 0 else min(s["y"]), color=col[j], alpha=a, lw=0)
                    tgt.plot(xs, s["y"], color=col[j], lw=2, label=s["name"])
            if xk == "cat": ax.set_xticks(xs); ax.set_xticklabels(X)
            if xk == "date":
                f = rng.choice(["%b %Y", "%Y-%m", "%Y", "%b '%y"])
                span = (xs[-1] - xs[0]).days
                if span < 120: f = rng.choice(["%b %d", "%m/%d", "%Y-%m-%d"])
                loc = mdates.AutoDateLocator(maxticks=8)
                ax.xaxis.set_major_locator(loc); ax.xaxis.set_major_formatter(mdates.DateFormatter(str(f)))
                if span >= 120 and f == "%Y" and span < 365 * 3: ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
                fig.autofmt_xdate() if rng.random() < 0.3 else None
            if fam in ("area", "stacked_area") and min(min(s["y"]) for s in S) >= 0: ax.set_ylim(bottom=0)
        elif fam == "scatter":
            shapes = ["o", "s", "^", "D", "v", "P"]
            for j, s in enumerate(S):
                m = shapes[j % len(shapes)] if spec.get("marker_shapes") else "o"
                ax.scatter(s["x"], s["y"], color=col[j], s=float(rng.choice([16, 28, 40])), marker=m, label=s["name"],
                           alpha=float(rng.choice([1, 1, .8])))
        elif fam in ("pie", "donut"):
            v = S[0]["y"]
            kw = {"startangle": float(rng.choice([0, 90, 140])), "counterclock": bool(rng.random() < 0.6), "colors": col[:len(v)]}
            if fam == "donut": kw["wedgeprops"] = {"width": float(rng.choice([.35, .45, .5])), "edgecolor": "white" if rng.random() < .5 else None}
            elif rng.random() < 0.4: kw["wedgeprops"] = {"edgecolor": "white", "linewidth": 1.5}
            if spec["legend"] == "labels": kw["labels"] = X
            if spec["value_labels"]: kw["autopct"] = "%1.1f%%"; kw["pctdistance"] = 0.78 if fam == "donut" else 0.65
            ax.pie(v, **kw)
            if spec["legend"] == "legend": ax.legend(X, loc="center left", bbox_to_anchor=(1, .5), frameon=False)
            ax.set_aspect("equal")
            info["start"], info["ccw"] = kw["startangle"], kw["counterclock"]
        elif fam == "histogram":
            e = np.array(X); c = S[0]["y"]
            ax.bar(e[:-1], c, width=np.diff(e), align="edge", color=col[0],
                   edgecolor=("white" if rng.random() < .6 else "#333333") if spec.get("edgecolor") else None, lw=1 if spec.get("edgecolor") else 0)
        elif fam == "bar_line":
            n = len(X)
            ax.bar(np.arange(n), S[0]["y"], width=.6, color=col[0], label=S[0]["name"])
            tgt = ax
            if spec["dual"]:
                ax2 = ax.twinx(); tgt = ax2
                if spec["grid"]: ax2.grid(False)
            tgt.plot(np.arange(n), S[1]["y"], color=col[1], lw=2.5, marker="o", label=S[1]["name"])
            ax.set_xticks(np.arange(n)); ax.set_xticklabels(X)
        elif fam == "stacked100":
            b = np.zeros(len(X))
            for j, s in enumerate(S):
                ax.bar(X, s["y"], bottom=b, width=.65, color=col[j], label=s["name"]); b += np.array(s["y"])
            ax.set_ylim(0, 100)
        elif fam == "lollipop":
            n = len(X); c = col[0]
            ax.vlines(np.arange(n), 0, S[0]["y"], color=c, lw=float(rng.choice([1.5, 2, 3])))
            ax.plot(np.arange(n), S[0]["y"], "o", color=c, ms=float(rng.choice([7, 9, 11])))
            ax.set_xticks(np.arange(n)); ax.set_xticklabels(X)
            if min(S[0]["y"]) < 0: ax.axhline(0, color="#888888", lw=1)
        elif fam == "dot_plot":
            n = len(X); pos = np.arange(n)[::-1]
            ax.hlines(pos, 0, max(max(s["y"]) for s in S) * 1.05, color="#DDDDDD", lw=1, zorder=0)
            for j, s in enumerate(S):
                ax.plot(s["y"], pos, "o", color=col[j], ms=float(rng.choice([7, 9])), label=s["name"])
            ax.set_yticks(pos); ax.set_yticklabels(X); ax.set_xlim(left=0)
        elif fam == "slope":
            for j, s in enumerate(S):
                ax.plot([0, 1], s["y"], color=col[j], lw=2, marker="o", ms=6, label=s["name"])
            ax.set_xticks([0, 1]); ax.set_xticklabels(X); ax.set_xlim(-0.25, 1.25)
        elif fam == "waterfall":
            d = np.array(S[0]["y"]); tot = np.cumsum(d); start = tot - d
            up, down = ("#2CA02C", "#D62728") if spec["renderer"] != "excel_like" else (cyc[0], cyc[1 % len(cyc)])
            ax.bar(np.arange(len(X)), d, bottom=start, width=.6, color=[up if v >= 0 else down for v in d])
            ax.set_xticks(np.arange(len(X))); ax.set_xticklabels(X)
        elif fam == "bubble":
            for j, s in enumerate(S):
                ax.scatter(s["x"], s["y"], s=np.array(s["size"]) * float(rng.choice([4, 7, 10])), color=col[j], alpha=float(rng.choice([.6, .75, 1])),
                           edgecolors="white" if rng.random() < .5 else "none", label=s["name"])
        elif fam == "errorbar":
            n = len(X)
            ax.bar(np.arange(n), S[0]["y"], yerr=S[0]["err"], width=float(rng.choice([.5, .6, .7])), color=col[0], capsize=float(rng.choice([0, 3, 5])),
                   ecolor="#333333" if rng.random() < .7 else cyc[1 % len(cyc)])
            ax.set_xticks(np.arange(n)); ax.set_xticklabels(X)
        elif fam == "dual_axis":
            xs = np.array(X)
            ax.plot(xs, S[0]["y"], color=col[0], lw=2, label=S[0]["name"])
            ax2 = ax.twinx(); ax2.plot(xs, S[1]["y"], color=col[1], lw=2, label=S[1]["name"])
            if rng.random() < 0.6: ax2.tick_params(axis="y", colors=col[1]); ax.tick_params(axis="y", colors=col[0])
            ax2.grid(False)
        f = fmt_func(spec["fmt"])
        if fam not in ("pie", "donut"):
            if spec["ylog"]: ax.set_yscale("log")
            if f: (ax.xaxis if vaxis == "x" else ax.yaxis).set_major_formatter(f)
            if fam == "scatter" and spec.get("xfmt") == "thousands": ax.xaxis.set_major_formatter(fmt_func("thousands"))
            if not spec["grid"]: ax.grid(False)
            if spec["yrev"]: ax.invert_yaxis()
            if spec.get("noticks"):
                (ax.xaxis if vaxis == "x" else ax.yaxis).set_major_formatter(mt.NullFormatter())
                if ax2: ax2.yaxis.set_major_formatter(mt.NullFormatter())
            if len(X or []) > 8 and spec["xkind"] == "cat" and fam not in ("hbar", "stacked_hbar") and rng.random() < 0.5:
                plt.setp(ax.get_xticklabels(), rotation=45, ha="right")
            if spec.get("end_labels"):
                # a label in the series color at the end of each line, instead of a legend
                xs0 = to_dates(X) if spec["xkind"] == "date" else (np.arange(len(X)) if spec["xkind"] == "cat" else np.array(X))
                for j, s in enumerate(S):
                    ax.annotate(s["name"], xy=(xs0[-1], s["y"][-1]), xytext=(4, 0), textcoords="offset points", color=col[j], va="center", fontsize=9, annotation_clip=False)
            elif spec.get("legend") == "none": pass
            elif (k > 1 or fam in ("bar_line", "dual_axis")) and fam not in ("histogram", "waterfall"):
                if ax2:
                    h1, l1 = ax.get_legend_handles_labels(); h2, l2 = ax2.get_legend_handles_labels(); ax.legend(h1 + h2, l1 + l2, loc="upper left")
                else:
                    ax.legend(loc=str(rng.choice(["best", "upper left", "upper right", "lower right"])) if rng.random() < .75 else "upper left",
                              **({"bbox_to_anchor": (1.01, 1)} if rng.random() < 0.25 else {}))
            if spec["annotate"] and fam == "line":
                s0 = spec["series"][0]; i = int(np.argmax(s0["y"]))
                xs0 = to_dates(X) if spec["xkind"] == "date" else (np.arange(len(X)) if spec["xkind"] == "cat" else np.array(X))
                ax.annotate("Peak", xy=(xs0[i], s0["y"][i]), xytext=(15, -30), textcoords="offset points", arrowprops={"arrowstyle": "->"})
        if spec["title"]: ax.set_title(spec["title"])
        fig.tight_layout()
        fig.canvas.draw()
        if fam not in ("pie", "donut"):
            lim = ax.get_xlim() if vaxis == "x" else ax.get_ylim()
            info["vlim"] = [float(min(lim)), float(max(lim))]
            if fam == "scatter": info["xlim"] = [float(min(ax.get_xlim())), float(max(ax.get_xlim()))]
            if ax2 is not None: info["vlim_right"] = sorted(float(v) for v in ax2.get_ylim())
        if hook: hook(fig, ax, ax2, col[:k] if fam not in ("pie", "donut") else col)
        fig.savefig(path, facecolor=fig.get_facecolor())
        plt.close(fig)
    return info
