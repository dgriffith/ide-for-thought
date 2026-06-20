import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';
import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../../../wiki-link';
import { getLinkType } from '../../../link-types';

interface Config {
  style: 'absolute' | 'shortest';
}

registerRule<Config>({
  id: 'canonical-wiki-link-path-style',
  category: 'minerva',
  title: 'Canonical wiki-link path style',
  description:
    'Rewrite every note wiki-link to one path style — `absolute` (full-from-root, e.g. `[[notes/topic/raft]]`) or `shortest` (the shortest unambiguous form, e.g. `[[raft]]`). Off by default. Preserves type prefixes, `#anchors`, and `|display` text; leaves source/excerpt links (`cite::`, `quote::`) and unresolvable links alone. Needs thoughtbase context, so it only runs when formatting a saved note or folder.',
  defaultConfig: { style: 'absolute' },
  apply(content, config, cache, ctx) {
    const canonicalize = ctx?.canonicalizeLinkTarget;
    if (!canonicalize) return content; // no resolver context → leave links as-is
    const style = config.style ?? 'absolute';
    return transformUnprotected(content, cache, (seg) =>
      seg.replace(WIKI_LINK_RE, (match: string, inner: string) => {
        const parsed = parseWikiInner(inner);
        // cite:: / quote:: point at sources / excerpts, not notes.
        if (parsed.type) {
          const targetKind = getLinkType(parsed.type).targetKind;
          if (targetKind && targetKind !== 'note') return match;
        }
        if (!parsed.target) return match; // pure-anchor link like [[#heading]]
        const next = canonicalize(parsed.target, style);
        if (next == null || next === parsed.target) return match;
        return reassembleWikiLink(parsed, next);
      }),
    );
  },
});
