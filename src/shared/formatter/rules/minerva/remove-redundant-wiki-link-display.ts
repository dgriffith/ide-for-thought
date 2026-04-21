import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';
import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../../../wiki-link';

registerRule({
  id: 'remove-redundant-wiki-link-display',
  category: 'minerva',
  title: 'Remove redundant wiki-link display',
  description:
    'When a wiki-link\'s display alias exactly matches its target (modulo a `.md` extension), drop the pipe: `[[notes/foo|notes/foo]]` → `[[notes/foo]]`.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(WIKI_LINK_RE, (match, inner: string) => {
        const parsed = parseWikiInner(inner);
        if (parsed.display === null) return match;
        const target = parsed.target.replace(/\.md$/, '');
        const display = parsed.display.trim().replace(/\.md$/, '');
        if (target !== display) return match;
        // Drop the display portion; everything else is preserved by
        // reassembleWikiLink since parsed.display is cleared below.
        return reassembleWikiLink({ ...parsed, display: null }, parsed.target);
      }),
    );
  },
});
