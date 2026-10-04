/**
 * Global vitest setup: trust every IPC sender (#2553).
 *
 * `typed-ipc.handle()` refuses a call unless its event names the renderer's
 * own main frame. The registrar tests capture the raw `ipcMain.handle`
 * callback and drive it with hand-built events (`{ sender: {} }` and
 * friends) — ~30 files of them, testing what each handler DOES, not who may
 * call it. This mock lets them keep doing that. The guard itself is tested
 * once, for real, in `tests/main/ipc/sender-guard.test.ts` and
 * `typed-ipc.test.ts`, which `vi.unmock` this.
 */
import { vi } from 'vitest';

vi.mock('../../src/main/ipc/sender-guard', () => ({
  isTrustedIpcSender: () => true,
  assertTrustedIpcSender: () => {},
}));
