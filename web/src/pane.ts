// The tags pane under the card: where the card lives. Its title is the
// verdict (Now, Wait, Your Call), or "Tags" when there's
// none. Under it, when the card is in more than one system, a bar of its
// places by system, each named, the reason for the verdict: the topic's system in the accent colour, the others in their
// Stepwise colours (done, queued, saved for later) or grey. Then its yield
// (with signal bars) and question banks as pills, then its places, by system in the bar's
// order, each with the resource that has it and the end of its path. Its
// other tags follow, by resource, and fold into "Show more" only when
// they'd push the pane past its height. The systems flow into columns as
// the pane widens. One size of text throughout; colour says what a system
// is to you (hover a dot for it). The title folds the pane
// away (i too), so the card gets its room. Plain DOM, drawn from the row
// the page already has.

import { resourceIcon, resourceImg } from "./kit/resources.tsx";
import type { Pane, Status, SystemState } from "./types.ts";
import { barsOf, yieldBars } from "./yieldbars.ts";

/** The verdict, as the pane's title: the list's words, in title case. */
const VERDICT_WORD: Record<string, string> = { now: "Now", call: "Your Call", wait: "Wait" };
const STATE_HINT: Record<string, string> = {
  here: "The topic you're on",
  completed: "Done in Stepwise",
  queued: "Queued in Stepwise",
  later: "Saved for later in Stepwise",
};
const CHEVRON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const CHECK =
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function tags(n: number): string {
  return `${n} tag${n === 1 ? "" : "s"}`;
}

const stateClass = (s: SystemState) => `s-${s ?? "none"}`;

/** A place's Stepwise status: a check when it's done, a dot otherwise. */
function mark(s: Status): HTMLSpanElement | null {
  if (!s) return null;
  const m = el("span", `tp-mark s-${s}`);
  if (s === "completed") m.innerHTML = CHECK;
  m.title = STATE_HINT[s];
  return m;
}

/** The resource column, as wide as the longest name in it (up to a
 *  point), and its logo: counted, not measured, so drawing a pane reads no
 *  layout. True when any name has a logo: the rest then keep its room, so
 *  the names line up. */
function fitNames(host: HTMLElement, names: string[]): boolean {
  const longest = names.reduce((n, x) => Math.max(n, x.length), 0);
  const logos = names.some((x) => resourceIcon(x));
  host.style.setProperty("--res", `${Math.min(Math.max(longest, 6), 18) + 1 + (logos ? 4 : 0)}ch`);
  return logos;
}

/** A bar of named parts, in their systems' colours, each as wide as its
 *  weight but never narrower than its name (they wrap when they don't all
 *  fit), so it reads without hovering. */
function bar(parts: { name: string; note?: string; weight: number; cls: string; title: string }[]): HTMLDivElement {
  const b = el("div", "tp-bar");
  for (const x of parts) {
    const seg = el("span", `tp-seg ${x.cls}`);
    seg.style.flexGrow = String(x.weight);
    seg.title = x.title;
    seg.append(el("span", "tp-seg-name", x.name));
    if (x.note) seg.append(el("span", "tp-seg-note", x.note));
    b.append(seg);
  }
  return b;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A row: the resource with its logo (left blank when the row above has
 *  it), the path, and what's at its end (Extra, its status). */
function row(resource: string, path: string, title: string, logos: boolean, end: (HTMLElement | null)[] = []): HTMLDivElement {
  const r = el("div", "tp-row");
  r.title = title;
  // The resource's logo before its name (the kit's, when it has one), or
  // its room when others around it have one.
  const res = el("span", "tp-res");
  if (resource) {
    res.append(logos ? resourceImg(resource, true) : "", el("span", "tp-res-name", resource));
  }
  r.append(res, el("span", "tp-path", path));
  const tail = end.filter((x): x is HTMLElement => !!x);
  if (tail.length) {
    const e = el("span", "tp-end");
    e.append(...tail);
    r.append(e);
  }
  return r;
}

export class TagsPane {
  private host: HTMLElement;
  private head: HTMLDivElement;
  private body: HTMLDivElement;
  private title: HTMLSpanElement;
  private count: HTMLSpanElement;
  private showMore = false;
  private shown: Pane | null = null;
  private total = 0;
  private size = "";
  /** Folded to its title: the pane isn't drawn until it opens again. */
  private open = true;

  /** `toggle`: the title was clicked (the page folds or opens the pane,
   *  and remembers it). */
  constructor(host: HTMLElement, toggle: () => void) {
    this.host = host;
    const head = el("div", "tp-head");
    this.head = head;
    head.title = "Hide the tags (i)";
    this.title = el("span", "tp-title", "Tags");
    head.append(this.title);
    this.count = el("span", "tp-count");
    const chevron = el("span", "tp-chev");
    chevron.innerHTML = CHEVRON;
    head.append(this.count, chevron);
    head.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault(); // keep the keys on the page
      toggle();
    });
    this.body = el("div", "tp-body");
    host.append(head, this.body);
    // Whether the other tags fit depends on the pane's size: look again
    // when it changes. The border box, so a scrollbar coming and going
    // doesn't count as a change.
    new ResizeObserver(([e]) => {
      const box = e?.borderBoxSize?.[0];
      const size = box ? `${Math.round(box.inlineSize)}x${Math.round(box.blockSize)}` : "";
      if (size === this.size) return;
      this.size = size;
      if (this.shown?.more.length && !this.showMore) this.draw();
    }).observe(this.body, { box: "border-box" });
  }

  /** Draw a card's pane (null: nothing to show yet). */
  show(pane: Pane | null | undefined, total = 0): void {
    if (pane === this.shown) return;
    this.shown = pane ?? null;
    this.total = total;
    this.showMore = false;
    this.draw();
  }

  /** Fold the pane to its title, or open it again. */
  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.host.classList.toggle("closed", !open);
    this.head.title = open ? "Hide the tags (i)" : "Show the tags (i)";
    if (open) this.draw();
  }

  private draw(): void {
    const p = this.shown;
    // The title, the verdict and its count show folded too.
    this.title.textContent = p?.verdict ? VERDICT_WORD[p.verdict] : "Tags";
    this.title.className = `tp-title${p?.verdict ? ` v-${p.verdict}` : ""}`;
    this.title.title = p?.reason ?? "";
    this.count.textContent = p && this.total ? String(this.total) : "";
    this.count.title = p && this.total ? tags(this.total) : "";
    // Folded, the rest is drawn when it opens.
    if (!this.open) return;
    this.body.replaceChildren();
    this.body.scrollTop = 0;
    if (!p) {
      this.body.append(el("div", "tp-empty", "No tags."));
      return;
    }
    // The bar, once there are two systems to weigh against each other.
    const weighed = p.systems.filter((s) => s.weight > 0);
    if (weighed.length > 1) {
      const total = weighed.reduce((n, s) => n + s.weight, 0);
      this.body.append(bar(weighed.map((s) => ({
        name: s.name,
        weight: s.weight,
        cls: stateClass(s.state),
        title: `${s.name}: ${s.weight} of ${plural(total, "resource")}${s.state ? ` · ${STATE_HINT[s.state]}` : ""}`,
      }))));
    }
    const pills = el("div", "tp-pills");
    if (p.yield) {
      const y = el("span", "tp-pill tp-yield");
      y.dataset.y = barsOf(p.yield);
      y.append(yieldBars(), `${p.yield} Yield`);
      pills.append(y);
    }
    for (const [bank, n] of p.banks) {
      const pill = el("span", "tp-pill tp-bank");
      pill.append(resourceImg(bank) ?? "", `${bank} ${n}`);
      pills.append(pill);
    }
    if (pills.childElementCount) this.body.append(pills);
    if (p.systems.length) {
      const places = el("div", "tp-places");
      const logos = fitNames(places, p.systems.flatMap((s) => s.places.map((x) => x.resource)));
      for (const s of p.systems) {
        const sys = el("div", "tp-sys");
        const head = el("div", "tp-sys-head");
        head.append(el("span", `tp-dot ${stateClass(s.state)}`), el("span", "tp-sys-name", s.name));
        head.title = s.state ? STATE_HINT[s.state] : "";
        sys.append(head);
        let last = "";
        for (const x of s.places) {
          const extra = x.extra ? el("span", "tp-extra", "Extra") : null;
          sys.append(row(x.resource === last ? "" : x.resource, x.path, `${x.full}\n${x.tag}`, logos, [extra, mark(x.status)]));
          last = x.resource;
        }
        places.append(sys);
      }
      this.body.append(places);
    }
    if (!p.more.length) return;
    const other = el("div", "tp-other");
    if (p.systems.length) other.append(el("div", "tp-sys-head tp-sys-name", "Other tags"));
    const groups = el("div", "tp-places");
    const logos = fitNames(groups, p.more.map((o) => o.label));
    for (const o of p.more) {
      const group = el("div", "tp-sys");
      o.tags.forEach(([path, tag], i) => group.append(row(i ? "" : o.label, path, tag, logos)));
      groups.append(group);
    }
    other.append(groups);
    this.body.append(other);
    // With places of yours above them, fold the rest when they don't fit.
    // (With none, they're all there is to show.)
    if (this.showMore || !p.systems.length) return;
    const room = this.body.clientHeight;
    if (room > 0 && this.body.scrollHeight > room) other.replaceWith(this.moreButton(p));
  }

  private moreButton(p: Pane): HTMLButtonElement {
    const n = p.more.reduce((k, o) => k + o.tags.length, 0);
    const b = el("button", "tp-more", `Show ${n} more tag${n === 1 ? "" : "s"}`);
    b.type = "button";
    b.tabIndex = -1;
    b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      this.showMore = true;
      this.draw();
    });
    return b;
  }
}

/** All of a card's tags, for the count in the pane's header. */
export function tagCount(p: Pane): number {
  const places = p.systems.reduce((n, s) => n + s.places.length, 0);
  const banks = p.banks.reduce((n, [, k]) => n + k, 0);
  const other = p.more.reduce((n, o) => n + o.tags.length, 0);
  return places + banks + other + (p.yield ? 1 : 0);
}
