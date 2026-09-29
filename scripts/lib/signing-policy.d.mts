/**
 * Types for `signing-policy.mjs`. Kept beside it for the same reason as
 * `electron-fuses.d.mts`: the implementation stays plain `.mjs` so forge's
 * loader can import it untranspiled.
 */

export const RELEASE_FLAG: 'MINERVA_RELEASE';
export const NOTARIZE_VARS: ReadonlyArray<'APPLE_API_KEY' | 'APPLE_API_KEY_ID' | 'APPLE_API_ISSUER'>;
export const IDENTITY_VAR: 'OSX_SIGN_IDENTITY';

export interface NotarizeCreds {
  appleApiKey: string;
  appleApiKeyId: string;
  appleApiIssuer: string;
}

export type SigningDecision =
  /** No signing, no notarization. `message` is set when creds were present but ignored. */
  | { action: 'skip'; message?: string }
  /** Sign (identity from OSX_SIGN_IDENTITY, else keychain auto-detect) and notarize. */
  | { action: 'sign-and-notarize'; identity?: string; notarize: NotarizeCreds; message: string }
  /** Sign with OSX_SIGN_IDENTITY only; not notarized. */
  | { action: 'sign'; identity: string; message: string }
  /** Release flag set but the build cannot be signed — the caller must abort. */
  | { action: 'error'; message: string };

export function resolveSigningPolicy(input: {
  platform: string;
  env: Record<string, string | undefined>;
}): SigningDecision;

export function forgeSigningConfig(
  decision: SigningDecision,
  opts: { entitlements: string },
): {
  osxSign: { optionsForFile: () => { entitlements: string }; identity?: string } | undefined;
  osxNotarize: NotarizeCreds | undefined;
};
