// Vim's motions and text objects over a field's text, as plain functions:
// text and a position in, a position or a range out. No DOM here (flat.ts
// turns a field into this text and back), so it's tested on its own
// (text.test.ts).
//
// The text is the field as you read it: one "\n" per line break, and
// OBJECT for anything that isn't text (an image). In normal mode the cursor
// is on a character, as in vim: never on the "\n" unless the line is empty.

/** Stands for an image (or anything else that isn't text) in a field. */
export const OBJECT = "￼";

export type Motion =
  | { type: "h" | "l" | "j" | "k" | "w" | "b" | "e" | "W" | "B" | "E" | "0" | "^" | "$" | "gg" | "G" }
  | { type: "find"; ch: string; till: boolean; back: boolean }
  | { type: "obj"; obj: string; around: boolean }
  | { type: "line" };

export interface Range {
  from: number;
  to: number;
  /** Whole lines (dd, dj, Vd): `from` starts a line and `to` ends one,
   *  before its "\n". */
  linewise: boolean;
}

// --- lines ----------------------------------------------------------------------

export function lineStart(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

/** Where the line's "\n" is, or the end of the text. */
export function lineEnd(text: string, pos: number): number {
  const i = text.indexOf("\n", pos);
  return i === -1 ? text.length : i;
}

/** The last place the cursor can be on `pos`'s line in normal mode: its
 *  last character, or its start if it's empty. */
export function lastOnLine(text: string, pos: number): number {
  const start = lineStart(text, pos);
  return Math.max(start, lineEnd(text, pos) - 1);
}

/** `pos`, kept on a character of its line (normal mode). */
export function clampNormal(text: string, pos: number): number {
  const p = Math.max(0, Math.min(pos, text.length));
  return Math.min(p, lastOnLine(text, p));
}

export function firstNonBlank(text: string, pos: number): number {
  const end = lineEnd(text, pos);
  let i = lineStart(text, pos);
  while (i < end && /\s/.test(text[i])) i++;
  return i === end ? Math.max(lineStart(text, pos), end - 1) : i;
}

/** The start of the line `by` lines from `pos`'s (stopping at the first or
 *  last). */
function lineOffset(text: string, pos: number, by: number): number {
  let start = lineStart(text, pos);
  for (let n = by; n > 0; n--) {
    const end = lineEnd(text, start);
    if (end >= text.length) break;
    start = end + 1;
  }
  for (let n = by; n < 0; n++) {
    if (start === 0) break;
    start = lineStart(text, start - 1);
  }
  return start;
}

// --- words ----------------------------------------------------------------------

const SPACE = 0;
const WORD = 1;
const PUNCT = 2;
const THING = 3;

function cls(ch: string, big: boolean): number {
  if (ch === undefined || /\s/.test(ch)) return SPACE;
  if (big) return WORD;
  if (ch === OBJECT) return THING;
  return /[\p{L}\p{N}\p{M}_]/u.test(ch) ? WORD : PUNCT;
}

function emptyLine(text: string, i: number): boolean {
  return text[i] === "\n" && (i === 0 || text[i - 1] === "\n");
}

/** w: the start of the next word (an empty line counts as one). May be the
 *  end of the text. */
export function nextWord(text: string, pos: number, big: boolean): number {
  const n = text.length;
  let i = pos;
  if (i >= n) return n;
  const c = cls(text[i], big);
  if (c !== SPACE) while (i < n && cls(text[i], big) === c) i++;
  else if (emptyLine(text, i)) i++;
  while (i < n && cls(text[i], big) === SPACE) {
    if (emptyLine(text, i)) return i;
    i++;
  }
  return i;
}

/** b: the start of this word, or of the one before. */
export function prevWord(text: string, pos: number, big: boolean): number {
  let i = pos - 1;
  if (i <= 0) return 0;
  while (i > 0 && cls(text[i], big) === SPACE) {
    if (emptyLine(text, i)) return i;
    i--;
  }
  const c = cls(text[i], big);
  if (c === SPACE) return i;
  while (i > 0 && cls(text[i - 1], big) === c) i--;
  return i;
}

/** e: the end of this word, or of the next (its last character). */
export function wordEnd(text: string, pos: number, big: boolean): number {
  const n = text.length;
  let i = pos + 1;
  while (i < n && cls(text[i], big) === SPACE) i++;
  if (i >= n) return Math.max(0, n - 1);
  const c = cls(text[i], big);
  while (i + 1 < n && cls(text[i + 1], big) === c) i++;
  return i;
}

// --- f, t -----------------------------------------------------------------------

function find(text: string, pos: number, m: { ch: string; till: boolean; back: boolean }, count: number): number | null {
  let i = pos;
  if (m.back) {
    const start = lineStart(text, pos);
    for (let n = 0; n < count; n++) {
      const from = i - 1;
      const at = from < start ? -1 : text.lastIndexOf(m.ch, from);
      if (at < start) return null;
      i = at;
    }
    return m.till ? i + 1 : i;
  }
  const end = lineEnd(text, pos);
  for (let n = 0; n < count; n++) {
    const at = text.indexOf(m.ch, i + 1);
    if (at === -1 || at >= end) return null;
    i = at;
  }
  return m.till ? i - 1 : i;
}

// --- moving ---------------------------------------------------------------------

/** Where a motion takes the cursor in normal mode, or null if it goes
 *  nowhere (f with no match). j and k here move by the text's lines; the
 *  page moves by the lines on screen instead, where it can. */
export function move(text: string, pos: number, motion: Motion, count: number | null): number | null {
  const n = count ?? 1;
  let p = pos;
  switch (motion.type) {
    case "h":
      return Math.max(lineStart(text, pos), pos - n);
    case "l":
      return Math.min(lastOnLine(text, pos), pos + n);
    case "j":
    case "k": {
      const col = pos - lineStart(text, pos);
      const start = lineOffset(text, pos, motion.type === "j" ? n : -n);
      return Math.min(start + col, lastOnLine(text, start));
    }
    case "w":
    case "W":
      for (let i = 0; i < n; i++) p = nextWord(text, p, motion.type === "W");
      return clampNormal(text, p);
    case "b":
    case "B":
      for (let i = 0; i < n; i++) p = prevWord(text, p, motion.type === "B");
      return p;
    case "e":
    case "E":
      for (let i = 0; i < n; i++) p = wordEnd(text, p, motion.type === "E");
      return p;
    case "0":
      return lineStart(text, pos);
    case "^":
      return firstNonBlank(text, pos);
    case "$":
      return lastOnLine(text, lineOffset(text, pos, n - 1));
    case "gg":
      return firstNonBlank(text, count ? lineOffset(text, 0, count - 1) : 0);
    case "G":
      return firstNonBlank(text, count ? lineOffset(text, 0, count - 1) : text.length);
    case "find":
      return find(text, pos, motion, n);
    case "obj":
    case "line":
      return null;
  }
}

// --- text objects ---------------------------------------------------------------

/** A cloze deletion in the text: {{c1::answer::hint}}. */
export interface Cloze {
  /** The first "{". */
  open: number;
  /** After "{{c1::". */
  inner: number;
  /** Where the answer ends: the hint's "::", or else the closing "}}". */
  answerEnd: number;
  /** The closing "}}". */
  close: number;
  /** After it. */
  end: number;
  n: number;
}

/** Every cloze in the text, outermost first (a cloze can hold others). */
export function clozes(text: string): Cloze[] {
  const out: Cloze[] = [];
  const stack: Cloze[] = [];
  const marker = /\{\{c(\d+)::|\}\}|::/g;
  for (let m = marker.exec(text); m; m = marker.exec(text)) {
    if (m[1] !== undefined) {
      stack.push({ open: m.index, inner: m.index + m[0].length, answerEnd: -1, close: -1, end: -1, n: Number(m[1]) });
    } else if (m[0] === "::") {
      const top = stack[stack.length - 1];
      if (top && top.answerEnd === -1) top.answerEnd = m.index;
    } else {
      const top = stack.pop();
      if (!top) continue;
      top.close = m.index;
      top.end = m.index + 2;
      if (top.answerEnd === -1) top.answerEnd = top.close;
      out.push(top);
    }
  }
  return out.sort((a, b) => a.open - b.open);
}

/** The innermost cloze the position is in (on its braces too). */
export function clozeAt(text: string, pos: number): Cloze | null {
  let best: Cloze | null = null;
  for (const c of clozes(text)) if (c.open <= pos && pos < c.end && (!best || c.open >= best.open)) best = c;
  return best;
}

/** The next number for a new cloze: one more than the highest in `texts`
 *  (a note's fields). */
export function nextClozeNumber(texts: string[], same = false): number {
  let max = 0;
  for (const t of texts) for (const m of t.matchAll(/\{\{c(\d+)::/g)) max = Math.max(max, Number(m[1]));
  return same ? Math.max(1, max) : max + 1;
}

const PAIRS: Record<string, [string, string]> = {
  "(": ["(", ")"], ")": ["(", ")"], b: ["(", ")"],
  "[": ["[", "]"], "]": ["[", "]"],
  "{": ["{", "}"], "}": ["{", "}"], B: ["{", "}"],
  "<": ["<", ">"], ">": ["<", ">"],
};
const QUOTES = new Set(['"', "'", "`"]);

function wordObject(text: string, pos: number, around: boolean, big: boolean): Range | null {
  const start = lineStart(text, pos);
  const end = lineEnd(text, pos);
  if (start === end) return null;
  const c = cls(text[pos], big);
  let from = pos;
  let to = pos + 1;
  while (from > start && cls(text[from - 1], big) === c) from--;
  while (to < end && cls(text[to], big) === c) to++;
  if (around) {
    if (c === SPACE) {
      // The space and the word after it.
      const next = cls(text[to], big);
      while (to < end && cls(text[to], big) === next) to++;
    } else if (to < end && cls(text[to], big) === SPACE) {
      while (to < end && cls(text[to], big) === SPACE) to++;
    } else {
      while (from > start && cls(text[from - 1], big) === SPACE) from--;
    }
  }
  return { from, to, linewise: false };
}

function pairObject(text: string, pos: number, around: boolean, [open, close]: [string, string]): Range | null {
  let depth = 0;
  let from = -1;
  for (let i = pos; i >= 0; i--) {
    if (text[i] === close && i !== pos) depth++;
    else if (text[i] === open) {
      if (depth === 0) {
        from = i;
        break;
      }
      depth--;
    }
  }
  if (from === -1) return null;
  depth = 0;
  for (let i = from + 1; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      if (depth === 0) return around ? { from, to: i + 1, linewise: false } : { from: from + 1, to: i, linewise: false };
      depth--;
    }
  }
  return null;
}

function quoteObject(text: string, pos: number, around: boolean, q: string): Range | null {
  const start = lineStart(text, pos);
  const end = lineEnd(text, pos);
  const at: number[] = [];
  for (let i = start; i < end; i++) if (text[i] === q) at.push(i);
  for (let i = 0; i + 1 < at.length; i += 2) {
    const [a, b] = [at[i], at[i + 1]];
    // Inside this pair, or before it with no pair under the cursor.
    if (pos <= b && (pos >= a || i === 0 || pos > at[i - 1])) {
      return around ? { from: a, to: b + 1, linewise: false } : { from: a + 1, to: b, linewise: false };
    }
  }
  return null;
}

export function textObject(text: string, pos: number, obj: string, around: boolean): Range | null {
  if (obj === "w" || obj === "W") return wordObject(text, pos, around, obj === "W");
  if (obj === "c") {
    const c = clozeAt(text, pos);
    if (!c) return null;
    return around ? { from: c.open, to: c.end, linewise: false } : { from: c.inner, to: c.answerEnd, linewise: false };
  }
  if (PAIRS[obj]) return pairObject(text, pos, around, PAIRS[obj]);
  if (QUOTES.has(obj)) return quoteObject(text, pos, around, obj);
  return null;
}

/** Whether `ch` names a text object after i or a. */
export function isObject(ch: string): boolean {
  return ch === "w" || ch === "W" || ch === "c" || !!PAIRS[ch] || QUOTES.has(ch);
}

// --- operators ------------------------------------------------------------------

/** The lines from `a`'s to `b`'s, without the last one's "\n". */
export function lines(text: string, a: number, b: number): Range {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { from: lineStart(text, lo), to: lineEnd(text, hi), linewise: true };
}

/** What an operator (d, c, y, ...) acts on for a motion from `pos`, or null
 *  if the motion goes nowhere. `change` is c, which treats words its own
 *  way (cw is ce). */
export function range(text: string, pos: number, motion: Motion, count: number | null, change = false): Range | null {
  const n = count ?? 1;
  switch (motion.type) {
    case "line":
      return lines(text, pos, lineOffset(text, pos, n - 1));
    case "j":
      return lines(text, pos, lineOffset(text, pos, n));
    case "k":
      return lines(text, pos, lineOffset(text, pos, -n));
    case "gg":
      return lines(text, pos, count ? lineOffset(text, 0, count - 1) : 0);
    case "G":
      return lines(text, pos, count ? lineOffset(text, 0, count - 1) : text.length);
    case "obj": {
      let r = textObject(text, pos, motion.obj, motion.around);
      // 2aw: this word and the next.
      for (let i = 1; r && i < n && (motion.obj === "w" || motion.obj === "W"); i++) {
        const more = textObject(text, r.to, motion.obj, motion.around);
        if (!more) break;
        r = { from: r.from, to: more.to, linewise: false };
      }
      return r;
    }
    case "w":
    case "W": {
      const big = motion.type === "W";
      const end = lineEnd(text, pos);
      let p = pos;
      if (change && pos < end && !/\s/.test(text[pos])) {
        // cw changes to the end of the word, not the space after it.
        for (let i = 0; i < n; i++) {
          if (i > 0) p = wordEnd(text, p, big);
          else while (p + 1 < end && cls(text[p + 1], big) === cls(text[pos], big)) p++;
        }
        return { from: pos, to: Math.min(p + 1, text.length), linewise: false };
      }
      for (let i = 0; i < n; i++) {
        const q = nextWord(text, p, big);
        // The last word on a line: up to the line's end, not into the next.
        p = i === n - 1 && q > lineEnd(text, p) ? lineEnd(text, p) : q;
      }
      return p > pos ? { from: pos, to: p, linewise: false } : null;
    }
    case "e":
    case "E":
    case "$":
    case "find": {
      const to = move(text, pos, motion, count);
      if (to === null) return null;
      if (motion.type === "find" && motion.back) return to < pos ? { from: to, to: pos, linewise: false } : null;
      if (motion.type === "$") return { from: pos, to: lineEnd(text, to), linewise: false };
      // These land on the last character they take.
      return to >= pos ? { from: pos, to: Math.min(to + 1, text.length), linewise: false } : null;
    }
    case "l": {
      const to = Math.min(lineEnd(text, pos), pos + n);
      return to > pos ? { from: pos, to, linewise: false } : null;
    }
    case "h":
    case "b":
    case "B":
    case "0":
    case "^": {
      const to = move(text, pos, motion, count);
      if (to === null || to === pos) return null;
      return to < pos ? { from: to, to: pos, linewise: false } : { from: pos, to, linewise: false };
    }
  }
}
