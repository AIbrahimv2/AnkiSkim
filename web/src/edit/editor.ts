// A note's fields, edited with vim keys. Plain DOM: each field is a
// contenteditable, and a key press goes from here straight to the browser's
// own editing commands, with nothing to re-render in between.
//
// Normal and visual mode work on the field as text (flat.ts reads it,
// text.ts has the motions); every change goes through execCommand, so the
// browser's undo stack holds all of it and u / Ctrl-r are its undo and redo.
// Insert mode is the browser's own typing, with symbols as you type
// (symbols.ts) swapped in after it.

import { Flat } from "./flat.ts";
import { type Swap, Symbols } from "./symbols.ts";
import { type Command, type Mode, type Op, Vim } from "./vim.ts";
import {
  type Motion, type Range as Span, clampNormal, clozeAt, clozes, firstNonBlank, lineEnd, lineStart,
  lines, move, nextClozeNumber, range, textObject,
} from "./text.ts";

export interface FieldData {
  name: string;
  html: string;
  rtl: boolean;
  hint: string;
}

export interface EditorHost {
  /** A field changed. */
  changed(): void;
  /** The mode, or what's typed toward a command, changed. */
  status(): void;
  /** You left insert mode: a good moment to save. */
  settled(): void;
  /** A command that isn't the fields' (next note, close, ...). */
  command(cmd: Command): void;
  /** A pasted image: resolves to the src to use, or null. */
  upload(file: File): Promise<string | null>;
  /** The system's clipboard, read by Anki (a copied picture comes back
   *  already in the media folder); null where there's no Anki to ask.
   *  With `markOnly`, just its mark. */
  clipboard(markOnly?: boolean): Promise<Clip | null>;
}

/** What's on the system's clipboard. */
export interface Clip {
  image?: string;
  html?: string;
  text?: string;
  /** Changes when the clipboard does. */
  mark?: string;
}

/** A held key starts repeating after this long, then this often (about
 *  what a Mac does at its faster settings). */
const REPEAT_AFTER_MS = 280;
const REPEAT_EVERY_MS = 33;
/** Commands a held key repeats: a key that finishes one by itself (j, w,
 *  x, u), never half of one (the d of dd). */
const REPEATS = new Set<Command["kind"]>(["move", "operate", "paste", "tilde", "undo", "redo", "scroll", "note", "field"]);

const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

interface FieldView {
  wrap: HTMLElement;
  body: HTMLElement;
  /** Its HTML as loaded or last saved: it's unsaved while it differs. */
  loaded: string;
}

interface Register {
  text: string;
  html: string;
  linewise: boolean;
}

/** What . does again: a command, and what was typed after it. */
interface Repeat {
  cmd: Command;
  typed: string | null;
}

const PASTE_TAGS = new Set([
  "B", "STRONG", "I", "EM", "U", "S", "SUB", "SUP", "BR", "DIV", "P", "UL", "OL", "LI", "A", "IMG", "TABLE", "THEAD",
  "TBODY", "TR", "TD", "TH", "BLOCKQUOTE", "CODE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6",
]);
const PASTE_ATTRS: Record<string, string[]> = { A: ["href"], IMG: ["src", "alt"], TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan"] };
const PASTE_DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "HEAD", "TITLE", "TEMPLATE", "IFRAME", "OBJECT", "EMBED"]);

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Pasted HTML with only what a card needs: structure, emphasis, images. */
export function cleanPaste(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tidy = (node: Node): void => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) child.remove();
      else if (child.nodeType === 1) {
        const e = child as Element;
        const tag = e.tagName.toUpperCase();
        if (PASTE_DROP.has(tag)) {
          e.remove();
          continue;
        }
        tidy(e);
        if (!PASTE_TAGS.has(tag)) e.replaceWith(...e.childNodes);
        else {
          for (const a of [...e.attributes]) {
            const keep = PASTE_ATTRS[tag]?.includes(a.name.toLowerCase()) && !/^\s*javascript:/i.test(a.value);
            if (!keep) e.removeAttribute(a.name);
          }
        }
      }
    }
  };
  tidy(doc.body);
  return doc.body.innerHTML.trim();
}

export class Editor {
  /** The scroller the fields are in. */
  readonly el: HTMLElement;
  mode: Mode = "normal";
  private host: EditorHost;
  private fields: FieldView[] = [];
  private field = 0;
  /** The cursor, as a place in the field's text. */
  private pos = 0;
  /** Where a visual selection started. */
  private anchor = 0;
  private keys = new Vim();
  private register: Register = { text: "", html: "", linewise: false };
  /** One of our own edits is going through the browser. */
  private applying = false;
  private cursor: HTMLElement;
  private last: Repeat | null = null;
  /** The insert under way, for . to do again; null typed = can't be. */
  private capture: Repeat | null = null;
  private replaying = false;
  /** . is typing its text again: all of it is one change. */
  private replayingInsert = false;
  private paintQueued = false;
  /** The fields before each change, newest last: u goes back to one, and
   *  Ctrl-r forward again. A change can be several of the browser's undo
   *  steps (a cloze is two insertions, typing is many), so u undoes until
   *  the fields are as they were. */
  private undos: string[] = [];
  private redos: string[] = [];
  /** The fields as typing started (i, cw, o): one change for u. */
  private insertBase: string | null = null;
  /** The system clipboard's mark at the last yank: while it's the same, p
   *  pastes the yank; once something else is copied, p pastes that. */
  private clipMark: string | null = null;
  /** Bumped by each load, so a paste on its way to another note stops. */
  private loads = 0;
  /** The height in pixels a pasted picture is given; 0 for its own size. */
  pasteHeight = 150;
  /** Symbols as you type (-> to →); null while they're off (Settings). */
  symbols: Symbols | null = null;
  /** The last thing typed turned into a symbol. */
  private swapped = false;
  private repeatTimer = 0;
  /** The system sends repeats for held keys itself. */
  private systemRepeats = false;

  constructor(host: EditorHost) {
    this.host = host;
    this.el = el("div", "fields");
    this.cursor = el("div", "vim-cursor");
    this.cursor.hidden = true;
    this.el.append(this.cursor);
    this.el.addEventListener("mouseup", () => setTimeout(() => this.adopt(), 0));
    this.el.addEventListener("focusin", (e) => {
      const i = this.fields.findIndex((f) => f.body === e.target);
      if (i !== -1 && i !== this.field) {
        this.field = i;
        this.host.status();
      }
      this.queuePaint();
    });
    this.el.addEventListener("focusout", () => this.queuePaint());
    new ResizeObserver(() => this.queuePaint()).observe(this.el);
    // A held key (see startRepeat) is let go, or the window loses the keys.
    window.addEventListener("keyup", () => this.stopRepeat(), true);
    window.addEventListener("blur", () => this.stopRepeat());
  }

  // --- the note ----------------------------------------------------------------

  /** Show a note's fields, the cursor at the start of the first. */
  load(data: FieldData[]): void {
    for (const f of this.fields) f.wrap.remove();
    this.fields = data.map((d, i) => {
      const wrap = el("div", "field");
      const head = el("div", "field-name", d.name);
      if (d.hint) head.title = d.hint;
      const body = el("div", "field-body");
      body.contentEditable = "true";
      body.spellcheck = false;
      body.tabIndex = -1;
      if (d.rtl) body.dir = "rtl";
      body.dataset.i = String(i);
      body.innerHTML = d.html;
      body.addEventListener("beforeinput", (e) => this.beforeInput(e));
      body.addEventListener("input", (e) => this.onInput(e as InputEvent));
      body.addEventListener("paste", (e) => this.onPaste(e));
      wrap.append(head, body);
      this.el.insertBefore(wrap, this.cursor);
      return { wrap, body, loaded: body.innerHTML };
    });
    this.mode = "normal";
    this.field = 0;
    this.pos = 0;
    this.keys.reset();
    this.capture = null;
    this.undos = [];
    this.redos = [];
    this.insertBase = null;
    this.loads++;
    this.stopRepeat();
    this.el.scrollTop = 0;
    this.markClozes();
    this.sync();
  }

  /** The same note, read again after it changed somewhere else: fields you
   *  haven't touched take the new text. False if its fields aren't the
   *  same ones any more (the caller loads it afresh). */
  refresh(data: FieldData[]): boolean {
    if (data.length !== this.fields.length) return false;
    let changed = false;
    data.forEach((d, i) => {
      const f = this.fields[i];
      if (f.body.innerHTML !== f.loaded) return; // yours wins
      const probe = el("div");
      probe.innerHTML = d.html;
      if (probe.innerHTML === f.loaded) return;
      f.body.innerHTML = d.html;
      f.loaded = f.body.innerHTML;
      changed = true;
    });
    if (changed) {
      if (this.mode !== "insert") this.pos = clampNormal(this.flat().text, this.pos);
      this.markClozes();
      this.sync();
    }
    return true;
  }

  /** The fields that differ from what's saved, by index; null if none do. */
  dirty(): Record<string, string> | null {
    const out: Record<string, string> = {};
    this.fields.forEach((f, i) => {
      const html = f.body.innerHTML;
      if (html !== f.loaded) out[String(i)] = html;
    });
    return Object.keys(out).length ? out : null;
  }

  /** These were sent to be saved: they're what's saved now. Returns what
   *  was, to put back if the save fails. */
  saved(sent: Record<string, string>): Record<string, string> {
    const before: Record<string, string> = {};
    for (const [i, html] of Object.entries(sent)) {
      const f = this.fields[Number(i)];
      if (!f) continue;
      before[i] = f.loaded;
      f.loaded = html;
    }
    return before;
  }

  /** A save failed: those fields are unsaved again. */
  unsaved(before: Record<string, string>): void {
    for (const [i, html] of Object.entries(before)) if (this.fields[Number(i)]) this.fields[Number(i)].loaded = html;
  }

  /** Every field as text, for the next cloze number. */
  texts(): string[] {
    return this.fields.map((f) => new Flat(f.body).text);
  }

  get typed(): string {
    return this.keys.typed;
  }

  get fieldIndex(): number {
    return this.field;
  }

  get fieldCount(): number {
    return this.fields.length;
  }

  hasFocus(): boolean {
    return this.fields.some((f) => f.body === document.activeElement);
  }

  /** Give the keys back to the fields, where the cursor was. */
  focus(): void {
    if (!this.fields.length) return;
    this.sync();
  }

  // --- keys --------------------------------------------------------------------

  onKey(e: KeyboardEvent): void {
    if (e.isComposing || !this.fields.length) return;
    if (!this.hasFocus()) this.body().focus({ preventScroll: true });
    if (this.mode === "insert") {
      // A line break is a <br>, as Anki's editor makes it, not a new block.
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        // A new line finishes a word, as a space does (-- to ‒).
        this.swapSymbol(true);
        this.exec("insertLineBreak");
        if (this.capture && this.capture.typed !== null) this.capture.typed += "\n";
        return;
      }
      // Moving while you type: . can't follow that.
      if (this.capture && (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End")) this.capture.typed = null;
    }
    // The system repeats this key itself (Windows, Linux, or a Mac with
    // press-and-hold off): no need for ours, now or later.
    if (e.repeat) this.systemRepeats = true;
    this.stopRepeat();
    const fresh = !this.keys.typed;
    const cmd = this.keys.feed(e, this.mode);
    this.host.status();
    if (cmd === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    if (cmd) this.run(cmd);
    this.host.status();
    if (cmd && fresh && !e.repeat && !this.systemRepeats && this.mode !== "insert" && REPEATS.has(cmd.kind)) this.startRepeat(cmd);
  }

  /** A held key, repeated here: on a Mac, a key held in text you can type
   *  in doesn't repeat (the system keeps it for its accents menu), and the
   *  fields are such text even in normal mode. */
  private startRepeat(cmd: Command): void {
    this.repeatTimer = window.setTimeout(() => {
      this.repeatTimer = window.setInterval(() => {
        if (this.mode === "insert" || !this.hasFocus()) return this.stopRepeat();
        this.run(cmd);
        this.host.status();
      }, REPEAT_EVERY_MS);
    }, REPEAT_AFTER_MS);
  }

  private stopRepeat(): void {
    // One id space for timeouts and intervals: either clears both.
    clearTimeout(this.repeatTimer);
    this.repeatTimer = 0;
  }

  private snapshot(): string {
    return this.fields.map((f) => f.body.innerHTML).join("\u0000");
  }

  /** The fields were `before` and aren't now: that's one change to undo. */
  private changedFrom(before: string): void {
    if (this.snapshot() === before) return;
    this.undos.push(before);
    if (this.undos.length > 200) this.undos.shift();
    this.redos = [];
  }

  private run(cmd: Command): void {
    if (cmd.kind === "undo" || cmd.kind === "redo" || this.mode === "insert" || this.replayingInsert) return this.dispatch(cmd);
    const before = this.snapshot();
    this.dispatch(cmd);
    // A command that starts typing is one change with what's typed.
    if ((this.mode as Mode) === "insert") this.insertBase = before;
    else this.changedFrom(before);
  }

  private dispatch(cmd: Command): void {
    const visual = this.mode === "visual" || this.mode === "vline";
    switch (cmd.kind) {
      case "move":
        this.doMove(cmd.motion, cmd.count);
        break;
      case "operate":
        if (cmd.op !== "y") this.remember(cmd);
        this.operate(cmd.op, cmd.motion, cmd.count);
        break;
      case "operateSelection":
        if (visual) this.operateSelection(cmd.op);
        break;
      case "insert":
        this.remember(cmd);
        this.insert(cmd.at);
        break;
      case "paste":
        if (visual) this.pasteOver();
        else {
          this.remember(cmd);
          void this.pasteNewest(cmd.before, cmd.count);
        }
        break;
      case "replace":
        this.remember(cmd);
        this.replace(cmd.ch, cmd.count);
        break;
      case "tilde":
        this.remember(cmd);
        this.tilde(cmd.count);
        break;
      case "undo":
      case "redo":
        this.history(cmd.kind);
        break;
      case "repeat":
        this.repeat();
        break;
      case "visual":
        if (!visual) this.anchor = this.pos;
        this.mode = cmd.linewise ? "vline" : "visual";
        break;
      case "swap":
        [this.anchor, this.pos] = [this.pos, this.anchor];
        break;
      case "escape":
        this.escape();
        break;
      case "uncloze":
        this.remember(cmd);
        this.uncloze();
        break;
      case "format":
        this.format(cmd.what);
        break;
      case "clozeShortcut":
        this.clozeShortcut(cmd.same);
        break;
      case "field":
        this.toField(this.field + cmd.by);
        break;
      default:
        this.host.command(cmd);
        return;
    }
    this.sync();
  }

  // --- moving ------------------------------------------------------------------

  private body(i = this.field): HTMLElement {
    return this.fields[Math.max(0, Math.min(i, this.fields.length - 1))].body;
  }

  private flat(): Flat {
    return new Flat(this.body());
  }

  private doMove(motion: Motion, count: number | null): void {
    const visual = this.mode !== "normal";
    if (motion.type === "j" || motion.type === "k") return this.lineMove(motion.type === "j" ? 1 : -1, count ?? 1);
    const f = this.flat();
    if (motion.type === "obj") {
      // viw: select the object.
      const r = visual ? textObject(f.text, this.pos, motion.obj, motion.around) : null;
      if (r && r.to > r.from) {
        this.anchor = r.from;
        this.pos = r.to - 1;
        this.mode = "visual";
      }
      return;
    }
    if (!visual && (motion.type === "gg" || motion.type === "G")) {
      // The first and last field; a number is a field (2G).
      this.field = count ? Math.max(1, Math.min(count, this.fields.length)) - 1 : motion.type === "gg" ? 0 : this.fields.length - 1;
      const text = this.flat().text;
      this.pos = count || motion.type === "gg" ? firstNonBlank(text, 0) : firstNonBlank(text, text.length);
      return;
    }
    const to = move(f.text, this.pos, motion, count);
    if (to !== null) this.pos = to;
  }

  /** j and k: by the lines on screen, as a long paragraph is one line of
   *  text. Past a field's last line is the next field. */
  private lineMove(dir: 1 | -1, count: number): void {
    const sel = getSelection();
    if (!sel) return;
    for (let n = 0; n < count; n++) {
      const f = this.flat();
      const before = f.rect(this.pos);
      sel.collapse(...f.at(this.pos));
      sel.modify("move", dir > 0 ? "forward" : "backward", "line");
      let moved = false;
      if (sel.focusNode && f.root.contains(sel.focusNode)) {
        const to = clampNormal(f.text, f.offsetOf(sel.focusNode, sel.focusOffset));
        const after = f.rect(to);
        moved = dir > 0 ? after.top > before.top + 1 : after.top < before.top - 1;
        if (moved) this.pos = to;
      }
      if (moved) continue;
      // The field's edge: on to the next one, in normal mode.
      const next = this.field + dir;
      if (this.mode !== "normal" || next < 0 || next >= this.fields.length) break;
      this.field = next;
      const g = this.flat();
      const edge = dir > 0 ? 0 : g.text.length;
      this.pos = clampNormal(g.text, this.columnAt(g, edge, before.left) ?? (dir > 0 ? 0 : lineStart(g.text, edge)));
    }
  }

  /** The place on `pos`'s line nearest to the screen's `x`. */
  private columnAt(f: Flat, pos: number, x: number): number | null {
    const r = f.rect(clampNormal(f.text, pos));
    const doc = document as Document & { caretRangeFromPoint?(x: number, y: number): Range | null };
    const hit = doc.caretRangeFromPoint?.(x + 1, r.top + r.height / 2);
    if (!hit || !f.root.contains(hit.startContainer)) return null;
    return f.offsetOf(hit.startContainer, hit.startOffset);
  }

  private toField(i: number): void {
    const to = Math.max(0, Math.min(i, this.fields.length - 1));
    if (to === this.field) return;
    const insert = this.mode === "insert";
    if (insert) this.endCapture();
    this.field = to;
    this.mode = insert ? "insert" : "normal";
    this.pos = 0;
    if (insert) {
      // Tab while typing: carry on typing, at the end of the next field.
      const f = this.flat();
      this.body().focus({ preventScroll: true });
      getSelection()?.collapse(...f.at(f.text.length));
      this.capture = null;
    }
  }

  // --- changing ----------------------------------------------------------------

  private exec(command: string, value?: string): void {
    this.applying = true;
    try {
      document.execCommand(command, false, value);
    } finally {
      this.applying = false;
    }
  }

  private select(f: Flat, from: number, to: number): void {
    const r = f.range(from, to);
    getSelection()?.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset);
  }

  private caret(f: Flat, at: number): void {
    getSelection()?.collapse(...f.at(at));
  }

  private remove(f: Flat, from: number, to: number): void {
    if (to <= from) return;
    this.select(f, from, to);
    this.exec("delete");
  }

  private yank(f: Flat, r: Span): void {
    const box = el("div");
    box.append(f.range(r.from, r.to).cloneContents());
    this.register = { text: f.text.slice(r.from, r.to), html: box.innerHTML, linewise: r.linewise };
    // The system's clipboard too, where the web view lets us.
    try {
      this.select(f, r.from, r.to);
      this.exec("copy");
    } catch {
      // ours is enough
    }
    // Whether or not that copy took: what the clipboard is now is "ours".
    void this.host.clipboard(true).then((c) => {
      if (c?.mark !== undefined) this.clipMark = c.mark;
    }, () => {});
  }

  private operate(op: Op, motion: Motion, count: number | null): void {
    const f = this.flat();
    const r = range(f.text, this.pos, motion, count, op === "c");
    if (r) this.apply(op, r, f);
  }

  private operateSelection(op: Op): void {
    const f = this.flat();
    const lo = Math.min(this.anchor, this.pos);
    const hi = Math.max(this.anchor, this.pos);
    const r: Span = this.mode === "vline" ? lines(f.text, lo, hi) : { from: lo, to: Math.min(hi + 1, f.text.length), linewise: false };
    this.mode = "normal";
    this.pos = lo;
    this.apply(op, r, f);
  }

  private apply(op: Op, r: Span, f: Flat): void {
    const text = f.text;
    if (op === "cloze" || op === "clozeSame") {
      this.wrapCloze(f, r, op === "clozeSame");
      return;
    }
    this.yank(f, r);
    if (op === "y") {
      if (!r.linewise) this.pos = clampNormal(text, r.from);
      return;
    }
    if (op === "c") {
      // Whole lines keep their line: only what's on them goes.
      this.remove(f, r.from, r.to);
      this.startInsert(r.from);
      return;
    }
    if (r.linewise) {
      // The line's own break goes with it: the one after, or for the last
      // line the one before.
      let { from, to } = r;
      if (to < text.length) to++;
      else if (from > 0) from--;
      this.remove(f, from, to);
      const now = this.flat().text;
      this.pos = firstNonBlank(now, Math.min(r.from, now.length));
      if (r.to >= text.length) this.pos = firstNonBlank(now, now.length);
    } else {
      this.remove(f, r.from, r.to);
      this.pos = clampNormal(this.flat().text, r.from);
    }
  }

  /** {{c1::...}} around a range: the braces go in as text, so what's
   *  between keeps its bold, its images. */
  private wrapCloze(f: Flat, r: Span, same: boolean): number {
    let { from, to } = r;
    while (to > from && /\s/.test(f.text[to - 1])) to--;
    while (from < to && /\s/.test(f.text[from])) from++;
    const open = `{{c${nextClozeNumber(this.texts(), same)}::`;
    this.caret(f, to);
    this.exec("insertText", "}}");
    this.caret(this.flat(), from);
    this.exec("insertText", open);
    this.pos = clampNormal(this.flat().text, from);
    return to + open.length + 2;
  }

  private uncloze(): void {
    const f = this.flat();
    const c = clozeAt(f.text, this.pos);
    if (!c) return;
    this.remove(f, c.answerEnd, c.end);
    this.remove(this.flat(), c.open, c.inner);
    this.pos = clampNormal(this.flat().text, c.open);
  }

  private clozeShortcut(same: boolean): void {
    const f = this.flat();
    if (this.mode === "visual" || this.mode === "vline") return this.operateSelection(same ? "clozeSame" : "cloze");
    if (this.mode === "normal") {
      const r = textObject(f.text, this.pos, "w", false);
      if (r && /\S/.test(f.text.slice(r.from, r.to))) this.wrapCloze(f, r, same);
      return;
    }
    // Typing: around what's selected, or an empty one to type into.
    const sel = getSelection();
    if (!sel?.focusNode || !f.root.contains(sel.focusNode)) return;
    const a = f.offsetOf(sel.anchorNode!, sel.anchorOffset);
    const b = f.offsetOf(sel.focusNode, sel.focusOffset);
    if (this.capture) this.capture.typed = null;
    if (a === b) {
      const open = `{{c${nextClozeNumber(this.texts(), same)}::`;
      this.exec("insertText", open + "}}");
      this.caret(this.flat(), a + open.length);
    } else {
      const end = this.wrapCloze(f, { from: Math.min(a, b), to: Math.max(a, b), linewise: false }, same);
      this.caret(this.flat(), end);
    }
  }

  private format(what: "bold" | "italic" | "underline"): void {
    const f = this.flat();
    if (this.mode === "insert") {
      if (this.capture) this.capture.typed = null;
      this.exec(what);
      return;
    }
    let r: Span | null;
    if (this.mode === "normal") r = textObject(f.text, this.pos, "w", false);
    else {
      const lo = Math.min(this.anchor, this.pos);
      const hi = Math.max(this.anchor, this.pos);
      r = this.mode === "vline" ? lines(f.text, lo, hi) : { from: lo, to: hi + 1, linewise: false };
      this.mode = "normal";
      this.pos = lo;
    }
    if (!r || r.to <= r.from) return;
    this.select(f, r.from, r.to);
    this.exec(what);
  }

  private insert(at: "i" | "a" | "I" | "A" | "o" | "O"): void {
    const f = this.flat();
    const text = f.text;
    const start = lineStart(text, this.pos);
    const end = lineEnd(text, this.pos);
    switch (at) {
      case "i":
        return this.startInsert(this.pos);
      case "a":
        return this.startInsert(Math.min(this.pos + 1, end));
      case "A":
        return this.startInsert(end);
      case "I": {
        let p = start;
        while (p < end && /\s/.test(text[p])) p++;
        return this.startInsert(p);
      }
      case "o":
        this.caret(f, end);
        this.exec("insertLineBreak");
        return this.startInsert(end + 1);
      case "O":
        this.caret(f, start);
        this.exec("insertLineBreak");
        return this.startInsert(start);
    }
  }

  private startInsert(at: number): void {
    this.mode = "insert";
    this.body().focus({ preventScroll: true });
    this.caret(this.flat(), at);
  }

  /** A clip into the field, where the selection is. False if it's empty. */
  private insertClip(clip: Clip): boolean {
    if (clip.image) {
      // The height (Settings) goes on the picture itself, so the card
      // shows it that tall everywhere it's reviewed, and its width follows.
      // Where a note type caps the width (AnKing: 85% of the card, all of
      // it on a phone), object-fit keeps a wide picture's shape inside
      // the narrower box instead of squashing it.
      const h = this.pasteHeight;
      const size = h > 0 ? ` style="height: ${h}px; width: auto; object-fit: contain;"` : "";
      this.exec("insertHTML", `<img src="${clip.image.replace(/"/g, "&quot;")}"${size}>`);
    }
    else {
      const html = clip.html ? cleanPaste(clip.html) : "";
      if (html) this.exec("insertHTML", html);
      else if (clip.text) this.exec("insertHTML", escapeHtml(clip.text).replace(/\r?\n/g, "<br>"));
      else return false;
    }
    return true;
  }

  /** p and P: what you yanked here, or whatever has been copied since,
   *  anywhere on the Mac (text from a web page, a picture). */
  private async pasteNewest(before: boolean, count: number): Promise<void> {
    const loads = this.loads;
    const snap = this.snapshot();
    const clip = await this.host.clipboard().catch(() => null);
    if (loads !== this.loads || this.mode !== "normal") return;
    const has = !!clip && !!(clip.image || clip.html || clip.text);
    const ours = !has || clip.mark === this.clipMark || (!clip.image && squash(clip.text ?? "") === squash(this.register.text));
    if (ours) this.paste(before, count);
    else {
      const f = this.flat();
      const text = f.text;
      const at = before ? this.pos : Math.min(this.pos + 1, lineEnd(text, this.pos));
      this.caret(f, at);
      for (let i = 0; i < count; i++) this.insertClip(clip);
      const now = this.flat().text;
      this.pos = clampNormal(now, at + Math.max(0, now.length - text.length - 1));
    }
    this.changedFrom(snap);
    this.sync();
  }

  /** The yank, pasted. Lines go under or over this one; anything else
   *  after or before the cursor. */
  private paste(before: boolean, count: number): void {
    const reg = this.register;
    if (!reg.text) return;
    const f = this.flat();
    const text = f.text;
    const html = reg.html || escapeHtml(reg.text);
    if (reg.linewise) {
      const piece = Array.from({ length: count }, () => html).join("<br>");
      if (before) {
        const start = lineStart(text, this.pos);
        this.caret(f, start);
        this.exec("insertHTML", piece + "<br>");
        this.pos = firstNonBlank(this.flat().text, start);
      } else {
        const end = lineEnd(text, this.pos);
        this.caret(f, end);
        this.exec("insertHTML", "<br>" + piece);
        const now = this.flat().text;
        this.pos = firstNonBlank(now, Math.min(end + 1, now.length));
      }
      return;
    }
    const at = before ? this.pos : Math.min(this.pos + 1, lineEnd(text, this.pos));
    this.caret(f, at);
    this.exec("insertHTML", html.repeat(count));
    const now = this.flat().text;
    this.pos = clampNormal(now, at + Math.max(0, now.length - text.length - 1));
  }

  /** p on a selection: it's replaced, and becomes what p pastes next. */
  private pasteOver(): void {
    const reg = this.register;
    const f = this.flat();
    const lo = Math.min(this.anchor, this.pos);
    const hi = Math.max(this.anchor, this.pos);
    const r: Span = this.mode === "vline" ? lines(f.text, lo, hi) : { from: lo, to: Math.min(hi + 1, f.text.length), linewise: false };
    this.mode = "normal";
    this.yank(f, r);
    const taken = this.register;
    this.select(f, r.from, r.to);
    if (reg.text) this.exec("insertHTML", reg.html || escapeHtml(reg.text));
    else this.exec("delete");
    this.register = taken;
    this.pos = clampNormal(this.flat().text, r.from);
  }

  private replace(ch: string, count: number): void {
    const f = this.flat();
    if (this.pos + count > lineEnd(f.text, this.pos)) return;
    this.select(f, this.pos, this.pos + count);
    this.exec("insertText", ch.repeat(count));
    this.pos = this.pos + count - 1;
  }

  private tilde(count: number): void {
    const f = this.flat();
    const end = Math.min(lineEnd(f.text, this.pos), this.pos + count);
    const was = f.text.slice(this.pos, end);
    if (!was || /[￼]/.test(was)) return;
    const now = [...was].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
    if (now.length !== was.length) return;
    this.select(f, this.pos, end);
    this.exec("insertText", now);
    this.pos = clampNormal(this.flat().text, end);
  }

  private history(kind: "undo" | "redo"): void {
    const from = kind === "undo" ? this.undos : this.redos;
    const to = kind === "undo" ? this.redos : this.undos;
    const target = from.pop();
    if (target === undefined) return;
    to.push(this.snapshot());
    // The browser's steps, until the fields are as they were then.
    for (let i = 0; i < 400 && this.snapshot() !== target; i++) {
      const was = this.snapshot();
      this.exec(kind);
      if (this.snapshot() === was) break;
    }
    const sel = getSelection();
    const i = sel?.focusNode ? this.fields.findIndex((f) => f.body.contains(sel.focusNode)) : -1;
    if (i !== -1) {
      this.field = i;
      const f = this.flat();
      const a = f.offsetOf(sel!.anchorNode!, sel!.anchorOffset);
      const b = f.offsetOf(sel!.focusNode!, sel!.focusOffset);
      this.pos = clampNormal(f.text, Math.min(a, b));
    } else this.pos = clampNormal(this.flat().text, this.pos);
    this.mode = "normal";
  }

  private escape(): void {
    if (this.mode === "insert") {
      this.endCapture();
      if (this.insertBase !== null && !this.replayingInsert) this.changedFrom(this.insertBase);
      this.insertBase = null;
      const f = this.flat();
      const sel = getSelection();
      const at = sel?.focusNode && f.root.contains(sel.focusNode) ? f.offsetOf(sel.focusNode, sel.focusOffset) : this.pos;
      // As in vim, the cursor steps back onto what you typed last.
      this.pos = clampNormal(f.text, Math.max(lineStart(f.text, at), at - 1));
      this.mode = "normal";
      this.host.settled();
      return;
    }
    this.mode = "normal";
    this.pos = clampNormal(this.flat().text, this.pos);
  }

  // --- . -----------------------------------------------------------------------

  private remember(cmd: Command): void {
    if (this.replaying) return;
    const types = cmd.kind === "insert" || (cmd.kind === "operate" && cmd.op === "c");
    if (types) this.capture = { cmd, typed: "" };
    else this.last = { cmd, typed: null };
  }

  private endCapture(): void {
    if (this.capture && this.capture.typed !== null && !this.replaying) this.last = this.capture;
    this.capture = null;
  }

  private repeat(): void {
    const last = this.last;
    if (!last || this.mode !== "normal") return;
    this.replaying = true;
    try {
      this.replayingInsert = true;
      this.dispatch(last.cmd);
      // The command may have started typing (cw, o): type what was typed.
      if ((this.mode as Mode) === "insert") {
        const parts = (last.typed ?? "").split("\n");
        parts.forEach((part, i) => {
          if (i) this.exec("insertLineBreak");
          if (part) this.exec("insertText", part);
        });
        this.escape();
      }
    } finally {
      this.replaying = false;
      this.replayingInsert = false;
      this.insertBase = null;
    }
  }

  // --- the browser's side ------------------------------------------------------

  private beforeInput(e: InputEvent): void {
    if (this.applying) return;
    if (this.mode !== "insert") {
      // Nothing types outside insert mode; paste, cut and undo still work.
      if (!/^(insertFromPaste|insertFromDrop|deleteByCut|historyUndo|historyRedo)$/.test(e.inputType)) e.preventDefault();
      return;
    }
    const c = this.capture;
    if (!c || c.typed === null) return;
    if (e.inputType === "insertText" && e.data) c.typed += e.data;
    else if (e.inputType === "deleteContentBackward" && c.typed) c.typed = c.typed.slice(0, -1);
    else c.typed = null;
  }

  private onInput(e: InputEvent): void {
    const swapped = this.swapped;
    if (!this.applying) this.swapped = false;
    if (!this.applying && swapped && this.mode === "insert" && e.inputType === "historyUndo") {
      // Cmd+Z took a symbol back: the browser leaves its key selected, for
      // the next letter to type over. Carry on after it instead.
      getSelection()?.collapseToEnd();
    } else if (!this.applying && this.symbols && this.mode === "insert" && e.inputType === "insertText" && !e.isComposing) {
      // Most letters can't finish a symbol's key: read the field only
      // after one that can. Swapped once this input is over: typed by
      // execCommand (as the tests type), it comes while that command is
      // still running, and the browser won't run ours inside it.
      const sel = getSelection();
      const node = sel?.focusNode;
      const at = sel?.focusOffset ?? 0;
      const ch = node?.nodeType === 3 && at > 0 ? (node as Text).data[at - 1] : null;
      if (ch === null || this.symbols.mayFinish(ch)) queueMicrotask(() => this.swapSymbol(false));
    }
    this.touched();
  }

  /** What was just typed (or the new line about to be) finishes a key: its
   *  symbol takes the key's place, as one step of the browser's undo, so
   *  Cmd+Z straight after gives back what you typed. */
  private swapSymbol(lineBreak: boolean): void {
    if (!this.symbols || this.mode !== "insert") return;
    const sel = getSelection();
    const f = this.flat();
    if (!sel?.isCollapsed || !sel.focusNode || !f.root.contains(sel.focusNode)) return;
    const caret = f.offsetOf(sel.focusNode, sel.focusOffset);
    const swap = lineBreak ? this.symbols.beforeBreak(f.text, caret) : this.symbols.typed(f.text, caret);
    if (swap) this.putSymbol(f, swap, caret);
  }

  private putSymbol(f: Flat, s: Swap, caret: number): void {
    const key = f.text.slice(s.from, s.to);
    // The space typed after a word key stays, after its symbol.
    const after = caret - s.to;
    this.select(f, s.from, s.to);
    this.exec(s.html ? "insertHTML" : "insertText", s.value);
    this.swapped = true;
    if (after) {
      const sel = getSelection();
      const g = this.flat();
      if (sel?.focusNode && g.root.contains(sel.focusNode)) this.caret(g, g.offsetOf(sel.focusNode, sel.focusOffset) + after);
    }
    // . types what you typed again: the symbol, now, where its key was.
    const c = this.capture;
    if (!c || c.typed === null) return;
    const tail = c.typed.slice(c.typed.length - (caret - s.from));
    if (!s.html && tail.length === caret - s.from && tail.startsWith(key)) {
      c.typed = c.typed.slice(0, c.typed.length - tail.length) + s.value + tail.slice(key.length);
    } else c.typed = null;
  }

  private touched(): void {
    this.markClozes();
    this.host.changed();
    this.queuePaint();
  }

  /** The mouse (or Cmd+A) moved the selection: the cursor follows it, and
   *  a dragged selection is a visual one. */
  adopt(): void {
    const sel = getSelection();
    if (!sel?.focusNode || this.mode === "insert") return;
    const i = this.fields.findIndex((f) => f.body.contains(sel.focusNode));
    if (i === -1) return;
    this.field = i;
    const f = this.flat();
    const focus = f.offsetOf(sel.focusNode, sel.focusOffset);
    const inField = sel.anchorNode && f.root.contains(sel.anchorNode);
    const anchor = inField ? f.offsetOf(sel.anchorNode!, sel.anchorOffset) : focus;
    if (anchor === focus) {
      this.mode = "normal";
      this.pos = clampNormal(f.text, focus);
    } else {
      this.mode = "visual";
      this.anchor = focus > anchor ? anchor : Math.max(0, anchor - 1);
      this.pos = focus > anchor ? focus - 1 : focus;
    }
    this.keys.reset();
    this.sync();
    this.host.status();
  }

  /** Cmd+V. Anki reads the clipboard for us where it can (a picture
   *  copied in a browser doesn't always reach a web page's paste); the
   *  paste's own contents are used otherwise. */
  private onPaste(e: ClipboardEvent): void {
    const data = e.clipboardData;
    e.preventDefault();
    if (this.capture) this.capture.typed = null;
    const before = this.mode === "insert" ? null : this.snapshot();
    const loads = this.loads;
    const body = this.body();
    // Read now: the event's data is gone once this returns.
    const file = data ? [...data.files].find((f) => f.type.startsWith("image/")) : undefined;
    const own: Clip = { html: data?.getData("text/html") || undefined, text: data?.getData("text/plain") || undefined };
    const finish = (clip: Clip | null): void => {
      if (loads !== this.loads || !body.isConnected) return;
      if (document.activeElement !== body) body.focus({ preventScroll: true });
      if (clip) this.insertClip(clip);
      if (before !== null) this.changedFrom(before);
      this.afterNativeEdit();
    };
    void this.host.clipboard().catch(() => null).then(async (clip) => {
      if (clip && (clip.image || clip.html || clip.text)) return finish(clip);
      if (file) {
        const src = await this.host.upload(file).catch(() => null);
        return finish(src ? { image: src } : null);
      }
      finish(own);
    });
  }

  private afterNativeEdit(): void {
    if (this.mode === "insert") return;
    const f = this.flat();
    const sel = getSelection();
    if (sel?.focusNode && f.root.contains(sel.focusNode)) {
      this.pos = clampNormal(f.text, Math.max(0, f.offsetOf(sel.focusNode, sel.focusOffset) - 1));
    }
    this.mode = "normal";
    this.sync();
  }

  // --- what you see ------------------------------------------------------------

  /** Put the browser's selection where the cursor is, and draw it. */
  private sync(): void {
    if (!this.fields.length) return;
    const body = this.body();
    this.el.dataset.mode = this.mode;
    for (const [i, f] of this.fields.entries()) f.wrap.classList.toggle("on", i === this.field);
    if (this.mode !== "insert") {
      if (document.activeElement !== body) body.focus({ preventScroll: true });
      const f = this.flat();
      const sel = getSelection();
      if (sel) {
        if (this.mode === "normal") {
          this.pos = clampNormal(f.text, this.pos);
          sel.collapse(...f.at(this.pos));
        } else {
          const lo = Math.min(this.anchor, this.pos);
          const hi = Math.max(this.anchor, this.pos);
          const r = this.mode === "vline" ? lines(f.text, lo, hi) : { from: lo, to: Math.min(hi + 1, f.text.length) };
          const [a, b] = this.pos >= this.anchor ? [r.from, r.to] : [r.to, r.from];
          sel.setBaseAndExtent(...f.at(a), ...f.at(b));
        }
      }
    }
    this.paint();
  }

  private queuePaint(): void {
    if (this.paintQueued) return;
    this.paintQueued = true;
    setTimeout(() => {
      this.paintQueued = false;
      this.paint();
    }, 0);
  }

  /** The block cursor: over the character you're on, in normal mode. */
  private paint(): void {
    const c = this.cursor;
    if (this.mode !== "normal" || !this.fields.length) {
      c.hidden = true;
      if (this.mode === "insert") this.keepVisible(getSelection()?.rangeCount ? getSelection()!.getRangeAt(0).getBoundingClientRect() : null);
      return;
    }
    const f = this.flat();
    const r = f.rect(clampNormal(f.text, this.pos));
    const box = this.el.getBoundingClientRect();
    const size = parseFloat(getComputedStyle(f.root).fontSize) || 14;
    c.hidden = false;
    c.classList.toggle("away", !this.hasFocus());
    c.style.left = `${r.left - box.left + this.el.scrollLeft}px`;
    c.style.top = `${r.top - box.top + this.el.scrollTop}px`;
    c.style.width = `${r.width || size * 0.55}px`;
    c.style.height = `${r.height}px`;
    this.keepVisible(r);
  }

  private keepVisible(r: DOMRect | null): void {
    if (!r || (!r.height && !r.top)) return;
    const box = this.el.getBoundingClientRect();
    const pad = 28;
    if (r.top < box.top + pad) this.el.scrollTop -= box.top + pad - r.top;
    else if (r.bottom > box.bottom - pad) this.el.scrollTop += r.bottom - (box.bottom - pad);
  }

  /** Colour each cloze's braces and number apart from its answer, without
   *  touching the field's HTML (the CSS Custom Highlight API). */
  private markClozes(): void {
    const reg = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const Mark = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
    if (!reg || !Mark) return;
    const braces: Range[] = [];
    const answers: Range[] = [];
    for (const field of this.fields) {
      const f = new Flat(field.body);
      for (const c of clozes(f.text)) {
        braces.push(f.range(c.open, c.inner), f.range(c.answerEnd, c.end));
        answers.push(f.range(c.inner, c.answerEnd));
      }
    }
    reg.set("cloze-brace", new Mark(...braces));
    reg.set("cloze-answer", new Mark(...answers));
  }

  /** Half a screen down or up (Ctrl-d / Ctrl-u). */
  scroll(dir: 1 | -1): void {
    this.el.scrollTop += (dir * this.el.clientHeight) / 2;
  }

}
