import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from '../yaml/helpers';

/**
 * Alias → canonical key. Pulled from Minerva's frontmatter-predicates map
 * (src/main/graph/frontmatter-predicates.ts) — kept in sync but redefined
 * here since the main-process module can't be imported from shared code.
 * The surface is narrow enough that drift is cheap to spot.
 */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  author: 'creator',
  authors: 'creator',
  lang: 'language',
  date: 'issued',
  year: 'issued',
  url: 'uri',
  pageRange: 'pages',
};

registerRule({
  id: 'canonicalize-frontmatter-keys',
  category: 'minerva',
  title: 'Canonicalise frontmatter keys',
  description:
    'Rename well-known alias keys (`author` → `creator`, `date` → `issued`, `url` → `uri`, …) to the canonical form the indexer already maps them to. Unknown keys pass through unchanged.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      const existingKeys = new Set<string>();
      for (const pair of doc.contents.items) {
        const name = keyString(pair.key);
        if (name !== null) existingKeys.add(name);
      }
      for (const pair of doc.contents.items) {
        const name = keyString(pair.key);
        if (name === null) continue;
        const canonical = ALIAS_TO_CANONICAL[name];
        if (!canonical) continue;
        // If both the alias and the canonical form are present, leave
        // the alias alone — merging two distinct values is out of scope.
        if (existingKeys.has(canonical)) continue;
        // Pair keys in parsed documents are always Scalar. The `|| string`
        // branch of keyString is just a defensive fallback; if we're in the
        // else-branch here, the source YAML was unusual enough that we'd
        // rather no-op than risk corrupting it.
        if (YAML.isScalar(pair.key)) {
          pair.key.value = canonical;
          pair.key.type = undefined;
        }
        existingKeys.add(canonical);
      }
    });
  },
});

function keyString(key: unknown): string | null {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && YAML.isScalar(key as YAML.Scalar)) {
    return String((key as YAML.Scalar).value);
  }
  return null;
}
