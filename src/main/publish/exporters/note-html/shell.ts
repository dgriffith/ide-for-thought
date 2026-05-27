/**
 * HTML document shell for the note-html exporter (#248).
 */

import { NOTE_HTML_STYLE } from './style';
import { bodyHasKatex, getKatexStyle } from './katex-css';

export interface HtmlShellInput {
  title: string;
  body: string;
  /**
   * When set, link to an external stylesheet via this href instead of
   * inlining `NOTE_HTML_STYLE`. Used by the tree-html bundle exporter
   * (#292) so all pages share one `style.css` at the bundle root.
   */
  stylesheetHref?: string;
  /**
   * Optional sidebar HTML rendered to the left of the article. The
   * tree-html bundle uses this to surface a nav listing every page in
   * the bundle (#292). When omitted, the page renders without a
   * sidebar (single-note default).
   */
  sidebarHtml?: string;
  /**
   * Inline the KaTeX woff2 fonts as data URLs when the body contains
   * math (#327). Default true; the per-export flag flips this to false
   * to drop the ~300KB font payload and render math in the document's
   * serif fallback.
   */
  inlineMathFonts?: boolean;
}

export function wrapHtml(input: HtmlShellInput): string {
  const title = escapeHtml(input.title || 'Untitled');
  const generatedAt = new Date().toISOString();
  // KaTeX CSS only ships when the body actually contains math output —
  // a math-free export pays nothing for the feature. Tree-html bundles
  // (those use stylesheetHref) get KaTeX folded into the shared
  // style.css at the bundle root rather than per-page, so this branch
  // only fires for the single-file path.
  const katexInline = !input.stylesheetHref && bodyHasKatex(input.body)
    ? `<style>${getKatexStyle({ inlineFonts: input.inlineMathFonts !== false })}</style>`
    : '';
  const styleBlock = input.stylesheetHref
    ? `<link rel="stylesheet" href="${escapeHtml(input.stylesheetHref)}">`
    : `<style>${NOTE_HTML_STYLE}</style>${katexInline}`;
  const articleClass = input.sidebarHtml ? 'minerva-export with-sidebar' : 'minerva-export';
  const sidebarPrefix = input.sidebarHtml ? `<aside class="bundle-nav">${input.sidebarHtml}</aside>` : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="generator" content="Minerva">
  <meta name="minerva-export-version" content="1">
  ${styleBlock}
</head>
<body class="${articleClass}">
  ${sidebarPrefix}
  <article>
${input.body}
    <footer class="export-meta">
      <p>Exported from Minerva on ${escapeHtml(generatedAt)}.</p>
    </footer>
  </article>
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
