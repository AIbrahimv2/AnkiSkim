import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SYMBOLS, type SymbolPair, Symbols } from "./symbols.ts";

const s = new Symbols(DEFAULT_SYMBOLS);
/** The text after typing it all, with what's typed turning over as it goes
 *  (a character at a time, as a keyboard types it). */
const type = (keys: string, sym = s, start = ""): string => {
  let text = start;
  for (const ch of keys) {
    text += ch;
    const w = sym.typed(text, text.length);
    if (w) text = text.slice(0, w.from) + w.value + text.slice(w.to);
  }
  return text;
};

test("colon keys and arrows turn over as their last character is typed", () => {
  assert.equal(type("a -> b"), "a → b");
  assert.equal(type("x<-y"), "x←y");
  assert.equal(type("A => B <= C"), "A ⇒ B ⇐ C");
  assert.equal(type(":alpha: and :beta:-blockers"), "α and β-blockers");
  assert.equal(type("Ca:2+: :pm: 0.5"), "Ca:2+: ± 0.5");
  assert.equal(type("PaO2:FiO2"), "PaO2:FiO2");
  assert.equal(type(":1/2: of :Delta:G"), "½ of ΔG");
  assert.equal(type("37:deg:C"), "37°C");
});

test("the longest key wins", () => {
  assert.equal(type(":N2:"), "⇑");
  assert.equal(type(":subseteq:"), "⊆");
  assert.equal(type(":eta: :zeta: :beta:"), "η ζ β");
});

test("dashes wait for a space after them, as a word of their own", () => {
  assert.equal(type("a -- b"), "a ‒ b");
  assert.equal(type("a --- b"), "a — b");
  assert.equal(type("--- at the start "), "— at the start ");
  assert.equal(type("a--b c"), "a--b c");
  assert.equal(type("a-- b"), "a-- b");
  assert.equal(type("a --b"), "a --b");
  // The space can be the browser's non-breaking one.
  assert.equal(type("a -- "), "a ‒ ");
  assert.equal(s.beforeBreak("a ---", 5)?.value, "—");
  assert.equal(s.beforeBreak("a---", 4), null);
});

test("a cloze's colons aren't a symbol's", () => {
  assert.equal(type("{{c1::beta::hint}}"), "{{c1::beta::hint}}");
  assert.equal(type("{{c1::the answer::beta: a hint}}"), "{{c1::the answer::beta: a hint}}");
  assert.equal(type("{{c12::pi::}}"), "{{c12::pi::}}");
  // A symbol typed in a cloze, right after its ::, still turns over.
  assert.equal(type(":beta:", s, "{{c1::"), "{{c1::β");
  assert.equal(type("{{c1::low :mu: here}}"), "{{c1::low μ here}}");
});

test("only the characters that can end a key are worth a look", () => {
  assert.equal(s.mayFinish(":"), true);
  assert.equal(s.mayFinish(">"), true);
  assert.equal(s.mayFinish("-"), true);
  assert.equal(s.mayFinish(" "), true);
  assert.equal(s.mayFinish("a"), false);
  assert.equal(s.mayFinish("2"), false);
  const colons = new Symbols([[":x:", "×"]]);
  assert.equal(colons.mayFinish(" "), false, "no word keys: a space can't finish one");
});

test("your own list, as Symbols As You Type keeps it", () => {
  const mine: SymbolPair[] = [
    ["->", "⟶"],
    [":hb:", "Hb"],
    ["::br::", "<br>"],
    ["mmHg", "㎜Hg"],
    ["bad key", "x"],
    ["", "x"],
    [":empty:", ""],
    [":", "!"],
  ];
  const own = new Symbols(mine);
  assert.equal(type("a -> :hb:", own), "a ⟶ Hb");
  assert.deepEqual(own.typed("a::br::", 7), { from: 1, to: 7, value: "<br>", html: true });
  assert.equal(own.typed("{{c1::br::", 10), null, "a cloze's opening :: isn't an HTML key's");
  assert.equal(type("120 mmHg ", own), "120 ㎜Hg ");
  assert.equal(type("bad key :empty: a:b", own), "bad key :empty: a:b", "keys with spaces, empty ones and a lone colon are left out");
  assert.equal(type(":alpha:", own), ":alpha:", "and only your list is used");
});
