import { registerRule } from '../../registry';
import { ensureBlankLinesAroundRanges } from '../helpers';
import { findHorizontalRuleRanges } from './scanners';

interface Config {
  before: number;
  after: number;
}

registerRule<Config>({
  id: 'empty-line-around-horizontal-rules',
  category: 'spacing',
  title: 'Blank lines around horizontal rules',
  description:
    'Ensure a blank line on each side of every `---` / `***` / `___` horizontal rule.',
  defaultConfig: { before: 1, after: 1 },
  apply(content, config, cache) {
    const ranges = findHorizontalRuleRanges(content, cache);
    return ensureBlankLinesAroundRanges(content, ranges, {
      before: Math.max(0, Math.floor(config.before)),
      after: Math.max(0, Math.floor(config.after)),
    });
  },
});
