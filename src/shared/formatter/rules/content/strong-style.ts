import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  style: 'asterisk' | 'underscore';
}

registerRule<Config>({
  id: 'strong-style',
  category: 'content',
  title: 'Strong emphasis style',
  description:
    'Enforce a single style for bold emphasis: either `**word**` or `__word__`.',
  defaultConfig: { style: 'asterisk' },
  apply(content, config, cache) {
    return transformUnprotected(content, cache, (seg) => {
      if (config.style === 'asterisk') {
        return seg.replace(/(?<!\w)__([^_\n]+?)__(?!\w)/g, (m, inner: string) =>
          inner.trim() ? `**${inner}**` : m,
        );
      }
      return seg.replace(/(?<!\w)\*\*([^*\n]+?)\*\*(?!\w)/g, (m, inner: string) =>
        inner.trim() ? `__${inner}__` : m,
      );
    });
  },
});
