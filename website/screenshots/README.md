# Docs screenshot harness

Drives the **real Electron app** against a copy of the demo thoughtbase and
writes PNGs into `website/docs/img/`, so the documentation screenshots stay
honest as the app evolves.

## Run

```sh
pnpm build:e2e   # once — (re)builds the packaged app the harness launches
npx playwright test --config=website/screenshots/playwright.config.ts
```

## How it works

- `lib/harness.ts` — launches the packaged binary via Playwright's Electron
  support, restoring a **copy** of `~/vaults/demo` through a seeded
  `session.json` (same trick as the e2e smoke suite, so no open-dialog
  click-through). The copy means captures can never dirty the real vault.
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

- States that would otherwise need a live model (conversations, proposals) are
  captured from **pre-baked fixtures already in the demo vault** — no API key,
  fully repeatable.
- Prefer **Preview** view for feature pages (rendered output) and **Source**
  view for editor/writing pages. Click the view toggle in the recipe before
  shooting.
