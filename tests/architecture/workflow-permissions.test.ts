/**
 * @vitest-environment node
 *
 * Every workflow declares its `GITHUB_TOKEN` scope, and writes are job-scoped
 * (#2251).
 *
 * `ci.yml` and `bench.yml` used to declare nothing, which meant their token
 * scope was whatever a settings page said. That page currently says
 * least-privilege — checked rather than assumed:
 *
 *   gh api repos/:owner/:repo/actions/permissions/workflow
 *   {"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
 *
 * so this was never a live hole. It was an **unpinned assumption**: an org- or
 * repo-level change would silently widen the token for jobs that only read,
 * and nothing in the repository would show it — not a diff, not a failing
 * check, not a comment. A settings page is not a place invariants can live.
 *
 * The second half is inheritance. `release.yml` declared `contents: write` at
 * *workflow* scope, equivalent to job scope while there is one job and
 * silently wrong the moment there are two — a notarization-status reporter, or
 * the Linux/Windows builders epic #2200/#2197 will add, would have inherited
 * write access to the repository for no reason. Writes belong on the job that
 * writes.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

type Scope = Record<string, string> | string | undefined;
interface Job { permissions?: Scope }
interface Workflow { permissions?: Scope; jobs?: Record<string, Job> }

function workflows(): Array<{ file: string; doc: Workflow }> {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .map((file) => ({
      file,
      doc: parse(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf-8')) as Workflow,
    }));
}

/** Permission keys set to something other than `read`/`none`. */
function writeScopes(scope: Scope): string[] {
  if (scope === undefined) return [];
  // The shorthand forms: `permissions: write-all` grants everything.
  if (typeof scope === 'string') return scope === 'write-all' ? ['write-all'] : [];
  return Object.entries(scope)
    .filter(([, v]) => v === 'write')
    .map(([k]) => k);
}

describe('workflow token scopes are declared (#2251)', () => {
  it('finds the workflows — an empty scan would pass vacuously', () => {
    const found = workflows();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.map((w) => w.file).sort()).toEqual(['bench.yml', 'ci.yml', 'release.yml']);
  });

  it('every workflow declares a permissions block', () => {
    const missing = workflows().filter((w) => w.doc.permissions === undefined).map((w) => w.file);

    if (missing.length > 0) {
      expect.fail(
        `Workflow(s) with no \`permissions:\` block:\n\n` +
        missing.map((f) => `  .github/workflows/${f}`).join('\n') +
        `\n\nThe token scope then comes from a repository setting rather than from this ` +
        `repo, so a settings change silently rescopes it with nothing here to show it ` +
        `(#2251). Declare \`permissions: contents: read\` and grant anything more on the ` +
        `job that needs it.`,
      );
    }
  });

  it('the workflow-scope default is read-only everywhere', () => {
    // The floor. A write at workflow scope is inherited by every job added
    // later, which is precisely the mistake release.yml was one job away from.
    const broad = workflows()
      .map((w) => ({ file: w.file, writes: writeScopes(w.doc.permissions) }))
      .filter((w) => w.writes.length > 0)
      .map((w) => `${w.file}: ${w.writes.join(', ')}`);

    expect(
      broad,
      'grant writes on the job that writes, not at workflow scope — a job added ' +
      'later inherits workflow scope without asking for it',
    ).toEqual([]);
  });
});

describe('writes are scoped to the job that needs them (#2251)', () => {
  it('release.yml grants contents:write on build-macos alone', () => {
    // Named rather than folded into a count so a regression says which
    // perimeter moved. This is the job holding the signing material.
    const release = workflows().find((w) => w.file === 'release.yml')!.doc;
    expect(writeScopes(release.permissions)).toEqual([]);
    expect(writeScopes(release.jobs?.['build-macos']?.permissions)).toEqual(['contents']);
  });

  it('bench.yml grants issues:write on the bench job alone', () => {
    // #2242 needs it so the regression gate can file an issue when it fires.
    // It is the narrowest grant that does that: `contents` stays read.
    const bench = workflows().find((w) => w.file === 'bench.yml')!.doc;
    expect(writeScopes(bench.permissions)).toEqual([]);
    expect(writeScopes(bench.jobs?.['bench']?.permissions)).toEqual(['issues']);
  });

  it('ci.yml grants no writes at all', () => {
    // Its only secret is CODECOV_TOKEN, which is codecov's own rather than
    // GITHUB_TOKEN; cache and upload-artifact use their own services. Nothing
    // in it touches the contents API.
    const ci = workflows().find((w) => w.file === 'ci.yml')!.doc;
    expect(writeScopes(ci.permissions)).toEqual([]);
    for (const [name, job] of Object.entries(ci.jobs ?? {})) {
      expect(writeScopes(job.permissions), `ci.yml job ${name} grants a write`).toEqual([]);
    }
  });

  it('rejects the `write-all` shorthand anywhere', () => {
    // `permissions: write-all` reads as a single innocuous word and grants
    // every scope there is.
    const all = workflows().flatMap((w) => [
      ...(writeScopes(w.doc.permissions).includes('write-all') ? [w.file] : []),
      ...Object.entries(w.doc.jobs ?? {})
        .filter(([, j]) => writeScopes(j.permissions).includes('write-all'))
        .map(([n]) => `${w.file}:${n}`),
    ]);
    expect(all, 'name the scopes needed instead of write-all').toEqual([]);
  });
});
