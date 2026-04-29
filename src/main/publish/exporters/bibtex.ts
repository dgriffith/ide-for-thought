/**
 * BibTeX exporter (#115).
 *
 * Emits a single `.bib` file. Three scopes:
 *   - `project` — every source in the library
 *   - `single-note` — only ids cited from the active note
 *   - `folder` — union of citations across notes in the folder
 *
 * Citekeys come from the shared generator (`author-year-firstword`
 * with collision suffixes). LaTeX special characters get escaped per
 * BibTeX conventions; titles wrap in `{}` to protect proper-noun
 * casing from BibTeX's default downcasing.
 *
 * Round-trip with the BibTeX importer: the importer keys sources by
 * DOI > arXiv > ISBN > URL > content hash, not by citekey, so
 * exporting then re-importing recovers the same canonical source ids
 * within the limits of BibTeX's lossiness (we don't carry every
 * thought:* predicate, just the bibliographic core).
 */

import type { Exporter } from '../types';
import type { CslItem } from '../csl/source-to-csl';
import { assignCitekeys } from '../citekey';
import { scanCitations } from '../../bibliography/scan-citations';

export const bibtexExporter: Exporter = {
  id: 'bibtex',
  label: 'BibTeX (.bib)',
  acceptedKinds: ['project', 'folder', 'single-note'],
  accepts: (input) => input.kind !== 'tree',

  // eslint-disable-next-line @typescript-eslint/require-await
  async run(plan) {
    const citations = plan.citations;
    if (!citations) {
      return { files: [], summary: 'No citation data available — nothing to export.' };
    }

    // "Whole library" semantics: project scope dumps every known source
    // regardless of whether anything cites it. The note-driven scopes
    // (single-note, folder) intersect citations from those notes with
    // loaded sources.
    const items: CslItem[] = plan.inputKind === 'project'
      ? [...citations.items.values()]
      : [...collectCitedIds(plan, citations.excerpts)]
          .map((id) => citations.items.get(id))
          .filter((it): it is CslItem => Boolean(it));

    if (items.length === 0) {
      return {
        files: [],
        summary: 'No citations to export.',
      };
    }

    const keys = assignCitekeys(items);
    const lines: string[] = [];
    // Stable on-disk order: by citekey alphabetically. Re-runs produce
    // byte-identical .bib files, which is what users diff'ing in version
    // control actually want.
    const sorted = items
      .map((it) => ({ item: it, key: keys.get(it.id) ?? it.id }))
      .sort((a, b) => a.key.localeCompare(b.key));
    for (const { item, key } of sorted) {
      lines.push(formatBibtexEntry(key, item));
    }

    return {
      files: [{ path: 'bibliography.bib', contents: lines.join('\n\n') + '\n' }],
      summary: `Exported ${items.length} BibTeX ${items.length === 1 ? 'entry' : 'entries'}.`,
    };
  },
};

/**
 * Resolve which source ids should land in the export. For
 * project-scope plans, every loaded item is fair game. For
 * single-note / folder, walk the input notes for `[[cite::id]]` and
 * `[[quote::ex]]`, resolving quotes through the excerpts map.
 */
function collectCitedIds(
  plan: Parameters<Exporter['run']>[0],
  excerpts: Map<string, { sourceId: string; locator?: string }>,
): Set<string> {
  const cited = new Set<string>();
  if (plan.inputs.length === 0) {
    // Project-wide: caller handles, see the loop below.
  }
  for (const f of plan.inputs) {
    if (f.kind !== 'note') continue;
    for (const ref of scanCitations(f.content)) {
      if (ref.kind === 'cite') cited.add(ref.id);
      else {
        const ex = excerpts.get(ref.id);
        if (ex) cited.add(ex.sourceId);
      }
    }
  }
  // Project-wide-but-empty (no `note` inputs) shouldn't happen with
  // the current pipeline; the previous block handles single-note,
  // folder, and project (which carries every note) uniformly.
  return cited;
}

// ── BibTeX field formatting ────────────────────────────────────────────────

/**
 * Map CSL item types to BibTeX entry types. Choices follow the
 * traditional biblatex convention — `@article` for journal pieces,
 * `@incollection` for chapters, `@misc` as the catch-all.
 */
function bibtexEntryType(cslType: string): string {
  switch (cslType) {
    case 'article-journal':
    case 'article-magazine':
    case 'article-newspaper':
    case 'article':
      return 'article';
    case 'book':
      return 'book';
    case 'chapter':
      return 'incollection';
    case 'paper-conference':
      return 'inproceedings';
    case 'thesis':
      return 'phdthesis';
    case 'report':
      return 'techreport';
    case 'webpage':
      return 'misc';
    default:
      return 'misc';
  }
}

/**
 * Escape LaTeX special chars in a free-form string. The set is the
 * common "outside math mode" escapes; non-ASCII letters pass through
 * since modern BibTeX engines (biber/biblatex with utf8) handle them
 * natively, and the importer accepts utf8 too.
 */
function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_])/g, '\\$1')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/**
 * Format an author entry as `Family, Given` — biblatex's preferred
 * shape. Multiple authors join with ` and `. Institutional / literal
 * names wrap in `{}` so biblatex doesn't try to re-parse them.
 */
function formatAuthors(authors: NonNullable<CslItem['author']>): string {
  return authors
    .map((a) => {
      if (a.literal) return `{${escapeLatex(a.literal)}}`;
      const family = a.family ? escapeLatex(a.family) : '';
      const given = a.given ? escapeLatex(a.given) : '';
      const suffix = a.suffix ? `, ${escapeLatex(a.suffix)}` : '';
      if (family && given) return `${family}, ${given}${suffix}`;
      return family || given || '';
    })
    .filter((s) => s.length > 0)
    .join(' and ');
}

function formatBibtexEntry(key: string, item: CslItem): string {
  const fields: [string, string][] = [];

  if (item.author && item.author.length > 0) {
    fields.push(['author', formatAuthors(item.author)]);
  }
  if (item.title) {
    // Wrap in `{}` to protect casing from BibTeX's downcasing.
    fields.push(['title', `{${escapeLatex(item.title)}}`]);
  }
  const yr = item.issued?.['date-parts']?.[0]?.[0];
  if (yr) fields.push(['year', String(yr)]);

  // `container-title` plays a different field name depending on type.
  if (item['container-title']) {
    const journalLike = item.type === 'article-journal' || item.type === 'article'
      || item.type === 'article-magazine' || item.type === 'article-newspaper';
    fields.push([journalLike ? 'journal' : 'booktitle', escapeLatex(item['container-title'])]);
  }
  if (item.publisher) fields.push(['publisher', escapeLatex(item.publisher)]);
  if (item.volume) fields.push(['volume', escapeLatex(item.volume)]);
  if (item.issue) fields.push(['number', escapeLatex(item.issue)]);
  if (item.page) fields.push(['pages', escapeLatex(item.page)]);
  if (item.DOI) fields.push(['doi', item.DOI]);
  if (item.URL) fields.push(['url', item.URL]);
  if (item.abstract) fields.push(['abstract', escapeLatex(item.abstract)]);

  const entryType = bibtexEntryType(item.type);
  const body = fields
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(',\n');
  return `@${entryType}{${key},\n${body}\n}`;
}
