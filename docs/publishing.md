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

## Where the output goes — publish destinations

Rendering (this exporter) and shipping are separate concerns: the exporter
produces a file tree, and a **transport** puts it somewhere
(`src/main/publish/transport/`, seam added in #1444). Two exist.

### Git remote (`kind: 'git'`, the default)

`publish-to-git.ts` runs the exporter into a per-target checkout under
`.minerva/publish-cache/<target-id>/`, commits, and pushes. The git stack is
**isomorphic-git** — HTTPS only, no SSH and no credential helper — so auth is a
token: the target's own (encrypted via safeStorage), else `gh auth token`, else
`GH_TOKEN`/`GITHUB_TOKEN`. SSH remote URLs are rewritten to HTTPS.

The branch is created when absent: a clone of a missing ref falls back to
`git init` on that branch, and the push creates it remotely.

For **github.com** remotes specifically, `git/github-repo.ts` adds REST-only
provisioning the git protocol can't do (#254 follow-on):

- **Repo creation** is offered when the repo 404s, never automatic — the flow
  returns `repoMissing` with nothing exported and waits for an explicit
  `createRepo: { private }` from the UI. Routes to `POST /user/repos` or
  `POST /orgs/{owner}/repos` depending on whether the owner is the token's own
  account.
- **Pages** is switched on after the first push (it rejects a branch that
  doesn't exist yet) and never fails the publish — a Pages problem is reported
  as `pagesNote` beside a successful push. Pages serves only `/` or `/docs`;
  any other `subdir` is reported rather than silently mis-wired.
- **Everything above is gated on `parseGitHubRepo` returning non-null**, so
  GitLab / Codeberg / self-hosted remotes push with no provisioning attempted.

> **GitHub reports success before the state it implies is true.** Repo creation
> returns 201 before the repo takes git traffic; Pages 500s while it catches up
> with a just-pushed branch; and isomorphic-git's `clone` of a *zero-ref* remote
> returns early **without throwing and without checking out**, leaving the
> workspace on the default branch name. All three produced real first-publish
> failures. The code waits for the repo, retries Pages on 5xx, and verifies the
> workspace is actually on the target branch rather than trusting that the clone
> didn't throw. Treat "the API said OK" as a hypothesis on this path.

### S3 / S3-compatible (`kind: 's3'`)

One shape covers Amazon S3 and R2 / B2 / Spaces / MinIO via a custom `endpoint`
(blank ⇒ AWS). `subdir` is the key prefix. The secret access key is write-only
across IPC and stored encrypted; only `hasSecret` reaches the renderer. Minerva
uploads objects — enabling website hosting or fronting the bucket with a CDN is
the provider's business, not the app's.
