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
  (**the `.zip` is the one auto-update consumes** — don't remove it). A missing
  one already fails the CI job before it gets this far (#1639).
- Signature + notarization are asserted automatically now (#1637): `release.yml`
  runs `codesign --verify`, two `spctl` gatekeeper assessments (the `.app` and
  the `.dmg`), and `xcrun stapler validate` right after the build, and boots the
  packaged app once via Playwright — a green run already means these passed. A
  red run means the draft either doesn't exist or is unsigned; don't hand-check
  around a failure. To re-run the same checks by hand against a downloaded DMG:

  ```bash
  spctl -a -t open --context context:primary-signature Minerva-*.dmg   # → accepted
  codesign -dv --verbose=4 /Volumes/Minerva*/Minerva.app 2>&1 | grep Authority
  xcrun stapler validate Minerva-*.dmg                                 # → The validate action worked!
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

## Handing someone a pre-alpha build

For getting an unfinished build (a 2.0 alpha, an RC) to one tester without it
reaching anyone else. The short version: **tag it with a prerelease version and
never publish the draft.**

A draft release is invisible to the public *and* to `update.electronjs.org`, so
this is strictly safer than publishing and hoping the "latest" flag protects
you.

### 1. Bump to a prerelease version

Bump `package.json` wherever the line you're shipping lives — that may well be
`main` itself, if `main` *is* the 2.0 line. The bump lands via PR like any other
change.

```bash
# package.json "version" -> 2.0.0-alpha.1
```

**Use a prerelease version, not the current one.** The installed app compares
its own `version` against the feed hourly. A build stamped `1.0.0` handed to a
tester will silently auto-update *off* your alpha the next time you publish a
`1.0.x` — they'd lose the build without ever being told. `2.0.0-alpha.1` sorts
above every stable release, so the feed offers it nothing.

### 2. Tag it

If the bump landed on `main`, use the helper as normal — it accepts a
prerelease version, and it still enforces the check that matters (tag ==
`package.json` version, or the updater never offers the build):

```bash
git checkout main && git pull
pnpm release:tag
git push origin v2.0.0-alpha.1     # matches release.yml's 'v*' trigger
```

Only if you're shipping off a **non-`main`** branch do you tag by hand —
`release:tag` refuses to run anywhere else, deliberately, since real releases
come off merged `main`:

```bash
git tag -a v2.0.0-alpha.1 -m "2.0 pre-alpha"
git push origin v2.0.0-alpha.1
```

### 3. Wait for the build

The tag push runs `release.yml` — signed + notarized + stapled, exactly like a
real release. Budget **10–15 minutes**; notarization is the slow part and it
varies with Apple's queue.

The release object doesn't exist until the run's final step, so **Releases will
look empty while the build is going**. Watch the run, not the Releases page:

```bash
gh run watch "$(gh run list --workflow release.yml --limit 1 --json databaseId -q '.[0].databaseId')"
```

The draft it cuts is auto-marked a pre-release, because the tag has a hyphen in
it (see the `prerelease:` line in `release.yml`).

### 4. Get the DMG

Under **Releases** the draft appears at the top, above every published release,
labelled `Draft` `Pre-release`. The assets hang off it.

Confirm both flags before you send anything — they're the entire safety story
for this section, and they're cheap to check:

```bash
gh release view v2.0.0-alpha.1 --json isDraft,isPrerelease,assets \
  --jq '{isDraft, isPrerelease, assets: [.assets[].name]}'
# expect isDraft: true, isPrerelease: true, and a .dmg + .zip
```

Then pull it down:

```bash
gh release download v2.0.0-alpha.1 --pattern '*.dmg' --dir ~/Downloads
```

That yields two identical DMGs — `Minerva-2.0.0-alpha.1-arm64.dmg` (the
version-stamped original) and `Minerva-mac-arm64.dmg` (the fixed-name copy the
website links to). Send the version-stamped one; the name tells the tester what
they're running.

If you'd rather not create a release object at all: run **Actions → Release →
Run workflow** against the branch. That path builds and uploads the same
artifacts *without* cutting any release, and the DMG is inside the
`minerva-macos-ARM64` artifact zip on the run's summary page. Artifacts expire
(90 days) and only collaborators can download them, so this suits "build it and
hand over the file" better than anything durable.

### 5. Leave the draft unpublished

Nothing else is required. Do **not** run the `gh release edit --draft=false`
step from the release loop above.

Publish it only if the tester needs to fetch it themselves — and then without
`--latest`:

```bash
gh release edit v2.0.0-alpha.1 --draft=false --prerelease
```

The pre-release flag is what keeps it out of `/releases/latest` (so the
website's download button stays on stable) and off the update feed (so
installed apps aren't offered it).

### Caveats

- **Apple Silicon only.** The CI runner is arm64 and the DuckDB native binding
  is per-arch (#962). An Intel Mac can't run this DMG.
- The auto-generated notes diff against the previous tag, so a 2.0 alpha's
  changelog will be enormous. Harmless on a draft; trim it if you publish.

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
