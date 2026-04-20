import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  width: number;
}

registerRule<Config>({
  id: 'convert-spaces-to-tabs',
  category: 'spacing',
  title: 'Convert leading spaces to tabs',
  description:
    'Collapse leading runs of spaces into tabs (width configurable, default 4). Only the leading indent is touched — spaces inside a line are left alone.',
  defaultConfig: { width: 4 },
  apply(content, config, cache) {
    const width = Math.max(1, Math.floor(config.width));
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/^[\t ]+/gm, (lead) => {
        // Expand any pre-existing tabs so we count the effective column correctly.
        const expanded = lead.replace(/\t/g, ' '.repeat(width));
        const tabs = Math.floor(expanded.length / width);
        const rem = expanded.length % width;
        return '\t'.repeat(tabs) + ' '.repeat(rem);
      }),
    );
  },
});
