// The card list: one row per card, only the rows on screen in the page
// (plus a few either side), reused as you scroll, so a search with 50,000
// cards scrolls like one with 50. Moving the cursor changes two rows.

import type { Row } from "./types.ts";

export const ROW_H = 30;
const OVERSCAN = 10;
/** Rows kept between the cursor and the list's edge (vim's 'scrolloff'). */
const SCROLLOFF = 3;

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

export interface ListOptions {
  row(cid: number): Row | undefined;
  /** Rows the list is about to show and doesn't have yet. */
  need(cids: number[]): void;
  pick(index: number): void;
}

interface RowEl {
  el: HTMLDivElement;
  num: HTMLSpanElement;
  text: HTMLSpanElement;
  kind: HTMLSpanElement;
  state: HTMLSpanElement;
  index: number;
  filled: boolean;
}

export class CardList {
  readonly scroller: HTMLDivElement;
  private sizer: HTMLDivElement;
  private live = new Map<number, RowEl>();
  private spare: RowEl[] = [];
  private ids: number[] = [];
  private cursorIndex = 0;
  private queued = 0;
  private opts: ListOptions;

  constructor(host: HTMLElement, opts: ListOptions) {
    this.opts = opts;
    this.scroller = document.createElement("div");
    this.scroller.className = "list-scroll";
    this.sizer = document.createElement("div");
    this.sizer.className = "list-sizer";
    this.scroller.append(this.sizer);
    host.append(this.scroller);
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

  setIds(ids: number[], cursor: number): void {
    this.ids = ids;
    this.cursorIndex = cursor;
    this.sizer.style.height = `${ids.length * ROW_H}px`;
    for (const r of this.live.values()) this.recycle(r);
    this.live.clear();
    this.scroller.scrollTop = Math.max(0, cursor * ROW_H - SCROLLOFF * ROW_H);
    this.render();
  }

  setCursor(index: number): void {
    this.live.get(this.cursorIndex)?.el.classList.remove("cur");
    this.cursorIndex = index;
    this.live.get(index)?.el.classList.add("cur");
    this.keepInView();
  }

  /** New rows arrived, or rows changed: fill in what's on screen. */
  refresh(force = false): void {
    for (const r of this.live.values()) if (force || !r.filled) this.fill(r);
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
        r.num.textContent = String(i + 1);
        this.live.set(i, r);
        this.fill(r);
        this.sizer.append(r.el);
      }
      if (!r.filled) missing.push(this.ids[i]);
    }
    if (missing.length) this.opts.need(missing);
  }

  private make(): RowEl {
    const el = document.createElement("div");
    el.className = "row";
    const num = document.createElement("span");
    num.className = "r-num num";
    const text = document.createElement("span");
    text.className = "r-text";
    const kind = document.createElement("span");
    kind.className = "r-kind";
    const state = document.createElement("span");
    state.className = "r-state";
    el.append(num, text, kind, state);
    return { el, num, text, kind, state, index: -1, filled: false };
  }

  private recycle(r: RowEl): void {
    r.el.remove();
    r.filled = false;
    this.spare.push(r);
  }

  private fill(r: RowEl): void {
    const row = this.opts.row(this.ids[r.index]);
    const cls = ["row"];
    if (r.index === this.cursorIndex) cls.push("cur");
    if (!row) {
      r.filled = false;
      cls.push("loading");
      r.text.textContent = "";
      r.kind.textContent = "";
      r.state.textContent = "";
      r.el.className = cls.join(" ");
      return;
    }
    const [text, kind, queue, flag] = row;
    const [label, stateCls] = STATES[queue] ?? ["", ""];
    if (flag) cls.push(`flag-${flag}`);
    r.text.textContent = text || "(empty)";
    r.kind.textContent = kind;
    r.state.textContent = label;
    r.state.className = `r-state ${stateCls}`;
    r.el.className = cls.join(" ");
    r.el.title = text;
    r.filled = true;
  }
}
