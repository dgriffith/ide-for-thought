/**
 * Pandoc exporter (#114).
 *
 * Single-note scope only. Emits three files into a fresh export
 * folder:
 *   - `<note-stem>.md` — the note's content with `[[cite::id]]`
 *     rewritten as `[@citekey]` and `[[quote::ex]]` rewritten as
 *     `[@citekey, p. NN]` (or just `[@citekey]` when the excerpt has
 *     no locator). Plain wiki-links go through the standard
 *     link-resolver per the plan's linkPolicy.
 *   - `bibliography.json` — CSL JSON of the items the note actually
 *     cites. Pandoc only emits entries that are referenced anyway,
 *     but trimming to cited items keeps the file small.
 *   - `README.md` — example pandoc command lines for PDF / DOCX /
 *     HTML so the user doesn't have to look them up.
 *
 * Single-note is the natural unit for pandoc — one input document,
 * one output. Multi-note exports tend to want chapter structure and
 * cross-references that pandoc doesn't synthesize automatically.
 */

import path from 'node:path';
import type { Exporter } from '../types';
import type { CslItem } from '../csl/source-to-csl';
import { assignCitekeys } from '../citekey';
import { scanCitations } from '../../bibliography/scan-citations';
import { buildLinkResolverContext, rewriteWikiLinksInContent } from '../link-resolver';

export const pandocExporter: Exporter = {
  id: 'pandoc',
  label: 'Pandoc (Markdown + CSL JSON)',
  // Pandoc is fundamentally per-document; folder/project would just
  // concatenate naively without the chapter structure most users
  // actually want. Keep the surface honest.
  acceptedKinds: ['single-note'],
  accepts: (input) => input.kind === 'single-note',

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(plan) {
    const note = plan.inputs.find((f) => f.kind === 'note');
    if (!note) {
      return { files: [], summary: 'No note to export.' };
    }

    const citations = plan.citations;
    if (!citations) {
      return { files: [], summary: 'No citation data available — nothing to export.' };
    }

    // Walk the note for cite/quote references in document order. Track
    // which sources actually got cited so the bibliography only carries
    // what's referenced.
    const refs = scanCitations(note.content);
    const citedSourceIds = new Set<string>();
    for (const ref of refs) {
      if (ref.kind === 'cite') {
        if (citations.items.has(ref.id)) citedSourceIds.add(ref.id);
      } else {
        const ex = citations.excerpts.get(ref.id);
        if (ex && citations.items.has(ex.sourceId)) citedSourceIds.add(ex.sourceId);
      }
    }
    const citedItems = [...citedSourceIds]
      .map((id) => citations.items.get(id))
      .filter((it): it is CslItem => Boolean(it));
    const keys = assignCitekeys(citedItems);

    // First pass: standard wiki-link rewrites for non-cite/quote links.
    // The link-resolver leaves `[[cite::]]` and `[[quote::]]` alone, so
    // we can do a second pass for those.
    const linkCtx = buildLinkResolverContext(plan);
    let body = rewriteWikiLinksInContent(note.content, linkCtx);
    body = rewriteCitations(body, citations.excerpts, keys);

    const noteStem = path.basename(note.relativePath).replace(/\.md$/i, '');
    const mdName = `${noteStem || 'note'}.md`;

    return {
      files: [
        { path: mdName, contents: body },
        {
          path: 'bibliography.json',
          contents: JSON.stringify(toCslJson(citedItems, keys), null, 2),
        },
        { path: 'README.md', contents: buildReadme(mdName) },
      ],
      summary: `Exported ${mdName} with ${citedItems.length} citation${citedItems.length === 1 ? '' : 's'}.`,
    };
  },
};

/**
 * Replace `[[cite::id]]` with `[@citekey]` and `[[quote::ex]]` with
 * `[@citekey, p. NN]` (locator from the excerpt when present). Unknown
 * ids fall through to a Pandoc-style missing reference (`[@id?]`) so
 * pandoc's own citation-resolution warning surfaces them.
 */
function rewriteCitations(
  content: string,
  excerpts: Map<string, { sourceId: string; locator?: string }>,
  keys: Map<string, string>,
): string {
  return content.replace(/\[\[(cite|quote)::([^\]|]+?)(?:\|[^\]]+?)?\]\]/g, (full, kind: string, idRaw: string) => {
    const id = idRaw.trim();
    if (kind === 'quote') {
      const ex = excerpts.get(id);
      if (!ex) return full;
      const key = keys.get(ex.sourceId);
      if (!key) return full;
      const locator = formatLocator(ex.locator);
      return locator ? `[@${key}, ${locator}]` : `[@${key}]`;
    }
    const key = keys.get(id);
    return key ? `[@${key}]` : full;
  });
}

/**
 * CSL locators in our excerpts come in as opaque strings ("12",
 * "12-15", "ch. 4"). Pandoc's citation syntax wants `p. 12`, `pp. 12-15`,
 * etc. Best-effort guess: numeric → page; otherwise pass through.
 */
function formatLocator(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return `p. ${trimmed}`;
  if (/^\d+\s*[-–]\s*\d+$/.test(trimmed)) return `pp. ${trimmed.replace(/\s/g, '')}`;
  return trimmed;
}

/**
 * CSL JSON is just an array of CSL items (citeproc-js consumes it
 * directly). Substitute the assigned citekey for each item's `id`
 * field — that's what pandoc's `[@key]` syntax matches against.
 */
function toCslJson(items: CslItem[], keys: Map<string, string>): CslItem[] {
  return items.map((it) => ({
    ...it,
    id: keys.get(it.id) ?? it.id,
  }));
}

function buildReadme(mdName: string): string {
  return [
    '# Pandoc export',
    '',
    'This folder is ready for `pandoc`. Run one of the commands below to',
    `produce a polished document from \`${mdName}\` plus`,
    '`bibliography.json`. `--citeproc` resolves the `[@key]` markers',
    'against the bibliography; pick a CSL style with `--csl=path/to/style.csl`',
    'if you want output in something other than Chicago author-date',
    "(pandoc's default).",
    '',
    '## PDF (via LaTeX)',
    '',
    '```',
    `pandoc ${mdName} --bibliography=bibliography.json --citeproc -o output.pdf`,
    '```',
    '',
    '## Word (.docx)',
    '',
    '```',
    `pandoc ${mdName} --bibliography=bibliography.json --citeproc -o output.docx`,
    '```',
    '',
    '## HTML (standalone)',
    '',
    '```',
    `pandoc ${mdName} --bibliography=bibliography.json --citeproc -s -o output.html`,
    '```',
    '',
  ].join('\n');
}
