/**
 * macOS signing + notarization policy for packaged builds — the one statement
 * of it.
 *
 * Signing and notarization happen ONLY when the release flag is set:
 *
 *   MINERVA_RELEASE=1
 *
 * `pnpm build:release` sets it; `release.yml`'s signed build step runs that
 * script. Nothing else does.
 *
 * Credentials alone never sign. They used to: `forge.config.ts` signed whenever
 * the App Store Connect key vars (or `OSX_SIGN_IDENTITY`) were in the
 * environment, and the maintainer's shell exports them, so every
 * `pnpm build:e2e` / `pnpm package` / `pnpm build` on that machine signed and
 * ran `notarytool submit` under the maintainer's Apple Developer identity —
 * including agents' throwaway test builds. What a build does must depend on
 * what was asked for, not on what happens to be exported in the shell.
 *
 * The flag is also fail-loud in the other direction: a release build whose
 * credentials are missing or incomplete is an ERROR, not a quiet unsigned
 * artifact. An unsigned build can't be auto-updated (Squirrel.Mac rejects it),
 * so "release" and "unsigned" never go together.
 *
 * Plain `.mjs` (typed by the sibling `.d.mts`) for the same reason as
 * `electron-fuses.mjs`: forge's loader imports it untranspiled.
 * `tests/scripts/signing-policy.test.ts` covers every branch;
 * `tests/architecture/release-signing-flag.test.ts` pins who sets the flag.
 */

/** The one name. Documented in CLAUDE.md, docs/releasing.md, docs/packaging.md. */
export const RELEASE_FLAG = 'MINERVA_RELEASE';

/** The App Store Connect API-key triple `notarytool` needs, in one place. */
export const NOTARIZE_VARS = Object.freeze(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);

/** Forces a specific Developer ID identity (and permits sign-without-notarize). */
export const IDENTITY_VAR = 'OSX_SIGN_IDENTITY';

const ON = new Set(['1', 'true']);
const OFF = new Set(['', '0', 'false']);

/** @param {string | undefined} v */
const present = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Decide what a packaging run does about signing.
 *
 * @param {{ platform: string; env: Record<string, string | undefined> }} input
 * @returns {import('./signing-policy.d.mts').SigningDecision}
 */
export function resolveSigningPolicy({ platform, env }) {
  const raw = (env[RELEASE_FLAG] ?? '').trim().toLowerCase();
  const presentNotarize = NOTARIZE_VARS.filter((k) => present(env[k]));
  const identity = present(env[IDENTITY_VAR]) ? /** @type {string} */ (env[IDENTITY_VAR]) : undefined;
  const anyCreds = presentNotarize.length > 0 || identity !== undefined;

  if (!ON.has(raw) && !OFF.has(raw)) {
    return {
      action: 'error',
      message:
        `[signing] ${RELEASE_FLAG}=${JSON.stringify(env[RELEASE_FLAG])} is not a recognised value. ` +
        `Use ${RELEASE_FLAG}=1 for a signed release build, or unset it.`,
    };
  }

  if (!ON.has(raw)) {
    return {
      action: 'skip',
      message:
        platform === 'darwin' && anyCreds
          ? `[signing] Apple signing credentials found but ${RELEASE_FLAG} is not set — ` +
            `building UNSIGNED and not notarizing. For a signed release build run \`pnpm build:release\`.`
          : undefined,
    };
  }

  // Release flag set from here on: sign, or fail. Never a quiet unsigned build.
  if (platform !== 'darwin') {
    return {
      action: 'error',
      message:
        `[signing] ${RELEASE_FLAG} is set but this is ${platform}; only macOS signing is ` +
        `configured. Refusing to produce an unsigned "release" build.`,
    };
  }

  if (presentNotarize.length > 0 && presentNotarize.length < NOTARIZE_VARS.length) {
    const missing = NOTARIZE_VARS.filter((k) => !present(env[k]));
    return {
      action: 'error',
      message:
        `[signing] ${RELEASE_FLAG} is set but the notarization credentials are incomplete — ` +
        `missing ${missing.join(', ')}. Set all of ${NOTARIZE_VARS.join(', ')}.`,
    };
  }

  if (presentNotarize.length === NOTARIZE_VARS.length) {
    return {
      action: 'sign-and-notarize',
      identity,
      notarize: {
        appleApiKey: /** @type {string} */ (env.APPLE_API_KEY),
        appleApiKeyId: /** @type {string} */ (env.APPLE_API_KEY_ID),
        appleApiIssuer: /** @type {string} */ (env.APPLE_API_ISSUER),
      },
      message: `[signing] ${RELEASE_FLAG} set — signing${identity ? ` as "${identity}"` : ''} and notarizing.`,
    };
  }

  if (identity !== undefined) {
    return {
      action: 'sign',
      identity,
      message:
        `[signing] ${RELEASE_FLAG} set with ${IDENTITY_VAR} only — signing as "${identity}" but NOT ` +
        `notarizing (no ${NOTARIZE_VARS.join(' / ')}). Gatekeeper will still warn on this build.`,
    };
  }

  return {
    action: 'error',
    message:
      `[signing] ${RELEASE_FLAG} is set but no signing credentials were found. Set ` +
      `${NOTARIZE_VARS.join(', ')} (sign + notarize), or ${IDENTITY_VAR} (sign only).`,
  };
}

/**
 * Map a decision onto electron-packager's `osxSign` / `osxNotarize` options.
 * Throws on an `error` decision — that is the fail-loud path: forge aborts
 * before packaging anything.
 *
 * @param {import('./signing-policy.d.mts').SigningDecision} decision
 * @param {{ entitlements: string }} opts
 */
export function forgeSigningConfig(decision, { entitlements }) {
  if (decision.action === 'error') throw new Error(decision.message);
  if (decision.action === 'skip') return { osxSign: undefined, osxNotarize: undefined };
  return {
    // @electron/osx-sign applies the hardened runtime and signs nested
    // binaries (the DuckDB .node, dylibs); entitlements come from the plist.
    // No identity → auto-detected Developer ID Application cert.
    osxSign: {
      optionsForFile: () => ({ entitlements }),
      ...(decision.identity ? { identity: decision.identity } : {}),
    },
    osxNotarize: decision.action === 'sign-and-notarize' ? { ...decision.notarize } : undefined,
  };
}
