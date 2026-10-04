/**
 * Which publish remotes this machine has approved for credentials (#2556).
 *
 * A git target's `gitRemote` is in `.minerva/config.json`, which travels with
 * the thoughtbase — by zip, by git sync, by a collaborator's commit. So "the
 * target says push to X" is not the user saying "send my token to X". This
 * store records, per MACHINE, the remote the user approved for each target:
 * typed into the Publish dialog themselves, or confirmed when publishing
 * found the URL changed under them. `publishToGit` sends no credential to a
 * remote that isn't the approved one; it returns `remoteUnapproved` and the
 * dialog asks.
 *
 * Stored in `userData/publish-remote-approvals.json`, never in the
 * thoughtbase: a value a thoughtbase can carry is a value an attacker can
 * pre-compute. Same reasoning as `mcp-servers/tool-permissions.ts` and
 * `compute/consent.ts`.
 *
 * Keyed by a SHA-256 of `(realpath(root), targetId)` — the same target id in
 * another thoughtbase is a different decision. The approved URL is stored as
 * written (it is not secret) so a mismatch can name both.
 *
 * Read/write discipline as in `tool-permissions.ts`: the check reads
 * leniently (a corrupt file reads as "nothing approved", which fails safe —
 * the user is asked again), approval reads strictly and writes atomically.
 * Synchronous read-to-write, so no lock. Electron-free: the path is handed in
 * by `ipc/register-publish.ts`; unconfigured, nothing is approved and
 * approving throws — fail closed.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import {
  asRecord,
  asString,
  loadConfigFileStrictSync,
  loadConfigFileSync,
  requireRecord,
} from '../config/config-store';
import { writeJsonFileAtomicSync } from '../config/json-file';

interface Approval {
  key: string;
  url: string;
  approvedAt: string;
}

interface ApprovalsFile {
  approved: Approval[];
}

let configuredPath: string | null = null;

/** Called once at startup with `userData/publish-remote-approvals.json`. */
export function configureRemoteApprovalsPath(absPath: string): void {
  configuredPath = absPath;
}

/** Test-only: point the store at a temp file, or back to unconfigured. */
export function _setRemoteApprovalsPathForTests(p: string | null): void {
  configuredPath = p;
}

function approvalsPath(): string {
  if (!configuredPath) throw new Error('The publish remote-approvals store is not configured in this process.');
  return configuredPath;
}

/** Stable key for one target in one thoughtbase. */
export function approvalKey(rootPath: string, targetId: string): string {
  let root = rootPath;
  try {
    root = fs.realpathSync(rootPath);
  } catch (e) {
    // A root that can't be resolved keys by its spelling; the approval simply
    // won't be found again from a different spelling, which fails safe.
    if (!(e instanceof Error && 'code' in e)) throw e;
  }
  return createHash('sha256').update(JSON.stringify([root, targetId])).digest('hex');
}

function decode(raw: unknown): ApprovalsFile {
  const list = requireRecord(raw, 'publish-remote-approvals.json').approved;
  if (list !== undefined && !Array.isArray(list)) throw new Error('"approved" is not an array');
  const approved: Approval[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const o = asRecord(item);
    const key = asString(o.key, '');
    const url = asString(o.url, '');
    if (!key || !url) continue;
    approved.push({ key, url, approvedAt: asString(o.approvedAt, '') });
  }
  return { approved };
}

const EMPTY: ApprovalsFile = { approved: [] };

/** The remote this machine approved for the target, or null. */
export function approvedRemote(rootPath: string, targetId: string): string | null {
  if (!configuredPath) return null;
  const key = approvalKey(rootPath, targetId);
  return loadConfigFileSync(approvalsPath, decode, EMPTY).approved.find((a) => a.key === key)?.url ?? null;
}

/** Is `url` (already normalized by the caller) the approved remote for the target? */
export function isRemoteApproved(rootPath: string, targetId: string, url: string): boolean {
  return approvedRemote(rootPath, targetId) === url;
}

/** Record `url` as the target's approved remote, replacing any earlier one. */
export function approveRemote(rootPath: string, targetId: string, url: string): void {
  const key = approvalKey(rootPath, targetId);
  const data = loadConfigFileStrictSync(approvalsPath(), decode, { approved: [] });
  const rest = data.approved.filter((a) => a.key !== key);
  rest.push({ key, url, approvedAt: new Date().toISOString() });
  writeJsonFileAtomicSync(approvalsPath(), { approved: rest }, { trailingNewline: true });
}
