"""Card data: searches, list rows and rendered cards."""

from harness import ALL, check, col, notes
from skim import cards
from skim.viewstate import ViewState

print("search")
found = cards.search(col, "tag:Cardio")
check(found == sorted(found), "results come oldest card first")
check(len(found) == 4, "a parent tag finds its children's cards (two notes, two cards each)")

print("view state")
v = ViewState()
v.set(col, search="tag:Neuro")
check(v.ids and v.error is None and v.seq == 1, "a search fills the view")
v.set(col, search="tag:(", title="Bad")
check(v.ids == [] and v.error, f"a bad search keeps Anki's message ({v.error!r})")
v.set(col, search="ignored here", ids=[ALL[3], ALL[1], ALL[1]], title="Two", source="Stepwise")
check(v.ids == sorted({ALL[1], ALL[3]}), "handed-over ids are used as they are, sorted, once each")
check(v.as_dict("Stepwise")["back"] == "Stepwise" and v.seq == 3, "every view gets a new number")

print("rows")
rows = cards.rows(col, ALL)
heart = rows[str(ALL[0])]
check(heart[0] == "Heart chambers? Count them", f"row text: tags dropped, line breaks as spaces ({heart[0]!r})")
check(heart[1] == "Card 1", "a Basic card shows its card type")
check(heart[3] == 1, "the red flag comes through")
brain_cids = col.find_cards(f"nid:{notes['brainstem']}", order="c.ord")
brain = rows[str(brain_cids[1])]
check(brain[0] == "The brainstem has three parts", f"clozes filled in, hints dropped ({brain[0]!r})")
check(brain[1] == "Cloze 2", "a cloze card shows its number")
mitral = [rows[str(c)] for c in col.find_cards(f"nid:{notes['mitral']}")]
check(all(r[2] == -1 for r in mitral), "suspended cards say so")
check(cards.rows(col, [123]) == {}, "a card that doesn't exist is left out")

print("render")
seen = []


def hook(text, card, kind):
    seen.append(kind)
    return text + f"<!--{kind}-->"


out = cards.render(col, ALL[0], prepare=lambda t: t, hook=hook, body_class=lambda o: f"card card{o + 1}")
check("Heart" in out["q"] and "Four" in out["a"], "both sides come back")
check(seen == ["previewQuestion", "previewAnswer"], "the card_will_show hook sees a preview of each side")
check(out["cls"] == "card card1", "the body class is the card's")
check(cards.render(col, 123, lambda t: t, lambda t, c, k: t, lambda o: "") is None, "a deleted card renders as None")
print("all passed")
