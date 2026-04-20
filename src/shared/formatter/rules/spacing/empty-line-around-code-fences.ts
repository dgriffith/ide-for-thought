import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'empty-line-around-code-fences',
  category: 'spacing',
  title: 'Blank lines around code fences',
  description:
    'Ensure a blank line on each side of every fenced code block.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    return ensureBlankLinesAroundRanges(content, cache.codeFenceRanges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});
