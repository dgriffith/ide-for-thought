/**
 * Plugin commands in the menu bar (#2879): each menu gets the commands placed
 * in it, in Settings' order, with the key each keeps once the plugins' claims
 * are resolved (the first plugin to claim one has it).
 */
import { describe, it, expect, vi } from 'vitest';
import type { PluginCommand } from '../../../src/shared/plugins/format';

const h = vi.hoisted(() => ({ commands: [] as { pluginId: string; pluginName: string; command: PluginCommand }[] }));
vi.mock('../../../src/main/plugins/code-plugins', () => ({ activePluginCommands: () => h.commands }));

import { pluginMenuCommands } from '../../../src/main/plugins/command-menu';

const cmd = (id: string, extra: Partial<PluginCommand> = {}): PluginCommand => ({ id, title: id, when: 'project', run: { handler: id }, ...extra });

describe('pluginMenuCommands (#2879)', () => {
  it('groups placed commands by menu, keeping the first plugin\'s key', () => {
    h.commands = [
      { pluginId: 'a', pluginName: 'A', command: cmd('one', { menu: 'edit', key: 'CmdOrCtrl+Alt+B', when: 'selection' }) },
      { pluginId: 'a', pluginName: 'A', command: cmd('unplaced', { key: 'CmdOrCtrl+Alt+U' }) },
      { pluginId: 'b', pluginName: 'B', command: cmd('two', { menu: 'edit', key: 'CmdOrCtrl+Alt+B' }) },
      { pluginId: 'b', pluginName: 'B', command: cmd('three', { menu: 'help' }) },
    ];
    expect(Object.fromEntries(pluginMenuCommands())).toEqual({
      edit: [
        { pluginId: 'a', commandId: 'one', title: 'one', when: 'selection', key: 'CmdOrCtrl+Alt+B' },
        { pluginId: 'b', commandId: 'two', title: 'two', when: 'project' },
      ],
      help: [{ pluginId: 'b', commandId: 'three', title: 'three', when: 'project' }],
    });
  });
});
