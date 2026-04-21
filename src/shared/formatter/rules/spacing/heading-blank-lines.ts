import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';
import { findHeadingRanges } from './scanners';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'heading-blank-lines',
  category: 'spacing',
  title: 'Blank lines around headings',
  description:
    'Ensure a configurable number of blank lines before and after every ATX heading.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    const ranges = findHeadingRanges(content, cache);
    return ensureBlankLinesAroundRanges(content, ranges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});
