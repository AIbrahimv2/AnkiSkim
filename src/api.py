# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Skim's API for other add-ons, published as `aqt.mw.skim`.

Look it up when you need it (add-ons load in any order), and check it's
there, since Skim may not be installed:

    skim = getattr(aqt.mw, "skim", None)
    if skim:
        skim.open(search='"tag:Pixorize::Brainstem"', card_ids=ids,
                  title="Brainstem", source="Stepwise")

`card_ids` is optional. Passing them skips Anki's search, which for a tag
reads every note (well over 100 ms on a big collection). `search` is then
only shown, and used if you open the cards in Anki's browser.

`source` names who opened Skim. While the window still shows that source's
cards, `follow()` with the same source swaps in new ones without taking
focus (Stepwise does this as you move through topics); once you search for
something else in Skim, it stops following. `p` in Skim goes back to the
window that opened it.

`topic` (a tag, or a list of them) is what the cards are read against: the
tags pane puts that resource first, "Again in" lists the other systems a
card is in, and suspended cards get a verdict (unsuspend now, or wait for
the system they mostly belong to). A `tag:` search names its own topic.

`set_context(factory)` lets a study planner say what it knows: `factory()`
returns an object with `pinned()` (resource tags, in the order to list
them), `roots()` (top-level tags whose children are resources, like
"#AK_Step1_v12") and `status(tag)` ("queued", "completed", "later" or
None). Call `context_changed()` when those change.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from aqt import mw
from anki.utils import ids2str
from aqt.qt import QAction, QApplication, QKeySequence, QTimer

from .tags import Context
from .window import SkimWindow

VERSION = 2

_window: SkimWindow | None = None
_action: QAction | None = None
_context_factory: Callable[[], Context] | None = None


def _get() -> SkimWindow:
    global _window
    if _window is None:
        _window = SkimWindow()
    return _window


def _topics(topic: str | Sequence[str] | None) -> list[str] | None:
    if topic is None:
        return None
    return [topic] if isinstance(topic, str) else [t for t in topic if isinstance(t, str)]


def open(*, search: str | None = None, card_ids: Sequence[int] | None = None,
         title: str | None = None, source: str | None = None, focus: bool = True,
         topic: str | Sequence[str] | None = None, select: int | None = None,
         back_label: str | None = None, ordered: bool = False, side: str | None = None,
         hidden: Sequence[int] | None = None) -> None:
    """Show Skim on these cards (or, with neither `search` nor `card_ids`,
    on whatever it showed last) and give it the keys."""
    if mw.col is None:
        return
    window = _get()
    # p goes back to the add-on window that asked (Stepwise), not to Anki's
    # main window when you open Skim from the Tools menu.
    opener = QApplication.activeWindow() if source else None
    window.show_cards(search=search, card_ids=card_ids, title=title, source=source,
                      topics=_topics(topic), select=select, ordered=ordered, side=side, hidden=hidden,
                      opener=opener if opener is not window else None, back_label=back_label)
    window.present(focus)


def follow(*, search: str, card_ids: Sequence[int] | None = None, title: str | None = None,
           source: str, topic: str | Sequence[str] | None = None, select: int | None = None,
           ordered: bool = False, side: str | None = None, hidden: Sequence[int] | None = None) -> bool:
    """If Skim is open on `source`'s cards, show these instead, without
    taking focus. Returns whether it did. Cheap to call on every move."""
    if _window is None or not _window.following(source):
        return False
    _window.follow(search=search, card_ids=card_ids, title=title, source=source, topics=_topics(topic),
                   select=select, ordered=ordered, side=side, hidden=hidden)
    return True


def set_context(factory: Callable[[], Context] | None) -> None:
    """Register what a study planner knows (see the module docstring)."""
    global _context_factory
    if factory is not _context_factory:
        _context_factory = factory
        context_changed()


def context_changed() -> None:
    if _window is not None:
        _window.context_changed()


def context() -> Context | None:
    """A fresh snapshot from the registered planner, if any."""
    if _context_factory is None:
        return None
    try:
        return _context_factory()
    except Exception:
        return None


def is_open() -> bool:
    return _window is not None and _window.isVisible()


def following(source: str) -> bool:
    return _window is not None and _window.following(source)


# --- for Skim itself ------------------------------------------------------------


def open_from_menu() -> None:
    """Tools → Skim (Cmd/Ctrl+Shift+B): during a review, the card you're
    reviewing; anywhere else, what Skim showed last."""
    card = review_card()
    if card is not None:
        open(back_label="the review", **_review_view(card))
    else:
        open()


# --- the review -----------------------------------------------------------------

REVIEW = "Review"
# The scheduler's whole queue for a big deck is a few hundred cards.
QUEUE_LIMIT = 2000
REVIEW_DELAY_MS = 60


def review_card():
    """The card on screen in the reviewer, if you're reviewing."""
    if getattr(mw, "state", None) != "review":
        return None
    return getattr(getattr(mw, "reviewer", None), "card", None)


def _review_topics(card) -> list[str]:
    """The topics you're studying the card for: its tags the planner
    (Stepwise) has queued, or else done."""
    ctx = context()
    if ctx is None:
        return []
    try:
        tags = card.note().tags
        status = {t: ctx.status(t) for t in tags}
    except Exception:
        return []
    return [t for t in tags if status[t] == "queued"] or [t for t in tags if status[t] == "completed"]


def _session(card) -> tuple[list[int], list[int], str]:
    """Today's review of the deck you're studying: the cards answered so
    far (in the order you answered them), and the ones still to come (in
    the scheduler's order), without the card on screen; and the deck's
    name."""
    col = mw.col
    did = col.decks.get_current_id()
    dids = col.decks.deck_and_child_ids(did)
    start = (col.sched.day_cutoff - 86400) * 1000
    studied = col.db.list(
        "select r.cid from revlog r join cards c on c.id = r.cid "
        f"where r.id > ? and r.ease > 0 and c.did in {ids2str(dids)} "
        "group by r.cid order by min(r.id)", start)
    try:
        queued = [q.card.id for q in col.sched.get_queued_cards(fetch_limit=QUEUE_LIMIT).cards]
    except Exception:
        queued = []
    upcoming = [c for c in queued if c != card.id]
    coming = set(upcoming)
    studied = [c for c in studied if c != card.id and c not in coming]
    name = col.decks.name(did).rsplit("::", 1)[-1]
    return studied, upcoming, name


def _review_view(card, side: str | None = None) -> dict:
    """What Skim shows from a review: the session, on the card on screen,
    showing the side the reviewer is on. Answers of cards still to come
    (and this one, until it's answered) stay hidden in the list."""
    if side is None:
        side = "answer" if getattr(getattr(mw, "reviewer", None), "state", None) == "answer" else "question"
    try:
        studied, upcoming, deck = _session(card)
    except Exception:  # an unusual collection: the card's note alone
        studied, upcoming, deck = [], [], ""
    ids = [*studied, card.id, *upcoming]
    hidden = [*upcoming, *([card.id] if side == "question" else [])]
    title = f"{deck}: {len(studied):,} studied, {len(upcoming) + 1:,} to go"
    if not deck:
        ids, title = list(card.note().card_ids()), "This card's note"
    # No search: the title says what these are (e still opens the card in
    # Anki's browser).
    return {"search": "", "card_ids": ids, "ordered": True, "select": card.id, "side": side, "hidden": hidden,
            "title": title, "source": REVIEW, "topic": _review_topics(card) or None}


def on_review_question(card) -> None:
    """The reviewer moved on: if Skim is open on the review, show this card,
    front only. Just after the reviewer has drawn it, so it never waits."""
    if following(REVIEW):
        QTimer.singleShot(REVIEW_DELAY_MS, lambda: following(REVIEW) and follow(**_review_view(card, "question")))


def on_review_answer(card) -> None:
    """The reviewer showed the answer: so does Skim."""
    if following(REVIEW) and _window is not None:
        _window.reveal(card.id)


def prewarm() -> None:
    """Make the window and load its page while nothing else is happening,
    so the first open is as quick as the rest."""
    if mw.col is not None:
        _get().load()


def set_action(action: QAction) -> None:
    global _action
    _action = action


def set_shortcut(shortcut: str) -> None:
    if _action is not None:
        _action.setShortcut(QKeySequence(shortcut) if shortcut else QKeySequence())


def open_settings() -> None:
    open()
    if _window is not None:
        _window.push({"type": "settings"})


def on_operation(changes, handler) -> None:
    if _window is not None and handler is not _window:
        _window.on_operation(changes)


def on_theme_change() -> None:
    if _window is not None:
        _window.reload()


def close() -> None:
    """The profile is closing: the window belongs to its collection."""
    global _window
    window, _window = _window, None
    if window is not None:
        window.close()
        window.cleanup()
        window.deleteLater()
