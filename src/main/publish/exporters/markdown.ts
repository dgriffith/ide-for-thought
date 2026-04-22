/**
 * Markdown passthrough exporter (#246).
 *
 * The minimal end-to-end exporter — proves the pipeline works. Emits
 * every included note as its own `.md` file under the output dir, with
 * wiki-links rewritten according to the plan's `linkPolicy`. Frontmatter
 * passes through verbatim so downstream tools see the same YAML the
 * user authored.
 *
 * HTML / PDF / tree / site exporters will follow the same shape: take a
 * plan, run `rewriteWikiLinksInContent`, transform the body further if
 * needed, emit files. This one is the template.
 */

import {
  buildLinkResolverContext,
  rewriteWikiLinksInContent,
} from '../link-resolver';
import type { Exporter } from '../types';

export const markdownExporter: Exporter = {
  id: 'markdown',
  label: 'Markdown (passthrough)',
  accepts: () => true,
  async run(plan) {
    const ctx = buildLinkResolverContext(plan);
    const files = plan.inputs
      .filter((f) => f.kind === 'note')
      .map((f) => ({
        path: f.relativePath,
        contents: rewriteWikiLinksInContent(f.content, ctx),
      }));
    const dropped = plan.excluded.length;
    const summary = dropped > 0
      ? `${files.length} note${files.length === 1 ? '' : 's'} exported (${dropped} excluded).`
      : `${files.length} note${files.length === 1 ? '' : 's'} exported.`;
    return { files, summary };
  },
};
