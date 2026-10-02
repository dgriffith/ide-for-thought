/**
 * The preview's wiki-link resolver, for export renderers (#2514, #2526):
 * `resolveWikiLinkTargetWithIndex` over every note path and the alias map —
 * the same inputs App hands the preview — so a block resolves a link in an
 * export exactly as the preview did.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { flattenNotePaths } from '../app/text-helpers';
import { buildWikiLinkIndex, resolveWikiLinkTargetWithIndex } from '../../../shared/wiki-link-resolver';

export async function previewWikiResolver(): Promise<(target: string) => string | null> {
  const aliases = await api.graph.aliasEntries();
  const index = buildWikiLinkIndex(
    flattenNotePaths(getNotebaseStore().files).map((relativePath) => ({ relativePath, isDirectory: false })),
    Object.fromEntries(aliases.map((a) => [a.alias.toLowerCase(), a.relativePath])),
  );
  return (target) => resolveWikiLinkTargetWithIndex(target, index);
}
