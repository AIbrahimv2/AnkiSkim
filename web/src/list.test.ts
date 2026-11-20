// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_ORDER, fullOrder, moveKey } from "./list.ts";

test("no order saved: the columns' own", () => {
  assert.deepEqual(fullOrder([]), [...DEFAULT_ORDER]);
});

test("a saved order is kept, # first whatever was saved", () => {
  const saved = ["ret", "text", "num", "deck", ...DEFAULT_ORDER.filter((k) => !["ret", "text", "num", "deck"].includes(k))];
  const order = fullOrder(saved);
  assert.deepEqual(order.slice(0, 4), ["num", "ret", "text", "deck"]);
  assert.equal(order.length, DEFAULT_ORDER.length);
});

test("a column added since goes after the one it follows by default", () => {
  // Saved before Lapses and Verdict were columns.
  const saved = DEFAULT_ORDER.filter((k) => k !== "lapses" && k !== "verdict" && k !== "num");
  const order = fullOrder(saved);
  assert.equal(order.indexOf("lapses"), order.indexOf("reps") + 1);
  assert.equal(order.at(-1), "verdict");
});

test("keys that aren't columns, and repeats, are left out", () => {
  const order = fullOrder(["bogus", "deck", "deck", "state"]);
  assert.equal(order.length, DEFAULT_ORDER.length);
  assert.ok(!order.includes("bogus" as never));
  // Card wasn't saved: it goes back after #, where it is by default.
  assert.deepEqual(order.slice(0, 4), ["num", "text", "deck", "state"]);
});

test("moving a column puts it before another, or last", () => {
  const order = [...DEFAULT_ORDER];
  const before = moveKey(order, "again", "deck");
  assert.equal(before.indexOf("again"), before.indexOf("deck") - 1);
  const last = moveKey(order, "deck", null);
  assert.equal(last.at(-1), "deck");
  assert.equal(last.length, order.length);
});
