// Vim keys for editing a note (e), as a small machine: key presses in,
// commands out. No DOM here, so it's tested on its own (vim.test.ts). It
// knows normal and visual mode; in insert mode only the keys that leave it
// or aren't text come through here (Esc, Tab, Cmd+B, ...), and the rest is
// typing. Skim's own keys, for moving through cards, are ../keys.ts.

import { isObject, type Motion } from "./text.ts";

export type Mode = "normal" | "insert" | "visual" | "vline";

/** What d, c, y and the rest act with. "cloze" wraps in a new cloze
 *  ({{c2::...}}), "clozeSame" in the last number again. */
export type Op = "d" | "c" | "y" | "cloze" | "clozeSame";

export type Command =
  | { kind: "move"; motion: Motion; count: number | null }
  | { kind: "operate"; op: Op; motion: Motion; count: number | null } // dw, ciw, 3dd, gciw
  | { kind: "operateSelection"; op: Op } // d, c, y, gc on what's selected
  | { kind: "insert"; at: "i" | "a" | "I" | "A" | "o" | "O" }
  | { kind: "paste"; before: boolean; count: number }
  | { kind: "replace"; ch: string; count: number }
  | { kind: "tilde"; count: number }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "repeat"; count: number | null } // .
  | { kind: "visual"; linewise: boolean }
  | { kind: "swap" } // o in visual mode: the other end
  | { kind: "escape" }
  | { kind: "uncloze" } // gx: take the cloze off, keep its text
  | { kind: "format"; what: "bold" | "italic" | "underline" }
  | { kind: "clozeShortcut"; same: boolean } // Cmd+Shift+C, as in Anki's editor
  | { kind: "field"; by: number } // Tab, { and }
  | { kind: "note"; by: number } // J/K
  | { kind: "flip" } // Space: the card's other side
  | { kind: "scroll"; dir: 1 | -1 } // Ctrl-d/Ctrl-u
  | { kind: "save" }
  | { kind: "browse" } // gb: Anki's browser
  | { kind: "close" } // q, ZZ: back to the cards
  | { kind: "help" };

/** The bits of a key event the machine reads (a DOM KeyboardEvent fits). */
export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"> & { code?: string };

/** Keys that only change another key: the Shift in 3G mustn't lose the 3. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "Dead", "Process"]);
const MAX_DIGITS = 4;

/** The letter pressed with Ctrl or Cmd. Anki's web view on macOS reports the
 *  Control key as metaKey (and Cmd as ctrlKey), and Control+d's key as the
 *  control character "\x04", so a browser's view of these keys isn't enough.
 *  Caps Lock can also report the letter in upper case. (Same as Skim.) */
export function ctrlLetter(e: KeyLike): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  const code = e.key.length === 1 ? e.key.charCodeAt(0) : -1;
  return code >= 1 && code <= 26 ? String.fromCharCode(code + 96) : code === 27 ? "[" : e.key.toLowerCase();
}

type Simple = Extract<Motion, { type: "h" | "l" | "j" | "k" | "w" | "b" | "e" | "W" | "B" | "E" | "0" | "^" | "$" | "gg" | "G" }>["type"];
const SIMPLE: Record<string, Simple> = {
  h: "h", l: "l", j: "j", k: "k", w: "w", b: "b", e: "e", W: "W", B: "B", E: "E",
  "^": "^", $: "$", ArrowLeft: "h", ArrowRight: "l", ArrowDown: "j", ArrowUp: "k",
  Backspace: "h", Home: "0", End: "$",
};

type Find = { ch: string; till: boolean; back: boolean };

export class Vim {
  /** A number typed before the command (3dw), and one after the operator (d3w). */
  private count = "";
  private count2 = "";
  private op: Op | null = null;
  /** The key the operator was typed with, for dd / cc / yy. */
  private opKey = "";
  private g = false;
  private z = false;
  /** Waiting for a character: f/t/F/T/r, or i/a before a text object. */
  private wait: "f" | "t" | "F" | "T" | "r" | "i" | "a" | null = null;
  private lastFind: Find | null = null;

  /** What's been typed toward a command, to show while you type it. */
  get typed(): string {
    const op = this.op ? this.opKey : "";
    return this.count + op + this.count2 + (this.g ? "g" : "") + (this.z ? "Z" : "") + (this.wait ?? "");
  }

  reset(): void {
    this.count = this.count2 = this.opKey = "";
    this.op = null;
    this.g = this.z = false;
    this.wait = null;
  }

  private takeCount(): number | null {
    if (!this.count && !this.count2) return null;
    return Number(this.count || 1) * Number(this.count2 || 1);
  }

  /** Finish a motion: a move, or what the waiting operator acts on. */
  private done(motion: Motion): Command {
    const count = this.takeCount();
    const op = this.op;
    this.reset();
    return op ? { kind: "operate", op, motion, count } : { kind: "move", motion, count };
  }

  /** A key press in, and out: a command; `null` when the key was part of
   *  one (a number, an operator waiting for its motion) or isn't a key
   *  in this mode, and should do nothing; `undefined` when the page
   *  should let it through to the browser (Cmd+C, Cmd+V, typing in insert
   *  mode). */
  feed(e: KeyLike, mode: Mode): Command | null | undefined {
    if (MODIFIERS.has(e.key)) return undefined;
    const visual = mode === "visual" || mode === "vline";

    // Cmd+Shift+C (Ctrl+Shift+C): a cloze, as in Anki's editor; with Alt,
    // the same number again.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "KeyC" || e.key.toLowerCase() === "c")) {
      this.reset();
      return { kind: "clozeShortcut", same: e.altKey };
    }

    const letter = ctrlLetter(e);
    if (letter) {
      this.reset();
      switch (letter) {
        case "[":
          return { kind: "escape" };
        case "s":
          return { kind: "save" };
        case "b":
          return { kind: "format", what: "bold" };
        case "i":
          return { kind: "format", what: "italic" };
        case "u":
          // Underline where there's something to underline; in normal mode
          // it's vim's half a page up.
          return mode === "normal" ? { kind: "scroll", dir: -1 } : { kind: "format", what: "underline" };
        case "d":
          return mode === "insert" ? undefined : { kind: "scroll", dir: 1 };
        case "r":
          return mode === "insert" ? undefined : { kind: "redo" };
      }
      return undefined;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.reset();
      return undefined;
    }

    const k = e.key;
    if (mode === "insert") {
      if (k === "Escape") return { kind: "escape" };
      if (k === "Tab") return { kind: "field", by: e.shiftKey ? -1 : 1 };
      return undefined;
    }

    // A character for f, t, r, or a text object.
    if (this.wait) {
      const wait = this.wait;
      this.wait = null;
      if (k.length !== 1) {
        this.reset();
        return null;
      }
      if (wait === "r") {
        const count = this.takeCount() ?? 1;
        this.reset();
        return { kind: "replace", ch: k, count };
      }
      if (wait === "i" || wait === "a") {
        if (!isObject(k)) {
          this.reset();
          return null;
        }
        if (visual) {
          // viw: select the object. The page takes it as a move.
          this.reset();
          return { kind: "move", motion: { type: "obj", obj: k, around: wait === "a" }, count: null };
        }
        return this.done({ type: "obj", obj: k, around: wait === "a" });
      }
      this.lastFind = { ch: k, till: wait === "t" || wait === "T", back: wait === "F" || wait === "T" };
      return this.done({ type: "find", ...this.lastFind });
    }

    // Numbers: before the command, or between an operator and its motion.
    if (/^[0-9]$/.test(k) && !this.g && (k !== "0" || (this.op ? this.count2 : this.count))) {
      if (this.op) {
        if (this.count2.length < MAX_DIGITS) this.count2 += k;
      } else if (this.count.length < MAX_DIGITS) this.count += k;
      return null;
    }

    if (this.z) {
      this.reset();
      return k === "Z" ? { kind: "close" } : null;
    }

    if (this.g) {
      this.g = false;
      switch (k) {
        case "g":
          return this.done({ type: "gg" });
        case "c":
        case "C": {
          const op: Op = k === "c" ? "cloze" : "clozeSame";
          if (visual) {
            this.reset();
            return { kind: "operateSelection", op };
          }
          if (this.op) break;
          this.op = op;
          this.opKey = "g" + k;
          return null;
        }
        case "x":
          this.reset();
          return { kind: "uncloze" };
        case "b":
          this.reset();
          return { kind: "browse" };
      }
      this.reset();
      return null;
    }

    if (SIMPLE[k]) return this.done({ type: SIMPLE[k] });

    switch (k) {
      case "0":
        return this.done({ type: "0" });
      case "G":
        return this.done({ type: "G" });
      case "g":
        this.g = true;
        return null;
      case "f":
      case "t":
      case "F":
      case "T":
        this.wait = k;
        return null;
      case ";":
      case ",": {
        if (!this.lastFind) {
          this.reset();
          return null;
        }
        const f = this.lastFind;
        return this.done({ type: "find", ch: f.ch, till: f.till, back: k === "," ? !f.back : f.back });
      }
      case "Escape": {
        this.reset();
        return { kind: "escape" };
      }
    }

    // Operators, and in visual mode what they do to the selection.
    if (k === "d" || k === "c" || k === "y") {
      if (visual) {
        this.reset();
        return { kind: "operateSelection", op: k };
      }
      if (this.op) {
        // dd, cc, yy: the line. Any other pair (dc) is nothing.
        if (this.op === k) return this.done({ type: "line" });
        this.reset();
        return null;
      }
      this.op = k;
      this.opKey = k;
      return null;
    }
    if (this.op) {
      // An operator is waiting: i and a start a text object, and a cloze
      // operator typed twice (gcc) takes the line.
      if (k === "i" || k === "a") {
        this.wait = k;
        return null;
      }
      this.reset();
      return null;
    }

    if (visual) {
      switch (k) {
        case "x":
        case "X":
        case "Delete":
          return this.end({ kind: "operateSelection", op: "d" });
        case "s":
          return this.end({ kind: "operateSelection", op: "c" });
        case "i":
        case "a":
          this.wait = k;
          return null;
        case "o":
          return this.end({ kind: "swap" });
        case "v":
          return this.end(mode === "visual" ? { kind: "escape" } : { kind: "visual", linewise: false });
        case "V":
          return this.end(mode === "vline" ? { kind: "escape" } : { kind: "visual", linewise: true });
        case "p":
        case "P":
          return this.end({ kind: "paste", before: true, count: 1 });
        case "Tab":
          return this.end({ kind: "field", by: e.shiftKey ? -1 : 1 });
        case "?":
          return this.end({ kind: "help" });
      }
      this.reset();
      return null;
    }

    const count = this.takeCount();
    const n = count ?? 1;
    this.reset();
    // Shorthands for an operator and a motion.
    const short = (op: Op, motion: Motion): Command => ({ kind: "operate", op, motion, count });
    switch (k) {
      case "x":
      case "Delete":
        return short("d", { type: "l" });
      case "X":
        return short("d", { type: "h" });
      case "D":
        return short("d", { type: "$" });
      case "C":
        return short("c", { type: "$" });
      case "s":
        return short("c", { type: "l" });
      case "S":
        return short("c", { type: "line" });
      case "Y":
        return short("y", { type: "line" });
      case "i":
      case "a":
      case "I":
      case "A":
      case "o":
      case "O":
        return { kind: "insert", at: k };
      case "p":
        return { kind: "paste", before: false, count: n };
      case "P":
        return { kind: "paste", before: true, count: n };
      case "r":
        // The count is the command's: keep it for the character to come.
        this.count = count ? String(count) : "";
        this.wait = "r";
        return null;
      case "~":
        return { kind: "tilde", count: n };
      case "u":
        return { kind: "undo" };
      case ".":
        return { kind: "repeat", count };
      case "v":
        return { kind: "visual", linewise: false };
      case "V":
        return { kind: "visual", linewise: true };
      case "J":
        return { kind: "note", by: n };
      case "K":
        return { kind: "note", by: -n };
      case "}":
      case "Tab":
        return { kind: "field", by: k === "Tab" && e.shiftKey ? -n : n };
      case "{":
        return { kind: "field", by: -n };
      case "Enter":
        return { kind: "field", by: n };
      case " ":
        return { kind: "flip" };
      case "?":
        return { kind: "help" };
      case "q":
        return { kind: "close" };
      case "Z":
        this.z = true;
        return null;
    }
    // Anything else typed in normal mode does nothing (and mustn't type).
    return k.length === 1 ? null : undefined;
  }

  private end(cmd: Command): Command {
    this.reset();
    return cmd;
  }
}
