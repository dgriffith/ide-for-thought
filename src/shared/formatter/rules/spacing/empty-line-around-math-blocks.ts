import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';
import type { Range } from '../../types';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'empty-line-around-math-blocks',
  category: 'spacing',
  title: 'Blank lines around math blocks',
  description:
    'Ensure a blank line on each side of every standalone $$…$$ math block. Inline $…$ math is left alone.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    // Normalise math ranges to the line-terminated convention the helper
    // expects — parse-cache's math matcher stops at the closing `$$`, so we
    // swallow the trailing newline here.
    const blockMathRanges = cache.mathRanges
      .filter((r) => isBlockMath(content, r))
      .map((r) => ({
        start: r.start,
        end: r.end < content.length && content[r.end] === '\n' ? r.end + 1 : r.end,
      }));
    return ensureBlankLinesAroundRanges(content, blockMathRanges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});

function isBlockMath(content: string, r: Range): boolean {
  if (content.slice(r.start, r.start + 2) !== '$$') return false;
  const startsAtLine = r.start === 0 || content[r.start - 1] === '\n';
  const endsAtLine = r.end === content.length || content[r.end] === '\n';
  return startsAtLine && endsAtLine;
}
