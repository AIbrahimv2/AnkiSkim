// What the page keeps between views: per card, its facets (the numbers the
// filters and sorting use) and its row in the table. Both depend only on
// the card and on what it's read against (the view's topics: its
// "reading"), not on which view asked, so the bar's views share them. On a
// big deck, All's facets take Python most of a second; with these kept, going
// back to All, or to any view of cards already seen, asks for nothing.
//
// Everything is read again when the cards change (an edit, an answer, an
// undo), when Stepwise's plan changes or when the thresholds do (see
// clear), and just the cards you suspend or unsuspend here (see forget).
// Until their new rows come, the old ones stay at hand (see oldRow), so
// the table keeps showing them instead of blanking every row.

import type { Extra, ExtraKey, Facets, Row } from "./types.ts";

/** A card's facets: state, yield, banks, verdict, later, deck (see Facets). */
type Facet = [number, number, number, number, number, number];
/** Sort values kept per column (see Cache.extra): a big deck's worth. */
const MAX_EXTRA = 200_000;
const EXTRA_KEYS = new Set<string>(["due", "ivl", "ease", "ret", "dif", "stab", "reps", "lapses"] satisfies ExtraKey[]);

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
  /** Bumped by clear() and forget(): answers to anything asked before are
   *  dropped. */
  gen = 0;
  private readings = new Map<string, Reading>();
  /** Rows from before the cards last changed, to show until their new ones
   *  come (only rows: facets are kept by the page, see App.facets). */
  private old = new Map<string, Map<number, Row>>();
  /** Deck names by id, for sorting by deck. */
  private decks = new Map<number, string>();
  /** The scheduling columns' sort values by card, for the ones you've
   *  sorted by (they don't depend on the reading). */
  private extra = new Map<ExtraKey, Map<number, number | null>>();

  /** Forget everything: the cards, or what they're read against, changed.
   *  The rows stay at hand until they're read again (oldRow). */
  clear(): void {
    for (const [key, r] of this.readings) this.keepOld(key, r.rows);
    this.readings.clear();
    this.extra.clear();
    // Deck names stay: the facets kept meanwhile still sort by them, and
    // the new facets bring theirs.
    this.gen++;
  }

  /** Forget these cards' rows and facets (they were suspended or
   *  unsuspended): the rest are kept. Answers on their way are dropped,
   *  as they may be from before. */
  forget(cids: number[]): void {
    for (const [key, r] of this.readings) {
      const gone = new Map<number, Row>();
      for (const c of cids) {
        r.facets.delete(c);
        for (const k of [rowKey(c, false), rowKey(c, true)]) {
          const row = r.rows.get(k);
          if (row) gone.set(k, row);
          r.rows.delete(k);
        }
      }
      if (gone.size) this.keepOld(key, gone);
    }
    for (const values of this.extra.values()) for (const c of cids) values.delete(c);
    this.gen++;
  }

  /** Keep these rows at hand until they're read again, with any kept
   *  before that haven't been yet (the cards can change twice before their
   *  rows come back). As many readings and rows as `readings` keeps. */
  private keepOld(key: string, rows: Map<number, Row>): void {
    const old = this.old.get(key) ?? new Map<number, Row>();
    this.old.delete(key);
    this.old.set(key, old); // most recently used last, as in reading()
    for (const [k, row] of rows) {
      old.delete(k);
      old.set(k, row);
    }
    while (old.size > MAX_ROWS) old.delete(old.keys().next().value!);
    while (this.old.size > MAX_READINGS) this.old.delete(this.old.keys().next().value!);
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
    const out: Facets = {
      state: new Array(n), yield: new Array(n), banks: new Array(n), verdict: new Array(n), later: new Array(n),
      deck: new Array(n),
    };
    for (let i = 0; i < n; i++) {
      const f = kept!.get(ids[i]);
      if (!f) return null;
      out.state[i] = f[0];
      out.yield[i] = f[1];
      out.banks[i] = f[2];
      out.verdict[i] = f[3];
      out.later[i] = f[4];
      out.deck[i] = f[5];
    }
    return out;
  }

  /** The cards among `ids` whose facets aren't kept, or (with `extra`)
   *  whose sort values for that column aren't. */
  missingFacets(key: string, ids: number[], extra: ExtraKey | null = null): number[] {
    const kept = this.reading(key)?.facets;
    const values = extra ? this.extra.get(extra) : undefined;
    if (!kept || (extra && !values)) return ids.slice();
    return ids.filter((c) => !kept.has(c) || (values !== undefined && !values.has(c)));
  }

  /** Facets as Python sends them: for `ids`, in their order, with any
   *  sort values asked for. */
  putFacets(key: string, ids: number[], f: Facets & Partial<Record<ExtraKey, Extra>>): void {
    const kept = this.reading(key, true).facets;
    ids.forEach((c, i) => kept.set(c, [f.state[i], f.yield[i], f.banks[i], f.verdict[i], f.later[i], f.deck[i]]));
    for (const [k, list] of Object.entries(f) as [string, unknown][]) {
      if (!EXTRA_KEYS.has(k) || !Array.isArray(list)) continue;
      let values = this.extra.get(k as ExtraKey);
      if (!values || values.size > MAX_EXTRA) this.extra.set(k as ExtraKey, (values = new Map()));
      ids.forEach((c, i) => values.set(c, list[i] ?? null));
    }
  }

  /** A column's sort values for `ids`, in their order, if every one is kept. */
  sortValues(extra: ExtraKey, ids: number[]): Extra | null {
    const values = this.extra.get(extra);
    if (!values) return ids.length ? null : [];
    const out: Extra = new Array(ids.length);
    for (let i = 0; i < ids.length; i++) {
      const v = values.get(ids[i]);
      if (v === undefined) return null;
      out[i] = v;
    }
    return out;
  }

  /** Deck names as Python sends them with facets: by id. */
  putDecks(names: Record<string, string> | undefined): void {
    for (const [id, name] of Object.entries(names ?? {})) this.decks.set(Number(id), name);
  }

  /** Each of these decks' place in Anki's deck list (by name, a deck's
   *  subdecks straight after it), for sorting by deck. */
  deckRanks(ids: number[]): Map<number, number> {
    const key = (id: number) => (this.decks.get(id) ?? "").toLowerCase().replaceAll("::", "\u0001");
    const order = [...new Set(ids)].map((id) => [key(id), id] as const);
    order.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
    return new Map(order.map(([, id], i) => [id, i]));
  }

  // --- rows ----------------------------------------------------------------------

  /** A card's row, with its answer kept back or not, if it's kept. */
  row(key: string, cid: number, hidden: boolean): Row | undefined {
    return this.readings.get(key)?.rows.get(rowKey(cid, hidden));
  }

  /** The row a card had before the cards last changed, for while its new
   *  one is on its way. */
  oldRow(key: string, cid: number, hidden: boolean): Row | undefined {
    return this.old.get(key)?.get(rowKey(cid, hidden));
  }

  putRow(key: string, cid: number, row: Row): void {
    const rows = this.reading(key, true).rows;
    const k = rowKey(cid, !!row.h);
    rows.delete(k);
    rows.set(k, row);
    if (rows.size > MAX_ROWS) rows.delete(rows.keys().next().value!);
    this.old.get(key)?.delete(k);
  }
}
