/**
 * What approving an agent-written plugin's proposal does (#2890): the
 * composition root's, set by `register-plugins.ts`. A slot with no imports,
 * so the approval engine's apply step can reach it without a cycle through
 * `plugin-proposals.ts`, which files through the engine.
 */
export type PluginFile = { path: string; content: string };

export interface PluginProposalApplier {
  /** Install a new plugin from `files`. Rejects when it can't, or the user doesn't allow its code. */
  install(id: string, files: readonly PluginFile[]): Promise<void>;
  /** Replace an installed plugin's files with `files`, if they're still `before`. */
  update(id: string, files: readonly PluginFile[], before: readonly PluginFile[]): Promise<void>;
  /** Undo an install. */
  remove(id: string): Promise<void>;
}

let applier: PluginProposalApplier | null = null;

export function setPluginProposalApplier(next: PluginProposalApplier | null): void {
  applier = next;
}

export function pluginProposalApplier(): PluginProposalApplier {
  if (!applier) throw new Error('Plugins can only be installed from a proposal in the Minerva app.');
  return applier;
}

