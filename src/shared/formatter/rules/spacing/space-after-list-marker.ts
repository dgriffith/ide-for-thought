import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

const UNORDERED = /^([ \t]*)([-*+])[ \t]+(?=\S)/;
const ORDERED = /^([ \t]*)(\d+[.)])[ \t]+(?=\S)/;

registerRule({
  id: 'space-after-list-marker',
  category: 'spacing',
  title: 'Space after list marker',
  description:
    'Normalize the whitespace after list markers (`-`, `*`, `+`, `1.`, `1)`) to a single space.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => {
      const parts = seg.split(/(\r?\n)/);
      for (let i = 0; i < parts.length; i += 2) {
        parts[i] = parts[i]
          .replace(UNORDERED, '$1$2 ')
          .replace(ORDERED, '$1$2 ');
      }
      return parts.join('');
    });
  },
});
