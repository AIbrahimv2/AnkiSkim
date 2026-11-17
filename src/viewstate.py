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
        # The card to start on (the one you were reviewing), if not the first.
        self.select: int | None = None
        # From a review: the side it's showing, and the cards whose answers
        # the list mustn't give away (the ones still to come).
        self.side: str | None = None
        self.hidden: set[int] = set()
        # Anything else the page shows with these cards (a review's views).
        self.extra: dict = {}

    def set(self, col, *, search: str, ids: Iterable[int] | None = None,
            title: str | None = None, source: str | None = None,
            topics: Iterable[str] | None = None, select: int | None = None,
            ordered: bool = False, side: str | None = None, hidden: Iterable[int] | None = None,
            extra: dict | None = None) -> None:
        """Show `ids` (sorted, as a search would), or else what `search`
        finds; an empty search finds every card. A bad search shows Anki's
        message and no cards. `topics` are the tags the cards are read
        against; a search for one tag names its own."""
        error = None
        if ids is None:
            try:
                found = cards.search(col, search.strip() or "deck:*")
            except Exception as exc:
                found, error = [], str(exc)
        elif ordered:  # a review: studied, on screen, to come
            found = list(dict.fromkeys(int(c) for c in ids))
        else:
            found = sorted({int(c) for c in ids})
        self.seq += 1
        self.search, self.ids, self.title, self.source, self.error = search, found, title, source, error
        self.topics = [t for t in topics or [] if isinstance(t, str) and t] or topics_from_search(search)
        self.select = int(select) if select else None
        self.side = side if side in ("question", "answer") else None
        self.hidden = {int(c) for c in hidden or ()}
        self.extra = dict(extra or {})

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
            "select": self.select,
            "side": self.side,
            **self.extra,
        }
