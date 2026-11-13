"""Reading a card's tags against a topic: units, the tags pane's order, and
the verdict (unsuspend now, or wait). AnKing-style tags, with a stand-in
for what Stepwise tells Skim."""

from harness import check
from skim.tags import Analyzer, Context, topics_from_search, unit_of

S1 = "#AK_Step1_v12"

print("units")
for path, unit in [
    (["22_Repro", "05_Breast"], "Repro"),
    (["07_Cardiovascular", "05_Pharmacology"], "Cardio"),
    (["03_Pharmacology", "22_Cardiovascular_(new)"], "Cardio"),  # a discipline takes the system under it
    (["07_Antimicrobials", "05_Antifungals"], "Micro"),
    (["14_Infectious_Disease", "04_Fungi"], "Micro"),
    (["11_Musculoskeletal_Skin_and_Connective_Tissue"], "MSK"),
    (["12_Neurology_and_Special_Senses"], "Neuro"),
    (["Reproductive", "Pharmacology"], "Repro"),
    (["Hematology_and_Oncology"], "HemeOnc"),
    (["05_Pharm", "01_Pharmacokinetics"], "Pharm"),
    (["08_Antineoplastics"], None),
]:
    check(unit_of(path) == unit, f"{' › '.join(path)} is {unit}")

print("topics from a search")
check(topics_from_search('"tag:#AK_Step1_v12::#B&B::06\\_Cardio*"') == ["#AK_Step1_v12::#B&B::06_Cardio"],
      "a tag search (as Stepwise writes them) names its topic")
check(topics_from_search("heart failure") == [], "other searches don't")


class Plan(Context):
    """Stepwise, as Skim sees it: pins, roots and statuses."""

    def __init__(self, statuses=None):
        self.statuses = statuses or {}

    def pinned(self):
        return [f"{S1}::#B&B", f"{S1}::#Bootcamp", f"{S1}::#FirstAid", f"{S1}::#SketchyPharm", f"{S1}::^Systems"]

    def roots(self):
        return [S1, "#AK_Step2_v12"]

    def status(self, tag):
        for prefix, s in self.statuses.items():
            if tag.lower().startswith(prefix.lower()):
                return s
        return None


TOPIC = f"{S1}::#SketchyPharm::07_Antimicrobials"
KETO = [
    f"{TOPIC}::05_Antifungals::02_Azoles",
    f"{S1}::#B&B::09_Endocrinology::02_Adrenals::02_Cushing_Syndrome",
    f"{S1}::#B&B::14_Infectious_Disease::04_Fungi::04_Antifungal_Drugs::Extra",
    f"{S1}::#B&B::22_Repro::05_Breast::01_Breast_Tissue",
    f"{S1}::#Bootcamp::Microbiology::37_Antifungals::02_Azoles",
    f"{S1}::#Bootcamp::Reproduction::06_Pharmacology::04_Antiandrogens",
    f"{S1}::#FirstAid::15_Repro::05_Pharm::13_Antiandrogens::*Ketoconazole",
    f"{S1}::#FirstAid::08_Endocrine::02_Physiology",
    f"{S1}::^Systems::Reproductive::Pharmacology",
    f"{S1}::#Pixorize::04_Microbiology::02_Antifungals::04_Azoles",  # not pinned
    f"{S1}::#UWorld::Step::12345",
    f"{S1}::#UWorld::Step::12346",
    f"{S1}::#AMBOSS::Step1::ab12",
    f"{S1}::#Low/HighYield::4-LowerYield",
    "#AK_Other::AnKing_Image::Mujeeb::Azoles",
]

print("a card that mostly belongs elsewhere")
an = Analyzer([TOPIC], Plan(), 0.5)
f = an.card(KETO, suspended=True)
check(f["verdict"] == "wait", f"it could wait ({f['reason']})")
check("Endocrine" in f["reason"] and "Repro" in f["reason"], "for Endocrine and Repro")
check([u for u, _ in f["again"]] == ["Endocrine", "Repro"], "Again in: Endocrine, Repro")
check(f["level"] == 4 and f["banks"] == {"UWorld": 2, "AMBOSS": 1}, "yield and question banks read")
p = an.pane(f)
labels = [g["label"] for g in p["groups"]]
check(labels[0] == "SketchyPharm" and p["groups"][0]["here"], "the resource you're on comes first")
check(labels[1:] == ["B&B", "Bootcamp", "FirstAid", "^Systems"], f"then your pinned ones, in Stepwise's order ({labels})")
bb = p["groups"][1]["topics"]
check(bb[0]["again"] and bb[0]["unit"] in ("Endocrine", "Repro"), "a resource's places in other systems come first")
check(any(t["extra"] and not t["again"] for t in bb), "Infectious Disease (Micro, as here) isn't an 'again', and shows Extra")
check(any("Pixorize" in t for t in p["more"]) and any("AK_Other" in t for t in p["more"]),
      "unpinned resources and AnKing's own tags fold into 'more'")
check(p["yield"] == "Lower" and p["banks"][0] == ("UWorld", 2), "the pane has its yield and banks")

print("statuses change it")
done = Analyzer([TOPIC], Plan({f"{S1}::#B&B::09_Endocrinology": "completed", f"{S1}::#FirstAid::08_Endocrine": "completed",
                               f"{S1}::#B&B::22_Repro": "queued", f"{S1}::#Bootcamp::Reproduction": "queued",
                               f"{S1}::#FirstAid::15_Repro": "queued", f"{S1}::^Systems::Reproductive": "queued"}), 0.5)
f2 = done.card(KETO, suspended=True)
check(f2["verdict"] == "now", f"with Endocrine done and Repro queued, it's now ({f2['reason']})")
check(dict(f2["again"]) == {"Endocrine": "completed", "Repro": "queued"}, "and Again in says so")
later = Analyzer([TOPIC], Plan({f"{S1}::#B&B::22_Repro": "later"}), 0.5)
check(later.card(KETO, suspended=True)["verdict"] == "wait", "a system saved for later still counts as later")

print("a card that mostly belongs here")
CEF = [
    f"{TOPIC}::01_Cell_Wall::03_Cephalosporins",
    f"{S1}::#B&B::14_Infectious_Disease::02_Antibiotics::01_Beta_Lactams",
    f"{S1}::#Bootcamp::Microbiology::32_Neisseria",
    f"{S1}::#B&B::16_Neuro::05_Meningitis",
]
f3 = an.card(CEF, suspended=True)
check(f3["verdict"] == "now" and "Neuro" in f3["reason"], f"now, also in Neuro ({f3['reason']})")
check(an.card(CEF, suspended=False)["verdict"] is None, "only suspended cards get a verdict")

print("thresholds and overrides")
check(Analyzer([TOPIC], Plan(), 0.8).card(CEF, suspended=True)["verdict"] == "wait",
      "a higher threshold makes more cards wait")
high = KETO[:-2] + [f"{S1}::#Low/HighYield::1-HighYield"]
check(an.card(high, suspended=True)["verdict"] == "call", "high yield but mostly elsewhere: your call")
extra = [f"{TOPIC}::05_Antifungals::Extra", f"{S1}::#Bootcamp::Microbiology::37_Antifungals",
         f"{S1}::#B&B::22_Repro::05_Breast"]
f4 = an.card(extra, suspended=True)
check(f4["verdict"] == "wait" and "Extra" in f4["reason"], f"tagged here only as Extra leans to waiting ({f4['reason']})")
only = [f"{TOPIC}::05_Antifungals::03_Echinocandins", f"{S1}::#Bootcamp::Microbiology::37_Antifungals"]
check(an.card(only, suspended=True)["reason"] == "Only here", "a card nowhere else: now, only here")

print("the same resource in two steps")
two = KETO + [f"#AK_Step2_v12::#B&B::08_Infectious_Disease::02_Fungi"]
bare2 = Analyzer([TOPIC], None, 0.5)
labels2 = [g["label"] for g in bare2.pane(bare2.card(two))["groups"]]
check("B&B (Step 1)" in labels2 and "B&B (Step 2)" in labels2, f"say which step ({labels2})")

print("without Stepwise")
bare = Analyzer([TOPIC], None, 0.5)
f5 = bare.card(KETO, suspended=True)
check(f5["verdict"] == "wait", "still judged, every resource counting")
check(len(bare.pane(f5)["groups"]) >= 6, "and every resource shows")
check(Analyzer([], Plan(), 0.5).card(KETO, suspended=True)["verdict"] is None, "no topic, no verdict")
print("all passed")
