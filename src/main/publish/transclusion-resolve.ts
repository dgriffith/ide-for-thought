/**
 * Export-side transclusion resolution (#906).
 *
 * The Preview hydrates `![[note]]` embeds live in the DOM; an exported HTML
 * file has no such runtime, so we inline the embedded content into the
 * markdown *before* it's rendered. The result is a single self-contained
 * artifact — the whole point of the note-html exporter.
 *
 * Resolution is against the export's own note set (`plan.inputs`): every
 * note's content is already in memory, and inlining a note that isn't part
 * of the export would defeat the "self-contained" guarantee, so an embed
 * pointing outside the set degrades to a visible italic notice. Only the
 * block form (`![[…]]` alone on a line) is resolved — the same shape the
 * Preview embeds — so a mid-sentence `![[x]]` is left for the wiki-link rule.
 */

import { parseTransclusionTarget, sliceTransclusion } from '../../shared/transclusion';
import { resolveWikiLinkTarget } from '../../shared/wiki-link-resolver';
import type { ExportPlanFile } from './types';

const EMBED_LINE_RE = /^[ \t]*!\[\[([^\]]+?)\]\][ \t]*$/gm;
const MAX_DEPTH = 5;

/**
 * Replace each block-level `![[target]]` in `markdown` with the embedded
 * note's (sliced) content, recursively. `fromPath` seeds the loop-detection
 * chain so a note embedding itself is caught.
 */
export function resolveTransclusions(
  markdown: string,
  fromPath: string,
  inputs: ExportPlanFile[],
): string {
  const notes = inputs.filter((f) => f.kind === 'note');
  const fileList = notes.map((f) => ({ relativePath: f.relativePath, isDirectory: false }));
  const contentByPath = new Map(notes.map((f) => [f.relativePath, f.content]));

  const expand = (md: string, chain: string[]): string =>
    md.replace(EMBED_LINE_RE, (_whole, inner: string) => {
      const target = parseTransclusionTarget(inner.trim());
      const rel = resolveWikiLinkTarget(target.path, fileList);
      if (!rel) return `*(embedded note “${target.path}” not found)*`;
      if (chain.includes(rel)) return `*(transclusion loop: ${target.path})*`;
      if (chain.length > MAX_DEPTH) return `*(transclusion nested too deep)*`;
      const content = contentByPath.get(rel);
      if (content === undefined) return `*(embedded note “${target.path}” not included in export)*`;
      const slice = sliceTransclusion(content, target);
      if (!slice.ok) return `*(${slice.reason})*`;
      return expand(slice.text, [...chain, rel]);
    });

  return expand(markdown, [fromPath]);
}
