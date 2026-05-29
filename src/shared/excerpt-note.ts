/**
 * Pure builders for the Excerpt → Note flow (#101).
 *
 * Two surfaces: a brand-new note pre-filled with the quoted passage
 * (`buildExcerptNoteContent`), and an append-to-current-note block
 * for the inline reference flow (`buildExcerptAppendBlock`). Both
 * are pure so the renderer can use them directly and tests don't
 * need IPC.
 */

import type { SourceExcerpt, SourceMetadata } from './types';
import { displaySourceTitle } from './source-display';

export interface ExcerptNoteParams {
  sourceId: string;
  /** Excerpt the note is being built from. `citedText` is the only
   *  field required; everything else is optional and shapes the
   *  rendered output. */
  excerpt: Pick<SourceExcerpt, 'excerptId' | 'citedText' | 'page' | 'pageRange' | 'locationText'>;
  /** Source metadata so the H1 can read "Note on <displayTitle>"
   *  rather than "Note on <sourceId>". Optional — when omitted the
   *  builder falls back to the sourceId. */
  source?: Pick<SourceMetadata, 'title' | 'uri' | 'doi'>;
  /** When set, used verbatim as the suggested H1 / filename stem
   *  (the caller has already prompted the user). */
  titleOverride?: string;
}

export interface BuiltNote {
  /** Full markdown body — frontmatter + heading + blockquote + commentary slot. */
  content: string;
  /** Suggested title (matches the H1) — caller uses this as the
   *  filename suggestion when prompting. */
  suggestedTitle: string;
}

/** Render the cited text as a markdown blockquote, preserving line
 *  breaks in the original. Empty lines inside the quote get the
 *  leading `>` too so the rendered block stays a single quote
 *  rather than splitting at the first blank line. */
function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line ? `> ${line}` : '>'))
    .join('\n');
}

function defaultTitle(params: ExcerptNoteParams): string {
  if (params.titleOverride) return params.titleOverride;
  const display = params.source ? displaySourceTitle(params.source) : params.sourceId;
  return `Note on ${display}`;
}

export function buildExcerptNoteContent(params: ExcerptNoteParams): BuiltNote {
  const { sourceId, excerpt } = params;
  const title = defaultTitle(params);
  const cited = (excerpt.citedText ?? '').trim();

  const frontmatter: string[] = [
    '---',
    `about: [[sources/${sourceId}]]`,
    `quotes: [[quote::${excerpt.excerptId}]]`,
    '---',
    '',
  ];

  const body: string[] = [`# ${title}`, ''];
  if (cited) {
    body.push(blockquote(cited));
    body.push('');
  }
  // Page hint sits under the quote so the reader can see where in
  // the source it came from without opening the excerpt detail.
  const loc = excerptLocationHint(excerpt);
  if (loc) {
    body.push(`*${loc}*`);
    body.push('');
  }
  body.push('## Commentary', '');

  return {
    content: frontmatter.join('\n') + body.join('\n'),
    suggestedTitle: title,
  };
}

/**
 * Append form: appends to an existing note. No frontmatter, no
 * heading — just the quoted passage followed by a `[[quote::id]]`
 * link the reader can click to jump back to the excerpt detail.
 * The leading double-newline ensures a clean separation from
 * whatever ended the existing buffer.
 */
export function buildExcerptAppendBlock(
  excerpt: Pick<SourceExcerpt, 'excerptId' | 'citedText' | 'page' | 'pageRange' | 'locationText'>,
): string {
  const cited = (excerpt.citedText ?? '').trim();
  const lines: string[] = [];
  if (cited) lines.push(blockquote(cited));
  const loc = excerptLocationHint(excerpt);
  if (loc) lines.push(`— [[quote::${excerpt.excerptId}]] · ${loc}`);
  else lines.push(`— [[quote::${excerpt.excerptId}]]`);
  return '\n\n' + lines.join('\n') + '\n';
}

function excerptLocationHint(
  e: Pick<SourceExcerpt, 'page' | 'pageRange' | 'locationText'>,
): string {
  if (e.pageRange) return `pp. ${e.pageRange}`;
  if (e.page) return `p. ${e.page}`;
  if (e.locationText) return e.locationText;
  return '';
}
