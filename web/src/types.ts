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
  /** The collection schedules with FSRS (the table offers Retrievability,
   *  Difficulty and Stability; without it, Ease). */
  fsrs?: boolean;
  /** e in a review: this card opens in the editor, and q goes back to the
   *  review. */
  edit?: number;
}

export type Lens = [key: string, label: string, count: number | null];

export interface PageConfig {
  startSide: Side;
  autoplay: boolean;
  waitBelow: number;
  systemDone: number;
  /** The height in pixels a pasted picture is given; 0 for its own size. */
  pasteHeight: number;
}

export interface Layout {
  /** The table's share of the window's width (0.2 to 0.9). */
  share?: number;
  /** The card's share of the height beside the table, over its tags (0.15 to 0.9). */
  split?: number;
  /** Whether the tags pane is open (false: folded to its title). */
  tags?: boolean;
  /** The table's columns you've turned on or off, by key (list.ts's
   *  COLUMNS); the rest are as they are by default. */
  cols?: Record<string, boolean>;
  /** The order you've dragged the columns into: every column's key. */
  order?: string[];
}

export type Verdict = "now" | "call" | "wait";
/** Stepwise's status for a topic. */
export type Status = "queued" | "completed" | "later" | null;

/** One of a card's places in a resource, for the tags pane. */
export interface PanePlace {
  /** The resource that has it (B&B, FirstAid, ...). */
  resource: string;
  /** The end of its path, and all of it. */
  path: string;
  full: string;
  tag: string;
  status: Status;
  /** Tagged as ::Extra (mentioned in passing). */
  extra: boolean;
}
/** What a system is to you: the topic's, Stepwise's status for it, or
 *  neither (not started, a discipline, or no Stepwise). */
export type SystemState = "here" | "completed" | "queued" | "later" | null;
export interface PaneSystem {
  name: string;
  state: SystemState;
  /** How many resources put the card in it, as the verdict counts them. */
  weight: number;
  places: PanePlace[];
}
export interface PaneOther {
  label: string;
  /** [readable path, the tag] */
  tags: [string, string][];
}

/** One of the exams a card is tagged for (see tags.Analyzer.steps). */
export interface PaneStep {
  /** 1, 2 or 3. */
  step: number;
  /** Its share of the card, in percent: of its resources and questions. */
  share: number;
  /** The step of the topic you're on. */
  here: boolean;
  /** The resources that have the card in it, yours first. */
  resources: string[];
  /** Its question banks' questions on the card: [bank, count]. */
  banks: [string, number][];
}

export interface Pane {
  verdict: Verdict | null;
  /** The verdict's reason in words, for its tooltip. */
  reason: string | null;
  yield: string | null;
  banks: [string, number][];
  /** Which exam it's for: the steps it's tagged for, with their shares. */
  steps?: PaneStep[];
  /** The card's places by system, the topic's first. */
  systems: PaneSystem[];
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
  /** Its scheduling (cards.schedule in Python), left out when blank: when
   *  it's due in days from today (a fraction for a card learning within
   *  the day; below 0 when late), its interval in days, ease (%), reviews,
   *  lapses; with FSRS, retrievability (0 to 1), the desired retention,
   *  difficulty (%) and stability (days). */
  du?: number;
  iv?: number;
  e?: number;
  rv?: number;
  lp?: number;
  rt?: number;
  dr?: number;
  df?: number;
  sb?: number;
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

/** What the table can also sort by: its scheduling columns. Python sends
 *  one with the facets only when asked (see App.loadFacets), null for a
 *  card with none (a new card has no due). */
export type ExtraKey = "due" | "ivl" | "ease" | "ret" | "dif" | "stab" | "reps" | "lapses";
export type Extra = (number | null)[];

/** Both sides of a card, ready for the reviewer page, and its body class. */
export interface CardHtml {
  q: string;
  a: string;
  cls: string;
}

export interface Settings {
  /** Skim's shortcut, while it hasn't b. */
  shortcut: string;
  /** b opens Skim and e in a review edits in it; Anki's browser and editor
   *  move to Cmd/Ctrl+Shift+B and E. */
  bAndE: boolean;
  defaultSearch: string;
  startSide: Side;
  autoplay: boolean;
  waitBelow: number;
  systemDone: number;
  /** How big the window draws, in percent (Cmd+= / Cmd+-). */
  size: number;
  /** The height in pixels a pasted picture is given; 0 for its own size. */
  pasteHeight: number;
}

export type PushEvent =
  | { type: "view"; view: View }
  | { type: "changed" }
  /** Only these cards' rows changed (suspended or unsuspended here), not
   *  what they show. */
  | { type: "rows"; ids: number[] }
  | { type: "retag" }
  | { type: "reveal"; cid: number }
  | { type: "lenses"; seq: number; lenses: Lens[] }
  | { type: "shown"; back: string | null }
  | { type: "hidden" }
  /** Settings were saved, in the kit's window. */
  | { type: "config"; config: PageConfig };
