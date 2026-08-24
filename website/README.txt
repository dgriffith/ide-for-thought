Minerva site — draft pages
==========================

Files:
  minerva.css          Shared design system (palette + type extracted from your
                       features page, so the whole site is one coherent look).
  index.html           Front page — NEW. Thesis, trust hook, download CTA.
  getting-started.html Download + first-run flow (merged). Notarization trust signal.
  privacy.html         Local-first as a selling point. Honest about the AI-call exception.
  about.html           SCAFFOLD — structure drafted, your voice-passages marked in blue.
  features.html        (drop your existing features page here — it already fits this system)

All pages expect minerva.css alongside them and link to features.html.
Blue dashed blocks = author-fill markers (only visible in draft; delete when filled).
Dashed screenshot boxes = where real product images/screencasts go.

Nav order is consistent across pages: Features · Getting Started · About · Privacy · [Download]

docs/ is GENERATED — do not hand-edit docs/*.html
=================================================

Every page under docs/ is produced by `pnpm build:docs`
(scripts/build-docs.mjs) from three inputs, and the output is committed
because gh-pages deploys the repo as-is:

  docs/_layout.html    the shared chrome (head, top nav, footer) with
                       {{title}} {{description}} {{sidebar}} {{content}}
  docs/_nav.json       the nav tree — sections, items, children. Drives every
                       page's sidebar, breadcrumbs and prev/next pager.
  docs/_content/*.html one fragment per page: `title`/`description`
                       front-matter plus the page body, named for the page it
                       produces.

To edit a page, edit its fragment. To add one, add a fragment and one entry in
_nav.json — every other page's sidebar and pager follows. Then run
`pnpm build:docs` and commit the regenerated HTML;
tests/scripts/docs-generated.test.ts fails if the two ever disagree.

The same fragments are the input to the in-app help search corpus
(scripts/build-help-corpus.mjs).
