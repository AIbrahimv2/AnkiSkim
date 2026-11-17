// The parts of the page you open: the ⋯ menu, Settings (with What's new and
// About, from the shared add-on kit), the list of keys, and toasts. React, like Stepwise's; nothing here runs while you move
// between cards.

import { CircleCheck, Ellipsis, Info, Keyboard, Settings2, Sparkles, SquarePen, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { call } from "../bridge.ts";
import type { PageConfig, Settings, Side } from "../types.ts";
import { AddonDialog, selfOf, useKitAbout } from "../kit/AddonDialog.tsx";
import { Row, ShortcutField } from "../kit/settings.tsx";
import type { KitTab } from "../kit/types.ts";
import { kitCall } from "../kitCall.ts";
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
  const [settings, setSettings] = useState<KitTab | null>(null);
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
  control.settings = (open) => setSettings(open ? "settings" : null);
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
            { separator: true },
            { label: "Settings…", icon: <Settings2 size={14} />, onSelect: () => setSettings("settings") },
            { separator: true },
            { label: "What's new", icon: <Sparkles size={14} />, dot: unseen, onSelect: () => setSettings("news") },
            { label: "About Skim", icon: <Info size={14} />, onSelect: () => setSettings("about") },
          ]}
        />
      )}
      {settings && (
        <SettingsDialog
          tab={settings}
          onTab={setSettings}
          onClose={() => setSettings(null)}
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
  [["t", "T"], "Next / previous view (All, This review, Due, Studied, ...)"],
  [["H", "L"], "The view to the left / right"],
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

function SettingsDialog(props: {
  tab: KitTab;
  onTab: (tab: KitTab) => void;
  onClose: () => void;
  onSaved: (config: PageConfig) => void;
}) {
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
    <AddonDialog
      call={kitCall}
      tab={props.tab}
      onTab={props.onTab}
      onClose={props.onClose}
      settings={
        v ? (
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
              <Row
                label="Count a system as done at"
                hint="Once this share of a system's topics in your pinned Stepwise resources is done, it shows as done on every card, and cards stop waiting for it. Hover a system to see its share."
                problem={problems.systemDone}
              >
                <span className="pct-field">
                  <input
                    className={`set-input num${problems.systemDone ? " bad" : ""}`}
                    inputMode="numeric"
                    value={String(v.systemDone)}
                    onChange={(e) => set("systemDone", Number(e.target.value.replace(/\D/g, "")) || 0)}
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
      ) : (
          <div className="skeleton" style={{ height: 300, borderRadius: 12 }} />
        )
      }
      settingsFooter={
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={props.onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" disabled={!v || saving} onClick={save}>
          Save
        </button>
      </div>
      }
    />
  );
}
