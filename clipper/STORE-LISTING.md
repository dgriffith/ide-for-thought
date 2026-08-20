# Chrome Web Store listing — Minerva Clipper

Copy-paste source for the Chrome Web Store Developer Dashboard fields, kept in
the repo so it's version-controlled and ready for the next version bump. Build
the upload artifact with `pnpm package:clipper` →
`clipper/minerva-clipper-<version>.zip` (manifest at the archive root, as the
store requires).

**Distribution:** Unlisted. The extension is a companion to the Minerva desktop
app and is useless without it, so it's published unlisted (installable by link,
hidden from search/browse) until the desktop app's distribution is sorted. Going
public later is a single toggle in *Distribution → Visibility* — no re-upload.

---

## Single-purpose description

> Minerva Clipper saves the web page you're currently reading into your local
> Minerva desktop app as a Source, optionally including your text selection as a
> linked excerpt.

## Detailed description

> **Save what you're reading straight into Minerva.**
>
> Minerva Clipper captures the page you're on — title, content, and your text
> selection — and sends it to your Minerva desktop app as a **Source**, with
> your highlighted passage saved as a linked **excerpt**.
>
> Because the browser sends the **rendered HTML it can already see**,
> authenticated and paywalled pages you have legitimate access to extract
> correctly. Minerva does the article extraction locally; the extension just
> hands off what's on your screen.
>
> **Two ways to save**
> - **Curate, then save** — click the toolbar button to open a popup. It shows
>   the page title and the canonical Source id your save will produce (e.g.
>   `arxiv-2604.18561`), and lets you add tags and a note before saving.
> - **Instant save** — press ⌘⇧S / Ctrl+Shift+S on any page. No popup, defaults
>   only. A badge flashes ✓ on success.
>
> **Private by design**
> Minerva Clipper talks **only** to the Minerva app running on your own
> computer, over a local loopback connection (127.0.0.1). Nothing is sent to any
> external server, and there is no tracking or analytics. The extension stores
> only a pairing code so it can reconnect to your app.
>
> **Requires the Minerva desktop app.** Pair once via Settings → Browser
> Clipper, and you're set.

## Category / language

- **Category:** Productivity
- **Language:** English

---

## Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | When the user clicks the toolbar button or presses the keyboard shortcut, the extension reads the current tab's rendered HTML and text selection so it can be saved. Access is granted only for that one user-initiated action. |
| `scripting` | Used with `activeTab` to inject a one-shot function that returns the page's `outerHTML`, title, and current selection. No persistent or broad content-script injection. |
| `storage` | Stores only the local pairing data (a loopback port number and a shared secret) so the extension can reconnect to the user's running Minerva app. No browsing data is stored. |
| Host `http://127.0.0.1/*` | The extension talks **only** to the Minerva desktop app running on the user's own machine over loopback (127.0.0.1). It posts the captured page to a local `/ingest` endpoint. No external/remote server is ever contacted. |
| Remote code | **No** — all code is bundled in the package; nothing is fetched at runtime. |

## Notes for reviewer

> This extension is a companion to the Minerva desktop application. It only
> transmits data to the user's own machine over loopback (127.0.0.1) — there is
> no remote backend. Without the desktop app installed and paired, the toolbar
> button will show a "not paired" state, which is expected. All capture logic is
> in `background.js`/`popup.js`; the host permission is strictly localhost.

---

## Privacy practices (dashboard certifications)

- **Data collected:** Website content (page HTML/selection read on user action).
  Everything else: not collected.
- **Certifications** — all three are true, check all:
  - I do not sell or transfer user data to third parties, outside of approved use cases.
  - I do not use or transfer user data for purposes unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending.
- **Where data goes:** page content is transmitted only to the user's own
  machine (localhost). State this explicitly in the data-use text.

## Privacy policy URL (required)

**https://dgriffith.github.io/minerva/privacy.html#clipper**

The policy is the *Web capture and sources* section of the Minerva website's
privacy page. It covers what the extension reads, when, where it goes (loopback
only), what it stores (the pairing credential), and the three store
certifications.

The page's source is `website/privacy.html` in this repo; the live site is the
`gh-pages` branch of `dgriffith/minerva`, published by
`./scripts/deploy-to-gh-pages.sh`. **Editing the section is not enough — run
that script, or the store will still be pointing at the old text.**

Don't keep a second copy of the policy prose here that can drift from the
hosted one.

---

## Manual assets to produce (not in the zip)

- **Screenshots** — at least one, 1280×800 or 640×400. Best shot: the popup open
  over an article showing the tag/note fields and the live Source id.
- **Store icon** — 128×128. Upload `clipper/icons/icon-128.png`.
- **Small promo tile** (optional) — 440×280.

## Submission checklist

- [ ] `pnpm package:clipper` → upload `clipper/minerva-clipper-<version>.zip`
- [ ] Bump `version` in `clipper/manifest.json` for every resubmission
- [ ] Visibility → Unlisted
- [ ] `./scripts/deploy-to-gh-pages.sh` run, so the live privacy page carries
      the current clipper section
- [ ] Privacy policy URL set to the link above (confirm the `#clipper`
      anchor resolves on the live site first)
- [ ] Permission justifications + reviewer notes filled in
- [ ] Privacy practices certified
- [ ] Screenshot + 128×128 icon uploaded
