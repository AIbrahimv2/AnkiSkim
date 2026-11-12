// The card itself, in a ring of frames. Each frame is a copy of Anki's
// reviewer page (reviewer.js, its CSS, the card's own scripts), so a card
// looks and behaves the way it does when you review it.
//
// One frame shows; the others hold the cards you're likely to want next,
// already drawn: the next one, the other side of this one, the previous
// one, and two more ahead. Moving to a card that's ready is one change of
// visibility, about one screen refresh. Drawing a card (~100 ms for an
// AnKing card) happens in the pauses between key presses, one at a time,
// and the card you're on always goes first.

import type { CardHtml, Side } from "./types.ts";

/** Anki's reviewer page, as each frame's window sees it. */
interface ReviewerWindow extends Window {
  _updateQA(html: string, fadeTime: number | null, onUpdate: () => void, onShown: () => void): Promise<void>;
  skimCid?: number;
}

interface Frame {
  el: HTMLIFrameElement;
  win: ReviewerWindow | null;
  cid: number;
  side: Side | null;
  ready: boolean;
  drawing: boolean;
  token: number;
}

/** A card and side, in the order they're wanted (the first shows). */
export type Want = [cid: number, side: Side];

const FRAMES = 6;
/** After a key press, wait this long before drawing cards ahead. */
const IDLE_MS = 140;
/** Card HTML kept in memory (each is ~130 KB for an AnKing card). */
const KEEP_HTML = 40;

export interface StageOptions {
  fetch(cids: number[]): Promise<Record<string, CardHtml | null>>;
  /** Keys pressed while a card frame has the focus (you clicked a card). */
  onKey(e: KeyboardEvent): void;
  /** A card is on screen. */
  onShown(cid: number, side: Side): void;
}

export class Stage {
  private host: HTMLElement;
  private frames: Frame[] = [];
  private visible: Frame | null = null;
  private html = new Map<number, CardHtml | null>();
  private fetching = new Set<number>();
  private wanted: Want[] = [];
  private prefetch: number[] = [];
  private lastInput = 0;
  private busy = false;
  private timer = 0;
  private opts: StageOptions;
  readonly ready: Promise<void>;

  constructor(host: HTMLElement, frameHtml: string, opts: StageOptions) {
    this.host = host;
    this.opts = opts;
    const loads: Promise<void>[] = [];
    for (let i = 0; i < FRAMES; i++) {
      const el = document.createElement("iframe");
      el.className = "card-frame";
      el.tabIndex = -1;
      const frame: Frame = { el, win: null, cid: 0, side: null, ready: false, drawing: false, token: 0 };
      loads.push(this.boot(frame));
      el.srcdoc = frameHtml;
      host.append(el);
      this.frames.push(frame);
    }
    this.ready = Promise.all(loads).then(() => this.pump());
  }

  /** Wait for a frame's reviewer.js, then pass its keys to the page. */
  private boot(frame: Frame): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const win = frame.el.contentWindow as ReviewerWindow | null;
        if (win && typeof win._updateQA === "function") {
          frame.win = win;
          win.addEventListener("keydown", (e) => this.opts.onKey(e), true);
          resolve();
        } else setTimeout(check, 20);
      };
      frame.el.addEventListener("load", check, { once: true });
    });
  }

  /** Show `want[0]` and get the rest ready. Called on every move; `input`
   *  says a key or click caused it, which holds off drawing ahead. */
  want(want: Want[], prefetch: number[], input: boolean): void {
    this.wanted = want;
    this.prefetch = prefetch;
    if (input) this.lastInput = performance.now();
    const first = want[0];
    const f = first && this.holding(first);
    if (f?.ready) this.reveal(f);
    this.host.classList.toggle("waiting", !!first && !f?.ready);
    void this.pump();
  }

  /** Card HTML is out of date (a note was edited): draw everything again. */
  invalidate(): void {
    this.html.clear();
    for (const f of this.frames) {
      f.ready = false;
      f.token++;
      f.cid = 0;
      f.side = null;
    }
    // The visible frame keeps its old card until the new one is drawn.
    void this.pump();
  }

  clear(): void {
    this.wanted = [];
    this.visible?.el.classList.remove("on");
    this.visible = null;
    this.host.classList.remove("waiting");
  }

  /** Scroll the card on screen, in lines of about 40px. */
  scroll(lines: number): void {
    this.visible?.win?.scrollBy({ top: lines * 40, behavior: "instant" });
  }

  shown(): Want | null {
    const v = this.visible;
    return v && v.side ? [v.cid, v.side] : null;
  }

  private holding([cid, side]: Want): Frame | undefined {
    return this.frames.find((f) => f.cid === cid && f.side === side && (f.ready || f.drawing));
  }

  private reveal(f: Frame): void {
    if (this.visible !== f) {
      f.el.classList.add("on");
      this.visible?.el.classList.remove("on");
      this.visible = f;
    }
    this.host.classList.remove("waiting");
    this.opts.onShown(f.cid, f.side!);
  }

  /** Draw what's wanted, most wanted first, one card at a time. */
  private async pump(): Promise<void> {
    if (this.busy || !this.frames.every((f) => f.win)) return;
    this.busy = true;
    try {
      for (;;) {
        const job = this.nextJob();
        if (!job) break;
        if (job.rank > 0) {
          const wait = IDLE_MS - (performance.now() - this.lastInput);
          if (wait > 0) {
            clearTimeout(this.timer);
            this.timer = window.setTimeout(() => void this.pump(), wait + 5);
            break;
          }
        }
        if (!this.html.has(job.cid)) {
          await this.fetchHtml();
          if (!this.html.has(job.cid)) break; // the fetch failed
          continue; // what's wanted may have changed meanwhile
        }
        await this.draw(job.frame, job.cid, job.side);
        const first = this.wanted[0];
        if (first && job.frame.ready && first[0] === job.cid && first[1] === job.side) this.reveal(job.frame);
      }
    } finally {
      this.busy = false;
    }
  }

  private nextJob(): { frame: Frame; cid: number; side: Side; rank: number } | null {
    for (let rank = 0; rank < this.wanted.length; rank++) {
      const [cid, side] = this.wanted[rank];
      if (this.holding([cid, side])) continue;
      const frame = this.victim(rank);
      if (!frame) return null;
      return { frame, cid, side, rank };
    }
    return null;
  }

  /** A frame to draw into: one holding nothing wanted, or else the one
   *  holding the least wanted card below `rank`. Never the one on screen. */
  private victim(rank: number): Frame | null {
    let best: Frame | null = null;
    let bestRank = rank;
    for (const f of this.frames) {
      if (f === this.visible || f.drawing) continue;
      const r = this.wanted.findIndex(([c, s]) => c === f.cid && s === f.side);
      if (r === -1) return f;
      if (r > bestRank) {
        best = f;
        bestRank = r;
      }
    }
    return best;
  }

  private async fetchHtml(): Promise<void> {
    const cids: number[] = [];
    for (const c of [...this.wanted.map(([c]) => c), ...this.prefetch]) {
      if (!this.html.has(c) && !this.fetching.has(c) && !cids.includes(c)) cids.push(c);
    }
    if (!cids.length) return;
    cids.forEach((c) => this.fetching.add(c));
    try {
      const got = await this.opts.fetch(cids);
      for (const c of cids) {
        this.html.delete(c);
        this.html.set(c, got[String(c)] ?? null);
      }
      while (this.html.size > KEEP_HTML) this.html.delete(this.html.keys().next().value!);
    } catch {
      // shown by the bridge; the card stays as it was
    } finally {
      cids.forEach((c) => this.fetching.delete(c));
    }
  }

  private async draw(f: Frame, cid: number, side: Side): Promise<void> {
    const win = f.win!;
    const card = this.html.get(cid);
    const token = ++f.token;
    f.cid = cid;
    f.side = side;
    f.ready = false;
    f.drawing = true;
    win.skimCid = cid;
    const html = card ? (side === "answer" ? card.a : card.q) : '<div class="skim-gone">This card no longer exists.</div>';
    try {
      await win._updateQA(html, null, () => {
        win.scrollTo(0, 0);
        win.document.body.className = card?.cls ?? "card";
      }, () => {});
    } catch (e) {
      console.error(e);
    }
    // Draws are one at a time, so this one is done either way; it only
    // counts if nothing reset the frame meanwhile (see invalidate).
    f.drawing = false;
    if (f.token === token) f.ready = true;
  }
}
