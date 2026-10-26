/**
 * Plugin commands in the menu bar (#2879): the commands each menu gets, with
 * the key each one keeps once the enabled plugins' claims are resolved
 * (`shared/plugins/command-keys.ts`, the rule the renderer's keymap uses
 * too). `menu.ts` places them; a click sends the command to the renderer,
 * which runs it as the palette does.
 */
import { resolvePluginKeys } from '../../shared/plugins/command-keys';
import type { PluginCommandMenu, PluginCommandWhen } from '../../shared/plugins/format';
import { activePluginCommands } from './code-plugins';

export interface PluginMenuCommand {
  pluginId: string;
  commandId: string;
  title: string;
  when: PluginCommandWhen;
  key?: string;
}

/** The enabled plugins' commands placed in each menu, in Settings' order. */
export function pluginMenuCommands(): Map<PluginCommandMenu, PluginMenuCommand[]> {
  const all = activePluginCommands();
  const { keys } = resolvePluginKeys(all.map(({ pluginId, pluginName, command }) => ({
    pluginId, pluginName, commandId: command.id, title: command.title, ...(command.key ? { key: command.key } : {}),
  })));
  const out = new Map<PluginCommandMenu, PluginMenuCommand[]>();
  for (const { pluginId, command } of all) {
    if (!command.menu) continue;
    const key = keys.get(`${pluginId}/${command.id}`);
    const list = out.get(command.menu) ?? [];
    list.push({ pluginId, commandId: command.id, title: command.title, when: command.when, ...(key ? { key } : {}) });
    out.set(command.menu, list);
  }
  return out;
}
