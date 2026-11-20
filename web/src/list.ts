// The card table: one row per card, only the rows on screen in the page
// (plus a few either side), reused as you scroll, so a search with 50,000
// cards scrolls like one with 50. Moving the cursor changes two rows, and
// a row read again (the cards changed) changes only the cells that differ:
// suspending a card redraws its State and Verdict, nothing else.
//
// Its columns are COLUMNS': # and Card always, the others as you turn them
// on and off (Columns, in the ⋯ menu or a right-click on the titles), less
// the ones the table is too narrow for. The rows are made anew only when
// that changes, not as you move.

import type { ExtraKey, Row, Status } from "./types.ts";
import { barsOf, yieldBars } from "./yieldbars.ts";

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
const VERDICTS: Record<string, string> = { now: "Now", call: "Your Call", wait: "Wait" };
const STATUS_WORD: Record<string, string> = { completed: "done", queued: "queued", later: "saved for later" };
/** Again in's chips, the systems a card will wait for first. */
const STATUS_ORDER: Record<string, number> = { none: 0, later: 1, queued: 2, completed: 3 };
/** Space between chips (.r-again's gap). */
const CHIP_GAP = 3;
type Again = [unit: string, status: Status, part: number | null];

/** Columns you can sort by: the facets the page has for every card, and
 *  the scheduling columns, whose values come when you sort by one. */
export type SortKey = "order" | "state" | "yield" | "banks" | "later" | "verdict" | "deck" | ExtraKey;
export type ColKey = "num" | "text" | "deck" | "state" | ExtraKey | "yield" | "bank" | "again" | "verdict";

interface Column {
  key: ColKey;
  /** Its title, in the table and in Columns' menu. */
  label: string;
  /** What its title says when you hover it. */
  title: string;
  sort: SortKey | null;
  /** Its track in the grid, and the least width it needs. */
  track: string;
  min: number;
  cls: string;
  /** Shown unless you turn it off (true), or once you turn it on (false).
   *  # and Card always are. */
  on?: boolean;
  /** Only with FSRS (true) or without it (false). */
  fsrs?: boolean;
}

/** The table's columns, in order; Card and Deck share what the fixed ones
 *  leave, Deck a third as much. A fixed one is as wide as its title with
 *  the sort arrow after it. The scheduling ones (Due to Lapses) come
 *  after State; Retrievability is on by default, the rest are there to
 *  turn on. */
export const COLUMNS: Column[] = [
  { key: "num", label: "#", title: "Original order", sort: "order", track: "34px", min: 34, cls: "r-num num" },
  { key: "text", label: "Card", title: "The note's text, clozes filled in", sort: null, track: "minmax(200px, 1fr)", min: 200, cls: "r-text" },
  { key: "deck", label: "Deck", title: "The card's deck (for a filtered deck, its home deck in brackets)", sort: "deck", track: "minmax(72px, 0.35fr)", min: 72, cls: "r-deck", on: true },
  { key: "state", label: "State", title: "New, learning, review, suspended or buried", sort: "state", track: "74px", min: 74, cls: "r-state", on: true },
  { key: "due", label: "Due", title: "When it's due next (orange: late)", sort: "due", track: "68px", min: 68, cls: "r-due num", on: false },
  { key: "ivl", label: "Interval", title: "Its interval: the time between its last review and when it's due", sort: "ivl", track: "56px", min: 56, cls: "r-ivl num", on: false },
  { key: "ease", label: "Ease", title: "Its ease (SM-2)", sort: "ease", track: "46px", min: 46, cls: "r-ease num", on: false, fsrs: false },
  { key: "ret", label: "Retrievability", title: "The chance you'd recall it now, as FSRS reckons it (orange: below the retention it's scheduled for)", sort: "ret", track: "88px", min: 88, cls: "r-ret num", on: true, fsrs: true },
  { key: "dif", label: "Difficulty", title: "How hard the card is for you, as FSRS reckons it (0 to 100%)", sort: "dif", track: "64px", min: 64, cls: "r-dif num", on: false, fsrs: true },
  { key: "stab", label: "Stability", title: "How long it takes to fall to 90% retrievability (FSRS)", sort: "stab", track: "60px", min: 60, cls: "r-stab num", on: false, fsrs: true },
  { key: "reps", label: "Reviews", title: "How many times you've reviewed it", sort: "reps", track: "58px", min: 58, cls: "r-reps num", on: false },
  { key: "lapses", label: "Lapses", title: "How many times you've forgotten it after learning it", sort: "lapses", track: "52px", min: 52, cls: "r-lapses num", on: false },
  { key: "yield", label: "Yield", title: "AnKing's yield tag", sort: "yield", track: "92px", min: 92, cls: "r-yield", on: true },
  { key: "bank", label: "Q-bank", title: "UWorld (UW), AMBOSS (AM) and NBME (NB) questions tagged on the card", sort: "banks", track: "112px", min: 112, cls: "r-bank num", on: true },
  { key: "again", label: "Again in", title: "Other systems the card is in (green: done; orange: queued)", sort: "later", track: "150px", min: 150, cls: "r-again", on: true },
  { key: "verdict", label: "Verdict", title: "Unsuspend now, or wait for the system it mostly belongs to", sort: "verdict", track: "66px", min: 66, cls: "r-verdict", on: true },
];
const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

/** Whether a column is on when you haven't turned it on or off. */
export function onByDefault(key: ColKey): boolean {
  return BY_KEY.get(key)?.on !== false;
}

/** The columns in the order they're shown by default. */
export const DEFAULT_ORDER: readonly ColKey[] = COLUMNS.map((c) => c.key);

/** Every column, in the order you've dragged them into (`saved`, as kept
 *  with the layout): # first, then the ones you've placed, and any you
 *  haven't (a column added since) after the column it follows by default.
 *  Keys that aren't a column's are left out. */
export function fullOrder(saved: readonly string[]): ColKey[] {
  const out: ColKey[] = [];
  for (const k of saved) if (BY_KEY.has(k as ColKey) && k !== "num" && !out.includes(k as ColKey)) out.push(k as ColKey);
  DEFAULT_ORDER.forEach((key, i) => {
    if (key === "num" || out.includes(key)) return;
    const before = DEFAULT_ORDER.slice(0, i).findLast((b) => out.includes(b));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, key);
  });
  return ["num", ...out];
}

/** `order` with `key` moved to just before `before` (null: to the end). */
export function moveKey(order: readonly ColKey[], key: ColKey, before: ColKey | null): ColKey[] {
  const out = order.filter((k) => k !== key);
  out.splice(before === null ? out.length : out.indexOf(before), 0, key);
  return out;
}

/** Without a Verdict column, Again in gets its room. */
const AGAIN_WIDE = 224;
/** The columns a narrow table gives up, first to last, so the card beside
 *  it can be wider: Deck is mostly the same for every card, and the tags
 *  pane under the card shows Again in, Q-bank and Yield; then the
 *  scheduling ones you've turned on, from the right. #, Card, State and
 *  Verdict stay (--list-min in the stylesheet is what they need). */
const DROP: ColKey[] = ["deck", "again", "bank", "yield", "lapses", "reps", "stab", "dif", "ease", "ivl", "due", "ret"];
/** Space between columns, and a row's padding and flag edge (.row). */
const COL_GAP = 8;
const ROW_PAD = 19;
/** How far a title moves before it's a drag, not a click. */
const DRAG_START = 5;

export interface ListOptions {
  row(cid: number): Row | undefined;
  /** The row a card had before the cards changed: shown while `need`
   *  gets its new one, instead of a placeholder. */
  oldRow(cid: number): Row | undefined;
  /** Rows the list is about to show and doesn't have yet. */
  need(cids: number[]): void;
  /** A row clicked; `extend` with Shift held. */
  pick(index: number, extend: boolean): void;
  sort(key: SortKey): void;
  /** The titles right-clicked: open Columns' menu there. */
  columnsMenu(x: number, y: number): void;
  /** A title dragged to a new place: the columns' new order. */
  reorder(order: ColKey[]): void;
}

interface RowEl {
  el: HTMLDivElement;
  /** A cell for each column shown, in their order (see build). */
  cells: HTMLSpanElement[];
  /** The yield's word, after its bars (made once, in make). */
  yieldText: HTMLSpanElement | null;
  index: number;
  /** It shows its card's row as it is now (not an old one, or none). */
  filled: boolean;
  /** The row its cells show, whichever card's (see fill). */
  drawn: Row | undefined;
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
  private againHead: HTMLSpanElement | null = null;
  private againWidth = 0;
  private chipWidths = new Map<string, number>();
  private measureBox: HTMLDivElement;
  /** The columns shown, in order (see fitColumns), and as a key. */
  private cols: Column[] = [];
  private colsKey = "";
  /** The columns you've turned on or off (the rest are as COLUMNS has
   *  them), whether the collection uses FSRS, and whether a card here can
   *  have a verdict (none until the page knows). */
  private choice: Record<string, boolean> = {};
  /** Every column, in your order (see setOrder). */
  private order: ColKey[] = [...DEFAULT_ORDER];
  /** Where a dragged title would go (see dragTitle). */
  private dropMark: HTMLDivElement;
  private fsrs = false;
  private verdicts = false;
  private sortKey: SortKey = "order";
  private sortDir: 1 | -1 = 1;

  constructor(host: HTMLElement, opts: ListOptions) {
    this.opts = opts;
    this.host = host;
    this.measureBox = document.createElement("div");
    this.measureBox.className = "measure";
    this.head = document.createElement("div");
    this.head.className = "list-head";
    this.head.addEventListener("pointerdown", (e) => this.dragTitle(e));
    this.head.addEventListener("contextmenu", (e) => {
      e.preventDefault(); // not the web view's own menu
      this.opts.columnsMenu(e.clientX, e.clientY);
    });
    this.scroller = document.createElement("div");
    this.scroller.className = "list-scroll";
    this.sizer = document.createElement("div");
    this.sizer.className = "list-sizer";
    this.scroller.append(this.sizer);
    this.dropMark = document.createElement("div");
    this.dropMark.className = "col-drop";
    this.dropMark.hidden = true;
    host.append(this.head, this.scroller, this.measureBox, this.dropMark);
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
    this.fitColumns();
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  /** Rows that fit on screen. */
  pageRows(): number {
    return Math.max(1, Math.floor(this.scroller.clientHeight / ROW_H));
  }

  /** Show the Verdict column (unless you've turned it off), or give its
   *  room to Again in. */
  setVerdicts(show: boolean): void {
    if (this.verdicts === show) return;
    this.verdicts = show;
    this.fitColumns();
    this.refit();
  }

  /** The collection schedules with FSRS: its columns, not Ease. */
  setFsrs(on: boolean): void {
    if (this.fsrs === on) return;
    this.fsrs = on;
    this.fitColumns();
    this.refit();
  }

  /** The columns you've turned on or off. */
  setChoice(choice: Record<string, boolean>): void {
    this.choice = choice;
    this.fitColumns();
    this.refit();
  }

  /** The order you've dragged the columns into, as saved (empty: as
   *  they are by default). */
  setOrder(saved: readonly string[]): void {
    this.order = fullOrder(saved);
    this.fitColumns();
    this.refit();
  }

  /** Whether the columns are in another order than their own. */
  reordered(): boolean {
    return this.order.join() !== DEFAULT_ORDER.join();
  }

  /** The columns Columns' menu offers, in the table's order, and whether
   *  each is on: all but # and Card, with FSRS's or Ease, whichever the
   *  collection uses. */
  choices(): { key: ColKey; label: string; on: boolean }[] {
    return this.columns().filter((c) => c.on !== undefined && this.offered(c)).map((c) => ({
      key: c.key,
      label: c.label,
      on: this.isOn(c),
    }));
  }

  /** Whether a column that sorts by `key` is on (# always is). */
  sortable(key: SortKey): boolean {
    return COLUMNS.some((c) => c.sort === key && this.offered(c) && this.isOn(c));
  }

  /** Every column, in your order. */
  private columns(): Column[] {
    return this.order.map((k) => BY_KEY.get(k)!);
  }

  private offered(c: Column): boolean {
    return c.fsrs === undefined || c.fsrs === this.fsrs;
  }

  private isOn(c: Column): boolean {
    return c.on === undefined || (this.choice[c.key] ?? c.on);
  }

  /** As many of the columns that are on as the table is wide enough for:
   *  the ones in DROP go, first to last, until the rest fit. Runs when the
   *  table's width or the columns change, not as you move; the header and
   *  rows are made anew only if what shows changes. */
  private fitColumns(): void {
    const room = this.scroller.clientWidth;
    // Hidden (the page, or the table): what's there stays until it shows.
    if (!room && this.colsKey) return;
    let cols = this.columns().filter((c) => this.offered(c) && this.isOn(c) && (c.key !== "verdict" || this.verdicts));
    const verdict = cols.some((c) => c.key === "verdict");
    const width = (c: Column) => (c.key === "again" && !verdict ? AGAIN_WIDE : c.min);
    const need = () => cols.reduce((s, c) => s + width(c), 0) + COL_GAP * (cols.length - 1) + ROW_PAD;
    if (room) {
      for (const key of DROP) {
        if (need() <= room) break;
        cols = cols.filter((c) => c.key !== key);
      }
    }
    const key = cols.map((c) => c.key).join(" ");
    if (key === this.colsKey) return;
    this.colsKey = key;
    this.cols = cols;
    this.host.style.setProperty("--cols", cols.map((c) => (c.key === "again" && !verdict ? `${AGAIN_WIDE}px` : c.track)).join(" "));
    this.build();
  }

  /** The header and the rows for the columns shown: the rows are made
   *  anew with their cells, and filled from what's kept. */
  private build(): void {
    this.againHead = null;
    this.againWidth = 0;
    this.head.replaceChildren(
      ...this.cols.map((c) => {
        const h = document.createElement("span");
        h.textContent = c.label;
        h.title = c.key === "num" ? c.title : `${c.title}\n\nClick to sort by it, drag to move it; right-click to choose columns.`;
        h.dataset.col = c.key;
        if (c.key === "again") this.againHead = h;
        if (c.sort) {
          h.className = "sortable";
          h.dataset.sort = c.sort;
        }
        return h;
      }),
    );
    this.setSort(this.sortKey, this.sortDir);
    for (const r of this.live.values()) r.el.remove();
    this.live.clear();
    this.spare = [];
    this.render();
  }

  /** A title pressed: a click sorts by its column; dragged left or right,
   *  it moves the column (# stays first), with a line where it would go. */
  private dragTitle(e: PointerEvent): void {
    const h = (e.target as HTMLElement).closest<HTMLElement>("[data-col]");
    if (!h || e.button !== 0) return;
    e.preventDefault(); // the keys stay on the page
    const key = h.dataset.col as ColKey;
    const app = this.host.closest(".app");
    const x0 = e.clientX;
    let moving = false;
    let before: ColKey | null | undefined; // where it goes; undefined: nowhere new
    try {
      this.head.setPointerCapture(e.pointerId);
    } catch {
      // not a real pointer (a test's): its moves come to the titles anyway
    }
    const move = (m: PointerEvent) => {
      if (!moving) {
        if (key === "num" || Math.abs(m.clientX - x0) < DRAG_START) return;
        moving = true;
        h.classList.add("moving");
        app?.classList.add("dragging", "drag-col");
      }
      before = this.dropBefore(m.clientX, key);
    };
    const end = (done: boolean) => {
      this.head.removeEventListener("pointermove", move);
      this.head.removeEventListener("pointerup", up);
      this.head.removeEventListener("pointercancel", cancel);
      this.dropMark.hidden = true;
      h.classList.remove("moving");
      app?.classList.remove("dragging", "drag-col");
      if (!done) return;
      if (!moving) {
        if (h.dataset.sort) this.opts.sort(h.dataset.sort as SortKey);
      } else if (before !== undefined) {
        const order = moveKey(this.order, key, before);
        if (order.join() === this.order.join()) return;
        this.order = order;
        this.fitColumns();
        this.refit();
        this.opts.reorder(order);
      }
    };
    const up = () => end(true);
    const cancel = () => end(false);
    this.head.addEventListener("pointermove", move);
    this.head.addEventListener("pointerup", up);
    this.head.addEventListener("pointercancel", cancel);
  }

  /** The column a title dragged to `x` would go before (null: after the
   *  last one shown, undefined: where it is), with the line drawn there.
   *  Never before #. */
  private dropBefore(x: number, key: ColKey): ColKey | null | undefined {
    const titles = [...this.head.children] as HTMLElement[];
    let i = 1;
    const mid = (t: HTMLElement) => {
      const r = t.getBoundingClientRect();
      return r.left + r.width / 2;
    };
    while (i < titles.length && x > mid(titles[i])) i++;
    const at = titles[i]?.dataset.col as ColKey | undefined;
    // Before itself or the one after it: it stays where it is.
    const from = titles.findIndex((t) => t.dataset.col === key);
    const host = this.host.getBoundingClientRect();
    const head = this.head.getBoundingClientRect();
    const edge = i < titles.length
      ? titles[i].getBoundingClientRect().left - COL_GAP / 2
      : titles[titles.length - 1].getBoundingClientRect().right + COL_GAP / 2;
    this.dropMark.style.left = `${edge - host.left}px`;
    this.dropMark.style.top = `${head.top - host.top}px`;
    this.dropMark.style.height = `${head.height + this.scroller.clientHeight}px`;
    this.dropMark.hidden = i === from || i === from + 1;
    if (i === from || i === from + 1) return undefined;
    return at ?? null;
  }

  /** Again in changed width (the Verdict column came or went, or the
   *  page was shown): fit the rows' chips again. */
  private refit(): void {
    if (!this.againHead) return;
    const w = this.againHead.clientWidth;
    if (w === this.againWidth) return;
    this.againWidth = w;
    for (const r of this.live.values()) {
      if (!r.drawn) continue;
      r.drawn = undefined; // every cell again, the chips with them
      this.fill(r);
    }
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
    const room = this.againWidth || (this.againWidth = this.againHead?.clientWidth ?? 0);
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
    this.sortKey = key;
    this.sortDir = dir;
    for (const h of this.head.querySelectorAll<HTMLElement>("[data-sort]")) {
      const on = h.dataset.sort === key && key !== "order";
      h.classList.toggle("sorted", on);
      h.dataset.dir = on ? (dir > 0 ? "up" : "down") : "";
    }
  }

  /** Show these cards, the cursor on `cursor`, scrolled to it; with
   *  `stay`, scrolled where it is (setCursor brings the cursor into view). */
  setIds(ids: number[], cursor: number, placeholder = false, stay = false): void {
    this.placeholder = placeholder;
    this.range = null;
    this.ids = ids;
    this.cursorIndex = cursor;
    this.sizer.style.height = `${ids.length * ROW_H}px`;
    for (const r of this.live.values()) this.recycle(r);
    this.live.clear();
    if (!stay) this.scroller.scrollTop = Math.max(0, cursor * ROW_H - SCROLLOFF * ROW_H);
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
    let yieldText: HTMLSpanElement | null = null;
    const cells = this.cols.map((col) => {
      const c = document.createElement("span");
      c.className = col.cls;
      if (col.key === "yield") {
        yieldText = document.createElement("span");
        c.append(yieldBars(), yieldText);
      }
      el.append(c);
      return c;
    });
    return { el, cells, yieldText, index: -1, filled: false, drawn: undefined };
  }

  private recycle(r: RowEl): void {
    r.el.remove();
    r.filled = false;
    this.spare.push(r);
  }

  /** Show the row's card: its row as it is now, or the one it had while
   *  that comes, or a placeholder. Only the cells that differ from what
   *  the element shows are written (a reused element shows another card's
   *  row: most cells differ; a card read again: few or none do). */
  private fill(r: RowEl): void {
    const cid = this.ids[r.index];
    const now = this.placeholder ? undefined : this.opts.row(cid);
    const row = now ?? (this.placeholder ? undefined : this.opts.oldRow(cid));
    const cls = ["row"];
    if (r.index === this.cursorIndex) cls.push("cur");
    if (this.selected(r.index)) cls.push("sel");
    r.filled = !!now;
    if (!row) {
      cls.push("loading");
      if (r.drawn) {
        this.cols.forEach((col, i) => {
          const c = r.cells[i];
          if (col.key === "num") return;
          if (col.key !== "yield") c.replaceChildren();
          else {
            c.dataset.y = "0";
            r.yieldText!.textContent = "";
          }
        });
        r.drawn = undefined;
      }
      setClass(r.el, cls.join(" "));
      return;
    }
    if (row.f) cls.push(`flag-${row.f}`);
    setClass(r.el, cls.join(" "));
    const was = r.drawn;
    if (row === was) return;
    r.drawn = row;
    this.cols.forEach((col, i) => this.draw(col, r.cells[i], row, was, r));
  }

  /** Write one of a row's cells, if what it shows differs from `was` (the
   *  row the cell shows now, if any). */
  private draw(col: Column, c: HTMLSpanElement, row: Row, was: Row | undefined, r: RowEl): void {
    switch (col.key) {
      case "text":
        if (!was || row.t !== was.t || row.k !== was.k) {
          c.textContent = row.t || "(empty)";
          c.title = row.k ? `${row.t}\n${row.k}` : row.t;
        }
        return;
      case "deck":
        if (!was || row.d !== was.d || row.o !== was.o) {
          c.textContent = row.o ? `${leaf(row.d)} (${leaf(row.o)})` : leaf(row.d);
          c.title = row.o ? `${row.d} (${row.o})` : (row.d ?? "");
        }
        return;
      case "state":
        if (!was || row.q !== was.q) {
          const [label, stateCls] = STATES[row.q] ?? ["", ""];
          c.textContent = label;
          c.className = `r-state ${stateCls}`;
        }
        return;
      case "due":
        if (!was || row.du !== was.du || row.q !== was.q) {
          c.textContent = dueText(row.du);
          // Late only for a card that's being scheduled: a suspended or
          // buried card's due is where it was left.
          const off = row.q < 0;
          c.className = `${col.cls}${off ? " off" : row.du !== undefined && row.du < 0 ? " late" : ""}`;
        }
        return;
      case "ivl":
        if (!was || row.iv !== was.iv) c.textContent = row.iv ? span(row.iv) : "";
        return;
      case "ease":
        if (!was || row.e !== was.e) c.textContent = row.e ? `${row.e}%` : "";
        return;
      case "ret":
        if (!was || row.rt !== was.rt || row.dr !== was.dr) {
          const pct = row.rt === undefined ? null : Math.round(row.rt * 100);
          c.textContent = pct === null ? "" : `${pct}%`;
          const low = pct !== null && pct < Math.round((row.dr ?? 0.9) * 100);
          c.className = `${col.cls}${low ? " late" : ""}`;
          c.title = pct === null ? "" : `${pct}% (scheduled for ${Math.round((row.dr ?? 0.9) * 100)}%)`;
        }
        return;
      case "dif":
        if (!was || row.df !== was.df) c.textContent = row.df === undefined ? "" : `${row.df}%`;
        return;
      case "stab":
        if (!was || row.sb !== was.sb) c.textContent = row.sb === undefined ? "" : span(row.sb);
        return;
      case "reps":
        if (!was || row.rv !== was.rv) c.textContent = row.rv ? String(row.rv) : "";
        return;
      case "lapses":
        // 0 once you've reviewed it; blank for a new card.
        if (!was || row.lp !== was.lp || row.rv !== was.rv) c.textContent = row.rv ? String(row.lp ?? 0) : "";
        return;
      case "yield":
        if (!was || row.y !== was.y) {
          c.dataset.y = barsOf(row.y);
          r.yieldText!.textContent = row.y ?? "";
        }
        return;
      case "bank":
        if (!was || row.b !== was.b) {
          c.textContent = row.b ?? "";
          c.title = row.b ?? "";
        }
        return;
      case "again":
        if (!was || !sameAgain(row.a, was.a)) c.replaceChildren(...this.fitChips(row.a ?? []));
        return;
      case "verdict":
        if (!was || row.v !== was.v || row.r !== was.r) {
          c.textContent = row.v ? VERDICTS[row.v] : "";
          c.className = `r-verdict${row.v ? ` v-${row.v}` : ""}`;
          c.title = row.r ?? "";
        }
        return;
    }
  }
}

/** A number of days, short, as Anki writes intervals: 5h, 2.3d, 12d,
 *  3.5mo, 1.2y. */
export function span(days: number): string {
  const one = (x: number) => x.toFixed(1).replace(/\.0$/, "");
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h`;
  if (days < 10) return `${one(days)}d`;
  if (days < 30) return `${Math.round(days)}d`;
  if (days < 365) return `${one(days / 30)}mo`;
  return `${one(days / 365)}y`;
}

/** When a card is due, from its row's `du`: today, tomorrow, in 5d, 3d
 *  late; for a card learning within the day, in 10m, in 2h or now. */
export function dueText(du: number | undefined): string {
  if (du === undefined) return "";
  if (!Number.isInteger(du)) {
    if (du <= 0) return "now";
    const m = Math.round(du * 1440);
    return m < 60 ? `in ${Math.max(1, m)}m` : `in ${Math.round(m / 60)}h`;
  }
  if (du === 0) return "today";
  if (du === 1) return "tomorrow";
  return du > 0 ? `in ${span(du)}` : `${span(-du)} late`;
}

/** The same systems, statuses and shares in Again in. */
function sameAgain(a: Again[] | undefined, b: Again[] | undefined): boolean {
  if (!a || !b) return a === b;
  return a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1] && x[2] === b[i][2]);
}

/** Set an element's classes, if they aren't already (in any order:
 *  setCursor and setRange add theirs at the end). */
function setClass(el: HTMLElement, cls: string): void {
  if (el.className === cls) return;
  const want = cls.split(" ");
  if (want.length === el.classList.length && want.every((c) => el.classList.contains(c))) return;
  el.className = cls;
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
