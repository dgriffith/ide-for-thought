/**
 * @vitest-environment node
 *
 * File selection for the pre-push hook's opt-in related-tests run (#2380).
 *
 * The pure half is driven with injected git facts, one case per push shape
 * git can hand a pre-push hook; the last block runs `realGit` against a
 * throwaway repo, because the one thing injected facts can't prove is that a
 * path with spaces survives git's own output format.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isRelatable,
  isZeroSha,
  parsePrePushInput,
  planRange,
  realGit,
  selectChangedFiles,
  selectChangedFilesInRepo,
  type GitFacts,
} from '../../scripts/lib/prepush-changed-files.mjs';

const Z = '0'.repeat(40);
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const C = 'c'.repeat(40);
const BASE = 'e'.repeat(40);

/** Fake git: `diffs` keyed `base..head`, `unpushed` keyed by head. */
function fakeGit(over: Partial<GitFacts> & {
  diffs?: Record<string, string[]>;
  unpushed?: Record<string, string[]>;
  known?: string[];
} = {}): GitFacts & { calls: string[] } {
  const calls: string[] = [];
  const known = new Set(over.known ?? [A, B, C, BASE]);
  return {
    calls,
    hasCommit: over.hasCommit ?? ((sha) => known.has(sha)),
    defaultBranch: over.defaultBranch ?? (() => 'origin/main'),
    mergeBase: over.mergeBase ?? ((a, b) => {
      calls.push(`merge-base ${a} ${b}`);
      return BASE;
    }),
    diffNames: over.diffNames ?? ((base, head) => {
      calls.push(`diff ${base}..${head}`);
      return over.diffs?.[`${base}..${head}`] ?? [];
    }),
    unpushedNames: over.unpushedNames ?? ((head) => {
      calls.push(`unpushed ${head}`);
      return over.unpushed?.[head] ?? [];
    }),
  };
}

const line = (localSha: string, remoteSha: string, ref = 'refs/heads/feat') =>
  `${ref} ${localSha} ${ref} ${remoteSha}`;
const everythingExists = () => true;

describe('parsePrePushInput', () => {
  it('parses one line per ref and drops blanks and malformed lines', () => {
    const text = [line(A, B), '', 'garbage', `refs/heads/x ${A} refs/heads/x nothex!`, line(C, Z, 'refs/heads/y')].join('\n');
    expect(parsePrePushInput(text)).toEqual([
      { localRef: 'refs/heads/feat', localSha: A, remoteRef: 'refs/heads/feat', remoteSha: B },
      { localRef: 'refs/heads/y', localSha: C, remoteRef: 'refs/heads/y', remoteSha: Z },
    ]);
  });

  it('empty stdin (e.g. `git push` with nothing to push) is no refs, not an error', () => {
    expect(parsePrePushInput('')).toEqual([]);
  });

  it('recognises all-zero shas of any length (sha1 or sha256 repos)', () => {
    expect(isZeroSha(Z)).toBe(true);
    expect(isZeroSha('0'.repeat(64))).toBe(true);
    expect(isZeroSha(A)).toBe(false);
  });
});

describe('planRange — one rule per push shape', () => {
  const upd = (localSha: string, remoteSha: string) => parsePrePushInput(line(localSha, remoteSha))[0]!;

  it('update: diffs remote..local', () => {
    expect(planRange(upd(A, B), fakeGit())).toEqual({ kind: 'range', base: B, head: A, why: 'update' });
  });

  it('new branch: diffs from the merge-base with the default branch', () => {
    const git = fakeGit();
    expect(planRange(upd(A, Z), git)).toEqual({ kind: 'range', base: BASE, head: A, why: 'new-branch' });
    expect(git.calls).toEqual([`merge-base origin/main ${A}`]);
  });

  it('deletion: nothing is pushed, so nothing is diffed', () => {
    const git = fakeGit();
    expect(planRange(upd(Z, B), git)).toEqual({ kind: 'delete' });
    expect(git.calls).toEqual([]);
  });

  it('update whose remote sha was never fetched: treated like a new branch', () => {
    // `git diff <unknown-sha> <local>` would fail; a force-push over someone
    // else's commits you never fetched is the realistic way to get here.
    const git = fakeGit({ known: [A, BASE] });
    expect(planRange(upd(A, B), git)).toEqual({ kind: 'range', base: BASE, head: A, why: 'unknown-remote-sha' });
  });

  it('no resolvable default branch: falls back to commits no remote has', () => {
    const git = fakeGit({ defaultBranch: () => null });
    expect(planRange(upd(A, Z), git)).toEqual({ kind: 'unpushed', head: A, why: 'new-branch' });
  });

  it('default branch with no merge-base (unrelated history): same fallback', () => {
    const git = fakeGit({ mergeBase: () => null });
    expect(planRange(upd(A, Z), git)).toEqual({ kind: 'unpushed', head: A, why: 'new-branch' });
  });
});

describe('isRelatable', () => {
  it.each([
    'src/main/graph/index.ts',
    'src/renderer/lib/components/Sidebar.svelte',
    'scripts/lib/package-prune.mjs',
    'tests/main/foo.test.ts',
    'vitest.config.mts',
    'src/shared/ontology-thought.ttl',
    'src/main/skills/stock/crystallize.md',
    'src/main/some data.json',
  ])('keeps %s', (f) => expect(isRelatable(f)).toBe(true));

  it.each([
    'docs/development.md',
    'CLAUDE.md',
    '.githooks/pre-push',
    '.github/workflows/ci.yml',
    'package.json',
    'pnpm-lock.yaml',
    'website/docs/index.html',
    'node_modules/foo/index.js',
    'resources/models/x.onnx',
  ])('drops %s', (f) => expect(isRelatable(f)).toBe(false));
});

describe('selectChangedFiles', () => {
  it('multiple refs: the union across refs, deduplicated and sorted', () => {
    const git = fakeGit({
      diffs: {
        [`${B}..${A}`]: ['src/b.ts', 'src/a.ts'],
        [`${BASE}..${C}`]: ['src/a.ts', 'tests/c.test.ts'],
      },
    });
    const stdin = [line(A, B, 'refs/heads/one'), line(C, Z, 'refs/heads/two'), line(Z, B, 'refs/heads/gone')].join('\n');
    const sel = selectChangedFiles(stdin, git, everythingExists);
    expect(sel.files).toEqual(['src/a.ts', 'src/b.ts', 'tests/c.test.ts']);
    expect(sel.refs).toBe(3);
    expect(sel.changed).toBe(3);
  });

  it('no relevant files: an empty selection, with the raw count kept for the message', () => {
    const git = fakeGit({ diffs: { [`${B}..${A}`]: ['docs/development.md', 'CLAUDE.md', '.githooks/pre-push'] } });
    const sel = selectChangedFiles(line(A, B), git, everythingExists);
    expect(sel.files).toEqual([]);
    expect(sel.changed).toBe(3);
  });

  it('a deletion-only push selects nothing and runs no git diff', () => {
    const git = fakeGit();
    expect(selectChangedFiles(line(Z, B), git, everythingExists).files).toEqual([]);
    expect(git.calls).toEqual([]);
  });

  it('drops files the push deletes — vitest cannot be handed a missing path', () => {
    const git = fakeGit({ diffs: { [`${B}..${A}`]: ['src/kept.ts', 'src/removed.ts'] } });
    const sel = selectChangedFiles(line(A, B), git, (f) => f !== 'src/removed.ts');
    expect(sel.files).toEqual(['src/kept.ts']);
  });

  it('paths with spaces pass through as single entries', () => {
    const git = fakeGit({ diffs: { [`${B}..${A}`]: ['src/my notes/a b.ts', 'tests/x y.test.ts'] } });
    expect(selectChangedFiles(line(A, B), git, everythingExists).files).toEqual([
      'src/my notes/a b.ts',
      'tests/x y.test.ts',
    ]);
  });

  it('uses the unpushed-commits fallback when no base resolves', () => {
    const git = fakeGit({ defaultBranch: () => null, unpushed: { [A]: ['src/new.ts'] } });
    expect(selectChangedFiles(line(A, Z), git, everythingExists).files).toEqual(['src/new.ts']);
  });
});

describe('realGit against a throwaway repo', () => {
  let dir: string;
  let first: string;
  let second: string;
  // This file runs inside the pre-push hook when PREPUSH_TESTS=1, where git
  // may have exported GIT_DIR / GIT_INDEX_FILE for the REAL repo. Left in the
  // environment, every command below would operate on that repo instead of the
  // throwaway one — so strip them for the duration of this block.
  const savedGitEnv: Record<string, string> = {};

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
        GIT_CONFIG_NOSYSTEM: '1', HOME: os.tmpdir(),
      },
    }).trim();
  const write = (rel: string, body: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };

  beforeAll(() => {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('GIT_')) {
        savedGitEnv[k] = process.env[k]!;
        delete process.env[k];
      }
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-files-'));
    git('init', '-q', '-b', 'main');
    write('src/base.ts', 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    first = git('rev-parse', 'HEAD');
    write('src/my notes/a b.ts', 'export const b = 2;\n');
    write('src/quote\'s $x.ts', 'export const c = 3;\n');
    write('docs/readme.md', 'hi\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'second');
    second = git('rev-parse', 'HEAD');
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    Object.assign(process.env, savedGitEnv);
  });

  it('an update diff keeps awkward paths intact (NUL-separated output)', () => {
    const sel = selectChangedFilesInRepo(`refs/heads/main ${second} refs/heads/main ${first}`, 'origin', dir);
    expect(sel.files).toEqual(['src/my notes/a b.ts', "src/quote's $x.ts"]);
    expect(sel.changed).toBe(3);
  });

  it('a new branch with no remote at all falls back to every unpushed commit', () => {
    expect(realGit('origin', dir).defaultBranch()).toBeNull();
    const sel = selectChangedFilesInRepo(`refs/heads/main ${second} refs/heads/main ${Z}`, 'origin', dir);
    expect(sel.plans[0]).toMatchObject({ kind: 'unpushed' });
    expect(sel.files).toEqual(['src/base.ts', 'src/my notes/a b.ts', "src/quote's $x.ts"]);
  });

  it('a new branch diffs from the merge-base with <remote>/main', () => {
    git('update-ref', 'refs/remotes/origin/main', first);
    expect(realGit('origin', dir).defaultBranch()).toBe('origin/main');
    const sel = selectChangedFilesInRepo(`refs/heads/feat ${second} refs/heads/feat ${Z}`, 'origin', dir);
    expect(sel.plans[0]).toEqual({ kind: 'range', base: first, head: second, why: 'new-branch' });
    expect(sel.files).toEqual(['src/my notes/a b.ts', "src/quote's $x.ts"]);
  });

  it('knows which commits exist locally', () => {
    const facts = realGit('origin', dir);
    expect(facts.hasCommit(first)).toBe(true);
    expect(facts.hasCommit('1234567'.padEnd(40, '0'))).toBe(false);
  });
});
