import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';
import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../../../wiki-link';

interface Config {
  /** `never`: strip `.md` from every wiki-link target. `always`: add it where missing. */
  extension: 'never' | 'always';
}

registerRule<Config>({
  id: 'canonical-wiki-link-extension',
  category: 'minerva',
  title: 'Canonical wiki-link extension',
  description:
    'Enforce a single style for wiki-link targets — either always with `.md` or always without. Typed links (`[[cite::…]]`, `[[quote::…]]`) are left alone; they target sources/excerpts, not files.',
  defaultConfig: { extension: 'never' },
  apply(content, config, cache) {
    const want = config.extension === 'always' ? 'always' : 'never';
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(WIKI_LINK_RE, (match, inner: string) => {
        const parsed = parseWikiInner(inner);
        if (parsed.type !== null) return match; // typed links target ids, not files
        const target = parsed.target;
        if (target.length === 0) return match;
        const hasMd = /\.md$/.test(target);
        if (want === 'always' && !hasMd) {
          return reassembleWikiLink(parsed, `${target}.md`);
        }
        if (want === 'never' && hasMd) {
          return reassembleWikiLink(parsed, target.replace(/\.md$/, ''));
        }
        return match;
      }),
    );
  },
});
