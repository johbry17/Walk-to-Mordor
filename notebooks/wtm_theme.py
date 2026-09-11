"""Walk to Mordor — shared chart styling and colour palette."""
from __future__ import annotations
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

JOURNEY_COLORS: dict[str, str] = {
    "Mordor": "#C17F40",   # Frodo  — earthy amber
    "Return": "#4A7C8E",   # Aragorn — steel blue-grey
    "Hobbit": "#5F8A5A",   # Bilbo  — moss green
}
UNASSIGNED_COLOR = "#BBBBBB"

CHARACTER_LABEL: dict[str, str] = {
    "Mordor": "Frodo — Mordor",
    "Return": "Aragorn — Return of the King",
    "Hobbit": "Bilbo — The Hobbit",
}
JOURNEY_ORDER = ["Mordor", "Return", "Hobbit"]


def apply_theme() -> None:
    plt.rcParams.update({
        "figure.facecolor":    "white",
        "axes.facecolor":      "white",
        "axes.grid":           True,
        "grid.color":          "#E8E8E8",
        "grid.linewidth":      0.6,
        "axes.spines.top":     False,
        "axes.spines.right":   False,
        "font.family":         "sans-serif",
        "font.size":           11,
        "axes.titlesize":      12,
        "axes.titleweight":    "bold",
        "axes.labelsize":      10,
        "xtick.labelsize":     9,
        "ytick.labelsize":     9,
        "legend.fontsize":     9,
        "legend.frameon":      False,
        "figure.dpi":          120,
    })


def journey_legend_handles(include_unassigned: bool = False) -> list:
    handles = [
        mpatches.Patch(color=JOURNEY_COLORS[jid], label=CHARACTER_LABEL[jid])
        for jid in JOURNEY_ORDER
    ]
    if include_unassigned:
        handles.append(
            mpatches.Patch(color=UNASSIGNED_COLOR, label="Gap / unassigned")
        )
    return handles
