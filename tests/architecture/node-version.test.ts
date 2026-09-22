/**
 * @vitest-environment node
 *
 * `.nvmrc` names the Node line this project builds on (#2252).
 *
 * All three workflows resolve their runtime from it (`node-version-file:
 * .nvmrc`), so it is the single answer to "which Node does this project run
 * on?" — and the pre-push hook's value depends on that answer matching what
 * developers actually run, since a gate on a different runtime cannot catch a
 * difference between runtimes.
 *
 * ── Why the issue's first option was wrong ──────────────────────────────────
 * #2252 offers "bump `.nvmrc` to 25 and let CI follow" as the option that
 * "actually restores the hook's guarantee". It would restore it onto a dead
 * runtime. From nodejs/Release's own schedule:
 *
 *   v24   lts 2025-10-28   maintenance 2026-10-20   END 2028-04-30
 *   v25   lts —            maintenance 2026-04-01   END 2026-06-01
 *   v26   lts 2026-10-28   maintenance 2027-10-20   END 2029-04-30
 *
 * Node 25 was never LTS and reached end-of-life on 2026-06-01. `.nvmrc` is
 * therefore correct as it stands and the skew closes from the other side — the
 * local machine moves to 24 — with the hook now saying so on every push.
 *
 * Node ships LTS on even majors only; odd ones are Current and EOL in about six
 * months. That convention has held since Node 4 and is what this asserts,
 * rather than a hardcoded date that would rot.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

const nvmrc = (): string => fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf-8').trim();
const nvmrcMajor = (): number => Number.parseInt(nvmrc().replace(/^v/, ''), 10);

describe('.nvmrc names a supported Node line (#2252)', () => {
  it('exists and parses as a major version', () => {
    expect(nvmrc()).toMatch(/^v?\d+(\.\d+)*$/);
    expect(Number.isInteger(nvmrcMajor())).toBe(true);
    expect(nvmrcMajor()).toBeGreaterThanOrEqual(20);
  });

  it('is an EVEN major — the LTS lines', () => {
    // The assertion that would have caught #2252's own suggestion. Node ships
    // LTS on even majors; an odd one is Current, never promoted, and EOL in
    // roughly six months. Building and releasing on one means the runtime
    // under the release pipeline stops getting security fixes on a schedule
    // nobody is tracking.
    const major = nvmrcMajor();
    if (major % 2 !== 0) {
      expect.fail(
        `.nvmrc names Node ${major}, an odd major.\n\n` +
        `Node ships LTS on even majors only — odd ones are Current and reach ` +
        `end-of-life about six months after release (v25 ended 2026-06-01). All three ` +
        `workflows build and release on this version (#2252). If this is deliberate, ` +
        `say why here and in docs/development.md.`,
      );
    }
  });

  it('satisfies the engines floor in package.json', () => {
    // Two statements of the same fact; drift means "which Node?" has two
    // answers again, which is the condition #2252 was filed about.
    const engines = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'),
    ).engines.node as string;
    const floor = Number.parseInt(/(\d+)/.exec(engines)![1]!, 10);
    expect(
      nvmrcMajor(),
      `.nvmrc (${nvmrcMajor()}) is below package.json engines "${engines}"`,
    ).toBeGreaterThanOrEqual(floor);
  });
});

describe('every workflow resolves Node from .nvmrc', () => {
  const setupNodeSteps = () =>
    fs
      .readdirSync(WORKFLOW_DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((file) => {
        const doc = parse(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf-8')) as {
          jobs?: Record<string, { steps?: Array<{ uses?: string; with?: Record<string, string> }> }>;
        };
        return Object.entries(doc.jobs ?? {}).flatMap(([job, j]) =>
          (j.steps ?? [])
            .filter((s) => /actions\/setup-node/.test(s.uses ?? ''))
            .map((s) => ({ file, job, with: s.with ?? {} })),
        );
      });

  it('finds the setup-node steps — an empty scan would pass vacuously', () => {
    expect(setupNodeSteps().length).toBeGreaterThanOrEqual(3);
  });

  it('none hardcodes a version', () => {
    // A literal `node-version: 24` beside `.nvmrc` is the drift this file is
    // about, one workflow at a time.
    const hardcoded = setupNodeSteps()
      .filter((s) => s.with['node-version'] !== undefined)
      .map((s) => `${s.file}:${s.job}`);

    expect(
      hardcoded,
      'use `node-version-file: .nvmrc` so there is one answer to "which Node?"',
    ).toEqual([]);
  });

  it('all point at .nvmrc', () => {
    for (const s of setupNodeSteps()) {
      expect(s.with['node-version-file'], `${s.file}:${s.job}`).toBe('.nvmrc');
    }
  });
});

describe('the pre-push hook warns on a version skew', () => {
  const hook = () => fs.readFileSync(path.join(ROOT, '.githooks', 'pre-push'), 'utf-8');

  it('reads .nvmrc and compares it to the running node', () => {
    const s = hook();
    expect(s).toContain('.nvmrc');
    expect(s).toMatch(/node -v/);
  });

  it('warns rather than blocking', () => {
    // A hook that fails a push over an advisory is a hook people disable, and
    // then the lint gate goes with it. The skew check must not `exit 1`.
    const s = hook();
    const skewBlock = s.slice(s.indexOf('.nvmrc'), s.indexOf('lint:fonts'));
    expect(skewBlock).not.toMatch(/exit 1/);
  });
});
