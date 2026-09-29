/**
 * @vitest-environment node
 *
 * The pre-push hook's opt-in related-tests run stays opt-in (#2380).
 *
 * `.githooks/pre-push` gained a second, much more expensive mode:
 * `PREPUSH_TESTS=1` runs `vitest related --run` on the pushed files alongside
 * lint. The issue's two success criteria are the ones that decay silently,
 * because nothing else would notice either one breaking:
 *
 *   - **Default hook runtime unchanged.** A refactor that starts the related
 *     run unconditionally (or reads stdin and forgets the guard) turns every
 *     push into a test run, and the hook people then disable takes the lint
 *     gate with it (#690's whole premise).
 *   - **The bypasses still bypass.** `SKIP_HOOKS=1` must return before any of
 *     it — including before reading git's stdin.
 *
 * So these tests EXECUTE the hook rather than grepping it, with `pnpm`,
 * `node` and `vitest` replaced on PATH by stubs that record how they were
 * called. That pins behaviour — what actually runs for each setting — and
 * leaves the hook free to be restructured. It runs under `sh` and, where one
 * is installed, under `dash`, the strictest common POSIX shell (and `/bin/sh`
 * on the Ubuntu runners); a bash-ism that `sh` on macOS tolerates fails there.
 * One static check backs that up for shells not on the machine running this.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(ROOT, '.githooks', 'pre-push');
const hookText = () => fs.readFileSync(HOOK, 'utf-8');

const REFS = `refs/heads/feat ${'a'.repeat(40)} refs/heads/feat ${'0'.repeat(40)}\n`;

let bin: string;
let log: string;

/** A stub that appends `<name> <args>` to $STUB_LOG, then does `body`. */
function stub(name: string, body: string) {
  const file = path.join(bin, name);
  fs.writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> "$STUB_LOG"\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

beforeAll(() => {
  bin = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-hook-bin-'));
  log = path.join(bin, 'calls.log');
  // `pnpm lint` exits $FAKE_LINT_STATUS; everything else succeeds.
  stub('pnpm', 'if [ "$1" = "lint" ]; then exit "${FAKE_LINT_STATUS:-0}"; fi\nexit 0');
  // `node -v` matches .nvmrc so the skew warning stays quiet; the related-tests
  // runner records the stdin it was handed and exits $FAKE_TESTS_STATUS.
  const nvmrc = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf-8').trim().replace(/^v/, '');
  stub(
    'node',
    [
      `if [ "$1" = "-v" ]; then echo v${nvmrc}; exit 0; fi`,
      'case "$1" in *prepush-related-tests.mjs) cat > "$STUB_LOG.stdin"; exit "${FAKE_TESTS_STATUS:-0}";; esac',
      'exit 0',
    ].join('\n'),
  );
  stub('vitest', 'exit 0');
});

afterAll(() => fs.rmSync(bin, { recursive: true, force: true }));

const SHELLS = ['sh', ...(fs.existsSync('/bin/dash') ? ['/bin/dash'] : [])];

function runHook(shell: string, env: Record<string, string>) {
  fs.rmSync(log, { force: true });
  fs.rmSync(`${log}.stdin`, { force: true });
  const r = spawnSync(shell, [HOOK, 'origin', 'git@example.com:x/y.git'], {
    cwd: ROOT,
    input: REFS,
    encoding: 'utf-8',
    // Only the stubs and the base system: no real pnpm/node/vitest reachable.
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: os.tmpdir(), STUB_LOG: log, ...env },
  });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').trim().split('\n') : [];
  const stdin = fs.existsSync(`${log}.stdin`) ? fs.readFileSync(`${log}.stdin`, 'utf-8') : null;
  return { status: r.status, out: `${r.stdout}${r.stderr}`, calls, stdin };
}

const ranRelatedTests = (calls: string[]) => calls.some((c) => /prepush-related-tests|vitest/.test(c));

describe('.githooks/pre-push is POSIX sh', () => {
  it('declares /bin/sh', () => {
    expect(hookText().split('\n')[0]).toBe('#!/bin/sh');
  });

  it('uses no bash-only syntax', () => {
    // Comments stripped so prose may mention these freely.
    const code = hookText()
      .split('\n')
      .filter((l) => !/^\s*#/.test(l))
      .join('\n');
    const bashisms: Array<[RegExp, string]> = [
      [/\[\[/, '[[ … ]]'],
      [/^\s*function\s/m, 'function keyword'],
      [/^\s*local\s/m, 'local'],
      [/^\s*source\s/m, 'source (use .)'],
      [/<<</, 'here-string'],
      [/\$'/, "$'…' quoting"],
      [/\w+=\(/, 'array assignment'],
      [/\$\{\w+\/\//, '${var//…}'],
      [/pipefail/, 'set -o pipefail'],
      [/&>/, '&> redirection'],
      [/\$\{\w+\[/, 'array index'],
    ];
    for (const [re, name] of bashisms) expect(code, `bash-ism in pre-push: ${name}`).not.toMatch(re);
  });
});

describe.each(SHELLS)('pre-push under %s (#2380)', (shell) => {
  it('SKIP_HOOKS=1 short-circuits before anything runs — even with PREPUSH_TESTS=1', () => {
    const r = runHook(shell, { SKIP_HOOKS: '1', PREPUSH_TESTS: '1' });
    expect(r.status).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.stdin).toBeNull();
  });

  it('off by default: lint runs, related tests do not, and one tip line says how to opt in', () => {
    const r = runHook(shell, {});
    expect(r.status).toBe(0);
    expect(r.calls).toContain('pnpm lint:fonts');
    expect(r.calls).toContain('pnpm lint');
    expect(ranRelatedTests(r.calls), r.calls.join('\n')).toBe(false);
    expect(r.stdin).toBeNull();
    expect(r.out.match(/PREPUSH_TESTS=1/g)).toHaveLength(1);
  });

  it('PREPUSH_TESTS=0 is off too, and silences the tip', () => {
    const r = runHook(shell, { PREPUSH_TESTS: '0' });
    expect(r.status).toBe(0);
    expect(ranRelatedTests(r.calls)).toBe(false);
    expect(r.out).not.toMatch(/tip:/);
  });

  it('a lint failure still blocks the push in the default mode', () => {
    const r = runHook(shell, { FAKE_LINT_STATUS: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/lint failed/);
  });

  it('PREPUSH_TESTS=1 runs lint AND the related tests, handing the runner git\'s ref list', () => {
    const r = runHook(shell, { PREPUSH_TESTS: '1' });
    expect(r.status).toBe(0);
    expect(r.calls).toContain('pnpm lint');
    expect(r.calls).toContain('node scripts/prepush-related-tests.mjs origin');
    expect(r.stdin).toBe(REFS);
    expect(r.out).not.toMatch(/tip:/);
  });

  it('a related-test failure aborts the push and names both bypasses', () => {
    const r = runHook(shell, { PREPUSH_TESTS: '1', FAKE_TESTS_STATUS: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/related tests failed/);
    expect(r.out).toMatch(/--no-verify/);
    expect(r.out).toMatch(/SKIP_HOOKS=1/);
  });

  it('with both running concurrently, EITHER failure fails the push — and both are reported', () => {
    const lintOnly = runHook(shell, { PREPUSH_TESTS: '1', FAKE_LINT_STATUS: '1' });
    expect(lintOnly.status).toBe(1);
    expect(lintOnly.out).toMatch(/lint failed/);
    expect(lintOnly.out).not.toMatch(/related tests failed/);

    const both = runHook(shell, { PREPUSH_TESTS: '1', FAKE_LINT_STATUS: '1', FAKE_TESTS_STATUS: '1' });
    expect(both.status).toBe(1);
    expect(both.out).toMatch(/lint failed/);
    expect(both.out).toMatch(/related tests failed/);
  });
});
