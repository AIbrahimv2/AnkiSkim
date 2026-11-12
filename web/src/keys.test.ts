// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { type Command, type KeyLike, Keys } from "./keys.ts";

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

/** Feed keys typed as a string ("10j", "gg"), returning the last result. */
function type(keys: Keys, text: string): Command | null | undefined {
  let out: Command | null | undefined;
  for (const ch of text) out = keys.feed(press(ch));
  return out;
}

test("j and k move one card, or as many as the number before them", () => {
  const k = new Keys();
  assert.deepEqual(type(k, "j"), { kind: "move", by: 1 });
  assert.deepEqual(type(k, "k"), { kind: "move", by: -1 });
  assert.deepEqual(type(k, "10j"), { kind: "move", by: 10 });
  assert.deepEqual(type(k, "3k"), { kind: "move", by: -3 });
  assert.deepEqual(k.feed(press("ArrowDown")), { kind: "move", by: 1 });
});

test("numbers show while you type them, and Esc cancels them", () => {
  const k = new Keys();
  assert.equal(type(k, "12"), null);
  assert.equal(k.typed, "12");
  assert.deepEqual(k.feed(press("Escape")), { kind: "cancel" });
  assert.equal(k.typed, "");
  assert.deepEqual(k.feed(press("Escape")), { kind: "close" });
});

test("a leading 0 isn't a number", () => {
  const k = new Keys();
  assert.equal(type(k, "0"), undefined);
  assert.deepEqual(type(k, "10j"), { kind: "move", by: 10 });
});

test("gg, G and numbers before them go to a row", () => {
  const k = new Keys();
  assert.equal(type(k, "g"), null);
  assert.equal(k.typed, "g");
  assert.deepEqual(type(k, "g"), { kind: "goto", row: 1 });
  assert.deepEqual(type(k, "G"), { kind: "goto", row: -1 });
  assert.deepEqual(type(k, "25G"), { kind: "goto", row: 25 });
  assert.deepEqual(type(k, "7gg"), { kind: "goto", row: 7 });
  assert.equal(type(k, "7g"), null);
  assert.equal(k.typed, "7g");
});

test("Shift doesn't lose a number typed before G", () => {
  const k = new Keys();
  type(k, "10");
  assert.equal(k.feed(press("Shift", { shiftKey: true })), undefined);
  assert.deepEqual(k.feed(press("G", { shiftKey: true })), { kind: "goto", row: 10 });
});

test("a lone g followed by another key is just that key", () => {
  const k = new Keys();
  type(k, "g");
  assert.deepEqual(type(k, "j"), { kind: "move", by: 1 });
});

test("Ctrl-d and Ctrl-u move half a page, and a number before them sticks", () => {
  const k = new Keys();
  const ctrl = (key: string) => press(key, { ctrlKey: true });
  assert.deepEqual(k.feed(ctrl("d")), { kind: "half", dir: 1, rows: null });
  type(k, "5");
  assert.deepEqual(k.feed(ctrl("u")), { kind: "half", dir: -1, rows: 5 });
  assert.deepEqual(k.feed(ctrl("d")), { kind: "half", dir: 1, rows: 5 });
});

test("Control on a Mac, as Anki's web view reports it", () => {
  const k = new Keys();
  // metaKey for the Control key, and the key as a control character.
  assert.deepEqual(k.feed(press("\x04", { metaKey: true })), { kind: "half", dir: 1, rows: null });
  assert.deepEqual(k.feed(press("\x15", { metaKey: true })), { kind: "half", dir: -1, rows: null });
});

test("app shortcuts pass through", () => {
  const k = new Keys();
  assert.equal(k.feed(press("c", { metaKey: true })), undefined); // copy
  assert.equal(k.feed(press("w", { ctrlKey: true })), undefined);
  assert.equal(k.feed(press("j", { altKey: true })), undefined);
  assert.equal(k.feed(press("Tab")), undefined);
});

test("sides, scrolling and the rest", () => {
  const k = new Keys();
  assert.deepEqual(type(k, "h"), { kind: "side", side: "question" });
  assert.deepEqual(type(k, "l"), { kind: "side", side: "answer" });
  assert.deepEqual(type(k, " "), { kind: "side", side: "flip" });
  assert.deepEqual(type(k, "J"), { kind: "scroll", by: 5 });
  assert.deepEqual(type(k, "2K"), { kind: "scroll", by: -10 });
  assert.deepEqual(type(k, "/"), { kind: "search" });
  assert.deepEqual(type(k, "e"), { kind: "edit" });
  assert.deepEqual(type(k, "r"), { kind: "replay" });
  assert.deepEqual(type(k, "p"), { kind: "back" });
  assert.deepEqual(type(k, "q"), { kind: "close" });
  assert.deepEqual(type(k, "?"), { kind: "help" });
});
