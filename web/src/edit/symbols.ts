// Symbols as you type, while editing a card (insert mode): -> turns into →,
// :alpha: into α, :pm: into ±. The same list and the same rules as the
// Symbols As You Type add-on, which only reaches Anki's own editor. Where
// you have it, its list (yours, kept in the collection) comes from Python
// (notes.symbol_list) in place of this one.
//
// Pure, so it's tested on its own (symbols.test.ts); editor.ts does the
// swapping. There are three kinds of key, as in that add-on:
// - `:name:` and the arrows (-> <- => <=) turn over as soon as their last
//   character is typed;
// - `::name::` does too, and its symbol is HTML;
// - any other key (-- and ---) waits for a space or a new line after it,
//   and turns over only as a word of its own.

export type SymbolPair = [key: string, value: string];

/** Not colon keys, but they turn over at once all the same. */
const AT_ONCE = new Set(["->", "<-", "=>", "<="]);

export const DEFAULT_SYMBOLS: SymbolPair[] = [
  // Arrows
  ["->", "→"], ["=>", "⇒"], ["<-", "←"], ["<=", "⇐"],
  [":N:", "↑"], [":N2:", "⇑"], [":S:", "↓"], [":S2:", "⇓"],
  [":E:", "→"], [":E2:", "⇒"], [":W:", "←"], [":W2:", "⇐"],
  // Typography
  ["--", "‒"], ["---", "—"], [":dagger:", "†"], [":ddagger:", "‡"], [":section:", "§"], [":paragraph:", "¶"],
  // Maths
  [":infty:", "∞"], [":deg:", "°"], [":permil:", "‰"], [":sqrt:", "√"], [":cubert:", "∛"], [":4thrt:", "∜"],
  [":angle:", "∠"], [":hbar:", "ℏ"],
  [":pm:", "±"], [":mp:", "∓"], [":dot:", "·"], [":times:", "×"], [":div:", "÷"],
  [":approx:", "≈"], [":equiv:", "≡"], [":propto:", "∝"], [":neq:", "≠"], [":geq:", "≥"], [":leq:", "≤"],
  [":>>:", "≫"], [":<<:", "≪"],
  [":subset:", "⊂"], [":subseteq:", "⊆"], [":supset:", "⊃"], [":supseteq:", "⊇"], [":in:", "∈"], [":ni:", "∋"],
  [":cap:", "∩"], [":cup:", "∪"], [":emptyset:", "∅"],
  [":neg:", "¬"], [":vee:", "∨"], [":wedge:", "∧"], [":forall:", "∀"], [":exists:", "∃"], [":therefore:", "∴"],
  [":nabla:", "∇"], [":partial:", "∂"], [":integral:", "∫"],
  // Fractions
  [":1/2:", "½"], [":1/3:", "⅓"], [":2/3:", "⅔"], [":1/4:", "¼"], [":3/4:", "¾"], [":1/5:", "⅕"], [":2/5:", "⅖"],
  [":3/5:", "⅗"], [":4/5:", "⅘"], [":1/6:", "⅙"], [":5/6:", "⅚"], [":1/7:", "⅐"], [":1/8:", "⅛"], [":3/8:", "⅜"],
  [":5/8:", "⅝"], [":7/8:", "⅞"], [":1/9:", "⅑"], [":1/10:", "⅒"],
  // Greek
  [":alpha:", "α"], [":beta:", "β"], [":gamma:", "γ"], [":delta:", "δ"], [":epsilon:", "ε"], [":zeta:", "ζ"],
  [":eta:", "η"], [":theta:", "θ"], [":iota:", "ι"], [":kappa:", "κ"], [":lambda:", "λ"], [":mu:", "μ"],
  [":nu:", "ν"], [":xi:", "ξ"], [":omicron:", "ο"], [":pi:", "π"], [":rho:", "ρ"], [":sigma:", "σ"],
  [":tau:", "τ"], [":upsilon:", "υ"], [":phi:", "φ"], [":chi:", "χ"], [":psi:", "ψ"], [":omega:", "ω"],
  [":Alpha:", "Α"], [":Beta:", "Β"], [":Gamma:", "Γ"], [":Delta:", "Δ"], [":Epsilon:", "Ε"], [":Zeta:", "Ζ"],
  [":Eta:", "Η"], [":Theta:", "Θ"], [":Iota:", "Ι"], [":Kappa:", "Κ"], [":Lambda:", "Λ"], [":Mu:", "Μ"],
  [":Nu:", "Ν"], [":Xi:", "Ξ"], [":Omicron:", "Ο"], [":Pi:", "Π"], [":Rho:", "Ρ"], [":Sigma:", "Σ"],
  [":Tau:", "Τ"], [":Upsilon:", "Υ"], [":Phi:", "Φ"], [":Chi:", "Χ"], [":Psi:", "Ψ"], [":Omega:", "Ω"],
  // Currency
  [":cent:", "¢"], [":pound:", "£"], [":euro:", "€"], [":lira:", "₤"], [":peso:", "₱"], [":ruble:", "₽"],
  [":rupee:", "₹"], [":won:", "₩"], [":yen:", "¥"], [":yuan:", "¥"],
];

/** A key to swap out, from `from` to `to` in the field's text. */
export interface Swap {
  from: number;
  to: number;
  value: string;
  /** `value` is HTML (a `::name::` key). */
  html: boolean;
}

interface Entry {
  key: string;
  value: string;
  html: boolean;
}

const SPACE = /\s/;

/** The key's colons are a cloze's: `{{c1::beta::hint}}` is typed through
 *  `{{c1::beta:`, which ends in `:beta:`, the second colon of the `::`
 *  starting it. A symbol typed right after a cloze's `::` (`{{c1:::beta:`)
 *  still turns over. */
function clozeColons(text: string, from: number, key: string): boolean {
  if (key.startsWith("::")) return /\{\{c\d+$/.test(text.slice(Math.max(0, from - 8), from));
  return key.startsWith(":") && text[from - 1] === ":" && text[from - 2] !== ":";
}

export class Symbols {
  /** Keys that turn over as soon as they're typed, longest first. */
  private atOnce: Entry[] = [];
  /** Keys that wait for a space after them, longest first. */
  private words: Entry[] = [];
  /** The last characters of the keys in `atOnce`. */
  private ends = new Set<string>();

  constructor(pairs: readonly SymbolPair[]) {
    const seen = new Set<string>();
    const sorted = [...pairs].sort((a, b) => b[0].length - a[0].length);
    for (const [key, value] of sorted) {
      if (typeof key !== "string" || typeof value !== "string" || !key || !value || SPACE.test(key) || seen.has(key)) continue;
      seen.add(key);
      const html = key.length > 4 && key.startsWith("::") && key.endsWith("::");
      if (html || (key.length > 2 && key.startsWith(":") && key.endsWith(":")) || AT_ONCE.has(key)) {
        this.atOnce.push({ key, value, html });
        this.ends.add(key[key.length - 1]);
      } else this.words.push({ key, value, html: false });
    }
  }

  /** Whether typing `ch` could finish a key: only then is the field worth
   *  reading. */
  mayFinish(ch: string): boolean {
    return this.ends.has(ch) || (this.words.length > 0 && SPACE.test(ch));
  }

  /** Something was just typed, ending at `caret`: the key it finishes, if
   *  any. A space finishes a word key before it. */
  typed(text: string, caret: number): Swap | null {
    if (caret <= 0) return null;
    if (SPACE.test(text[caret - 1])) return this.wordBefore(text, caret - 1);
    for (const e of this.atOnce) {
      const from = caret - e.key.length;
      if (from < 0 || text.slice(from, caret) !== e.key || clozeColons(text, from, e.key)) continue;
      return { from, to: caret, value: e.value, html: e.html };
    }
    return null;
  }

  /** A new line is about to start at `at`: the word key it finishes. */
  beforeBreak(text: string, at: number): Swap | null {
    return this.wordBefore(text, at);
  }

  private wordBefore(text: string, end: number): Swap | null {
    for (const e of this.words) {
      const from = end - e.key.length;
      if (from < 0 || text.slice(from, end) !== e.key) continue;
      if (from > 0 && !SPACE.test(text[from - 1])) continue;
      return { from, to: end, value: e.value, html: false };
    }
    return null;
  }
}
