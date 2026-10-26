/**
 * `llm.propose`'s real I/O (#2858): the windows, the native allow, the
 * user's model, and the approval engine. The rules are
 * `plugin-llm-propose.ts`'s.
 */
import { complete } from './llm/index';
import * as approval from './llm/approval';
import * as graph from './graph/index';
import * as notebaseFs from './notebase/fs';
import { confirmNative } from './native-confirm';
import { windowsForProject } from './window-manager';
import { projectContext } from './project-context-types';
import { activePluginsDir } from './plugins/registry';
import { loadPluginRecords, updatePluginRecords } from './plugins/state';
import type { PluginIdentity } from './plugins/broker';
import type { PluginLlmDeps } from './plugin-llm-propose';
import type { TurnUsage } from '../shared/conversation';

/** Allowed this run for a plugin with no record to keep the answer in (a built-in one). */
const allowedThisRun = new Set<string>();

/** The question, in main's own dialog: the plugin can't draw or answer it. */
export function llmAllowQuestion(identity: PluginIdentity): { message: string; detail: string; confirmLabel: string } {
  return {
    message: `Let ${identity.name} ask the assistant?`,
    detail: `${identity.name} ${identity.version} wants to ask the assistant for changes to notes it shows you. It uses your model and API key, so it costs what a conversation does.\n\nNothing changes until you approve it: everything it suggests is filed as a proposal for you to review. You can turn the plugin off in Settings → Plugins.`,
    confirmLabel: 'Allow',
  };
}

async function allow(identity: PluginIdentity, rootPath: string): Promise<boolean> {
  const key = `${identity.id}@${identity.version}`;
  if (allowedThisRun.has(key)) return true;
  const dir = activePluginsDir();
  const records = await loadPluginRecords(dir);
  if (records[identity.id]?.llmAllowed === identity.version) return true;
  const { confirmed } = await confirmNative(windowsForProject(rootPath)[0] ?? null, llmAllowQuestion(identity));
  if (!confirmed) return false;
  if (Object.hasOwn(records, identity.id)) {
    await updatePluginRecords(dir, (r) => { if (r[identity.id]) r[identity.id]!.llmAllowed = identity.version; });
  } else {
    allowedThisRun.add(key);
  }
  return true;
}

/** `pathRefusal` is the broker's, in words. */
export function pluginLlmDeps(pathRefusal: PluginLlmDeps['pathRefusal']): PluginLlmDeps {
  return {
    hasWindow: (rootPath) => windowsForProject(rootPath).length > 0,
    allow,
    complete: async (system, user) => {
      let usage: TurnUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
      let model = '';
      const text = await complete(user, { system, onUsage: (u, m) => { usage = u; model = m; } });
      return { text, usage, model };
    },
    noteExists: (rootPath, rel) => notebaseFs.fileExists(rootPath, rel),
    pathRefusal,
    file: async (rootPath, write) => {
      await graph.withLLMContext(() => approval.proposeWrite(projectContext(rootPath), write));
    },
    now: () => Date.now(),
  };
}
