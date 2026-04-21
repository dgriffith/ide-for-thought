import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'remove-trailing-punctuation-in-heading',
  category: 'heading',
  title: 'Remove trailing punctuation in headings',
  description:
    'Strip trailing `.`, `,`, `:`, or `;` from ATX headings. `?` and `!` are kept.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/^(#{1,6}[ \t]+.*?)[.,:;]+([ \t]*)$/gm, '$1$2'),
    );
  },
});
