// The card table: one row per card, only the rows on screen in the page
// (plus a few either side), reused as you scroll, so a search with 50,000
// cards scrolls like one with 50. Moving the cursor changes two rows.

import type { Row, Status } from "./types.ts";

export const ROW_H = 30;
const OVERSCAN = 10;
/** Rows kept between the cursor and the list's edge (vim's 'scrolloff'). */
const SCROLLOFF = 3;
/** Placeholder text widths (%), so rows still loading read as rows. */
const SKELETON = [62, 47, 71, 55, 66, 42, 58, 74, 51, 63, 45, 69];

const STATES: Record<number, [label: string, cls: string]> = {
  [-1]: ["Suspended", "susp"],
  [-2]: ["Buried", "buried"],
  [-3]: ["Buried", "buried"],
  0: ["New", "new"],
  1: ["Learning", "learn"],
  3: ["Learning", "learn"],
  2: ["Review", "review"],
  4: ["Preview", "learn"],
};
const VERDICTS: Record<string, string> = { now: "Now", call: "Your call", wait: "Wait" };
const STATUS_WORD: Record<string, string> = { completed: "done", queued: "queued", later: "saved for later" };
/** Again in's chips, the systems a card will wait for first. */
const STATUS_ORDER: Record<string, number> = { none: 0, later: 1, queued: 2, completed: 3 };
/** Space between chips (.r-again's gap). */
const CHIP_GAP = 3;
type Again = [unit: string, status: Status, part: number | null];

/** Columns you can sort by (the facets the page has for every card). */
export type SortKey = "order" | "state" | "yield" | "banks" | "later" | "verdict" | "deck";
const HEADS: [label: string, key: SortKey | null, title: string][] = [
  ["#", "order", "Original order"],
  ["Card", null, "The note's text, clozes filled in"],
  ["Deck", "deck", "The card's deck (for a filtered deck, its home deck in brackets)"],
  ["State", "state", "New, learning, review, suspended or buried"],
  ["Yield", "yield", "AnKing's yield tag"],
  ["Q-bank", "banks", "UWorld (UW), AMBOSS (AM) and NBME (NB) questions tagged on the card"],
  ["Again in", "later", "Other systems the card is in (green: done; orange: queued)"],
  ["Verdict", "verdict", "Unsuspend now, or wait for the system it mostly belongs to"],
];

/** The columns' widths, in HEADS' order; Card and Deck share what the
 *  fixed ones leave, Deck a third as much. `min` is the least each needs. */
type ColKey = "num" | "text" | "deck" | "state" | "yield" | "bank" | "again" | "verdict";
const COLS: [key: ColKey, track: string, min: number][] = [
  ["num", "34px", 34],
  ["text", "minmax(200px, 1fr)", 200],
  ["deck", "minmax(72px, 0.35fr)", 72],
  ["state", "74px", 74],
  ["yield", "74px", 74],
  ["bank", "112px", 112],
  ["again", "150px", 150],
  ["verdict", "66px", 66],
];
/** Without a Verdict column, Again in gets its room. */
const AGAIN_WIDE = 224;
/** The columns a narrow table gives up, first to last, so the card beside
 *  it can be wider: the tags pane under the card shows all but Deck, and
 *  Deck is mostly the same for every card. #, Card, State and Verdict stay
 *  (--list-min in the stylesheet is what they need). */
const DROP: ColKey[] = ["deck", "again", "bank", "yield"];
/** Space between columns, and a row's padding and flag edge (.row). */
const COL_GAP = 8;
const ROW_PAD = 19;

export interface ListOptions {
  row(cid: number): Row | undefined;
  /** Rows the list is about to show and doesn't have yet. */
  need(cids: number[]): void;
  /** A row clicked; `extend` with Shift held. */
  pick(index: number, extend: boolean): void;
  sort(key: SortKey): void;
}

interface RowEl {
  el: HTMLDivElement;
  cells: HTMLSpanElement[];
  index: number;
  filled: boolean;
}

export class CardList {
  readonly scroller: HTMLDivElement;
  private head: HTMLDivElement;
  private sizer: HTMLDivElement;
  private live = new Map<number, RowEl>();
  private spare: RowEl[] = [];
  private ids: number[] = [];
  private cursorIndex = 0;
  private queued = 0;
  /** Placeholder rows (see skeleton): nothing to fetch or fill. */
  private placeholder = false;
  /** The selected rows, first and last (inclusive). */
  private range: [number, number] | null = null;
  private opts: ListOptions;
  private host: HTMLElement;
  /** Again in's heading, its width (0 until read) and the width of each
   *  chip by its text, so a row's chips are fitted without reading its
   *  layout (see fitChips). */
  private againHead!: HTMLSpanElement;
  private againWidth = 0;
  private chipWidths = new Map<string, number>();
  private measureBox: HTMLDivElement;
  /** The columns the table is too narrow for (see fitColumns). */
  private cut = new Set<ColKey>();
  private tracks = "";

  constructor(host: HTMLElement, opts: ListOptions) {
    this.opts = opts;
    this.host = host;
    // No Verdict column until the page knows a card here can have one.
    host.classList.add("no-verdict");
    this.measureBox = document.createElement("div");
    this.measureBox.className = "measure";
    this.head = document.createElement("div");
    this.head.className = "list-head";
    for (const [label, key, title] of HEADS) {
      const h = document.createElement("span");
      h.textContent = label;
      h.title = title;
      if (key === "later") this.againHead = h;
      if (key) {
        h.className = "sortable";
        h.dataset.sort = key;
        h.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.opts.sort(key);
        });
      }
      this.head.append(h);
    }
    this.scroller = document.createElement("div");
    this.scroller.className = "list-scroll";
    this.sizer = document.createElement("div");
    this.sizer.className = "list-sizer";
    this.scroller.append(this.sizer);
    host.append(this.head, this.scroller, this.measureBox);
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => {
      this.fitColumns();
      this.refit();
      this.render();
    }).observe(this.scroller);
    this.scroller.addEventListener("mousedown", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
      if (el) {
        e.preventDefault(); // keep the keys on the page, not the row
        this.opts.pick(Number(el.dataset.i), e.shiftKey);
      }
    });
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  /** Rows that fit on screen. */
  pageRows(): number {
    return Math.max(1, Math.floor(this.scroller.clientHeight / ROW_H));
  }

  /** Show the Verdict column, or give its room to Again in. */
  setVerdicts(show: boolean): void {
    if (this.host.classList.contains("no-verdict") !== show) return;
    this.host.classList.toggle("no-verdict", !show);
    this.fitColumns();
    this.refit();
  }

  /** As many columns as the table is wide enough for: the ones in DROP
   *  go, first to last, until the rest fit. Runs when the table's width
   *  changes, not as you move. */
  private fitColumns(): void {
    const room = this.scroller.clientWidth;
    if (!room) return; // the page is hidden, or the table is
    const verdict = !this.host.classList.contains("no-verdict");
    let cols = COLS.filter(([key]) => verdict || key !== "verdict");
    const width = (key: ColKey, min: number) => (key === "again" && !verdict ? AGAIN_WIDE : min);
    const need = () => cols.reduce((s, [key, , min]) => s + width(key, min), 0) + COL_GAP * (cols.length - 1) + ROW_PAD;
    const cut = new Set<ColKey>();
    for (const key of DROP) {
      if (need() <= room) break;
      cols = cols.filter(([k]) => k !== key);
      cut.add(key);
    }
    const tracks = cols.map(([key, track]) => (key === "again" && !verdict ? `${AGAIN_WIDE}px` : track)).join(" ");
    if (tracks === this.tracks) return;
    this.tracks = tracks;
    this.host.style.setProperty("--cols", tracks);
    // Again in's chips aren't drawn while it's gone; refit, after this,
    // draws them when it comes back (its width changes).
    this.cut = cut;
    for (const key of DROP) this.host.classList.toggle(`cut-${key}`, cut.has(key));
  }

  /** Again in changed width (the Verdict column came or went, or the
   *  page was shown): fit the rows' chips again. */
  private refit(): void {
    const w = this.againHead.clientWidth;
    if (w === this.againWidth) return;
    this.againWidth = w;
    for (const r of this.live.values()) if (r.filled) this.fill(r);
  }

  /** A chip's width, measured once for each text. */
  private chipWidth(cls: string, text: string): number {
    const key = `${cls}|${text}`;
    let w = this.chipWidths.get(key);
    if (w === undefined) {
      const c = document.createElement("span");
      c.className = cls;
      c.textContent = text;
      this.measureBox.append(c);
      w = c.getBoundingClientRect().width;
      c.remove();
      if (w) this.chipWidths.set(key, w); // 0 while the page is hidden
    }
    return w;
  }

  /** The systems a card is also in, the ones you haven't done first, as
   *  many whole chips as fit; the rest go in a "+N" that names them. */
  private fitChips(again: Again[]): HTMLSpanElement[] {
    const sorted = [...again].sort((x, y) => STATUS_ORDER[x[1] ?? "none"] - STATUS_ORDER[y[1] ?? "none"]);
    const chips = sorted.map(([unit, status, part]) => chip(unit, status, part));
    const room = this.againWidth || (this.againWidth = this.againHead.clientWidth);
    if (!room) return chips;
    const widths = sorted.map(([unit]) => this.chipWidth("ag", unit));
    const span = (n: number) => widths.slice(0, n).reduce((s, w) => s + w + CHIP_GAP, -CHIP_GAP);
    if (span(chips.length) <= room) return chips;
    let n = chips.length - 1;
    while (n > 0 && span(n) + CHIP_GAP + this.chipWidth("ag more", `+${chips.length - n}`) > room) n--;
    const more = document.createElement("span");
    more.className = "ag more";
    more.textContent = `+${chips.length - n}`;
    more.title = chips.slice(n).map((c) => c.title).join("\n");
    return [...chips.slice(0, n), more];
  }

  /** Show which column the list is sorted by. */
  setSort(key: SortKey, dir: 1 | -1): void {
    for (const h of this.head.querySelectorAll<HTMLElement>("[data-sort]")) {
      const on = h.dataset.sort === key && key !== "order";
      h.classList.toggle("sorted", on);
      h.dataset.dir = on ? (dir > 0 ? "up" : "down") : "";
    }
  }

  setIds(ids: number[], cursor: number, placeholder = false): void {
    this.placeholder = placeholder;
    this.range = null;
    this.ids = ids;
    this.cursorIndex = cursor;
    this.sizer.style.height = `${ids.length * ROW_H}px`;
    for (const r of this.live.values()) this.recycle(r);
    this.live.clear();
    this.scroller.scrollTop = Math.max(0, cursor * ROW_H - SCROLLOFF * ROW_H);
    this.render();
  }

  /** `n` placeholder rows, while the next view's cards are on their way. */
  skeleton(n: number): void {
    this.setIds(new Array<number>(n).fill(0), -1, true);
  }

  /** Mark the selected rows (null for none). */
  setRange(range: [number, number] | null): void {
    this.range = range;
    for (const [i, r] of this.live) r.el.classList.toggle("sel", this.selected(i));
  }

  private selected(i: number): boolean {
    return !!this.range && i >= this.range[0] && i <= this.range[1];
  }

  setCursor(index: number): void {
    this.live.get(this.cursorIndex)?.el.classList.remove("cur");
    this.cursorIndex = index;
    this.live.get(index)?.el.classList.add("cur");
    this.keepInView();
  }

  /** New rows arrived, or rows changed (force): fill in what's on screen,
   *  asking for any it doesn't have. */
  refresh(force = false): void {
    for (const r of this.live.values()) if (force || !r.filled) this.fill(r);
    if (force) this.render();
  }

  private keepInView(): void {
    const s = this.scroller;
    const top = this.cursorIndex * ROW_H;
    const margin = Math.min(SCROLLOFF, Math.floor((this.pageRows() - 1) / 2)) * ROW_H;
    let to = s.scrollTop;
    if (top - margin < to) to = top - margin;
    else if (top + ROW_H + margin > to + s.clientHeight) to = top + ROW_H + margin - s.clientHeight;
    if (to !== s.scrollTop) {
      s.scrollTop = Math.max(0, to);
      this.render(); // now, so the cursor's row is there in this frame
    }
  }

  private schedule(): void {
    if (this.queued) return;
    this.queued = requestAnimationFrame(() => {
      this.queued = 0;
      this.render();
    });
  }

  private render(): void {
    const n = this.ids.length;
    const top = this.scroller.scrollTop;
    const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
    const last = Math.min(n - 1, Math.ceil((top + this.scroller.clientHeight) / ROW_H) + OVERSCAN);
    for (const [i, r] of this.live) {
      if (i < first || i > last) {
        this.live.delete(i);
        this.recycle(r);
      }
    }
    const missing: number[] = [];
    for (let i = first; i <= last; i++) {
      let r = this.live.get(i);
      if (!r) {
        r = this.spare.pop() ?? this.make();
        r.index = i;
        r.el.dataset.i = String(i);
        r.el.style.transform = `translateY(${i * ROW_H}px)`;
        r.cells[0].textContent = this.placeholder ? "" : String(i + 1);
        r.el.style.setProperty("--sk", `${SKELETON[i % SKELETON.length]}%`);
        this.live.set(i, r);
        this.fill(r);
        this.sizer.append(r.el);
      }
      if (!r.filled && !this.placeholder) missing.push(this.ids[i]);
    }
    if (missing.length) this.opts.need(missing);
  }

  private make(): RowEl {
    const el = document.createElement("div");
    el.className = "row";
    const cells = ["r-num num", "r-text", "r-deck", "r-state", "r-yield", "r-bank num", "r-again", "r-verdict"].map((cls) => {
      const c = document.createElement("span");
      c.className = cls;
      el.append(c);
      return c;
    });
    return { el, cells, index: -1, filled: false };
  }

  private recycle(r: RowEl): void {
    r.el.remove();
    r.filled = false;
    this.spare.push(r);
  }

  private fill(r: RowEl): void {
    const row = this.placeholder ? undefined : this.opts.row(this.ids[r.index]);
    const [, text, deck, state, yld, bank, again, verdict] = r.cells;
    const cls = ["row"];
    if (r.index === this.cursorIndex) cls.push("cur");
    if (this.selected(r.index)) cls.push("sel");
    if (!row) {
      r.filled = false;
      cls.push("loading");
      for (const c of r.cells.slice(1)) c.replaceChildren();
      r.el.className = cls.join(" ");
      return;
    }
    const [label, stateCls] = STATES[row.q] ?? ["", ""];
    if (row.f) cls.push(`flag-${row.f}`);
    text.textContent = row.t || "(empty)";
    text.title = row.k ? `${row.t}\n${row.k}` : row.t;
    deck.textContent = row.o ? `${leaf(row.d)} (${leaf(row.o)})` : leaf(row.d);
    deck.title = row.o ? `${row.d} (${row.o})` : (row.d ?? "");
    state.textContent = label;
    state.className = `r-state ${stateCls}`;
    yld.textContent = row.y ?? "";
    yld.className = `r-yield${row.y === "High" ? " high" : ""}`;
    bank.textContent = row.b ?? "";
    bank.title = row.b ?? "";
    again.replaceChildren(...(this.cut.has("again") ? [] : this.fitChips(row.a ?? [])));
    verdict.textContent = row.v ? VERDICTS[row.v] : "";
    verdict.className = `r-verdict${row.v ? ` v-${row.v}` : ""}`;
    verdict.title = row.r ?? "";
    r.el.className = cls.join(" ");
    r.filled = true;
  }
}

/** A deck's own name, without its parents': "AnKing::Step 1" -> "Step 1". */
function leaf(name: string | undefined): string {
  if (!name) return "";
  const i = name.lastIndexOf("::");
  return i < 0 ? name : name.slice(i + 2);
}

/** A system the card is also in, coloured by Stepwise's status there;
 * the tooltip says how much of the system is done. */
export function chip(unit: string, status: Status, part: number | null = null): HTMLSpanElement {
  const c = document.createElement("span");
  c.className = `ag${status ? ` s-${status}` : ""}`;
  c.textContent = unit;
  const word = status ? STATUS_WORD[status] : part ? "not done yet" : "not started";
  c.title = `${unit}: ${word}${part === null ? "" : ` (${part}% of its topics done)`}`;
  return c;
}
