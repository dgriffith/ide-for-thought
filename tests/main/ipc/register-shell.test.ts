/**
 * Shell-handler coverage (#1328 path-traversal guard, #2055 the rest).
 *
 * `SHELL_REVEAL_FILE`, `SHELL_OPEN_IN_DEFAULT`, and `SHELL_OPEN_IN_TERMINAL`
 * take a renderer-supplied `relativePath` and hand it to `shell.*` / `spawn`.
 * They must route it through `assertSafePath` first so a `../` escape can't
 * reveal, open, or spawn a terminal at a location outside the project root.
 *
 * This drives the real `registerShell()` with the real `assertSafePath`
 * (electron + `spawn` + `node:fs/promises` + the project-scoping helper are
 * the only mocks), then invokes each captured handler with a safe path (must
 * act on the in-root resolution) and a traversal path (must throw + perform
 * no shell action).
 *
 * `SHELL_OPEN_EXTERNAL`'s protocol allowlist, `SHELL_OPEN_IN_TERMINAL`'s
 * per-platform spawn branches, and `EXPORT_CSV`'s save-dialog + write path
 * had no coverage at all before #2055 — the security property named in the
 * handler's own comment ("don't let anyone coerce us into opening file://,
 * javascript:, etc") was asserted nowhere.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// A deliberately non-existent root: `assertSafePath`'s realpath step falls back
// to the input when the prefix doesn't exist, so the resolution stays
// deterministic without touching the filesystem.
const ROOT = '/minerva-shell-guard-root-8f3a';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const {
  handlers, shellCalls, spawnCalls, emojiPanelCalls, saveDialog, writeFileCalls,
} = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  shellCalls: { reveal: [] as string[], openPath: [] as string[], openExternal: [] as string[] },
  spawnCalls: [] as { args: unknown[]; errorCallbacks: (() => void)[] }[],
  emojiPanelCalls: { n: 0 },
  // Mutable per-test return value for dialog.showSaveDialog.
  saveDialog: { result: { canceled: true, filePath: undefined as string | undefined } },
  writeFileCalls: [] as { path: string; content: string }[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  app: { showEmojiPanel: () => { emojiPanelCalls.n += 1; } },
  shell: {
    showItemInFolder: (p: string) => { shellCalls.reveal.push(p); },
    openPath: (p: string) => { shellCalls.openPath.push(p); return Promise.resolve(''); },
    openExternal: (u: string) => { shellCalls.openExternal.push(u); return Promise.resolve(); },
  },
  dialog: { showSaveDialog: () => Promise.resolve(saveDialog.result) },
}));

vi.mock('node:child_process', () => ({
  // `once('error', cb)` is how SHELL_OPEN_IN_TERMINAL's Linux branch detects a
  // missing `x-terminal-emulator` binary and falls back to `xterm`. Track the
  // registered callback per spawn call so a test can trigger it explicitly —
  // a no-op `once` (the pre-#2055 mock) can never exercise that fallback.
  spawn: (...args: unknown[]) => {
    const entry = { args, errorCallbacks: [] as (() => void)[] };
    spawnCalls.push(entry);
    return {
      unref() {},
      once: (event: string, cb: () => void) => { if (event === 'error') entry.errorCallbacks.push(cb); },
    };
  },
}));

vi.mock('node:fs/promises', () => ({
  writeFile: (p: string, content: string) => {
    writeFileCalls.push({ path: p, content });
    return Promise.resolve();
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
  shellCalls.openExternal = [];
  spawnCalls.length = 0;
  emojiPanelCalls.n = 0;
  saveDialog.result = { canceled: true, filePath: undefined };
  writeFileCalls.length = 0;
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

describe('SHELL_OPEN_IN_TERMINAL — per-platform spawn branches (#2055)', () => {
  it('macOS: spawns Terminal.app via `open -a Terminal`', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    withPlatform('darwin', () => { h({}, 'notes/a.md'); });
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]!.args[0]).toBe('open');
    expect(spawnCalls[0]!.args[1]).toEqual(['-a', 'Terminal', path.dirname(path.resolve(ROOT, 'notes/a.md'))]);
  });

  it('Windows: spawns cmd.exe via explicit args, no shell', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    withPlatform('win32', () => { h({}, 'notes/a.md'); });
    expect(spawnCalls).toHaveLength(1);
    const [cmd, args] = spawnCalls[0]!.args as [string, string[]];
    expect(cmd).toBe('cmd.exe');
    // '' is start's documented quirk for paths-with-spaces; /D sets the cwd.
    expect(args).toEqual(['/c', 'start', '', '/D', path.dirname(path.resolve(ROOT, 'notes/a.md')), 'cmd.exe', '/K']);
  });

  it('Linux: spawns x-terminal-emulator with the directory via explicit args', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    withPlatform('linux', () => { h({}, 'notes/a.md'); });
    expect(spawnCalls).toHaveLength(1);
    const [cmd, args] = spawnCalls[0]!.args as [string, string[]];
    expect(cmd).toBe('x-terminal-emulator');
    expect(args).toEqual([`--working-directory=${path.dirname(path.resolve(ROOT, 'notes/a.md'))}`]);
  });

  it('Linux: falls back to xterm when x-terminal-emulator is missing (spawn error)', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    withPlatform('linux', () => { h({}, 'notes/a.md'); });
    expect(spawnCalls).toHaveLength(1);

    // Simulate ENOENT on the primary binary — the handler's registered
    // 'error' listener is what triggers the fallback spawn.
    spawnCalls[0]!.errorCallbacks.forEach((cb) => cb());

    expect(spawnCalls).toHaveLength(2);
    const [cmd, args, opts] = spawnCalls[1]!.args as [string, string[], { cwd?: string }];
    expect(cmd).toBe('xterm');
    expect(args).toEqual(['-e', process.env.SHELL ?? '/bin/sh']);
    expect(opts.cwd).toBe(path.dirname(path.resolve(ROOT, 'notes/a.md')));
  });

  it('Linux xterm fallback defaults to /bin/sh when $SHELL is unset', () => {
    const original = process.env.SHELL;
    delete process.env.SHELL;
    try {
      const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
      withPlatform('linux', () => { h({}, 'notes/a.md'); });
      spawnCalls[0]!.errorCallbacks.forEach((cb) => cb());
      const [, args] = spawnCalls[1]!.args as [string, string[]];
      expect(args).toEqual(['-e', '/bin/sh']);
    } finally {
      if (original === undefined) delete process.env.SHELL; else process.env.SHELL = original;
    }
  });

  it('with no relativePath, opens the project root itself', () => {
    const h = handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!;
    withPlatform('darwin', () => { h({}); });
    expect(spawnCalls[0]!.args[1]).toEqual(['-a', 'Terminal', ROOT]);
  });
});

describe('SHELL_OPEN_EXTERNAL — protocol allowlist (#2055)', () => {
  it('allows https: and hands the parsed URL to shell.openExternal', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await h({}, 'https://example.com/path?q=1');
    expect(shellCalls.openExternal).toEqual(['https://example.com/path?q=1']);
  });

  it('allows http:', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await h({}, 'http://example.com/');
    expect(shellCalls.openExternal).toEqual(['http://example.com/']);
  });

  it('rejects file: — the exact bypass the allowlist exists to stop', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await h({}, 'file:///etc/passwd');
    expect(shellCalls.openExternal).toEqual([]);
  });

  it('rejects javascript:', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await h({}, 'javascript:alert(1)');
    expect(shellCalls.openExternal).toEqual([]);
  });

  it('rejects a malformed URL instead of throwing', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await expect(h({}, 'not a url')).resolves.toBeUndefined();
    expect(shellCalls.openExternal).toEqual([]);
  });

  it('rejects a non-string argument instead of throwing', async () => {
    const h = handlers.get(Channels.SHELL_OPEN_EXTERNAL)!;
    await expect(h({}, 12345)).resolves.toBeUndefined();
    expect(shellCalls.openExternal).toEqual([]);
  });
});

describe('EXPORT_CSV (#2055)', () => {
  it('writes the CSV to the chosen path when the save dialog is confirmed', async () => {
    saveDialog.result = { canceled: false, filePath: '/tmp/query-results.csv' };
    const h = handlers.get(Channels.EXPORT_CSV)!;
    await h({}, 'a,b\n1,2\n');
    expect(writeFileCalls).toEqual([{ path: '/tmp/query-results.csv', content: 'a,b\n1,2\n' }]);
  });

  it('writes nothing when the save dialog is cancelled', async () => {
    saveDialog.result = { canceled: true, filePath: undefined };
    const h = handlers.get(Channels.EXPORT_CSV)!;
    await h({}, 'a,b\n1,2\n');
    expect(writeFileCalls).toEqual([]);
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
