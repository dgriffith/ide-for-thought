/**
 * Publish → git orchestration decisions (#254). Transport (clone/push) and the
 * exporter are mocked so we can pin the control flow: dry-run never commits,
 * a no-change run cuts no empty commit, a changed run commits + pushes with a
 * rendered message, a missing target errors, and the publish-cache gets
 * gitignored. The real git/transport work is covered in publish-git.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Target = {
  id: string; label: string; exporter: string; gitRemote: string;
  gitBranch: string; subdir: string; commitMessageTemplate: string;
} | null;
type Change = { path: string; status: string };

const h = vi.hoisted(() => {
  const target: Target = {
    id: 't', label: 'T', exporter: 'static-site',
    gitRemote: 'https://github.com/o/r.git', gitBranch: 'gh-pages',
    subdir: '', commitMessageTemplate: 'Publish {{date}} v{{version}}',
  };
  return {
    target,
    runExport: vi.fn(async () => ({ filesWritten: 0, summary: '', outputDir: '', writtenPaths: [] })),
    pg: {
      resolveGitHubToken: vi.fn(() => 'tok'),
      prepareWorkspace: vi.fn(async () => ({ branchExisted: true })),
      clearWorkTree: vi.fn(async () => {}),
      pendingChanges: vi.fn<() => Promise<Change[]>>(async () => []),
      stageAll: vi.fn(async () => {}),
      commit: vi.fn(async () => 'sha_abc'),
      push: vi.fn(async () => {}),
    },
  };
});

vi.mock('../../../src/main/project-config', () => ({ getPublishTarget: () => h.target, getGitCredentials: () => ({}) }));
vi.mock('../../../src/main/publish/run-export', () => ({ runExport: h.runExport }));
vi.mock('../../../src/main/git/publish-git', async (orig) => {
  const actual = await orig<typeof import('../../../src/main/git/publish-git')>();
  return { ...actual, ...h.pg }; // keep pure helpers (renderCommitMessage) real
});

import { publishToGit } from '../../../src/main/publish/publish-to-git';

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'minerva-pubroot-'));
  h.target = {
    id: 't', label: 'T', exporter: 'static-site',
    gitRemote: 'https://github.com/o/r.git', gitBranch: 'gh-pages',
    subdir: '', commitMessageTemplate: 'Publish {{date}} v{{version}}',
  };
  Object.values(h.pg).forEach((fn) => fn.mockClear());
  h.pg.pendingChanges.mockResolvedValue([]);
  h.runExport.mockClear();
});

const opts = { version: '1.2.3', nowIso: '2026-07-03T09:00:00Z' };

describe('publishToGit', () => {
  it('dry-run reports changes but never commits or pushes', async () => {
    h.pg.pendingChanges.mockResolvedValue([{ path: 'index.html', status: 'modified' }]);
    const res = await publishToGit(root, 't', { ...opts, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.changes).toHaveLength(1);
    expect(res.committed).toBe(false);
    expect(res.pushed).toBe(false);
    expect(h.pg.commit).not.toHaveBeenCalled();
    expect(h.pg.push).not.toHaveBeenCalled();
  });

  it('cuts no commit when nothing changed', async () => {
    h.pg.pendingChanges.mockResolvedValue([]);
    const res = await publishToGit(root, 't', opts);
    expect(res.committed).toBe(false);
    expect(res.pushed).toBe(false);
    expect(h.pg.commit).not.toHaveBeenCalled();
    expect(h.pg.push).not.toHaveBeenCalled();
  });

  it('commits with a rendered message and pushes when there are changes', async () => {
    h.pg.pendingChanges.mockResolvedValue([{ path: 'index.html', status: 'added' }]);
    const res = await publishToGit(root, 't', opts);
    expect(res.committed).toBe(true);
    expect(res.pushed).toBe(true);
    expect(res.sha).toBe('sha_abc');
    expect(res.commitMessage).toBe('Publish 2026-07-03 v1.2.3');
    expect(h.pg.stageAll).toHaveBeenCalledOnce();
    expect(h.pg.commit).toHaveBeenCalledWith(expect.any(String), 'Publish 2026-07-03 v1.2.3');
    expect(h.pg.push).toHaveBeenCalledOnce();
  });

  it('reports branchCreated when the remote branch did not exist', async () => {
    h.pg.prepareWorkspace.mockResolvedValueOnce({ branchExisted: false });
    h.pg.pendingChanges.mockResolvedValue([{ path: 'index.html', status: 'added' }]);
    const res = await publishToGit(root, 't', opts);
    expect(res.branchCreated).toBe(true);
  });

  it('throws a clear error when the target is not configured', async () => {
    h.target = null;
    await expect(publishToGit(root, 'nope', opts)).rejects.toThrow(/No publish target/i);
  });

  it('gitignores the publish-cache in the thoughtbase', async () => {
    await publishToGit(root, 't', { ...opts, dryRun: true });
    const ignore = readFileSync(path.join(root, '.minerva', '.gitignore'), 'utf-8');
    expect(ignore).toContain('publish-cache/');
  });
});
