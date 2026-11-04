import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import { folderFromArgv, handleSecondInstance, type SecondInstanceDeps } from '../../src/main/single-instance';

const CWD = path.resolve('/work');
const dirs = new Set([path.resolve('/work/tb'), path.resolve('/notes/other')]);
const isDir = (p: string) => dirs.has(p);

describe('folderFromArgv (#2982)', () => {
  it('finds the first argument that names a directory, relative to the launch cwd', () => {
    expect(folderFromArgv(['Minerva.exe', 'tb'], CWD, isDir)).toBe(path.resolve('/work/tb'));
    expect(folderFromArgv(['Minerva.exe', path.resolve('/notes/other')], CWD, isDir)).toBe(path.resolve('/notes/other'));
  });

  it('skips the executable, options and anything that is not a directory', () => {
    expect(folderFromArgv([path.resolve('/work/tb'), '--inspect', '-psn_0_123', 'missing', 'tb'], CWD, isDir)).toBe(path.resolve('/work/tb'));
    expect(folderFromArgv(['Minerva.exe', '--flag', 'note.md', ''], CWD, isDir)).toBeNull();
    expect(folderFromArgv(['Minerva.exe'], CWD, isDir)).toBeNull();
  });
});

function fakeWin(name: string, minimized = false) {
  const calls: string[] = [];
  const win = {
    name,
    calls,
    isMinimized: () => minimized,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  return win as unknown as BrowserWindow & { calls: string[] };
}

function deps(over: Partial<SecondInstanceDeps> = {}) {
  const created = fakeWin('new');
  const d = {
    windows: () => [],
    focused: () => null,
    windowsForProject: () => [],
    createWindow: vi.fn(() => created),
    openProject: vi.fn(),
    ...over,
  } satisfies SecondInstanceDeps;
  return { d, created };
}

describe('handleSecondInstance (#2982)', () => {
  // `folderFromArgv` reads the real filesystem here; these launches name none.
  it('a plain second launch brings the focused window forward, restoring it if minimized', () => {
    const a = fakeWin('a', true);
    const b = fakeWin('b');
    const { d } = deps({ windows: () => [a, b], focused: () => b });
    handleSecondInstance(['Minerva.exe'], CWD, d);
    expect(b.calls).toEqual(['show', 'focus']);
    expect(a.calls).toEqual([]);
    expect(d.createWindow).not.toHaveBeenCalled();

    const { d: d2 } = deps({ windows: () => [a] });
    handleSecondInstance(['Minerva.exe'], CWD, d2);
    expect(a.calls).toEqual(['restore', 'show', 'focus']);
  });

  it('with no window open (macOS, after closing the last one) it opens one', () => {
    const { d } = deps();
    handleSecondInstance(['Minerva'], CWD, d);
    expect(d.createWindow).toHaveBeenCalledTimes(1);
    expect(d.openProject).not.toHaveBeenCalled();
  });

  it('a launch naming a folder opens it in a new window, or focuses the window that has it', () => {
    const folder = path.resolve(__dirname);
    const { d, created } = deps();
    handleSecondInstance(['Minerva.exe', folder], CWD, d);
    expect(d.openProject).toHaveBeenCalledWith(created, folder);

    const has = fakeWin('has');
    const { d: d2 } = deps({ windowsForProject: (p) => (p === folder ? [has] : []) });
    handleSecondInstance(['Minerva.exe', folder], CWD, d2);
    expect(has.calls).toEqual(['show', 'focus']);
    expect(d2.createWindow).not.toHaveBeenCalled();
  });
});
