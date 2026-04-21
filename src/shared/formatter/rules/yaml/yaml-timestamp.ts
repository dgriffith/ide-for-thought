import YAML from 'yaml';
import { registerRule } from '../../registry';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /** When true, overwrite `modified:` with today's date each run. */
  updateModified: boolean;
  /** When true, add `created:` on first run (never overwrites). */
  insertCreated: boolean;
  /**
   * Date format. `iso-date` is `YYYY-MM-DD`, `iso` is a full ISO-8601
   * timestamp in UTC. Default `iso-date` — granular enough for human
   * timelines without triggering a rewrite every time the user hits save.
   */
  format: 'iso-date' | 'iso';
}

registerRule<Config>({
  id: 'yaml-timestamp',
  category: 'yaml',
  title: 'Frontmatter timestamps',
  description:
    'Maintain `created:` and `modified:` frontmatter keys. `modified` is overwritten each run (within the same day the value doesn\'t change); `created` is inserted once when missing.',
  defaultConfig: { updateModified: true, insertCreated: true, format: 'iso-date' },
  apply(content, config, cache) {
    if (!config.updateModified && !config.insertCreated) return content;
    const now = formatNow(config.format);
    return transformFrontmatterDoc(content, cache, (doc) => {
      if (!YAML.isMap(doc.contents)) return;
      if (config.updateModified) {
        const existing = readKey(doc, 'modified');
        if (existing !== now) doc.set('modified', now);
      }
      if (config.insertCreated && readKey(doc, 'created') === undefined) {
        doc.set('created', now);
      }
    });
  },
});

function formatNow(format: 'iso-date' | 'iso'): string {
  const d = new Date();
  if (format === 'iso') return d.toISOString();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function readKey(doc: YAML.Document.Parsed, key: string): unknown {
  const node = doc.get(key, true);
  if (node === undefined || node === null) return undefined;
  if (YAML.isScalar(node)) return node.value;
  return node;
}
