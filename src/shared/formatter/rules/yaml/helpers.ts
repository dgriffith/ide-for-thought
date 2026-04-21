/**
 * Shared plumbing for YAML frontmatter rules.
 *
 * Rules operate on the frontmatter block identified by the parse cache.
 * For rules that need structured access, `transformFrontmatterDoc` parses
 * the YAML body into a yaml v2 `Document`, hands it to the caller's
 * mutator, and re-serialises — keeping the surrounding `---` fences and
 * the document terminator newline intact.
 *
 * If parsing fails (or the block shape isn't recognised), the helpers
 * return content unchanged rather than risk corrupting the user's file.
 */

import YAML from 'yaml';
import type { ParseCache } from '../../types';

export function transformFrontmatterDoc(
  content: string,
  cache: ParseCache,
  mutate: (doc: YAML.Document.Parsed) => void,
): string {
  const fm = cache.frontmatterRange;
  if (!fm) return content;
  const block = content.slice(fm.start, fm.end);
  const m = block.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return content;
  const body = m[1];
  const terminator = m[2];
  let doc: YAML.Document.Parsed;
  try {
    doc = YAML.parseDocument(body);
    if (doc.errors.length > 0) return content;
  } catch {
    return content;
  }

  mutate(doc);

  let serialised = doc.toString();
  // yaml v2's `toString` always appends a trailing newline; strip so we
  // can re-assemble with the exact closing-fence shape the original used.
  serialised = serialised.replace(/\s+$/, '');
  if (serialised.length === 0) {
    // All keys removed — collapse to an empty frontmatter block.
    return content.slice(0, fm.start) + `---\n---${terminator}` + content.slice(fm.end);
  }
  return (
    content.slice(0, fm.start) +
    `---\n${serialised}\n---${terminator}` +
    content.slice(fm.end)
  );
}

/**
 * Read-only variant: returns the parsed value of a specific top-level
 * frontmatter key, or `undefined` if the key is absent or the frontmatter
 * is missing/unparseable.
 */
export function readFrontmatterKey(
  content: string,
  cache: ParseCache,
  key: string,
): unknown {
  const fm = cache.frontmatterRange;
  if (!fm) return undefined;
  const block = content.slice(fm.start, fm.end);
  const m = block.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) return undefined;
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === 'object') {
      return (parsed as Record<string, unknown>)[key];
    }
  } catch {
    // fall through
  }
  return undefined;
}
