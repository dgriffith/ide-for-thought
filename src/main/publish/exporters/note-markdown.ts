/**
 * Clean-markdown exporter (#250).
 *
 * The "paste anywhere" exporter. Rewrites wiki-links via the plan's
 * linkPolicy, replaces `[[cite::id]]` / `[[quote::id]]` with
 * CSL-rendered prose, drops embedded Turtle blocks (not portable),
 * and appends a `## References` (or footnote bodies for note-class
 * styles) at the bottom of the file.
 *
 * Diverges from the passthrough `markdown` exporter: that one is for
 * Minerva-internal use and preserves `[[cite::]]` syntax; this one
 * produces output that renders correctly on GitHub, Substack, Hugo,
 * and the wider markdown ecosystem outside Minerva.
 *
 * Shares its body-rewriting logic with `tree-markdown` via
 * `note-markdown-shared.ts` (#291).
 *
 * Deferred to follow-up tickets:
 *   - copy-to-dir / inline-base64 image asset policies
 *   - Hugo-flavoured frontmatter remapping
 *   - preview-dialog warnings about dropped turtle blocks / executable cells
 */

import {
  buildLinkResolverContext,
  rewriteWikiLinksInContent,
  type LinkResolverContext,
} from '../link-resolver';
import {
  rewriteCitations,
  stripTurtleBlocks,
  appendFootnoteDefs,
  appendReferencesSection,
} from './note-markdown-shared';
import type { Exporter, ExportPlan } from '../types';
import type { CitationRenderer } from '../csl';

export const noteMarkdownExporter: Exporter = {
  id: 'note-markdown',
  label: 'Note as Clean Markdown',
  // Single-note + folder + project; tree mode belongs to a future
  // bundle-shaped markdown exporter (`#291`).
  accepts: (input) => input.kind !== 'tree' && input.kind !== 'source',
  acceptedKinds: ['single-note', 'folder', 'project'],
  // eslint-disable-next-line @typescript-eslint/require-await
  async run(plan) {
    const ctx = buildLinkResolverContext(plan);
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    // Single-note scope: drop the directory structure so a note at
    // `notes/foo/bar.md` exported to `~/Desktop` lands as
    // `~/Desktop/bar.md`. Multi-note keeps the source tree so
    // `follow-to-file` cross-links still resolve.
    const flatten = notes.length === 1;
    const files = notes.map((f) => {
      // Each note gets its own renderer — citeproc tracks citation
      // ordering on the engine, so a per-note instance gives each
      // page its own References section.
      const renderer = plan.citations?.createRenderer({ outputFormat: 'text' });
      const transformed = transformNoteBody(f.content, ctx, renderer, plan.citations);
      const withTail = renderer ? appendCitationsTail(transformed, renderer) : transformed;
      return {
        path: flatten ? basename(f.relativePath) : f.relativePath,
        contents: withTail,
      };
    });
    const dropped = plan.excluded.length;
    const summary = files.length === 1
      ? `Exported "${plan.inputs[0]?.title ?? 'note'}" as clean markdown.`
      : `${files.length} note${files.length === 1 ? '' : 's'} exported as clean markdown${dropped > 0 ? ` (${dropped} excluded)` : ''}.`;
    return { files, summary };
  },
};

/**
 * Rewrite citations → prose; rewrite wiki-links per the plan's
 * linkPolicy; strip embedded turtle blocks. Order matters: citation
 * rewrite first (sees raw `[[cite::]]`), then wiki-link rewrite
 * (deliberately skips cite/quote tokens), then turtle strip last.
 */
function transformNoteBody(
  content: string,
  ctx: LinkResolverContext,
  renderer: CitationRenderer | undefined,
  citations: ExportPlan['citations'],
): string {
  let out = content;
  if (renderer && citations) {
    out = rewriteCitations(out, renderer, citations);
  }
  out = rewriteWikiLinksInContent(out, ctx);
  out = stripTurtleBlocks(out);
  return out;
}

/**
 * Per-note tail: footnote defs for note styles, `## References` for
 * in-text. Empty when no citations fired.
 */
function appendCitationsTail(body: string, renderer: CitationRenderer): string {
  return renderer.isNoteStyle
    ? appendFootnoteDefs(body, renderer)
    : appendReferencesSection(body, renderer);
}

function basename(relativePath: string): string {
  return relativePath.split('/').pop() ?? relativePath;
}
