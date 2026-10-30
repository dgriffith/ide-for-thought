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
 * the assistant drafted, or saves it to a folder. Main writes the copy it
 * kept when the tool ran. A drafted plugin is a proposal instead (#2890), and
 * this is where approving one is wired: `pluginProposalApplierForApp`.
 */
import { dialog, shell, type BrowserWindow } from 'electron';
import { Channels } from '../../shared/channels';
import type { PluginList, PluginManifest, PluginPackage, PluginRecommendation, PluginSettingsPatch, PluginSettingsView, PluginSummary } from '../../shared/plugins/format';
import { readPluginSettings, savePluginSettings } from '../plugins/settings';
import { pluginThemes } from '../plugins/themes';
import { reconcilePluginServers } from '../mcp-servers/registry';
import { secretStorageStatus } from '../secret-storage';
import { activePluginsDir, codeApprovalOf, getPluginInventory, pluginsAppVersion } from '../plugins/registry';
import { approvePluginCode, installPluginFromFolder, installPluginFromGit, installPluginFromZip, removePlugin, setPluginEnabled, type InstallOptions } from '../plugins/lifecycle';
import { codeApprovalQuestion } from '../plugins/code-approval';
import type { ExtensionDraftAction, ExtensionDraftActionResult } from '../../shared/extensions/drafts';
import { saveDraftToFolder, saveSkillDraft } from '../extensions/draft-apply';
import { reloadAndRegisterSkills } from '../skills/register';
import { rebuildMenu } from '../menu';
import { pendingExtensionDrafts } from './extension-draft-offers';
import { PLUGIN_ID } from '../plugins/manifest';
import { changePlugins } from '../plugins-apply';
import { closePluginSession, openPluginSession, sendPluginSessionEvent, setPluginSessionScope } from '../plugin-sessions';
import { PLUGIN_BLOCK_MAX_SOURCE, type PluginHostEvent, type PluginSessionTarget } from '../../shared/plugins/session';
import { handle } from './typed-ipc';
import { winFromEvent, withRootPath, withRootPathOr } from './helpers';
import { runPluginCommand } from '../plugin-commands';
import type { PluginCommandContext } from '../../shared/plugins/format';
import { pluginRecommendations } from '../plugins/recommendations';
import { corePlugin, corePluginEnabled, corePlugins, isCorePluginId, setCorePluginEnabled } from '../plugins/core';
import { confirmNative } from '../native-confirm';
import { setPluginProposalApplier } from '../llm/plugin-proposals';
import { pluginProposalApplierForApp } from '../plugin-proposal-applier';
import { describeCapabilities } from '../../shared/plugins/capabilities';
import { loadPluginRecords } from '../plugins/state';
import path from 'node:path';

export async function pluginList(): Promise<PluginList> {
  const [inv, records] = await Promise.all([getPluginInventory(), loadPluginRecords(activePluginsDir())]);
  return {
    core: corePlugins().map(({ manifest: m, ...def }): PluginSummary => ({
      id: m.id, name: m.name, version: m.version, description: m.description,
      enabled: corePluginEnabled(records, { manifest: m, ...def }),
      source: { kind: 'core' },
      ...(def.sample ? { sample: true } : {}),
      contributes: {},
      ...(m.code ? { capabilities: m.code.capabilities } : {}),
      ...(m.code?.views ? { views: m.code.views } : {}),
      ...(m.code?.blocks ? { blocks: m.code.blocks } : {}),
      ...(m.code?.commands ? { commands: m.code.commands } : {}),
      ...(m.code?.ingestors ? { ingestors: m.code.ingestors } : {}),
      ...(m.code?.exporters ? { exporters: m.code.exporters } : {}),
      ...(m.code?.inspections ? { inspections: m.code.inspections } : {}),
    })),
    installed: inv.installed.map(({ plugin, record }): PluginSummary => {
      const contributes: PluginSummary['contributes'] = {};
      for (const c of plugin.contributions) contributes[c.point] = (contributes[c.point] ?? 0) + 1;
      const m = plugin.manifest;
      // Its code waits for the user's approval (#2833): never given, or given for other files.
      const approval = codeApprovalOf(plugin, record);
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
        ...(m.code ? { capabilities: m.code.capabilities } : {}),
        // What its code adds (#2833), as for a built-in plugin's.
        ...(m.code?.views ? { views: m.code.views } : {}),
        ...(m.code?.blocks ? { blocks: m.code.blocks } : {}),
        ...(m.code?.commands ? { commands: m.code.commands } : {}),
        ...(m.code?.ingestors ? { ingestors: m.code.ingestors } : {}),
        ...(m.code?.exporters ? { exporters: m.code.exporters } : {}),
        ...(m.code?.inspections ? { inspections: m.code.inspections } : {}),
        ...(approval === 'needed' || approval === 'changed' ? { codeApproval: approval } : {}),
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
  install: (opts: InstallOptions) => Promise<PluginPackage | null>,
): Promise<{ id: string; name: string } | null> {
  const installed = await changePlugins(() => install({
    replace: async (id) => {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        message: `A plugin "${id}" is already installed.`,
        detail: 'Replace it with this one?',
        buttons: ['Replace', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      return response === 0;
    },
    // A plugin with code is allowed by main's own dialog, as the files it
    // ships (#2833), before it goes in.
    approveCode: async (plugin) => (await confirmNative(win, codeApprovalQuestion(plugin.manifest))).confirmed,
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
  // Approving an agent-written plugin's proposal installs it (#2890).
  setPluginProposalApplier(pluginProposalApplierForApp());

  handle(Channels.PLUGINS_LIST, () => pluginList());

  // Allow an installed plugin's code as its files are now (#2833): asked with
  // main's own dialog, showing what changed since it was last allowed.
  handle(Channels.PLUGINS_APPROVE_CODE, async (e, id: string) => {
    if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new Error(`"${String(id)}" isn't a plugin id.`);
    const found = (await getPluginInventory()).installed.find((i) => i.plugin.manifest.id === id);
    if (!found) throw new Error(`No plugin "${id}" is installed.`);
    const approval = codeApprovalOf(found.plugin, found.record);
    if (approval !== 'needed' && approval !== 'changed') return pluginList();
    const question = codeApprovalQuestion(found.plugin.manifest, found.record.codeApproved);
    if (!(await confirmNative(winFromEvent(e), question)).confirmed) return pluginList();
    await changePlugins(() => approvePluginCode(activePluginsDir(), id, found.plugin));
    return pluginList();
  });

  handle(Channels.PLUGINS_SET_ENABLED, async (e, id: string, enabled: boolean) => {
    const on = enabled === true;
    // A plugin whose code can run a program asks with main's own dialog
    // before it's turned on (#2821), built-in or not: the renderer can't draw
    // or answer it. Only built-in plugins may declare `process` (#2833).
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
    return installAsking(win, (opts) => installPluginFromFolder(activePluginsDir(), source, pluginsAppVersion(), opts));
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
    return installAsking(win, (opts) => installPluginFromZip(activePluginsDir(), archive, pluginsAppVersion(), opts));
  });

  // The URL is typed by the user; main parses it (HTTPS only, no
  // credentials) and never sends a credential with the fetch.
  handle(Channels.PLUGINS_INSTALL_GIT, async (e, spec: string) => {
    if (typeof spec !== 'string') throw new Error('Give the plugin\'s git URL.');
    return installAsking(winFromEvent(e), (opts) => installPluginFromGit(activePluginsDir(), spec, pluginsAppVersion(), opts));
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
        // A drafted plugin is a proposal, never installed from a card (#2890).
        return { ok: false, error: 'A drafted plugin is installed from its proposal, in the Proposals panel.' };
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

  // Plugin sessions (#2825): the host (this window) opens one for a plugin
  // frame and the notes its view was given — or, for a global view (#2640),
  // the view, whose query main runs; `plugin-sessions.ts` holds them.
  handle(Channels.PLUGINS_OPEN_SESSION, (e, pluginId: string, scope: string[], target?: PluginSessionTarget) => {
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) throw new Error(`"${String(pluginId)}" isn't a plugin id.`);
    return openPluginSession(winFromEvent(e), pluginId, stringList(scope), sessionTarget(target));
  });
  handle(Channels.PLUGINS_SET_SESSION_SCOPE, (e, sessionId: string, scope: string[]) => {
    setPluginSessionScope(winFromEvent(e), String(sessionId), stringList(scope));
  });
  // A plugin's command (#2643): what it runs on, from the renderer; what happens, decided in main.
  handle(Channels.PLUGINS_RUN_COMMAND, withRootPath((rootPath, pluginId: string, commandId: string, ctx: PluginCommandContext) => {
    if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) throw new Error(`"${String(pluginId)}" isn't a plugin id.`);
    const c = (ctx !== null && typeof ctx === 'object' ? ctx : {}) as Record<string, unknown>;
    return runPluginCommand(rootPath, pluginId, String(commandId), {
      ...(typeof c.note === 'string' ? { note: c.note } : {}),
      ...(typeof c.selection === 'string' ? { selection: c.selection } : {}),
    });
  }));
  handle(Channels.PLUGINS_CLOSE_SESSION, (e, sessionId: string) => {
    closePluginSession(winFromEvent(e), String(sessionId));
  });
  handle(Channels.PLUGINS_SESSION_EVENT, async (e, sessionId: string, event: PluginHostEvent) => {
    if (event === null || typeof event !== 'object' || !['theme', 'drop', 'view', 'exportRequest', 'preview', 'refreshQuery'].includes(event.kind)) {
      throw new Error('A plugin session event is a theme, a drop, a view, an export request, a preview or a query refresh.');
    }
    await sendPluginSessionEvent(winFromEvent(e), String(sessionId), event);
  });
}

/** What a session is opened for, as sent: a view's id, or a block with its note and text (#2640, #2641). */
function sessionTarget(raw: unknown): PluginSessionTarget | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('A session target is a view or a block.');
  const t = raw as Record<string, unknown>;
  if (t.view !== undefined) {
    if (typeof t.view !== 'string' || !PLUGIN_ID.test(t.view)) throw new Error(`${JSON.stringify(t.view)} isn't a view id.`);
    return { view: t.view };
  }
  if (typeof t.block !== 'string' || !PLUGIN_ID.test(t.block)) throw new Error(`${JSON.stringify(t.block)} isn't a block id.`);
  if (typeof t.notePath !== 'string' || t.notePath.length === 0 || t.notePath.length > 1024) throw new Error("A block's note must be a path.");
  if (typeof t.source !== 'string' || t.source.length > PLUGIN_BLOCK_MAX_SOURCE) throw new Error(`A block's text is at most ${PLUGIN_BLOCK_MAX_SOURCE} characters.`);
  return { block: t.block, notePath: t.notePath, source: t.source, exportMode: t.exportMode === true };
}

/** A scope as sent: an array of strings, anything else dropped. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}
