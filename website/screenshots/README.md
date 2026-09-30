# Docs screenshot harness

Drives the **real Electron app** against a copy of the demo thoughtbase and
writes PNGs into `website/docs/img/`, so the documentation screenshots stay
honest as the app evolves.

## Run

```sh
pnpm build:e2e   # once — (re)builds .vite/build, which the harness launches
npx playwright test --config=website/screenshots/playwright.config.ts
node website/screenshots/swap-shots.mjs && pnpm build:docs   # docs pages
node website/screenshots/swap-marketing-shots.mjs            # marketing pages
```

## How it works

- `lib/harness.ts` — launches the **in-tree build** through the e2e suite's
  `launchMinerva`, restoring a **copy** of `~/vaults/demo` through a seeded
  `session.json` (so no open-dialog click-through). The copy means captures
  can never dirty the real vault, and `launchMinerva` isolates the profile,
  the environment and HOME, so your own skills and MCP servers never show up
  in a shot. Not the packaged binary: since the #2366 fuses it refuses the
  `--inspect` Playwright's Electron driver needs, and recipes that replay
  main → renderer events use `app.evaluate`, which only the driver provides.
  `launchEmpty()` opens a brand-new empty thoughtbase instead, for the
  first-run onboarding wizard.
  Forces the **Honey** theme, a fixed **1440×900** window, and **2×** device
  scale so every image is crisp and consistent.
- `capture.spec.ts` — one `test` per shot. Each opens/navigates to a state and
  calls `shoot(win, id, locator?)` — pass a locator to crop to an element, or
  omit it for the full window. The `id` becomes `website/docs/img/<id>.png`.

## Adding a shot

1. Add a `test('…')` that navigates to the state (helpers: `openNote`, panel
   tabs via `getByTitle('Sources')`, etc.).
2. Name it with the doc placeholder's id so the page can reference
   `img/<id>.png`.
3. In the doc page, swap the `<div class="shot">` placeholder for a
   `<figure><img src="img/<id>.png" alt="…"><figcaption>…</figcaption></figure>`.

## Notes

- States that would otherwise need a live model are staged, never faked in
  the UI: conversations are written from `fixtures/*/conv-*.json`, and draft
  cards arrive by replaying the real main → renderer event with
  `app.evaluate` (`capture-conversations.spec.ts`, and
  `capture-refactoring.spec.ts`, whose reorg draft is real `planReorg`
  output). No API key, fully repeatable.
- The scanned-PDF OCR offer ingests `fixtures/ingest/scanned-mandolin-method.pdf`
  (image-only, no text layer) through the real Ingest URL path, served from a
  loopback HTTP server inside the spec.
- Prefer **Preview** view for feature pages (rendered output) and **Source**
  view for editor/writing pages. Click the view toggle in the recipe before
  shooting.
