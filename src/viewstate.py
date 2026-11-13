# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""What the window shows: a search and the cards it found, or cards another
add-on handed over. Plain Python (no Qt), shared by the window, the dev
server and the tests."""

from __future__ import annotations

from collections.abc import Iterable

from . import cards
from .tags import topics_from_search


class ViewState:
    def __init__(self) -> None:
        self.seq = 0
        self.search = ""
        self.ids: list[int] = []
        self.title: str | None = None
        self.source: str | None = None
        self.error: str | None = None
        # The tag(s) these cards are "here" in, for reading their tags.
        self.topics: list[str] = []

    def set(self, col, *, search: str, ids: Iterable[int] | None = None,
            title: str | None = None, source: str | None = None,
            topics: Iterable[str] | None = None) -> None:
        """Show `ids` (sorted, as a search would), or else what `search`
        finds. A bad search shows Anki's message and no cards. `topics` are
        the tags the cards are read against; a search for one tag names
        its own."""
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
        self.topics = [t for t in topics or [] if isinstance(t, str) and t] or topics_from_search(search)

    def as_dict(self, back: str | None = None) -> dict:
        return {
            "search": self.search,
            "ids": self.ids,
            "title": self.title,
            "source": self.source,
            "error": self.error,
            "seq": self.seq,
            "back": back,
            "topics": self.topics,
        }
