/**
 * Global keymap (#463 / extracted in #670; on the command registry since
 * #2625) — safety net for keyboard dispatch. Each shortcut runs the right
 * command id, combos guard on state before preventDefault, and unmatched keys
 * are ignored. What a command DOES is the shared action table's
 * (command-keymap.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleKeydown, handlePluginKeydown, matchesAccelerator, type KeymapDeps } from '../../../src/renderer/lib/keymap/handle-keydown';

function makeDeps(overrides: Partial<KeymapDeps> = {}): KeymapDeps & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(),
    hasProject: () => true,
    hasActiveTab: () => true,
    hasActiveIndex: () => true,
    ...overrides,
  } as KeymapDeps & { run: ReturnType<typeof vi.fn> };
}

function press(
  key: string,
  mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    metaKey: mods.meta ?? true, // default to ⌘ held
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

describe('handleKeydown — dispatch', () => {
  const cases: Array<[string, { shift?: boolean }, string]> = [
    ['k', {}, 'view.commandPalette'],
    ['[', {}, 'nav.back'],
    [']', {}, 'nav.forward'],
    ['p', { shift: true }, 'view.togglePreview'],
    ['b', { shift: true }, 'view.toggleRightSidebar'],
    ['t', { shift: true }, 'view.cycleTheme'],
    ['n', {}, 'file.newNote'],
    ['w', {}, 'view.closeTab'],
    ['p', {}, 'nav.quickOpen'],
    ['g', {}, 'edit.gotoLine'],
    ['q', { shift: true }, 'query.new'],
  ];

  for (const [key, mods, command] of cases) {
    it(`${mods.shift ? '⌘⇧' : '⌘'}${key} → ${command}`, () => {
      const deps = makeDeps();
      const e = press(key, mods);
      handleKeydown(e, deps);
      expect(deps.run).toHaveBeenCalledExactlyOnceWith(command);
      expect(e.preventDefault).toHaveBeenCalled();
    });
  }

  it('⌘⌥C → learning.openConversation, though macOS types "ç"; ⌘⇧I is left to the menu\'s Ingest URL (#2758)', () => {
    const deps = makeDeps();
    const e = { ...press('ç', { alt: true }), code: 'KeyC' } as unknown as KeyboardEvent;
    handleKeydown(e, deps);
    expect(deps.run).toHaveBeenCalledExactlyOnceWith('learning.openConversation');
    const ingest = press('i', { shift: true });
    handleKeydown(ingest, deps);
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(ingest.preventDefault).not.toHaveBeenCalled();
  });

  it('works with Ctrl as the modifier too', () => {
    const deps = makeDeps();
    handleKeydown(press('n', { meta: false, ctrl: true }), deps);
    expect(deps.run).toHaveBeenCalledExactlyOnceWith('file.newNote');
  });

  it('matches a Shift combo whatever case the browser reports the key in', () => {
    const deps = makeDeps();
    handleKeydown(press('P', { meta: false, ctrl: true, shift: true }), deps);
    expect(deps.run).toHaveBeenCalledExactlyOnceWith('view.togglePreview');
  });

  it('Shift must match: ⌘⇧G is not ⌘G', () => {
    const deps = makeDeps();
    const e = press('g', { shift: true });
    handleKeydown(e, deps);
    expect(deps.run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('ignores keys pressed without a modifier', () => {
    const deps = makeDeps();
    const e = press('k', { meta: false, ctrl: false });
    handleKeydown(e, deps);
    expect(deps.run).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleKeydown — state guards', () => {
  const guarded: Array<[string, { shift?: boolean }, Partial<KeymapDeps>]> = [
    ['k', {}, { hasProject: () => false }],
    ['w', {}, { hasActiveIndex: () => false }],
    ['p', {}, { hasProject: () => false }],
    ['g', {}, { hasActiveTab: () => false }],
    ['q', { shift: true }, { hasProject: () => false }],
  ];
  for (const [key, mods, state] of guarded) {
    it(`${mods.shift ? '⌘⇧' : '⌘'}${key} falls through (no preventDefault) when its guard is unmet`, () => {
      const deps = makeDeps(state);
      const e = press(key, mods);
      handleKeydown(e, deps);
      expect(deps.run).not.toHaveBeenCalled();
      expect(e.preventDefault).not.toHaveBeenCalled();
    });
  }
});

describe('plugin command keys (#2879)', () => {
  const keyed = new Map([['shelf/find', 'CmdOrCtrl+Alt+J'], ['lab/sort', 'CmdOrCtrl+Shift+L']]);

  it('runs the plugin command a key belongs to, and claims the key', () => {
    const run = vi.fn();
    const e = press('L', { shift: true });
    expect(handlePluginKeydown(e, keyed, run)).toBe(true);
    expect(run).toHaveBeenCalledWith('lab', 'sort');
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('leaves alone a key Minerva already took, and one no plugin has', () => {
    const run = vi.fn();
    const taken = { ...press('L', { shift: true }), defaultPrevented: true } as unknown as KeyboardEvent;
    expect(handlePluginKeydown(taken, keyed, run)).toBe(false);
    expect(handlePluginKeydown(press('j'), keyed, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('matches ⌥ and a letter by the key pressed, though macOS types "∫" for ⌥B', () => {
    const optB = { ...press('∫', { alt: true }), code: 'KeyB' } as unknown as KeyboardEvent;
    expect(matchesAccelerator(optB, 'CmdOrCtrl+Alt+B')).toBe(true);
    expect(matchesAccelerator({ ...press('∫'), code: 'KeyB' }, 'CmdOrCtrl+B')).toBe(false);
  });
});

