// Run with `npm test`: how key presses read in the key cast (keycast.ts).
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyLabel } from "./keycast.ts";
import type { KeyLike } from "./keys.ts";

const press = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});
const mac = (e: KeyLike) => keyLabel(e, true);
const pc = (e: KeyLike) => keyLabel(e, false);

test("plain keys read as they are", () => {
  assert.equal(mac(press("j")), "j");
  assert.equal(mac(press("5")), "5");
  assert.equal(mac(press("/")), "/");
  assert.equal(mac(press("?", { shiftKey: true })), "?");
});

test("a capital says Shift", () => {
  assert.equal(mac(press("G", { shiftKey: true })), "⇧G");
  assert.equal(pc(press("L", { shiftKey: true })), "⇧L");
});

test("named keys get their symbols", () => {
  assert.equal(mac(press(" ")), "Space");
  assert.equal(mac(press("ArrowDown")), "↓");
  assert.equal(mac(press("Escape")), "Esc");
  assert.equal(mac(press("PageDown")), "PgDn");
});

test("Control and Command, each as itself", () => {
  assert.equal(mac(press("d", { ctrlKey: true })), "⌃D");
  assert.equal(mac(press("d", { metaKey: true })), "⌘D");
  assert.equal(mac(press("z", { metaKey: true, shiftKey: true })), "⇧⌘Z");
  assert.equal(mac(press("ArrowDown", { shiftKey: true })), "⇧↓");
  assert.equal(pc(press("d", { ctrlKey: true })), "Ctrl+D");
});

test("a control character is Control, whatever the flags say", () => {
  assert.equal(mac(press("\x04", { ctrlKey: true })), "⌃D");
  assert.equal(mac(press("\x04", { metaKey: true })), "⌃D");
  assert.equal(mac(press("\x15")), "⌃U");
});

test("a modifier on its own shows nothing", () => {
  for (const key of ["Shift", "Control", "Meta", "Alt", "CapsLock"]) assert.equal(mac(press(key)), null);
});
