import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /** Keys whose sequence values should be sorted. Others are left alone. Defaults to tags-only. */
  keys: string[];
}

registerRule<Config>({
  id: 'sort-yaml-array-values',
  category: 'yaml',
  title: 'Sort YAML array values',
  description:
    'Alphabetically sort the entries of named top-level sequences. Off by default for most keys (ordering is often intentional); applied only to keys listed in the config, defaulting to `tags`.',
  defaultConfig: { keys: ['tags'] },
  apply(content, config, cache) {
    const targetKeys = new Set(config.keys ?? []);
    if (targetKeys.size === 0) return content;
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      for (const pair of doc.contents.items) {
        if (!YAML.isScalar(pair.key) && typeof pair.key !== 'string') continue;
        const keyName = YAML.isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
        if (!targetKeys.has(keyName)) continue;
        if (!YAML.isSeq(pair.value)) continue;
        sortSeq(pair.value);
      }
    });
  },
});

function sortSeq(seq: YAML.YAMLSeq): void {
  const scalars: YAML.Scalar[] = [];
  const nonScalars: unknown[] = [];
  for (const item of seq.items) {
    if (YAML.isScalar(item)) scalars.push(item);
    else nonScalars.push(item);
  }
  scalars.sort((a, b) => String(a.value).localeCompare(String(b.value)));
  seq.items = [...scalars, ...nonScalars];
}
