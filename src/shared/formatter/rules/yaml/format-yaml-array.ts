import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /** `block`: one item per line with `-`. `flow`: inline `[a, b, c]`. */
  style: 'block' | 'flow';
  /**
   * When non-empty, only the listed keys are reformatted. An empty list
   * applies the style to every sequence value.
   */
  keys: string[];
}

registerRule<Config>({
  id: 'format-yaml-array',
  category: 'yaml',
  title: 'Sequence style',
  description:
    'Render top-level frontmatter sequences as either block style (`- a` on its own line) or flow style (`[a, b, c]`).',
  defaultConfig: { style: 'block', keys: [] },
  apply(content, config, cache) {
    const targetKeys = new Set(config.keys ?? []);
    const style = config.style === 'flow' ? 'flow' : 'block';
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      for (const pair of doc.contents.items) {
        if (!YAML.isSeq(pair.value)) continue;
        if (targetKeys.size > 0) {
          const keyName = keyString(pair.key);
          if (keyName === null || !targetKeys.has(keyName)) continue;
        }
        pair.value.flow = style === 'flow';
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
