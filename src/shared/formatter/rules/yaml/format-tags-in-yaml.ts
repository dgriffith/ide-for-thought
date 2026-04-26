import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /**
   * `bare`: `foo` (no prefix). `hash`: `#foo` (Obsidian-style).
   * Minerva treats them equivalently at index time, so this is purely
   * cosmetic.
   */
  prefix: 'bare' | 'hash';
  /** Name of the key holding the tag list. */
  key: string;
}

registerRule<Config>({
  id: 'format-tags-in-yaml',
  category: 'yaml',
  title: 'Tag prefix style',
  description:
    'Normalise each tag in `tags:` to either a bare form (`foo`) or a hash-prefixed form (`#foo`).',
  defaultConfig: { prefix: 'bare', key: 'tags' },
  apply(content, config, cache) {
    const tagKey = config.key || 'tags';
    const prefix = config.prefix === 'hash' ? 'hash' : 'bare';
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      for (const pair of doc.contents.items) {
        if (keyString(pair.key) !== tagKey) continue;
        if (!YAML.isSeq(pair.value)) continue;
        for (const item of pair.value.items) {
          if (!YAML.isScalar(item)) continue;
          const s = typeof item.value === 'string' ? item.value : '';
          const stripped = s.replace(/^#+/, '');
          item.value = prefix === 'hash' ? `#${stripped}` : stripped;
          // Discard any quoting hint the parser retained from the original
          // `"#foo"` source; yaml v2 will then emit the shortest valid form.
          item.type = undefined;
        }
      }
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
