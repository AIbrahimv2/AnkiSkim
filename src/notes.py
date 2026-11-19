# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 AIbrahimv2
"""Editing a card's note (e in the page): its fields ready to edit, and
saving them back.

A note's fields go to the page as Anki's own editor shows them (media names
escaped, so an image with a space in its name loads) and come back the same
way. Only the fields you changed are written, so a field you didn't touch
keeps its HTML exactly. Saving is Anki's own `update_note`: it makes any new
cloze cards, Edit → Undo takes it back, and edits to one note in a row are
one undo step.
"""

from __future__ import annotations

import base64
import hashlib
import html as html_lib
import os
import re

from anki.collection import Collection

# What an emptied field holds in the page: nothing, to Anki.
_EMPTY = {"", "<br>", "<div><br></div>", "<br/>", "<br />"}
# A pasted image: 12 MB is more than a screenshot needs.
MAX_MEDIA = 12 * 1024 * 1024
_MEDIA_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
              "image/svg+xml": "svg", "image/avif": "avif"}
_SRC = re.compile(r'src="([^"]*)"')
_FILE_EXT = {"png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "tif", "tiff"}
_TAGS = re.compile(r"<[^>]*>")


def clean(col: Collection, html: str) -> str:
    """A field as the page sends it, as Anki stores it."""
    text = col.media.escape_media_filenames(str(html), unescape=True)
    return "" if text.strip() in _EMPTY else text


def payload(col: Collection, cid: int) -> dict | None:
    """A card's note for the page: its fields to edit. None if it's gone."""
    try:
        card = col.get_card(cid)
        note = card.note()
    except Exception:
        return None
    model = note.note_type() or {}
    cloze = model.get("type") == 1
    flds = model.get("flds") or []
    tmpls = model.get("tmpls") or []
    kind = f"Cloze {card.ord + 1}" if cloze else (tmpls[card.ord]["name"] if card.ord < len(tmpls) else "")
    return {
        "nid": note.id,
        "cid": cid,
        "notetype": model.get("name", ""),
        "cloze": cloze,
        "card": kind,
        "fields": [
            {
                "name": flds[i]["name"] if i < len(flds) else f"Field {i + 1}",
                "html": col.media.escape_media_filenames(text),
                "rtl": bool(flds[i].get("rtl")) if i < len(flds) else False,
                "hint": (flds[i].get("description") or "") if i < len(flds) else "",
            }
            for i, text in enumerate(note.fields)
        ],
        "problem": problem(note),
    }


def problem(note) -> str | None:
    """What Anki's editor would warn about in this note."""
    try:
        from anki.notes import NoteFieldsCheckResult as R

        state = note.fields_check()
    except Exception:
        return None
    if state == R.MISSING_CLOZE:
        return "No cloze in this note, so it makes no cards. gc adds one."
    if state == R.FIELD_NOT_CLOZE:
        return "A cloze in a field that isn't a cloze field does nothing."
    if state == R.NOTETYPE_NOT_CLOZE:
        return "A cloze only works in a cloze note type."
    if state == R.EMPTY:
        return "The first field is empty."
    return None


def save(col: Collection, nid: int, fields: dict):
    """Write the fields that changed ({index: html}). Returns (note, Anki's
    changes), or None if the note is gone. Nothing is written, and the
    changes are None, when nothing differs."""
    try:
        note = col.get_note(nid)
    except Exception:
        return None
    dirty = False
    for key, html in fields.items():
        try:
            i = int(key)
        except (TypeError, ValueError):
            continue
        if not 0 <= i < len(note.fields):
            continue
        text = clean(col, html)
        if note.fields[i] != text:
            note.fields[i] = text
            dirty = True
    if not dirty:
        return note, None
    return note, col.update_note(note)


def add_media(col: Collection, mime: str, data: str, name: str = "") -> str | None:
    """A pasted image (base64) into the media folder. Returns the src to
    use for it, or None if it isn't an image we take."""
    ext = _MEDIA_EXT.get(str(mime).lower())
    if ext is None or len(data) > MAX_MEDIA * 4 // 3 + 4:
        return None
    try:
        raw = base64.b64decode(data, validate=True)
    except Exception:
        return None
    if not raw or len(raw) > MAX_MEDIA:
        return None
    stem = re.sub(r"[^\w-]+", "-", name.rsplit(".", 1)[0]).strip("-")[:40] or "paste"
    return _src(col, col.media.write_data(f"{stem}.{ext}", raw))


def _src(col: Collection, name: str) -> str:
    """A media file's name as an <img> src (escaped, as fields hold it)."""
    m = _SRC.search(col.media.escape_media_filenames(f'<img src="{name}">'))
    return m.group(1) if m else name


def _has_words(markup: str) -> bool:
    """Whether HTML has any text to read (a copied image's HTML is only its
    <img>)."""
    return bool(html_lib.unescape(_TAGS.sub("", markup)).strip())


def _image(mime):
    """The clipboard's picture as a QImage, or None."""
    from aqt.qt import QImage

    if not mime.hasImage():
        return None
    image = mime.imageData()
    if not isinstance(image, QImage):
        try:
            image = QImage(image)
        except Exception:
            return None
    return None if image.isNull() else image


def clipboard_mark(mime) -> str:
    """Something that changes when the clipboard does, without reading all
    of it: the page compares it with what it was at its last yank, to tell
    whether p should paste the yank or something copied since."""
    if mime is None:
        return ""
    h = hashlib.sha1()
    h.update((mime.text() if mime.hasText() else "").encode("utf-8", "replace"))
    h.update(b"\0")
    h.update((mime.html() if mime.hasHtml() else "").encode("utf-8", "replace"))
    image = _image(mime)
    if image is not None:
        w, hgt = image.width(), image.height()
        points = [(x * (w - 1) // 4, y * (hgt - 1) // 4) for x in range(5) for y in range(5)]
        h.update(repr((w, hgt, [image.pixel(x, y) for x, y in points])).encode())
    for url in mime.urls() if mime.hasUrls() else []:
        h.update(url.toString().encode("utf-8", "replace"))
    return h.hexdigest()


def from_clipboard(col: Collection, mime) -> dict:
    """What's on the system's clipboard, for the page to paste: a picture
    (copied from a browser, a screenshot, an image file from Finder) goes
    into the media folder and comes back as {"image": src}; otherwise
    {"html": ..., "text": ...} or {"text": ...}; {} if there's nothing."""
    if mime is None:
        return {}
    from aqt.qt import QBuffer, QIODevice

    for url in mime.urls() if mime.hasUrls() else []:
        path = url.toLocalFile() if url.isLocalFile() else ""
        ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
        if ext in _FILE_EXT and os.path.isfile(path) and os.path.getsize(path) <= MAX_MEDIA:
            with open(path, "rb") as fh:
                return {"image": _src(col, col.media.write_data(os.path.basename(path), fh.read()))}
    markup = mime.html() if mime.hasHtml() else ""
    text = mime.text() if mime.hasText() else ""
    # A picture, unless it came with text around it (part of a web page).
    image = None if _has_words(markup) else _image(mime)
    if image is not None:
        buf = QBuffer()
        buf.open(QIODevice.OpenModeFlag.WriteOnly)
        image.save(buf, "PNG")
        raw = bytes(buf.data())
        if raw and len(raw) <= MAX_MEDIA:
            name = f"paste-{hashlib.sha1(raw).hexdigest()}.png"
            return {"image": _src(col, col.media.write_data(name, raw))}
    if markup:
        return {"html": markup, "text": text}
    return {"text": text} if text else {}
