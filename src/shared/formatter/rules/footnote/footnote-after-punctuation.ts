import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'footnote-after-punctuation',
  category: 'footnote',
  title: 'Footnote reference after punctuation',
  description:
    'Move a footnote reference (`[^N]`) that appears before sentence-ending punctuation to after it: `word[^1].` → `word.[^1]`.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/(\[\^[^\]\s]+\])([.!?,;:])/g, '$2$1'),
    );
  },
});
