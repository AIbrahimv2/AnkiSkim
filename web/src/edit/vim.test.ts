import assert from "node:assert/strict";
import { test } from "node:test";
import { type Command, type KeyLike, type Mode, Vim } from "./vim.ts";

const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

/** Type keys ("d2w", or ["Escape"]) and return the last result. */
function type(keys: Vim, seq: string | string[], mode: Mode = "normal"): Command | null | undefined {
  let out: Command | null | undefined;
  for (const k of typeof seq === "string" ? [...seq] : seq) out = keys.feed(key(k), mode);
  return out;
}

test("moves, with counts", () => {
  const k = new Vim();
  assert.deepEqual(type(k, "w"), { kind: "move", motion: { type: "w" }, count: null });
  assert.deepEqual(type(k, "12j"), { kind: "move", motion: { type: "j" }, count: 12 });
  assert.deepEqual(type(k, "gg"), { kind: "move", motion: { type: "gg" }, count: null });
  assert.deepEqual(type(k, "3G"), { kind: "move", motion: { type: "G" }, count: 3 });
  assert.deepEqual(type(k, "0"), { kind: "move", motion: { type: "0" }, count: null });
  assert.deepEqual(type(k, "fx"), { kind: "move", motion: { type: "find", ch: "x", till: false, back: false }, count: null });
  assert.deepEqual(type(k, ","), { kind: "move", motion: { type: "find", ch: "x", till: false, back: true }, count: null });
});

test("operators", () => {
  const k = new Vim();
  assert.deepEqual(type(k, "dw"), { kind: "operate", op: "d", motion: { type: "w" }, count: null });
  assert.deepEqual(type(k, "2d3w"), { kind: "operate", op: "d", motion: { type: "w" }, count: 6 });
  assert.deepEqual(type(k, "dd"), { kind: "operate", op: "d", motion: { type: "line" }, count: null });
  assert.deepEqual(type(k, "3yy"), { kind: "operate", op: "y", motion: { type: "line" }, count: 3 });
  assert.deepEqual(type(k, "ciw"), { kind: "operate", op: "c", motion: { type: "obj", obj: "w", around: false }, count: null });
  assert.deepEqual(type(k, "dac"), { kind: "operate", op: "d", motion: { type: "obj", obj: "c", around: true }, count: null });
  assert.deepEqual(type(k, "dt."), { kind: "operate", op: "d", motion: { type: "find", ch: ".", till: true, back: false }, count: null });
  assert.deepEqual(type(k, "dgg"), { kind: "operate", op: "d", motion: { type: "gg" }, count: null });
  assert.deepEqual(type(k, "x"), { kind: "operate", op: "d", motion: { type: "l" }, count: null });
  assert.deepEqual(type(k, "D"), { kind: "operate", op: "d", motion: { type: "$" }, count: null });
  assert.deepEqual(type(k, "gciw"), { kind: "operate", op: "cloze", motion: { type: "obj", obj: "w", around: false }, count: null });
  assert.deepEqual(type(k, "gCe"), { kind: "operate", op: "clozeSame", motion: { type: "e" }, count: null });
  assert.equal(type(k, "dc"), null);
  assert.equal(k.typed, "");
});

test("what's typed shows until it's a command", () => {
  const k = new Vim();
  type(k, "2d");
  assert.equal(k.typed, "2d");
  type(k, "i");
  assert.equal(k.typed, "2di");
  type(k, ["Escape"]);
  assert.equal(k.typed, "");
});

test("normal mode never types", () => {
  const k = new Vim();
  assert.equal(type(k, "m"), null);
  assert.equal(type(k, "#"), null);
  assert.deepEqual(type(k, "rx"), { kind: "replace", ch: "x", count: 1 });
  assert.deepEqual(type(k, "3rx"), { kind: "replace", ch: "x", count: 3 });
  assert.deepEqual(type(k, "ZZ"), { kind: "close" });
  assert.deepEqual(type(k, "gx"), { kind: "uncloze" });
  assert.deepEqual(type(k, "J"), { kind: "note", by: 1 });
  assert.deepEqual(type(k, "4K"), { kind: "note", by: -4 });
});

test("insert mode lets typing through", () => {
  const k = new Vim();
  assert.equal(type(k, "d", "insert"), undefined);
  assert.deepEqual(type(k, ["Escape"], "insert"), { kind: "escape" });
  assert.deepEqual(k.feed(key("Tab", { shiftKey: true }), "insert"), { kind: "field", by: -1 });
  assert.deepEqual(k.feed(key("b", { metaKey: true }), "insert"), { kind: "format", what: "bold" });
  assert.equal(k.feed(key("v", { metaKey: true }), "insert"), undefined);
  assert.deepEqual(k.feed(key("C", { metaKey: true, shiftKey: true, code: "KeyC" }), "insert"), { kind: "clozeShortcut", same: false });
  assert.deepEqual(k.feed(key("\x1b", { ctrlKey: true }), "insert"), { kind: "escape" });
});

test("visual mode", () => {
  const k = new Vim();
  assert.deepEqual(type(k, "d", "visual"), { kind: "operateSelection", op: "d" });
  assert.deepEqual(type(k, "gc", "visual"), { kind: "operateSelection", op: "cloze" });
  assert.deepEqual(type(k, "iw", "visual"), { kind: "move", motion: { type: "obj", obj: "w", around: false }, count: null });
  assert.deepEqual(type(k, "v", "visual"), { kind: "escape" });
  assert.deepEqual(type(k, "V", "visual"), { kind: "visual", linewise: true });
  assert.deepEqual(type(k, "3w", "visual"), { kind: "move", motion: { type: "w" }, count: 3 });
});

test("Ctrl keys, as Anki's web view reports them", () => {
  const k = new Vim();
  assert.deepEqual(k.feed(key("\x12", { metaKey: true }), "normal"), { kind: "redo" });
  assert.deepEqual(k.feed(key("d", { ctrlKey: true }), "normal"), { kind: "scroll", dir: 1 });
  assert.deepEqual(k.feed(key("u", { ctrlKey: true }), "normal"), { kind: "scroll", dir: -1 });
  assert.deepEqual(k.feed(key("u", { ctrlKey: true }), "visual"), { kind: "format", what: "underline" });
  assert.equal(k.feed(key("c", { metaKey: true }), "normal"), undefined);
});
