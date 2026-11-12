# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""What the window shows: a search and the cards it found, or cards another
add-on handed over. Plain Python (no Qt), shared by the window, the dev
server and the tests."""

from __future__ import annotations

from collections.abc import Iterable

from . import cards


class ViewState:
    def __init__(self) -> None:
        self.seq = 0
        self.search = ""
        self.ids: list[int] = []
        self.title: str | None = None
        self.source: str | None = None
        self.error: str | None = None

    def set(self, col, *, search: str, ids: Iterable[int] | None = None,
            title: str | None = None, source: str | None = None) -> None:
        """Show `ids` (sorted, as a search would), or else what `search`
        finds. A bad search shows Anki's message and no cards."""
        error = None
        if ids is None:
            try:
                found = cards.search(col, search) if search.strip() else []
            except Exception as exc:
                found, error = [], str(exc)
        else:
            found = sorted({int(c) for c in ids})
        self.seq += 1
        self.search, self.ids, self.title, self.source, self.error = search, found, title, source, error

    def as_dict(self, back: str | None = None) -> dict:
        return {
            "search": self.search,
            "ids": self.ids,
            "title": self.title,
            "source": self.source,
            "error": self.error,
            "seq": self.seq,
            "back": back,
        }
