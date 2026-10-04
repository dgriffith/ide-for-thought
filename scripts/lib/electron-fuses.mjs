/**
 * Electron fuse policy for the packaged app (#2366) — the one statement of it.
 *
 * Fuses are bits baked into the Electron binary at package time. Unlike a
 * `webPreferences` flag or a startup check, nothing at runtime — no
 * environment variable, no command-line switch — can turn one back. Two
 * consumers read this list:
 *
 *  - `forge.config.ts` hands it to `@electron-forge/plugin-fuses`, which
 *    flips the bits while packaging (before signing, so the result is signed).
 *  - `scripts/check-electron-fuses.mjs` reads the bits back off the BUILT app
 *    in ci.yml's e2e job and in release.yml, and fails on any mismatch — or on
 *    a fuse this list does not name, which is how an Electron upgrade that adds
 *    one gets a decision instead of a silent default.
 *
 * `tests/architecture/electron-fuses.test.ts` pins every value below, so
 * changing one means changing that test too — deliberately.
 *
 * Plain `.mjs` (typed by the sibling `.d.mts`) for the same reason as
 * `package-prune.mjs`: forge's loader and the `scripts/*.mjs` family both
 * import it without a transpile step.
 */

/**
 * Wire order is Electron's (`FuseV1Options` in @electron/fuses); `index` is
 * the byte offset in the fuse wire. Every fuse the binary carries must appear.
 *
 * @type {ReadonlyArray<Readonly<{ name: string; index: number; enabled: boolean }>>}
 */
export const FUSE_POLICY = Object.freeze([
  // ON, deliberately. The `minerva` CLI shim written by "Install 'minerva'
  // Command in PATH" (src/main/cli-install.ts) is
  //   exec env ELECTRON_RUN_AS_NODE=1 <Minerva binary> <app.asar>/.vite/build/cli.js
  // — it IS the headless CLI and the `minerva mcp` server (#1437), and no
  // separate Node ships. Off, both die. The cost: anyone who can exec the
  // binary can run it as plain Node, which is no more than running `node` on
  // the same machine — it gets none of Electron's APIs (no `safeStorage`),
  // and the sandboxed renderer cannot exec anything.
  Object.freeze({ name: 'RunAsNode', index: 0, enabled: true }),

  // ON. The privileged-site partitions (src/main/privileged-sites.ts) persist
  // real login cookies; this encrypts the cookie store at rest with the OS
  // keychain. The app already uses `safeStorage` (secret-storage.ts), so the
  // "Minerva Safe Storage" keychain item exists and no new prompt appears.
  // One-way: existing plaintext cookies still read and are re-written
  // encrypted, but turning this back OFF would lose them.
  Object.freeze({ name: 'EnableCookieEncryption', index: 1, enabled: true }),

  // OFF. `NODE_OPTIONS=--require ./x.js` would load code into the main process
  // — and into the RunAsNode CLI — before any of ours runs. Nothing relies on
  // it: `build:e2e`'s NODE_OPTIONS applies to the build, not the built app.
  Object.freeze({ name: 'EnableNodeOptionsEnvironmentVariable', index: 2, enabled: false }),

  // OFF. `Minerva --inspect` would put a debugger in the main process, where
  // `safeStorage.decryptString` hands back the user's stored credentials.
  // Consequence for tests: Playwright's Electron driver always passes
  // `--inspect=0`, so the packaged-app specs attach over CDP instead
  // (tests/e2e/helpers/launch.ts, `launchPackaged`) — a Chromium switch no
  // fuse governs, reaching the renderer those specs drive.
  Object.freeze({ name: 'EnableNodeCliInspectArguments', index: 3, enabled: false }),

  // ON. Validates `app.asar` against the header hash packager writes into
  // Info.plist (`ElectronAsarIntegrity`), which the code signature seals. So
  // an edited archive is a FATAL "Integrity check failed for asar archive" at
  // launch rather than a signed app running unsigned code. Needs `asar` in
  // forge.config.ts.
  Object.freeze({ name: 'EnableEmbeddedAsarIntegrityValidation', index: 4, enabled: true }),

  // ON. Load app code only from `app.asar` — never from a loose
  // `Resources/app/` directory, which is what the packager emitted before
  // #2366 and which integrity validation cannot cover. Needs `asar`.
  Object.freeze({ name: 'OnlyLoadAppFromAsar', index: 5, enabled: true }),

  // OFF (Electron's default). Minerva ships no custom browser-process V8
  // snapshot, so there is nothing for this to load.
  Object.freeze({ name: 'LoadBrowserProcessSpecificV8Snapshot', index: 6, enabled: false }),

  // OFF (#2564). The renderer is served from the privileged `app://` scheme
  // (app-protocol.ts), which reads the bundle with main's asar-aware fs, so
  // nothing needs `file://` to have more than Chrome's default powers. It had
  // to stay on while the renderer loaded from `file://`: off, Chromium's file
  // handler can't read inside `app.asar` (ERR_FILE_NOT_FOUND on index.html).
  // With it on, `file://` pages could fetch any other `file://` URL — and CSP
  // `'self'` under `file://` meant the whole disk.
  Object.freeze({ name: 'GrantFileProtocolExtraPrivileges', index: 7, enabled: false }),

  // ON (Electron's default). V8's signal-handler-based WASM bounds checks;
  // off, every WASM memory access pays an explicit check, and the embedder
  // (ORT), sql.js and the renderer's Whisper worker are all WASM hot loops.
  // A performance mechanism, not attack surface an app switch would close.
  // (@electron/fuses 1.x — the line plugin-fuses 7.x peers on — predates this
  // fuse and does not write it, so this entry is what holds it: the read-back
  // fails if it is ever not ON.)
  Object.freeze({ name: 'WasmTrapHandlers', index: 8, enabled: true }),
]);

/** Byte values in the fuse wire (`FuseState` in @electron/fuses). */
const STATE = Object.freeze({ 48: 'disabled', 49: 'enabled', 114: 'removed' });

/**
 * Settings object for `new FusesPlugin({ version, ...forgeFuseSettings() })`,
 * keyed by wire index as the plugin expects.
 *
 * @returns {Record<number, boolean>}
 */
export function forgeFuseSettings() {
  return Object.fromEntries(FUSE_POLICY.map((f) => [f.index, f.enabled]));
}

/**
 * Compare a fuse wire read off a built binary (`getCurrentFuseWire` from
 * @electron/fuses: `{ version: '1', 0: 49, 1: 48, … }`) against the policy.
 *
 * @param {Record<string, unknown>} wire
 * @returns {{ ok: boolean; lines: string[]; errors: string[] }}
 */
export function checkFuseWire(wire) {
  const errors = [];
  const lines = [];
  if (String(wire.version) !== '1') {
    errors.push(`fuse wire version is ${String(wire.version)}, this policy describes v1`);
  }
  const indices = Object.keys(wire).filter((k) => k !== 'version').map(Number).sort((a, b) => a - b);
  for (const f of FUSE_POLICY) {
    const raw = wire[f.index];
    const actual = STATE[/** @type {keyof typeof STATE} */ (Number(raw))] ?? `unknown(${String(raw)})`;
    const want = f.enabled ? 'enabled' : 'disabled';
    const good = actual === want;
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${f.name} is ${actual}${good ? '' : ` (policy: ${want})`}`);
    if (!good) errors.push(`${f.name} is ${actual} in the built app; the policy says ${want}`);
  }
  for (const i of indices) {
    if (!FUSE_POLICY.some((f) => f.index === i)) {
      errors.push(
        `the binary has a fuse at wire index ${i} that the policy does not name — ` +
        'an Electron upgrade added one. Decide it in scripts/lib/electron-fuses.mjs ' +
        'and tests/architecture/electron-fuses.test.ts rather than inheriting the default.',
      );
    }
  }
  return { ok: errors.length === 0, lines, errors };
}
