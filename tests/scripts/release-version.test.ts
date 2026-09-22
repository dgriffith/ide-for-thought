/**
 * The release tag ↔ packaged version rule (#2245).
 *
 * `release.yml` triggers on `push: tags: ['v*']` and nothing downstream
 * checked that the tag is the version being packaged. The rule existed only in
 * `tag-release.mjs`, a local convenience that `git tag -a v2.0.3 && git push`
 * walks straight past.
 *
 * The failure it prevents has no symptom anywhere in the pipeline: the build
 * is signed, notarized, stapled, `codesign --verify`'d, smoke-booted, drafted
 * and published — and `update.electronjs.org`, which compares the RUNNING
 * APP'S version against the release, never offers it. Green everywhere,
 * delivered to nobody.
 *
 * Tested here rather than as shell inside the workflow because there is real
 * logic in it (semver shape, the `v` prefix, prerelease suffixes) and because
 * the same function now backs both the local script and the CI check —
 * `tests/architecture/release-tag-gate.test.ts` holds the other half, that CI
 * actually runs it.
 */
import { describe, it, expect } from 'vitest';
import {
  checkReleaseTag,
  tagForVersion,
  SEMVER_RE,
} from '../../scripts/lib/release-version.mjs';

describe('tagForVersion', () => {
  it('prefixes with v, matching the release trigger', () => {
    expect(tagForVersion('2.0.3')).toBe('v2.0.3');
    expect(tagForVersion('2.0.0-rc.1')).toBe('v2.0.0-rc.1');
  });
});

describe('a matching tag passes', () => {
  it.each(['2.0.2', '10.4.0', '2.0.0-rc.1', '1.0.0-alpha.12', '0.0.1'])(
    'accepts v%s against %s',
    (version) => {
      expect(checkReleaseTag(`v${version}`, version)).toEqual({ ok: true });
    },
  );
});

describe('a mismatched tag fails', () => {
  it('rejects the fat-finger case: tagged ahead of the bump', () => {
    // The literal scenario in #2245 — `git tag -a v2.0.3` on a 2.0.2 manifest.
    const result = checkReleaseTag('v2.0.3', '2.0.2');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('v2.0.3');
    expect(result.error).toContain('2.0.2');
    // The message has to say why this matters, because every other signal the
    // release produces says it went fine.
    expect(result.error).toMatch(/never offered/i);
  });

  it('rejects a stable tag on a prerelease version', () => {
    // Worse than it looks: release.yml derives the GitHub pre-release flag
    // from the TAG alone, and both the website download button
    // (/releases/latest) and the updater feed skip pre-releases. A stable tag
    // on an rc build displaces the stable download with an rc.
    expect(checkReleaseTag('v2.0.0', '2.0.0-rc.1').ok).toBe(false);
  });

  it('rejects a prerelease tag on a stable version', () => {
    // The mirror image: the build calls itself stable, the release is flagged
    // pre-release, and the updater skips it forever.
    expect(checkReleaseTag('v2.0.0-rc.1', '2.0.0').ok).toBe(false);
  });

  it('rejects a tag missing the v prefix', () => {
    expect(checkReleaseTag('2.0.2', '2.0.2').ok).toBe(false);
  });

  it('is exact, not a prefix match', () => {
    // `v2.0.2` must not satisfy `2.0.20`, and `v2.0.2` must not be satisfied
    // by a longer tag — a `startsWith` implementation passes both of these.
    expect(checkReleaseTag('v2.0.2', '2.0.20').ok).toBe(false);
    expect(checkReleaseTag('v2.0.20', '2.0.2').ok).toBe(false);
  });
});

describe('a version that is not semver fails before the comparison', () => {
  it.each(['', 'latest', '2.0', '2.0.2.1', 'v2.0.2'])(
    'rejects version %o',
    (version) => {
      const result = checkReleaseTag(`v${version}`, version);
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/semver/i);
    },
  );

  it('rejects a non-string version without throwing', () => {
    // `package.json` is parsed JSON; a missing or malformed `version` field
    // should produce the error message, not a TypeError in the release job.
    expect(checkReleaseTag('v2.0.2', undefined).ok).toBe(false);
    expect(checkReleaseTag('v2.0.2', 2).ok).toBe(false);
  });

  it('reports the version problem rather than a mismatch', () => {
    // If both are wrong, the semver message is the actionable one — "bump the
    // version" rather than "these two strings differ".
    expect(checkReleaseTag('vfoo', 'foo').error).toMatch(/semver/i);
  });
});

describe('SEMVER_RE matches what the release trigger accepts', () => {
  it('accepts plain and prerelease versions', () => {
    expect(SEMVER_RE.test('2.0.2')).toBe(true);
    expect(SEMVER_RE.test('2.0.0-rc.1')).toBe(true);
    expect(SEMVER_RE.test('2.0.0-alpha.12')).toBe(true);
  });

  it('rejects partial and build-metadata forms', () => {
    expect(SEMVER_RE.test('2.0')).toBe(false);
    expect(SEMVER_RE.test('2.0.2+build.7')).toBe(false);
  });
});

describe('the real package.json is releasable', () => {
  it('has a version this rule would accept', async () => {
    // Guards the case where the manifest itself drifts into a shape that
    // could never be tagged — the release would fail at push time, long after
    // the mistake landed.
    const pkg = (await import('../../package.json', { with: { type: 'json' } })) as unknown as {
      default: { version: string };
    };
    const version = pkg.default.version;
    expect(SEMVER_RE.test(version), `package.json version ${version} is not taggable`).toBe(true);
    expect(checkReleaseTag(tagForVersion(version), version)).toEqual({ ok: true });
  });
});
