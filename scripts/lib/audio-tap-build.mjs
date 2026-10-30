/**
 * Builds `native/audio-tap/main.swift` — the helper that records system audio
 * for meeting recordings (#2731) — into `resources/bin/minerva-audio-tap`.
 *
 * From there forge's `extraResource: ['resources']` ships it, and
 * `bundledResourcesRoot()` finds it in a checkout and in the packaged app
 * alike. It sits outside `app.asar`, so it can be spawned, and release signing
 * signs it with everything else in the bundle (`@electron/osx-sign` walks the
 * whole `.app` for Mach-O files). Run from forge's `generateAssets` hook, so
 * `pnpm dev`, `package`, `build` and `build:e2e` all have it, for the arch
 * being built.
 *
 * Skipped when the binary was already built from this source for this arch:
 * the check is a content hash, not mtimes, for the reasons in
 * `build-help-corpus.mjs` (#2246). macOS only; elsewhere it does nothing.
 *
 * Plain `.mjs` (typed by the sibling `.d.mts`) so forge's loader can import it.
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export const AUDIO_TAP_SOURCE = path.join('native', 'audio-tap', 'main.swift');
export const AUDIO_TAP_BINARY = path.join('resources', 'bin', 'minerva-audio-tap');
/** The first macOS with Core Audio process taps. */
export const AUDIO_TAP_MIN_MACOS = '14.2';

/** The `swiftc` target triples for a forge arch (two for `universal`), or
 *  null for one we don't build. */
export function audioTapTargets(arch) {
  const arm = `arm64-apple-macos${AUDIO_TAP_MIN_MACOS}`;
  const intel = `x86_64-apple-macos${AUDIO_TAP_MIN_MACOS}`;
  if (arch === 'arm64') return [arm];
  if (arch === 'x64') return [intel];
  if (arch === 'universal') return [arm, intel];
  return null;
}

/** What the binary was built from: the source's bytes and the target. */
export function audioTapStamp(source, target) {
  return crypto.createHash('sha256').update(target).update('\0').update(source).digest('hex');
}

/** `xcrun swiftc` arguments for one build. */
export function audioTapSwiftcArgs({ source, out, target }) {
  return ['swiftc', '-O', '-swift-version', '5', '-target', target, source, '-o', out];
}

/**
 * Build the helper for `arch` under `root` unless it's already current.
 * Throws when it can't (no Xcode command-line tools, a compile error): the
 * packaged app would otherwise ship a meeting recorder with nothing to run.
 *
 * @returns {'built' | 'current' | 'skipped'}
 */
export function buildAudioTap({ root, platform, arch, run = execFileSync, log = console.log }) {
  if (platform !== 'darwin') return 'skipped';
  const targets = audioTapTargets(arch);
  if (!targets) throw new Error(`[audio-tap] no swiftc target for arch "${arch}"`);
  const target = targets.join('+');
  const source = path.join(root, AUDIO_TAP_SOURCE);
  const out = path.join(root, AUDIO_TAP_BINARY);
  const stampFile = `${out}.stamp`;
  const stamp = audioTapStamp(fs.readFileSync(source), target);
  if (fs.existsSync(out) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) {
    return 'current';
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  log(`[audio-tap] building ${AUDIO_TAP_BINARY} for ${target}`);
  if (targets.length === 1) {
    run('xcrun', audioTapSwiftcArgs({ source, out, target }), { stdio: 'inherit' });
  } else {
    // A universal app gets a universal helper: one slice per target, joined.
    const slices = targets.map((t, i) => {
      const slice = `${out}.${i}`;
      run('xcrun', audioTapSwiftcArgs({ source, out: slice, target: t }), { stdio: 'inherit' });
      return slice;
    });
    run('xcrun', ['lipo', '-create', ...slices, '-output', out], { stdio: 'inherit' });
    for (const slice of slices) fs.rmSync(slice, { force: true });
  }
  fs.writeFileSync(stampFile, stamp);
  return 'built';
}
