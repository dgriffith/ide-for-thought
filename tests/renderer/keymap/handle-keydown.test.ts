/**
 * Global keymap (#463 / extracted in #670) — safety net for keyboard dispatch.
 * Verifies each shortcut routes to the right action, that combos guard on
 * state before preventDefault, and that unmatched keys are ignored.
 */
import { describe, it, expect, vi } from 'vitest';
import { handleKeydown, type KeymapDeps } from '../../../src/renderer/lib/keymap/handle-keydown';

function makeDeps(overrides: Partial<KeymapDeps> = {}): KeymapDeps {
  const actions = [
    'toggleCommandPalette', 'navBack', 'navForward', 'cyclePreview',
    'toggleRightSidebar', 'cycleTheme', 'newNote', 'closeActiveTab',
    'toggleQuickOpen', 'openGotoLine', 'newQuery', 'openConversation',
  ] as const;
  const deps = {
    hasProject: () => true,
    hasActiveTab: () => true,
    hasActiveIndex: () => true,
  } as Record<string, unknown>;
  for (const a of actions) deps[a] = vi.fn();
  return { ...deps, ...overrides } as KeymapDeps;
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
  const cases: Array<[string, { shift?: boolean }, keyof KeymapDeps]> = [
    ['k', {}, 'toggleCommandPalette'],
    ['[', {}, 'navBack'],
    [']', {}, 'navForward'],
    ['p', { shift: true }, 'cyclePreview'],
    ['b', { shift: true }, 'toggleRightSidebar'],
    ['t', { shift: true }, 'cycleTheme'],
    ['n', {}, 'newNote'],
    ['w', {}, 'closeActiveTab'],
    ['p', {}, 'toggleQuickOpen'],
    ['g', {}, 'openGotoLine'],
    ['q', { shift: true }, 'newQuery'],
    ['i', { shift: true }, 'openConversation'],
  ];

  for (const [key, mods, action] of cases) {
    it(`${mods.shift ? '⌘⇧' : '⌘'}${key} → ${action}`, () => {
      const deps = makeDeps();
      const e = press(key, mods);
      handleKeydown(e, deps);
      expect(deps[action]).toHaveBeenCalledTimes(1);
      expect(e.preventDefault).toHaveBeenCalled();
    });
  }

  it('works with Ctrl as the modifier too', () => {
    const deps = makeDeps();
    handleKeydown(press('n', { meta: false, ctrl: true }), deps);
    expect(deps.newNote).toHaveBeenCalledTimes(1);
  });

  it('ignores keys pressed without a modifier', () => {
    const deps = makeDeps();
    const e = press('k', { meta: false, ctrl: false });
    handleKeydown(e, deps);
    expect(deps.toggleCommandPalette).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('handleKeydown — state guards', () => {
  it('⌘K does nothing (no preventDefault) with no project open', () => {
    const deps = makeDeps({ hasProject: () => false });
    const e = press('k');
    handleKeydown(e, deps);
    expect(deps.toggleCommandPalette).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('⌘W does nothing with no active tab index', () => {
    const deps = makeDeps({ hasActiveIndex: () => false });
    const e = press('w');
    handleKeydown(e, deps);
    expect(deps.closeActiveTab).not.toHaveBeenCalled();
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('⌘P quick-open does nothing with no project', () => {
    const deps = makeDeps({ hasProject: () => false });
    const e = press('p');
    handleKeydown(e, deps);
    expect(deps.toggleQuickOpen).not.toHaveBeenCalled();
  });

  it('⌘G does nothing with no active tab', () => {
    const deps = makeDeps({ hasActiveTab: () => false });
    const e = press('g');
    handleKeydown(e, deps);
    expect(deps.openGotoLine).not.toHaveBeenCalled();
  });

  it('⌘⇧Q does nothing with no project', () => {
    const deps = makeDeps({ hasProject: () => false });
    handleKeydown(press('q', { shift: true }), deps);
    expect(deps.newQuery).not.toHaveBeenCalled();
  });
});
