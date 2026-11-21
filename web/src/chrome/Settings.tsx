// Skim's Settings, a tab of the add-on kit's window beside What's new and
// About (settings-main.tsx), rather than a dialog over the Skim window. Its
// calls go to src/settings_page.py; an open Skim window hears of a save
// from Python ("config").

import { useEffect, useMemo, useState } from "react";
import { call } from "../bridge.ts";
import { Row, SettingsFoot, ShortcutField } from "../kit/settings.tsx";
import type { Settings, Side } from "../types.ts";
import { Switch } from "./ui.tsx";

const MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
/** Cmd on a Mac, Ctrl elsewhere, as the size keys are. */
const MOD = MAC ? "⌘" : "Ctrl+";
/** Where Anki's browser and editor go while Skim has b and e (keys.py). */
const [ANKI_BROWSE, ANKI_EDIT] = MAC ? ["⇧⌘B", "⇧⌘E"] : ["Ctrl+Shift+B", "Ctrl+Shift+E"];

const SIDES: { value: Side; label: string }[] = [
  { value: "question", label: "Front" },
  { value: "answer", label: "Back" },
];

export function SettingsPanel(props: { onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ settings: Settings; defaults: Settings } | null>(null);
  const [v, setV] = useState<Settings | null>(null);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    call<{ settings: Settings; defaults: Settings }>("settings").then(
      (r) => {
        setLoaded(r);
        setV(r.settings);
      },
      () => {},
    );
  }, []);

  const dirty = useMemo(() => !!loaded && !!v && JSON.stringify(v) !== JSON.stringify(loaded.settings), [loaded, v]);
  const isDefault = useMemo(
    () => !!loaded && !!v && JSON.stringify(v) === JSON.stringify(loaded.defaults),
    [loaded, v],
  );

  if (!loaded || !v) return <div className="skeleton" style={{ height: 300, marginTop: 28, borderRadius: 12 }} />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setV((s) => (s ? { ...s, [key]: value } : s));
    setProblems(({ [key]: _gone, ...rest }) => rest);
    setSaved(false);
  };

  const save = async () => {
    setSaving(true);
    try {
      const r = await call<{ problems?: Record<string, string>; settings?: Settings }>("save_settings", { settings: v });
      if (r.problems) setProblems(r.problems);
      else {
        // What's saved is the new starting point (Python cleaned it up).
        const now = r.settings ?? v;
        setLoaded({ ...loaded, settings: now });
        setV(now);
        setSaved(true);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
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
          <h3>Editing</h3>
          <div className="set-card">
            <Row
              label="Height of pasted pictures"
              hint="Every picture you paste while editing a card is given this height on the card, whatever size it was copied at, and its width follows. 0 leaves pictures their own size."
              problem={problems.pasteHeight}
            >
              <span className="pct-field">
                <input
                  className={`set-input num${problems.pasteHeight ? " bad" : ""}`}
                  inputMode="numeric"
                  value={String(v.pasteHeight)}
                  onChange={(e) => set("pasteHeight", Number(e.target.value.replace(/\D/g, "")) || 0)}
                  aria-label="Pixels"
                />
                px
              </span>
            </Row>
          </div>
        </section>
        <section className="set-section">
          <h3>Window</h3>
          <div className="set-card">
            <Row
              label="Size"
              hint={`How big everything in the window draws. ${MOD}= and ${MOD}− change it in steps as you browse; ${MOD}0 puts it back to 100%.`}
              problem={problems.size}
            >
              <span className="pct-field">
                <input
                  className={`set-input num${problems.size ? " bad" : ""}`}
                  inputMode="numeric"
                  value={String(v.size)}
                  onChange={(e) => set("size", Number(e.target.value.replace(/\D/g, "")) || 0)}
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
            <Row
              label="b and e open Skim"
              hint={`b opens Skim instead of Anki's browser, and e in a review edits the card in Skim instead of Anki's editor. Anki's browser moves to ${ANKI_BROWSE}, and its editor to ${ANKI_EDIT}.`}
            >
              <Switch checked={v.bAndE} label="" onChange={(x) => set("bAndE", x)} />
            </Row>
            {!v.bAndE && (
              <Row label="Shortcut" hint="Opens Skim from Anki's main window." problem={problems.shortcut}>
                <ShortcutField value={v.shortcut} onChange={(s) => set("shortcut", s)} />
              </Row>
            )}
          </div>
        </section>
      </div>
      <SettingsFoot
        onRestore={() => {
          setV(loaded.defaults);
          setProblems({});
          setSaved(false);
        }}
        restoreDisabled={isDefault}
        saved={saved && !dirty}
        onClose={props.onClose}
        onSave={save}
        saveDisabled={!dirty || saving}
      />
    </>
  );
}
