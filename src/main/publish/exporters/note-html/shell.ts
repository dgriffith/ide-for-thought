/**
 * HTML document shell for the note-html exporter (#248).
 */

import { NOTE_HTML_STYLE } from './style';

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
}

export function wrapHtml(input: HtmlShellInput): string {
  const title = escapeHtml(input.title || 'Untitled');
  const generatedAt = new Date().toISOString();
  const styleBlock = input.stylesheetHref
    ? `<link rel="stylesheet" href="${escapeHtml(input.stylesheetHref)}">`
    : `<style>${NOTE_HTML_STYLE}</style>`;
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
