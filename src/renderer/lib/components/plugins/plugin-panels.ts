/**
 * Plugin global views as sidebar panels (#2640): what both sidebars' panel
 * registries (`sidebar/panels.ts`, `right-sidebar/panels.ts`) build an entry
 * from, so a plugin's panel is listed, titled and mounted like a core one.
 */
import { ICONS, type IconName } from '../icons/registry';
import type { ActivePluginView } from '../../stores/code-plugins.svelte';

/** A plugin panel's id in its registry: never a core panel's, which have no `:`. */
export type PluginPanelId = `plugin:${string}:${string}`;

export function pluginPanelId(pluginId: string, viewId: string): PluginPanelId {
  return `plugin:${pluginId}:${viewId}`;
}

/** The icon a view names, when it is one of Minerva's; a generic one otherwise. */
export function pluginPanelIcon(icon: string | undefined): IconName {
  return icon !== undefined && Object.hasOwn(ICONS, icon) ? (icon as IconName) : 'objects';
}

/** What `PluginPanel` is mounted with. */
export function pluginPanelProps({ pluginId, view }: ActivePluginView): { pluginId: string; viewId: string; entry: string; title: string } {
  return { pluginId, viewId: view.id, entry: view.entry, title: view.title };
}
