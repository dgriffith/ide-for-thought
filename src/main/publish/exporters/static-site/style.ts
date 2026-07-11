/**
 * Shared stylesheet for the static-site exporter (#252).
 *
 * Emitted as `style.css` at the site root and linked from every page
 * via a relative path. Designed for "digital garden" reading — quiet
 * typography, calm contrast, sidebar that gets out of the way.
 *
 * ── Override surface (#1135) ────────────────────────────────────────────────
 * Drop a `.minerva/site.css` in the project to restyle the published site; it's
 * copied into the output and linked AFTER this stylesheet, so it wins the
 * cascade. The `:root` custom properties below are the intended, stable
 * override points — a few lines restyle the whole site without fighting
 * selectors, e.g.:
 *
 *     :root { --accent: #b5179e; --bg: #0e0e10; --fg: #eee; }
 *
 * Full selector overrides work too. Overridable variables: --fg, --fg-muted,
 * --fg-faint, --bg, --bg-elev, --accent, --border, --code-bg, --strike.
 */

export const STATIC_SITE_STYLE = `
:root {
  /* Calm, warm "reading" defaults — soft ink on warm paper, a muted slate-blue
     link rather than an electric one. All overridable via .minerva/site.css. */
  --fg: #2b2a27;
  --fg-muted: #6b6862;
  --fg-faint: #97948d;
  --bg: #fbf9f3;
  --bg-elev: #f2efe7;
  --accent: #47698e;
  --border: #e7e3d9;
  --code-bg: #f2efe7;
  --strike: #a8574c;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e6e3da;
    --fg-muted: #a9a69d;
    --fg-faint: #7d7a72;
    --bg: #1c1c1a;
    --bg-elev: #262523;
    --accent: #93b1d1;
    --border: #34322e;
    --code-bg: #262523;
    --strike: #d69b93;
  }
}
* { box-sizing: border-box; }
html { font-size: 16px; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: Georgia, "Iowan Old Style", "Palatino Linotype", serif;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}
/* Softer links: muted color + a light, offset underline rather than a stark one. */
a { color: var(--accent); text-decoration: underline; text-decoration-thickness: 0.05em; text-underline-offset: 0.16em; text-decoration-color: var(--border); }
a:hover { text-decoration-color: var(--accent); }

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

/* ── Structure sidebar layout (#1133) ─────────────────────────────────────── */
.site-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width, 15em) minmax(0, 1fr);
  align-items: start;
}
.site-sidebar {
  position: sticky;
  top: 3.1em; /* clears the sticky top nav */
  max-height: calc(100vh - 3.1em);
  overflow-y: auto;
  padding: 1.4em 0.9em;
  border-right: 1px solid var(--border);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, sans-serif;
  font-size: 0.88em;
}
.site-brand {
  display: block;
  font-weight: 700;
  font-size: 1.08em;
  color: var(--fg);
  text-decoration: none;
  margin-bottom: 1em;
}
.site-tree ul { list-style: none; margin: 0; padding-left: 0.85em; }
.site-tree > ul { padding-left: 0; }
.site-tree li { margin: 0.1em 0; }
.site-tree a {
  display: block;
  padding: 0.12em 0.4em;
  border-radius: 3px;
  color: var(--fg-muted);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.site-tree a:hover { color: var(--fg); background: var(--bg-elev); }
.site-tree a[aria-current="page"] { color: var(--fg); font-weight: 700; background: var(--bg-elev); }
.site-tree summary {
  cursor: pointer;
  padding: 0.12em 0.4em;
  color: var(--fg);
  font-weight: 600;
}
.site-tree summary:hover { background: var(--bg-elev); border-radius: 3px; }

/* Sidebar toggle — a hamburger shown only on narrow screens. CSS-only. */
.sidebar-toggle { display: none; cursor: pointer; user-select: none; font-size: 1.1em; color: var(--fg-muted); }
.sidebar-toggle:hover { color: var(--fg); }

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
@media (max-width: 640px) {
  /* Only on genuinely narrow screens does the sidebar fold to a toggle, so the
     note stays readable; typical windows keep the two-column reading layout. */
  .site-layout { grid-template-columns: 1fr; }
  .site-sidebar { display: none; position: static; max-height: none; border-right: none; border-bottom: 1px solid var(--border); }
  .sidebar-toggle-cb:checked ~ .site-layout .site-sidebar { display: block; }
  .sidebar-toggle { display: inline-block; }
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

/* Source pages (#252 follow-up) */
.source-citation { margin: 0 0 1em; font-size: 1.02em; }
.source-links { margin: 0 0 1.5em; font-size: 0.92em; word-break: break-all; }
.source-abstract h2, .cited-by h2, .source-excerpts h2 {
  font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--fg-muted); margin: 1.6em 0 0.6em;
}
.source-abstract p { color: var(--fg); }
.cited-by ul { list-style: none; padding: 0; margin: 0; }
.cited-by li { margin-bottom: 0.3em; }
.excerpt {
  margin: 0 0 1em; padding: 0.4em 0 0.4em 1em;
  border-left: 3px solid var(--border); color: var(--fg);
}
.excerpt .loc { display: block; font-size: 0.8em; color: var(--fg-faint); font-style: normal; margin-bottom: 0.2em; }
.excerpt-notes { font-size: 0.85em; color: var(--fg-muted); margin-top: 0.3em; }

/* highlight.js minimal light scheme — same as note-html exporter. */
.hljs-comment, .hljs-quote { color: #7a8288; font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-addition { color: #8959a8; }
.hljs-number, .hljs-literal, .hljs-variable, .hljs-template-variable, .hljs-tag .hljs-attr { color: #f5871f; }
.hljs-string, .hljs-doctag, .hljs-link, .hljs-attribute { color: #718c00; }
.hljs-title, .hljs-section, .hljs-name, .hljs-selector-id, .hljs-selector-class { color: #4271ae; }
.hljs-type, .hljs-class .hljs-title { color: #c82829; }
.hljs-symbol, .hljs-bullet, .hljs-built_in, .hljs-builtin-name { color: #3e999f; }
`;
