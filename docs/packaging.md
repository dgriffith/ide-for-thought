# Packaging Minerva as a Standalone App

Everything is already wired in `forge.config.ts` — `electron-forge` builds
the .app bundle, stages `resources/` (so the bundled `minerva_kernel.py`
and Python helper library ride along), and runs the configured makers
for DMG + ZIP output. There are two commands, producing different
artifacts:

| Command | Output | When to use |
|---|---|---|
| `pnpm package` | `out/Minerva-<platform>-<arch>/Minerva.app` | Fastest path. Produces a runnable `.app` bundle and nothing else. |
| `pnpm build` | `out/Minerva-<platform>-<arch>/Minerva.app` + `out/make/...` (DMG, ZIP) | Use when you want a shippable artifact to hand around. |
| `pnpm build:release` | Same as `pnpm build`, **signed + notarized** | A local release build. Sets `MINERVA_RELEASE=1`; fails if the Apple creds are missing. |

`pnpm build` is `electron-forge make` under the hood — it runs the
package step first, then invokes every configured maker.

## Quick start

```bash
pnpm build
open out/Minerva-darwin-arm64/Minerva.app          # first launch
# .app then lives at out/Minerva-darwin-arm64/Minerva.app
# DMG lands at out/make/Minerva-darwin-arm64-<version>.dmg
```

## Caveats worth knowing before you double-click

### 1. Gatekeeper (macOS)

**Release builds from CI are signed + notarized** (`osxSign` / `osxNotarize`
in `forge.config.ts`, wired into `release.yml` — #841/#959), so a DMG from a
published Release opens without a Gatekeeper prompt.

Signing is **opt-in by flag, not by credentials**: only `pnpm build:release`
(`MINERVA_RELEASE=1`) signs and notarizes, and it needs a Developer ID cert in
your keychain plus `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` —
it fails rather than build unsigned without them. `pnpm build`, `pnpm package`
and `pnpm build:e2e` are always unsigned, even with those vars exported (see
[`releasing.md`](./releasing.md#signing-is-opt-in-minerva_release)). An unsigned
build's first launch will throw:

> "Minerva" cannot be opened because the developer cannot be verified.

**Workaround for an unsigned local build:** right-click the `.app` → **Open** →
confirm in the dialog. Subsequent launches don't prompt.

To cut a real signed release, follow [`releasing.md`](./releasing.md).

### 2. Python interpreter resolution

The packaged app spawns whatever `python3` resolves on the launching
process's `$PATH`. Electron on macOS often inherits a **stripped PATH**
when launched from Finder — so `python3` may resolve to system Python,
which doesn't have `pandas` / `numpy` / etc. installed.

If the demo cells `import pandas`, you have two options:

- **In-app:** Settings → Python Interpreter → point at a venv that has
  the libs you need. Persisted per-machine in userData.
- **Env var:** set `MINERVA_PYTHON=/path/to/venv/bin/python` in the
  shell or LaunchAgent that starts the app. The kernel resolver
  picks it up.

The demo `notes/mandolin-history/data/` Python cells need at minimum
`pandas` (for `minerva.sql()` → DataFrame).

### 3. First-run state

Packaged Minerva uses `app.getPath('userData')` for settings — so a
freshly-installed copy starts blank: no API key, no recent project,
no window state. Plan to:

- Set the Anthropic API key in Settings (for the conversational pane).
- Open the thoughtbase folder once via File → Open. Subsequent launches
  remember it.

### 4. Architecture

Forge builds for the current architecture by default — `arm64` on
Apple Silicon, `x64` on Intel. For a build that runs on either:

```bash
pnpm package -- --arch=universal
# or
pnpm build -- --arch=universal
```

This produces a universal binary at the cost of ~2× the .app size.

Releases ship arm64 only (#962). An **x64** build is exercised anyway, as an
early warning: `ci.yml`'s `x64-smoke` job packages natively on a
`macos-15-intel` runner on every push to `main` (and on PRs labelled
`x64-smoke`), checks that every native binary in the bundle is `x86_64`, and
runs the packaged smoke boot. It is non-blocking (`continue-on-error`, not a
required check) — a red X on a main commit there means x64 broke, not that
main did. An arm64 build can't be tested on an Intel runner "under Rosetta":
Rosetta translates x86_64 → arm64 only.

### 5. Windows / Linux

Same commands work cross-platform:

```bash
# on Windows: produces .exe + Squirrel installer
pnpm build
# on Linux: produces .AppImage / .deb / .rpm depending on makers
pnpm build
```

The `MakerZIP` is registered for all three platforms, so at minimum
each yields a ZIP under `out/make/zip/<platform>/<arch>/`. Add
`MakerSquirrel` (Windows) or `MakerDeb` / `MakerRpm` (Linux) to
`forge.config.ts` if you want first-class installers per platform.

### 6. Code signing posture (#2565)

Two things a notarized app can grant that malware on the same machine would
love to borrow, and where Minerva stands on each:

- **Running arbitrary code as Minerva.** With Electron's `RunAsNode` fuse on,
  `ELECTRON_RUN_AS_NODE=1 Minerva.app/Contents/MacOS/Minerva -e '…'` runs any
  JS inside a process macOS sees as notarized Minerva, inheriting its
  microphone and Files & Folders permissions. The fuse is **off**. The
  `minerva` CLI (which needed it) runs as `Minerva --minerva-cli -- <args>`,
  which executes only the bundled `cli.js`; an old shim written before the
  change is recognised and still works.
- **Loading unsigned code.** The hardened runtime's library validation only
  loads code signed by Apple or by our team. `osx-sign` signs every Mach-O in
  the bundle — including `app.asar.unpacked/**/*.node` and `*.dylib` — with
  the team identity (checked on the v3.0.0 release: DuckDB's `duckdb.node`
  and `libduckdb.dylib` carry `TeamIdentifier=ZC2MK8M828`), so the
  `disable-library-validation` entitlement is **not** shipped. A new native
  dependency is signed the same way; `release.yml`'s signed smoke boot opens a
  DuckDB project, so one that fails validation stops the release.

What remains, accepted: `allow-jit` and `allow-unsigned-executable-memory`,
which V8 needs under the hardened runtime; and the CLI itself — anything that
can run `minerva` can run its commands (read a thoughtbase it can already
read, file proposals), which is what the CLI is for.

## Demo-prep checklist

If you're packaging right before a demo, run through this once:

- [ ] `pnpm lint && pnpm test` — clean baseline before packaging.
- [ ] `pnpm build` — produce the .app and DMG.
- [ ] Launch via right-click → Open to clear Gatekeeper.
- [ ] Settings → set `ANTHROPIC_API_KEY`.
- [ ] Settings → Python Interpreter → point at your venv with `pandas`.
- [ ] File → Open → pick `~/vaults/demo`.
- [ ] Run **one** Python cell end-to-end so the kernel warms up.
- [ ] Run **one** SPARQL cell so the graph is loaded and warm.
- [ ] Quit. Re-open from `/Applications/Minerva.app`. Verify the
      thoughtbase, API key, and Python interpreter all restored.

## When to use `pnpm dev` instead

If the demo is on a machine where you can keep the repo cloned and you
expect to iterate on the app during prep, `pnpm dev` (Vite + HMR) is
faster and has the same Python kernel wiring. Downsides: the developer
console may pop open visibly during the demo, and `pnpm dev` requires
having node + pnpm + the repo. Packaged `.app` is the right call for a
self-contained demo machine.

## Files involved

- `forge.config.ts` — packager + maker configuration.
- `vite.main.config.mts` / `vite.preload.config.mts` /
  `vite.renderer.config.mts` — per-process bundle configs that the
  VitePlugin invokes during package. `.mts` so Vite's `configLoader: 'native'`
  loads them as ESM (they use `import` syntax) without a CJS-interop warning.
- `vite.cli.config.mts` — self-contained build of the headless `minerva`
  CLI (#1437). `forge.config.ts`'s `afterPrune` (`copyCliBundle`) builds it
  and stages `.vite/build/cli.js` into the app beside `main.js`, so it
  resolves the same shipped `node_modules`. At runtime the app's own binary
  runs it in CLI mode, `Minerva --minerva-cli -- <args>` (`src/main/cli-mode.ts`)
  — no separate `node` ships, and the `RunAsNode` fuse is off (see *Code
  signing posture* below). Users expose it on PATH with **Help → Install 'minerva' Command in
  PATH…** (`src/main/cli-install.ts`), which writes a shim to
  `~/.local/bin/minerva`. macOS/Linux; Windows is a follow-up.
- `resources/python/` — bundled Python kernel + `minerva` helper
  library. Staged into `Minerva.app/Contents/Resources/python/` by the
  `extraResource` config.
- `out/` — build output (gitignored). `out/<name>-<platform>-<arch>/`
  contains the .app bundle; `out/make/` contains the maker artifacts.

## Future improvements

These would be nice but aren't blockers for a demo build:

- **Code signing + notarization** (see Gatekeeper section above).
- **Universal-binary script** — `"package:universal": "electron-forge package -- --arch=universal"`.
- **Bundled Python venv** so the app has a guaranteed pandas / numpy /
  matplotlib install regardless of the host machine. Significant
  bundle-size hit (~150 MB+) but eliminates the Python-interpreter
  dance.
- **Squirrel installer for Windows** — auto-update support.
- **MINERVA_PYTHON in Info.plist `LSEnvironment`** so a pinned
  interpreter survives Finder launches.
