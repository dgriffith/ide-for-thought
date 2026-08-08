/**
 * Shell-handler path-traversal guard (#1328).
 *
 * `SHELL_REVEAL_FILE`, `SHELL_OPEN_IN_DEFAULT`, and `SHELL_OPEN_IN_TERMINAL`
 * take a renderer-supplied `relativePath` and hand it to `shell.*` / `spawn`.
 * They must route it through `assertSafePath` first so a `../` escape can't
 * reveal, open, or spawn a terminal at a location outside the project root.
 *
 * This drives the real `registerShell()` with the real `assertSafePath`
 * (electron + `spawn` + the project-scoping helper are the only mocks), then
 * invokes each captured handler with a safe path (must act on the in-root
 * resolution) and a traversal path (must throw + perform no shell action).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// A deliberately non-existent root: `assertSafePath`'s realpath step falls back
// to the input when the prefix doesn't exist, so the resolution stays
// deterministic without touching the filesystem.
const ROOT = '/minerva-shell-guard-root-8f3a';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, shellCalls, spawnCalls, emojiPanelCalls } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  shellCalls: { reveal: [] as string[], openPath: [] as string[] },
  spawnCalls: [] as unknown[][],
  emojiPanelCalls: { n: 0 },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  app: { showEmojiPanel: () => { emojiPanelCalls.n += 1; } },
  shell: {
    showItemInFolder: (p: string) => { shellCalls.reveal.push(p); },
    openPath: (p: string) => { shellCalls.openPath.push(p); return Promise.resolve(''); },
    openExternal: () => Promise.resolve(),
  },
  dialog: { showSaveDialog: () => Promise.resolve({ canceled: true }) },
}));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawnCalls.push(args);
    return { unref() {}, once() {} };
  },
}));

// Inject a fixed project root and bypass the BrowserWindow lookup — the guard
// under test is `assertSafePath(root, rel)`, not the project-scoping wrapper.
vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => ({}),
  withRootPathOr:
    <A extends unknown[], R>(_fallback: R, fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => fn(ROOT, ...args),
}));

import { registerShell } from '../../../src/main/ipc/register-shell';
import { Channels } from '../../../src/shared/channels';

registerShell();

beforeEach(() => {
  shellCalls.reveal = [];
  shellCalls.openPath = [];
  spawnCalls.length = 0;
  emojiPanelCalls.n = 0;
});

/** Run `fn` with `process.platform` forced — it's a plain value property, so
 *  `vi.spyOn(…, 'get')` can't stub it. */
function withPlatform(value: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value });
  try { fn(); } finally { Object.defineProperty(process, 'platform', original); }
}

const TRAVERSAL = '../../../../etc/passwd';

describe('shell handlers — path-traversal guard (#1328)', () => {
  it('SHELL_REVEAL_FILE reveals an in-root file and rejects traversal', () => {
    const h = handlers.get(Channels.SHELL_REVEAL_FILE)!;
    h({}, 'notes/a.md');
    expect(shellCalls.reveal).toEqual([path.resolve(ROOT, 'notes/a.md')]);

    expect(() => h({}, TRAVERSAL)).toThrow(/traversal/i);
    expect(shellCalls.reveal).toHaveLength(1); // no second (escaping) reveal
  });

  it('SHELL_OPEN_IN_DEFAULT opens an in-root file and rejects traversal', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_DEFAULT)!;
    h({}, 'sub/dir/file.pdf');
    expect(shellCalls.openPath).toEqual([path.resolve(ROOT, 'sub/dir/file.pdf')]);

    expect(() => h({}, TRAVERSAL)).toThrow(/traversal/i);
    expect(shellCalls.openPath).toHaveLength(1); // the escaping open never fired
  });

  it('SHELL_OPEN_IN_TERMINAL spawns for an in-root path and rejects traversal', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    h({}, 'notes/a.md');
    expect(spawnCalls).toHaveLength(1); // a terminal was spawned

    expect(() => h({}, TRAVERSAL)).toThrow(/traversal/i);
    expect(spawnCalls).toHaveLength(1); // no terminal spawned outside the root
  });

  it('reveal with no relativePath falls back to the root itself (no traversal)', () => {
    const h = handlers.get(Channels.SHELL_REVEAL_FILE)!;
    h({});
    expect(shellCalls.reveal).toEqual([ROOT]);
  });
});

describe('SHELL_SHOW_EMOJI_PANEL', () => {
  it('raises the native panel on macOS', () => {
    const h = handlers.get(Channels.SHELL_SHOW_EMOJI_PANEL)!;
    withPlatform('darwin', () => { h({}); });
    expect(emojiPanelCalls.n).toBe(1);
  });

  it('is a silent no-op off macOS — no throw, so a stray call cannot reject', () => {
    // Electron only defines showEmojiPanel on darwin, and there's no
    // cross-platform equivalent; the renderer hides the button elsewhere.
    const h = handlers.get(Channels.SHELL_SHOW_EMOJI_PANEL)!;
    for (const p of ['win32', 'linux']) {
      withPlatform(p, () => { expect(() => h({})).not.toThrow(); });
    }
    expect(emojiPanelCalls.n).toBe(0);
  });
});
