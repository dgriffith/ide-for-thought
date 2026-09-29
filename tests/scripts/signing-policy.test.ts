/**
 * @vitest-environment node
 *
 * The signing policy (`scripts/lib/signing-policy.mjs`): a packaged build signs
 * and notarizes only when MINERVA_RELEASE is set, and a release build with
 * missing credentials is an error rather than a quiet unsigned artifact.
 *
 * Every env here is a fake literal — nothing reads the real process.env.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveSigningPolicy,
  forgeSigningConfig,
  RELEASE_FLAG,
  NOTARIZE_VARS,
  IDENTITY_VAR,
} from '../../scripts/lib/signing-policy.mjs';

const CREDS = {
  APPLE_API_KEY: '/tmp/fake/AuthKey_FAKE.p8',
  APPLE_API_KEY_ID: 'FAKEKEYID1',
  APPLE_API_ISSUER: '00000000-0000-0000-0000-000000000000',
};
const IDENTITY = 'Developer ID Application: Fake Person (FAKE123456)';
const darwin = (env: Record<string, string | undefined>) =>
  resolveSigningPolicy({ platform: 'darwin', env });

describe('the flag is the one name', () => {
  it('is MINERVA_RELEASE', () => {
    expect(RELEASE_FLAG).toBe('MINERVA_RELEASE');
    expect([...NOTARIZE_VARS]).toEqual(['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER']);
    expect(IDENTITY_VAR).toBe('OSX_SIGN_IDENTITY');
  });
});

describe('credentials without the flag never sign', () => {
  it('full notarize creds, no flag → skip, and says so', () => {
    const d = darwin({ ...CREDS });
    expect(d.action).toBe('skip');
    expect(d.message).toMatch(/UNSIGNED/);
    expect(d.message).toContain('MINERVA_RELEASE');
    expect(d.message).toContain('pnpm build:release');
  });

  it('OSX_SIGN_IDENTITY alone, no flag → skip, and says so', () => {
    const d = darwin({ [IDENTITY_VAR]: IDENTITY });
    expect(d.action).toBe('skip');
    expect(d.message).toMatch(/skip|UNSIGNED/i);
  });

  it('partial creds, no flag → skip (not an error: nothing was asked for)', () => {
    expect(darwin({ APPLE_API_KEY: CREDS.APPLE_API_KEY }).action).toBe('skip');
  });

  it.each(['', '0', 'false', 'FALSE'])('flag=%j counts as off', (v) => {
    expect(darwin({ ...CREDS, [RELEASE_FLAG]: v }).action).toBe('skip');
  });

  it('no creds, no flag → skip silently (a normal dev/CI build)', () => {
    const d = darwin({});
    expect(d).toEqual({ action: 'skip', message: undefined });
  });

  it('non-darwin with creds and no flag → skip silently', () => {
    const d = resolveSigningPolicy({ platform: 'linux', env: { ...CREDS } });
    expect(d).toEqual({ action: 'skip', message: undefined });
  });
});

describe('the flag with credentials signs', () => {
  it.each(['1', 'true', 'TRUE', ' 1 '])('flag=%j + full creds → sign-and-notarize', (v) => {
    const d = darwin({ ...CREDS, [RELEASE_FLAG]: v });
    expect(d.action).toBe('sign-and-notarize');
    if (d.action !== 'sign-and-notarize') return;
    expect(d.notarize).toEqual({
      appleApiKey: CREDS.APPLE_API_KEY,
      appleApiKeyId: CREDS.APPLE_API_KEY_ID,
      appleApiIssuer: CREDS.APPLE_API_ISSUER,
    });
    expect(d.identity).toBeUndefined(); // keychain auto-detect, as before
  });

  it('flag + full creds + OSX_SIGN_IDENTITY → sign-and-notarize with that identity', () => {
    const d = darwin({ ...CREDS, [IDENTITY_VAR]: IDENTITY, [RELEASE_FLAG]: '1' });
    expect(d.action).toBe('sign-and-notarize');
    expect(d.action === 'sign-and-notarize' && d.identity).toBe(IDENTITY);
  });

  it('flag + OSX_SIGN_IDENTITY only → sign without notarizing, and warns', () => {
    const d = darwin({ [IDENTITY_VAR]: IDENTITY, [RELEASE_FLAG]: '1' });
    expect(d.action).toBe('sign');
    expect(d.action === 'sign' && d.identity).toBe(IDENTITY);
    expect(d.message).toMatch(/NOT notarizing/);
  });
});

describe('the flag without credentials fails loudly', () => {
  it('flag + nothing → error', () => {
    const d = darwin({ [RELEASE_FLAG]: '1' });
    expect(d.action).toBe('error');
    expect(d.message).toMatch(/no signing credentials/);
  });

  it('flag + blank creds → error (blank is absent)', () => {
    const d = darwin({ APPLE_API_KEY: '', APPLE_API_KEY_ID: ' ', APPLE_API_ISSUER: '', [RELEASE_FLAG]: '1' });
    expect(d.action).toBe('error');
  });

  it.each(NOTARIZE_VARS.map((k) => [k]))('flag + creds missing %s → error naming it', (missing) => {
    const env: Record<string, string | undefined> = { ...CREDS, [RELEASE_FLAG]: '1' };
    delete env[missing];
    const d = darwin(env);
    expect(d.action).toBe('error');
    expect(d.message).toContain(`missing ${missing}`);
  });

  it('flag + incomplete creds is an error even with OSX_SIGN_IDENTITY (half a notarize config is a mistake)', () => {
    const d = darwin({ APPLE_API_KEY: CREDS.APPLE_API_KEY, [IDENTITY_VAR]: IDENTITY, [RELEASE_FLAG]: '1' });
    expect(d.action).toBe('error');
  });

  it('flag on a non-darwin platform → error, not a quiet unsigned "release"', () => {
    const d = resolveSigningPolicy({ platform: 'linux', env: { ...CREDS, [RELEASE_FLAG]: '1' } });
    expect(d.action).toBe('error');
    expect(d.message).toContain('linux');
  });

  it('an unrecognised flag value → error rather than a guess', () => {
    const d = darwin({ ...CREDS, [RELEASE_FLAG]: 'yes' });
    expect(d.action).toBe('error');
    expect(d.message).toMatch(/not a recognised value/);
  });
});

describe('forgeSigningConfig', () => {
  const entitlements = '/fake/build/entitlements.mac.plist';

  it('skip → no osxSign, no osxNotarize', () => {
    expect(forgeSigningConfig(darwin({ ...CREDS }), { entitlements })).toEqual({
      osxSign: undefined,
      osxNotarize: undefined,
    });
  });

  it('sign-and-notarize → both set, entitlements wired, identity only when given', () => {
    const c = forgeSigningConfig(darwin({ ...CREDS, [RELEASE_FLAG]: '1' }), { entitlements });
    expect(c.osxSign?.optionsForFile()).toEqual({ entitlements });
    expect(c.osxSign).not.toHaveProperty('identity');
    expect(c.osxNotarize?.appleApiKeyId).toBe(CREDS.APPLE_API_KEY_ID);

    const withId = forgeSigningConfig(
      darwin({ ...CREDS, [IDENTITY_VAR]: IDENTITY, [RELEASE_FLAG]: '1' }),
      { entitlements },
    );
    expect(withId.osxSign?.identity).toBe(IDENTITY);
  });

  it('sign → osxSign with identity, no osxNotarize', () => {
    const c = forgeSigningConfig(darwin({ [IDENTITY_VAR]: IDENTITY, [RELEASE_FLAG]: '1' }), { entitlements });
    expect(c.osxSign?.identity).toBe(IDENTITY);
    expect(c.osxNotarize).toBeUndefined();
  });

  it('error → throws the policy message', () => {
    expect(() => forgeSigningConfig(darwin({ [RELEASE_FLAG]: '1' }), { entitlements })).toThrow(
      /MINERVA_RELEASE is set but no signing credentials/,
    );
  });
});
