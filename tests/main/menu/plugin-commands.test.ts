/**
 * `withPluginCommands` (#2879): a placed command's click runs it by
 * plugin and command id, gated by what it needs; a menu a template hasn't
 * got (Navigate before a thoughtbase, say) gets nothing.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/main/plugins/command-menu', () => ({
  pluginMenuCommands: () => new Map([
    ['edit', [{ pluginId: 'shelf', commandId: 'find', title: 'Find', when: 'note' }]],
    ['navigate', [{ pluginId: 'shelf', commandId: 'go', title: 'Go', when: 'project' }]],
  ]),
}));

import { withPluginCommands } from '../../../src/main/menu/plugin-commands';

describe('withPluginCommands (#2879)', () => {
  it('a click runs the command; the gate is asked for what it needs', () => {
    const template: Electron.MenuItemConstructorOptions[] = [{ label: 'Edit', submenu: [{ label: 'Undo' }] }];
    const gate = vi.fn((item) => item);
    const run = vi.fn();
    withPluginCommands(template, gate, run);
    const items = template[0]!.submenu as Electron.MenuItemConstructorOptions[];
    expect(items.map((i) => i.label ?? i.type)).toEqual(['Undo', 'separator', 'Find']);
    expect(gate).toHaveBeenCalledWith(expect.objectContaining({ label: 'Find' }), { note: true });
    (items[2]!.click as () => void)();
    expect(run).toHaveBeenCalledWith({ pluginId: 'shelf', commandId: 'find' });
    expect(template).toHaveLength(1);
  });
});
