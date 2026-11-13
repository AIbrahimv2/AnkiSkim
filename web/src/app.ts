// The page, laid out like Anki's browser: the card table on the left, the
// card and its tags on the right. Plain DOM, no framework: a key press goes
// from here straight to the table and the card frames, with nothing to
// re-render in between. The dialogs, menu and toasts (chrome/) are React,
// and only run when you open them.
//
// The table can be filtered (All, Suspended, Now, Wait, ...) and sorted
// by its columns. Both work from "facets": a few numbers per card for the
// whole view, fetched in slices right after the view arrives.

import { call } from "./bridge.ts";
import type { ChromeApi } from "./chrome/Chrome.tsx";
import { type Command, Keys } from "./keys.ts";
import { CardList, type SortKey } from "./list.ts";
import { TagsPane, tagCount } from "./pane.ts";
import { Stage, type Want } from "./stage.ts";
import type { CardHtml, Facets, Layout, PageConfig, PushEvent, Row, Side, View } from "./types.ts";

const SEARCH_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
/** The table's share of the width: three quarters, the card the rest. */
const LIST_SHARE = 0.72;
const FACET_SLICE = 3000;

export interface Boot {
  view: View;
  frame: string;
  config: PageConfig;
  layout: Layout;
}

type FilterKey = "all" | "susp" | "now" | "wait" | "call" | "high" | "qbank";
interface Filter {
  key: FilterKey;
  label: string;
  /** Only with a topic to judge cards against. */
  topic?: boolean;
  test(f: Facets, i: number): boolean;
}
const FILTERS: Filter[] = [
  { key: "all", label: "All", test: () => true },
  { key: "susp", label: "Suspended", test: (f, i) => f.state[i] === -1 },
  { key: "now", label: "Now", topic: true, test: (f, i) => f.verdict[i] === 1 },
  { key: "wait", label: "Wait", topic: true, test: (f, i) => f.verdict[i] === 3 },
  { key: "call", label: "Your call", topic: true, test: (f, i) => f.verdict[i] === 2 },
  { key: "high", label: "High yield", test: (f, i) => f.yield[i] === 1 || f.yield[i] === 3 },
  { key: "qbank", label: "Q-bank", test: (f, i) => f.banks[i] > 0 },
];
/** First direction when you sort by a column. */
const SORT_START: Record<SortKey, 1 | -1> = { order: 1, state: 1, yield: 1, banks: -1, later: -1, verdict: -1 };

const fmt = (n: number) => n.toLocaleString("en-US");
const other = (s: Side): Side => (s === "answer" ? "question" : "answer");

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** An element from a fixed snippet of markup in this file (an icon). */
function fixed(cls: string, markup: string): HTMLSpanElement {
  const e = document.createElement("span");
  e.className = cls;
  e.innerHTML = markup;
  return e;
}

export class App {
  private view: View;
  private config: PageConfig;
  private side: Side;
  /** The cards in the table, in its order (the view's, filtered and sorted). */
  private shown: number[] = [];
  private cursor = 0;
  private dir: 1 | -1 = 1;
  private keys = new Keys();
  private rows = new Map<number, Row>();
  private rowsWanted = new Set<number>();
  private rowsInFlight = new Set<number>();
  private rowsQueued = false;
  private facets: Facets | null = null;
  private facetsSeq = -1;
  private filter: FilterKey = "all";
  private sort: SortKey = "order";
  private sortDir: 1 | -1 = 1;
  private listShare = LIST_SHARE;
  private autoplayTimer = 0;
  private lastPlayed = "";
  private chrome!: ChromeApi;

  private list: CardList;
  private stage: Stage;
  private pane: TagsPane;
  private input: HTMLInputElement;
  private sourceEl: HTMLElement;
  private sides: HTMLElement;
  private pos: HTMLElement;
  private chips: HTMLElement;
  private typed: HTMLElement;
  private message: HTMLElement;
  private hints: HTMLElement;
  readonly actionsSlot: HTMLElement;
  readonly chromeHost: HTMLElement;

  constructor(root: HTMLElement, boot: Boot) {
    this.view = boot.view;
    this.config = boot.config;
    this.side = boot.config.startSide;

    const app = el("div", "app");
    const bar = el("header", "toolbar");
    const search = el("div", "search");
    search.append(fixed("search-icon", SEARCH_ICON));
    this.input = el("input");
    this.input.placeholder = "Search cards";
    this.input.spellcheck = false;
    this.input.title = "Anki's search syntax, e.g. deck:current or tag:Cardio. / to search, Enter to run, Esc to go back to the cards.";
    const end = el("span", "search-end");
    end.append(el("span", "kbd", "/"));
    search.append(this.input, end);
    this.sourceEl = el("div", "source");
    this.sides = el("div", "mini-seg sides");
    for (const [side, label] of [["question", "Front"], ["answer", "Back"]] as const) {
      const b = el("button", "", label);
      b.type = "button";
      b.dataset.side = side;
      b.title = side === "question" ? "Show the front (h)" : "Show the back (l)";
      b.tabIndex = -1;
      b.addEventListener("click", () => this.setSide(side));
      this.sides.append(b);
    }
    this.pos = el("span", "pos num");
    this.actionsSlot = el("span", "actions-slot");
    bar.append(search, this.sourceEl, this.sides, this.pos, this.actionsSlot);

    const main = el("main", "main");
    const listPanel = el("section", "panel list-panel");
    this.chips = el("div", "chips");
    listPanel.append(this.chips);
    this.typed = el("div", "typed num");
    const splitter = el("div", "splitter");
    splitter.title = "Drag to resize";
    const right = el("div", "side");
    const cardPanel = el("section", "panel card-panel");
    const stageEl = el("div", "stage");
    this.message = el("div", "stage-msg");
    cardPanel.append(stageEl, this.message);
    const tagsPanel = el("section", "panel tags-panel");
    right.append(cardPanel, tagsPanel);
    main.append(listPanel, splitter, right);
    this.hints = el("footer", "hints");
    this.chromeHost = el("div", "chrome");
    app.append(bar, main, this.hints);
    root.append(app, this.chromeHost);

    this.list = new CardList(listPanel, {
      row: (cid) => this.rows.get(cid),
      need: (cids) => this.needRows(cids),
      pick: (i) => this.go(i, true),
      sort: (key) => this.sortBy(key),
    });
    listPanel.append(this.typed);
    this.pane = new TagsPane(tagsPanel);
    this.stage = new Stage(stageEl, boot.frame, {
      fetch: (ids) => call<{ cards: Record<string, CardHtml | null> }>("cards", { ids }).then((r) => r.cards),
      onKey: (e) => this.onKey(e),
      onShown: (cid, side) => this.shown_(cid, side),
    });

    this.setListShare(boot.layout.share ?? LIST_SHARE);
    this.dragToResize(splitter, main);
    this.wireSearch();
    window.addEventListener("keydown", (e) => this.onKey(e));
    this.setView(boot.view, true);
  }

  attachChrome(chrome: ChromeApi): void {
    this.chrome = chrome;
  }

  // --- what's showing ----------------------------------------------------------

  push(e: PushEvent): void {
    switch (e.type) {
      case "view":
        this.setView(e.view);
        break;
      case "changed":
        this.stage.invalidate();
        this.retag();
        break;
      case "retag":
        this.retag();
        break;
      case "shown":
        this.view = { ...this.view, back: e.back };
        this.renderChrome();
        break;
      case "settings":
        this.chrome?.openSettings();
        break;
    }
  }

  setView(view: View, first = false): void {
    if (!first && view.seq < this.view.seq) return;
    this.view = view;
    // Rows read the cards against the view's topic: a new topic, new rows.
    this.rows.clear();
    this.facets = null;
    this.keys.reset();
    if (document.activeElement !== this.input) this.input.value = view.search;
    this.renderChrome();
    this.relist(view.select ?? null);
    this.loadFacets();
  }

  setConfig(config: PageConfig): void {
    const startChanged = config.startSide !== this.config.startSide;
    const waitChanged = config.waitBelow !== this.config.waitBelow;
    this.config = config;
    if (startChanged) this.setSide(config.startSide);
    if (waitChanged) this.retag();
  }

  /** Stepwise's plan or the cards changed: read rows and facets again. */
  private retag(): void {
    this.rows.clear();
    this.list.refresh(true);
    this.facets = null;
    this.loadFacets();
    this.showPane();
  }

  /** Fill the table from the view, filtered and sorted, keeping the card
   *  you're on if it's still there. */
  private relist(keep: number | null): void {
    const ids = this.view.ids;
    let order = ids.map((_, i) => i);
    const f = this.facets;
    const lens = !!f && (this.filter !== "all" || this.sort !== "order");
    if (f && lens) {
      const filter = FILTERS.find((x) => x.key === this.filter);
      if (filter && filter.key !== "all") order = order.filter((i) => filter.test(f, i));
      if (this.sort !== "order") {
        const d = this.sortDir;
        const value = (i: number): number => {
          switch (this.sort) {
            case "state": return f.state[i];
            case "yield": return f.yield[i] || 9;
            case "banks": return f.banks[i];
            case "later": return f.later[i];
            case "verdict": return f.verdict[i];
            default: return i;
          }
        };
        order.sort((a, b) => (value(a) - value(b)) * d || a - b);
      }
    }
    this.shown = order.map((i) => ids[i]);
    const at = keep !== null ? this.shown.indexOf(keep) : -1;
    this.cursor = at >= 0 ? at : 0;
    this.dir = 1;
    this.list.setIds(this.shown, this.cursor);
    this.list.setSort(this.sort, this.sortDir);
    this.renderChips();
    this.update(false);
  }

  private loadFacets(): void {
    const seq = this.view.seq;
    const total = this.view.ids.length;
    this.facetsSeq = seq;
    if (!total) return;
    const parts: Facets = { state: [], yield: [], banks: [], verdict: [], later: [] };
    const next = (offset: number) => {
      call<{ facets?: Facets; stale?: boolean }>("facets", { seq, offset, limit: FACET_SLICE })
        .then((r) => {
          if (r.stale || !r.facets || this.facetsSeq !== seq || this.view.seq !== seq) return;
          for (const k of Object.keys(parts) as (keyof Facets)[]) parts[k].push(...r.facets[k]);
          if (parts.state.length < total) return next(parts.state.length);
          this.facets = parts;
          const keep = this.shown[this.cursor] ?? null;
          if (this.filter !== "all" || this.sort !== "order") this.relist(keep);
          else this.renderChips();
        })
        .catch(() => {});
    };
    next(0);
  }

  private update(input: boolean): void {
    const ids = this.shown;
    this.showTyped();
    if (!ids.length) {
      this.stage.clear();
      this.pane.show(null);
      this.pos.textContent = "";
      this.message.textContent = this.view.error
        ? this.view.error
        : this.view.ids.length
          ? "No cards match this filter."
          : this.view.search || this.view.source
            ? "No cards match."
            : "Search for cards with /";
      this.message.classList.toggle("error", !!this.view.error);
      this.message.hidden = false;
      return;
    }
    this.message.hidden = true;
    this.list.setCursor(this.cursor);
    this.pos.textContent = `${fmt(this.cursor + 1)} of ${fmt(ids.length)}`;
    this.stage.want(this.wanted(), this.prefetch(), input);
    this.showPane();
  }

  private showPane(): void {
    const cid = this.shown[this.cursor];
    const row = cid !== undefined ? this.rows.get(cid) : undefined;
    this.pane.show(row?.p ?? null, row?.p ? tagCount(row.p) : 0);
  }

  /** The card on screen, then the ones you're likely to want next. */
  private wanted(): Want[] {
    const ids = this.shown;
    const i = this.cursor;
    const d = this.dir;
    const s = this.side;
    const out: Want[] = [[ids[i], s]];
    const add = (k: number, side: Side) => k >= 0 && k < ids.length && out.push([ids[k], side]);
    add(i + d, s);
    add(i, other(s));
    add(i - d, s);
    add(i + 2 * d, s);
    add(i + 3 * d, s);
    return out;
  }

  /** Cards whose HTML is fetched ahead, beyond those drawn. */
  private prefetch(): number[] {
    const ids = this.shown;
    const out: number[] = [];
    for (let k = 4; k <= 8; k++) {
      const j = this.cursor + k * this.dir;
      if (j >= 0 && j < ids.length) out.push(ids[j]);
    }
    return out;
  }

  private go(index: number, input: boolean): void {
    const n = this.shown.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, index));
    if (i !== this.cursor) this.dir = i > this.cursor ? 1 : -1;
    this.cursor = i;
    this.update(input);
  }

  private setSide(side: Side): void {
    this.side = side;
    this.renderSides();
    if (this.shown.length) this.stage.want(this.wanted(), this.prefetch(), true);
  }

  private shown_(cid: number, side: Side): void {
    if (!this.config.autoplay) return;
    clearTimeout(this.autoplayTimer);
    this.autoplayTimer = window.setTimeout(() => {
      const shown = this.stage.shown();
      const key = `${cid}:${side}`;
      if (shown && shown[0] === cid && shown[1] === side && key !== this.lastPlayed) {
        this.lastPlayed = key;
        void call("replay", { cid, side });
      }
    }, 250);
  }

  // --- filters and sorting -------------------------------------------------------

  private filters(): Filter[] {
    return FILTERS.filter((f) => !f.topic || this.view.topics.length);
  }

  private setFilter(key: FilterKey): void {
    if (!this.facets && key !== "all") return; // counts are on their way
    this.filter = key;
    this.relist(this.shown[this.cursor] ?? null);
  }

  private sortBy(key: SortKey): void {
    if (!this.facets && key !== "order") return;
    if (this.sort === key && key !== "order") this.sortDir = this.sortDir === 1 ? -1 : 1;
    else {
      this.sort = key;
      this.sortDir = SORT_START[key];
    }
    this.relist(this.shown[this.cursor] ?? null);
  }

  private renderChips(): void {
    const f = this.facets;
    const n = this.view.ids.length;
    const filters = this.filters();
    if (!filters.some((x) => x.key === this.filter)) this.filter = "all";
    this.chips.replaceChildren(
      ...filters.map((x) => {
        const b = el("button", `chip${x.key === this.filter ? " on" : ""}${x.topic ? ` c-${x.key}` : ""}`);
        b.type = "button";
        b.tabIndex = -1;
        let count = "";
        if (x.key === "all") count = fmt(n);
        else if (f) {
          let c = 0;
          for (let i = 0; i < n; i++) if (x.test(f, i)) c++;
          count = fmt(c);
        } else count = "…";
        b.append(el("span", "", x.label), el("span", "chip-n num", count));
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.setFilter(x.key);
        });
        return b;
      }),
    );
  }

  // --- keys --------------------------------------------------------------------

  private onKey(e: KeyboardEvent): void {
    if (this.chrome?.isOpen()) return; // a dialog or menu has the keys
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    const cmd = this.keys.feed(e);
    this.showTyped();
    if (cmd === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (cmd) this.run(cmd);
  }

  private run(cmd: Command): void {
    const n = this.shown.length;
    const cid = this.shown[this.cursor];
    switch (cmd.kind) {
      case "move":
        return this.go(this.cursor + cmd.by, true);
      case "goto":
        return this.go(cmd.row === -1 ? n - 1 : cmd.row - 1, true);
      case "half":
        return this.go(this.cursor + cmd.dir * (cmd.rows ?? Math.max(1, Math.floor(this.list.pageRows() / 2))), true);
      case "page":
        return this.go(this.cursor + cmd.by * this.list.pageRows(), true);
      case "side":
        return this.setSide(cmd.side === "flip" ? other(this.side) : cmd.side);
      case "scroll":
        return this.stage.scroll(cmd.by);
      case "filter": {
        const keys = this.filters().map((x) => x.key);
        const at = Math.max(0, keys.indexOf(this.filter));
        return this.setFilter(keys[(at + cmd.by + keys.length) % keys.length]);
      }
      case "search":
        this.input.focus();
        this.input.select();
        return;
      case "edit":
        if (cid) void call("edit", { cid });
        return;
      case "replay":
        if (cid) void call("replay", { cid, side: this.side });
        return;
      case "back":
        if (this.view.back) void call("back");
        return;
      case "close":
        void call("close");
        return;
      case "help":
        this.chrome?.toggleHelp();
        return;
      case "cancel":
        return;
    }
  }

  private showTyped(): void {
    const t = this.keys.typed;
    this.typed.textContent = t;
    this.typed.hidden = !t;
  }

  // --- list rows -----------------------------------------------------------------

  private needRows(cids: number[]): void {
    for (const c of cids) if (!this.rows.has(c) && !this.rowsInFlight.has(c)) this.rowsWanted.add(c);
    if (this.rowsQueued || !this.rowsWanted.size) return;
    this.rowsQueued = true;
    queueMicrotask(() => {
      this.rowsQueued = false;
      const ids = [...this.rowsWanted].slice(0, 400);
      this.rowsWanted.clear();
      const seq = this.view.seq;
      ids.forEach((c) => this.rowsInFlight.add(c));
      call<{ rows: Record<string, Row> }>("rows", { ids })
        .then((r) => {
          if (this.view.seq !== seq) return; // read against another topic
          for (const c of ids) this.rows.set(c, r.rows[String(c)] ?? { t: "(deleted)", k: "", q: 99, f: 0 });
          this.list.refresh();
          this.showPane();
        })
        .catch(() => {})
        .finally(() => ids.forEach((c) => this.rowsInFlight.delete(c)));
    });
  }

  // --- toolbar and footer --------------------------------------------------------

  private renderChrome(): void {
    const v = this.view;
    this.sourceEl.replaceChildren();
    if (v.source) {
      const chip = el("span", "source-from", v.source);
      chip.title = `Following ${v.source}: Skim shows what you're on there`;
      this.sourceEl.append(chip);
    }
    if (v.title) this.sourceEl.append(el("span", "source-title", v.title));
    this.sourceEl.hidden = !(v.source || v.title);
    this.renderSides();
    this.renderHints();
  }

  private renderSides(): void {
    for (const b of this.sides.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("active", b.dataset.side === this.side);
    }
  }

  private renderHints(): void {
    const groups: [string[], string][] = [
      [["j", "k"], "move"],
      [["h", "l"], "front, back"],
      [["f"], "filter"],
      [["/"], "search"],
      [["e"], "edit"],
    ];
    if (this.view.back) groups.push([["p"], `back to ${this.view.back}`]);
    groups.push([["?"], "all keys"]);
    this.hints.replaceChildren(
      ...groups.map(([keys, label]) => {
        const g = el("span", "hint");
        for (const k of keys) g.append(el("kbd", "", k));
        g.append(el("span", "hint-label", label));
        return g;
      }),
    );
  }

  private wireSearch(): void {
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const query = this.input.value;
        this.input.blur();
        call<{ view: View }>("search", { query }).then((r) => this.setView(r.view), () => {});
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = this.view.search;
        this.input.blur();
      }
    });
  }

  /** The table's share of the width; it never gets narrower than its
   *  columns need (--list-min in the stylesheet), whatever the share. */
  private setListShare(share: number): void {
    this.listShare = Math.max(0.4, Math.min(0.9, share || LIST_SHARE));
    document.documentElement.style.setProperty("--list-share", `${(this.listShare * 100).toFixed(1)}%`);
  }

  private dragToResize(splitter: HTMLElement, main: HTMLElement): void {
    splitter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      const box = main.getBoundingClientRect();
      const inner = box.width - 32; // .main's side padding
      const move = (ev: PointerEvent) => this.setListShare((ev.clientX - box.left - 16 - 6) / inner);
      const up = () => {
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", up);
        void call("layout", { share: this.listShare });
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", up);
    });
  }

  cardId(): number | undefined {
    return this.shown[this.cursor];
  }
}
