/**
 * Git-push primitives for the Publish destination (#254).
 *
 * Pure helpers (URL rewrite, token resolution, commit templating) are tested
 * directly. The workspace lifecycle (diff classification → stage → commit) is
 * exercised against a real isomorphic-git repo in a temp dir — that's the
 * bug-prone logic. The HTTPS clone/push transport isn't file://-testable with
 * isomorphic-git, so it's validated against a real remote out of band.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fsMod from 'node:fs';
import git from 'isomorphic-git';

const hoisted = vi.hoisted(() => ({ execFileSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: hoisted.execFileSync }));

import {
  normalizeRemoteToHttps,
  renderCommitMessage,
  resolveGitHubToken,
  pendingChanges,
  stageAll,
  commit,
} from '../../../src/main/git/publish-git';

describe('normalizeRemoteToHttps', () => {
  it('rewrites scp-like SSH to HTTPS', () => {
    expect(normalizeRemoteToHttps('git@github.com:dgriffith/garden.git')).toBe(
      'https://github.com/dgriffith/garden.git',
    );
  });
  it('rewrites ssh:// URLs to HTTPS', () => {
    expect(normalizeRemoteToHttps('ssh://git@github.com/dgriffith/garden.git')).toBe(
      'https://github.com/dgriffith/garden.git',
    );
  });
  it('passes HTTPS/HTTP through untouched', () => {
    expect(normalizeRemoteToHttps('https://github.com/o/r.git')).toBe('https://github.com/o/r.git');
    expect(normalizeRemoteToHttps('  http://host/o/r.git ')).toBe('http://host/o/r.git');
  });
});

describe('renderCommitMessage', () => {
  it('fills {{date}} and {{version}}, tolerating whitespace', () => {
    expect(renderCommitMessage('{{date}} · v{{ version }}', { date: '2026-07-03', version: '0.1.0' }))
      .toBe('2026-07-03 · v0.1.0');
  });
  it('defaults when the template is empty', () => {
    expect(renderCommitMessage('', { date: '2026-07-03', version: '0.1.0' }))
      .toBe('Publish 2026-07-03 from Minerva');
    expect(renderCommitMessage(undefined, { date: '2026-07-03', version: '0.1.0' }))
      .toBe('Publish 2026-07-03 from Minerva');
  });
});

describe('resolveGitHubToken', () => {
  const OLD = { ...process.env };
  beforeEach(() => {
    hoisted.execFileSync.mockReset();
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });
  afterEach(() => { process.env = { ...OLD }; });

  it('prefers the gh CLI token', () => {
    hoisted.execFileSync.mockReturnValue('gho_fromcli\n');
    expect(resolveGitHubToken()).toBe('gho_fromcli');
  });
  it('falls back to GH_TOKEN when gh is unavailable', () => {
    hoisted.execFileSync.mockImplementation(() => { throw new Error('gh: not found'); });
    process.env.GH_TOKEN = 'ghp_fromenv';
    expect(resolveGitHubToken()).toBe('ghp_fromenv');
  });
  it('throws a configuration message when nothing is available', () => {
    hoisted.execFileSync.mockImplementation(() => { throw new Error('gh: not found'); });
    expect(() => resolveGitHubToken()).toThrow(/credentials aren't configured/i);
  });
});

describe('workspace lifecycle (real isomorphic-git)', () => {
  let dir: string;
  beforeEach(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'minerva-pub-'));
    await git.init({ fs: fsMod, dir, defaultBranch: 'main' });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const sorted = (c: Array<{ path: string; status: string }>) =>
    [...c].sort((a, b) => a.path.localeCompare(b.path));

  it('classifies, stages, and commits adds/modifies/deletes across two publishes', async () => {
    writeFileSync(path.join(dir, 'a.txt'), 'A');
    mkdirSync(path.join(dir, 'sub'));
    writeFileSync(path.join(dir, 'sub', 'b.txt'), 'B');

    expect(sorted(await pendingChanges(dir))).toEqual([
      { path: 'a.txt', status: 'added' },
      { path: 'sub/b.txt', status: 'added' },
    ]);

    await stageAll(dir);
    const sha1 = await commit(dir, 'first publish');
    expect(sha1).toMatch(/^[0-9a-f]{40}$/);
    expect(await pendingChanges(dir)).toEqual([]); // clean after commit

    // Second publish: modify one, delete one, add one.
    writeFileSync(path.join(dir, 'a.txt'), 'A-changed');
    rmSync(path.join(dir, 'sub', 'b.txt'));
    writeFileSync(path.join(dir, 'c.txt'), 'C');

    expect(sorted(await pendingChanges(dir))).toEqual([
      { path: 'a.txt', status: 'modified' },
      { path: 'c.txt', status: 'added' },
      { path: 'sub/b.txt', status: 'deleted' },
    ]);

    await stageAll(dir);
    await commit(dir, 'second publish');
    const log = await git.log({ fs: fsMod, dir });
    expect(log.length).toBe(2);
    expect(log[0].commit.message).toContain('second publish');
  });
});
