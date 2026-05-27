/**
 * Render a plain-text string with embedded `$…$` / `$$…$$` math.
 *
 * Used by surfaces that don't go through the full Preview pipeline —
 * source titles, abstracts, anywhere metadata is shown as inline text
 * but might contain LaTeX. Uses markdown-it with `html: false`, so
 * raw HTML in the source string is escaped; the returned string is
 * safe to inject via Svelte's `{@html …}`.
 *
 * Note this also handles the usual inline markdown (emphasis, links)
 * which is usually desirable in a title/abstract but isn't strictly
 * necessary. If callers need pure-math-only, refactor to a dedicated
 * tokenizer; for now sharing the full inline ruleset is the path of
 * least surprise.
 */

import MarkdownIt from 'markdown-it';
import { installMath } from './math-plugin';

const md = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});
installMath(md);

export function renderInlineWithMath(text: string | null | undefined): string {
  if (!text) return '';
  return md.renderInline(text);
}
