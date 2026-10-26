/**
 * Plugins an agent writes (#2890), as proposals. A plugin the assistant
 * drafts is filed as a `plugin_install` proposal, and an edit to an installed
 * one as `plugin_update`, diffed against its files; the review queue shows
 * the manifest, its capabilities in words, and every file. Approving
 * installs or writes it. A plugin with code then asks natively, as any
 * install does (#2833): a review-queue approval is the renderer's, and the
 * native dialog is the step a compromised renderer can't answer.
 *
 * The approval engine is Electron-free and doesn't reach `plugins/`, so what
 * installing means is the composition root's: `register-plugins.ts` sets the
 * applier. With none (the CLI, a test that didn't), an approval fails saying
 * so, and nothing is installed.
 */
import * as graph from '../graph/index';
import { proposeWrite } from './approval';
import { listProposals } from './proposal-persistence';
import { projectContext } from '../project-context-types';
import type { CheckedExtensionDraft } from '../extensions/draft-check';

export type { PluginFile, PluginProposalApplier } from './plugin-proposal-slot';
export { setPluginProposalApplier, pluginProposalApplier } from './plugin-proposal-slot';
import type { PluginFile } from './plugin-proposal-slot';

/**
 * File `draft` as a pending proposal in `rootPath`'s review queue: an
 * install, or, when `installed` holds the plugin's current files, an update
 * against them. One pending proposal per plugin. Answers what was filed.
 */
export async function fileDraftedPlugin(
  rootPath: string,
  conversationId: string,
  draft: CheckedExtensionDraft,
  installed: readonly PluginFile[] | null,
  model?: string,
): Promise<'install' | 'update'> {
  const ctx = projectContext(rootPath);
  const pending = (await listProposals(ctx, 'pending')).find((p) =>
    p.payloads.some((pl) => (pl.kind === 'plugin-install' || pl.kind === 'plugin-update') && pl.id === draft.id));
  if (pending) {
    throw new Error(`A proposal for the ${draft.id} plugin is already pending (filed ${pending.proposedAt}) in the Proposals panel. ` +
      'Don\'t file it again: tell the user it\'s waiting for review. To change it, the user rejects that one first.');
  }
  const by = model ? ` (drafted with ${model})` : '';
  const files = draft.files.map((f) => ({ path: f.path, content: f.content }));
  await graph.withLLMContext(() => proposeWrite(ctx, installed
    ? {
      operationType: 'plugin_update',
      payloads: [{ kind: 'plugin-update', id: draft.id, name: draft.name, files, before: installed.map((f) => ({ ...f })) }],
      note: `Change the ${draft.name} plugin: ${draft.summary}${by}`,
      conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
      proposedBy: `llm:conversation:${conversationId}`,
    }
    : {
      operationType: 'plugin_install',
      payloads: [{ kind: 'plugin-install', id: draft.id, name: draft.name, files }],
      note: `Install the ${draft.name} plugin: ${draft.summary}${by}`,
      conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
      proposedBy: `llm:conversation:${conversationId}`,
    }));
  return installed ? 'update' : 'install';
}
