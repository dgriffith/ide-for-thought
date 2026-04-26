import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

const REF_RE = /(\[\^)([^\]\s]+)(\])(?!:)/g;
const DEF_RE = /^([ \t]*\[\^)([^\]\s]+)(\]:)/gm;

registerRule({
  id: 're-index-footnotes',
  category: 'footnote',
  title: 'Re-index footnotes',
  description:
    'Renumber numeric footnote references and definitions so they read 1, 2, 3, … in document order. Named footnotes (`[^foo]`) are preserved verbatim.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => reindex(seg));
  },
});

function reindex(seg: string): string {
  // First pass: collect numeric reference names in document order. Only
  // reference occurrences count — a definition that's never referenced
  // doesn't get a new number.
  const order: string[] = [];
  const seen = new Set<string>();
  let m;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(seg)) !== null) {
    const name = m[2];
    if (/^\d+$/.test(name) && !seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }
  if (order.length === 0) return seg;

  const mapping = new Map<string, string>();
  order.forEach((oldName, i) => mapping.set(oldName, String(i + 1)));

  const rewrittenRefs = seg.replace(REF_RE, (match: string, open: string, name: string, close: string) => {
    const next = mapping.get(name);
    return next ? `${open}${next}${close}` : match;
  });
  return rewrittenRefs.replace(DEF_RE, (match: string, open: string, name: string, close: string) => {
    const next = mapping.get(name);
    return next ? `${open}${next}${close}` : match;
  });
}
