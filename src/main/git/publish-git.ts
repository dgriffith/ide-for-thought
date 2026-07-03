/**
 * Git-remote push primitives for the Publish destination (#254).
 *
 * The app's git stack is isomorphic-git — pure JS, HTTP(S) transport only.
 * It does NOT speak SSH or read the system credential helper / ssh-agent, so
 * we authenticate over HTTPS with a token: preferring the GitHub CLI
 * (`gh auth token`, which the issue calls out as the nicest path) and falling
 * back to a GH_TOKEN / GITHUB_TOKEN env var. SSH remote URLs are rewritten to
 * HTTPS so a user who pasted `git@github.com:…` still works.
 *
 * This module is the low-level workspace/git layer; `publish/publish-to-git.ts`
 * orchestrates it with the exporter pipeline.
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/node';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const AUTHOR = { name: 'Minerva', email: 'user@minerva.local' };

export interface PublishChange {
  path: string;
  status: 'added' | 'modified' | 'deleted';
}

// ── Pure helpers (unit-tested directly) ─────────────────────────────────────

/**
 * Rewrite an SSH remote URL to its HTTPS equivalent. isomorphic-git can't do
 * SSH, so `git@github.com:owner/repo.git` and `ssh://git@host/owner/repo`
 * become `https://…`. HTTP(S) URLs pass through untouched.
 */
export function normalizeRemoteToHttps(url: string): string {
  const trimmed = url.trim();
  const scp = trimmed.match(/^git@([^:]+):(.+)$/); // scp-like: git@host:owner/repo.git
  if (scp) return `https://${scp[1]}/${scp[2]}`;
  const ssh = trimmed.match(/^ssh:\/\/(?:git@)?([^/]+)\/(.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  return trimmed;
}

/**
 * Resolve an HTTPS token, preferring the GitHub CLI (per the issue) and
 * falling back to env. Throws a user-facing message when nothing works —
 * this is the "GitHub isn't configured" surface.
 */
export function resolveGitHubToken(): string {
  try {
    const t = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (t) return t;
  } catch {
    // gh not installed or not signed in — fall through to env.
  }
  const env = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (env) return env;
  throw new Error(
    "Git credentials aren't configured for this remote. Sign in with the GitHub CLI " +
      '(`gh auth login`) or set a GH_TOKEN environment variable, then try again.',
  );
}

/** Render a commit template, filling `{{date}}` / `{{version}}`. */
export function renderCommitMessage(
  template: string | undefined,
  ctx: { date: string; version: string },
): string {
  const t = template && template.trim() ? template : 'Publish {{date}} from Minerva';
  return t.replace(/\{\{\s*(date|version)\s*\}\}/g, (_m, k: string) =>
    k === 'date' ? ctx.date : ctx.version,
  );
}

// ── Workspace git operations ────────────────────────────────────────────────

function authFor(token: string) {
  // GitHub accepts a token as the HTTPS password with any username; the
  // conventional username for app/OAuth tokens is `x-access-token`.
  return () => ({ username: 'x-access-token', password: token });
}

/**
 * Bring the publish-cache workspace to the target branch's current remote
 * state. Re-clones from scratch each publish (cheap for a static site, and it
 * guarantees we're building on the remote's real history rather than an
 * orphan commit or a stale local tree). When the branch doesn't exist yet
 * (first publish to `gh-pages`), fall back to a fresh repo on that branch.
 *
 * Returns whether the branch already existed on the remote.
 */
export async function prepareWorkspace(opts: {
  dir: string;
  url: string;
  branch: string;
  token: string;
}): Promise<{ branchExisted: boolean }> {
  const url = normalizeRemoteToHttps(opts.url);
  await fsp.rm(opts.dir, { recursive: true, force: true });
  await fsp.mkdir(opts.dir, { recursive: true });
  try {
    await git.clone({
      fs,
      http,
      dir: opts.dir,
      url,
      ref: opts.branch,
      singleBranch: true,
      onAuth: authFor(opts.token),
    });
    return { branchExisted: true };
  } catch {
    // Branch (or repo content) not there yet → start a fresh repo on the
    // branch. A genuine auth/404 problem resurfaces — with a clear message —
    // when we push below, which is the real gate.
    await fsp.rm(opts.dir, { recursive: true, force: true });
    await fsp.mkdir(opts.dir, { recursive: true });
    await git.init({ fs, dir: opts.dir, defaultBranch: opts.branch });
    await git.addRemote({ fs, dir: opts.dir, remote: 'origin', url });
    return { branchExisted: false };
  }
}

/** Remove everything in `destDir` except a top-level `.git`, so the exporter
 *  output replaces the previous publish (deletions included). */
export async function clearWorkTree(destDir: string): Promise<void> {
  const entries = await fsp.readdir(destDir, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (e.name === '.git') continue;
    await fsp.rm(path.join(destDir, e.name), { recursive: true, force: true });
  }
}

/** What a commit right now would contain, compared to HEAD (workdir vs HEAD). */
export async function pendingChanges(dir: string): Promise<PublishChange[]> {
  const matrix = await git.statusMatrix({ fs, dir });
  const changes: PublishChange[] = [];
  for (const [filepath, head, workdir] of matrix) {
    if (head === 0 && workdir === 2) changes.push({ path: filepath, status: 'added' });
    else if (head === 1 && workdir === 0) changes.push({ path: filepath, status: 'deleted' });
    else if (head === 1 && workdir === 2) changes.push({ path: filepath, status: 'modified' });
    // head===1&&workdir===1 (unchanged) and head===0&&workdir===0 → skip
  }
  return changes;
}

/** Stage every add / modify / delete in the work tree. */
export async function stageAll(dir: string): Promise<void> {
  const matrix = await git.statusMatrix({ fs, dir });
  for (const [filepath, head, workdir] of matrix) {
    if (workdir === 0) await git.remove({ fs, dir, filepath });
    else if (head !== workdir) await git.add({ fs, dir, filepath });
  }
}

export async function commit(dir: string, message: string): Promise<string> {
  return git.commit({ fs, dir, message, author: AUTHOR });
}

/** Push the branch to origin. Throws with the git-reported reason on rejection. */
export async function push(opts: { dir: string; branch: string; token: string }): Promise<void> {
  const result = await git.push({
    fs,
    http,
    dir: opts.dir,
    remote: 'origin',
    ref: opts.branch,
    onAuth: authFor(opts.token),
  });
  if (result.ok === false || result.error) {
    throw new Error(`git push was rejected: ${result.error ?? 'unknown reason'}`);
  }
}
