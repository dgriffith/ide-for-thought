/**
 * The commands a plugin view may run with a forwarded shortcut (#2827). A
 * plugin can fake a keystroke, so this list is pinned: growing it is a
 * decision, made in this file, not a side effect of tagging a command.
 */
import { describe, it, expect } from 'vitest';
import { COMMANDS } from '../../src/shared/commands';

const forwardable = COMMANDS.filter((c) => 'fromPluginViews' in c && c.fromPluginViews === true);

describe('fromPluginViews (#2827)', () => {
  it('is exactly the commands that move around the app or show something', () => {
    expect(forwardable.map((c) => c.id).sort()).toEqual([
      'app.shortcuts',
      'edit.findInNotes',
      'nav.back',
      'nav.forward',
      'nav.quickOpen',
      'view.closeTab',
      'view.commandPalette',
      'view.focusNextGroup',
      'view.focusPrevGroup',
      'view.toggleConversations',
      'view.toggleRightSidebar',
      'view.toggleSidebar',
    ]);
  });

  it('none of them changes a note or the thoughtbase', () => {
    for (const c of forwardable) {
      expect(['File', 'Refactor', 'Research', 'Query', 'Learning'], c.id).not.toContain(c.category);
      expect(c.id, c.id).not.toMatch(/^(editor|refactor|file|research|objects|query|export)\./);
    }
  });
});
