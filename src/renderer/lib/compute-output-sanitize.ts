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
 * `<iframe>`, `<object>`, `<embed>`, `<form>`, inline event handlers).
 */

import DOMPurify from 'dompurify';

// The script/injection surface forbidden across every DOMPurify pass in the
// renderer — reused by the diagram-SVG sanitiser (#1331) so there is a single
// source of truth for "what a library must never be able to emit into the host
// page." Exported rather than duplicated.
export const FORBID_TAGS = ['script', 'iframe', 'object', 'embed', 'form'];

export const FORBID_ATTR = [
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
