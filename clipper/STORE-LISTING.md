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

## Privacy practices tab — copy-paste fields

The dashboard blocks submission until **every** field below is filled, and it
puts them all on the *Privacy practices* tab (including the single-purpose
description, even though it reads like a listing field). Each block is the
literal text to paste.

### Single purpose

> Minerva Clipper saves the web page you're currently reading into your local
> Minerva desktop app as a Source, optionally including your text selection as a
> linked excerpt.

### `activeTab` justification

> When the user clicks the toolbar button or presses the keyboard shortcut, the
> extension reads the current tab's URL, rendered HTML, title, and text
> selection so the page can be saved. activeTab scopes that access to the one
> tab the user acted on, for that single user-initiated action, instead of
> requesting broad host access to every site.

### `scripting` justification

> Used together with activeTab to inject a one-shot function into the active tab
> that returns the page's URL, outerHTML, title, and current selection. It runs
> only in response to the user's explicit save action. There is no persistent
> content script and no registered content script in the manifest.

### `storage` justification

> Stores only the pairing data for the user's own desktop app: a loopback port
> number and a shared secret, written once when the user pastes a pairing code
> from Minerva's settings. This is what lets the extension reconnect to the app
> across browser restarts. No browsing data, page content, or history is stored.

### Host permission (`http://127.0.0.1/*`) justification

> The extension delivers the captured page to the Minerva desktop application
> running on the user's own machine, by POSTing it to a local endpoint on
> loopback (http://127.0.0.1:PORT/ingest). The host permission is restricted to
> 127.0.0.1 — no external or remote server is contacted by this extension at any
> point, and there is no backend service associated with it.

### Remote code

Select **"No, I am not using remote code."** Justification:

> All JavaScript executed by this extension ships inside the uploaded package;
> it is bundled at build time with esbuild. The extension loads no external
> scripts, uses no eval() or new Function(), and fetches no code at runtime. Its
> only network request is a POST to the user's own machine on loopback, and that
> response is parsed as JSON data (a source id, title, and status flags) which is
> displayed in the popup — never executed.

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

## Manual assets (not in the zip)

Live in `clipper/store-assets/` — version-controlled so a resubmission doesn't
start from a blank Desktop. `package.mjs` zips only from `dist/`, so nothing
here can leak into the upload artifact.

- **Screenshot** — `store-assets/popup-over-article-1280x800.png`. The popup
  open over an Astral Codex Ten post, showing the tag/note fields and the live
  Source id. Chrome accepts *only* 1280×800 or 640×400; this is exactly 1280×800.
- **Raw capture** — `store-assets/popup-over-article-raw.png` (2012×836), kept
  so the shot can be re-cropped without re-shooting. The derived screenshot is
  the browser window (the capture's right third was a Minerva editor window,
  cropped out) trimmed to 1.6:1 and downscaled.
- **Store icon** — 128×128. Upload `clipper/icons/icon-128.png`.
- **Small promo tile** (optional) — 440×280. Not produced.

## One-time account setup (not per-item)

Publishing is blocked until the developer **account** carries a verified contact
email. The dashboard's error calls this the "Settings page", but the page is
labelled **Account** in the left menu of the dashboard root — it is not a tab
inside the item editor, which is why it's hard to find from the error.

Account → *Add email* → request verification → click the link Chrome emails you.
Use `dave.l.griffith@gmail.com`, matching the privacy policy contact. Every
review notification, rejection, and policy warning goes to this address.

## Submission checklist

- [ ] Account contact email added **and verified** (one-time, see above)
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
