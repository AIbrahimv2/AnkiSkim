// A field as vim sees it: its HTML read as plain text (text.ts works on
// that), with every place in the text mapped back to a place in the page.
//
// The text has one "\n" per line break you can see: a <br>, or the edge
// between two blocks (<div>one</div><div>two</div>). An image or anything
// else that isn't text is one OBJECT character. A <br> that only holds a
// line open (the one browsers put at the end of a line) isn't a break.
//
// Made fresh for each command (a field is a few kilobytes), never kept
// across an edit.

import { OBJECT } from "./text.ts";

const BLOCKS = new Set([
  "DIV", "P", "LI", "UL", "OL", "TABLE", "TBODY", "THEAD", "TFOOT", "TR", "TD", "TH", "CAPTION",
  "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "HEADER", "FOOTER",
  "DL", "DT", "DD", "FIGURE", "FIGCAPTION", "CENTER", "ADDRESS", "DETAILS", "SUMMARY", "HR",
]);
const ATOMS = new Set(["IMG", "VIDEO", "AUDIO", "IFRAME", "OBJECT", "EMBED", "SVG", "CANVAS", "INPUT", "BUTTON", "HR", "MATH", "ANKI-MATHJAX"]);
const SKIP = new Set(["SCRIPT", "STYLE", "TEMPLATE"]);
/** Space the browser folds away between blocks. */
const BLANK = /^[ \t\n\r\f]*$/;

type Seg =
  | { kind: "text"; node: Text; start: number; len: number }
  /** `len` 0: a <br> that only holds its line open. */
  | { kind: "br"; node: Element; start: number; len: 0 | 1 }
  | { kind: "atom"; node: Element; start: number; len: 1 }
  /** The edge between two blocks. */
  | { kind: "gap"; node: null; start: number; len: 1 };

function isBlock(n: Node): boolean {
  return n.nodeType === 1 && BLOCKS.has((n as Element).tagName.toUpperCase());
}

function isAtom(el: Element): boolean {
  return ATOMS.has(el.tagName.toUpperCase()) || (el as HTMLElement).contentEditable === "false";
}

function indexOf(node: Node): number {
  let i = 0;
  for (let n = node.previousSibling; n; n = n.previousSibling) i++;
  return i;
}

export class Flat {
  readonly text: string;
  private segs: Seg[] = [];
  private byText = new Map<Node, Seg>();
  /** A <br> holding the last, empty line open: the caret goes before it. */
  private hold: Seg | null = null;
  readonly root: HTMLElement;

  constructor(root: HTMLElement) {
    this.root = root;
    let text = "";
    // A block started or ended since the last thing on a line.
    let pending = false;
    const segs = this.segs;
    const breakLine = () => {
      if (pending && text && !text.endsWith("\n")) {
        segs.push({ kind: "gap", node: null, start: text.length, len: 1 });
        text += "\n";
      }
      pending = false;
    };
    const walk = (el: Node) => {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          const t = n as Text;
          const lineEmpty = pending || !text || text.endsWith("\n");
          if (lineEmpty && BLANK.test(t.data)) {
            const seg: Seg = { kind: "text", node: t, start: text.length, len: 0 };
            this.byText.set(t, seg);
            segs.push(seg);
            continue;
          }
          breakLine();
          const seg: Seg = { kind: "text", node: t, start: text.length, len: t.data.length };
          this.byText.set(t, seg);
          segs.push(seg);
          text += t.data.replace(/[\n\r\t\f]/g, " ");
        } else if (n.nodeType === 1) {
          const e = n as Element;
          const tag = e.tagName.toUpperCase();
          if (SKIP.has(tag)) continue;
          if (tag === "BR") {
            const lineHasText = !pending && !!text && !text.endsWith("\n");
            if (lineHasText && this.edgeAfter(e)) {
              segs.push({ kind: "br", node: e, start: text.length, len: 0 });
            } else {
              breakLine();
              segs.push({ kind: "br", node: e, start: text.length, len: 1 });
              text += "\n";
            }
          } else if (isAtom(e)) {
            const block = isBlock(e);
            if (block) pending = true;
            breakLine();
            segs.push({ kind: "atom", node: e, start: text.length, len: 1 });
            text += OBJECT;
            if (block) pending = true;
          } else if (BLOCKS.has(tag)) {
            pending = true;
            walk(e);
            pending = true;
          } else walk(e);
        }
      }
    };
    walk(root);
    // A <br> on an empty last line holds the line open, and is no break.
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (s.len === 0) continue;
      if (s.kind === "br") {
        s.len = 0;
        text = text.slice(0, -1);
        this.hold = s;
      }
      break;
    }
    this.text = text;
  }

  /** Whether a block's edge (or the field's end) comes right after `node`,
   *  with nothing to read in between. */
  private edgeAfter(node: Node): boolean {
    let n: Node = node;
    for (;;) {
      while (!n.nextSibling) {
        const up = n.parentNode;
        if (!up || up === this.root || isBlock(up)) return true;
        n = up;
      }
      n = n.nextSibling;
      for (;;) {
        if (n.nodeType === 3) {
          if (!BLANK.test((n as Text).data)) return false;
          break;
        }
        if (n.nodeType !== 1) break;
        const e = n as Element;
        const tag = e.tagName.toUpperCase();
        if (SKIP.has(tag)) break;
        if (BLOCKS.has(tag)) return true;
        if (tag === "BR" || isAtom(e)) return false;
        if (!e.firstChild) break;
        n = e.firstChild;
      }
    }
  }

  private static before(node: Node): [Node, number] {
    return [node.parentNode!, indexOf(node)];
  }

  private static after(s: Seg): [Node, number] {
    if (s.kind === "text") return [s.node, s.node.data.length];
    return [s.node!.parentNode!, indexOf(s.node!) + 1];
  }

  /** The place in the page for a place in the text. */
  at(offset: number): [Node, number] {
    const segs = this.segs;
    const k = Math.max(0, Math.min(offset, this.text.length));
    if (k === this.text.length && this.hold) return Flat.before(this.hold.node!);
    let prev: Seg | null = null; // the last thing with any width before `s`
    for (const s of segs) {
      if (s.len === 0) continue;
      if (k < s.start + s.len) {
        if (k === s.start) {
          // At an edge: stay in the text before it, so typing carries on
          // in that text (and its bold, its colour).
          if (prev && prev.kind === "text" && s.kind !== "gap") return Flat.after(prev);
          if (s.kind === "gap") return prev ? Flat.after(prev) : [this.root, 0];
          if (s.kind === "text") return [s.node, 0];
          return Flat.before(s.node);
        }
        return [s.node!, k - s.start]; // inside a text node
      }
      prev = s;
    }
    return prev ? Flat.after(prev) : [this.root, 0];
  }

  /** The place in the text for a place in the page (a selection's end). */
  offsetOf(node: Node, off: number): number {
    const own = this.byText.get(node);
    if (own) return own.start + Math.min(off, own.len);
    if (!this.root.contains(node)) return 0;
    const point = document.createRange();
    point.setStart(node, Math.min(off, node.nodeType === 3 ? (node as Text).data.length : node.childNodes.length));
    point.collapse(true);
    const probe = document.createRange();
    let prev: Seg | null = null;
    let gap: Seg | null = null;
    for (const s of this.segs) {
      if (s.kind === "gap") {
        gap = s;
        continue;
      }
      probe.selectNode(s.node);
      // The first thing at or after the point.
      if (point.compareBoundaryPoints(Range.START_TO_START, probe) <= 0) {
        if (!gap || !prev) return s.start;
        return this.pastEdge(prev.node!, node) ? gap.start + 1 : gap.start;
      }
      // Inside an atom: it's the atom.
      if (s.kind === "atom" && s.node.contains(node)) return s.start;
      if (s.len > 0) {
        prev = s;
        gap = null;
      }
    }
    return this.text.length;
  }

  /** Whether a block's edge lies between the thing at `before` and a caret
   *  in `container`: the caret is then on the next line. */
  private pastEdge(before: Node, container: Node): boolean {
    for (let x = before.parentNode; x && x !== this.root; x = x.parentNode) {
      if (isBlock(x) && !x.contains(container)) return true;
    }
    for (let y: Node | null = container; y && y !== this.root; y = y.parentNode) {
      if (isBlock(y) && !y.contains(before)) return true;
    }
    return false;
  }

  range(from: number, to: number): Range {
    const r = document.createRange();
    r.setStart(...this.at(from));
    r.setEnd(...this.at(Math.max(from, to)));
    return r;
  }

  /** Where the character at `pos` is on screen, for the block cursor; on an
   *  empty line or at the end, a sliver where the caret would be. */
  rect(pos: number): DOMRect {
    const text = this.text;
    if (pos < text.length && text[pos] !== "\n") {
      for (const s of this.segs) {
        if (s.kind === "atom" && s.start === pos) return s.node.getBoundingClientRect();
      }
      const rects = this.range(pos, pos + 1).getClientRects();
      for (const r of rects) if (r.width > 0 && r.height > 0) return r;
    }
    // A line break or the end: the <br> there, or a collapsed caret.
    for (const s of this.segs) {
      if (s.kind === "br" && s.start === pos && (s.len === 1 || s === this.hold)) {
        const r = s.node.getBoundingClientRect();
        if (r.height > 0) return new DOMRect(r.left, r.top, 0, r.height);
      }
    }
    const caret = this.range(pos, pos);
    const rects = caret.getClientRects();
    if (rects.length) return new DOMRect(rects[0].left, rects[0].top, 0, rects[0].height);
    if (pos > 0 && text[pos - 1] !== "\n") {
      const r = this.rect(pos - 1);
      return new DOMRect(r.right, r.top, 0, r.height);
    }
    // An empty field: its first line.
    const box = this.root.getBoundingClientRect();
    const cs = getComputedStyle(this.root);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
    return new DOMRect(box.left + parseFloat(cs.paddingLeft), box.top + parseFloat(cs.paddingTop), 0, line);
  }
}
