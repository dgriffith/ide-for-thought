import { describe, it, expect } from 'vitest';
import { discoverDefaultPython, type DiscoveryDeps } from '../../../src/main/compute/python-discovery';

const STORE = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps';
const PYORG = 'C:\\Users\\me\\AppData\\Local\\Programs\\Python\\Python313';
const LAUNCHER = 'C:\\Windows';

/** A Windows machine whose PATH holds `files` (full paths); `py` answers `launcherSays`. */
function windows(files: string[], launcherSays: string | null = null, path = [STORE, PYORG, LAUNCHER].join(';')): DiscoveryDeps & { launched: string[] } {
  const launched: string[] = [];
  const have = new Set(files.map((f) => f.toLowerCase()));
  return {
    platform: 'win32',
    env: { PATH: path, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
    isFile: (p) => have.has(p.toLowerCase()),
    runLauncher: (exe) => {
      launched.push(exe);
      return launcherSays;
    },
    launched,
  };
}

describe('the default Python (#2188)', () => {
  it('is python3 off Windows, with nothing looked up', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      expect(discoverDefaultPython({ platform, env: {}, isFile: () => { throw new Error('looked'); }, runLauncher: () => { throw new Error('ran'); } })).toBe('python3');
    }
  });

  it('a python.org install: `python` on PATH, and the launcher is never run', () => {
    const deps = windows([`${PYORG}\\python.exe`, `${LAUNCHER}\\py.exe`]);
    expect(discoverDefaultPython(deps)).toBe('python');
    expect(deps.launched).toEqual([]);
  });

  it('prefers python3 when there is one', () => {
    expect(discoverDefaultPython(windows([`${PYORG}\\python3.exe`, `${PYORG}\\python.exe`]))).toBe('python3');
  });

  it('skips the Microsoft Store stubs, which open the Store instead of running Python', () => {
    const deps = windows([`${STORE}\\python3.exe`, `${STORE}\\python.exe`, `${LAUNCHER}\\py.exe`], `${PYORG}\\python.exe\r\n`);
    expect(discoverDefaultPython(deps)).toBe(`${PYORG}\\python.exe`);
    expect(deps.launched).toEqual([`${LAUNCHER}\\py.exe`]);
  });

  it('only the launcher: its Python 3, as one absolute path every caller can spawn', () => {
    expect(discoverDefaultPython(windows([`${LAUNCHER}\\py.exe`], `${PYORG}\\python.exe\n`))).toBe(`${PYORG}\\python.exe`);
  });

  it("a launcher that fails, or answers with something that isn't a real interpreter, is ignored", () => {
    expect(discoverDefaultPython(windows([`${LAUNCHER}\\py.exe`], null))).toBe('python');
    expect(discoverDefaultPython(windows([`${LAUNCHER}\\py.exe`], 'python.exe'))).toBe('python');
    expect(discoverDefaultPython(windows([`${LAUNCHER}\\py.exe`], `${STORE}\\python.exe`))).toBe('python');
  });

  it('no Python at all: `python`, so the error names what a Windows user expects', () => {
    expect(discoverDefaultPython(windows([]))).toBe('python');
  });

  it('reads `Path` too, as Windows spells it', () => {
    const deps = windows([`${PYORG}\\python.exe`]);
    deps.env = { Path: PYORG, PATHEXT: '.EXE' };
    expect(discoverDefaultPython(deps)).toBe('python');
  });
});
