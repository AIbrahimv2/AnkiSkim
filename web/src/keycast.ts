// The keys you press, shown over the table's corner and faded out once you
// stop, so someone watching a screen recording can see what was pressed.
// Quick presses build a short trail (1 0 j); a key held down or pressed
// again shows once, with a count (j ×5). A number or a first g still
// waiting for its key stays until it's used or cancelled. Same as
// Stepwise's (web/src/keycast.tsx there).

import type { KeyLike } from "./keys.ts";

/** How long the keys stay after the last press. */
const FADE_AFTER_MS = 1200;
/** The fade itself (the .keycast transition in styles.css). */
const FADE_MS = 300;
/** Keys in the trail at most; the oldest go first. */
const MAX_KEYS = 6;

const MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn", "OS", "Dead", "Unidentified"]);
const NAMES: Record<string, string> = {
  " ": "Space",
  ArrowDown: "↓",
  ArrowUp: "↑",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
  Enter: "↵",
  Backspace: "⌫",
  Delete: "⌦",
  Tab: "⇥",
  PageDown: "PgDn",
  PageUp: "PgUp",
};
const nav = typeof navigator === "undefined" ? null : navigator;
const MAC = /Mac/.test(nav?.platform ?? "");

/** A key press as it should read on screen: j, ⇧G, ⌃D, Space, ↓. Null for
 *  a modifier on its own. */
export function keyLabel(e: KeyLike, mac = MAC): string | null {
  if (MODIFIERS.has(e.key)) return null;
  let key = e.key;
  // Anki's web view reports Control as ctrlKey and Cmd as metaKey, as a
  // browser does. Control+d can come as the control character "\x04",
  // which only Control makes: that alone says Control.
  const code = key.length === 1 ? key.charCodeAt(0) : -1;
  const controlChar = code >= 1 && code <= 26;
  if (controlChar) key = String.fromCharCode(code + 96);
  const control = controlChar || e.ctrlKey;
  const command = !controlChar && e.metaKey;
  const name = NAMES[key] ?? key;
  const letter = name.length === 1 && /[a-z]/i.test(name);
  // A capital is Shift and the letter: say so, the way a keyboard does, and
  // for named keys (⇧↓, ⇧Space). A shifted symbol (?) already says it.
  const shift = e.shiftKey && (letter || key.length > 1 || key === " ");
  // In the order macOS writes them: ⌃⌥⇧⌘.
  const mods = mac
    ? (control ? "⌃" : "") + (e.altKey ? "⌥" : "") + (shift ? "⇧" : "") + (command ? "⌘" : "")
    : (control ? "Ctrl+" : "") + (e.altKey ? "Alt+" : "") + (shift ? "⇧" : "") + (command ? "Win+" : "");
  return letter && mods ? mods + name.toUpperCase() : mods + name;
}

interface Pressed {
  label: string;
  n: number;
  el: HTMLSpanElement;
}

export class KeyCast {
  readonly el: HTMLDivElement;
  private keys: Pressed[] = [];
  private held = false;
  private timer = 0;

  constructor(host: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "keycast";
    this.el.setAttribute("aria-hidden", "true"); // it only echoes your own keys
    this.el.hidden = true;
    host.append(this.el);
  }

  /** A key was pressed (outside a text field). */
  press(e: KeyLike): void {
    const label = keyLabel(e);
    if (!label) return;
    clearTimeout(this.timer);
    const last = this.keys[this.keys.length - 1];
    if (last && last.label === label) {
      last.n++;
      last.el.dataset.n = `×${last.n}`;
    } else {
      const el = document.createElement("span");
      el.className = "kc-key";
      el.textContent = label;
      this.keys.push({ label, n: 1, el });
      this.el.append(el);
      while (this.keys.length > MAX_KEYS) this.keys.shift()!.el.remove();
    }
    this.el.hidden = false;
    this.el.classList.remove("fading");
    this.later();
  }

  /** Keep the keys up while a command is half typed (a number, a first g). */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    if (on) clearTimeout(this.timer);
    else if (!this.el.hidden) this.later();
  }

  private later(): void {
    clearTimeout(this.timer);
    if (this.held) return;
    this.timer = window.setTimeout(() => {
      this.el.classList.add("fading");
      this.timer = window.setTimeout(() => {
        this.el.hidden = true;
        this.el.classList.remove("fading");
        for (const k of this.keys) k.el.remove();
        this.keys = [];
      }, FADE_MS);
    }, FADE_AFTER_MS);
  }
}
