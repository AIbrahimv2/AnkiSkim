// Vim keys, as a small machine: key presses in, commands out. No DOM here,
// so it's tested on its own (keys.test.ts).

export type Side = "question" | "answer";

export type Command =
  | { kind: "move"; by: number; extend?: true } // j/k, a number first moves that many; Shift+↓/↑ select as they go
  | { kind: "goto"; row: number } // gg/G, 1-based; -1 is the last row
  | { kind: "half"; dir: 1 | -1; rows: number | null } // Ctrl-d/Ctrl-u; null = half a page
  | { kind: "page"; by: number } // Ctrl-f/Ctrl-b, PageDown/PageUp
  | { kind: "side"; side: Side | "flip" } // h/l, Space
  | { kind: "scroll"; by: number } // J/K, Ctrl-e/Ctrl-y: scroll the card itself
  | { kind: "search" }
  | { kind: "edit" } // e: edit the card here
  | { kind: "browse" } // B: open it in Anki's browser
  | { kind: "replay" }
  | { kind: "back" }
  | { kind: "close" } // q
  | { kind: "escape" } // Esc: ends a selection, or else closes
  | { kind: "visual" } // v: select cards as you move, or stop
  | { kind: "suspend" } // Cmd+J (Ctrl+J): suspend or unsuspend, as in Anki's browser
  | { kind: "help" }
  | { kind: "tags" } // i: fold the tags pane under the card, or open it
  | { kind: "filter"; by: 1 | -1 } // f/F: next / previous filter
  | { kind: "lens"; by: 1 | -1 } // t/T, L/H: a review's next / previous view
  | { kind: "cancel" };

/** The bits of a key event the machine reads (a DOM KeyboardEvent fits). */
export type KeyLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Keys that only change another key: the Shift in 10G mustn't lose the 10. */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);
const MAX_DIGITS = 5;

/** The letter pressed with Ctrl. Anki's web view on macOS reports the Control
 *  key as metaKey (and Cmd as ctrlKey), and Control+d's key as the control
 *  character "\x04", so a browser's view of these keys isn't enough. Caps Lock
 *  can also report the letter in upper case. (Same as Stepwise.) */
export function ctrlLetter(e: KeyLike): string | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return null;
  const code = e.key.length === 1 ? e.key.charCodeAt(0) : -1;
  return code >= 1 && code <= 26 ? String.fromCharCode(code + 96) : e.key.toLowerCase();
}

export class Keys {
  private count = "";
  private g: number | null | undefined = undefined; // set after a first g: its count
  /** How far Ctrl-d/Ctrl-u move once a number has been typed before them
   *  (vim's 'scroll'); null until then, which means half a page. */
  scroll: number | null = null;

  /** What's been typed toward a command, to show while you type it. */
  get typed(): string {
    return this.count + (this.g !== undefined ? `${this.g ?? ""}g` : "");
  }

  reset(): void {
    this.count = "";
    this.g = undefined;
  }

  private take(): number | null {
    const n = this.count ? Number(this.count) : null;
    this.count = "";
    return n;
  }

  /** A key press in, and out: a command; `null` when the key was part of
   *  one (a number, the first g); `undefined` when it isn't a Skim key, so
   *  the page should let it through (Cmd+C, Tab, ...). */
  feed(e: KeyLike): Command | null | undefined {
    if (MODIFIERS.has(e.key)) return undefined;

    const letter = ctrlLetter(e);
    if (letter) {
      const n = this.take();
      this.g = undefined;
      switch (letter) {
        case "d":
        case "u":
          if (n) this.scroll = n;
          return { kind: "half", dir: letter === "d" ? 1 : -1, rows: this.scroll };
        case "f":
          return { kind: "page", by: n ?? 1 };
        case "b":
          return { kind: "page", by: -(n ?? 1) };
        case "e":
          return { kind: "scroll", by: n ?? 1 };
        case "y":
          return { kind: "scroll", by: -(n ?? 1) };
        case "j": // Cmd+J on a Mac, Ctrl+J elsewhere (ctrlLetter takes either)
          return { kind: "suspend" };
      }
      return undefined;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) {
      this.reset();
      return undefined;
    }

    const k = e.key;
    if (/^[0-9]$/.test(k) && (k !== "0" || this.count)) {
      if (this.g !== undefined) this.g = undefined; // 3g5: start over
      if (this.count.length < MAX_DIGITS) this.count += k;
      return null;
    }

    if (this.g !== undefined) {
      const gCount = this.g;
      this.g = undefined;
      if (k === "g") {
        this.count = "";
        return { kind: "goto", row: gCount ?? 1 };
      }
      // Anything else after a lone g: forget the g, take the key as it is.
    }

    const typed = this.count !== "";
    const n = this.take();
    switch (k) {
      case "j":
        return { kind: "move", by: n ?? 1 };
      case "k":
        return { kind: "move", by: -(n ?? 1) };
      case "ArrowDown":
      case "ArrowUp": {
        const by = (k === "ArrowDown" ? 1 : -1) * (n ?? 1);
        return e.shiftKey ? { kind: "move", by, extend: true } : { kind: "move", by };
      }
      case "v":
      case "V":
        return { kind: "visual" };
      case "g":
        this.g = n;
        return null;
      case "G":
        return { kind: "goto", row: n ?? -1 };
      case "Home":
        return { kind: "goto", row: 1 };
      case "End":
        return { kind: "goto", row: -1 };
      case "PageDown":
        return { kind: "page", by: n ?? 1 };
      case "PageUp":
        return { kind: "page", by: -(n ?? 1) };
      case "h":
      case "ArrowLeft":
        return { kind: "side", side: "question" };
      case "l":
      case "ArrowRight":
        return { kind: "side", side: "answer" };
      case " ":
        return { kind: "side", side: "flip" };
      case "J":
        return { kind: "scroll", by: 5 * (n ?? 1) };
      case "K":
        return { kind: "scroll", by: -5 * (n ?? 1) };
      case "/":
        return { kind: "search" };
      case "e":
        return { kind: "edit" };
      case "B": // as in Stepwise, where b opens Skim and B Anki's browser
        return { kind: "browse" };
      case "r":
        return { kind: "replay" };
      case "p":
        return { kind: "back" };
      case "q":
        return { kind: "close" };
      case "?":
        return { kind: "help" };
      case "i":
        return { kind: "tags" };
      case "f":
        return { kind: "filter", by: 1 };
      case "F":
        return { kind: "filter", by: -1 };
      case "t":
        return { kind: "lens", by: 1 };
      case "T":
      case "H": // the view to the left in the bar
        return { kind: "lens", by: -1 };
      case "L": // and to the right
        return { kind: "lens", by: 1 };
      case "Escape":
        return typed ? { kind: "cancel" } : { kind: "escape" };
    }
    return undefined;
  }
}
