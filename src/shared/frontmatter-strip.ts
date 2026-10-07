import { findFrontmatter } from './frontmatter-block';

/**
 * Strip a leading `---\n...\n---\n` YAML frontmatter block, if present.
 * Hoisted from 6 duplicated copies (#1917). Five already agreed on a
 * CRLF-aware pattern; `renderer/lib/preview/text.ts`'s copy was the odd one
 * out (`\n` only), so it silently failed to strip frontmatter from a note
 * saved with Windows line endings.
 *
 * The boundary is `findFrontmatter` (#2690), the same one the graph's
 * `parseFrontmatter` uses, so what the preview hides as frontmatter is
 * exactly what the graph reads as frontmatter. A byte-order mark before the
 * block goes with it.
 */
export function stripFrontmatter(content: string): string {
  const block = findFrontmatter(content);
  return block ? content.slice(block.end) : content;
}
