# Releasing Minerva

The repeatable loop for cutting a signed, auto-updating macOS release. This
ties together the two moving parts:

- **Signed CI build** (`.github/workflows/release.yml`, #959) — a pushed
  `vX.Y.Z` tag builds a signed + notarized + stapled DMG/ZIP and cuts a
  **draft** GitHub Release.
- **In-app auto-update** (`src/main/auto-update.ts`, #662) — a shipped app
  polls `update.electronjs.org`, which serves **published** GitHub Releases
  and offers the newer build to users.

> **The load-bearing step is _Publish_.** `update.electronjs.org` ignores
> draft releases, so nothing reaches users until you publish. Everything
> before that is safe to redo.

For what "signed" requires and the one-time secret setup, see
[`packaging.md`](./packaging.md). This doc is the per-release checklist.

---

## Prerequisites (one-time)

- The five Apple signing secrets are configured in the repo
  (Settings → Secrets and variables → Actions) — listed in the header of
  `release.yml`. Without them the CI build still succeeds but is **unsigned**,
  and an unsigned build can't be auto-updated (Squirrel.Mac rejects it).
- You're releasing **Apple Silicon (arm64)** only for now — the CI runner is
  arm64 and the DuckDB native binding is per-arch. Intel/universal is deferred
  (#962).

---

## The loop

### 1. Bump the version

`package.json` `version` is the single source of truth: it names the DMG and
it's what the running app compares against the feed. Bump it with semver, one
bump per release.

This lands **via PR** like any other change (don't commit straight to `main`):

```bash
git checkout main && git pull
git checkout -b release/vX.Y.Z
# edit package.json "version" -> X.Y.Z
git commit -am "release: vX.Y.Z"
# open PR, get it merged
```

### 2. Tag the merged commit

Once the bump is on `main`, create the matching tag. The helper enforces that
the tag equals `package.json`'s version (a mismatch means the updater never
offers the build), that you're on a clean `main`, and that the tag is new:

```bash
git checkout main && git pull
pnpm release:tag        # creates the vX.Y.Z tag locally, prints the push cmd
git push origin vX.Y.Z  # this is what triggers CI
```

### 3. CI builds the signed draft

The tag push runs `release.yml`:

- imports the Developer ID cert, builds signed + notarized + stapled artifacts,
- uploads them, and
- cuts a **draft** GitHub Release with auto-generated notes
  (`generate_release_notes: true`).

Watch it under **Actions**; a green run leaves a draft under **Releases**.

### 4. Review the draft

- Confirm the assets are attached: a `.dmg` and a `.zip`
  (**the `.zip` is the one auto-update consumes** — don't remove it).
- Sanity-check the signature on the DMG before shipping:

  ```bash
  spctl -a -t open --context context:primary-signature Minerva-*.dmg   # → accepted
  codesign -dv --verbose=4 /Volumes/Minerva*/Minerva.app 2>&1 | grep Authority
  ```

- Edit the auto-generated notes if you want a curated summary at the top
  (the generated commit list is fine as the tail).

### 5. Publish

Flip the draft public. This is the moment auto-update turns on for this
version: within the next poll interval, already-installed apps see it and
offer to update.

From the CLI (works even when the web UI doesn't show a **Publish release**
button — a common quirk):

```bash
gh release edit vX.Y.Z --draft=false --latest
```

`--draft=false` publishes it; `--latest` marks it the repo's latest release so
the update feed and Releases page point at it. Before flipping, confirm the
draft is sound (step 4) — publishing is forward-only (see below):

```bash
gh release view vX.Y.Z --json isDraft,tagName,assets \
  --jq '{isDraft, tagName, assets: [.assets[].name]}'   # expect a .dmg and the .zip
```

Or, in the web UI when the button is present: open the draft under **Releases**
and hit **Publish release**.

---

## Rollout timing & verification

- Installed apps poll hourly (`updateInterval` in `auto-update.ts`) and on
  launch. Expect update prompts to trickle out, not appear instantly.
- The **first** published release has nothing to update *from* — auto-update is
  only exercised once a **second** release is published and an older build
  picks it up. That end-to-end apply is the acceptance check in #961.

## Release notes

`generate_release_notes: true` gives a PR/commit-derived changelog per release,
which is enough for now — no separate hand-maintained `CHANGELOG.md`. Curate the
draft's top section by hand when a release deserves a narrative.

## If something's wrong

- **Bad draft** — just delete the draft Release and (if needed) the tag
  (`git push origin :vX.Y.Z`), fix, and re-tag. Nothing reached users.
- **Published a bad build** — publish a follow-up patch release; auto-update
  rolls users forward. There's no "unpublish that un-ships it" — forward is the
  only direction, so the review in step 4 is where you catch problems.

## Files involved

| File | Role |
|------|------|
| `package.json` `version` | Source of truth for DMG name + update comparison |
| `scripts/tag-release.mjs` (`pnpm release:tag`) | Guards version↔tag agreement |
| `.github/workflows/release.yml` | Tag → signed build → draft Release |
| `forge.config.ts` | Signing/notarization config (reads Apple env) |
| `src/main/auto-update.ts` | In-app updater against update.electronjs.org |
