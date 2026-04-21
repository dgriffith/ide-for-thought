import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  style: 'asterisk' | 'underscore';
}

registerRule<Config>({
  id: 'emphasis-style',
  category: 'content',
  title: 'Emphasis style',
  description:
    'Enforce a single style for italic emphasis: either `*word*` or `_word_`.',
  defaultConfig: { style: 'asterisk' },
  apply(content, config, cache) {
    return transformUnprotected(content, cache, (seg) => {
      if (config.style === 'asterisk') {
        return seg.replace(/(?<![_\w])_([^_\n]+?)_(?![_\w])/g, (m, inner: string) =>
          inner.trim() ? `*${inner}*` : m,
        );
      }
      return seg.replace(/(?<![*\w])\*([^*\n]+?)\*(?![*\w])/g, (m, inner: string) =>
        inner.trim() ? `_${inner}_` : m,
      );
    });
  },
});
