import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';
import { findTableRanges } from './scanners';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'empty-line-around-tables',
  category: 'spacing',
  title: 'Blank lines around tables',
  description: 'Ensure a blank line on each side of every pipe table.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    const ranges = findTableRanges(content, cache);
    return ensureBlankLinesAroundRanges(content, ranges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});
