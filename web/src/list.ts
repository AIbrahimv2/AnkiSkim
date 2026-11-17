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

/** Columns you can sort by (the facets the page has for every card). */
export type SortKey = "order" | "state" | "yield" | "banks" | "later" | "verdict";
const HEADS: [label: string, key: SortKey | null, title: string][] = [
  ["#", "order", "Original order"],
  ["Card", null, "The note's text, clozes filled in"],
  ["State", "state", "New, learning, review, suspended or buried"],
  ["Yield", "yield", "AnKing's yield tag"],
  ["Q-bank", "banks", "UWorld (UW), AMBOSS (AM) and NBME (NB) questions tagged on the card"],
  ["Again in", "later", "Other systems the card is in (green: done; orange: queued)"],
  ["Verdict", "verdict", "Unsuspend now, or wait for the system it mostly belongs to"],
];

export interface ListOptions {
  row(cid: number): Row | undefined;
  /** Rows the list is about to show and doesn't have yet. */
  need(cids: number[]): void;
  pick(index: number): void;
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
  private opts: ListOptions;

  constructor(host: HTMLElement, opts: ListOptions) {
    this.opts = opts;
    this.head = document.createElement("div");
    this.head.className = "list-head";
    for (const [label, key, title] of HEADS) {
      const h = document.createElement("span");
      h.textContent = label;
      h.title = title;
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
    host.append(this.head, this.scroller);
    this.scroller.addEventListener("scroll", () => this.schedule(), { passive: true });
    new ResizeObserver(() => this.render()).observe(this.scroller);
    this.scroller.addEventListener("mousedown", (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(".row");
      if (el) {
        e.preventDefault(); // keep the keys on the page, not the row
        this.opts.pick(Number(el.dataset.i));
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
    const cells = ["r-num num", "r-text", "r-state", "r-yield", "r-bank num", "r-again", "r-verdict"].map((cls) => {
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
    const [, text, state, yld, bank, again, verdict] = r.cells;
    const cls = ["row"];
    if (r.index === this.cursorIndex) cls.push("cur");
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
    state.textContent = label;
    state.className = `r-state ${stateCls}`;
    yld.textContent = row.y ?? "";
    yld.className = `r-yield${row.y === "High" ? " high" : ""}`;
    bank.textContent = row.b ?? "";
    bank.title = row.b ?? "";
    again.replaceChildren(...(row.a ?? []).map(([unit, status, part]) => chip(unit, status, part)));
    verdict.textContent = row.v ? VERDICTS[row.v] : "";
    verdict.className = `r-verdict${row.v ? ` v-${row.v}` : ""}`;
    verdict.title = row.r ?? "";
    r.el.className = cls.join(" ");
    r.filled = true;
  }
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
