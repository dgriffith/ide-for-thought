/**
 * "Open in Terminal" opens the folder you chose — not its parent — and a
 * note's containing folder. It used to take the dirname of every path, so a
 * folder opened one level up. A real temp root, because whether a path is a
 * folder is a question for the filesystem (`register-shell.test.ts` uses a
 * root that deliberately doesn't exist).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const h = vi.hoisted(() => ({
  root: '',
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  spawned: [] as string[][],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => { h.handlers.set(ch, fn); } },
  app: {}, shell: {}, dialog: {},
}));
vi.mock('node:child_process', () => ({
  spawn: (_cmd: string, args: string[]) => { h.spawned.push(args); return { unref() {}, once() {} }; },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => ({}),
  withRootPathOr: <A extends unknown[], R>(_f: R, fn: (rootPath: string, ...a: A) => R) => (_e: unknown, ...args: A) => fn(h.root, ...args),
}));

import { registerShell } from '../../../src/main/ipc/register-shell';
import { Channels } from '../../../src/shared/channels';

registerShell();

/** The directory macOS's `open -a Terminal <dir>` was given. */
function openedDir(rel?: string): string {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', { ...original, value: 'darwin' });
  try { void h.handlers.get(Channels.SHELL_OPEN_IN_TERMINAL)!({}, rel); } finally { Object.defineProperty(process, 'platform', original); }
  return h.spawned.at(-1)!.at(-1)!;
}

beforeEach(() => {
  h.root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-terminal-')));
  fs.mkdirSync(path.join(h.root, 'trip/prague'), { recursive: true });
  fs.writeFileSync(path.join(h.root, 'trip/prague/Kampa.md'), '# Kampa');
  h.spawned.length = 0;
});
afterEach(() => { fs.rmSync(h.root, { recursive: true, force: true }); });

describe('Open in Terminal', () => {
  it('a folder opens in itself, not its parent', () => {
    expect(openedDir('trip/prague')).toBe(path.join(h.root, 'trip/prague'));
  });

  it('a note opens in its containing folder', () => {
    expect(openedDir('trip/prague/Kampa.md')).toBe(path.join(h.root, 'trip/prague'));
  });

  it('the thoughtbase root opens in the root', () => {
    expect(openedDir()).toBe(h.root);
  });
});
