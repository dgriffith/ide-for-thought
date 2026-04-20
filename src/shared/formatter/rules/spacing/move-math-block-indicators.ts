import { registerRule } from '../../registry';
import type { Range } from '../../types';

registerRule({
  id: 'move-math-block-indicators-to-their-own-line',
  category: 'spacing',
  title: 'Math-block markers on their own line',
  description:
    'Rewrite inline `$$…$$` math so the `$$` delimiters each sit on their own line. Inline `$…$` is left untouched.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    const spans: Range[] = cache.mathRanges
      .filter((r) => isInlineDoubleDollar(content, r))
      .sort((a, b) => b.start - a.start);
    if (spans.length === 0) return content;

    let out = content;
    for (const r of spans) {
      const inner = out.slice(r.start + 2, r.end - 2).trim();
      const atLineStart = r.start === 0 || out[r.start - 1] === '\n';
      const atLineEnd = r.end === out.length || out[r.end] === '\n';
      const lead = atLineStart ? '' : '\n';
      const trail = atLineEnd ? '' : '\n';
      const replacement = `${lead}$$\n${inner}\n$$${trail}`;
      out = out.slice(0, r.start) + replacement + out.slice(r.end);
    }
    return out;
  },
});

function isInlineDoubleDollar(content: string, r: Range): boolean {
  if (content.slice(r.start, r.start + 2) !== '$$') return false;
  if (content.slice(r.end - 2, r.end) !== '$$') return false;
  const span = content.slice(r.start, r.end);
  return !span.includes('\n');
}
