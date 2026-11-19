import assert from "node:assert/strict";
import { test } from "node:test";
import { clampNormal, clozeAt, clozes, move, nextClozeNumber, range, textObject } from "./text.ts";

const m = (type: string) => ({ type }) as never;
const cut = (text: string, pos: number, motion: unknown, count: number | null = null, change = false) => {
  const r = range(text, pos, motion as never, count, change);
  return r && text.slice(r.from, r.to);
};

test("h and l stay on the line, on a character", () => {
  assert.equal(move("abc\ndef", 0, m("h"), null), 0);
  assert.equal(move("abc\ndef", 1, m("l"), 5), 2);
  assert.equal(move("abc\ndef", 4, m("h"), 3), 4);
  assert.equal(clampNormal("abc\n\ndef", 3), 2);
  assert.equal(clampNormal("abc\n\ndef", 4), 4);
});

test("w, b and e, across lines and empty ones", () => {
  const t = "one two-x\n\nthree";
  assert.equal(move(t, 0, m("w"), null), 4);
  assert.equal(move(t, 4, m("w"), null), 7);
  assert.equal(move(t, 7, m("w"), null), 8);
  assert.equal(move(t, 8, m("w"), null), 10);
  assert.equal(move(t, 10, m("w"), null), 11);
  assert.equal(move(t, 0, m("W"), 2), 10);
  assert.equal(move(t, 11, m("b"), null), 10);
  assert.equal(move(t, 10, m("b"), null), 8);
  assert.equal(move(t, 0, m("e"), null), 2);
  assert.equal(move(t, 2, m("e"), 2), 7);
  assert.equal(move(t, 11, m("w"), null), 15);
});

test("0, ^, $ and lines", () => {
  const t = "  ab\ncd\nef";
  assert.equal(move(t, 3, m("0"), null), 0);
  assert.equal(move(t, 0, m("^"), null), 2);
  assert.equal(move(t, 0, m("$"), null), 3);
  assert.equal(move(t, 0, m("$"), 2), 6);
  assert.equal(move(t, 3, m("j"), null), 6);
  assert.equal(move(t, 9, m("k"), 5), 1);
  assert.equal(move(t, 0, m("G"), null), 8);
  assert.equal(move(t, 9, m("gg"), null), 2);
});

test("f and t", () => {
  const t = "a,b,c\nd,e";
  assert.equal(move(t, 0, { type: "find", ch: ",", till: false, back: false }, null), 1);
  assert.equal(move(t, 0, { type: "find", ch: ",", till: false, back: false }, 2), 3);
  assert.equal(move(t, 0, { type: "find", ch: ",", till: true, back: false }, 2), 2);
  assert.equal(move(t, 4, { type: "find", ch: ",", till: false, back: true }, null), 3);
  assert.equal(move(t, 4, { type: "find", ch: "e", till: false, back: false }, null), null);
});

test("operators take what vim takes", () => {
  const t = "one two three\nfour";
  assert.equal(cut(t, 0, m("w")), "one ");
  assert.equal(cut(t, 0, m("w"), 2), "one two ");
  assert.equal(cut(t, 8, m("w")), "three");
  assert.equal(cut(t, 0, m("w"), null, true), "one");
  assert.equal(cut(t, 2, m("w"), null, true), "e");
  assert.equal(cut(t, 0, m("w"), 2, true), "one two");
  assert.equal(cut(t, 0, m("e")), "one");
  assert.equal(cut(t, 4, m("$")), "two three");
  assert.equal(cut(t, 4, m("0")), "one ");
  assert.equal(cut(t, 4, m("b")), "one ");
  assert.equal(cut(t, 4, m("l"), 3), "two");
  assert.equal(cut(t, 12, m("l"), 3), "e");
  assert.equal(cut(t, 5, m("line")), "one two three");
  assert.equal(cut(t, 5, m("line"), 2), t);
  assert.equal(cut(t, 5, m("j")), t);
  assert.equal(cut(t, 15, m("k")), t);
  assert.equal(cut(t, 0, { type: "find", ch: "w", till: true, back: false }), "one t");
  assert.equal(cut("", 0, m("w")), null);
});

test("words as objects", () => {
  const t = "one two  three";
  assert.equal(cut(t, 5, { type: "obj", obj: "w", around: false }), "two");
  assert.equal(cut(t, 5, { type: "obj", obj: "w", around: true }), "two  ");
  assert.equal(cut(t, 11, { type: "obj", obj: "w", around: true }), "  three");
  assert.equal(cut(t, 0, { type: "obj", obj: "w", around: true }, 2), "one two  ");
});

test("brackets and quotes", () => {
  const t = 'f(a, (b)) "x y" z';
  assert.equal(cut(t, 3, { type: "obj", obj: "(", around: false }), "a, (b)");
  assert.equal(cut(t, 6, { type: "obj", obj: "b", around: true }), "(b)");
  assert.equal(cut(t, 12, { type: "obj", obj: '"', around: false }), "x y");
  assert.equal(cut(t, 12, { type: "obj", obj: '"', around: true }), '"x y"');
  assert.equal(textObject(t, 16, "(", false), null);
});

test("clozes", () => {
  const t = "The {{c1::heart::organ}} has {{c2::four {{c3::big}} rooms}}.";
  assert.equal(clozes(t).length, 3);
  assert.equal(cut(t, 12, { type: "obj", obj: "c", around: false }), "heart");
  assert.equal(cut(t, 12, { type: "obj", obj: "c", around: true }), "{{c1::heart::organ}}");
  assert.equal(cut(t, 4, { type: "obj", obj: "c", around: false }), "heart");
  assert.equal(cut(t, 46, { type: "obj", obj: "c", around: false }), "big");
  assert.equal(cut(t, 36, { type: "obj", obj: "c", around: false }), "four {{c3::big}} rooms");
  assert.equal(clozeAt(t, 0), null);
  assert.equal(nextClozeNumber([t, "x"]), 4);
  assert.equal(nextClozeNumber([t], true), 3);
  assert.equal(nextClozeNumber(["plain"]), 1);
  assert.equal(nextClozeNumber(["plain"], true), 1);
});
