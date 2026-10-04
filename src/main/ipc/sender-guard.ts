/**
 * IPC sender validation (#2553).
 *
 * Only the main window's top frame, showing the renderer's own `index.html`,
 * may call into main. A page the window was navigated to, or any subframe,
 * is refused before a handler runs — so a navigation-guard regression
 * (#2552) no longer hands an attacker page the full `window.api`. The two
 * checks are independent layers; either alone closes H1 from the 2026-10
 * security review.
 *
 * Kept apart from `typed-ipc.ts` so the registrar tests, which drive raw
 * handlers with hand-built events, can trust every sender in one place
 * (`tests/setup/trust-ipc-senders.ts`) while `typed-ipc.test.ts` exercises
 * the real check.
 */

import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { devServerOrigin, rendererEntryUrl } from '../renderer-entry';
import { isRendererEntry } from '../security-helpers';

type SenderEvent = Pick<IpcMainInvokeEvent | IpcMainEvent, 'sender' | 'senderFrame'>;

/** True when `event` came from the main frame of a page that is the renderer entry. */
export function isTrustedIpcSender(event: SenderEvent): boolean {
  const frame = event.senderFrame;
  // `senderFrame` is null once the frame has navigated away or been destroyed.
  if (!frame) return false;
  if (frame !== event.sender.mainFrame) return false;
  return isRendererEntry(frame.url, rendererEntryUrl(), devServerOrigin());
}

/** Throw unless `event` is a trusted sender; `channel` names the refusal. */
export function assertTrustedIpcSender(channel: string, event: SenderEvent): void {
  if (!isTrustedIpcSender(event)) {
    throw new Error(`IPC ${channel} refused: the sender is not the Minerva renderer`);
  }
}
