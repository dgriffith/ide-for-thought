/**
 * @vitest-environment node
 *
 * Squirrel.Windows install hooks (#2181): the installer launches Minerva with
 * a `--squirrel-*` argument and waits. The app makes or removes its shortcuts
 * through Update.exe and quits — once, and never hangs the installer.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { HOOK_TIMEOUT_MS, handleSquirrelEvent, squirrelEvent, updateExeArgs, updateExePath } from '../../src/main/squirrel-events';
import { silenceLogTags } from '../helpers/quiet-logs';

// The cannot-start cases log a warning, as they should.
silenceLogTags('entrypoint');

const EXE = 'C:\\Users\\me\\AppData\\Local\\minerva\\app-4.0.0\\Minerva.exe';

function fakeSpawn() {
  const child = new EventEmitter();
  const spawn = vi.fn(() => child);
  return { child, spawn };
}

describe('squirrelEvent', () => {
  it('reads the four hook arguments, on Windows only', () => {
    for (const e of ['install', 'updated', 'uninstall', 'obsolete'] as const) {
      expect(squirrelEvent([EXE, `--squirrel-${e}`, '4.0.0'], 'win32')).toBe(e);
      expect(squirrelEvent([EXE, `--squirrel-${e}`], 'darwin')).toBeNull();
    }
  });

  it('first run, an ordinary launch, or the flag anywhere but first is not an event', () => {
    expect(squirrelEvent([EXE, '--squirrel-firstrun'], 'win32')).toBeNull();
    expect(squirrelEvent([EXE], 'win32')).toBeNull();
    expect(squirrelEvent([EXE, 'notes.md', '--squirrel-install'], 'win32')).toBeNull();
  });
});

describe("Update.exe's job", () => {
  it('lives beside the versioned app folder', () => {
    expect(updateExePath(EXE)).toBe('C:\\Users\\me\\AppData\\Local\\minerva\\Update.exe');
  });

  it('makes shortcuts on install and update, removes them on uninstall, nothing when obsolete', () => {
    expect(updateExeArgs('install', EXE)).toEqual(['--createShortcut=Minerva.exe']);
    expect(updateExeArgs('updated', EXE)).toEqual(['--createShortcut=Minerva.exe']);
    expect(updateExeArgs('uninstall', EXE)).toEqual(['--removeShortcut=Minerva.exe']);
    expect(updateExeArgs('obsolete', EXE)).toBeNull();
  });
});

describe('handleSquirrelEvent', () => {
  it('runs Update.exe hidden and detached, and quits when it exits', () => {
    const { child, spawn } = fakeSpawn();
    const quit = vi.fn();
    handleSquirrelEvent('install', { exePath: EXE, quit, spawn: spawn as never, setTimer: vi.fn() });
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Users\\me\\AppData\\Local\\minerva\\Update.exe',
      ['--createShortcut=Minerva.exe'],
      expect.objectContaining({ detached: true, windowsHide: true }),
    );
    expect(quit).not.toHaveBeenCalled();
    child.emit('exit', 0);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('quits after the timeout if Update.exe never exits, and only once', () => {
    const { child, spawn } = fakeSpawn();
    const quit = vi.fn();
    let timer: (() => void) | undefined;
    handleSquirrelEvent('uninstall', { exePath: EXE, quit, spawn: spawn as never, setTimer: (fn, ms) => { expect(ms).toBe(HOOK_TIMEOUT_MS); timer = fn; } });
    timer!();
    child.emit('exit', 0);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('quits when Update.exe cannot start, whether spawn throws or reports it', () => {
    const quitA = vi.fn();
    handleSquirrelEvent('install', { exePath: EXE, quit: quitA, spawn: (() => { throw new Error('ENOENT'); }), setTimer: vi.fn() });
    expect(quitA).toHaveBeenCalledTimes(1);

    const { child, spawn } = fakeSpawn();
    const quitB = vi.fn();
    handleSquirrelEvent('install', { exePath: EXE, quit: quitB, spawn: spawn as never, setTimer: vi.fn() });
    child.emit('error', new Error('ENOENT'));
    expect(quitB).toHaveBeenCalledTimes(1);
  });

  it('obsolete runs nothing and quits at once', () => {
    const spawn = vi.fn();
    const quit = vi.fn();
    handleSquirrelEvent('obsolete', { exePath: EXE, quit, spawn: spawn as never, setTimer: vi.fn() });
    expect(spawn).not.toHaveBeenCalled();
    expect(quit).toHaveBeenCalledTimes(1);
  });
});
