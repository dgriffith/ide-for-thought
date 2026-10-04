/**
 * DOMPurify config + helper for rich-formatted compute output (#243).
 *
 * Lives outside Preview.svelte so the sanitisation contract is
 * unit-testable without mounting the component. The renderer's
 * `_repr_html_` and SVG output paths both call this — same allowlist
 * either way.
 *
 * Allows the elements `_repr_html_` libraries actually use (tables,
 * styled spans, inline images) and forbids the elements that would
 * let a user-side library compromise the host page (`<script>`,
 * `<iframe>`, `<object>`, `<embed>`, `<form>`, inline event handlers) —
 * and, since #2557, the ones that restyle or re-point the WHOLE page:
 * `<style>` (incl. SVG's), `<link>`, `<meta>`, `<base>`.
 */

import DOMPurify from 'dompurify';

/**
 * Tags no untrusted HTML may carry into the renderer — compute output here,
 * note markup in `preview/sanitize-note-html.ts` (one list, so the two can't
 * drift).
 *
 * `style` / `link` / `meta` / `base` (#2557): injected into the app's own
 * document, a `<style>` block isn't scoped to the note — `scoped` is dead in
 * every browser — so a note or a `_repr_html_` could restyle the whole app:
 * hide or move the Approve / Reject controls, the compute safety flags or the
 * MCP Allow / Deny card, and overlay its own "click Approve" text. That is UI
 * redress against the human-confirmation surfaces the Trust Principle rests
 * on, and `url()` in it reopens the tracking-beacon hole (#1332). `<link
 * rel=stylesheet>` does the same from a file in the thoughtbase (a file:// URL
 * is 'self' to the CSP); `<meta http-equiv>` and `<base>` re-point the page.
 * The cost: pandas' DataFrame HTML loses its small `<style scoped>` block.
 */
export const UNTRUSTED_HTML_FORBID_TAGS = [
  'script', 'iframe', 'object', 'embed', 'form',
  'style', 'link', 'meta', 'base',
];
const FORBID_TAGS = UNTRUSTED_HTML_FORBID_TAGS;

const FORBID_ATTR = [
  'onerror',
  'onload',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onfocus',
  'onblur',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'onsubmit',
  'oninput',
  'onchange',
  'onanimationstart',
  'onanimationend',
];

export function sanitizeComputeOutputHtml(html: string): string {
  // No `USE_PROFILES` — the default config already covers HTML + SVG
  // and lets `FORBID_TAGS` actually fire. Setting both `USE_PROFILES`
  // and `FORBID_TAGS` interacts oddly: the profile's tag list reseeds
  // the allowlist and a few of our forbidden tags slip through (notably
  // `<object>` under the html profile, and SVG children get clobbered
  // when the html profile is in play simultaneously).
  return DOMPurify.sanitize(html, {
    FORBID_TAGS,
    FORBID_ATTR,
  });
}
