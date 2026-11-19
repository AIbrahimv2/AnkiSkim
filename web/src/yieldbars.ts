// A card's yield as signal bars: four for High, three for Fairly High, two
// for Lower, one for Low, so it reads at a glance. The bars are made once
// (each list row keeps its own); showing a yield only sets `data-y` on the
// element around them, and the stylesheet fills that many.

/** Bars for each of AnKing's yield labels (tags.py's YIELD_LABELS). */
const BARS: Record<string, number> = { High: 4, "Fairly High": 3, Lower: 2, Low: 1 };

export function yieldBars(): HTMLSpanElement {
  const b = document.createElement("span");
  b.className = "ybars";
  for (let i = 0; i < 4; i++) b.append(document.createElement("i"));
  return b;
}

/** How many bars a yield fills (0 for none). */
export function barsOf(label: string | null | undefined): string {
  return String((label && BARS[label]) || 0);
}
