/**
 * Plugin commands in the menu bar (#2879): each at the end of the menu it
 * names, under a separator, after Minerva's own items, so a plugin can't
 * crowd or stand in for them. A click sends the command to the renderer,
 * which runs it as the palette does; its key, if it kept one, is its
 * accelerator. What each menu gets is `plugins/command-menu.ts`'s.
 */
import type { PluginCommandMenu } from '../../shared/plugins/format';
import { pluginMenuCommands } from '../plugins/command-menu';

const MENU_LABELS: Record<PluginCommandMenu, string> = {
  file: 'File', edit: 'Edit', view: 'View', navigate: 'Navigate', refactor: 'Refactor', query: 'Query', help: 'Help',
};

/** How `menu.ts` enables an item: off unless a thoughtbase (and here, a note or a selection) is there. */
type Gate = <T extends Electron.MenuItemConstructorOptions>(item: T, req?: { note?: boolean; selection?: boolean }) => T;

export function withPluginCommands(
  template: Electron.MenuItemConstructorOptions[],
  gate: Gate,
  run: (ref: { pluginId: string; commandId: string }) => void,
): void {
  for (const [menu, commands] of pluginMenuCommands()) {
    const top = template.find((t) => t.label === MENU_LABELS[menu]);
    if (!top || !Array.isArray(top.submenu) || commands.length === 0) continue;
    top.submenu.push({ type: 'separator' }, ...commands.map((c) => gate({
      label: c.title,
      ...(c.key ? { accelerator: c.key } : {}),
      click: () => run({ pluginId: c.pluginId, commandId: c.commandId }),
    }, { ...(c.when === 'note' ? { note: true } : {}), ...(c.when === 'selection' ? { note: true, selection: true } : {}) })));
  }
}
