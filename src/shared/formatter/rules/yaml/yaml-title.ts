import YAML from 'yaml';
import { registerRule } from '../../registry';
import type { ParseCache } from '../../types';
import { transformFrontmatterDoc } from './helpers';

interface Config {
  /**
   * `heading-to-yaml`: the note's first H1 populates the frontmatter `title`.
   * `yaml-to-heading`: the frontmatter `title` populates / replaces the first H1.
   */
  direction: 'heading-to-yaml' | 'yaml-to-heading';
}

const H1_RE = /^#[ \t]+(.+?)(?:[ \t]*#*)?[ \t]*$/;

interface FoundH1 {
  text: string;
  lineStart: number;
  lineEnd: number;
}

registerRule<Config>({
  id: 'yaml-title',
  category: 'yaml',
  title: 'Sync frontmatter title with H1',
  description:
    'Keep the frontmatter `title:` and the note\'s first H1 in sync. Direction is configurable.',
  defaultConfig: { direction: 'heading-to-yaml' },
  apply(content, config, cache) {
    const firstH1 = findFirstH1(content, cache);
    if (config.direction === 'yaml-to-heading') {
      return applyYamlToHeading(content, cache, firstH1);
    }
    return applyHeadingToYaml(content, cache, firstH1);
  },
});

function applyHeadingToYaml(
  content: string,
  cache: ParseCache,
  firstH1: FoundH1 | null,
): string {
  if (firstH1 === null) return content;
  return transformFrontmatterDoc(content, cache, (doc) => {
    if (!YAML.isMap(doc.contents)) return;
    const current = readKey(doc, 'title');
    if (current !== firstH1.text) doc.set('title', firstH1.text);
  });
}

function applyYamlToHeading(
  content: string,
  cache: ParseCache,
  firstH1: FoundH1 | null,
): string {
  const fm = cache.frontmatterRange;
  if (!fm) return content;
  const block = content.slice(fm.start, fm.end);
  const m = block.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return content;
  let parsed: unknown;
  try { parsed = YAML.parse(m[1]); } catch { return content; }
  if (!parsed || typeof parsed !== 'object') return content;
  const titleRaw = (parsed as Record<string, unknown>).title;
  if (typeof titleRaw !== 'string' || titleRaw.length === 0) return content;

  // Insertion of a missing H1 is `file-name-heading`'s job, not this rule's.
  if (firstH1 === null) return content;
  if (firstH1.text === titleRaw) return content;
  return (
    content.slice(0, firstH1.lineStart) +
    `# ${titleRaw}` +
    content.slice(firstH1.lineEnd)
  );
}

function findFirstH1(content: string, cache: ParseCache): FoundH1 | null {
  let lineStart = cache.frontmatterRange ? cache.frontmatterRange.end : 0;
  while (lineStart <= content.length) {
    if (cache.isProtected(lineStart)) {
      const next = content.indexOf('\n', lineStart);
      if (next === -1) break;
      lineStart = next + 1;
      continue;
    }
    const newlineIdx = content.indexOf('\n', lineStart);
    const lineEnd = newlineIdx === -1 ? content.length : newlineIdx;
    const line = content.slice(lineStart, lineEnd);
    const m = line.match(H1_RE);
    if (m) return { text: m[1].trim(), lineStart, lineEnd };
    if (newlineIdx === -1) break;
    lineStart = newlineIdx + 1;
  }
  return null;
}

function readKey(doc: YAML.Document.Parsed, key: string): unknown {
  const node = doc.get(key, true);
  if (node === undefined || node === null) return undefined;
  if (YAML.isScalar(node)) return node.value;
  return node;
}
