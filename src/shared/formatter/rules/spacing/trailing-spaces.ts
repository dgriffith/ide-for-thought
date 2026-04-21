import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'trailing-spaces',
  category: 'spacing',
  title: 'Trailing whitespace',
  description:
    'Remove trailing spaces and tabs from every line. Protected regions (code fences, frontmatter, math) are left alone.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/[ \t]+(\r?\n)/g, '$1').replace(/[ \t]+$/, ''),
    );
  },
});
