// Talks to the add-on's Python side (src/bridge.py). Same as Stepwise's.
//
// Inside Anki, `pycmd` appears once the QWebChannel connects, a moment
// after the page loads, so calls wait for it. tools/devserver.py puts a
// stand-in on the page that posts to it instead.

import type { PushEvent } from "./types.ts";

type Pycmd = (arg: string, cb?: (result: unknown) => void) => boolean;

declare global {
  interface Window {
    pycmd?: Pycmd;
    skim?: { push: (event: PushEvent) => void };
  }
}

const ready: Promise<Pycmd> = new Promise((resolve) => {
  const check = () => (window.pycmd ? resolve(window.pycmd) : setTimeout(check, 15));
  check();
});

export interface Reply {
  error?: string;
}

let onError: (message: string) => void = (m) => console.error(m);

export function setErrorHandler(fn: (message: string) => void): void {
  onError = fn;
}

/** Send a command and resolve with its reply. Errors in a reply are shown
 *  (see setErrorHandler) and reject the promise. */
export async function call<T extends object = Record<string, never>>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T & Reply> {
  const pycmd = await ready;
  return new Promise((resolve, reject) => {
    pycmd(JSON.stringify({ cmd, ...args }), (raw) => {
      const reply = (raw ?? {}) as T & Reply;
      if (reply.error) {
        onError(reply.error);
        reject(new Error(reply.error));
        return;
      }
      resolve(reply);
    });
  });
}
