/**
 * Strip a leading `---\n...\n---\n` YAML frontmatter block, if present.
 * Hoisted from 6 duplicated copies (#1917). Five already agreed on the
 * CRLF-aware pattern below; `renderer/lib/preview/text.ts`'s copy was the
 * odd one out (`\n` only, no `\r?`), meaning it silently failed to strip
 * frontmatter from a note saved with Windows line endings — a latent bug,
 * not a deliberate difference, so this adopts the CRLF-aware pattern as
 * canonical rather than preserving the narrower one.
 */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}
