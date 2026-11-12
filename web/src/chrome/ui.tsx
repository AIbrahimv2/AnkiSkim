// Shared controls, copied from Stepwise's web/src/components/ui.tsx
// (Switch, IconButton, Menu, Modal), so the two add-ons' dialogs and menus
// look and behave the same.

import { Check } from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export function Switch(props: { checked: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <label className="switch-row" onClick={() => props.onChange(!props.checked)}>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        className={`switch${props.checked ? " on" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          props.onChange(!props.checked);
        }}
      />
      {props.label}
    </label>
  );
}

export function IconButton(props: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  size?: "sm";
  tone?: "good" | "bad";
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={["icon-btn", props.size, props.tone].filter(Boolean).join(" ")}
      title={props.label}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

// --- menus -------------------------------------------------------------------

export type MenuEntry =
  | {
      label: string;
      icon?: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      checked?: boolean;
      danger?: boolean;
      hint?: string;
    }
  | { separator: true }
  | { section: string; tone?: number };

export interface Anchor {
  x: number;
  y: number;
  /** Align the menu's right edge to x (for buttons on the right). */
  alignRight?: boolean;
}

/** A floating menu at `anchor`, kept inside the window. Closes on outside
 *  click, Escape, blur or resize. */
export function Menu(props: {
  anchor: Anchor;
  entries: MenuEntry[];
  onClose: () => void;
  header?: ReactNode;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: props.anchor.x, top: props.anchor.y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = props.anchor.alignRight ? props.anchor.x - width : props.anchor.x;
    let top = props.anchor.y;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8);
    setPos({ left, top });
  }, [props.anchor]);

  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === "mousedown" && ref.current?.contains(e.target as Node)) return;
      props.onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("mousedown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", key);
    };
  }, [props.onClose]);

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      style={{ left: pos.left, top: pos.top, minWidth: props.minWidth }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.header}
      {props.entries.map((entry, i) => {
        if ("separator" in entry) return <div key={i} className="menu-sep" />;
        if ("section" in entry)
          return (
            <div
              key={i}
              className={`menu-section${entry.tone !== undefined ? ` toned step-${entry.tone % 4}` : ""}`}
            >
              {entry.section}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`menu-item${entry.danger ? " danger" : ""}`}
            disabled={entry.disabled}
            onClick={() => {
              props.onClose();
              entry.onSelect();
            }}
          >
            <span className="mi-icon">{entry.icon}</span>
            <span className="mi-label">{entry.label}</span>
            {entry.hint && <span className="mi-hint">{entry.hint}</span>}
            {entry.checked !== undefined && (
              <span className="mi-check">{entry.checked ? <Check size={14} strokeWidth={2.5} /> : null}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function anchorBelow(el: HTMLElement, alignRight = false): Anchor {
  const r = el.getBoundingClientRect();
  return { x: alignRight ? r.right : r.left, y: r.bottom + 6, alignRight };
}

// --- modal -------------------------------------------------------------------

export function Modal(props: { onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [props.onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        // Never wider than the window, with a margin all round.
        style={props.width ? { width: `min(${props.width}px, calc(100vw - 32px))` } : undefined}
      >
        {props.children}
      </div>
    </div>
  );
}
