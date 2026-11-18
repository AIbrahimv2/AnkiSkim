import type { Side } from "./keys.ts";

export type { Side };

/** What the window shows: from a search typed here, or cards another
 *  add-on (Stepwise) handed over. */
export interface View {
  search: string;
  ids: number[];
  title: string | null;
  /** Who opened these cards ("Stepwise"); null once you search here. */
  source: string | null;
  error: string | null;
  /** Bumped by every new view, so an older one never replaces a newer. */
  seq: number;
  /** The window `p` goes back to, by its title. */
  back: string | null;
  /** The tag(s) the cards are read against (Stepwise's topic). */
  topics: string[];
  /** The same as a key: views with the same reading share rows and facets
   *  (see cache.ts). */
  reading: string;
  /** From a review: cards whose answers the list keeps back. */
  hidden?: number[];
  /** The card to start on (the one you were reviewing). */
  select?: number | null;
  /** From a review: the side the reviewer is showing. */
  side?: Side | null;
  /** Which of the bar's views is showing: "all" (a search, or Stepwise's
   *  cards), the review's session, or a Today search. */
  lens?: string;
  /** The bar's views, with their labels and card counts (null until
   *  counted). */
  lenses?: Lens[];
}

export type Lens = [key: string, label: string, count: number | null];

export interface PageConfig {
  startSide: Side;
  autoplay: boolean;
  waitBelow: number;
  systemDone: number;
}

export interface Layout {
  /** The table's share of the window's width (0.2 to 0.9). */
  share?: number;
  /** The card's share of the height beside the table, over its tags (0.15 to 0.9). */
  split?: number;
  /** Whether the tags pane is open (false: folded to its title). */
  tags?: boolean;
}

export type Verdict = "now" | "call" | "wait";
/** Stepwise's status for a topic. */
export type Status = "queued" | "completed" | "later" | null;

/** One of a card's places in a resource, for the tags pane. */
export interface PaneTopic {
  path: string;
  tag: string;
  status: Status;
  /** Under the topic you're on. */
  here: boolean;
  unit: string | null;
  /** In another system: where you'll meet the card again. */
  again: boolean;
  /** Tagged as ::Extra (mentioned in passing). */
  extra: boolean;
}

export interface PaneGroup {
  label: string;
  pinned: boolean;
  here: boolean;
  topics: PaneTopic[];
}

/** A resource the card is in that isn't one of yours, or AnKing's own tags.
 * The label is "" for tags with no path (`leech`), which come last. */
export interface PaneOther {
  label: string;
  /** [readable path, the tag] */
  tags: [string, string][];
}

export interface Pane {
  verdict: Verdict | null;
  reason: string | null;
  yield: string | null;
  banks: [string, number][];
  groups: PaneGroup[];
  /** Tags not worth showing first (other resources, AnKing's own). */
  more: PaneOther[];
}

/** A list row (see cards.rows in Python). */
export interface Row {
  /** The note's text, clozes filled in. */
  t: string;
  /** Card type. */
  k: string;
  /** Anki's queue number: -1 suspended, -2/-3 buried, 0 new, 1/3 learning, 2 review. */
  q: number;
  /** Flag, 0 for none. */
  f: number;
  /** Its deck's full name ("AnKing::Step 1"). */
  d?: string;
  /** Its home deck's full name, for a card in a filtered deck. */
  o?: string;
  /** 1 if the card's answer was kept back (a card still to come). */
  h?: 1;
  y?: string | null;
  b?: string;
  /** Other systems it comes up in, with Stepwise's status there and how
   * much of the system is done (%, null without Stepwise). */
  a?: [string, Status, number | null][];
  v?: Verdict | null;
  r?: string | null;
  p?: Pane;
}

/** Per card, in the view's order, for filtering and sorting the list. */
export interface Facets {
  state: number[];
  yield: number[];
  banks: number[];
  /** 0 none, 1 now, 2 your call, 3 wait. */
  verdict: number[];
  /** Systems it comes up in that you haven't done. */
  later: number[];
  /** Its deck's id (names come with the facets, see Cache.putDecks). */
  deck: number[];
}

/** Both sides of a card, ready for the reviewer page, and its body class. */
export interface CardHtml {
  q: string;
  a: string;
  cls: string;
}

export interface Settings {
  shortcut: string;
  defaultSearch: string;
  startSide: Side;
  autoplay: boolean;
  waitBelow: number;
  systemDone: number;
}

export type PushEvent =
  | { type: "view"; view: View }
  | { type: "changed" }
  | { type: "retag" }
  | { type: "reveal"; cid: number }
  | { type: "lenses"; seq: number; lenses: Lens[] }
  | { type: "shown"; back: string | null }
  | { type: "hidden" }
  /** Settings were saved, in the kit's window. */
  | { type: "config"; config: PageConfig };
