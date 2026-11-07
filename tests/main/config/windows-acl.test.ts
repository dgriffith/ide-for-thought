/**
 * @vitest-environment node
 *
 * Secret files are owner-only on Windows too (#2190): there a mode does
 * nothing, so `SECRET_FILE_MODE` restricts the file's ACL to the current user
 * instead, before the secret is written. The unit tests run everywhere; the
 * last block runs on the Windows CI leg against a real file and reads the ACL
 * back with icacls.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { _resetSidForTests, currentUserSid, restrictToCurrentUser } from '../../../src/main/config/windows-acl';
import { SECRET_FILE_MODE, writeJsonFileAtomic, writeJsonFileAtomicSync } from '../../../src/main/config/json-file';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('secrets');
afterEach(() => _resetSidForTests());

const WHOAMI = '"desktop-1\\\\ada","S-1-5-21-1111-2222-3333-1001"\r\n';

describe('restrictToCurrentUser', () => {
  it('removes inheritance and grants the current user alone, by SID', () => {
    const exec = vi.fn((file: string) => (file === 'whoami' ? WHOAMI : ''));
    expect(restrictToCurrentUser('C:\\tb\\.minerva\\.secrets.json.ab.tmp', exec)).toBe(true);
    expect(exec).toHaveBeenCalledWith('whoami', ['/user', '/fo', 'csv', '/nh']);
    expect(exec).toHaveBeenLastCalledWith('icacls', ['C:\\tb\\.minerva\\.secrets.json.ab.tmp', '/inheritance:r', '/grant:r', '*S-1-5-21-1111-2222-3333-1001:F']);
  });

  it('asks whoami once per process', () => {
    const exec = vi.fn((file: string) => (file === 'whoami' ? WHOAMI : ''));
    restrictToCurrentUser('a', exec);
    restrictToCurrentUser('b', exec);
    expect(exec.mock.calls.filter(([f]) => f === 'whoami')).toHaveLength(1);
    expect(currentUserSid(exec)).toBe('S-1-5-21-1111-2222-3333-1001');
  });

  it('a failure is reported, not thrown: the secret is still saved', () => {
    expect(restrictToCurrentUser('a', () => { throw new Error('icacls: access denied'); })).toBe(false);
    expect(restrictToCurrentUser('a', (file) => (file === 'whoami' ? 'no sid here' : ''))).toBe(false);
  });
});

describe.runIf(process.platform === 'win32')('on Windows, a secret store is owner-only by ACL (#2190)', () => {
  const sid = () => currentUserSid();
  /** icacls' listing: one `<name or SID>:(<rights>)` line per entry. */
  const acl = (file: string) => execFileSync(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'icacls.exe'), [file], { encoding: 'utf-8' });
  /** icacls' entries for `file`: `<name>:(<rights>)`, one per line. */
  const entries = (file: string, listing: string) => listing.split(/\r?\n/).map((l) => l.replace(file, '').trim()).filter((l) => l && !/^Successfully processed/.test(l));

  for (const [name, write] of [
    ['writeJsonFileAtomic', (f: string) => writeJsonFileAtomic(f, { key: 'canary' }, { mode: SECRET_FILE_MODE })],
    ['writeJsonFileAtomicSync', (f: string) => { writeJsonFileAtomicSync(f, { key: 'canary' }, { mode: SECRET_FILE_MODE }); }],
  ] as const) {
    it(`${name}: one entry, the current user, nothing inherited`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-acl-'));
      try {
        const file = path.join(dir, 'secrets.json');
        await write(file);
        expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ key: 'canary' });
        const listing = acl(file);
        // icacls resolves the SID to a name; ask it by SID to compare.
        const name = execFileSync('powershell', ['-NoProfile', '-Command', `(New-Object System.Security.Principal.SecurityIdentifier('${sid()}')).Translate([System.Security.Principal.NTAccount]).Value`], { encoding: 'utf-8' }).trim();
        expect(entries(file, listing), listing).toEqual([`${name}:(F)`]);
        expect(listing).not.toMatch(/\(I\)/); // no inherited entry
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  it('a store written without SECRET_FILE_MODE isn\'t restricted to the user alone', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-acl-'));
    try {
      const file = path.join(dir, 'session.json');
      await writeJsonFileAtomic(file, {});
      // SYSTEM, Administrators and the user, as the runner lists it.
      expect(entries(file, acl(file)).length, acl(file)).toBeGreaterThan(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
