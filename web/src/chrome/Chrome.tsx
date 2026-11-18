// The parts of the page you open: the ⋯ menu (Settings, What's new and About
// open in the shared add-on kit's window), the list of keys, and toasts.
// React, like Stepwise's; nothing here runs while you move between cards.

import { CircleCheck, Ellipsis, Info, Keyboard, LayoutPanelLeft, Settings2, Sparkles, SquarePen, TriangleAlert, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { openKitWindow, selfOf, useKitAbout } from "../kit/AddonDialog.tsx";
import { kitCall } from "../kitCall.ts";
import { type Anchor, IconButton, Menu, Modal, anchorBelow } from "./ui.tsx";

export interface ChromeApi {
  toast(message: string, tone?: Tone): void;
  toggleHelp(): void;
  /** A dialog or menu is open (and has the keys). */
  isOpen(): boolean;
}

export interface ChromeProps {
  slot: HTMLElement;
  onEdit(): void;
  /** Reset layout: the panes back to their first sizes, the tags open. */
  onResetLayout(): void;
  /** Whether there's a layout to reset (the item is greyed out if not). */
  layoutChanged(): boolean;
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
};

export function mountChrome(host: HTMLElement, props: ChromeProps): ChromeApi {
  createRoot(host).render(<Chrome {...props} />);
  return {
    toast: (m, t) => control.toast(m, t),
    toggleHelp: () => control.help(true),
    isOpen: () => !!host.querySelector(".overlay, .menu"),
  };
}

function Chrome(props: ChromeProps) {
  const [menu, setMenu] = useState<Anchor | null>(null);
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
            { label: "Edit in Anki's browser", icon: <SquarePen size={14} />, hint: "e", onSelect: props.onEdit },
            { label: "Keys", icon: <Keyboard size={14} />, hint: "?", onSelect: () => setHelp(true) },
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
  [["e", "B"], "Open the card in Anki's browser, to edit it"],
  [["r"], "Play the card's audio"],
  [["p"], "Back to the window that opened Skim (Stepwise)"],
  [["q", "Esc"], "Close Skim (Esc first ends a selection)"],
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
    </Modal>
  );
}
