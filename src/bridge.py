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
below (`edit`, `back`, `close_window`, `replay`, `play`, `save_layout`, `settings_saved`).
"""

from __future__ import annotations

import json
import traceback

from . import cards
from .config import check_settings, get_config, update_config

MAX_BATCH = 400


def page_config(cfg: dict) -> dict:
    return {"startSide": cfg["start_side"], "autoplay": cfg["autoplay_audio"],
            "waitBelow": cfg["wait_below_percent"]}


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
    def _ids(msg: dict) -> list[int]:
        out = []
        for c in (msg.get("ids") or [])[:MAX_BATCH]:
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
        return {"rows": cards.rows(self.host.col, self._ids(msg), self.host.analyzer())}

    def cmd_facets(self, msg: dict) -> dict:
        """Filter and sort data for the whole list, a slice at a time (the
        page asks until it has all of them), for the view `seq`."""
        if msg.get("seq") != self.host.view()["seq"]:
            return {"stale": True}
        ids = self.host.ids()
        start = max(0, int(msg.get("offset") or 0))
        end = min(len(ids), start + max(1, min(5000, int(msg.get("limit") or 3000))))
        return {"offset": start, "total": len(ids),
                "facets": cards.facets(self.host.col, ids[start:end], self.host.analyzer())}

    def cmd_cards(self, msg: dict) -> dict:
        h = self.host
        out = {}
        for cid in self._ids(msg)[:24]:
            out[str(cid)] = cards.render(h.col, cid, h.prepare, h.hook, h.body_class)
        return {"cards": out}

    # --- actions -------------------------------------------------------------

    def cmd_edit(self, msg: dict) -> dict:
        self.host.edit(int(msg.get("cid") or 0))
        return {}

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

    def cmd_layout(self, msg: dict) -> dict:
        width = msg.get("listWidth")
        if isinstance(width, (int, float)):
            self.host.save_layout({"listWidth": int(width)})
        return {}

    # --- settings ----------------------------------------------------------

    def cmd_settings(self, msg: dict) -> dict:
        cfg = get_config()
        return {"settings": {
            "shortcut": cfg["shortcut"],
            "defaultSearch": cfg["default_search"],
            "startSide": cfg["start_side"],
            "autoplay": cfg["autoplay_audio"],
            "waitBelow": cfg["wait_below_percent"],
        }}

    def cmd_save_settings(self, msg: dict) -> dict:
        old = get_config()
        changes, problems = check_settings(msg.get("settings") or {})
        if problems:
            return {"problems": problems}
        changed = {k for k, v in changes.items() if old.get(k) != v}
        cfg = update_config(**changes) if changed else old
        if changed:
            self.host.settings_saved(cfg, changed)
        return {"config": page_config(cfg), "saved": bool(changed)}
