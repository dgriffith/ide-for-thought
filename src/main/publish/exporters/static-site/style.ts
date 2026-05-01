/**
 * Shared stylesheet for the static-site exporter (#252).
 *
 * Emitted as `style.css` at the site root and linked from every page
 * via a relative path. Designed for "digital garden" reading — quiet
 * typography, calm contrast, sidebar that gets out of the way.
 */

export const STATIC_SITE_STYLE = `
:root {
  --fg: #1a1a1a;
  --fg-muted: #5a5a5a;
  --fg-faint: #8a8a8a;
  --bg: #fdfdfa;
  --bg-elev: #f4f3ee;
  --accent: #2563eb;
  --border: #e5e3dc;
  --code-bg: #f5f4ef;
  --strike: #b00020;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e8e6df;
    --fg-muted: #b0aea7;
    --fg-faint: #888680;
    --bg: #1d1d1b;
    --bg-elev: #262624;
    --accent: #6ea8fe;
    --border: #353330;
    --code-bg: #2a2a28;
    --strike: #ef9a9a;
  }
}
* { box-sizing: border-box; }
html { font-size: 16px; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 0.06em; }
a:hover { text-decoration-thickness: 0.12em; }

/* Top nav */
nav.site-nav {
  position: sticky;
  top: 0;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 0.7em 1em;
  display: flex;
  align-items: center;
  gap: 1em;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-size: 0.95em;
  z-index: 10;
}
nav.site-nav .site-title {
  font-weight: 600;
  margin-right: auto;
  color: var(--fg);
  text-decoration: none;
}
nav.site-nav a { text-decoration: none; color: var(--fg-muted); }
nav.site-nav a:hover { color: var(--fg); }
nav.site-nav input.site-search {
  border: 1px solid var(--border);
  background: var(--bg-elev);
  color: var(--fg);
  padding: 0.3em 0.6em;
  border-radius: 4px;
  font-size: 0.9em;
  min-width: 160px;
}

/* Page layout */
.page {
  max-width: 60em;
  margin: 0 auto;
  padding: 2em 1em 4em;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 14em;
  gap: 2em;
}
@media (max-width: 720px) {
  .page { grid-template-columns: 1fr; }
}
article { min-width: 0; }
aside.note-meta {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-size: 0.85em;
  color: var(--fg-muted);
  border-left: 1px solid var(--border);
  padding-left: 1em;
}
aside.note-meta h3 {
  font-size: 0.7em;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-faint);
  margin: 0 0 0.4em;
}
aside.note-meta ul { list-style: none; padding: 0; margin: 0 0 1.5em; }
aside.note-meta li { margin-bottom: 0.25em; }
aside.note-meta a { color: var(--fg); text-decoration: none; }
aside.note-meta a:hover { text-decoration: underline; }

/* Article body */
article h1, article h2, article h3 {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-weight: 600;
  line-height: 1.25;
}
article h1 { font-size: 1.9em; margin-top: 0; }
article h2 { font-size: 1.3em; margin-top: 1.6em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
article h3 { font-size: 1.1em; margin-top: 1.2em; }
article p { margin: 0 0 1em; }
article img { max-width: 100%; height: auto; }
article code {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 0.9em;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.05em 0.35em;
}
article pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.7em 0.9em;
  overflow-x: auto;
}
article pre code { background: none; border: none; padding: 0; }
article blockquote {
  margin: 1em 0;
  padding: 0.3em 1em;
  border-left: 3px solid var(--border);
  color: var(--fg-muted);
}
article .wikilink-broken { text-decoration: line-through; color: var(--strike); }

/* Per-note backlinks */
.backlinks {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
}
.backlinks h2 {
  font-size: 0.9em;
  font-weight: 600;
  color: var(--fg-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-bottom: none;
  margin: 0 0 0.5em;
}
.backlinks ul { list-style: none; padding: 0; margin: 0; }
.backlinks li { margin-bottom: 0.3em; }

/* Tag cloud */
.tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5em; padding: 0; list-style: none; }
.tag-cloud li a {
  display: inline-block;
  padding: 0.2em 0.7em;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 999px;
  text-decoration: none;
  color: var(--fg);
  font-size: 0.9em;
}
.tag-cloud .count { color: var(--fg-faint); margin-left: 0.4em; font-size: 0.85em; }

/* Search results */
#search-results {
  max-width: 60em;
  margin: 0 auto;
  padding: 0 1em;
}
#search-results.hidden { display: none; }
#search-results .hit {
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.6em 1em;
  margin-bottom: 0.6em;
  background: var(--bg-elev);
}
#search-results .hit h4 { margin: 0 0 0.2em; font-size: 1em; }
#search-results .hit p { margin: 0; font-size: 0.85em; color: var(--fg-muted); }

/* Footnotes / references — share styling with the note-html exporter
 * shape but tone down to fit the calmer site palette. */
.footnote-ref { font-size: 0.75em; vertical-align: super; line-height: 0; margin-left: 0.1em; }
.footnote-back { margin-left: 0.4em; text-decoration: none; color: var(--accent); }
.footnotes, .references {
  margin-top: 3em;
  padding-top: 1em;
  border-top: 1px solid var(--border);
  font-size: 0.92em;
}
.footnotes ol, .references ol { padding-left: 1.7em; }

/* highlight.js minimal light scheme — same as note-html exporter. */
.hljs-comment, .hljs-quote { color: #7a8288; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-addition { color: #8959a8; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #f5871f; }
.hljs-string, .hljs-doctag, .hljs-link, .hljs-attribute { color: #718c00; }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #4271ae; }
.hljs-type, .hljs-class .hljs-title { color: #c82829; }
.hljs-symbol, .hljs-bullet, .hljs-built_in, .hljs-builtin-name { color: #3e999f; }
`;
