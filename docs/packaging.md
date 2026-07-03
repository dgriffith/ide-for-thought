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

A **local** `pnpm build` is only signed if you have a Developer ID cert in your
keychain and the notarization env vars set; otherwise it takes the unsigned
path and first launch will throw:

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
- `vite.main.config.ts` / `vite.preload.config.ts` /
  `vite.renderer.config.mts` — per-process bundle configs that the
  VitePlugin invokes during package.
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
