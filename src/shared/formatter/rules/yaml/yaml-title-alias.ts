import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

registerRule({
  id: 'yaml-title-alias',
  category: 'yaml',
  title: 'Mirror title into aliases',
  description:
    'Ensure the frontmatter `title` value appears as an entry in `aliases`. Existing alias entries are kept; duplicates are not added.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      const title = readScalarKey(doc, 'title');
      if (typeof title !== 'string' || title.length === 0) return;

      const aliasesNode = doc.get('aliases', true);
      if (!aliasesNode) {
        doc.set('aliases', [title]);
        return;
      }
      if (YAML.isSeq(aliasesNode)) {
        const present = aliasesNode.items.some(
          (item) => YAML.isScalar(item) && item.value === title,
        );
        if (!present) aliasesNode.add(title);
      }
    });
  },
});

function readScalarKey(doc: YAML.Document.Parsed, key: string): unknown {
  const node = doc.get(key, true);
  if (YAML.isScalar(node)) return node.value;
  return undefined;
}
