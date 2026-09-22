/**
 * One definition of "the release tag matches the packaged version" (#2245).
 *
 * The rule: the git tag is `v` + `package.json`'s `version`, exactly.
 *
 * It matters more than a naming convention because two different systems read
 * the two different values. `release.yml` keys the whole build off the **tag**
 * — it decides the release name and, via `contains(ref_name, '-')`, whether
 * the release is marked a pre-release. `update.electronjs.org` compares the
 * **running app's `version`** against the published release. When they
 * disagree, every checkpoint in the pipeline still passes — the build is
 * signed, notarized, stapled, `codesign --verify`'d, smoke-booted and
 * published — and the updater simply never offers the new build to anyone.
 *
 * A release that is green at every step and reaches no user is the worst
 * failure shape available here, which is why this is asserted twice: locally
 * by `tag-release.mjs` before the tag is created, and server-side by
 * `check-release-tag.mjs` on the pushed ref. The local check was the only one
 * that existed, and `git tag -a v2.0.3 && git push` walks straight past it.
 */

/** `vX.Y.Z` / `vX.Y.Z-rc.1` — what `release.yml`'s `tags: ['v*']` triggers on. */
export const SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

/** The tag a given package version must be released under. */
export function tagForVersion(version) {
  return `v${version}`;
}

/**
 * Validate a pushed tag against the packaged version.
 *
 * Returns `{ ok }` rather than throwing so both callers can frame the failure
 * their own way — the local script prints and exits, CI emits a `::error::`
 * annotation.
 */
export function checkReleaseTag(tag, version) {
  if (typeof version !== 'string' || !SEMVER_RE.test(version)) {
    return {
      ok: false,
      error:
        `package.json version ${JSON.stringify(version)} isn't semver (X.Y.Z or X.Y.Z-suffix). ` +
        `The updater compares this string to the release, so it has to be a real version.`,
    };
  }

  const expected = tagForVersion(version);
  if (tag !== expected) {
    return {
      ok: false,
      error:
        `tag ${tag} does not match package.json version ${version} (expected ${expected}). ` +
        `release.yml builds from the tag while update.electronjs.org compares the running ` +
        `app's version to the release — a mismatch publishes a release that looks perfect ` +
        `and is never offered to any installed app. Fix whichever is wrong: bump ` +
        `package.json and re-tag, or delete the tag and push the right one.`,
    };
  }

  // A prerelease suffix has to be on BOTH or NEITHER, which exact equality
  // already guarantees. Worth naming: `release.yml` derives the GitHub
  // pre-release flag from the tag alone, and both the website's download
  // button (via /releases/latest) and the updater feed skip pre-releases — so
  // a stable tag on a prerelease version would quietly displace the stable
  // download with a build calling itself an rc.
  return { ok: true };
}
