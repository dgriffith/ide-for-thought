import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /** Keys that must be present; missing ones get added with an empty string value. */
  keys: string[];
}

registerRule<Config>({
  id: 'insert-yaml-attributes',
  category: 'yaml',
  title: 'Insert missing frontmatter keys',
  description:
    'Ensure the listed keys are present in the frontmatter. Missing keys get added with an empty value; existing keys are left alone.',
  defaultConfig: { keys: [] },
  apply(content, config, cache) {
    const required = config.keys ?? [];
    if (required.length === 0) return content;

    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      const existing = new Set<string>();
      for (const pair of doc.contents.items) {
        const name = keyString(pair.key);
        if (name !== null) existing.add(name);
      }
      for (const key of required) {
        if (!existing.has(key)) doc.set(key, '');
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
