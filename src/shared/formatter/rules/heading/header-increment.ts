import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'header-increment',
  category: 'heading',
  title: 'Heading increment',
  description:
    'Heading levels may only step by one at a time. An out-of-order level (e.g. H1 straight to H3) is clamped down to the previous level + 1. The first heading in the document is accepted as-is.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => {
      let lastLevel: number | null = null;
      const parts = seg.split(/(\r?\n)/);
      for (let i = 0; i < parts.length; i += 2) {
        const m = parts[i].match(/^(#{1,6})(?=[ \t]|$)/);
        if (!m) continue;
        const level = m[1].length;
        const allowed: number = lastLevel === null ? level : Math.min(level, lastLevel + 1);
        if (allowed !== level) {
          parts[i] = '#'.repeat(allowed) + parts[i].slice(level);
        }
        lastLevel = allowed;
      }
      return parts.join('');
    });
  },
});
