import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /** Keys in this array come first, in the listed order. Everything else is sorted alphabetically after. */
  canonicalOrder: string[];
}

/**
 * Default canonical order: identity-ish metadata first, content-describing
 * metadata next, time-related metadata last. Chosen to match the way a
 * reader scans: "what is this note, who's it about, when." Everything not
 * in this list slots in alphabetically after the canonical block.
 */
const DEFAULT_ORDER = [
  'title',
  'aliases',
  'creator',
  'author',
  'date',
  'created',
  'modified',
  'tags',
  'description',
  'status',
];

registerRule<Config>({
  id: 'yaml-key-sort',
  category: 'yaml',
  title: 'Sort frontmatter keys',
  description:
    'Order the top-level frontmatter keys. Listed keys appear first in the given order; unknown keys follow alphabetically.',
  defaultConfig: { canonicalOrder: DEFAULT_ORDER },
  apply(content, config, cache) {
    const order = config.canonicalOrder?.length ? config.canonicalOrder : DEFAULT_ORDER;
    const orderMap = new Map<string, number>();
    order.forEach((key, i) => orderMap.set(key, i));

    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      doc.contents.items.sort((a, b) => {
        const ka = keyString(a.key);
        const kb = keyString(b.key);
        const pa = ka !== null && orderMap.has(ka) ? orderMap.get(ka)! : Infinity;
        const pb = kb !== null && orderMap.has(kb) ? orderMap.get(kb)! : Infinity;
        if (pa !== pb) return pa - pb;
        return String(ka ?? '').localeCompare(String(kb ?? ''));
      });
    });
  },
});

function keyString(key: unknown): string | null {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && YAML.isScalar(key)) {
    return String((key).value);
  }
  return null;
}
