# Minerva Clipper (Chrome, MV3)

One-click capture of the page you're reading into Minerva as a Source — your
selection rides along as a linked excerpt. The browser sends the **rendered
HTML it can see**, so authenticated / paywalled pages extract correctly (the
app does the Readability extraction, not the extension).

Chrome only for now (#792). The toolbar button opens a popup to curate before
saving — add tags / a note and confirm the canonical source id (#793) — while
the keyboard shortcut stays a no-UI instant save. Installs unpacked today;
Chrome Web Store listing + signing is the remaining part of #795.

## Build

```sh
pnpm build:clipper      # → clipper/dist/ (load this unpacked during dev)
pnpm package:clipper    # → clipper/minerva-clipper-<version>.zip (shareable / Web Store upload)
pnpm typecheck:clipper  # tsc over the extension sources
```

`package:clipper` rebuilds `dist/` and zips its contents (manifest at the archive
root). You don't need the zip for local install — "Load unpacked" points straight
at `dist/`.

## Install (unpacked)

1. `pnpm build:clipper`
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `clipper/dist`.
3. Click the puzzle-piece (Extensions) icon → **Pin** *Minerva Clipper* so its
   button stays on the toolbar.

## Pair

1. In Minerva: **Settings → Browser Clipper** → enable it, open a thoughtbase,
   and copy the **pairing code**.
2. Click the extension's **Details → Extension options** (or the `?` badge the
   first time you use it) and paste the code → **Pair**. **Test connection**
   confirms the secret + whether a thoughtbase is open.

## Use

- **Curate, then save:** click the toolbar button (pin it first — see Install)
  to open the popup. It shows the page title + the canonical source **id** the
  save will produce (e.g. `arxiv-2604.18561`), and lets you add **tags** and a
  **note** before hitting **Save**. A current text selection is saved as a
  linked excerpt.
- **Instant save:** press **⌘⇧S / Ctrl+Shift+S** on any page — no popup,
  defaults only. A badge flashes **✓** on success, **!** on failure, **?** if
  not yet paired.

## How it talks to Minerva

- `POST /ingest` — `{ url, html, pageTitle, selection?, tags?, note? }` saves the
  Source (and an excerpt / tags / about-note as supplied).
- `POST /preview` — `{ url, html }` → `{ sourceId, method, title }`: the id the
  save *would* produce, with no write. Powers the popup's live id preview.

Both carry the shared secret in the `x-minerva-clipper-secret` header and go to
`http://127.0.0.1:<port>`. Requests originate from the extension (popup /
service worker), whose `chrome-extension://` origin the endpoint accepts — it
rejects content-script / web-page origins, so capture and send are split.

Branded toolbar + extension icons live in `clipper/icons/` (16/32/48/128) and
are copied into `dist/` by the build. `pnpm package:clipper` zips a release
artifact; the Chrome Web Store listing + review is the open part of #795.
