/**
 * Defense-in-depth sanitisation for library-generated diagram SVG (#1331, L3).
 *
 * Mermaid renders a diagram to an SVG *string* that the renderer injects via
 * `innerHTML` (`mermaid-renderer.ts`). Today the only thing between a malicious
 * ```mermaid source and DOM injection is the app CSP (no `unsafe-inline` in
 * `script-src`) plus mermaid's own output being well-formed. This adds an
 * explicit DOMPurify pass as a second, independent layer, so a mermaid
 * sanitisation bypass or a future CSP regression can't turn diagram source into
 * an executing `<script>` or inline event handler.
 *
 * (Vega does NOT need this: vega-embed builds the chart with safe DOM
 * construction — createElementNS/setAttribute via its SVG renderer — never
 * `innerHTML` of a generated string, and runs expressions through the CSP-safe
 * AST interpreter (`ast: true`). The only `innerHTML` in the Vega renderer is
 * app-controlled, already-escaped error/notice HTML.)
 *
 * Config mirrors `sanitizeComputeOutputHtml`: DOMPurify's default HTML+SVG
 * allowlist minus the script/handler surface. That allowlist keeps everything
 * this app's mermaid actually emits — it runs with `securityLevel: 'strict'`, so
 * node labels are SVG `<text>` (not `<foreignObject>` HTML), and the `<style>`,
 * `<path>`, `<g>`, ids, classes and inline styles all survive, including the
 * ids/classes mermaid's post-render `bindFunctions` re-queries. `USE_PROFILES`
 * is intentionally omitted — see the note in compute-output-sanitize.ts.
 *
 * (DOMPurify's default drops `<foreignObject>` HTML content, which would matter
 * only if mermaid were switched to `htmlLabels`/non-strict — revisit the config
 * here if that ever happens.)
 */

import DOMPurify from 'dompurify';
import { FORBID_TAGS, FORBID_ATTR } from '../compute-output-sanitize';

export function sanitizeDiagramSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    FORBID_TAGS,
    FORBID_ATTR,
  });
}
