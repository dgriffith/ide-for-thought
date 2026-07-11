# Publishing a thoughtbase as a static site

The **static-site exporter** (Export → Publish as Website) turns a project into a
browsable HTML site — one page per note, plus tag pages, a search index, and
consolidated references. This reference covers the knobs that shape the output.

## Site config — `.minerva/site-config.json`

Travels with the project via git, so different thoughtbases ship different sites.
All fields are optional:

| Field | Default | Meaning |
|-------|---------|---------|
| `title` | **the project folder name** (#1134) | Site title in `<title>`, the header, and the All-Notes heading. |
| `baseUrl` | `""` | Absolute site URL. When set, pages emit `<link rel="canonical">` + `og:url`. Empty ⇒ those absolute-URL tags are omitted. |
| `landing` | `""` | Note used as `index.html`. Empty ⇒ a generated "All Notes" list. |
| `excludeTags` | `["draft"]` | Notes with any of these tags are left out of the site. |
| `excludeFolders` | `[]` | Folder paths whose notes are excluded. |
| `showBacklinks` | `true` | Show the per-note "Linked from" section. |

## Custom site styling — `.minerva/site.css` (#1135)

Drop a `.minerva/site.css` in the project; it's copied into the output and linked
**after** the default `style.css`, so its rules win the cascade. The default
stylesheet is CSS-variable themed — override those `:root` custom properties for a
whole-site restyle without fighting selectors:

```css
:root {
  --accent: #b5179e;
  --bg: #0e0e10;
  --fg: #eeeeee;
}
```

Overridable variables: `--fg`, `--fg-muted`, `--fg-faint`, `--bg`, `--bg-elev`,
`--accent`, `--border`, `--code-bg`, `--strike`. Full selector overrides work too.
No `site.css` ⇒ output is unchanged.

## Per-note publishing frontmatter — the `publish:` block (#1136)

A note can drive its own share card and styling from YAML frontmatter. Publication
concerns are namespaced under a `publish:` block so they stay out of the knowledge
graph and can't collide with your own frontmatter. `description` reuses the
canonical top-level key (it's already `dc:description`).

```yaml
---
title: My Note
description: A short blurb used for the share card + <meta name="description">.
publish:
  image: https://example.com/card.png   # share image — must be an ABSOLUTE URL
  background: "#faf3e0"                   # page background (validated CSS color/token)
  css: styles/fancy.css                  # project-relative stylesheet(s) for this page
---
```

- **Social / Open Graph.** `description` + `image` produce `og:*` / `twitter:*`
  tags so a shared link renders a real card. `og:image` requires an **absolute
  URL** (scrapers can't resolve relative paths); with `baseUrl` set you also get
  `og:url` + canonical.
- **`background`** is validated to a safe CSS color/token (a hex color, a color
  keyword, `rgb()/hsl()`, or `var(--x)`) — a value that could break out of the
  rule is dropped, not injected.
- **`css`** is a project-relative `.css` path (or a list); each is copied into the
  output and linked after the site stylesheet on that page only. Traversal /
  absolute / URL references are ignored.

Notes without any of these keys publish exactly as before.
