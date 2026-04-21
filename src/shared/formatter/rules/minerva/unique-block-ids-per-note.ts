import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

/**
 * A block-id marker is `^id` appearing near the end of a line after one or
 * more spaces. See `note-anchors.ts` for the canonical matcher. Here we
 * only need to locate + rename, not index.
 */
const BLOCK_ID_RE = /(\s)\^([\w-]+)(?=\s*(?:\r?\n|$))/g;

registerRule({
  id: 'unique-block-ids-per-note',
  category: 'minerva',
  title: 'Unique block-ids',
  description:
    'When two paragraphs in the same note share a `^block-id` marker, suffix the duplicates (`-2`, `-3`, …) so every block-id is unique. Incoming `[[note#^block-id]]` links are NOT updated — if you renamed a duplicate that had incoming links, you\'ll need to fix those by hand.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => {
      const seen = new Map<string, number>();
      return seg.replace(BLOCK_ID_RE, (match, lead: string, id: string) => {
        const count = seen.get(id) ?? 0;
        seen.set(id, count + 1);
        if (count === 0) return match;
        const suffixed = findUniqueId(id, count + 1, seen);
        seen.set(suffixed, 1);
        return `${lead}^${suffixed}`;
      });
    });
  },
});

function findUniqueId(base: string, startFrom: number, seen: Map<string, number>): string {
  let n = startFrom;
  while (true) {
    const candidate = `${base}-${n}`;
    if (!seen.has(candidate)) return candidate;
    n++;
  }
}
