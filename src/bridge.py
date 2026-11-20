# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Command handler for the page.

The page calls `pycmd(JSON.stringify({cmd, ...args}), callback)`; Anki hands
the string to `Bridge.handle`, and whatever it returns is JSON-encoded back
to the callback. Moving between cards never comes through here: the page
asks for list rows and card HTML ahead of time, in batches.

The host is the Skim window in Anki, or tools/devserver.py while working on
the page in a browser. It provides `col`, `view()`, `run_search(query)`,
`frame_html()`, `analyzer()`, `ids()`, `prepare`, `hook`, `body_class`,
`layout`, and the actions
below (`browse`, `changed`, `back`, `close_window`, `replay`, `play`, `save_layout`,
`settings_saved`, and optionally `toggle_suspend` and `review_lens`).
"""

from __future__ import annotations

import json
import re
import traceback

from . import cards, kit, notes
from .config import DEFAULTS, check_settings, get_config, update_config

MAX_BATCH = 400
# Facets are a few numbers a card: the page asks for a few thousand at once.
MAX_FACETS = 5000
# A selection can run to the end of a big view (v, then G).
MAX_SELECTED = 100_000
# The layout the page may save (app.ts keeps to the same ranges): the
# table's share of the width, and the card's share of the height.
SHARE_RANGE = (0.2, 0.9)
SPLIT_RANGE = (0.15, 0.9)
# The table's columns you've turned on or off: list.ts's keys.
MAX_COLS = 32
_COL_KEY = re.compile(r"[a-z]{1,12}")
# A field being saved: far more than a card's text, short of a mistake.
MAX_FIELD = 4 * 1024 * 1024


def settings_of(cfg: dict) -> dict:
    """What Settings (a tab of the kit's window, settings_page.py) edits."""
    return {
        "shortcut": cfg["shortcut"],
        "defaultSearch": cfg["default_search"],
        "startSide": cfg["start_side"],
        "autoplay": cfg["autoplay_audio"],
        "waitBelow": cfg["wait_below_percent"],
        "systemDone": cfg["system_done_percent"],
        "size": cfg["zoom_percent"],
        "pasteHeight": cfg["paste_image_height"],
    }


def page_config(cfg: dict) -> dict:
    return {"startSide": cfg["start_side"], "autoplay": cfg["autoplay_audio"],
            "waitBelow": cfg["wait_below_percent"], "systemDone": cfg["system_done_percent"],
            "pasteHeight": cfg["paste_image_height"]}


class Bridge:
    def __init__(self, host):
        self.host = host

    def handle(self, raw: str):
        if not isinstance(raw, str) or not raw.startswith("{"):
            return None  # e.g. Anki's own "domDone"
        try:
            msg = json.loads(raw)
            fn = getattr(self, "cmd_" + str(msg.get("cmd")), None)
            if fn is None:
                return {"error": f"Unknown command: {msg.get('cmd')}"}
            return fn(msg) or {}
        except Exception as exc:  # report to the page instead of a Qt error dialog
            traceback.print_exc()
            return {"error": f"{type(exc).__name__}: {exc}"}

    @staticmethod
    def _ids(msg: dict, cap: int = MAX_BATCH) -> list[int]:
        out = []
        for c in (msg.get("ids") or [])[:cap]:
            try:
                out.append(int(c))
            except (TypeError, ValueError):
                pass
        return out

    # --- reads -------------------------------------------------------------

    def cmd_boot(self, msg: dict) -> dict:
        return {
            "view": self.host.view(),
            "frame": self.host.frame_html(),
            "config": page_config(get_config()),
            "layout": self.host.layout(),
        }

    def cmd_search(self, msg: dict) -> dict:
        return {"view": self.host.run_search(str(msg.get("query") or ""))}

    def cmd_rows(self, msg: dict) -> dict:
        """List rows, with the reading they were made for: the page keeps
        them per reading, across views."""
        hidden = getattr(self.host, "hidden", None)
        return {"rows": cards.rows(self.host.col, self._ids(msg), self.host.analyzer(),
                                   hidden() if hidden else frozenset()),
                "reading": self.host.view()["reading"]}

    def cmd_facets(self, msg: dict) -> dict:
        """Filter and sort data for some of the view `seq`'s cards (the page
        asks a slice at a time for the ones it doesn't have yet), in the
        order asked, with the reading they were made for."""
        view = self.host.view()
        if msg.get("seq") != view["seq"]:
            return {"stale": True}
        ids = self._ids(msg, MAX_FACETS)
        extra = [k for k in msg.get("extra") or [] if isinstance(k, str)]
        facets = cards.facets(self.host.col, ids, self.host.analyzer(), extra)
        return {"ids": ids, "facets": facets, "decks": cards.deck_names(self.host.col, facets["deck"]),
                "reading": view["reading"]}

    def cmd_cards(self, msg: dict) -> dict:
        h = self.host
        out = {}
        for cid in self._ids(msg)[:24]:
            out[str(cid)] = cards.render(h.col, cid, h.prepare, h.hook, h.body_class)
        return {"cards": out}

    # --- actions -------------------------------------------------------------

    def cmd_browse(self, msg: dict) -> dict:
        """B: the card in Anki's own browser."""
        self.host.browse(int(msg.get("cid") or 0))
        return {}

    # --- editing (e) ---------------------------------------------------------

    def cmd_note(self, msg: dict) -> dict:
        """A card's note, ready to edit (see notes.payload); null if gone."""
        return {"note": notes.payload(self.host.col, int(msg.get("cid") or 0))}

    def cmd_save(self, msg: dict) -> dict:
        """Write the fields that changed ({index: html}). The reply says
        whether anything was written and what to warn about."""
        fields = msg.get("fields")
        if not isinstance(fields, dict) or any(not isinstance(v, str) or len(v) > MAX_FIELD for v in fields.values()):
            return {"error": "That can't be saved."}
        result = notes.save(self.host.col, int(msg.get("nid") or 0), fields)
        if result is None:
            return {"gone": True}
        note, changes = result
        if changes is not None:
            self.host.changed(changes)
        return {"saved": changes is not None, "problem": notes.problem(note)}

    def cmd_clipboard(self, msg: dict) -> dict:
        """The system's clipboard, to paste (Cmd+V, p): see
        notes.from_clipboard. With `mark`, only whether it has changed
        (asked at each yank). A host with no clipboard says so, and the
        page pastes what the browser hands it."""
        read = getattr(self.host, "clipboard", None)
        if read is None:
            return {"unsupported": True}
        return read(mark_only=msg.get("mark") is True)

    def cmd_media(self, msg: dict) -> dict:
        """A pasted image: into the media folder; the src to use for it."""
        src = notes.add_media(self.host.col, str(msg.get("mime") or ""), str(msg.get("data") or ""),
                              str(msg.get("name") or ""))
        return {"src": src} if src else {"error": "That image couldn't be added."}

    def cmd_back(self, msg: dict) -> dict:
        self.host.back()
        return {}

    def cmd_close(self, msg: dict) -> dict:
        self.host.close_window()
        return {}

    def cmd_replay(self, msg: dict) -> dict:
        self.host.replay(int(msg.get("cid") or 0), str(msg.get("side") or "answer"))
        return {}

    def cmd_play(self, msg: dict) -> dict:
        """A play button on a card (the card frame's pycmd("play:a:0"))."""
        self.host.play(int(msg.get("cid") or 0), str(msg.get("tag") or ""))
        return {}

    def cmd_suspend(self, msg: dict) -> dict:
        """Cmd+J: suspend these cards, or unsuspend them if they all are.
        Says which it did, and to how many."""
        toggle = getattr(self.host, "toggle_suspend", None)
        return toggle(self._ids(msg, MAX_SELECTED)) if toggle else {}

    def cmd_undo(self, msg: dict) -> dict:
        """u, or Ctrl-r with `redo`: Anki's Undo and Redo. The reply has
        what was undone, in Anki's words, or says there was nothing."""
        undo = getattr(self.host, "undo", None)
        return undo(redo=msg.get("redo") is True) if undo else {"empty": True}

    def cmd_review_lens(self, msg: dict) -> dict:
        """One of the bar's views: All, the review's session, or a Today
        search. The reply carries the new view, so the page shows it as soon
        as the call returns."""
        switch = getattr(self.host, "review_lens", None)
        view = switch(str(msg.get("lens") or "")) if switch else None
        return {"view": view} if view else {}

    def cmd_layout(self, msg: dict) -> dict:
        """The window's layout, as you leave it: the table's share of the
        width, the card's share of the height beside it, and whether the
        tags pane is open. A call can carry any of them; the rest are kept.
        `reset` forgets them all first (Reset layout in the ⋯ menu), so the
        page starts from its defaults, whatever they are by then.

        `cols` is the table's columns you've turned on or off ({key: on}),
        all of them each time; the others are as list.ts has them by
        default. Reset layout keeps them: Columns → Default columns sends
        an empty one."""
        layout = dict(self.host.layout())
        if msg.get("reset") is True:
            layout = {k: v for k, v in layout.items() if k == "cols"}
        for key, low, high in (("share", *SHARE_RANGE), ("split", *SPLIT_RANGE)):
            v = msg.get(key)
            if isinstance(v, (int, float)) and not isinstance(v, bool) and low <= v <= high:
                layout[key] = round(float(v), 3)
        if isinstance(msg.get("tags"), bool):
            layout["tags"] = msg["tags"]
        cols = msg.get("cols")
        if isinstance(cols, dict) and len(cols) <= MAX_COLS:
            picked = {k: v for k, v in cols.items() if isinstance(k, str) and _COL_KEY.fullmatch(k) and isinstance(v, bool)}
            if picked:
                layout["cols"] = picked
            else:
                layout.pop("cols", None)
        self.host.save_layout(layout)
        return {}

    # --- settings ----------------------------------------------------------

    def cmd_kit(self, msg: dict) -> dict:
        """What's new, About and the other add-ons (the shared add-on kit)."""
        return kit.command(msg)

    def cmd_settings(self, msg: dict) -> dict:
        return {"settings": settings_of(get_config()), "defaults": settings_of(DEFAULTS)}

    def cmd_save_settings(self, msg: dict) -> dict:
        old = get_config()
        changes, problems = check_settings(msg.get("settings") or {})
        if problems:
            return {"problems": problems}
        changed = {k for k, v in changes.items() if old.get(k) != v}
        cfg = update_config(**changes) if changed else old
        if changed:
            self.host.settings_saved(cfg, changed)
        return {"config": page_config(cfg), "settings": settings_of(cfg), "saved": bool(changed)}
