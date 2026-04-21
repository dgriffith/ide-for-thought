import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'proper-ellipsis',
  category: 'content',
  title: 'Proper ellipsis',
  description: 'Collapse three consecutive dots (`...`) into a single `…` character.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => seg.replace(/\.{3}/g, '…'));
  },
});
