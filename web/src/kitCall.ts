// Skim's link to the shared add-on kit (kit/, copied from anki-addon-kit):
// its commands go through Skim's own bridge.

import { call } from "./bridge.ts";
import type { KitCall } from "./kit/types.ts";

export const kitCall: KitCall = <T,>(op: string, args: Record<string, unknown> = {}) =>
  call<Record<string, unknown>>("kit", { op, ...args }) as unknown as Promise<T>;
