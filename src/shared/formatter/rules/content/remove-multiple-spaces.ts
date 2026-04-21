import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'remove-multiple-spaces',
  category: 'content',
  title: 'Collapse multiple spaces',
  description:
    'Collapse runs of multiple spaces inside a line to a single space. Leading indentation and trailing whitespace are left for other rules to handle.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/(\S) {2,}(?=\S)/g, '$1 '),
    );
  },
});
