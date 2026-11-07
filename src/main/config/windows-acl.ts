/**
 * Owner-only secret files on Windows (#2190).
 *
 * `SECRET_FILE_MODE` (0600) is how a credentials store keeps other local users
 * out on macOS and Linux. On Windows a file mode does nothing: the file takes
 * its folder's ACL. Under `%APPDATA%` or the user profile that is already the
 * user's own (plus SYSTEM and Administrators), but two secret files live in
 * the THOUGHTBASE — `.minerva/secrets.json` (publish credentials) and the
 * substrate server's token advert — and a thoughtbase can sit in a shared
 * folder that other accounts can read.
 *
 * So on Windows a secret file gets the 0600 equivalent: inheritance removed and
 * one entry, full control for the current user (`icacls <file> /inheritance:r
 * /grant:r *<SID>:F`). The writer applies it to the EMPTY temp file before the
 * secret is written, so the secret is never on disk under the folder's ACL,
 * and the rename keeps it (an NTFS rename carries the security descriptor).
 *
 * A failure is logged, not thrown: Windows had no protection here before, and
 * refusing to store a key would leave the app unusable on that machine.
 */
import { execFileSync } from 'node:child_process';
import { logger } from '../../shared/logger';

export type Exec = (file: string, args: string[]) => string;

const run: Exec = (file, args) => execFileSync(file, args, { encoding: 'utf-8', windowsHide: true, timeout: 10_000 });

let cachedSid: string | null = null;

/** The current user's SID, from `whoami /user`'s CSV row ("dom\user","S-1-5-…"). */
export function currentUserSid(exec: Exec = run): string {
  if (cachedSid) return cachedSid;
  const out = exec('whoami', ['/user', '/fo', 'csv', '/nh']);
  const sid = /"(S-1-[\d-]+)"/.exec(out)?.[1];
  if (!sid) throw new Error(`whoami printed no SID: ${out.trim()}`);
  cachedSid = sid;
  return sid;
}

/** Restrict `absPath` to the current user alone. Returns whether it did. */
export function restrictToCurrentUser(absPath: string, exec: Exec = run): boolean {
  try {
    exec('icacls', [absPath, '/inheritance:r', '/grant:r', `*${currentUserSid(exec)}:F`]);
    return true;
  } catch (err) {
    logger('secrets').warn('could not restrict a secret file to this Windows account; it keeps its folder\'s permissions:', absPath, err);
    return false;
  }
}

/** Test-only: forget the cached SID. */
export function _resetSidForTests(): void {
  cachedSid = null;
}
