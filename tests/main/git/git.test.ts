/**
 * Integration tests for src/main/git/index.ts (#395).
 *
 * Git is the project's official persistence story — every CLAUDE.md
 * mention of "delete is not scary because git backs every project"
 * relies on this wrapper being correct. The wrapper is thin
 * (~89 LOC) but its `commitAll` does encode the contract that a
 * workdir-deleted file (`workdir === 0`) is `git.remove`'d before
 * the commit. The "rm survives commit" test below is the one that
 * gates the data-loss regression.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import git from 'isomorphic-git';
import { getStatus, initRepo, commitAll, getLog } from '../../../src/main/git';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-git-test-'));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

/**
 * Walk a commit's tree and collect every blob's path. Lets the
 * data-loss tests assert "this file is / isn't in this commit's tree"
 * without going through the working dir.
 */
async function pathsInCommit(rootPath: string, sha: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(treeOid: string, prefix: string): Promise<void> {
    const { tree } = await git.readTree({ fs, dir: rootPath, oid: treeOid });
    for (const entry of tree) {
      const full = prefix ? `${prefix}/${entry.path}` : entry.path;
      if (entry.type === 'tree') await walk(entry.oid, full);
      else out.push(full);
    }
  }
  const { commit } = await git.readCommit({ fs, dir: rootPath, oid: sha });
  await walk(commit.tree, '');
  return out.sort();
}

describe('initRepo + commitAll + getLog round-trip', () => {
  it('initRepo then commitAll returns a SHA and getLog shows one entry', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'README.md'), '# Hello\n', 'utf-8');
    const sha = await commitAll(root, 'initial');

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const log = await getLog(root);
    expect(log).toHaveLength(1);
    expect(log[0].sha).toBe(sha);
    expect(log[0].message.trim()).toBe('initial');
    expect(log[0].author).toBe('Minerva');
    expect(log[0].date).toBeInstanceOf(Date);
  });

  it('commitAll on a fresh file places it in the commit tree', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'foo.md'), '# foo\n', 'utf-8');
    const sha = await commitAll(root, 'add foo');

    const paths = await pathsInCommit(root, sha);
    expect(paths).toEqual(['foo.md']);
  });
});

describe('commitAll handles deletion (gates the data-loss regression)', () => {
  it('a workdir-deleted file is removed from the commit tree', async () => {
    // Plant a file and commit it.
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'doomed.md'), 'goodbye\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'survivor.md'), 'still here\n', 'utf-8');
    const firstSha = await commitAll(root, 'add both');
    expect(await pathsInCommit(root, firstSha)).toEqual(['doomed.md', 'survivor.md']);

    // Delete one file from the workdir, commit again.
    await fsp.unlink(path.join(root, 'doomed.md'));
    const secondSha = await commitAll(root, 'rm doomed');

    const paths = await pathsInCommit(root, secondSha);
    expect(paths).toEqual(['survivor.md']);
    // And the log now has two commits.
    const log = await getLog(root);
    expect(log.map((c) => c.message.trim())).toEqual(['rm doomed', 'add both']);
  });

  it('handles a commit that simultaneously adds, modifies, and removes', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'keep.md'), 'v1\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'remove.md'), 'doomed\n', 'utf-8');
    await commitAll(root, 'baseline');

    // Three changes at once: edit one, delete one, add one.
    await fsp.writeFile(path.join(root, 'keep.md'), 'v2\n', 'utf-8');
    await fsp.unlink(path.join(root, 'remove.md'));
    await fsp.writeFile(path.join(root, 'fresh.md'), 'new\n', 'utf-8');
    const sha = await commitAll(root, 'mixed');

    expect(await pathsInCommit(root, sha)).toEqual(['fresh.md', 'keep.md']);
  });
});

describe('getStatus', () => {
  it('returns isRepo=false on a non-repo dir without throwing', async () => {
    const status = await getStatus(root);
    expect(status).toEqual({ isRepo: false, branch: null, files: [] });
  });

  it('returns isRepo=true with the current branch on a fresh repo', async () => {
    await initRepo(root);
    const status = await getStatus(root);
    expect(status.isRepo).toBe(true);
    expect(status.branch).toBe('main');
    expect(status.files).toEqual([]);
  });

  it('labels a brand-new untracked file as "new"', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'novel.md'), 'fresh\n', 'utf-8');
    const status = await getStatus(root);
    expect(status.files).toEqual([{ filepath: 'novel.md', status: 'new' }]);
  });

  it('labels a modified-since-last-commit file as "modified"', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'note.md'), 'v1\n', 'utf-8');
    await commitAll(root, 'first');
    // Use a length-differing rewrite so isomorphic-git's size+mtime
    // cache doesn't short-circuit the diff (same-length same-second
    // rewrites can stay invisible to statusMatrix).
    await fsp.writeFile(path.join(root, 'note.md'), 'a much longer version 2\n', 'utf-8');

    const status = await getStatus(root);
    expect(status.files).toEqual([{ filepath: 'note.md', status: 'modified' }]);
  });

  it('labels a workdir-deleted (committed) file as "deleted"', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'gone.md'), 'bye\n', 'utf-8');
    await commitAll(root, 'first');
    await fsp.unlink(path.join(root, 'gone.md'));

    const status = await getStatus(root);
    expect(status.files).toEqual([{ filepath: 'gone.md', status: 'deleted' }]);
  });

  it('omits clean files (head/workdir/stage all 1) from the listing', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'a.md'), 'a\n', 'utf-8');
    await fsp.writeFile(path.join(root, 'b.md'), 'b\n', 'utf-8');
    await commitAll(root, 'baseline');
    // Touch one file; the other is clean.
    await fsp.writeFile(path.join(root, 'a.md'), 'aa\n', 'utf-8');

    const status = await getStatus(root);
    expect(status.files).toEqual([{ filepath: 'a.md', status: 'modified' }]);
  });
});

describe('getLog', () => {
  it('returns [] on a non-repo dir', async () => {
    const log = await getLog(root);
    expect(log).toEqual([]);
  });

  it('returns [] on a fresh repo with no commits yet', async () => {
    await initRepo(root);
    const log = await getLog(root);
    expect(log).toEqual([]);
  });

  it('respects the depth argument', async () => {
    await initRepo(root);
    await fsp.writeFile(path.join(root, 'a.md'), '1\n', 'utf-8');
    await commitAll(root, 'one');
    await fsp.writeFile(path.join(root, 'a.md'), '2\n', 'utf-8');
    await commitAll(root, 'two');
    await fsp.writeFile(path.join(root, 'a.md'), '3\n', 'utf-8');
    await commitAll(root, 'three');

    const limited = await getLog(root, 2);
    expect(limited.map((c) => c.message.trim())).toEqual(['three', 'two']);
  });
});
