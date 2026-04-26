import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  keys: string[];
}

registerRule<Config>({
  id: 'remove-yaml-keys',
  category: 'yaml',
  title: 'Remove frontmatter keys',
  description:
    'Delete the listed top-level keys from the frontmatter. Useful for stripping legacy metadata that shouldn\'t travel with a note.',
  defaultConfig: { keys: [] },
  apply(content, config, cache) {
    const toRemove = new Set(config.keys ?? []);
    if (toRemove.size === 0) return content;
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      doc.contents.items = doc.contents.items.filter((pair) => {
        const keyName = keyString(pair.key);
        return keyName === null || !toRemove.has(keyName);
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
