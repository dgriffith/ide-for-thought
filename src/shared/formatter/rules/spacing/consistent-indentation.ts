import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  style: 'tabs' | 'spaces';
  width: number;
}

registerRule<Config>({
  id: 'consistent-indentation',
  category: 'spacing',
  title: 'Consistent indentation',
  description:
    'Normalise leading indentation to either tabs or spaces. Only the leading indent of each line is touched — whitespace within a line is left alone.',
  defaultConfig: { style: 'spaces', width: 4 },
  apply(content, config, cache) {
    const width = Math.max(1, Math.floor(config.width));
    const spaces = ' '.repeat(width);
    return transformUnprotected(content, cache, (seg) => {
      if (config.style === 'spaces') {
        return seg.replace(/^[\t ]+/gm, (lead) => lead.replace(/\t/g, spaces));
      }
      return seg.replace(/^[\t ]+/gm, (lead) => {
        const expanded = lead.replace(/\t/g, spaces);
        const tabs = Math.floor(expanded.length / width);
        const rem = expanded.length % width;
        return '\t'.repeat(tabs) + ' '.repeat(rem);
      });
    });
  },
});
