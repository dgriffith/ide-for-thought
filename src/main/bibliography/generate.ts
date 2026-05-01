/**
 * Bibliography generator (#113) — "Insert/Update Bibliography" command.
 *
 * Scans the active note for `[[cite::id]]` / `[[quote::id]]`, runs each
 * through the project's CSL renderer to register the cited ids, asks
 * citeproc-js for the bibliography entries, converts the HTML output
 * to markdown, and writes a `## References` section bracketed by HTML
 * comment markers. The markers are the only thing the command "owns"
 * across runs — the heading text, position, and prose around it are
 * the user's, so renaming the heading or adding text after the section
 * doesn't break idempotency.
 */
import { loadCitationAssets } from '../publish/csl';
import { citeprocEntryToMarkdown } from './citeproc-to-markdown';
import { scanCitations } from './scan-citations';
import { getBibliographyStyleId } from '../project-config';

export const BIBLIOGRAPHY_OPEN_MARKER = '<!-- minerva:bibliography -->';
export const BIBLIOGRAPHY_CLOSE_MARKER = '<!-- /minerva:bibliography -->';
export const BIBLIOGRAPHY_DEFAULT_HEADING = '## References';

/**
 * Match an existing References block — the heading we may have written
 * plus the marker pair plus any leading/trailing whitespace, so that
 * stripping it leaves clean content we can append a fresh block to.
 * Crucially the heading line is optional, since the user is free to
 * rename `## References` to anything they like; the markers are the
 * idempotency anchor.
 */
const BLOCK_RE = new RegExp(
  `\\n*` +
  `(?:## [^\\n]*\\n+)?` +
  `${BIBLIOGRAPHY_OPEN_MARKER}` +
  `[\\s\\S]*?` +
  `${BIBLIOGRAPHY_CLOSE_MARKER}` +
  `\\n*`,
);

export interface GenerateBibliographyResult {
  /** Number of bibliography entries actually rendered. */
  entriesCount: number;
  /** Cited ids citeproc couldn't find — surfaced so the UI can warn. */
  missingIds: string[];
  /** True when the note's content was modified and re-saved. */
  changed: boolean;
  /** New content; the caller persists it through the write pipeline. */
  content: string;
  /** Style id actually used (after fall-back). */
  styleId: string;
}

/**
 * Pure function — given a note's content and the loaded citation
 * assets, returns the new content with a fresh References section
 * (or the unchanged content if nothing needs writing). Callers handle
 * the actual file write so this stays testable without disk I/O.
 */
export function buildBibliographySection(
  content: string,
  assets: Awaited<ReturnType<typeof loadCitationAssets>>,
): { content: string; entriesCount: number; missingIds: string[]; changed: boolean } {
  const renderer = assets.createRenderer();
  const scanned = scanCitations(content);

  // Register every cited id so citeproc tracks it for the bibliography.
  // Quotes resolve through the excerpt → source map first.
  for (const ref of scanned) {
    if (ref.kind === 'quote') {
      const ex = assets.excerpts.get(ref.id);
      if (ex) renderer.renderCitation(ex.sourceId, ex.locator);
      else void renderer.renderCitation(ref.id); // surfaces as missing
    } else {
      void renderer.renderCitation(ref.id);
    }
  }

  const bib = renderer.renderBibliography();
  const entries = bib.entries.map(citeprocEntryToMarkdown).filter((e) => e.length > 0);
  const missingIds = [...renderer.missing()];

  // Unified flow: strip any existing block, then append a fresh one if
  // there are entries to write. This is what makes re-runs idempotent —
  // the strip + append always produces the same output for the same
  // input citations, regardless of how many times we've run before.
  const stripped = content.replace(BLOCK_RE, '\n').replace(/\s+$/, '');
  const next = entries.length === 0
    ? (stripped.length === 0 ? '' : `${stripped}\n`)
    : `${stripped}\n\n${renderBlock(entries)}\n`;

  return {
    content: next,
    entriesCount: entries.length,
    missingIds,
    changed: next !== content,
  };
}

function renderBlock(entries: string[]): string {
  const body = entries.join('\n\n');
  return [
    BIBLIOGRAPHY_DEFAULT_HEADING,
    '',
    BIBLIOGRAPHY_OPEN_MARKER,
    '',
    body,
    '',
    BIBLIOGRAPHY_CLOSE_MARKER,
  ].join('\n');
}

/**
 * IPC entry point. Loads project assets keyed to the configured style,
 * builds the new content, returns the result. The caller owns persistence.
 */
export async function generateBibliography(
  rootPath: string,
  noteContent: string,
): Promise<GenerateBibliographyResult> {
  const styleId = getBibliographyStyleId(rootPath) ?? undefined;
  const assets = await loadCitationAssets(rootPath, { styleId });
  const { content, entriesCount, missingIds, changed } = buildBibliographySection(
    noteContent,
    assets,
  );
  // `loadCitationAssets` already falls back to APA when styleId is
  // unknown; surface what was actually used so the UI can confirm.
  return { content, entriesCount, missingIds, changed, styleId: assets.styleId };
}
