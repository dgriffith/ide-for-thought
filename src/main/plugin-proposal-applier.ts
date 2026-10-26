/**
 * What approving an agent-written plugin's proposal does (#2890), wired by
 * `register-plugins.ts` into the approval engine's slot
 * (`llm/plugin-proposals.ts`): install it, or write an installed one's new
 * files, through `changePlugins` so the whole app picks it up. A plugin with
 * code asks natively first, as any install does (#2833); a "no" installs
 * nothing, and the approval fails saying so.
 */
import path from 'node:path';
import fs from 'node:fs';
import { BrowserWindow } from 'electron';
import { changePlugins } from './plugins-apply';
import { installPluginFromDraft, removePlugin } from './plugins/lifecycle';
import { activePluginsDir, pluginsAppVersion } from './plugins/registry';
import { readDraftFiles } from './plugins/draft-files';
import { codeApprovalQuestion } from './plugins/code-approval';
import { isCorePluginId } from './plugins/core';
import { confirmNative } from './native-confirm';
import { isPluginCapability, type PluginCapability } from '../shared/plugins/capabilities';
import type { PluginProposalApplier, PluginFile } from './llm/plugin-proposals';

/**
 * The capabilities an installed plugin's plugin.json declares: what a change
 * is shown against. It was checked when it was installed, so it parses.
 */
function declaredCapabilities(files: readonly PluginFile[]): PluginCapability[] {
  const manifest = JSON.parse(files.find((f) => f.path === 'plugin.json')?.content ?? '{}') as { code?: { capabilities?: unknown } };
  return Array.isArray(manifest.code?.capabilities) ? manifest.code.capabilities.filter((c): c is PluginCapability => typeof c === 'string' && isPluginCapability(c)) : [];
}

const sameFiles = (a: readonly PluginFile[], b: readonly PluginFile[]) =>
  a.length === b.length && [...a].sort((x, y) => x.path.localeCompare(y.path)).every((f, i) => {
    const g = [...b].sort((x, y) => x.path.localeCompare(y.path))[i]!;
    return f.path === g.path && f.content === g.content;
  });

export function pluginProposalApplierForApp(
  windowFor: () => BrowserWindow | null = () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
): PluginProposalApplier {
  const write = async (id: string, files: readonly PluginFile[], before: readonly PluginFile[] | null) => {
    if (isCorePluginId(id)) throw new Error(`"${id}" is one of Minerva's built-in plugins.`);
    let declined = false;
    const installed = await changePlugins(() => installPluginFromDraft(activePluginsDir(), files, pluginsAppVersion(), {
      ...(before ? { replace: (claimed: string) => Promise.resolve(claimed === id) } : {}),
      approveCode: async (plugin) => {
        const question = codeApprovalQuestion(plugin.manifest, before ? { capabilities: declaredCapabilities(before) } : undefined);
        const { confirmed } = await confirmNative(windowFor(), question);
        declined = !confirmed;
        return confirmed;
      },
    }));
    if (!installed) {
      throw new Error(declined
        ? `You didn't allow its code, so nothing was ${before ? 'written' : 'installed'}. The proposal is still pending.`
        : 'It wasn\'t installed.');
    }
    if (installed.manifest.id !== id) {
      await changePlugins(() => removePlugin(activePluginsDir(), installed.manifest.id));
      throw new Error(`Its plugin.json names "${installed.manifest.id}", not "${id}", so it was taken out again.`);
    }
  };
  return {
    install: (id, files) => write(id, files, null),
    update: async (id, files, before) => {
      const folder = path.join(activePluginsDir(), id);
      const now = fs.existsSync(folder) ? await readDraftFiles(folder) : null;
      if (!now || !sameFiles(now, before)) {
        throw new Error(`The ${id} plugin changed since this was proposed, so nothing was written. Reject this and ask for the change again.`);
      }
      await write(id, files, before);
    },
    remove: async (id) => { await changePlugins(() => removePlugin(activePluginsDir(), id)); },
  };
}
