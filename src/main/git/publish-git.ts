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
// The `http/web` transport uses the standard WHATWG `fetch` (built into
// Electron's Node). We use it instead of `http/node` because the latter pulls
// in `simple-get`, which calls the deprecated `url.parse()` and prints a
// DEP0169 warning on every publish. `fetch` handles our auth headers + body
// the same way (bodies are buffered, so no `duplex` needed).
import http from 'isomorphic-git/http/web';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ConnectionCheckResult } from '../../shared/tools/types';

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
 * Resolve an HTTPS token. Precedence (#1508): a `preferred` token (the target's
 * safeStorage-encrypted token, so the `gh` CLI need not be installed) → the
 * GitHub CLI (`gh auth token`) → a `GH_TOKEN`/`GITHUB_TOKEN` env var. Throws a
 * user-facing message when nothing works — the "GitHub isn't configured" surface.
 */
export function resolveGitHubToken(preferred?: string): string {
  const stored = preferred?.trim();
  if (stored) return stored;
  const cli = ghCliToken();
  if (cli) return cli;
  const env = (process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (env) return env;
  throw new Error(
    "Git credentials aren't configured for this remote. Add a GitHub token in the publish " +
      'target, sign in with the GitHub CLI (`gh auth login`), or set a GH_TOKEN environment variable, then try again.',
  );
}

/** The `gh auth token`, or '' when the CLI is absent / not signed in. */
function ghCliToken(): string {
  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * Validate a GitHub token with a token-free `GET /user` — powers the publish
 * dialog's "Test connection" (#1508). Resolves the effective token
 * (candidate → gh CLI → env) so a blank field tests whatever the push would
 * use. Never throws: failures come back as `{ ok: false, error }`.
 */
export async function checkGitHubToken(candidate?: string): Promise<ConnectionCheckResult> {
  const token = (candidate?.trim() || ghCliToken() || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '').trim();
  if (!token) {
    return { ok: false, error: 'No token to check — enter one, sign in with `gh`, or set GH_TOKEN.' };
  }
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Minerva', Accept: 'application/vnd.github+json' },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, error: 'GitHub rejected the token (invalid or expired).' };
    if (res.status === 403) return { ok: false, error: 'Token accepted but lacks permission (403).' };
    return { ok: false, error: `GitHub returned ${res.status} ${res.statusText}.` };
  } catch (e) {
    return { ok: false, error: `Couldn't reach GitHub: ${e instanceof Error ? e.message : String(e)}` };
  }
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
