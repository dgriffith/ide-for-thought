/**
 * Settings → Plugins (#2634): list, enable / disable, remove, install from a
 * folder, open the folder. Each change goes through `changePlugins`, which
 * applies it to the whole app — no restart — and answers with the new list.
 *
 * Install picks the folder or the `.zip` with a native dialog in main, and
 * asks a native "Replace?" there too when a plugin of that id is installed,
 * so the renderer never names a path main will copy from or unpack. A git
 * install takes the URL the user typed.
 *
 * It also answers a drafted extension's card (#2652): the user saves a skill
 * the assistant drafted, installs a drafted plugin, or saves either to a
 * folder. Main writes the copy it kept when the tool ran.
 */
import { dialog, shell, type BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import type { PluginList, PluginManifest, PluginPackage, PluginRecommendation, PluginSettingsPatch, PluginSettingsView, PluginSummary } from '../../shared/plugins/format';
import { readPluginSettings, savePluginSettings } from '../plugins/settings';
import { pluginThemes } from '../plugins/themes';
import { reconcilePluginServers } from '../mcp-servers/registry';
import { secretStorageStatus } from '../secret-storage';
import { activePluginsDir, getPluginInventory, pluginsAppVersion } from '../plugins/registry';
import { installPluginFromDraft, installPluginFromFolder, installPluginFromGit, installPluginFromZip, removePlugin, setPluginEnabled, type ReplacePolicy } from '../plugins/lifecycle';
import type { ExtensionDraftAction, ExtensionDraftActionResult } from '../../shared/extensions/drafts';
import { saveDraftToFolder, saveSkillDraft } from '../extensions/draft-apply';
import { reloadAndRegisterSkills } from '../skills/register';
import { rebuildMenu } from '../menu';
import { pendingExtensionDrafts } from './extension-draft-offers';
import { PLUGIN_ID } from '../plugins/manifest';
import { changePlugins } from '../plugins-apply';
import { handle } from './typed-ipc';
import { winFromEvent, withRootPathOr } from './helpers';
import { pluginRecommendations } from '../plugins/recommendations';
import { corePlugin, corePluginEnabled, corePlugins, isCorePluginId, setCorePluginEnabled } from '../plugins/core';
import { confirmNative } from '../native-confirm';
import { describeCapabilities } from '../../shared/plugins/capabilities';
import { loadPluginRecords } from '../plugins/state';
import path from 'node:path';

export async function pluginList(): Promise<PluginList> {
  const [inv, records] = await Promise.all([getPluginInventory(), loadPluginRecords(activePluginsDir())]);
  return {
    core: corePlugins().map(({ manifest: m, defaultEnabled }): PluginSummary => ({
      id: m.id, name: m.name, version: m.version, description: m.description,
      enabled: corePluginEnabled(records, { manifest: m, defaultEnabled }),
      source: { kind: 'core' },
      contributes: {},
      ...(m.code ? { capabilities: m.code.capabilities } : {}),
    })),
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
        ...(m.settings?.length ? { settings: m.settings.length } : {}),
        ...(m.mcpServers?.length ? { mcpServers: m.mcpServers.length } : {}),
      };
    }),
    errors: inv.errors,
    folder: activePluginsDir(),
  };
}

/**
 * Install, applied app-wide. Over an installed id, a native "Replace?" is
 * asked mid-install (`ReplacePolicy`), so nothing is fetched twice.
 */
async function installAsking(
  win: BrowserWindow,
  install: (replace: ReplacePolicy) => Promise<PluginPackage | null>,
): Promise<{ id: string; name: string } | null> {
  const installed = await changePlugins(() => install(async (id) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      message: `A plugin "${id}" is already installed.`,
      detail: 'Replace it with this one?',
      buttons: ['Replace', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    });
    return response === 0;
  }));
  return installed ? { id: installed.manifest.id, name: installed.manifest.name } : null;
}

/**
 * Turning on a plugin whose code declares `process` (#2821): asked natively,
 * saying what it can do. A plugin without it isn't asked.
 */
async function mayRunPrograms(win: BrowserWindow, manifest: PluginManifest): Promise<boolean> {
  const caps = manifest.code?.capabilities ?? [];
  if (!caps.includes('process')) return true;
  const { confirmed } = await confirmNative(win, {
    message: `Turn on ${manifest.name}?`,
    detail: `${manifest.description}\n\n${describeCapabilities(caps)} It runs programs only when you ask it to, and you can turn it off again in Settings → Plugins.`,
    confirmLabel: 'Turn On',
  });
  return confirmed;
}

/** An installed plugin's manifest, on or off. */
async function installedManifest(id: unknown): Promise<PluginManifest> {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error(`"${String(id)}" isn't a plugin id.`);
  const found = (await getPluginInventory()).installed.find((i) => i.plugin.manifest.id === id);
  if (!found) throw new Error(`No plugin "${id}" is installed.`);
  return found.plugin.manifest;
}

const withStorage = (view: PluginSettingsView): PluginSettingsView =>
  view.fields.some((f) => f.kind === 'secret') ? { ...view, secretsEncrypted: secretStorageStatus().encrypted } : view;

export function registerPlugins(): void {
  handle(Channels.PLUGINS_LIST, () => pluginList());

  handle(Channels.PLUGINS_SET_ENABLED, async (e, id: string, enabled: boolean) => {
    const on = enabled === true;
    // A plugin whose code can run a program asks with main's own dialog
    // before it's turned on (#2821), built-in or not: the renderer can't draw
    // or answer it. Only built-in plugins can declare code yet (#2833).
    const core = corePlugin(id);
    if (on && core && !(await mayRunPrograms(winFromEvent(e), core.manifest))) return pluginList();
    const set = core ? setCorePluginEnabled : setPluginEnabled;
    await changePlugins(() => set(activePluginsDir(), id, on));
    return pluginList();
  });

  handle(Channels.PLUGINS_REMOVE, async (_e, id: string) => {
    if (isCorePluginId(id)) throw new Error(`"${id}" is built into Minerva; it can be turned off, not removed.`);
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

  // The URL is typed by the user; main parses it (HTTPS only, no
  // credentials) and never sends a credential with the fetch.
  handle(Channels.PLUGINS_INSTALL_GIT, async (e, spec: string) => {
    if (typeof spec !== 'string') throw new Error('Give the plugin\'s git URL.');
    return installAsking(winFromEvent(e), (replace) => installPluginFromGit(activePluginsDir(), spec, pluginsAppVersion(), { replace }));
  });

  // A drafted extension's card (#2652). Only the window shown the card may
  // act on it, and only on main's copy of the draft. A failed or cancelled
  // save leaves the card waiting, so the user can try the other way.
  handle(Channels.CONVERSATION_EXTENSION_DRAFT_ACTION, async (e, offerId: string, action: ExtensionDraftAction): Promise<ExtensionDraftActionResult> => {
    const win = winFromEvent(e);
    const pending = pendingExtensionDrafts.get(offerId);
    if (!pending || pending.winId !== win.id) return { ok: false, error: 'This draft is no longer waiting for an answer.' };
    const { draft } = pending;
    try {
      if (action === 'save' && draft.kind === 'skill') {
        const where = await saveSkillDraft(draft);
        await reloadAndRegisterSkills();
        rebuildMenu();
        pending.settle({ kind: 'saved', where });
        return { ok: true, action, where };
      }
      if (action === 'save') {
        // Installed like any plugin: checked whole, its MCP servers off.
        const installed = await installAsking(win, (replace) => installPluginFromDraft(activePluginsDir(), draft.files, pluginsAppVersion(), { replace }));
        if (!installed) return { ok: false, cancelled: true };
        const where = path.join(activePluginsDir(), installed.id);
        pending.settle({ kind: 'saved', where });
        return { ok: true, action, where };
      }
      if (action === 'save-folder') {
        const picked = await dialog.showOpenDialog(win, {
          title: draft.kind === 'plugin' ? `Save the ${draft.name} plugin's folder in…` : `Save the ${draft.name} skill in…`,
          buttonLabel: 'Save Here',
          properties: ['openDirectory', 'createDirectory'],
        });
        if (picked.canceled || picked.filePaths.length === 0) return { ok: false, cancelled: true };
        const where = await saveDraftToFolder(draft, picked.filePaths[0]!);
        pending.settle({ kind: 'saved-folder', where });
        return { ok: true, action, where };
      }
      pending.settle({ kind: 'dismissed' });
      return { ok: true, action: 'dismiss' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // What the open thoughtbase recommends (#2635). Describes only: an Install
  // button sends the source back through `plugins:installGit`, when the user
  // presses it.
  handle(Channels.PLUGINS_RECOMMENDATIONS, withRootPathOr(Promise.resolve<PluginRecommendation[]>([]), (rootPath) => pluginRecommendations(rootPath)));

  // The enabled plugins' colour themes (#2787), checked in main.
  handle(Channels.PLUGINS_THEMES, () => pluginThemes());

  // A plugin's settings (#2636), per machine. A secret's value never comes
  // back to the renderer, only whether one is set.
  handle(Channels.PLUGINS_SETTINGS, async (_e, id: string) =>
    withStorage(await readPluginSettings(activePluginsDir(), await installedManifest(id))));

  handle(Channels.PLUGINS_SET_SETTINGS, async (_e, id: string, patch: PluginSettingsPatch) => {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Settings must be an object of setting → value.');
    const view = withStorage(await savePluginSettings(activePluginsDir(), await installedManifest(id), patch));
    // Its MCP servers get the new values: a running one restarts (#2646).
    await reconcilePluginServers();
    return view;
  });

  // Show a plugin's folder, or the plugins folder, in the OS file manager.
  // `showItemInFolder`, never `openPath`: a "plugin folder" that's really a
  // link to a program must be shown, not run.
  handle(Channels.PLUGINS_REVEAL, (_e, id?: string) => {
    const dir = activePluginsDir();
    if (id !== undefined && !PLUGIN_ID.test(id)) throw new Error(`"${id}" isn't a plugin id.`);
    if (id !== undefined && isCorePluginId(id)) throw new Error(`"${id}" is built into Minerva; it has no folder.`);
    shell.showItemInFolder(id === undefined ? dir : path.join(dir, id));
  });
}
