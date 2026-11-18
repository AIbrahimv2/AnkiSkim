// The page, laid out like Anki's browser: the card table on the left, the
// card and its tags on the right. Plain DOM, no framework: a key press goes
// from here straight to the table and the card frames, with nothing to
// re-render in between. The dialogs, menu and toasts (chrome/) are React,
// and only run when you open them.
//
// The table can be filtered (All, Suspended, Now, Wait, ...) and sorted
// by its columns. Both work from "facets": a few numbers per card for the
// whole view, fetched in slices once its first card is on screen. Facets
// and rows are kept per card across views (cache.ts), so a view of cards
// you've seen before needs neither.

import { call } from "./bridge.ts";
import { Cache } from "./cache.ts";
import type { ChromeApi } from "./chrome/Chrome.tsx";
import { KeyCast } from "./keycast.ts";
import { type Command, Keys } from "./keys.ts";
import { CardList, type SortKey } from "./list.ts";
import { TagsPane, tagCount } from "./pane.ts";
import { Stage, type Want } from "./stage.ts";
import type { CardHtml, Facets, Layout, PageConfig, PushEvent, Row, Side, View } from "./types.ts";

const SEARCH_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
/** The table's share of the width: three quarters, the card the rest.
 *  Dragged, it stays in SHARE_RANGE (bridge.py's too), with the table at
 *  least LIST_MIN wide (what its last columns need) and the card at least
 *  SIDE_MIN (--list-min and --side-min in the stylesheet). */
const LIST_SHARE = 0.72;
const SHARE_RANGE = [0.2, 0.9] as const;
const LIST_MIN = 440;
const SIDE_MIN = 280;
/** The card's share of the height beside the table, over its tags, and
 *  how far a drag can take it (bridge.py's SPLIT_RANGE): the card at least
 *  CARD_MIN high, the tags TAGS_MIN (the rows in the stylesheet's .side). */
const CARD_SPLIT = 0.6;
const SPLIT_RANGE = [0.15, 0.9] as const;
const CARD_MIN = 140;
const TAGS_MIN = 90;
/** The splitters' thickness (.main's and .side's 12px tracks). */
const GUTTER = 12;
const FACET_SLICE = 3000;
/** Facets (the filter counts) wait for a new view's first card: reading
 *  them keeps Python busy, which holds up the card's images. At most this
 *  long, for a card that never comes. */
const FACETS_AFTER_MS = 400;

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
/** Suspend / unsuspend, as Anki's browser has it. */
const SUSPEND_KEY = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘J" : "Ctrl+J";
/** First direction when you sort by a column. */
const SORT_START: Record<SortKey, 1 | -1> = { order: 1, state: 1, yield: 1, banks: -1, later: -1, verdict: -1, deck: 1 };

const fmt = (n: number) => n.toLocaleString("en-US");
const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));
const pct = (share: number) => `${(share * 100).toFixed(1)}%`;
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
  /** Rows and facets, per card, kept across views. */
  private cache = new Cache();
  /** The view's cards whose answers the list keeps back. */
  private hidden = new Set<number>();
  private rowsWanted = new Set<number>();
  /** Rows asked for and not back yet. A new set when the cards change (see
   *  retag), so they're asked for again at once: the answers on their way
   *  are for the cards as they were, and are dropped. */
  private rowsInFlight = new Set<number>();
  private rowsQueued = false;
  private facets: Facets | null = null;
  private facetsSeq = -1;
  /** Bumped by each loadFacets, so an older one stops asking. */
  private facetsRun = 0;
  private filter: FilterKey = "all";
  /** The view you've picked in the bar and don't have yet: the bar shows
   *  it at once, the table shows placeholder rows until its cards come. */
  private wantLens: string | null = null;
  private lensBusy = false;
  /** Selecting: v keeps selecting as you move until v or Esc; Shift with
   *  an arrow or a click selects once, until a move without it. The
   *  selection runs from the anchor (an index in `shown`) to the cursor. */
  private visual = false;
  private anchor: number | null = null;
  private rangeShown = "";
  /** The card you were on when the switch started, for if it doesn't. */
  private switchKeep: number | null = null;
  /** The view whose facets wait for its first card (see FACETS_AFTER_MS). */
  private facetsAfterCard: number | null = null;
  private facetsTimer = 0;
  private sort: SortKey = "order";
  private sortDir: 1 | -1 = 1;
  private listShare = LIST_SHARE;
  private cardSplit = CARD_SPLIT;
  private tagsOpen = true;
  private sideEl: HTMLElement;
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
  private lensBar: HTMLElement;
  /** The keys you press, shown over the table's corner. */
  private cast: KeyCast;
  private message: HTMLElement;
  private hints: HTMLElement;
  private appEl: HTMLElement;
  readonly actionsSlot: HTMLElement;
  readonly chromeHost: HTMLElement;

  constructor(root: HTMLElement, boot: Boot) {
    this.view = boot.view;
    this.config = boot.config;
    this.side = boot.config.startSide;

    const app = el("div", "app");
    this.appEl = app;
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
    this.lensBar = el("div", "lenses");
    this.chips = el("div", "chips");
    listPanel.append(this.lensBar, this.chips);
    const splitter = el("div", "splitter");
    splitter.title = "Drag to resize; double-click to reset";
    const right = el("div", "side");
    this.sideEl = right;
    const cardPanel = el("section", "panel card-panel");
    const stageEl = el("div", "stage");
    this.message = el("div", "stage-msg");
    cardPanel.append(stageEl, this.message);
    const rowSplitter = el("div", "row-splitter");
    rowSplitter.title = "Drag to resize; double-click to reset";
    const tagsPanel = el("section", "panel tags-panel");
    right.append(cardPanel, rowSplitter, tagsPanel);
    main.append(listPanel, splitter, right);
    this.hints = el("footer", "hints");
    this.chromeHost = el("div", "chrome");
    app.append(bar, main, this.hints);
    root.append(app, this.chromeHost);

    this.list = new CardList(listPanel, {
      row: (cid) => this.rowFor(cid),
      need: (cids) => this.needRows(cids),
      pick: (i, extend) => this.go(i, true, extend),
      sort: (key) => this.sortBy(key),
    });
    this.cast = new KeyCast(listPanel);
    this.pane = new TagsPane(tagsPanel, () => this.toggleTags());
    this.stage = new Stage(stageEl, boot.frame, {
      fetch: (ids) => call<{ cards: Record<string, CardHtml | null> }>("cards", { ids }).then((r) => r.cards),
      onKey: (e) => this.onKey(e),
      onShown: (cid, side) => this.shown_(cid, side),
    });

    this.setListShare(boot.layout.share ?? LIST_SHARE);
    this.setCardSplit(boot.layout.split ?? CARD_SPLIT);
    this.setTagsOpen(boot.layout.tags ?? true);
    this.wireSplitters(splitter, main, rowSplitter, right);
    this.wireSearch();
    // On <html>, not the window: Anki listens on the document and closes
    // the whole window on Esc, and a key reaches <html> first. A key Skim
    // takes stops here (Esc ends a selection or a count before it closes).
    document.documentElement.addEventListener("keydown", (e) => this.onKey(e));
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
      case "reveal":
        // The reviewer showed this card's answer: show it here too, and
        // let its row say what it is (the kept one doesn't).
        this.hidden.delete(e.cid);
        this.list.refresh(true);
        this.setSide("answer");
        break;
      case "lenses":
        // The bar's counts, once the window has counted them.
        if (e.seq !== this.view.seq) break;
        this.view = { ...this.view, lenses: e.lenses };
        this.renderLenses();
        break;
      case "shown":
        this.view = { ...this.view, back: e.back };
        this.renderChrome();
        break;
      case "config":
        this.setConfig(e.config);
        break;
    }
  }

  setView(view: View, first = false): void {
    if (!first && view.seq <= this.view.seq) return;
    // Mid-switch, only the view you picked shows (a review moving on in
    // the meantime mustn't take its place).
    if (!first && this.wantLens !== null && view.lens !== this.wantLens) return;
    this.endSwitch();
    this.view = view;
    this.hidden = new Set(view.hidden ?? []);
    // Kept from an earlier view of these cards, read the same way?
    this.facets = this.cache.facets(view.reading, view.ids);
    this.keys.reset();
    if (document.activeElement !== this.input) this.input.value = view.search;
    // From a review: the side the reviewer is on (front until you answer).
    if (view.side) this.side = view.side;
    this.renderChrome();
    this.relist(view.select ?? null);
    clearTimeout(this.facetsTimer);
    if (this.facets) {
      this.facetsSeq = view.seq;
      this.facetsAfterCard = null;
      return;
    }
    // Once its first card is on screen (see FACETS_AFTER_MS).
    this.facetsAfterCard = view.seq;
    this.facetsTimer = window.setTimeout(() => this.startFacets(view.seq), view.ids.length ? FACETS_AFTER_MS : 0);
  }

  // --- selecting ---------------------------------------------------------------

  /** The selected rows of `shown`, first and last, or null. */
  private range(): [number, number] | null {
    if (this.anchor === null || !this.shown.length) return null;
    return [Math.min(this.anchor, this.cursor), Math.max(this.anchor, this.cursor)];
  }

  private endSelection(): void {
    this.visual = false;
    this.anchor = null;
    this.renderSelection();
  }

  /** The selection on the rows, its size beside the position, and the
   *  hints for it. Cheap when nothing changed (it runs on every move). */
  private renderSelection(): void {
    const r = this.range();
    const n = this.shown.length;
    this.pos.textContent = n
      ? `${fmt(this.cursor + 1)} of ${fmt(n)}${r ? ` · ${fmt(r[1] - r[0] + 1)} selected` : ""}`
      : "";
    const key = r ? r.join(":") : "";
    if (key === this.rangeShown) return;
    const was = this.rangeShown !== "";
    this.rangeShown = key;
    this.list.setRange(r);
    if (was !== !!r) this.renderHints();
  }

  /** Cmd+J: suspend the selected cards (or the one you're on), or unsuspend
   *  them if they all are. */
  private toggleSuspend(): void {
    const r = this.range();
    const ids = r ? this.shown.slice(r[0], r[1] + 1) : this.shown.slice(this.cursor, this.cursor + 1);
    if (!ids.length) return;
    call<{ suspended?: boolean; count?: number }>("suspend", { ids }).then((res) => {
      if (!res.count) return;
      const what = `${fmt(res.count)} card${res.count === 1 ? "" : "s"}`;
      this.chrome?.toast(`${res.suspended ? "Suspended" : "Unsuspended"} ${what}`, "ok");
    }, () => {});
  }

  /** A card's row as it should show in this view, if it's kept. */
  private rowFor(cid: number): Row | undefined {
    return this.cache.row(this.view.reading, cid, this.hidden.has(cid));
  }

  private startFacets(seq: number): void {
    if (this.facetsAfterCard !== seq) return;
    this.facetsAfterCard = null;
    clearTimeout(this.facetsTimer);
    if (this.view.seq === seq && this.facetsSeq !== seq) this.loadFacets();
  }

  // --- switching views -----------------------------------------------------------

  /** Go to one of the bar's views. The bar and the table change now; the
   *  cards follow when Python has found them. Quick presses in a row ask
   *  only for the last view. */
  private switchLens(key: string): void {
    if (key === (this.wantLens ?? this.view.lens)) return;
    if (this.wantLens === null) this.switchKeep = this.shown[this.cursor] ?? null;
    this.wantLens = key;
    this.showSkeleton(key);
    this.sendLens();
  }

  private sendLens(): void {
    const key = this.wantLens;
    if (this.lensBusy || key === null) return;
    this.lensBusy = true;
    call<{ view?: View }>("review_lens", { lens: key })
      .then((r) => r.view, () => undefined)
      .then((view) => {
        this.lensBusy = false;
        if (this.wantLens === null) return; // already showing
        if (this.wantLens !== key) return this.sendLens(); // you've moved on
        if (view && view.lens === key) return this.setView(view);
        // Python showed something else, or couldn't switch.
        this.wantLens = null;
        if (view && view.seq > this.view.seq) this.setView(view);
        else this.cancelSwitch();
      });
  }

  /** The table while a view's cards are on their way: as many placeholder
   *  rows as the view has cards (a screenful at most). */
  private showSkeleton(key: string): void {
    const count = this.view.lenses?.find(([k]) => k === key)?.[2] ?? null;
    const page = this.list.pageRows();
    this.appEl.classList.add("switching");
    this.keys.reset();
    this.holdCast();
    this.shown = [];
    this.cursor = 0;
    this.endSelection();
    this.list.skeleton(count === null ? page : Math.min(count, page));
    this.pos.textContent = "";
    this.message.hidden = true;
    this.renderLenses();
    this.renderChips();
  }

  private endSwitch(): void {
    this.wantLens = null;
    this.appEl.classList.remove("switching");
  }

  /** The switch didn't happen: back to the view you had. */
  private cancelSwitch(): void {
    this.endSwitch();
    this.renderLenses();
    this.relist(this.switchKeep);
  }

  setConfig(config: PageConfig): void {
    const startChanged = config.startSide !== this.config.startSide;
    const retag = config.waitBelow !== this.config.waitBelow || config.systemDone !== this.config.systemDone;
    this.config = config;
    if (startChanged) this.setSide(config.startSide);
    if (retag) this.retag();
  }

  /** Stepwise's plan or the cards changed: read rows and facets again,
   *  forgetting the ones kept for other views too. */
  private retag(): void {
    this.cache.clear();
    this.rowsInFlight = new Set();
    this.list.refresh(true);
    this.facets = null;
    // A view whose first card isn't on screen yet gets its facets once it
    // is (see FACETS_AFTER_MS): the cards changing doesn't hurry them.
    if (this.facetsAfterCard === null) this.loadFacets();
    this.showPane();
  }

  /** Fill the table from the view, filtered and sorted, keeping the card
   *  you're on if it's still there. */
  private relist(keep: number | null): void {
    this.endSelection(); // the rows are about to move
    const ids = this.view.ids;
    let order = ids.map((_, i) => i);
    const f = this.facets;
    const lens = !!f && (this.filter !== "all" || this.sort !== "order");
    if (f && lens) {
      const filter = FILTERS.find((x) => x.key === this.filter);
      if (filter && filter.key !== "all") order = order.filter((i) => filter.test(f, i));
      if (this.sort !== "order") {
        const d = this.sortDir;
        const decks = this.sort === "deck" ? this.cache.deckRanks(f.deck) : null;
        const value = (i: number): number => {
          switch (this.sort) {
            case "state": return f.state[i];
            case "yield": return f.yield[i] || 9;
            case "banks": return f.banks[i];
            case "later": return f.later[i];
            case "verdict": return f.verdict[i];
            case "deck": return decks!.get(f.deck[i]) ?? 0;
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

  /** The view's facets: the kept ones, and the rest from Python a slice
   *  at a time (kept too, for the next view of these cards). */
  private loadFacets(): void {
    const { seq, ids, reading } = this.view;
    const gen = this.cache.gen;
    const run = ++this.facetsRun;
    this.facetsSeq = seq;
    const missing = this.cache.missingFacets(reading, ids);
    const live = () => this.facetsRun === run && this.view.seq === seq && this.cache.gen === gen;
    const next = (start: number): void => {
      if (start < missing.length) {
        const slice = missing.slice(start, start + FACET_SLICE);
        call<{ ids?: number[]; facets?: Facets; decks?: Record<string, string>; reading?: string; stale?: boolean }>(
          "facets", { seq, ids: slice })
          .then((r) => {
            if (r.stale || !r.ids || !r.facets || this.cache.gen !== gen) return;
            this.cache.putFacets(r.reading ?? "", r.ids, r.facets);
            this.cache.putDecks(r.decks);
            if (live() && r.reading === reading) next(start + FACET_SLICE);
          })
          .catch(() => {});
        return;
      }
      const f = this.cache.facets(reading, ids);
      if (!f || !live()) return;
      this.facets = f;
      if (this.wantLens !== null) return; // the table waits for the next view
      const keep = this.shown[this.cursor] ?? null;
      if (this.filter !== "all" || this.sort !== "order") this.relist(keep);
      else this.renderChips();
    };
    next(0);
  }

  private update(input: boolean): void {
    const ids = this.shown;
    this.holdCast();
    if (!ids.length) {
      this.stage.clear();
      this.pane.show(null);
      this.pos.textContent = "";
      this.message.textContent = this.view.error
        ? this.view.error
        : this.view.ids.length
          ? "No cards match this filter."
          : this.view.search || this.view.source || this.view.title
            ? "No cards match."
            : "Search for cards with /";
      this.message.classList.toggle("error", !!this.view.error);
      this.message.hidden = false;
      return;
    }
    this.message.hidden = true;
    this.list.setCursor(this.cursor);
    this.renderSelection();
    this.stage.want(this.wanted(), this.prefetch(), input);
    this.showPane();
  }

  private showPane(): void {
    if (this.wantLens !== null) return; // keeps the card you were on, dimmed
    const cid = this.shown[this.cursor];
    const row = cid !== undefined ? this.rowFor(cid) : undefined;
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

  private go(index: number, input: boolean, extend = false): void {
    const n = this.shown.length;
    if (!n) return;
    // Moves select while v is on, or with Shift; a move without either
    // ends a Shift selection.
    if (extend || this.visual) this.anchor ??= this.cursor;
    else this.anchor = null;
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
    if (this.facetsAfterCard !== null) this.startFacets(this.facetsAfterCard);
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
    if (this.wantLens !== null) return;
    if (!this.facets && key !== "all") return; // counts are on their way
    this.filter = key;
    this.relist(this.shown[this.cursor] ?? null);
  }

  private sortBy(key: SortKey): void {
    if (this.wantLens !== null) return;
    if (!this.facets && key !== "order") return;
    if (this.sort === key && key !== "order") this.sortDir = this.sortDir === 1 ? -1 : 1;
    else {
      this.sort = key;
      this.sortDir = SORT_START[key];
    }
    this.relist(this.shown[this.cursor] ?? null);
  }

  /** The Verdict column only where a card can have one: on a topic, with
   *  a suspended card (a review's cards and the Today views have none).
   *  It stays as it was while the counts are on their way. */
  private showVerdicts(): void {
    if (!this.view.topics.length) this.list.setVerdicts(false);
    else if (this.facets && this.wantLens === null) this.list.setVerdicts(this.facets.verdict.some((v) => v > 0));
  }

  private renderChips(): void {
    this.showVerdicts();
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
        if (this.wantLens !== null) count = "…";
        else if (x.key === "all") count = fmt(n);
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
    this.cast.press(e);
    const cmd = this.keys.feed(e);
    this.holdCast();
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
        return this.go(this.cursor + cmd.by, true, cmd.extend);
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
      case "lens": {
        const lenses = this.view.lenses ?? [];
        if (!lenses.length) return;
        const on = this.wantLens ?? this.view.lens;
        const at = Math.max(0, lenses.findIndex(([k]) => k === on));
        return this.switchLens(lenses[(at + cmd.by + lenses.length) % lenses.length][0]);
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
      case "escape":
        if (this.visual || this.anchor !== null) return this.endSelection();
        void call("close");
        return;
      case "visual":
        if (!n) return;
        this.visual = !this.visual;
        this.anchor = this.visual ? this.cursor : null;
        return this.renderSelection();
      case "suspend":
        return this.toggleSuspend();
      case "help":
        this.chrome?.toggleHelp();
        return;
      case "tags":
        return this.toggleTags();
      case "cancel":
        return;
    }
  }

  /** The keys stay up while a command is half typed (a number, a first g). */
  private holdCast(): void {
    this.cast.hold(this.keys.typed !== "");
  }

  // --- list rows -----------------------------------------------------------------

  private needRows(cids: number[]): void {
    for (const c of cids) if (!this.rowFor(c) && !this.rowsInFlight.has(c)) this.rowsWanted.add(c);
    if (this.rowsQueued || !this.rowsWanted.size) return;
    this.rowsQueued = true;
    queueMicrotask(() => {
      this.rowsQueued = false;
      const ids = [...this.rowsWanted].slice(0, 400);
      this.rowsWanted.clear();
      const gen = this.cache.gen;
      const asked = this.view.reading;
      const flight = this.rowsInFlight;
      ids.forEach((c) => flight.add(c));
      // Before anything asks again (below, for another reading).
      const back = () => ids.forEach((c) => flight.delete(c));
      call<{ rows: Record<string, Row>; reading?: string }>("rows", { ids })
        .then((r) => {
          back();
          if (this.cache.gen !== gen) return; // the cards changed meanwhile: asked again already
          // Kept under what Python read them against, which a switch may
          // have changed since they were asked for.
          const reading = r.reading ?? asked;
          for (const c of ids) {
            const gone: Row = { t: "(deleted)", k: "", q: 99, f: 0, ...(this.hidden.has(c) ? { h: 1 } : {}) };
            this.cache.putRow(reading, c, r.rows[String(c)] ?? gone);
          }
          // Rows for another reading: ask again for this one's.
          this.list.refresh(reading !== this.view.reading);
          this.showPane();
        })
        .catch(() => {})
        .finally(back);
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
    this.renderLenses();
    this.renderHints();
  }

  /** All, the review's session and Anki's Today searches, with counts. */
  private renderLenses(): void {
    const lenses = this.view.lenses ?? [];
    this.lensBar.hidden = !lenses.length;
    this.lensBar.replaceChildren(
      ...lenses.map(([key, label, count]) => {
        const on = key === (this.wantLens ?? this.view.lens);
        const b = el("button", `lens${on ? " on" : ""}${count === 0 ? " empty" : ""}`);
        b.type = "button";
        b.tabIndex = -1;
        b.append(el("span", "", label), el("span", "lens-n num", count === null ? "" : fmt(count)));
        b.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.switchLens(key);
        });
        return b;
      }),
    );
  }

  private renderSides(): void {
    for (const b of this.sides.querySelectorAll<HTMLButtonElement>("button")) {
      b.classList.toggle("active", b.dataset.side === this.side);
    }
  }

  private renderHints(): void {
    const groups: [string[], string][] = this.range()
      ? [
          [["j", "k"], "select"],
          [[SUSPEND_KEY], "suspend / unsuspend"],
          [["Esc"], "done selecting"],
        ]
      : [
          [["j", "k"], "move"],
          [["h", "l"], "front, back"],
          [["v"], "select"],
          [["f"], "filter"],
          [["/"], "search"],
          [["e"], "edit"],
        ];
    if (!this.range() && this.view.lenses?.length) groups.push([["t"], "view"]);
    if (!this.range() && this.view.back) groups.push([["p"], `back to ${this.view.back}`]);
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
        call<{ view: View }>("search", { query }).then((r) => {
          this.endSwitch(); // a search wins over a view you were switching to
          this.setView(r.view);
        }, () => {});
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        this.input.value = this.view.search;
        this.input.blur();
      }
    });
  }

  // --- layout ----------------------------------------------------------------

  /** The table's share of the width; it never gets narrower than its
   *  last columns need (--list-min in the stylesheet), whatever the share. */
  private setListShare(share: number): void {
    this.listShare = clamp(share || LIST_SHARE, ...SHARE_RANGE);
    document.documentElement.style.setProperty("--list-share", pct(this.listShare));
  }

  /** The card's share of the height beside the table; the tags get the rest. */
  private setCardSplit(split: number): void {
    this.cardSplit = clamp(split || CARD_SPLIT, ...SPLIT_RANGE);
    document.documentElement.style.setProperty("--card-split", pct(this.cardSplit));
  }

  /** Fold the tags pane to its title (the card takes its room), or open it. */
  private setTagsOpen(open: boolean): void {
    this.tagsOpen = open;
    this.sideEl.classList.toggle("tags-closed", !open);
    this.pane.setOpen(open);
  }

  private toggleTags(): void {
    this.setTagsOpen(!this.tagsOpen);
    void call("layout", { tags: this.tagsOpen });
  }

  /** Back to the layout Skim starts with (Reset layout in the ⋯ menu): the
   *  table at three quarters of the width, the card over its tags at 60%,
   *  the tags open. What's saved is forgotten, so new defaults apply. */
  resetLayout(): void {
    this.setListShare(LIST_SHARE);
    this.setCardSplit(CARD_SPLIT);
    this.setTagsOpen(true);
    void call("layout", { reset: true });
  }

  /** Whether the layout is other than the one Skim starts with. */
  layoutChanged(): boolean {
    return this.listShare !== LIST_SHARE || this.cardSplit !== CARD_SPLIT || !this.tagsOpen;
  }

  /** Drag the edge between the table and the card to resize them, and the
   *  one between the card and its tags; double-click one to put it back. */
  private wireSplitters(cols: HTMLElement, main: HTMLElement, rows: HTMLElement, side: HTMLElement): void {
    this.dragSplitter(cols, "drag-cols", () => {
      const box = main.getBoundingClientRect();
      const inner = box.width - 32; // .main's side padding
      const low = LIST_MIN / inner;
      const high = (inner - GUTTER - SIDE_MIN) / inner;
      return (e) => this.setListShare(clamp((e.clientX - box.left - 16 - GUTTER / 2) / inner, low, high));
    }, () => {
      this.setListShare(LIST_SHARE);
    }, () => void call("layout", { share: this.listShare }));
    this.dragSplitter(rows, "drag-rows", () => {
      const box = side.getBoundingClientRect();
      const low = CARD_MIN / box.height;
      const high = (box.height - GUTTER - TAGS_MIN) / box.height;
      return (e) => this.setCardSplit(clamp((e.clientY - box.top - GUTTER / 2) / box.height, low, high));
    }, () => {
      this.setCardSplit(CARD_SPLIT);
    }, () => void call("layout", { split: this.cardSplit }));
  }

  /** `start` reads the layout when a drag starts and returns what each move
   *  does; `reset` is for a double-click; `save` runs when either is done. */
  private dragSplitter(
    handle: HTMLElement,
    cls: string,
    start: () => (e: PointerEvent) => void,
    reset: () => void,
    save: () => void,
  ): void {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      // The card frames would take the pointer as it crosses them.
      this.appEl.classList.add("dragging", cls);
      const move = start();
      const up = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.appEl.classList.remove("dragging", cls);
        save();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    handle.addEventListener("dblclick", () => {
      reset();
      save();
    });
  }

  cardId(): number | undefined {
    return this.shown[this.cursor];
  }
}
