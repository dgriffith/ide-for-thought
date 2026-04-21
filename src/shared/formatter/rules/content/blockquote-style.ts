import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'blockquote-style',
  category: 'content',
  title: 'Blockquote style',
  description:
    'Ensure a single space after every `>` marker on a blockquote line. Lines that are already `> `, or that are empty quote lines (`>` alone), are left alone.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/^([ \t]{0,3})(>+)(?=\S)/gm, '$1$2 '),
    );
  },
});
