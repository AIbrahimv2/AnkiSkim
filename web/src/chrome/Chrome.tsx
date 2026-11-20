// The parts of the page you open: the ⋯ menu (Settings, What's new and About
// open in the shared add-on kit's window), the list of keys, and toasts.
// React, like Stepwise's; nothing here runs while you move between cards.

import { CircleCheck, Columns3, Ellipsis, Info, Keyboard, LayoutPanelLeft, Settings2, Sparkles, SquarePen, Table2, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { openKitWindow, selfOf, useKitAbout } from "../kit/AddonDialog.tsx";
import { kitCall } from "../kitCall.ts";
import type { ColKey } from "../list.ts";
import { type Anchor, IconButton, Menu, Modal, anchorBelow } from "./ui.tsx";

export interface ChromeApi {
  toast(message: string, tone?: Tone): void;
  toggleHelp(): void;
  /** A dialog or menu is open (and has the keys). */
  isOpen(): boolean;
  /** Columns' menu, at a point (the table's titles, right-clicked). */
  openColumns(at: Anchor): void;
}

export interface ChromeProps {
  slot: HTMLElement;
  /** Edit the card you're on, here. */
  onEdit(): void;
  /** Open it in Anki's browser. */
  onBrowse(): void;
  /** Reset layout: the panes back to their first sizes, the tags open. */
  onResetLayout(): void;
  /** Whether there's a layout to reset (the item is greyed out if not). */
  layoutChanged(): boolean;
  /** The table's columns you can turn on and off, and whether each is. */
  columns(): { key: ColKey; label: string; on: boolean }[];
  onToggleColumn(key: ColKey): void;
  /** Default columns: the ones Skim starts with. */
  onResetColumns(): void;
  columnsChanged(): boolean;
}

type Tone = "ok" | "info" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const control = {
  toast: (_m: string, _t?: Tone) => {},
  help: (_toggle: boolean) => {},
  columns: (_at: Anchor) => {},
};

export function mountChrome(host: HTMLElement, props: ChromeProps): ChromeApi {
  createRoot(host).render(<Chrome {...props} />);
  return {
    toast: (m, t) => control.toast(m, t),
    toggleHelp: () => control.help(true),
    isOpen: () => !!host.querySelector(".overlay, .menu"),
    openColumns: (at) => control.columns(at),
  };
}

function Chrome(props: ChromeProps) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [columns, setColumns] = useState<Anchor | null>(null);
  const [kitAbout] = useKitAbout(kitCall);
  const unseen = !!selfOf(kitAbout)?.unseen;
  const [help, setHelp] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  control.toast = (message, tone = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6500 : 3200);
  };
  control.help = () => setHelp((h) => !h);
  control.columns = (at) => setColumns(at);

  return (
    <>
      {createPortal(
        <button
          ref={button}
          type="button"
          className="icon-btn"
          title="More"
          aria-label="More"
          tabIndex={-1}
          onClick={() => button.current && setMenu(anchorBelow(button.current, true))}
        >
          <Ellipsis size={17} />
          {unseen && <span className="kit-dot" aria-label="What's new" />}
        </button>,
        props.slot,
      )}
      {menu && (
        <Menu
          anchor={menu}
          onClose={() => setMenu(null)}
          minWidth={220}
          entries={[
            { label: "Edit card", icon: <SquarePen size={14} />, hint: "e", onSelect: props.onEdit },
            { label: "Open in Anki's browser", icon: <Table2 size={14} />, hint: "B", onSelect: props.onBrowse },
            { label: "Keys", icon: <Keyboard size={14} />, hint: "?", onSelect: () => setHelp(true) },
            {
              label: "Columns…",
              icon: <Columns3 size={14} />,
              onSelect: () => button.current && setColumns(anchorBelow(button.current, true)),
            },
            {
              label: "Reset layout",
              icon: <LayoutPanelLeft size={14} />,
              disabled: !props.layoutChanged(),
              onSelect: props.onResetLayout,
            },
            { separator: true },
            { label: "Settings…", icon: <Settings2 size={14} />, onSelect: () => openKitWindow(kitCall, "settings") },
            { separator: true },
            { label: "What's new", icon: <Sparkles size={14} />, dot: unseen, onSelect: () => openKitWindow(kitCall, "news") },
            { label: "About Skim", icon: <Info size={14} />, onSelect: () => openKitWindow(kitCall, "about") },
          ]}
        />
      )}
      {columns && (
        <Menu
          anchor={columns}
          onClose={() => setColumns(null)}
          minWidth={200}
          entries={[
            { section: "Columns" },
            ...props.columns().map((c) => ({
              label: c.label,
              checked: c.on,
              // The menu closes on a pick: open again where it was (a new
              // object, so it draws the new ticks), to turn on several.
              onSelect: () => {
                props.onToggleColumn(c.key);
                setColumns({ ...columns });
              },
            })),
            { separator: true },
            { label: "Default columns", disabled: !props.columnsChanged(), onSelect: props.onResetColumns },
          ]}
        />
      )}
      {help && <KeysDialog onClose={() => setHelp(false)} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="t-icon">
              {t.tone === "error" ? <TriangleAlert size={15} /> : t.tone === "ok" ? <CircleCheck size={15} /> : <Info size={15} />}
            </span>
            <span className="t-text">{t.message}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// --- keys ------------------------------------------------------------------------

/** Suspend / unsuspend, as Anki's browser has it. */
const SUSPEND = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Cmd-J" : "Ctrl-J";
/** The size keys' modifier, written as SUSPEND's is. */
const MOD = typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "Cmd-" : "Ctrl-";

const KEYS: [string[], string][] = [
  [["j", "k"], "Next / previous card (arrow keys too)"],
  [["10j", "8k"], "Move that many cards"],
  [["gg", "G"], "First / last card"],
  [["25G"], "Card 25"],
  [["Ctrl-d", "Ctrl-u"], "Half a page down / up (a number first sets how far)"],
  [["Ctrl-f", "Ctrl-b"], "A page down / up"],
  [["h", "l"], "Show the front / the back"],
  [["Space"], "Flip the card"],
  [["J", "K"], "Scroll a long card down / up"],
  [["i"], "Hide or show the tags under the card"],
  [["v"], "Select cards as you move (j, k, 10j, G, ...); v or Esc stops"],
  [["Shift-↓", "Shift-↑"], "Select as you move, as in Anki's browser (Shift-click too)"],
  [[SUSPEND], "Suspend the selected cards, or the one you're on; unsuspend them if they all are"],
  [["f", "F"], "Next / previous filter (All, Suspended, Now, Wait, ...)"],
  [["t", "T"], "Next / previous view (All, This review, Due, Studied, ...)"],
  [["H", "L"], "The view to the left / right"],
  [["/"], "Search (Anki's syntax); Enter runs it, Esc goes back"],
  [["e"], "Edit the card (its keys are below)"],
  [["B"], "Open the card in Anki's browser"],
  [["u", "Ctrl-r"], "Undo / redo what was done last (an edit, a suspend), as Anki's Edit menu does"],
  [["r"], "Play the card's audio"],
  [["p"], "Back to the window that opened Skim (Stepwise)"],
  [["q", "Esc"], "Close Skim (Esc first ends a selection)"],
  [[`${MOD}=`, `${MOD}-`], `Make everything bigger / smaller (${MOD}0: back to 100%)`],
];

/** While editing a card (e). */
const EDIT_KEYS: [string[], string][] = [
  [["i", "a", "I", "A"], "Type: before / after the cursor, at the line's start / end"],
  [["o", "O"], "Type on a new line below / above"],
  [["Esc"], "Stop typing (what you changed is saved)"],
  [["h", "j", "k", "l"], "Left, down, up, right (j and k go on into the next field)"],
  [["w", "b", "e"], "Next word, back a word, end of word (W, B, E: by spaces only)"],
  [["0", "^", "$"], "Start of the line, its first letter, its end"],
  [["f x", "t x"], "To the next x on the line, or just before it (F, T: backwards; ; and , repeat)"],
  [["gg", "G"], "First / last field (2G: field 2)"],
  [["Tab", "Shift-Tab"], "Next / previous field"],
  [["x", "r x", "~"], "Delete a letter, replace it with x, switch its case"],
  [["d", "c", "y"], "Delete, change or copy what a move covers: dw, c$, yiw, dd (the line), 3dd"],
  [["iw", "i(", 'i"', "ic"], "After d, c, y or v: a word, inside brackets or quotes, a cloze's answer (aw, a(, ac: all of it)"],
  [["p", "P"], "Paste after / before the cursor"],
  [["v", "V"], "Select letters / lines as you move, then d, c, y"],
  [["u", "Ctrl-r"], "Undo / redo, in the fields (back at the cards, u undoes the saved edit)"],
  [["."], "Do the last change again"],
  [["gc", "gC"], "Make a cloze of what a move covers or what's selected: gciw, gc$ (gC: the same number again)"],
  [[`${MOD}Shift-C`], "A cloze, as in Anki's editor (with Alt: the same number again)"],
  [["gx"], "Take the cloze under the cursor off, keeping its text"],
  [[`${MOD}B`, `${MOD}I`, `${MOD}U`], "Bold, italic, underline"],
  [["J", "K"], "Next / previous note"],
  [["Space"], "Flip the card beside the fields"],
  [["gb"], "Open the card in Anki's browser"],
  [["q", "ZZ"], "Done: back to the cards"],
];

function KeysDialog(props: { onClose: () => void }) {
  return (
    <Modal onClose={props.onClose} width={520}>
      <div className="dialog-head">
        <h2>Keys</h2>
        <IconButton size="sm" label="Close" onClick={props.onClose}>
          <X size={15} />
        </IconButton>
      </div>
      <div className="keys-table">
        {KEYS.map(([keys, label]) => (
          <div className="keys-row" key={label}>
            <span className="keys-keys">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
            <span className="keys-label">{label}</span>
          </div>
        ))}
      </div>
      <p className="keys-foot">A number before a move repeats it, like in vim. Esc cancels a number you've typed.</p>
      <h3 className="keys-part">Editing a card</h3>
      <div className="keys-table">
        {EDIT_KEYS.map(([keys, label]) => (
          <div className="keys-row" key={label}>
            <span className="keys-keys">
              {keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </span>
            <span className="keys-label">{label}</span>
          </div>
        ))}
      </div>
      <p className="keys-foot">Edits are saved as you go, and Anki's Edit → Undo takes them back.</p>
    </Modal>
  );
}
