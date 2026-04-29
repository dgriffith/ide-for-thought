/**
 * Walk a note's content for `[[cite::id]]` and `[[quote::id]]` references
 * (#113). Returns the ids in document order; duplicates are preserved
 * because citation order matters for numeric styles like IEEE.
 */
import { WIKI_LINK_RE, parseWikiInner } from '../../shared/wiki-link';

export interface ScannedCitation {
  /** 'cite' → resolves directly to a source id; 'quote' → excerpt id. */
  kind: 'cite' | 'quote';
  id: string;
}

export function scanCitations(content: string): ScannedCitation[] {
  // Don't pick up citations inside the bibliography block we ourselves
  // emit — otherwise the rendered References section would re-cite
  // every entry on the next run.
  const stripped = content.replace(
    /<!-- minerva:bibliography -->[\s\S]*?<!-- \/minerva:bibliography -->/g,
    '',
  );
  const out: ScannedCitation[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_LINK_RE.exec(stripped)) !== null) {
    const parsed = parseWikiInner(m[1]);
    if (parsed.type !== 'cite' && parsed.type !== 'quote') continue;
    const id = parsed.target.trim();
    if (!id) continue;
    out.push({ kind: parsed.type, id });
  }
  WIKI_LINK_RE.lastIndex = 0;
  return out;
}
