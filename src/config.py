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
}

SIDES = ("question", "answer")


def get_config() -> dict:
    cfg = dict(mw.addonManager.getConfig(ADDON) or {})
    for key, value in DEFAULTS.items():
        if not isinstance(cfg.get(key), type(value)):
            cfg[key] = value
    if cfg["start_side"] not in SIDES:
        cfg["start_side"] = DEFAULTS["start_side"]
    cfg["wait_below_percent"] = max(5, min(95, cfg["wait_below_percent"]))
    cfg["system_done_percent"] = max(5, min(100, cfg["system_done_percent"]))
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
    return changes, problems
