/**
 * "Publish → push to git remote" orchestration (#254).
 *
 * Ties the export pipeline to the git-push primitives: run a configured
 * exporter into a per-target checkout of the remote branch, then commit and
 * push. The exporter's own private-by-default filtering is what decides what
 * ships — publishing adds no second, independent privacy rule.
 *
 * Kept free of the electron `app` import so the whole flow is testable against
 * a local `file://` remote; the caller passes `version` / `nowIso`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPublishTarget, getGitCredentials } from '../project-config';
import { runExport } from './run-export';
import * as pg from '../git/publish-git';
import type { PublishChange } from '../git/publish-git';

export interface PublishResult {
  targetId: string;
  dryRun: boolean;
  branch: string;
  /** Branch didn't exist on the remote — this run creates it. */
  branchCreated: boolean;
  changes: PublishChange[];
  committed: boolean;
  pushed: boolean;
  sha?: string;
  commitMessage?: string;
}

export interface PublishOptions {
  dryRun?: boolean;
  /** App version for `{{version}}` in the commit template. */
  version?: string;
  /** ISO timestamp for `{{date}}`; defaults to now. Injectable for tests. */
  nowIso?: string;
}

export async function publishToGit(
  rootPath: string,
  targetId: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const target = getPublishTarget(rootPath, targetId);
  if (!target) throw new Error(`No publish target "${targetId}" is configured for this thoughtbase.`);
  // The dispatcher routes by kind; a non-git target reaching here is a bug.
  if (target.kind === 's3') throw new Error(`Publish target "${targetId}" is not a git target.`);

  const dryRun = opts.dryRun ?? false;
  // Fail fast with a clear message before doing any work if creds are missing.
  // Prefer the target's stored token (#1508), else the gh CLI / env.
  const token = pg.resolveGitHubToken(getGitCredentials(rootPath, targetId).token);

  ensurePublishCacheIgnored(rootPath);
  const workspace = path.join(rootPath, '.minerva', 'publish-cache', target.id);
  const { branchExisted } = await pg.prepareWorkspace({
    dir: workspace,
    url: target.gitRemote,
    branch: target.gitBranch,
    token,
  });

  // Where in the repo the export output lands. '' / '.' → repo root.
  const subdir = (target.subdir ?? '').replace(/^[./]+/, '').replace(/\/+$/, '');
  const destDir = subdir ? path.join(workspace, subdir) : workspace;

  await pg.clearWorkTree(destDir);
  await runExport(rootPath, {
    exporterId: target.exporter,
    input: { kind: 'project' },
    outputDir: destDir,
  });

  const changes = await pg.pendingChanges(workspace);

  const base: PublishResult = {
    targetId,
    dryRun,
    branch: target.gitBranch,
    branchCreated: !branchExisted,
    changes,
    committed: false,
    pushed: false,
  };

  // Dry-run stops here: the user sees exactly what would change, nothing ships.
  if (dryRun) return base;
  // Nothing changed since the last publish — don't cut an empty commit.
  if (changes.length === 0) return base;

  await pg.stageAll(workspace);
  const date = (opts.nowIso ?? new Date().toISOString()).slice(0, 10);
  const message = pg.renderCommitMessage(target.commitMessageTemplate, {
    date,
    version: opts.version ?? '0.0.0',
  });
  const sha = await pg.commit(workspace, message);
  await pg.push({ dir: workspace, branch: target.gitBranch, token });

  return { ...base, committed: true, pushed: true, sha, commitMessage: message };
}

/**
 * Keep the publish-cache out of the user's thoughtbase git repo via a
 * Minerva-owned `.minerva/.gitignore`. Self-contained — we don't touch the
 * user's root `.gitignore`.
 */
function ensurePublishCacheIgnored(rootPath: string): void {
  const dir = path.join(rootPath, '.minerva');
  const file = path.join(dir, '.gitignore');
  const rule = 'publish-cache/';
  let current = '';
  try {
    current = fs.readFileSync(file, 'utf-8');
  } catch {
    // no file yet
  }
  if (current.split(/\r?\n/).some((l) => l.trim() === rule)) return;
  fs.mkdirSync(dir, { recursive: true });
  const next = current && !current.endsWith('\n') ? `${current}\n` : current;
  fs.writeFileSync(
    file,
    `${next}# Minerva-managed derived output — not part of your thoughtbase.\n${rule}\n`,
    'utf-8',
  );
}
