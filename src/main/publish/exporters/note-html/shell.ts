/**
 * HTML document shell for the note-html exporter (#248).
 */

import { NOTE_HTML_STYLE } from './style';

export interface HtmlShellInput {
  title: string;
  body: string;
}

export function wrapHtml(input: HtmlShellInput): string {
  const title = escapeHtml(input.title || 'Untitled');
  const generatedAt = new Date().toISOString();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <meta name="generator" content="Minerva">
  <meta name="minerva-export-version" content="1">
  <style>${NOTE_HTML_STYLE}</style>
</head>
<body class="minerva-export">
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
