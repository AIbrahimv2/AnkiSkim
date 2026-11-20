// Editing the card you're on (e): its note's fields take the table's place,
// with vim keys (editor.ts), and the card beside them is the preview. What
// you change is saved by itself: when you leave insert mode, a moment after
// you stop typing, and before anything else shows.
//
// Opening it is one call to Python for the note; nothing else is asked for
// while you type.

import { call } from "../bridge.ts";
import { type Clip, Editor, type FieldData } from "./editor.ts";
import type { Command, Mode } from "./vim.ts";

export interface Note {
  nid: number;
  cid: number;
  notetype: string;
  cloze: boolean;
  /** The card's type ("Cloze 2", "Card 1"). */
  card: string;
  fields: FieldData[];
  /** What Anki's editor would warn about. */
  problem: string | null;
}

export interface SessionHost {
  /** A note was written: the cards drawn are out of date. */
  saved(): void;
  /** Move to the next (or previous) card; its id, or null at the end. */
  step(dir: 1 | -1): number | null;
  /** Editing is over: back to the table. */
  exit(): void;
  flip(): void;
  help(): void;
  browse(cid: number): void;
  toast(message: string, tone?: "ok" | "info" | "error"): void;
}

/** Save this long after the last change, if nothing saved it sooner. */
const SAVE_AFTER_MS = 600;

const MODES: Record<Mode, string> = { normal: "Normal", insert: "Insert", visual: "Visual", vline: "Visual line" };

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class EditSession {
  /** The panel: put it where the table is. */
  readonly el: HTMLElement;
  private host: SessionHost;
  private editor: Editor;
  private note: Note | null = null;
  private timer = 0;
  private saving = 0;
  /** Bumped by each open and close, so an older one's note is dropped. */
  private run = 0;
  private steps: Promise<void> = Promise.resolve();
  private noClipboard = false;
  private kind: HTMLElement;
  private state: HTMLElement;
  private mode: HTMLElement;
  private typed: HTMLElement;
  private warn: HTMLElement;

  constructor(host: SessionHost) {
    this.host = host;
    this.el = el("section", "panel edit-panel");
    this.el.hidden = true;
    const head = el("header", "edit-head");
    this.kind = el("div", "edit-kind");
    this.state = el("div", "edit-state");
    head.append(this.kind, this.state);
    this.editor = new Editor({
      changed: () => this.changed(),
      status: () => this.renderStatus(),
      settled: () => this.flush(),
      command: (cmd) => this.command(cmd),
      upload: (file) => this.upload(file),
      clipboard: (markOnly) => this.clipboard(markOnly),
    });
    this.warn = el("div", "edit-warn");
    this.warn.hidden = true;
    const foot = el("footer", "edit-foot");
    this.mode = el("span", "edit-mode");
    this.typed = el("span", "edit-typed");
    const hints = el("span", "edit-hints");
    for (const [keys, label] of [[["i"], "type"], [["Esc"], "stop typing"], [["J", "K"], "next / previous note"], [["q"], "done"], [["?"], "all keys"]] as const) {
      const g = el("span", "hint");
      for (const k of keys) g.append(el("kbd", "", k));
      g.append(el("span", "hint-label", label));
      hints.append(g);
    }
    foot.append(this.mode, this.typed, hints);
    this.el.append(head, this.editor.el, this.warn, foot);
  }

  /** The height a pasted picture is given (Settings); 0 for its own. */
  setPasteHeight(px: number): void {
    this.editor.pasteHeight = px > 0 ? Math.round(px) : 0;
  }

  get active(): boolean {
    return !this.el.hidden;
  }

  /** Edit this card's note. Resolves once its fields are up (false if the
   *  card is gone). */
  async open(cid: number): Promise<boolean> {
    const run = ++this.run;
    const r = await call<{ note: Note | null }>("note", { cid });
    if (run !== this.run) return false;
    if (!r.note) {
      this.host.toast("That card no longer exists.", "error");
      return false;
    }
    this.show(r.note);
    return true;
  }

  private show(note: Note): void {
    this.note = note;
    this.el.hidden = false;
    this.kind.replaceChildren(el("span", "edit-type", note.notetype), el("span", "edit-card", note.card));
    this.editor.load(note.fields);
    this.setProblem(note.problem);
    this.renderState();
    this.renderStatus();
  }

  /** Stop editing: what's unsaved is saved, and the table comes back. */
  close(): void {
    if (!this.active) return;
    this.run++;
    this.flush();
    this.el.hidden = true;
    this.note = null;
  }

  onKey(e: KeyboardEvent): void {
    if (this.note) this.editor.onKey(e);
  }

  /** The keys come back to the fields (a dialog closed, the window shown). */
  focus(): void {
    if (this.note) this.editor.focus();
  }

  /** The note changed somewhere else (Anki's browser, an undo): fields
   *  you haven't touched take the new text. */
  async refresh(): Promise<void> {
    const note = this.note;
    if (!note) return;
    const run = this.run;
    const r = await call<{ note: Note | null }>("note", { cid: note.cid });
    if (run !== this.run || this.note !== note || !r.note) return;
    if (r.note.nid !== note.nid || !this.editor.refresh(r.note.fields)) this.show(r.note);
    else this.setProblem(r.note.problem);
  }

  // --- saving ------------------------------------------------------------------

  private changed(): void {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.flush(), SAVE_AFTER_MS);
    this.renderState();
  }

  /** What's unsaved, taken as saved: for Python to write when the page is
   *  about to go (the window's flush). */
  take(): { nid: number; fields: Record<string, string> } | null {
    const note = this.note;
    const fields = note && this.editor.dirty();
    if (!note || !fields) return null;
    clearTimeout(this.timer);
    this.editor.saved(fields);
    this.renderState();
    return { nid: note.nid, fields };
  }

  /** Save what's unsaved, now. */
  flush(): void {
    clearTimeout(this.timer);
    const note = this.note;
    const fields = note && this.editor.dirty();
    if (!note || !fields) return;
    const before = this.editor.saved(fields);
    this.saving++;
    this.renderState();
    call<{ saved?: boolean; gone?: boolean; problem?: string | null }>("save", { nid: note.nid, fields })
      .then((r) => {
        if (r.gone) this.host.toast("That note was deleted, so it couldn't be saved.", "error");
        if (this.note === note) this.setProblem(r.problem ?? null);
        if (r.saved) this.host.saved();
      })
      .catch(() => {
        // Shown by the bridge. Still unsaved: the next change tries again.
        if (this.note === note) this.editor.unsaved(before);
      })
      .finally(() => {
        this.saving--;
        this.renderState();
      });
  }

  /** The system's clipboard, through Anki. Null in a plain browser (the
   *  dev server), where the page's own paste is all there is. */
  private async clipboard(markOnly = false): Promise<Clip | null> {
    if (this.noClipboard) return null;
    const r = await call<Clip & { unsupported?: boolean }>("clipboard", markOnly ? { mark: true } : {});
    if (r.unsupported) {
      this.noClipboard = true;
      return null;
    }
    return r;
  }

  private async upload(file: File): Promise<string | null> {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const r = await call<{ src?: string }>("media", { mime: file.type, name: file.name, data });
    return r.src ?? null;
  }

  // --- commands the fields pass on ----------------------------------------------

  private command(cmd: Command): void {
    switch (cmd.kind) {
      case "note":
        this.step(cmd.by);
        break;
      case "close":
        this.host.exit();
        break;
      case "save":
        this.flush();
        break;
      case "flip":
        this.host.flip();
        break;
      case "help":
        this.host.help();
        break;
      case "browse":
        if (this.note) this.host.browse(this.note.cid);
        break;
      case "scroll":
        this.editor.scroll(cmd.dir);
        break;
    }
  }

  /** J and K: the next note's card, past this note's other cards (a cloze
   *  note's cards sit together in the table). One at a time, so J pressed
   *  twice is two notes on, however fast. */
  private step(by: number): void {
    this.steps = this.steps.then(() => this.stepNow(by)).catch(() => {});
  }

  private async stepNow(by: number): Promise<void> {
    const from = this.note;
    if (!from) return;
    this.flush();
    const run = this.run;
    const dir = by > 0 ? 1 : -1;
    let left = Math.abs(by);
    let nid = from.nid;
    let found: Note | null = null;
    for (;;) {
      const cid = this.host.step(dir);
      if (cid === null) break;
      const r = await call<{ note: Note | null }>("note", { cid });
      if (run !== this.run) return; // closed, or opened on another card
      if (!r.note || r.note.nid === nid) continue;
      found = r.note;
      nid = r.note.nid;
      if (--left <= 0) break;
    }
    if (found) this.show(found);
  }

  // --- what you see ------------------------------------------------------------

  private setProblem(problem: string | null): void {
    this.warn.textContent = problem ?? "";
    this.warn.hidden = !problem;
  }

  private renderState(): void {
    const unsaved = !!this.note && !!this.editor.dirty();
    const text = unsaved ? "Unsaved" : this.saving ? "Saving" : "Saved";
    if (this.state.textContent !== text) this.state.textContent = text;
    this.state.classList.toggle("unsaved", unsaved);
  }

  private renderStatus(): void {
    const mode = this.editor.mode;
    if (this.mode.dataset.mode !== mode) {
      this.mode.dataset.mode = mode;
      this.mode.textContent = MODES[mode];
    }
    const n = this.editor.fieldCount;
    const typed = this.editor.typed || (n > 1 ? `Field ${this.editor.fieldIndex + 1} of ${n}` : "");
    if (this.typed.textContent !== typed) this.typed.textContent = typed;
    this.typed.classList.toggle("keys", !!this.editor.typed);
  }
}
