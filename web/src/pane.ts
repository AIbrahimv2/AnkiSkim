// The tags pane under the card: where the card lives. Its verdict and why,
// its yield and question banks, then its places by resource (the one
// you're on first, then your pinned ones), with the places in other systems
// marked: that's where you'll meet the card again. Everything else folds
// into "Show more". Plain DOM, drawn from the row the page already has.

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

export class TagsPane {
  private body: HTMLDivElement;
  private count: HTMLSpanElement;
  private showMore = false;
  private shown: Pane | null = null;

  constructor(host: HTMLElement) {
    const head = el("div", "tp-head");
    head.append(el("span", "tp-title", "Where this card lives"));
    this.count = el("span", "tp-count");
    head.append(this.count);
    this.body = el("div", "tp-body");
    host.append(head, this.body);
  }

  /** Draw a card's pane (null: nothing to show yet). */
  show(pane: Pane | null | undefined, total = 0): void {
    if (pane === this.shown) return;
    this.shown = pane ?? null;
    this.showMore = false;
    this.draw(total);
  }

  private draw(total: number): void {
    const p = this.shown;
    this.body.replaceChildren();
    this.body.scrollTop = 0;
    this.count.textContent = p && total ? `${total} tags` : "";
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
      this.body.append(group);
    }
    if (p.more.length) {
      if (this.showMore) {
        const more = el("div", "tp-more-list");
        for (const t of p.more) more.append(el("div", "", t));
        this.body.append(more);
      } else {
        const b = el("button", "tp-more", `Show ${p.more.length} more tag${p.more.length === 1 ? "" : "s"}`);
        b.type = "button";
        b.tabIndex = -1;
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.showMore = true;
          this.draw(total);
        });
        this.body.append(b);
      }
    }
  }
}

/** All of a card's tags, for the count in the pane's header. */
export function tagCount(p: Pane): number {
  const places = p.groups.reduce((n, g) => n + g.topics.length, 0);
  const banks = p.banks.reduce((n, [, k]) => n + k, 0);
  return places + banks + p.more.length + (p.yield ? 1 : 0);
}
