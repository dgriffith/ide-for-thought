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
import { findFrontmatter } from '../../../shared/frontmatter-block';

/**
 * Lines the frontmatter block (and its closing line break) occupies — the
 * offset between a preview line and the editor line. Uses the shared boundary
 * `stripFrontmatter` strips (#2690). It used to be LF-only, so for a CRLF
 * note the preview stripped the block but counted 0 lines for it, and every
 * line reference after it (image resize, scroll sync) was off by the block.
 */
export function countFrontmatterLines(text: string): number {
  const block = findFrontmatter(text);
  if (!block) return 0;
  let n = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < block.end; i = text.indexOf('\n', i + 1)) n++;
  return n;
}
