import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'empty-line-around-blockquotes',
  category: 'spacing',
  title: 'Blank lines around blockquotes',
  description: 'Ensure a blank line on each side of every blockquote region.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    return ensureBlankLinesAroundRanges(content, cache.blockquoteRanges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});
