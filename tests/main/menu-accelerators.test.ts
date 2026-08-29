/**
 * Menu accelerator utilities (#398, #804; extracted from menu.ts in #1906).
 *
 * `formatAccelerator` / `collectAcceleratorsByMenu` are pure and
 * Electron-free — no mocks needed to reach them, unlike when they lived in
 * menu.ts (see the sibling `tests/main/menu-shortcuts.test.ts`, which still
 * mocks Electron + project state to exercise the real `rebuildMenu()`
 * template these functions read).
 */
import { describe, it, expect } from 'vitest';
import { collectAcceleratorsByMenu, formatAccelerator } from '../../src/main/menu/accelerators';

describe('collectAcceleratorsByMenu (#398)', () => {
  it('returns empty for an empty template', () => {
    expect(collectAcceleratorsByMenu([])).toEqual(new Map());
  });

  it('skips top-level menus that have no accelerators', () => {
    const map = collectAcceleratorsByMenu([
      { label: 'Help', submenu: [{ label: 'About' /* no accelerator */ }] },
    ]);
    expect(map.size).toBe(0);
  });

  it('collects accelerators per top-level menu, with the path', () => {
    const map = collectAcceleratorsByMenu([
      {
        label: 'File',
        submenu: [
          { label: 'New', accelerator: 'CmdOrCtrl+N' },
          { label: 'Open', accelerator: 'CmdOrCtrl+O' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { label: 'Copy', accelerator: 'CmdOrCtrl+C' },
        ],
      },
    ]);
    expect(map.get('File')?.map((e) => e.accelerator).sort())
      .toEqual(['CmdOrCtrl+N', 'CmdOrCtrl+O']);
    expect(map.get('Edit')?.map((e) => e.accelerator)).toEqual(['CmdOrCtrl+C']);
    expect(map.get('File')?.[0].path).toEqual(['File', 'New']);
  });

  it('descends into nested submenus', () => {
    const map = collectAcceleratorsByMenu([
      {
        label: 'View',
        submenu: [
          {
            label: 'Theme',
            submenu: [
              { label: 'Light', accelerator: 'CmdOrCtrl+1' },
              { label: 'Dark', accelerator: 'CmdOrCtrl+2' },
            ],
          },
        ],
      },
    ]);
    expect(map.get('View')?.map((e) => e.accelerator)).toEqual(['CmdOrCtrl+1', 'CmdOrCtrl+2']);
    expect(map.get('View')?.[0].path).toEqual(['View', 'Theme', 'Light']);
  });
});

describe('formatAccelerator (#804)', () => {
  it('renders macOS symbol form, joined without separators', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', 'darwin')).toBe('⌘⇧S');
    expect(formatAccelerator('Cmd+,', 'darwin')).toBe('⌘,');
    expect(formatAccelerator('Alt+Ctrl+P', 'darwin')).toBe('⌥⌃P');
  });

  it('renders Ctrl-word form on other platforms, plus-joined', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+S', 'win32')).toBe('Ctrl+Shift+S');
    expect(formatAccelerator('CmdOrCtrl+/', 'linux')).toBe('Ctrl+/');
  });
});
