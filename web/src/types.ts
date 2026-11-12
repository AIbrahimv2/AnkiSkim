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
}

export interface PageConfig {
  startSide: Side;
  autoplay: boolean;
}

export interface Layout {
  listWidth?: number;
}

/** A list row: the note's sort field as text, the card type, Anki's queue
 *  number (-1 suspended, -2/-3 buried, 0 new, 1/3 learning, 2 review), and
 *  its flag (0 for none). */
export type Row = [text: string, kind: string, queue: number, flag: number];

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
}

export type PushEvent =
  | { type: "view"; view: View }
  | { type: "changed" }
  | { type: "shown"; back: string | null }
  | { type: "hidden" }
  | { type: "settings" };
