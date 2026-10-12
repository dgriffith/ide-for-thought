/**
 * Global keymap (#463 / extracted in #670; on the command registry since
 * #2625) — safety net for keyboard dispatch. Each shortcut runs the right
 * command id, combos guard on state before preventDefault, and unmatched keys
 * are ignored. What a command DOES is the shared action table's
 * (command-keymap.test.ts).
 */
import { describe, it, expect, vi } from 'vitest';
import { handleKeydown, type KeymapDeps } from '../../../src/renderer/lib/keymap/handle-keydown';

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
    ['i', { shift: true }, 'learning.openConversation'],
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
