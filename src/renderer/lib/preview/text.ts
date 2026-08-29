/**
 * Pure HTML/text-escaping + frontmatter helpers extracted from
 * Preview.svelte (#672). No DOM, no reactivity — just string transforms,
 * so they're trivially unit-testable and shared by the other preview
 * modules.
 *
 * `escapeHtml`/`escapeAttr`/`stripFrontmatter` moved to `src/shared/` (#1917)
 * — this file re-exports them so existing imports of `preview/text` are
 * unaffected. `countFrontmatterLines` stays local: it's specific to this
 * module's line-counting need, not one of the duplicated helpers.
 */
export { escapeHtml, escapeAttr } from '../../../shared/text-escape';
export { stripFrontmatter } from '../../../shared/frontmatter-strip';

export function countFrontmatterLines(text: string): number {
  const m = text.match(/^---\n[\s\S]*?\n---\n?/);
  if (!m) return 0;
  return (m[0].match(/\n/g) ?? []).length;
}
