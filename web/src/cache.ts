// What the page keeps between views: per card, its facets (the numbers the
// filters and sorting use) and its row in the table. Both depend only on
// the card and on what it's read against (the view's topics: its
// "reading"), not on which view asked, so the bar's views share them. On a
// big deck, All's facets take Python most of a second; with these kept, going
// back to All, or to any view of cards already seen, asks for nothing.
//
// Everything goes when the cards change (an edit, an answer, a suspend),
// when Stepwise's plan changes or when the thresholds do (see clear).

import type { Facets, Row } from "./types.ts";

/** A card's facets: state, yield, banks, verdict, later (see Facets). */
type Facet = [number, number, number, number, number];

/** Readings kept: the bar's views share one; Stepwise's topics and a
 *  review's cards have their own. */
const MAX_READINGS = 4;
/** Rows kept per reading (a row can carry a card's whole tags pane). */
const MAX_ROWS = 6000;

class Reading {
  facets = new Map<number, Facet>();
  /** By rowKey: a card can have two rows, with and without its answer. */
  rows = new Map<number, Row>();
}

/** A card still to come in a review keeps its answer back in the list, and
 *  the same card in All doesn't: two rows, kept apart. */
const rowKey = (cid: number, hidden: boolean): number => cid * 2 + (hidden ? 1 : 0);

export class Cache {
  /** Bumped by clear(): answers to anything asked before are dropped. */
  gen = 0;
  private readings = new Map<string, Reading>();

  /** Forget everything: the cards, or what they're read against, changed. */
  clear(): void {
    this.readings.clear();
    this.gen++;
  }

  private reading(key: string, make: true): Reading;
  private reading(key: string, make?: false): Reading | undefined;
  private reading(key: string, make = false): Reading | undefined {
    let r = this.readings.get(key);
    if (r) {
      // Most recently used last, so the oldest goes first.
      this.readings.delete(key);
      this.readings.set(key, r);
    } else if (make) {
      r = new Reading();
      this.readings.set(key, r);
      if (this.readings.size > MAX_READINGS) this.readings.delete(this.readings.keys().next().value!);
    }
    return r;
  }

  // --- facets ------------------------------------------------------------------

  /** Facets for `ids`, in their order, if every one is kept. */
  facets(key: string, ids: number[]): Facets | null {
    const kept = this.reading(key)?.facets;
    if (!kept && ids.length) return null;
    const n = ids.length;
    const out: Facets = { state: new Array(n), yield: new Array(n), banks: new Array(n), verdict: new Array(n), later: new Array(n) };
    for (let i = 0; i < n; i++) {
      const f = kept!.get(ids[i]);
      if (!f) return null;
      out.state[i] = f[0];
      out.yield[i] = f[1];
      out.banks[i] = f[2];
      out.verdict[i] = f[3];
      out.later[i] = f[4];
    }
    return out;
  }

  /** The cards among `ids` whose facets aren't kept. */
  missingFacets(key: string, ids: number[]): number[] {
    const kept = this.reading(key)?.facets;
    return kept ? ids.filter((c) => !kept.has(c)) : ids.slice();
  }

  /** Facets as Python sends them: for `ids`, in their order. */
  putFacets(key: string, ids: number[], f: Facets): void {
    const kept = this.reading(key, true).facets;
    ids.forEach((c, i) => kept.set(c, [f.state[i], f.yield[i], f.banks[i], f.verdict[i], f.later[i]]));
  }

  // --- rows ----------------------------------------------------------------------

  /** A card's row, with its answer kept back or not, if it's kept. */
  row(key: string, cid: number, hidden: boolean): Row | undefined {
    return this.readings.get(key)?.rows.get(rowKey(cid, hidden));
  }

  putRow(key: string, cid: number, row: Row): void {
    const rows = this.reading(key, true).rows;
    const k = rowKey(cid, !!row.h);
    rows.delete(k);
    rows.set(k, row);
    if (rows.size > MAX_ROWS) rows.delete(rows.keys().next().value!);
  }
}
