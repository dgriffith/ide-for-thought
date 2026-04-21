import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

registerRule({
  id: 'remove-link-spacing',
  category: 'spacing',
  title: 'Collapse spacing inside links',
  description:
    'Trim whitespace around the text and URL of inline markdown links: `[ text ]( url )` → `[text](url)`.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, (match, text: string, url: string) => {
        const t = text.trim();
        const u = url.trim();
        if (t === text && u === url) return match;
        return `[${t}](${u})`;
      }),
    );
  },
});
