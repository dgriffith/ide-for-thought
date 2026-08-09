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
import * as gh from '../git/github-repo';
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
  /**
   * The GitHub repo the remote points at doesn't exist (or isn't visible to
   * this token), and the run didn't create it because the caller hasn't said
   * to. NOTHING was published — the UI asks, then calls again with
   * `createRepo`. Set on a dry run too, where it's just information.
   */
  repoMissing?: { owner: string; repo: string };
  /** This run created the repository. */
  repoCreated?: boolean;
  /** GitHub Pages site URL, once Pages is serving this branch. */
  pagesUrl?: string;
  /** Why Pages wasn't configured, when it couldn't be. */
  pagesNote?: string;
}

export interface PublishOptions {
  dryRun?: boolean;
  /**
   * Permission to create the GitHub repo when it's missing, and how public it
   * should be. Absent means "don't" — creating a repo on someone's account is
   * outward-facing and awkward to undo, so it never happens without an
   * explicit answer to the `repoMissing` prompt.
   */
  createRepo?: { private: boolean };
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

  // ── GitHub repo provisioning ───────────────────────────────────────────
  // Only for github.com remotes; a GitLab/Codeberg target parses to null and
  // takes none of this path.
  const ref = gh.parseGitHubRepo(pg.normalizeRemoteToHttps(target.gitRemote));
  let repoCreated = false;
  if (ref) {
    const state = await gh.checkRepoExists(token, ref);
    if (state === 'missing') {
      if (!opts.createRepo) {
        // Stop before any export work: the caller has to decide.
        return {
          targetId, dryRun, branch: target.gitBranch, branchCreated: true,
          changes: [], committed: false, pushed: false, repoMissing: ref,
        };
      }
      if (!dryRun) {
        await gh.createRepo(token, ref, {
          private: opts.createRepo.private,
          description: `Published from Minerva — ${target.label}`,
        });
        repoCreated = true;
      }
    }
  }

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
    ...(repoCreated ? { repoCreated: true } : {}),
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

  // Pages goes on AFTER the push: GitHub rejects a source branch that doesn't
  // exist yet. Never fatal — the content is already published either way, so a
  // Pages problem is reported beside the success, not raised over it.
  const pages = ref ? await configurePages(token, ref, target.gitBranch, subdir) : {};

  return { ...base, committed: true, pushed: true, sha, commitMessage: message, ...pages };
}

/** Point Pages at the freshly-pushed branch, reporting rather than throwing. */
async function configurePages(
  token: string,
  ref: gh.GitHubRepoRef,
  branch: string,
  subdir: string,
): Promise<{ pagesUrl?: string; pagesNote?: string }> {
  const pagesPath = gh.pagesPathForSubdir(subdir);
  if (!pagesPath) {
    return {
      pagesNote:
        `GitHub Pages can only serve the repository root or /docs, so it wasn't configured for ` +
        `"${subdir}". The files are pushed — point Pages at them yourself if you want a site.`,
    };
  }
  try {
    const url = await gh.enablePages(token, ref, { branch, path: pagesPath });
    return url ? { pagesUrl: url } : {};
  } catch (e) {
    return { pagesNote: e instanceof Error ? e.message : String(e) };
  }
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
