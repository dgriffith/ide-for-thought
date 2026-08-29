/**
 * Escaping helpers duplicated across ~25 call sites (#1917): every markdown
 * plugin, publish exporter, and formatter rule that builds HTML or a RegExp
 * from arbitrary text had its own copy. Hoisted here as the one definition —
 * but only where the implementations were actually the same behavior. Two
 * genuinely different HTML-escaping conventions existed side by side (see
 * below); both are kept, distinctly named, rather than silently picking one
 * and changing every exporter's byte-for-byte output.
 */

/** Escapes `&`, `<`, `>` — the minimum needed for safe HTML text-node
 *  content. Does NOT escape quotes; use {@link escapeAttr} for a
 *  double-quoted attribute value. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** {@link escapeHtml} plus double-quote escaping — safe to interpolate into
 *  a double-quoted HTML attribute. Does not escape a bare apostrophe: every
 *  caller wraps attributes in double quotes, so a literal `'` cannot break
 *  out. */
export function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

/**
 * Escapes `&`, `<`, `>`, `"`, `'` — full escaping for the publish exporters
 * that historically reused ONE function for both text content and attribute
 * interpolation. Escaping quotes in plain text is harmless (renders
 * identically once parsed as HTML) but changes the literal HTML source, so
 * this stays a distinct export rather than folding into {@link escapeHtml}
 * above — merging them would silently change every one of those exporters'
 * byte-for-byte output.
 */
export function escapeHtmlFull(s: string): string {
  return escapeAttr(s).replace(/'/g, '&#39;');
}

/** Escapes RegExp metacharacters so `s` matches itself literally when spliced
 *  into a `new RegExp(...)` source string. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
