/**
 * Per-note publishing frontmatter (#1136) — pure parse + validation.
 *
 * Publication concerns are namespaced under a `publish:` block so they don't
 * pollute the knowledge graph (bare top-level keys would materialise as stray
 * `minerva:meta-*` predicates) or collide with the user's own frontmatter:
 *
 *     ---
 *     title: My Note
 *     description: A short share blurb          # reuses the canonical dc:description key
 *     publish:
 *       image: https://example.com/card.png     # absolute URL only (MVP)
 *       background: "#faf3e0"                    # validated safe CSS color/token
 *       css: styles/fancy.css                    # project-relative stylesheet(s)
 *     ---
 *
 * Escaping happens where these land in HTML (render.ts); this layer only reads
 * and validates, so it stays trivially testable.
 */
import type { ExportPlanFile } from '../../types';

export interface PublishMeta {
  description?: string;
  /** Share image — kept only when an absolute http(s) URL (social scrapers
   *  can't use relative paths / data URIs; copying a project-relative image is
   *  a follow-on tied to the asset-copy work). */
  image?: string;
  /** Page background — kept only when it passes {@link isSafeCssColor}. */
  background?: string;
  /** Project-relative `.css` paths to copy into the output and link on this
   *  page (after the site stylesheet). Traversal / absolute / URL refs dropped. */
  cssPaths: string[];
}

/**
 * A conservative allowlist for a background value — a hex color, a bare CSS
 * color keyword, an `rgb()/rgba()/hsl()/hsla()` function, or a `var(--x)`
 * reference. Anything else (a raw string that could carry `}`, `url(javascript:…)`,
 * `expression(…)`, etc.) is rejected rather than interpolated into a CSS rule.
 */
export function isSafeCssColor(value: string): boolean {
  const v = value.trim();
  return (
    /^#[0-9a-fA-F]{3,8}$/.test(v) ||
    /^[a-zA-Z]+$/.test(v) ||
    /^(rgb|rgba|hsl|hsla)\([0-9.,%\s/]+\)$/.test(v) ||
    /^var\(--[\w-]+\)$/.test(v)
  );
}

function strOf(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** A project-relative `.css` path safe to copy + link: no traversal, not
 *  absolute, not a scheme/URL. */
function safeCssPath(s: string): boolean {
  return s.endsWith('.css') && !s.startsWith('/') && !s.includes('..') && !/^[a-z][a-z0-9+.-]*:/i.test(s);
}

export function extractPublish(note: ExportPlanFile): PublishMeta {
  const fm = note.frontmatter;
  const pub = (fm.publish && typeof fm.publish === 'object' && !Array.isArray(fm.publish))
    ? (fm.publish as Record<string, unknown>)
    : {};

  const description = strOf(fm.description) ?? strOf(pub.description);
  const image = strOf(pub.image);
  const bg = strOf(pub.background);
  const cssRaw = pub.css ?? pub.stylesheet;
  const cssList = Array.isArray(cssRaw) ? cssRaw : cssRaw != null ? [cssRaw] : [];
  const cssPaths = cssList
    .map(strOf)
    .filter((s): s is string => !!s && safeCssPath(s));

  return {
    ...(description ? { description } : {}),
    ...(image ? { image } : {}),
    ...(bg && isSafeCssColor(bg) ? { background: bg } : {}),
    cssPaths,
  };
}

/** True when the note carries any publish-specific head/style directives — lets
 *  the exporter skip all the per-note plumbing (and stay byte-identical) for the
 *  common no-frontmatter case. */
export function hasPublishMeta(meta: PublishMeta): boolean {
  return !!(meta.description || meta.image || meta.background || meta.cssPaths.length > 0);
}
