import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  width: number;
}

registerRule<Config>({
  id: 'convert-tabs-to-spaces',
  category: 'spacing',
  title: 'Convert leading tabs to spaces',
  description:
    'Replace tab characters in leading indentation with a configurable number of spaces (default 4).',
  defaultConfig: { width: 4 },
  apply(content, config, cache) {
    const width = Math.max(1, Math.floor(config.width));
    const spaces = ' '.repeat(width);
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/^[\t ]*/gm, (lead) => lead.replace(/\t/g, spaces)),
    );
  },
});
