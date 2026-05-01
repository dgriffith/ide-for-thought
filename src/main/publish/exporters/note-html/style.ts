/**
 * Reader-friendly stylesheet for HTML exports (#248).
 *
 * Shipped inlined in every exported file so the result is a standalone
 * artifact — no external fonts, no external stylesheets, no external
 * code. Print rules piggyback here so the same HTML file prints cleanly
 * from any browser, which is what the PDF exporter will lean on.
 */

export const NOTE_HTML_STYLE = `
:root {
  --fg: #1a1a1a;
  --fg-muted: #4a4a4a;
  --bg: #fcfcfc;
  --accent: #0066cc;
  --border: #e1e1e1;
  --code-bg: #f5f5f5;
  --code-border: #e5e5e5;
  --quote-border: #d0d0d0;
}
* { box-sizing: border-box; }
html { font-size: 16px; }
body {
  margin: 0;
  padding: 48px 16px 96px;
  background: var(--bg);
  color: var(--fg);
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
article { max-width: 72ch; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  line-height: 1.25;
  font-weight: 600;
  margin: 2em 0 0.6em;
}
h1 { font-size: 2em; margin-top: 0; }
h2 { font-size: 1.45em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
h3 { font-size: 1.2em; }
h4, h5, h6 { font-size: 1em; }
p { margin: 0 0 1em; }
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 0.06em; text-underline-offset: 0.15em; }
a:hover { text-decoration-thickness: 0.12em; }
strong { font-weight: 600; }
em { font-style: italic; }
.wikilink-unresolved { color: var(--fg-muted); font-style: italic; }
blockquote {
  margin: 1em 0;
  padding: 0.3em 1.2em;
  border-left: 3px solid var(--quote-border);
  color: var(--fg-muted);
}
ul, ol { margin: 0 0 1em; padding-left: 1.5em; }
li > p { margin: 0 0 0.4em; }
hr { border: none; border-top: 1px solid var(--border); margin: 2em 0; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 3px;
  padding: 0.1em 0.4em;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--code-border);
  border-radius: 4px;
  padding: 0.8em 1em;
  overflow-x: auto;
  line-height: 1.5;
}
pre code {
  background: none;
  border: none;
  padding: 0;
  font-size: 0.9em;
}
table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
  font-size: 0.95em;
}
th, td { padding: 0.4em 0.8em; border: 1px solid var(--border); text-align: left; vertical-align: top; }
th { background: var(--code-bg); font-weight: 600; }
.footnote-ref {
  font-size: 0.75em;
  vertical-align: super;
  line-height: 0;
  margin-left: 0.1em;
}
.footnote-ref a { text-decoration: none; }
.footnote-back {
  margin-left: 0.4em;
  text-decoration: none;
  color: var(--accent);
  font-size: 0.85em;
}
.footnote-back:hover { text-decoration: underline; }
.footnotes {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.9em;
  color: var(--fg-muted);
}
.footnotes h2 {
  border-bottom: none;
  margin: 0 0 0.6em;
  font-size: 1.15em;
  color: var(--fg);
}
.footnotes ol { padding-left: 2em; }
.footnotes li { margin-bottom: 0.4em; }
.references {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.95em;
}
.references h2 {
  border-bottom: none;
  margin: 0 0 0.6em;
  font-size: 1.15em;
}
.references ol { padding-left: 1.5em; }
.references li { margin-bottom: 0.6em; }
.export-meta {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 0.8em;
  text-align: right;
}

/* highlight.js token styling — minimal light theme so code fences
 * render readably without pulling an external stylesheet. */
.hljs-comment, .hljs-quote { color: #7a8288; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-addition { color: #8959a8; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #f5871f; }
.hljs-string, .hljs-doctag, .hljs-link, .hljs-attribute { color: #718c00; }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #4271ae; }
.hljs-type, .hljs-class .hljs-title { color: #c82829; }
.hljs-symbol, .hljs-bullet, .hljs-built_in, .hljs-builtin-name { color: #3e999f; }
.hljs-meta { color: #7a8288; }
.hljs-deletion { color: #c82829; }

@media print {
  body { padding: 0; background: #fff; }
  article { max-width: none; }
  a { color: var(--fg); text-decoration: none; }
  h1, h2, h3 { page-break-after: avoid; }
  pre, blockquote, table, img { page-break-inside: avoid; }
  .export-meta { display: none; }
}
`;
