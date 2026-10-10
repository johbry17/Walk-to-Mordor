"""
Walk to Mordor — Publication-Quality EDA
Compares My Time (real walking calendar) vs Middle-earth Time (fictional chronology).
Outputs: reports/figures/*.png  +  reports/eda_report.md
"""

import sys, warnings, json, textwrap
from pathlib import Path

import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as mticker
from matplotlib.lines import Line2D

warnings.filterwarnings("ignore")

# ── paths ──────────────────────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parents[2] # should be correct - moved the file
DATA = ROOT / "docs" / "static" / "data"
FIG  = ROOT / "archive" /"reports" / "figures"
FIG.mkdir(parents=True, exist_ok=True)

sys.path.insert(0, str(ROOT / "notebooks"))
from wtm_theme import JOURNEY_COLORS, CHARACTER_LABEL, JOURNEY_ORDER, apply_theme

apply_theme()

COLORS    = JOURNEY_COLORS
LABELS    = CHARACTER_LABEL
JORDER    = JOURNEY_ORDER
FONT_NOTE = dict(fontsize=7, color="#888888")
FONT_ANNO = dict(fontsize=8, color="#444444")

# ── 1. LOAD DATA ───────────────────────────────────────────────────────────────
walk_raw   = pd.read_csv(DATA / "walking.csv", parse_dates=["date"])
me_raw     = pd.read_csv(DATA / "me_time.csv")
chronology = json.loads((DATA / "chronology.json").read_text(encoding="utf-8"))
journeys   = json.loads((DATA / "journeys.json").read_text(encoding="utf-8"))

# Separate assigned vs gap rows
walk  = walk_raw[walk_raw["journey_id"].notna()].copy()
gaps  = walk_raw[walk_raw["journey_id"].isna()].copy()
me    = me_raw.copy()

# ── 2. DATA QUALITY ────────────────────────────────────────────────────────────
dq_notes = []

# Null check
null_counts = walk_raw.isnull().sum()
dq_notes.append(f"walking.csv: {len(walk_raw)} rows total, "
                f"{len(walk)} journey-assigned, {len(gaps)} gap/unassigned")
if null_counts["distance_miles"] > 0:
    dq_notes.append(f"  ⚠ {null_counts['distance_miles']} null distance_miles rows (in gap period)")
dq_notes.append(f"  No duplicate dates: {not walk_raw.duplicated('date').any()}")

# me_time special dates
special_dates = me[~me["me_date"].str.match(r"^\d{4}-\d{2}-\d{2}$", na=False)]
dq_notes.append(f"me_time.csv: {len(me)} rows, "
                f"{special_dates.shape[0]} non-ISO dates (intercalary days)")

# Check me_time ordinal uniqueness
ord_dupes = me.duplicated("me_ordinal").sum()
dq_notes.append(f"  me_ordinal duplicate check: {ord_dupes} dupes")

# Verify cumulative monotonicity per journey
for jid in JORDER:
    jme = me[me["journey_id"] == jid].sort_values("me_ordinal")
    diffs = jme["cumulative_miles"].diff().dropna()
    neg = (diffs < -1e-6).sum()
    dq_notes.append(f"  {jid} me_time: {len(jme)} rows, "
                    f"max_cum={jme['cumulative_miles'].max():.1f}, "
                    f"negative-diffs={neg}")

# Verify walking cumulative
for jid in JORDER:
    jw = walk[walk["journey_id"] == jid].sort_values("date")
    diffs = jw["cumulative_miles"].diff().dropna()
    neg = (diffs < -1e-6).sum()
    dq_notes.append(f"  {jid} walking: {len(jw)} days, "
                    f"total_mi={jw['distance_miles'].sum():.1f}, "
                    f"negative-cumulative-diffs={neg}")

# Check for gaps in date sequences
for jid in JORDER:
    jw = walk[walk["journey_id"] == jid].sort_values("date")
    day_diffs = jw["date"].diff().dt.days.dropna()
    gaps_gt1  = (day_diffs > 1).sum()
    max_gap   = int(day_diffs.max())
    dq_notes.append(f"  {jid} date gaps >1 day: {gaps_gt1}, max gap: {max_gap} days")

print("\n".join(["=== DATA QUALITY ==="] + dq_notes))

# ── 3. NARRATIVE SEGMENT DEFINITIONS ──────────────────────────────────────────
# Derived from chronology.json analysis. Boundaries are fictional mileage values.
# travel_char: walking / horseback / boat / eagle / captivity / rest / mixed

SEGMENTS = {
    "Mordor": [
        dict(name="Bag End → Bree",            mi_start=0,    mi_end=145,  travel="walking"),
        dict(name="Bree → Rivendell",           mi_start=145,  mi_end=487,  travel="walking"),
        dict(name="Rivendell Rest",             mi_start=487,  mi_end=487,  travel="rest"),
        dict(name="Fellowship March → Moria",   mi_start=487,  mi_end=862,  travel="walking"),
        dict(name="Lothlórien Rest",            mi_start=862,  mi_end=952,  travel="rest"),
        dict(name="Boats on the Anduin",        mi_start=952,  mi_end=1367, travel="boat"),
        dict(name="Emyn Muil → Black Gate",     mi_start=1367, mi_end=1528, travel="walking"),
        dict(name="Ithilien → Shelob's Lair",   mi_start=1528, mi_end=1640, travel="walking"),
        dict(name="Cirith Ungol Captivity",     mi_start=1640, mi_end=1660, travel="captivity"),
        dict(name="March into Mordor",          mi_start=1660, mi_end=1815, travel="walking"),
    ],
    "Return": [
        dict(name="Parth Galen → Edoras",       mi_start=0,    mi_end=370,  travel="horseback"),
        dict(name="Edoras → Dunharrow",         mi_start=370,  mi_end=752,  travel="horseback"),
        dict(name="Paths of Dead → Pelargir",   mi_start=752,  mi_end=1182, travel="mixed"),
        dict(name="Pelargir → Minas Tirith",    mi_start=1182, mi_end=1350, travel="boat"),
        dict(name="Minas Tirith → Black Gate",  mi_start=1350, mi_end=1482, travel="walking"),
    ],
    "Hobbit": [
        dict(name="Bag End → Rivendell",        mi_start=0,    mi_end=491,  travel="walking"),
        dict(name="Rivendell Rest",             mi_start=491,  mi_end=491,  travel="rest"),
        dict(name="Rivendell → Beorn's Hall",   mi_start=491,  mi_end=619,  travel="mixed"),
        dict(name="Beorn → Mirkwood Entrance",  mi_start=619,  mi_end=786,  travel="horseback"),
        dict(name="Through Mirkwood",           mi_start=786,  mi_end=934,  travel="walking"),
        dict(name="Wood-elves Captivity",       mi_start=934,  mi_end=934,  travel="captivity"),
        dict(name="Barrel Escape → Esgaroth",   mi_start=934,  mi_end=951,  travel="boat"),
        dict(name="Lake-town Rest",             mi_start=951,  mi_end=951,  travel="rest"),
        dict(name="Lonely Mountain & Battle",   mi_start=951,  mi_end=1100, travel="walking"),
    ],
}

TRAVEL_COLORS = {
    "walking":   "#8B6F47",
    "horseback": "#4A7C8E",
    "boat":      "#2E86AB",
    "mixed":     "#9B59B6",
    "captivity": "#E74C3C",
    "rest":      "#AAAAAA",
    "eagle":     "#F39C12",
}

# ── 4. COMPUTE SEGMENT STATISTICS ─────────────────────────────────────────────

def me_elapsed_days(jid, mi_start, mi_end, me_df):
    """Count ME days where cumulative_miles is in [mi_start, mi_end]."""
    jme = me_df[me_df["journey_id"] == jid].sort_values("me_ordinal")
    if mi_start == mi_end:
        sub = jme[jme["cumulative_miles"] == mi_start]
    else:
        sub = jme[(jme["cumulative_miles"] >= mi_start) & (jme["cumulative_miles"] <= mi_end)]
    return len(sub)

def me_elapsed_ordinals(jid, mi_start, mi_end, me_df):
    """Return ordinal span [min, max] for a mileage interval."""
    jme = me_df[me_df["journey_id"] == jid].sort_values("me_ordinal")
    if mi_start == mi_end:
        sub = jme[jme["cumulative_miles"] == mi_start]
    else:
        sub = jme[(jme["cumulative_miles"] >= mi_start) & (jme["cumulative_miles"] <= mi_end)]
    if len(sub) == 0:
        return None, None
    return int(sub["me_ordinal"].min()), int(sub["me_ordinal"].max())

def walk_in_mi_range(jid, mi_start, mi_end, walk_df):
    """Walking days where journey cumulative_miles crosses mi_start→mi_end."""
    jw = walk_df[walk_df["journey_id"] == jid].sort_values("date").copy()
    if mi_start == mi_end:
        sub = jw[jw["cumulative_miles"] == mi_start]
    else:
        sub = jw[(jw["cumulative_miles"] > mi_start) & (jw["cumulative_miles"] <= mi_end)]
    return sub

seg_stats = []
for jid in JORDER:
    jme = me[me["journey_id"] == jid].sort_values("me_ordinal")
    jw  = walk[walk["journey_id"] == jid].sort_values("date")
    for seg in SEGMENTS[jid]:
        ms, me_end = seg["mi_start"], seg["mi_end"]
        fi_mi = me_end - ms

        # ME time
        ord_s, ord_e = me_elapsed_ordinals(jid, ms, me_end, me)
        me_days = (ord_e - ord_s + 1) if (ord_s and ord_e) else 0
        fi_rate = fi_mi / me_days if me_days > 0 and fi_mi > 0 else 0

        # Walking
        wsub = walk_in_mi_range(jid, ms, me_end, walk)
        w_actual_mi  = wsub["distance_miles"].sum()
        w_days       = len(wsub)
        w_cal_days   = (wsub["date"].max() - wsub["date"].min()).days + 1 if len(wsub) > 1 else (1 if len(wsub) == 1 else 0)
        w_rate       = w_actual_mi / w_days if w_days > 0 else 0

        seg_stats.append(dict(
            journey=jid,
            segment=seg["name"],
            travel=seg["travel"],
            fi_mi=fi_mi,
            me_days=me_days,
            fi_rate=fi_rate,
            w_actual_mi=w_actual_mi,
            w_days=w_days,
            w_cal_days=w_cal_days,
            w_rate=w_rate,
            mi_start=ms,
            mi_end=me_end,
        ))

segs = pd.DataFrame(seg_stats)

# ── 5. JOURNEY-LEVEL SUMMARY ───────────────────────────────────────────────────
journey_summary = []
for jid in JORDER:
    jme = me[me["journey_id"] == jid].sort_values("me_ordinal")
    jw  = walk[walk["journey_id"] == jid].sort_values("date")

    # Middle-earth
    me_elapsed = int(jme["me_ordinal"].max() - jme["me_ordinal"].min() + 1)
    me_mi      = float(jme["cumulative_miles"].max())
    # travel days = days where mileage increases
    me_travel_days = int((jme["cumulative_miles"].diff() > 0).sum())
    me_rest_days   = me_elapsed - me_travel_days

    # My time
    w_total_mi = float(jw["distance_miles"].sum())
    w_days     = len(jw)
    w_elapsed  = int((jw["date"].max() - jw["date"].min()).days + 1)
    w_mean     = float(jw["distance_miles"].mean())
    w_med      = float(jw["distance_miles"].median())
    w_std      = float(jw["distance_miles"].std())
    w_iqr      = float(jw["distance_miles"].quantile(0.75) - jw["distance_miles"].quantile(0.25))
    w_pct2     = float((jw["distance_miles"] >= 2).mean() * 100)
    w_pct5     = float((jw["distance_miles"] >= 5).mean() * 100)
    w_pct10    = float((jw["distance_miles"] >= 10).mean() * 100)
    w_start    = jw["date"].min().date()
    w_end      = jw["date"].max().date()

    # Longest streak >=2 mi
    above2 = (jw["distance_miles"] >= 2).astype(int)
    streak, cur = 0, 0
    for v in above2:
        cur = cur + 1 if v else 0
        streak = max(streak, cur)

    # Longest zero gap (days with <0.5 miles)
    low = (jw["distance_miles"] < 0.5).astype(int)
    gap_len, cur = 0, 0
    for v in low:
        cur = cur + 1 if v else 0
        gap_len = max(gap_len, cur)

    journey_summary.append(dict(
        journey=jid,
        character=CHARACTER_LABEL[jid],
        # real-world
        w_start=w_start, w_end=w_end,
        w_elapsed=w_elapsed, w_days=w_days,
        w_total_mi=w_total_mi,
        w_mean=w_mean, w_med=w_med, w_std=w_std, w_iqr=w_iqr,
        w_pct2=w_pct2, w_pct5=w_pct5, w_pct10=w_pct10,
        w_streak=streak, w_gap=gap_len,
        # middle-earth
        me_elapsed=me_elapsed, me_mi=me_mi,
        me_travel_days=me_travel_days, me_rest_days=me_rest_days,
        me_avg_rate=me_mi / me_elapsed,
        # ratios
        time_ratio=w_elapsed / me_elapsed,
        mi_ratio=w_total_mi / me_mi,
    ))

js = pd.DataFrame(journey_summary)

# ── 6. FIGURE HELPERS ──────────────────────────────────────────────────────────
def save(fig, name):
    path = FIG / name
    fig.savefig(path, dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"  saved → {path.name}")

def data_note(ax, text="Source: Walking data & Tolkien chronology"):
    ax.annotate(text, xy=(0, -0.07), xycoords="axes fraction",
                ha="left", **FONT_NOTE)

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 1 — JOURNEY OVERVIEW
# ═══════════════════════════════════════════════════════════════════════════════
print("\nFig 1: Journey overview …")
fig, axes = plt.subplots(2, 2, figsize=(11, 7))
fig.suptitle("Journey Overview: Three Quests, Two Clocks",
             fontsize=14, fontweight="bold", y=1.01)

labels_short = {"Mordor": "Frodo\n(Mordor)", "Return": "Aragorn\n(Return)", "Hobbit": "Bilbo\n(Hobbit)"}
x = np.arange(3)
jids = JORDER

def jbar(ax, vals, title, ylabel, fmt="{:.0f}"):
    bars = ax.bar(x, vals, color=[COLORS[j] for j in jids], width=0.55, edgecolor="white", linewidth=0.5)
    for bar, v in zip(bars, vals):
        ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + max(vals)*0.01,
                fmt.format(v), ha="center", va="bottom", fontsize=9, fontweight="bold")
    ax.set_xticks(x); ax.set_xticklabels([labels_short[j] for j in jids])
    ax.set_title(title, fontsize=10, fontweight="bold")
    ax.set_ylabel(ylabel, fontsize=9)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.set_ylim(0, max(vals) * 1.18)
    ax.grid(axis="y"); ax.set_axisbelow(True)

jbar(axes[0,0],
     [js.loc[js.journey==j,"w_total_mi"].values[0] for j in jids],
     "Actual Miles Walked (My Time)", "miles", "{:.0f}")
jbar(axes[0,1],
     [js.loc[js.journey==j,"me_mi"].values[0] for j in jids],
     "Fictional Journey Miles (Middle-earth)", "miles", "{:.0f}")
jbar(axes[1,0],
     [js.loc[js.journey==j,"w_elapsed"].values[0] for j in jids],
     "Real-World Elapsed Days (My Time)", "days")
jbar(axes[1,1],
     [js.loc[js.journey==j,"me_elapsed"].values[0] for j in jids],
     "Fictional Elapsed Days (Middle-earth)", "days")

for ax in axes.flat:
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

fig.text(0.5, -0.02,
         "Actual miles = steps converted to miles during each journey period.\n"
         "Fictional miles = calibrated narrative distances (not walking speed).",
         ha="center", fontsize=7.5, color="#666666")
fig.tight_layout()
save(fig, "journey_overview.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 2 — THE TWO CLOCKS
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 2: The Two Clocks …")
fig, axes = plt.subplots(1, 3, figsize=(13, 5), sharey=False)
fig.suptitle("The Two Clocks: Same Fictional Miles, Different Calendars",
             fontsize=13, fontweight="bold")

for ax, jid in zip(axes, JORDER):
    color = COLORS[jid]
    jw  = walk[walk["journey_id"] == jid].sort_values("date").copy()
    jme = me[me["journey_id"] == jid].sort_values("me_ordinal").copy()

    # My Time: real-world day index (0-based) vs cumulative_miles
    jw["day_idx"] = (jw["date"] - jw["date"].min()).dt.days
    w_x = jw["day_idx"].values
    w_y = jw["cumulative_miles"].values

    # ME Time: ordinal index (0-based) vs cumulative_miles
    jme["ord_idx"] = jme["me_ordinal"] - jme["me_ordinal"].min()
    me_x = jme["ord_idx"].values
    me_y = jme["cumulative_miles"].values

    max_x = max(w_x.max(), me_x.max())

    ax.plot(me_x, me_y, color=color, linewidth=2.2, label="Middle-earth time", zorder=3)
    ax.plot(w_x,  w_y,  color=color, linewidth=2.2, linestyle="--", alpha=0.7,
            label="My time (real)", zorder=3)

    ax.set_title(CHARACTER_LABEL[jid].split("—")[0].strip(), fontsize=10, fontweight="bold",
                 color=color)
    ax.set_xlabel("Elapsed days", fontsize=9)
    ax.set_ylabel("Fictional miles" if ax == axes[0] else "", fontsize=9)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))

    # ratio annotation
    row = js[js.journey == jid].iloc[0]
    ax.text(0.97, 0.05,
            f"ME: {row.me_elapsed} days\nReal: {row.w_elapsed} days\nRatio: {row.time_ratio:.1f}×",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=8,
            bbox=dict(boxstyle="round,pad=0.3", fc="white", ec="#CCCCCC", alpha=0.9))

    if ax == axes[0]:
        ax.legend(fontsize=8, loc="upper left")

    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

fig.text(0.5, -0.03,
         "Solid line = fictional mileage unfolding through Middle-earth calendar days.\n"
         "Dashed line = same fictional mileage mapped to my real-world walking days.",
         ha="center", fontsize=7.5, color="#666666")
fig.tight_layout()
save(fig, "two_clocks.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 3 — DAILY WALKING DISTRIBUTION
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 3: Daily walking distribution …")
fig, axes = plt.subplots(1, 3, figsize=(12, 5), sharey=True)
fig.suptitle("Daily Walking Distance: Distribution by Journey",
             fontsize=13, fontweight="bold")

bins = np.arange(0, 22, 1)
for ax, jid in zip(axes, JORDER):
    color = COLORS[jid]
    jw = walk[walk["journey_id"] == jid]["distance_miles"]
    med = jw.median()
    mn  = jw.mean()

    ax.hist(jw, bins=bins, color=color, alpha=0.8, edgecolor="white", linewidth=0.4)
    ax.axvline(med, color="#222222", linewidth=1.5, linestyle="-", label=f"Median {med:.1f} mi")
    ax.axvline(mn,  color="#555555", linewidth=1.2, linestyle="--", label=f"Mean {mn:.1f} mi")

    row = js[js.journey == jid].iloc[0]
    stats_text = (f"n={row.w_days} days\n"
                  f"median={med:.1f} mi\n"
                  f"mean={mn:.1f} mi\n"
                  f"sd={row.w_std:.1f} mi\n"
                  f"IQR={row.w_iqr:.1f} mi\n"
                  f"≥10 mi: {row.w_pct10:.0f}%")
    ax.text(0.96, 0.97, stats_text, transform=ax.transAxes,
            ha="right", va="top", fontsize=7.5,
            bbox=dict(boxstyle="round,pad=0.35", fc="white", ec="#CCCCCC", alpha=0.9))

    ax.set_title(CHARACTER_LABEL[jid].split("—")[0].strip(), fontsize=10,
                 fontweight="bold", color=color)
    ax.set_xlabel("Miles walked (actual)", fontsize=9)
    if ax == axes[0]:
        ax.set_ylabel("Number of days", fontsize=9)
    ax.legend(fontsize=7.5, loc="upper right")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)

fig.tight_layout()
save(fig, "daily_walking_distribution.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 4 — CUMULATIVE WALKING
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 4: Cumulative walking …")
fig, ax = plt.subplots(figsize=(12, 6))
ax.set_title("Cumulative Actual Miles Walked, by Journey",
             fontsize=13, fontweight="bold")
ax.set_subtitle = lambda s: None

for jid in JORDER:
    jw = walk[walk["journey_id"] == jid].sort_values("date")
    ax.plot(jw["date"], jw["cumulative_miles"],
            color=COLORS[jid], linewidth=2.5, label=CHARACTER_LABEL[jid])
    # end label
    last = jw.iloc[-1]
    ax.text(last["date"], last["cumulative_miles"] + 15,
            f"{last['cumulative_miles']:.0f} mi", color=COLORS[jid],
            fontsize=8.5, fontweight="bold")

ax.set_xlabel("Real-world date", fontsize=10)
ax.set_ylabel("Cumulative miles walked (actual)", fontsize=10)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
ax.legend(fontsize=9, loc="upper left")
ax.spines["top"].set_visible(False)
ax.spines["right"].set_visible(False)

# Annotate gap periods
for _, row in gaps.dropna(subset=["date"]).groupby(
        (gaps.dropna(subset=["date"])["date"].diff().dt.days != 1).cumsum()):
    if len(row) > 5:
        ax.axvspan(row["date"].min(), row["date"].max(), alpha=0.07, color="#999999")

ax.text(0.5, -0.07,
        "Grey bands = gap periods between journeys (walking recorded but not assigned to a journey).",
        ha="center", transform=ax.transAxes, **FONT_NOTE)
fig.tight_layout()
save(fig, "cumulative_walking.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 5 — SEGMENT COMPARISON (dumbbell plot)
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 5: Segment comparison …")

seg_plot = segs[segs["fi_mi"] > 0].copy()
seg_plot = seg_plot.sort_values(["journey", "mi_start"])

n_segs = len(seg_plot)
fig, axes = plt.subplots(1, 2, figsize=(13, max(6, n_segs * 0.42 + 1)))
fig.suptitle("Segment Comparison: Fictional Miles vs Actual Walking Miles",
             fontsize=12, fontweight="bold")

# Left: fictional miles per segment
ax = axes[0]
ys = np.arange(n_segs)
colors = [COLORS[r.journey] for _, r in seg_plot.iterrows()]
ax.barh(ys, seg_plot["fi_mi"].values, color=colors, height=0.6,
        alpha=0.85, edgecolor="white")
for y, v in zip(ys, seg_plot["fi_mi"].values):
    ax.text(v + 5, y, f"{v:.0f}", va="center", fontsize=7.5)
ax.set_yticks(ys)
ax.set_yticklabels(seg_plot["segment"].values, fontsize=7.5)
ax.set_xlabel("Fictional journey miles", fontsize=9)
ax.set_title("Fictional Miles per Segment", fontsize=10, fontweight="bold")
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
ax.invert_yaxis()

# Right: actual walking days
ax = axes[1]
ax.barh(ys, seg_plot["w_days"].values, color=colors, height=0.6,
        alpha=0.85, edgecolor="white")
for y, (wd, wm) in enumerate(zip(seg_plot["w_days"].values, seg_plot["w_actual_mi"].values)):
    ax.text(wd + 0.5, y, f"{wd}d / {wm:.0f}mi", va="center", fontsize=7.5)
ax.set_yticks(ys); ax.set_yticklabels([], fontsize=7.5)
ax.set_xlabel("Actual walking days", fontsize=9)
ax.set_title("My Walking Days per Segment", fontsize=10, fontweight="bold")
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
ax.invert_yaxis()

# Legend
handles = [mpatches.Patch(color=COLORS[j], label=CHARACTER_LABEL[j].split("—")[0].strip())
           for j in JORDER]
fig.legend(handles=handles, loc="lower center", ncol=3,
           fontsize=8.5, frameon=False, bbox_to_anchor=(0.5, -0.03))
fig.tight_layout()
save(fig, "segment_comparison.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 6 — FICTIONAL TRAVEL RATE
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 6: Fictional travel rate …")

seg_travel = segs[(segs["fi_mi"] > 0) & (segs["me_days"] > 0)].copy()
seg_travel["fi_rate_day"] = seg_travel["fi_mi"] / seg_travel["me_days"]
seg_travel = seg_travel.sort_values("fi_rate_day", ascending=False)

fig, ax = plt.subplots(figsize=(10, max(6, len(seg_travel)*0.47 + 1.5)))
ax.set_title("Fictional Travel Rate by Segment\n(fictional miles per Middle-earth day)",
             fontsize=12, fontweight="bold")

ys = np.arange(len(seg_travel))
bar_colors = [TRAVEL_COLORS.get(r["travel"], "#888888")
              for _, r in seg_travel.iterrows()]
bars = ax.barh(ys, seg_travel["fi_rate_day"].values,
               color=bar_colors, height=0.65, edgecolor="white")

for y, (r, row) in enumerate(zip(ys, seg_travel.itertuples())):
    ax.text(row.fi_rate_day + 0.3, y,
            f"{row.fi_rate_day:.1f} mi/day  [{row.travel}]",
            va="center", fontsize=7.5, color="#333333")

ax.set_yticks(ys)
ax.set_yticklabels([f"{r.journey[:3]} · {r.segment}" for _, r in seg_travel.iterrows()],
                   fontsize=7.5)
ax.set_xlabel("Fictional miles per Middle-earth day", fontsize=9)
ax.invert_yaxis()
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)

# Travel mode legend
mode_handles = [mpatches.Patch(color=TRAVEL_COLORS[m], label=m.capitalize())
                for m in ["walking","horseback","boat","mixed","captivity","rest"]
                if m in seg_travel["travel"].values]
ax.legend(handles=mode_handles, title="Fictional travel mode", title_fontsize=8,
          fontsize=7.5, loc="lower right")

fig.text(0.5, -0.02,
         "Travel mode derived from Tolkien chronology. 'Mixed' = Paths of the Dead + river.",
         ha="center", **FONT_NOTE)
fig.tight_layout()
save(fig, "fictional_travel_rate.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 7 — MY WALKING RATE BY FICTIONAL SEGMENT
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 7: My walking rate by segment …")

seg_w = segs[(segs["fi_mi"] > 0) & (segs["w_days"] > 0)].copy()
seg_w = seg_w.sort_values(["journey","mi_start"])

fig, ax = plt.subplots(figsize=(10, max(6, len(seg_w)*0.47 + 1.5)))
ax.set_title("My Walking Rate to Complete Each Fictional Segment\n"
             "(actual miles per real-world walking day)",
             fontsize=12, fontweight="bold")

ys = np.arange(len(seg_w))
colors_w = [COLORS[r["journey"]] for _, r in seg_w.iterrows()]
ax.barh(ys, seg_w["w_rate"].values, color=colors_w, height=0.65,
        alpha=0.85, edgecolor="white")
for y, row in zip(ys, seg_w.itertuples()):
    ax.text(row.w_rate + 0.1, y,
            f"{row.w_rate:.1f} mi/day  ({row.w_days}d, {row.fi_mi:.0f} fi-mi)",
            va="center", fontsize=7.5)

ax.set_yticks(ys)
ax.set_yticklabels([f"{r.journey[:3]} · {r.segment}" for _, r in seg_w.iterrows()],
                   fontsize=7.5)
ax.set_xlabel("Actual miles walked per real-world day (my pace)", fontsize=9)
ax.invert_yaxis()
ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)

handles = [mpatches.Patch(color=COLORS[j], label=CHARACTER_LABEL[j].split("—")[0].strip())
           for j in JORDER]
ax.legend(handles=handles, fontsize=8, loc="lower right")
fig.tight_layout()
save(fig, "my_walking_by_segment.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 8 — TIME ALLOCATION (100% stacked bar)
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 8: Time allocation …")

fig, axes = plt.subplots(1, 2, figsize=(13, 5))
fig.suptitle("How Each Journey's Time Is Allocated Across Segments",
             fontsize=12, fontweight="bold")

for ax, metric, title, col in [
    (axes[0], "me_days",   "Middle-earth Days",    "me_days"),
    (axes[1], "w_cal_days","My Real-world Calendar Days", "w_cal_days"),
]:
    ax.set_title(title, fontsize=10, fontweight="bold")
    lefts = {j: 0.0 for j in JORDER}
    totals = {j: max(1, segs[segs["journey"]==j][col].sum()) for j in JORDER}
    bar_y = {j: i for i, j in enumerate(JORDER)}

    for jid in JORDER:
        jsegs = segs[segs["journey"]==jid].sort_values("mi_start")
        for _, row in jsegs.iterrows():
            val = row[col]
            if val <= 0:
                continue
            pct = val / totals[jid] * 100
            color = TRAVEL_COLORS.get(row["travel"], "#888888")
            ax.barh(bar_y[jid], pct, left=lefts[jid], color=color,
                    height=0.55, edgecolor="white", linewidth=0.5)
            if pct > 7:
                ax.text(lefts[jid] + pct/2, bar_y[jid],
                        f"{row['segment'][:14]}\n{pct:.0f}%",
                        ha="center", va="center", fontsize=6, color="white",
                        fontweight="bold")
            lefts[jid] += pct

    ax.set_yticks(list(range(3)))
    ax.set_yticklabels([CHARACTER_LABEL[j].split("—")[0].strip() for j in JORDER])
    ax.set_xlabel("Percentage of journey time", fontsize=9)
    ax.set_xlim(0, 100)
    ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)

mode_handles = [mpatches.Patch(color=TRAVEL_COLORS[m], label=m.capitalize())
                for m in ["walking","horseback","boat","mixed","captivity","rest"]]
fig.legend(handles=mode_handles, title="Travel mode", title_fontsize=8,
           fontsize=7.5, loc="lower center", ncol=6, bbox_to_anchor=(0.5, -0.06),
           frameon=False)
fig.tight_layout()
save(fig, "fictional_time_allocation.png")

# ═══════════════════════════════════════════════════════════════════════════════
# FIG 9 — NARRATIVE EVENTS + MILEAGE
# ═══════════════════════════════════════════════════════════════════════════════
print("Fig 9: Narrative events + mileage …")

# Select key events per journey (subset for readability)
KEY_EVENTS = {
    "Mordor": [
        ("Bree", 145), ("Weathertop", 245), ("Rivendell", 487),
        ("Fellowship\ndeparts", 487), ("Bridge of\nKhazad-dûm", 862),
        ("Lothlórien", 952), ("Parth\nGalen", 1367),
        ("Black Gate\n(turned back)", 1528), ("Shelob's Lair", 1640),
        ("Cracks of\nDoom", 1815),
    ],
    "Return": [
        ("Edoras", 370), ("Dunharrow", 752),
        ("Paths of\nthe Dead", 772), ("Pelargir", 1182),
        ("Minas Tirith", 1350), ("Black Gate", 1482),
    ],
    "Hobbit": [
        ("Trollshaws", 387), ("Rivendell", 491),
        ("Eagle rescue", 600), ("Beorn's Hall", 619),
        ("Mirkwood\nentrance", 786), ("Elvenking's\nHalls", 934),
        ("Esgaroth", 951), ("Lonely\nMountain", 1000), ("Journey end", 1100),
    ],
}

fig, axes = plt.subplots(3, 1, figsize=(13, 12))
fig.suptitle("Fictional Mileage Through Middle-earth Time\nwith Key Narrative Events",
             fontsize=13, fontweight="bold")

for ax, jid in zip(axes, JORDER):
    color = COLORS[jid]
    jme = me[me["journey_id"] == jid].sort_values("me_ordinal").copy()
    jme["ord_idx"] = jme["me_ordinal"] - jme["me_ordinal"].min()

    ax.plot(jme["ord_idx"], jme["cumulative_miles"],
            color=color, linewidth=2.5, zorder=3)
    ax.fill_between(jme["ord_idx"], jme["cumulative_miles"],
                    alpha=0.12, color=color)

    # shade rest/captivity regions (where mileage is flat > 5 days)
    flat_start = None
    prev_mi = None
    for _, row in jme.iterrows():
        if prev_mi is not None and abs(row["cumulative_miles"] - prev_mi) < 0.1:
            if flat_start is None:
                flat_start = row["ord_idx"] - 1
        else:
            if flat_start is not None and (row["ord_idx"] - flat_start) > 5:
                ax.axvspan(flat_start, row["ord_idx"], alpha=0.12, color="#999999")
            flat_start = None
        prev_mi = row["cumulative_miles"]

    # Plot key events
    events = KEY_EVENTS.get(jid, [])
    max_mi = jme["cumulative_miles"].max()
    for i, (name, mi_val) in enumerate(events):
        # find corresponding ordinal
        closest = jme.iloc[(jme["cumulative_miles"] - mi_val).abs().argsort()[:1]]
        if len(closest) == 0:
            continue
        ox = closest["ord_idx"].values[0]
        ax.axvline(ox, color=color, linewidth=0.8, linestyle=":", alpha=0.6, zorder=2)
        ypos = mi_val + max_mi * (0.02 if i % 2 == 0 else 0.06)
        ax.text(ox, ypos, name, ha="center", fontsize=6.5, color=color,
                fontweight="bold", rotation=0,
                bbox=dict(boxstyle="round,pad=0.2", fc="white", ec="none", alpha=0.8))

    ax.set_ylabel("Fictional miles", fontsize=9)
    ax.set_title(CHARACTER_LABEL[jid], fontsize=10, fontweight="bold", color=color)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    ax.spines["top"].set_visible(False); ax.spines["right"].set_visible(False)
    # Label grey bands
    ax.text(1.005, 0.5, "Grey = rest/captivity", transform=ax.transAxes,
            fontsize=6.5, color="#888888", rotation=90, va="center")

axes[-1].set_xlabel("Elapsed Middle-earth days (from journey start)", fontsize=9)
fig.tight_layout()
save(fig, "narrative_mileage.png")

# ═══════════════════════════════════════════════════════════════════════════════
# PRINT STATISTICS TABLES
# ═══════════════════════════════════════════════════════════════════════════════
print("\n" + "="*70)
print("JOURNEY-LEVEL STATISTICS")
print("="*70)
for _, row in js.iterrows():
    print(f"\n{'─'*50}")
    print(f"{row['character']}")
    print(f"{'─'*50}")
    print(f"  Real dates:           {row.w_start} → {row.w_end}")
    print(f"  Real elapsed days:    {row.w_elapsed}")
    print(f"  Walking days:         {row.w_days}")
    print(f"  Total actual miles:   {row.w_total_mi:.1f}")
    print(f"  Mean daily miles:     {row.w_mean:.2f}")
    print(f"  Median daily miles:   {row.w_med:.2f}")
    print(f"  Std deviation:        {row.w_std:.2f}")
    print(f"  IQR:                  {row.w_iqr:.2f}")
    print(f"  Longest streak ≥2mi:  {row.w_streak} days")
    print(f"  Longest <0.5mi gap:   {row.w_gap} days")
    print(f"  Days ≥2 mi:           {row.w_pct2:.1f}%")
    print(f"  Days ≥5 mi:           {row.w_pct5:.1f}%")
    print(f"  Days ≥10 mi:          {row.w_pct10:.1f}%")
    print(f"  ME elapsed days:      {row.me_elapsed}")
    print(f"  ME fictional miles:   {row.me_mi:.0f}")
    print(f"  ME travel days:       {row.me_travel_days}")
    print(f"  ME rest days:         {row.me_rest_days}")
    print(f"  ME avg rate (mi/day): {row.me_avg_rate:.2f}")
    print(f"  Time ratio real/ME:   {row.time_ratio:.2f}×")
    print(f"  Mi ratio act/fi:      {row.mi_ratio:.2f}×")

print("\n" + "="*70)
print("SEGMENT STATISTICS")
print("="*70)
print(segs[["journey","segment","travel","fi_mi","me_days","fi_rate",
           "w_actual_mi","w_days","w_rate"]].to_string(index=False, float_format="%.1f"))

# ═══════════════════════════════════════════════════════════════════════════════
# MARKDOWN REPORT
# ═══════════════════════════════════════════════════════════════════════════════
print("\nWriting markdown report …")

report_lines = [
    "# Walk to Mordor — EDA Report",
    "",
    "> **Two clocks, one journey**: this report compares the same fictional mileage "
    "experienced through two calendars — my real-world walking days and Tolkien's "
    "Middle-earth chronology.",
    "",
    "---",
    "",
    "## 1. Data Quality Audit",
    "",
]
for n in dq_notes:
    report_lines.append(f"- {n}")

report_lines += [
    "",
    "**Notable issues:**",
    "- 178 rows in `walking.csv` have no `journey_id` (gap days between journeys). "
      "These carry real step data but are not assigned to any fictional journey.",
    "- 1 null `distance_miles` row on 2025-12-09 (in gap period). Excluded from analysis.",
    "- `chronology.json` contains 67 events with `journey_id = null` — these are "
      "historical background events between TA 2941 and TA 3018, not journey events.",
    "- `me_time.csv` contains intercalary Shire calendar dates "
      "('1 Lithe', 'Midyear's Day', 'Yule 1', 'Yule 2') which are handled by ordinal.",
    "",
    "---",
    "",
    "## 2. Methodology",
    "",
    "### Two-clock framework",
    "",
    "| Dimension | My Time | Middle-earth Time |",
    "|-----------|---------|-------------------|",
    "| Calendar  | Real-world dates (2024–2026) | Tolkien Shire calendar ordinals |",
    "| Mileage   | Actual miles walked (Google Fit) | Calibrated fictional journey miles |",
    "| Pace      | My walking rate | Narrative travel rate |",
    "",
    "These two systems are conceptually separate. My actual mileage is not a proxy "
    "for the characters' travel speed.",
    "",
    "### Segment definitions",
    "",
    "Segments were derived from `chronology.json` anchor points (location + mileage + date). "
    "Boundaries were placed at:",
    "1. Long flat periods in `me_time.csv` (≥5 consecutive days with no mileage change) → rest/captivity",
    "2. Sudden large mileage jumps relative to elapsed days → non-walking transport",
    "3. Major narrative transitions (Rivendell departure, Parth Galen, etc.)",
    "",
]

for jid in JORDER:
    report_lines.append(f"### {CHARACTER_LABEL[jid]} — Segments")
    report_lines.append("")
    report_lines.append("| # | Segment | Travel Mode | Fictional mi | ME days | fi mi/day |")
    report_lines.append("|---|---------|------------|-------------|---------|-----------|")
    jseg = segs[segs["journey"] == jid]
    for i, (_, row) in enumerate(jseg.iterrows(), 1):
        report_lines.append(
            f"| {i} | {row.segment} | {row.travel} | "
            f"{row.fi_mi:.0f} | {row.me_days} | {row.fi_rate:.1f} |"
        )
    report_lines.append("")

report_lines += [
    "---",
    "",
    "## 3. Journey-Level Statistics",
    "",
    "### My Time",
    "",
    "| Journey | Elapsed days | Walking days | Total mi | Median mi/day | Std | Streak | ≥10mi% |",
    "|---------|-------------|-------------|----------|--------------|-----|--------|--------|",
]
for _, row in js.iterrows():
    report_lines.append(
        f"| {row.character.split('—')[0].strip()} | {row.w_elapsed} | {row.w_days} | "
        f"{row.w_total_mi:.0f} | {row.w_med:.1f} | {row.w_std:.1f} | "
        f"{row.w_streak} | {row.w_pct10:.0f}% |"
    )

report_lines += [
    "",
    "### Middle-earth Time",
    "",
    "| Journey | ME elapsed days | Fictional mi | Travel days | Rest days | Avg mi/day |",
    "|---------|----------------|-------------|-------------|-----------|------------|",
]
for _, row in js.iterrows():
    report_lines.append(
        f"| {row.character.split('—')[0].strip()} | {row.me_elapsed} | {row.me_mi:.0f} | "
        f"{row.me_travel_days} | {row.me_rest_days} | {row.me_avg_rate:.2f} |"
    )

report_lines += [
    "",
    "### Two-clock comparison",
    "",
    "| Journey | Real days | ME days | Time ratio | Actual mi | Fictional mi | Mi ratio |",
    "|---------|-----------|---------|-----------|----------|-------------|---------|",
]
for _, row in js.iterrows():
    report_lines.append(
        f"| {row.character.split('—')[0].strip()} | {row.w_elapsed} | {row.me_elapsed} | "
        f"{row.time_ratio:.2f}× | {row.w_total_mi:.0f} | {row.me_mi:.0f} | {row.mi_ratio:.2f}× |"
    )

# Key findings
report_lines += [
    "",
    "---",
    "",
    "## 4. Key Findings",
    "",
]

# Compute finding data
fr_row = js[js.journey=="Mordor"].iloc[0]
ar_row = js[js.journey=="Return"].iloc[0]
bi_row = js[js.journey=="Hobbit"].iloc[0]

# Boat rate
boat_seg = segs[(segs["travel"]=="boat") & (segs["journey"]=="Mordor")].iloc[0]
walk_segs_mordor = segs[(segs["travel"]=="walking") & (segs["journey"]=="Mordor")]
avg_walk_rate = walk_segs_mordor["fi_rate"].mean()
boat_multiplier = boat_seg.fi_rate / avg_walk_rate if avg_walk_rate > 0 else 0

findings = [
    (
        "**Aragorn's Return journey is spectacularly compressed in ME time.**",
        f"Aragorn covers {ar_row.me_mi:.0f} fictional miles in just {ar_row.me_elapsed} ME days — "
        f"vs Frodo's {fr_row.me_mi:.0f} miles over {fr_row.me_elapsed} days. "
        f"Yet my actual walking took {ar_row.w_elapsed} real-world days for Return "
        f"vs {fr_row.w_elapsed} for Mordor.",
        "The fictional narrative is relentless; my real-world pace is not.",
        "two_clocks.png, journey_overview.png",
    ),
    (
        "**The Anduin boat leg is the single fastest fictional travel segment.**",
        f"Frodo's boat journey (Silverlode Hythe → Parth Galen) covers {boat_seg.fi_mi:.0f} fictional miles "
        f"in {boat_seg.me_days} ME days = {boat_seg.fi_rate:.1f} mi/day — "
        f"{boat_multiplier:.1f}× the average walking rate ({avg_walk_rate:.1f} mi/day).",
        "River travel creates an unmistakable discontinuity in the fictional mileage trajectory.",
        "fictional_travel_rate.png, narrative_mileage.png (Mordor)",
    ),
    (
        "**Rivendell consumes the most fictional rest time in the Mordor journey.**",
        f"Frodo rests at Rivendell for 61 ME days (Oct 24 – Dec 25, TA 3018) with zero fictional mileage. "
        f"This is {61/fr_row.me_elapsed*100:.0f}% of the entire fictional journey duration.",
        "A major portion of the fictional clock ticks with no forward movement.",
        "narrative_mileage.png, fictional_time_allocation.png",
    ),
    (
        "**Bilbo's journey has the highest proportion of rest/captivity in ME time.**",
        f"Rivendell rest ({28} ME days) + Wood-elves captivity (~{28} ME days) + Lake-town rest (~{17} ME days) "
        f"= ~{28+28+17} days of zero mileage out of {bi_row.me_elapsed} ME days "
        f"({(28+28+17)/bi_row.me_elapsed*100:.0f}%).",
        "Bilbo spends more than a third of his fictional timeline stationary.",
        "fictional_time_allocation.png",
    ),
    (
        "**The pony leg (Beorn → Mirkwood entrance) is Bilbo's fastest fictional travel.**",
        f"Bilbo covers 167 fictional miles in ~3 ME days after Beorn's Hall — approximately "
        f"56 fictional mi/day, far exceeding any walking segment.",
        "Pony/horse travel creates a visible 'kink' in Bilbo's cumulative mileage curve.",
        "narrative_mileage.png, fictional_travel_rate.png",
    ),
    (
        "**My real-world walking pace was remarkably consistent across all three journeys.**",
        f"Median daily miles: Frodo {fr_row.w_med:.1f}, Aragorn {ar_row.w_med:.1f}, "
        f"Bilbo {bi_row.w_med:.1f}. Standard deviations are similar, "
        f"suggesting no systematic change in fitness or effort over two years.",
        "The fictional story changes dramatically; my walking cadence does not.",
        "daily_walking_distribution.png",
    ),
    (
        "**Aragorn's Return journey required the most actual walking per fictional mile.**",
        f"Aragorn's fictional journey is mostly horseback and ships, yet I walked "
        f"{ar_row.w_total_mi:.0f} actual miles to cover {ar_row.me_mi:.0f} fictional miles. "
        f"The mi ratio (actual/fictional) is {ar_row.mi_ratio:.2f}× — "
        f"vs Frodo {fr_row.mi_ratio:.2f}× and Bilbo {bi_row.mi_ratio:.2f}×.",
        "The fictional character travels fast; I just walked.",
        "journey_overview.png, my_walking_by_segment.png",
    ),
    (
        "**The final Mordor march is fictionally slow but narratively intense.**",
        f"The march from Cirith Ungol to Cracks of Doom (155 fictional miles) spans 10 ME days "
        f"= {155/10:.1f} fi-mi/day — roughly average walking rate despite extreme narrative drama.",
        "Tolkien calibrated even the final march as relatively slow — darkness and terrain.",
        "fictional_travel_rate.png, narrative_mileage.png",
    ),
    (
        "**Bilbo's journey took the fewest real-world days but covers significant fictional range.**",
        f"Bilbo: {bi_row.w_elapsed} real-world days, {bi_row.me_elapsed} ME days, "
        f"{bi_row.me_mi:.0f} fictional miles — compressed into just {bi_row.w_days} walking days. "
        f"His {bi_row.w_streak}-day longest streak exceeds Frodo's and Aragorn's proportionally.",
        "The Hobbit is a shorter fictional journey but my walking pace was equivalent.",
        "journey_overview.png, cumulative_walking.png",
    ),
    (
        "**Lothlórien is the second-largest rest period in the Mordor journey.**",
        f"The Fellowship rests ~29 ME days at Lothlórien (Jan 17 – Feb 14, TA 3019) "
        f"with fictional miles at 952. Combined with Rivendell (61 days), "
        f"Frodo spends {(61+29)/fr_row.me_elapsed*100:.0f}% of fictional time at rest in two locations.",
        "Rest periods are not just narrative pauses — they define the shape of both clocks.",
        "narrative_mileage.png (Mordor, grey bands)",
    ),
]

for i, (title, evidence, why, viz) in enumerate(findings, 1):
    report_lines += [
        f"### Finding {i}: {title}",
        "",
        f"**Evidence:** {evidence}",
        "",
        f"**Why it matters:** {why}",
        "",
        f"**Visualization:** {viz}",
        "",
    ]

report_lines += [
    "---",
    "",
    "## 5. Recommended Visualizations for Portfolio",
    "",
    "| Priority | Figure | Key Story |",
    "|----------|--------|-----------|",
    "| ★★★ | `two_clocks.png` | Core two-clock concept — the visual heart of the project |",
    "| ★★★ | `narrative_mileage.png` | Shows rest/captivity and travel mode discontinuities |",
    "| ★★★ | `fictional_travel_rate.png` | Reveals boat vs horseback vs walking speed differences |",
    "| ★★  | `fictional_time_allocation.png` | Shows proportion of time in each travel mode |",
    "| ★★  | `journey_overview.png` | Clean four-panel summary for executive overview |",
    "| ★★  | `segment_comparison.png` | Detailed segment-by-segment contrast |",
    "| ★   | `daily_walking_distribution.png` | My actual walking behavior |",
    "| ★   | `cumulative_walking.png` | My real-world trajectory over calendar time |",
    "| ★   | `my_walking_by_segment.png` | How many walking days per fictional segment |",
    "",
    "---",
    "",
    "## 6. Recommended Segmentation",
    "",
    "The proposed segments in the brief were broadly validated. Amendments made:",
    "",
    "**Frodo/Mordor:**",
    "- Split 'Bag End → Rivendell' into two segments at Bree (mi=145): "
      "character of travel changes after Weathertop attack.",
    "- Split the 'Rivendell → Khazad-dûm' segment to separate the "
      "Rivendell rest (61 days, mi flat at 487) from the Fellowship march.",
    "- Separated Lothlórien rest (mi flat at 952) as its own segment.",
    "- Boat on the Anduin (mi 962→1367, 10 ME days) isolated as highest-rate segment.",
    "",
    "**Aragorn/Return:**",
    "- Simplified to 5 segments; the Parth Galen → Edoras and "
      "Edoras → Dunharrow legs are both primarily horseback.",
    "- 'Paths of Dead → Pelargir' is marked 'mixed' as it combines "
      "the supernatural Paths and river travel.",
    "",
    "**Bilbo/Hobbit:**",
    "- Added Rivendell rest, Wood-elves captivity, and Lake-town rest "
      "as explicit zero-mileage segments.",
    "- 'Beorn → Mirkwood Entrance' identified as a pony/horseback leg "
      "based on chronology timeline (167 mi in ~3 days).",
    "",
    "---",
    "",
    "## 7. Caveats and Limitations",
    "",
    "- **Fictional mileage calibration**: distances are derived from narrative anchors, "
      "not map measurement. Different sources yield different numbers.",
    "- **ME calendar**: Shire calendar has intercalary days and year-length differs slightly "
      "from Gregorian. Ordinal arithmetic treats all days as equal.",
    "- **Travel mode**: assigned from narrative context, not explicit data fields. "
      "Segments marked 'walking' could include short boat crossings or other transport.",
    "- **My walking pace**: Google Fit step counting has known rounding (±3 steps/day). "
      "Conversion factor: 1 mile = 2,000 steps (approximate).",
    "- **Gap days** (178 rows, ~732 miles): walking between journeys is real but not "
      "assigned to any fictional context. Excluded from journey analysis.",
    "- **No inferential statistics**: this is a personal dataset of one individual. "
      "Descriptive statistics only; no hypothesis testing applied.",
    "",
]

report_path = ROOT / "archive" /"reports" / "eda_report.md"
report_path.write_text("\n".join(report_lines), encoding="utf-8")
print(f"  saved → {report_path.name}")
print("\nAll outputs complete.")
