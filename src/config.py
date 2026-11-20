# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Add-on settings. They're edited in Settings, a tab of the add-on kit's
window (⋯ → Settings… in Skim), which Anki's own Config button for the
add-on also opens."""

from __future__ import annotations

from aqt import mw
from aqt.qt import QKeySequence

ADDON = __name__.split(".")[0]

DEFAULTS: dict = {
    "shortcut": "Ctrl+Shift+B",
    "default_search": "deck:current",
    "start_side": "answer",
    "autoplay_audio": False,
    # A suspended card waits for another system when less than this share
    # of its places is in the unit you're on (see tags.py).
    "wait_below_percent": 50,
    # A system counts as done on every card once this share of its topics
    # in your pinned resources is done (see tags.py).
    "system_done_percent": 50,
    # How big the window draws (Cmd+= / Cmd+-, the kit's zoom.py).
    "zoom_percent": 100,
    # The height, in pixels, a picture pasted while editing is given on the
    # card; 0 leaves it its own size. There's no resizing a picture in the
    # fields, so every pasted one gets the same height. AnKing's note types
    # set none (only widths: 85% of the card, 60% in the resources' fields)
    # and 28px text, so 150px is about four lines: the picture sits with
    # the text rather than pushing it off the screen.
    "paste_image_height": 150,
}

SIDES = ("question", "answer")
# The sizes the window can take (the kit's zoom.py: MIN, MAX).
ZOOM_RANGE = (50, 200)
# A pasted picture's height in pixels, when one is set.
PASTE_HEIGHT_RANGE = (20, 2000)


def get_config() -> dict:
    cfg = dict(mw.addonManager.getConfig(ADDON) or {})
    for key, value in DEFAULTS.items():
        if not isinstance(cfg.get(key), type(value)):
            cfg[key] = value
    if cfg["start_side"] not in SIDES:
        cfg["start_side"] = DEFAULTS["start_side"]
    cfg["wait_below_percent"] = max(5, min(95, cfg["wait_below_percent"]))
    cfg["system_done_percent"] = max(5, min(100, cfg["system_done_percent"]))
    cfg["zoom_percent"] = max(ZOOM_RANGE[0], min(ZOOM_RANGE[1], cfg["zoom_percent"]))
    h = cfg["paste_image_height"]
    cfg["paste_image_height"] = 0 if h <= 0 else max(PASTE_HEIGHT_RANGE[0], min(PASTE_HEIGHT_RANGE[1], h))
    return cfg


def update_config(**changes) -> dict:
    cfg = get_config()
    cfg.update(changes)
    mw.addonManager.writeConfig(ADDON, cfg)
    return cfg


def check_settings(values: dict) -> tuple[dict, dict]:
    """Validate settings sent from the Settings dialog. Returns (config
    changes, problems by field); only fields that were sent are checked."""
    changes: dict = {}
    problems: dict = {}
    if "shortcut" in values:
        text = str(values["shortcut"] or "").strip()
        # Qt parses anything; unknown keys come back as "" when written out.
        seq = QKeySequence(text)
        normal = seq.toString(QKeySequence.SequenceFormat.PortableText)
        if text and (not normal or seq.count() != 1):
            problems["shortcut"] = "Anki can't use that shortcut."
        else:
            changes["shortcut"] = normal if text else ""
    if "defaultSearch" in values:
        changes["default_search"] = str(values["defaultSearch"] or "").strip()
    if "startSide" in values:
        if values["startSide"] in SIDES:
            changes["start_side"] = values["startSide"]
        else:
            problems["startSide"] = "Pick one of the options."
    if "autoplay" in values:
        changes["autoplay_audio"] = bool(values["autoplay"])
    if "waitBelow" in values:
        try:
            pct = int(values["waitBelow"])
            if not 5 <= pct <= 95:
                raise ValueError
            changes["wait_below_percent"] = pct
        except (TypeError, ValueError):
            problems["waitBelow"] = "Enter a percentage from 5 to 95."
    if "systemDone" in values:
        try:
            pct = int(values["systemDone"])
            if not 5 <= pct <= 100:
                raise ValueError
            changes["system_done_percent"] = pct
        except (TypeError, ValueError):
            problems["systemDone"] = "Enter a percentage from 5 to 100."
    if "size" in values:
        try:
            pct = int(values["size"])
            if not ZOOM_RANGE[0] <= pct <= ZOOM_RANGE[1]:
                raise ValueError
            changes["zoom_percent"] = pct
        except (TypeError, ValueError):
            problems["size"] = f"Enter a percentage from {ZOOM_RANGE[0]} to {ZOOM_RANGE[1]}."
    if "pasteHeight" in values:
        try:
            px = int(values["pasteHeight"] or 0)
            if px != 0 and not PASTE_HEIGHT_RANGE[0] <= px <= PASTE_HEIGHT_RANGE[1]:
                raise ValueError
            changes["paste_image_height"] = px
        except (TypeError, ValueError):
            problems["pasteHeight"] = (f"Enter a height from {PASTE_HEIGHT_RANGE[0]} to {PASTE_HEIGHT_RANGE[1]} "
                                       "pixels, or 0 to leave pictures their own size.")
    return changes, problems
