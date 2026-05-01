/**
 * Note-tree markdown zip exporter (#291).
 *
 * Packages a root note's wiki-link closure as a directory of clean
 * markdown files (each via the same rewrites as `note-markdown`) and
 * zips it into `<root-slug>-tree.zip`. Portable to a Hugo/Jekyll
 * site, a GitHub repo, or any markdown viewer that resolves relative
 * paths.
 *
 * Cross-links inside the bundle resolve to relative `.md` paths so
 * the zip browses naturally after extraction. Citations consolidate
 * into a single `references.md` at the bundle root via the same
 * `renderBibliographyFor` API the other tree exporters use (#300).
 */

import JSZip from 'jszip';
import { rewriteCitationsAndCleanup } from './note-markdown-shared';
import {
  buildLinkResolverContext,
  rewriteWikiLinksInContent,
} from '../link-resolver';
import type { Exporter, ExportPlan, ExportPlanFile } from '../types';

export const treeMarkdownExporter: Exporter = {
  id: 'tree-markdown',
  label: 'Note Tree as Markdown Zip',
  // Tree-only — same input shape as tree-html and tree-pdf.
  accepts: (input) => input.kind === 'tree',
  acceptedKinds: ['tree'],
  async run(plan) {
    const notes = plan.inputs.filter((f) => f.kind === 'note');
    if (notes.length === 0) {
      return { files: [], summary: 'Nothing to export in this tree.' };
    }
    const rootNote = notes[0];

    // Force follow-to-file so the link resolver emits `.md` cross-links.
    const bundlePlan: ExportPlan = { ...plan, linkPolicy: 'follow-to-file' };
    const ctx = buildLinkResolverContext(bundlePlan);

    const allCitedIds = new Set<string>();
    let isNoteStyle = false;
    const zip = new JSZip();

    for (const note of notes) {
      const renderer = bundlePlan.citations?.createRenderer({ outputFormat: 'text' });
      let content = note.content;
      // 1. Inline cite/quote → CSL prose; appends per-note Footnotes
      //    or References. The same single-note `note-markdown`
      //    pipeline does this; we share that helper.
      const cleaned = rewriteCitationsAndCleanup(content, renderer, bundlePlan.citations);
      // 2. Wiki-link rewrite — `[[other]]` → `[Title](other.md)`.
      content = rewriteWikiLinksInContent(cleaned, ctx);
      zip.file(note.relativePath, content);
      if (renderer) {
        for (const id of renderer.cited()) allCitedIds.add(id);
        if (renderer.isNoteStyle) isNoteStyle = true;
      }
    }

    // Consolidated `references.md` at the bundle root (#300 shape).
    if (allCitedIds.size > 0 && bundlePlan.citations) {
      const consolidator = bundlePlan.citations.createRenderer({ outputFormat: 'text' });
      const bib = consolidator.renderBibliographyFor([...allCitedIds]);
      if (bib.entries.length > 0) {
        const heading = isNoteStyle ? 'Bibliography' : 'References';
        const body = bib.entries.map((e) => `- ${e.trim()}`).join('\n');
        zip.file('references.md', `# ${heading}\n\n${body}\n`);
      }
    }

    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const zipName = `${slugify(rootNote.title || rootNote.relativePath)}-tree.zip`;
    const summary = `Bundle of ${notes.length} note${notes.length === 1 ? '' : 's'} packaged as ${zipName}.`;
    return {
      files: [{ path: zipName, contents: zipBytes }],
      summary,
    };
  },
};

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.md$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tree';
}

// Re-export the type so the exporter's `run` signature hangs together
// without an unused-import warning when JSZip's types tighten.
export type _Note = ExportPlanFile;
