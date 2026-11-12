// The page: toolbar, card list and card, wired to the keys. Plain DOM, no
// framework: a key press goes from here straight to the list and the card
// frames, with nothing to re-render in between. The dialogs, menu and
// toasts (chrome/) are React, and only run when you open them.

import { call } from "./bridge.ts";
import type { ChromeApi } from "./chrome/Chrome.tsx";
import { type Command, Keys } from "./keys.ts";
import { CardList } from "./list.ts";
import { Stage, type Want } from "./stage.ts";
import type { CardHtml, Layout, PageConfig, PushEvent, Row, Side, View } from "./types.ts";

const SEARCH_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const MAX_ROWS_KEPT = 20000;
const LIST_MIN = 220;
const CARD_MIN = 320;

export interface Boot {
  view: View;
  frame: string;
  config: PageConfig;
  layout: Layout;
}

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
  private cursor = 0;
  private dir: 1 | -1 = 1;
  private keys = new Keys();
  private rows = new Map<number, Row>();
  private rowsWanted = new Set<number>();
  private rowsInFlight = new Set<number>();
  private rowsQueued = false;
  private autoplayTimer = 0;
  private lastPlayed = "";
  private chrome!: ChromeApi;

  private list: CardList;
  private stage: Stage;
  private input: HTMLInputElement;
  private sourceEl: HTMLElement;
  private sides: HTMLElement;
  private pos: HTMLElement;
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
    this.typed = el("div", "typed num");
    const splitter = el("div", "splitter");
    splitter.title = "Drag to resize";
    const cardPanel = el("section", "panel card-panel");
    const stageEl = el("div", "stage");
    this.message = el("div", "stage-msg");
    cardPanel.append(stageEl, this.message);
    main.append(listPanel, splitter, cardPanel);
    this.hints = el("footer", "hints");
    this.chromeHost = el("div", "chrome");
    app.append(bar, main, this.hints);
    root.append(app, this.chromeHost);

    this.list = new CardList(listPanel, {
      row: (cid) => this.rows.get(cid),
      need: (cids) => this.needRows(cids),
      pick: (i) => this.go(i, true),
    });
    listPanel.append(this.typed);
    this.stage = new Stage(stageEl, boot.frame, {
      fetch: (ids) => call<{ cards: Record<string, CardHtml | null> }>("cards", { ids }).then((r) => r.cards),
      onKey: (e) => this.onKey(e),
      onShown: (cid, side) => this.shown(cid, side),
    });

    this.setListWidth(boot.layout.listWidth ?? 380);
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
        this.rows.clear();
        this.list.refresh(true);
        this.stage.invalidate();
        this.update(false);
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
    if (this.rows.size > MAX_ROWS_KEPT) this.rows.clear();
    this.cursor = 0;
    this.dir = 1;
    this.keys.reset();
    if (document.activeElement !== this.input) this.input.value = view.search;
    this.list.setIds(view.ids, 0);
    this.renderChrome();
    this.update(false);
  }

  setConfig(config: PageConfig): void {
    const startChanged = config.startSide !== this.config.startSide;
    this.config = config;
    if (startChanged) this.setSide(config.startSide);
  }

  private update(input: boolean): void {
    const ids = this.view.ids;
    this.showTyped();
    if (!ids.length) {
      this.stage.clear();
      this.pos.textContent = "";
      this.message.textContent = this.view.error
        ? this.view.error
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
  }

  /** The card on screen, then the ones you're likely to want next. */
  private wanted(): Want[] {
    const ids = this.view.ids;
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
    const ids = this.view.ids;
    const out: number[] = [];
    for (let k = 4; k <= 8; k++) {
      const j = this.cursor + k * this.dir;
      if (j >= 0 && j < ids.length) out.push(ids[j]);
    }
    return out;
  }

  private go(index: number, input: boolean): void {
    const n = this.view.ids.length;
    if (!n) return;
    const i = Math.max(0, Math.min(n - 1, index));
    if (i !== this.cursor) this.dir = i > this.cursor ? 1 : -1;
    this.cursor = i;
    this.update(input);
  }

  private setSide(side: Side): void {
    this.side = side;
    this.renderSides();
    if (this.view.ids.length) this.stage.want(this.wanted(), this.prefetch(), true);
  }

  private shown(cid: number, side: Side): void {
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
    const n = this.view.ids.length;
    const cid = this.view.ids[this.cursor];
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
      ids.forEach((c) => this.rowsInFlight.add(c));
      call<{ rows: Record<string, Row> }>("rows", { ids })
        .then((r) => {
          for (const c of ids) this.rows.set(c, r.rows[String(c)] ?? ["(deleted)", "", 99, 0]);
          this.list.refresh();
        })
        .catch(() => {})
        .finally(() => ids.forEach((c) => this.rowsInFlight.delete(c)));
    });
  }

  // --- toolbar and footer --------------------------------------------------------

  private renderChrome(): void {
    const v = this.view;
    this.sourceEl.replaceChildren();
    if (v.source || v.title) {
      if (v.source) {
        const chip = el("span", "source-from");
        chip.textContent = v.source;
        chip.title = `Following ${v.source}: these are the cards of what's selected there`;
        this.sourceEl.append(chip);
      }
      if (v.title) {
        const title = el("span", "source-title");
        title.textContent = v.title;
        this.sourceEl.append(title);
      }
    }
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
      [["Space"], "flip"],
      [["/"], "search"],
      [["e"], "edit"],
    ];
    if (this.view.back) groups.push([["p"], `back to ${this.view.back}`]);
    groups.push([["?"], "all keys"]);
    this.hints.replaceChildren(
      ...groups.map(([keys, label]) => {
        const g = el("span", "hint");
        for (const k of keys) g.append(el("kbd", "", k));
        const l = el("span", "hint-label");
        l.textContent = label;
        g.append(l);
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

  private setListWidth(px: number): void {
    const max = Math.max(LIST_MIN, window.innerWidth - CARD_MIN - 48);
    const w = Math.max(LIST_MIN, Math.min(max, Math.round(px)));
    document.documentElement.style.setProperty("--list-w", `${w}px`);
  }

  private dragToResize(splitter: HTMLElement, main: HTMLElement): void {
    splitter.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      splitter.setPointerCapture(e.pointerId);
      const left = main.getBoundingClientRect().left + 16;
      const move = (ev: PointerEvent) => this.setListWidth(ev.clientX - left - 6);
      const up = () => {
        splitter.removeEventListener("pointermove", move);
        splitter.removeEventListener("pointerup", up);
        const w = parseInt(getComputedStyle(document.documentElement).getPropertyValue("--list-w"), 10);
        if (w) void call("layout", { listWidth: w });
      };
      splitter.addEventListener("pointermove", move);
      splitter.addEventListener("pointerup", up);
    });
  }

  cardId(): number | undefined {
    return this.view.ids[this.cursor];
  }
}
