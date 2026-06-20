# Minerva Clipper (Chrome, MV3)

One-click capture of the page you're reading into Minerva as a Source — your
selection rides along as a linked excerpt. The browser sends the **rendered
HTML it can see**, so authenticated / paywalled pages extract correctly (the
app does the Readability extraction, not the extension).

This is the first cut (#792): Chrome only, save-with-defaults, no popup UI.
Richer popup (tags / note / id preview) is #793; packaging/signing is #795.

## Build

```sh
pnpm build:clipper      # → clipper/dist/
pnpm typecheck:clipper  # tsc over the extension sources
```

## Install (unpacked)

1. `pnpm build:clipper`
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick `clipper/dist`.
3. Click the puzzle-piece (Extensions) icon → **Pin** *Minerva Clipper* so its
   button stays on the toolbar. (Until packaging adds an icon, it shows a
   default placeholder.)

## Pair

1. In Minerva: **Settings → Browser Clipper** → enable it, open a thoughtbase,
   and copy the **pairing code**.
2. Click the extension's **Details → Extension options** (or the `?` badge the
   first time you use it) and paste the code → **Pair**. **Test connection**
   confirms the secret + whether a thoughtbase is open.

## Use

- Click the toolbar button (pin it first — see Install), or press
  **⌘⇧S / Ctrl+Shift+S**, on any page.
- A badge flashes **✓** on success, **!** on failure, **?** if not yet paired.

## How it talks to Minerva

POSTs `{ url, html, selection?, pageTitle }` to the app's loopback endpoint
(`http://127.0.0.1:<port>/ingest`) with the shared secret in the
`x-minerva-clipper-secret` header. The request goes out from the **service
worker** (extension origin) — the endpoint rejects content-script / web-page
origins, so capture and send are deliberately split.

> Icons are intentionally omitted for the unpacked dev build; Chrome shows a
> default. A branded icon set lands with packaging (#795).
