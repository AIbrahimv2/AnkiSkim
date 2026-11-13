// The parts of the page you open: the ⋯ menu, Settings, the list of keys,
// and toasts. React, like Stepwise's; nothing here runs while you move
// between cards.

import { CircleCheck, Ellipsis, Info, Keyboard, Settings2, SquarePen, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { call } from "../bridge.ts";
import type { PageConfig, Settings, Side } from "../types.ts";
import { type Anchor, IconButton, Menu, Modal, Switch, anchorBelow } from "./ui.tsx";

export interface ChromeApi {
  toast(message: string, tone?: Tone): void;
  openSettings(): void;
  toggleHelp(): void;
  /** A dialog or menu is open (and has the keys). */
  isOpen(): boolean;
}

export interface ChromeProps {
  slot: HTMLElement;
  onConfig(config: PageConfig): void;
  onEdit(): void;
}

type Tone = "ok" | "info" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const control = {
  toast: (_m: string, _t?: Tone) => {},
  settings: (_open: boolean) => {},
  help: (_toggle: boolean) => {},
};

export function mountChrome(host: HTMLElement, props: ChromeProps): ChromeApi {
  createRoot(host).render(<Chrome {...props} />);
  return {
    toast: (m, t) => control.toast(m, t),
    openSettings: () => control.settings(true),
    toggleHelp: () => control.help(true),
    isOpen: () => !!host.querySelector(".overlay, .menu"),
  };
}

function Chrome(props: ChromeProps) {
  const [menu, setMenu] = useState<Anchor | null>(null);
  const [settings, setSettings] = useState(false);
  const [help, setHelp] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const button = useRef<HTMLButtonElement>(null);

  control.toast = (message, tone = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6500 : 3200);
  };
  control.settings = (open) => setSettings(open);
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
            { separator: true },
            { label: "Settings…", icon: <Settings2 size={14} />, onSelect: () => setSettings(true) },
          ]}
        />
      )}
      {settings && (
        <SettingsDialog
          onClose={() => setSettings(false)}
          onSaved={(config) => {
            props.onConfig(config);
            control.toast("Settings saved");
          }}
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
  [["f", "F"], "Next / previous filter (All, Suspended, Now, Wait, ...)"],
  [["t", "T"], "From a review: next / previous view (this review, Due, Studied, Again, ...)"],
  [["/"], "Search (Anki's syntax); Enter runs it, Esc goes back"],
  [["e", "B"], "Open the card in Anki's browser, to edit it"],
  [["r"], "Play the card's audio"],
  [["p"], "Back to the window that opened Skim (Stepwise)"],
  [["q", "Esc"], "Close Skim"],
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

// --- settings --------------------------------------------------------------------

const SIDES: { value: Side; label: string }[] = [
  { value: "question", label: "Front" },
  { value: "answer", label: "Back" },
];

function SettingsDialog(props: { onClose: () => void; onSaved: (config: PageConfig) => void }) {
  const [v, setV] = useState<Settings | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    call<{ settings: Settings }>("settings").then((r) => setV(r.settings), () => {});
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setV((s) => (s ? { ...s, [key]: value } : s));

  const save = async () => {
    if (!v) return;
    setSaving(true);
    try {
      const r = await call<{ problems?: Record<string, string>; config?: PageConfig; saved?: boolean }>("save_settings", { settings: v });
      if (r.problems) setProblems(r.problems);
      else {
        if (r.config && r.saved) props.onSaved(r.config);
        props.onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={props.onClose} width={540}>
      <div className="dialog-head">
        <h2>Settings</h2>
        <IconButton size="sm" label="Close" onClick={props.onClose}>
          <X size={15} />
        </IconButton>
      </div>
      {v && (
        <div className="settings">
          <section className="set-section">
            <h3>Cards</h3>
            <div className="set-card">
              <Row label="Show first" hint="The side each card opens on. h and l switch while you browse.">
                <div className="mini-seg">
                  {SIDES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      className={v.startSide === s.value ? "active" : ""}
                      onClick={() => set("startSide", s.value)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </Row>
              <Row label="Play audio by itself" hint="Plays a card's sound when you stop on it. r plays it any time.">
                <Switch checked={v.autoplay} label="" onChange={(x) => set("autoplay", x)} />
              </Row>
              <Row
                label="Wait when a card is mostly elsewhere"
                hint="On a topic, a suspended card could wait when less than this share of its places is in the topic's system, and a system you haven't done also has it."
                problem={problems.waitBelow}
              >
                <span className="pct-field">
                  <input
                    className={`set-input num${problems.waitBelow ? " bad" : ""}`}
                    inputMode="numeric"
                    value={String(v.waitBelow)}
                    onChange={(e) => set("waitBelow", Number(e.target.value.replace(/\D/g, "")) || 0)}
                    aria-label="Percentage"
                  />
                  %
                </span>
              </Row>
            </div>
          </section>
          <section className="set-section">
            <h3>Opening Skim</h3>
            <div className="set-card">
              <div className="set-row set-block">
                <div className="set-text">
                  <div className="set-label">First search</div>
                  <div className="set-hint">
                    What Skim shows the first time you open it, in Anki's search syntax. After that it opens on your last search.
                  </div>
                  <input
                    className="set-input mono wide"
                    value={v.defaultSearch}
                    placeholder="deck:current"
                    spellCheck={false}
                    onChange={(e) => set("defaultSearch", e.target.value)}
                  />
                </div>
              </div>
              <Row label="Shortcut" hint="Opens Skim from Anki's main window." problem={problems.shortcut}>
                <ShortcutField value={v.shortcut} onChange={(s) => set("shortcut", s)} />
              </Row>
            </div>
          </section>
        </div>
      )}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!v || saving} onClick={save}>
          Save
        </button>
      </div>
    </Modal>
  );
}

function Row(props: { label: string; hint?: string; problem?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <div className="set-label">{props.label}</div>
        {props.hint && <div className="set-hint">{props.hint}</div>}
        {props.problem && <div className="set-problem">{props.problem}</div>}
      </div>
      <div className="set-control">{props.children}</div>
    </div>
  );
}

// --- shortcut (from Stepwise's Settings.tsx) ---------------------------------------

const IS_MAC = /Mac/i.test(navigator.platform);

/** Qt's names for the modifiers, from a key event. On a Mac Qt's "Ctrl"
 *  is ⌘ and "Meta" is ⌃. */
function comboFrom(e: React.KeyboardEvent): string | null {
  let key: string | null = null;
  const c = e.code;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (c === "Space") key = "Space";
  if (!key) return null;
  const mods = [
    (IS_MAC ? e.metaKey : e.ctrlKey) && "Ctrl",
    (IS_MAC ? e.ctrlKey : e.metaKey) && "Meta",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
  ].filter(Boolean);
  // Plain letters would fire while typing; F-keys may stand alone.
  if (!mods.length && !key.startsWith("F")) return null;
  return [...mods, key].join("+");
}

function displayShortcut(s: string): string {
  if (!IS_MAC) return s.replace(/\+/g, " + ");
  const sym: Record<string, string> = { Ctrl: "⌘", Meta: "⌃", Alt: "⌥", Shift: "⇧" };
  const parts = s.split("+");
  const key = parts.pop() ?? "";
  const order = ["Meta", "Alt", "Shift", "Ctrl"]; // ⌃⌥⇧⌘, the Mac order
  return order.filter((m) => parts.includes(m)).map((m) => sym[m]).join("") + key;
}

function ShortcutField(props: { value: string; onChange: (s: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <div className="shortcut-field">
      <button
        type="button"
        className={`keycap-btn${recording ? " recording" : ""}`}
        onClick={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={(e) => {
          if (!recording) return;
          e.preventDefault();
          e.stopPropagation(); // Escape cancels recording, not the dialog
          if (e.key === "Escape") return setRecording(false);
          if (e.key === "Backspace" || e.key === "Delete") {
            props.onChange("");
            return setRecording(false);
          }
          const combo = comboFrom(e);
          if (combo) {
            props.onChange(combo);
            setRecording(false);
          }
        }}
        title="Click, then press the keys"
      >
        {recording ? "Press keys…" : props.value ? displayShortcut(props.value) : "None"}
      </button>
      {props.value && !recording && (
        <IconButton size="sm" label="No shortcut" onClick={() => props.onChange("")}>
          <X size={14} />
        </IconButton>
      )}
    </div>
  );
}
