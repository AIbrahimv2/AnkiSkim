import { type Boot, App } from "./app.ts";
import { call, setErrorHandler } from "./bridge.ts";
import { mountChrome } from "./chrome/Chrome.tsx";
import type { PushEvent } from "./types.ts";
import "./styles.css";

// Python can push before the page has booted (Skim opened while loading):
// keep those until the app is there.
let app: App | null = null;
const early: PushEvent[] = [];
window.skim = { push: (e) => (app ? app.push(e) : early.push(e)) };

async function start() {
  const root = document.getElementById("root");
  if (!root) return;
  const boot = await call<Boot>("boot");
  const a = new App(root, boot);
  const chrome = mountChrome(a.chromeHost, {
    slot: a.actionsSlot,
    onConfig: (config) => a.setConfig(config),
    onEdit: () => {
      const cid = a.cardId();
      if (cid) void call("edit", { cid });
    },
  });
  a.attachChrome(chrome);
  setErrorHandler((message) => chrome.toast(message, "error"));
  app = a;
  for (const e of early.splice(0)) a.push(e);
}

// Anki puts our <script> in <head>, before <div id="root"> exists.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void start());
else void start();
