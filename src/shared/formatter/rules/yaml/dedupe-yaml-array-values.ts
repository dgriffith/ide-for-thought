import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

registerRule({
  id: 'dedupe-yaml-array-values',
  category: 'yaml',
  title: 'Dedupe YAML array values',
  description:
    'Remove duplicate entries from top-level frontmatter sequences (e.g. `tags: [a, a, b]` → `tags: [a, b]`). First occurrence wins. Non-scalar entries (mappings, nested sequences) are left unchanged.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      for (const pair of doc.contents.items) {
        if (!YAML.isSeq(pair.value)) continue;
        dedupeSeq(pair.value);
      }
    });
  },
});

function dedupeSeq(seq: YAML.YAMLSeq): void {
  const seen = new Set<string>();
  seq.items = seq.items.filter((item) => {
    if (!YAML.isScalar(item)) return true;
    const key = String(item.value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
