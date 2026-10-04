/**
 * The machine-local record of which publish remote each target may send
 * credentials to (#2556).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { useTempDir } from '../../helpers/temp-project';
import {
  _setRemoteApprovalsPathForTests,
  approvalKey,
  approveRemote,
  approvedRemote,
  isRemoteApproved,
} from '../../../src/main/publish/remote-approvals';
import { silenceLogTags } from '../../helpers/quiet-logs';

const tmp = useTempDir('minerva-approvals-');
let file: string;
let rootA: string;
let rootB: string;

beforeEach(() => {
  file = path.join(tmp.root, 'userData', 'publish-remote-approvals.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rootA = path.join(tmp.root, 'a');
  rootB = path.join(tmp.root, 'b');
  fs.mkdirSync(rootA);
  fs.mkdirSync(rootB);
  _setRemoteApprovalsPathForTests(file);
});
afterEach(() => _setRemoteApprovalsPathForTests(null));

describe('remote approvals (#2556)', () => {
  it('records one approved remote per target, replacing the previous one', () => {
    expect(approvedRemote(rootA, 't')).toBeNull();
    approveRemote(rootA, 't', 'https://github.com/o/r.git');
    expect(isRemoteApproved(rootA, 't', 'https://github.com/o/r.git')).toBe(true);
    approveRemote(rootA, 't', 'https://gitlab.com/o/r.git');
    expect(approvedRemote(rootA, 't')).toBe('https://gitlab.com/o/r.git');
    expect(isRemoteApproved(rootA, 't', 'https://github.com/o/r.git')).toBe(false);
  });

  it('scopes an approval to one thoughtbase: the same target id elsewhere is a new decision', () => {
    approveRemote(rootA, 't', 'https://github.com/o/r.git');
    expect(approvedRemote(rootB, 't')).toBeNull();
  });

  it('keys by realpath, so a symlinked spelling of the root is the same thoughtbase', () => {
    const link = path.join(tmp.root, 'link-a');
    fs.symlinkSync(rootA, link);
    approveRemote(link, 't', 'https://github.com/o/r.git');
    expect(approvedRemote(rootA, 't')).toBe('https://github.com/o/r.git');
  });

  it('keeps no plain path or target id on disk — only the hashed key and the url', () => {
    approveRemote(rootA, 'my-target', 'https://github.com/o/r.git');
    const raw = fs.readFileSync(file, 'utf-8');
    expect(raw).not.toContain(rootA);
    expect(raw).not.toContain('my-target');
    expect(raw).toContain(approvalKey(rootA, 'my-target'));
  });

  describe('a corrupt file', () => {
    silenceLogTags('config');
    it('reads as "nothing approved" (fail safe) and refuses to be overwritten', () => {
      fs.writeFileSync(file, '{ not json');
      expect(approvedRemote(rootA, 't')).toBeNull();
      expect(() => approveRemote(rootA, 't', 'https://github.com/o/r.git')).toThrow();
      expect(fs.readFileSync(file, 'utf-8')).toBe('{ not json');
    });
  });

  it('unconfigured: nothing is approved and approving throws', () => {
    _setRemoteApprovalsPathForTests(null);
    expect(approvedRemote(rootA, 't')).toBeNull();
    expect(() => approveRemote(rootA, 't', 'https://github.com/o/r.git')).toThrow(/not configured/);
  });
});
