/**
 * Settings → Plugins (#2634): list, enable / disable, remove, install from a
 * folder, open the folder. Each change goes through `changePlugins`, which
 * applies it to the whole app — no restart — and answers with the new list.
 *
 * Install picks the folder or the `.zip` with a native dialog in main, and
 * asks a native "Replace?" there too when a plugin of that id is installed,
 * so the renderer never names a path main will copy from or unpack.
 */
import { dialog, shell, type BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import type { PluginList, PluginPackage, PluginSummary } from '../../shared/plugins/format';
import { activePluginsDir, getPluginInventory, pluginsAppVersion } from '../plugins/registry';
import { installPluginFromFolder, installPluginFromZip, PluginExistsError, removePlugin, setPluginEnabled } from '../plugins/lifecycle';
import { PLUGIN_ID } from '../plugins/manifest';
import { changePlugins } from '../plugins-apply';
import { handle } from './typed-ipc';
import { winFromEvent } from './helpers';
import path from 'node:path';

export async function pluginList(): Promise<PluginList> {
  const inv = await getPluginInventory();
  return {
    installed: inv.installed.map(({ plugin, record }): PluginSummary => {
      const contributes: PluginSummary['contributes'] = {};
      for (const c of plugin.contributions) contributes[c.point] = (contributes[c.point] ?? 0) + 1;
      const m = plugin.manifest;
      return {
        id: m.id, name: m.name, version: m.version, description: m.description,
        ...(m.author ? { author: m.author } : {}),
        ...(m.license ? { license: m.license } : {}),
        enabled: record.enabled,
        source: record.source,
        ...(record.installedAt ? { installedAt: record.installedAt } : {}),
        contributes,
      };
    }),
    errors: inv.errors,
    folder: activePluginsDir(),
  };
}

/**
 * Install, applied app-wide; when a plugin of that id is installed, ask a
 * native "Replace?" and install again only on Replace.
 */
async function installAsking(
  win: BrowserWindow,
  install: (replace: boolean) => Promise<PluginPackage>,
): Promise<{ id: string; name: string } | null> {
  const installed = await changePlugins(async () => {
    try {
      return await install(false);
    } catch (err) {
      if (!(err instanceof PluginExistsError)) throw err;
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        message: `A plugin "${err.id}" is already installed.`,
        detail: 'Replace it with this one?',
        buttons: ['Replace', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response !== 0) return null;
      return install(true);
    }
  });
  return installed ? { id: installed.manifest.id, name: installed.manifest.name } : null;
}

export function registerPlugins(): void {
  handle(Channels.PLUGINS_LIST, () => pluginList());

  handle(Channels.PLUGINS_SET_ENABLED, async (_e, id: string, enabled: boolean) => {
    await changePlugins(() => setPluginEnabled(activePluginsDir(), id, enabled === true));
    return pluginList();
  });

  handle(Channels.PLUGINS_REMOVE, async (_e, id: string) => {
    await changePlugins(() => removePlugin(activePluginsDir(), id));
    return pluginList();
  });

  handle(Channels.PLUGINS_INSTALL_FOLDER, async (e) => {
    const win = winFromEvent(e);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Install a plugin from a folder',
      buttonLabel: 'Install',
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const source = picked.filePaths[0]!;
    return installAsking(win, (replace) => installPluginFromFolder(activePluginsDir(), source, pluginsAppVersion(), { replace }));
  });

  handle(Channels.PLUGINS_INSTALL_ZIP, async (e) => {
    const win = winFromEvent(e);
    const picked = await dialog.showOpenDialog(win, {
      title: 'Install a plugin from a zip',
      buttonLabel: 'Install',
      properties: ['openFile'],
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    const archive = picked.filePaths[0]!;
    return installAsking(win, (replace) => installPluginFromZip(activePluginsDir(), archive, pluginsAppVersion(), { replace }));
  });

  // Show a plugin's folder, or the plugins folder, in the OS file manager.
  // `showItemInFolder`, never `openPath`: a "plugin folder" that's really a
  // link to a program must be shown, not run.
  handle(Channels.PLUGINS_REVEAL, (_e, id?: string) => {
    const dir = activePluginsDir();
    if (id !== undefined && !PLUGIN_ID.test(id)) throw new Error(`"${id}" isn't a plugin id.`);
    shell.showItemInFolder(id === undefined ? dir : path.join(dir, id));
  });
}
