// The tags pane under the card: where the card lives. Its verdict and why,
// its yield and question banks, then its places by resource (the one
// you're on first, then your pinned ones), with the places in other systems
// marked: that's where you'll meet the card again. Its other tags follow,
// also by resource, and fold into "Show more" only when they'd push the
// pane past its height. The groups flow into columns as the pane widens.
// Plain DOM, drawn from the row the page already has.

import type { Pane, Status } from "./types.ts";

const VERDICT_WORD: Record<string, string> = { now: "Unsuspend now", call: "Your call", wait: "Could wait" };
const STATUS_WORD: Record<string, string> = { completed: "done", queued: "queued", later: "later" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function status(s: Status): HTMLSpanElement | null {
  return s ? el("span", `tp-status s-${s}`, STATUS_WORD[s]) : null;
}

function tags(n: number): string {
  return `${n} tag${n === 1 ? "" : "s"}`;
}

export class TagsPane {
  private body: HTMLDivElement;
  private count: HTMLSpanElement;
  private showMore = false;
  private shown: Pane | null = null;
  private total = 0;
  private size = "";

  constructor(host: HTMLElement) {
    const head = el("div", "tp-head");
    head.append(el("span", "tp-title", "Where this card lives"));
    this.count = el("span", "tp-count");
    head.append(this.count);
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

  private draw(): void {
    const p = this.shown;
    this.body.replaceChildren();
    this.body.scrollTop = 0;
    this.count.textContent = p && this.total ? tags(this.total) : "";
    if (!p) {
      this.body.append(el("div", "tp-empty", "No tags."));
      return;
    }
    if (p.verdict) {
      const v = el("div", `tp-verdict v-${p.verdict}`);
      v.append(el("b", "", VERDICT_WORD[p.verdict]), el("span", "", p.reason ?? ""));
      this.body.append(v);
    }
    const facts: string[] = [];
    if (p.yield) facts.push(`${p.yield} yield`);
    for (const [bank, n] of p.banks) facts.push(`${bank} ${n}`);
    if (facts.length) {
      const f = el("div", "tp-facts");
      for (const x of facts) f.append(el("span", "", x));
      this.body.append(f);
    }
    if (p.groups.length) {
      const places = el("div", "tp-places");
      for (const g of p.groups) {
        const group = el("div", "tp-group");
        const name = el("div", "tp-res", g.label);
        if (g.here) name.append(el("span", "tp-note", "you're here"));
        else if (g.pinned) name.append(el("span", "tp-note", "pinned"));
        group.append(name);
        for (const t of g.topics) {
          const line = el("div", `tp-topic${t.here ? " here" : ""}${t.again ? " again" : ""}`);
          line.title = t.tag;
          if (t.again) line.append(el("span", "tp-unit", t.unit ?? ""));
          line.append(el("span", "tp-path", t.path));
          if (t.extra) line.append(el("span", "tp-extra", "Extra"));
          const s = status(t.status);
          if (s) line.append(s);
          group.append(line);
        }
        places.append(group);
      }
      this.body.append(places);
    }
    if (!p.more.length) return;
    const other = el("div", "tp-other");
    if (p.groups.length) other.append(el("div", "tp-divider", "Other tags"));
    const places = el("div", "tp-places");
    for (const o of p.more) {
      const group = el("div", o.label ? "tp-group" : "tp-group bare");
      if (o.label) group.append(el("div", "tp-res", o.label));
      for (const [path, tag] of o.tags) {
        const line = el("div", "tp-topic");
        line.title = tag;
        line.append(el("span", "tp-path", path));
        group.append(line);
      }
      places.append(group);
    }
    other.append(places);
    this.body.append(other);
    // With places of yours above them, fold the rest when they don't fit.
    // (With none, they're all there is to show.)
    if (this.showMore || !p.groups.length) return;
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
  const places = p.groups.reduce((n, g) => n + g.topics.length, 0);
  const banks = p.banks.reduce((n, [, k]) => n + k, 0);
  const other = p.more.reduce((n, o) => n + o.tags.length, 0);
  return places + banks + other + (p.yield ? 1 : 0);
}
