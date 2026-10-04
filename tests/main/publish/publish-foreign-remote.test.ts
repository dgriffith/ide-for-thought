/**
 * A shared thoughtbase whose config.json names a foreign publish remote
 * (#2556), through the REAL config reader and publish orchestration: nothing
 * is resolved, cloned or sent until this machine approves the remote — and
 * even approved, the gh CLI / env token never goes to a non-GitHub host.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { useTempDir } from '../../helpers/temp-project';
import { FOREIGN_PUBLISH_REMOTE, writeForeignPublishRemoteConfig } from '../../helpers/hostile-thoughtbase';

const h = vi.hoisted(() => ({ execFileSync: vi.fn(), clone: vi.fn() }));

// The gh CLI "is signed in": if anything asks it for a token, it answers.
vi.mock('node:child_process', async (orig) => ({
  ...(await orig<typeof import('node:child_process')>()),
  execFileSync: h.execFileSync,
}));
vi.mock('isomorphic-git', async (orig) => {
  const actual = await orig<{ default: Record<string, unknown> }>();
  return { default: { ...actual.default, clone: h.clone } };
});

import { publishToGit } from '../../../src/main/publish/publish-to-git';
import { _setRemoteApprovalsPathForTests } from '../../../src/main/publish/remote-approvals';

const tmp = useTempDir('minerva-foreign-remote-');
const envSnapshot = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };

beforeEach(() => {
  h.execFileSync.mockReset().mockReturnValue('gho_users_real_token\n');
  h.clone.mockReset();
  process.env.GH_TOKEN = 'ghp_users_env_token';
  _setRemoteApprovalsPathForTests(path.join(tmp.root, 'userData-approvals.json'));
});
afterEach(() => {
  _setRemoteApprovalsPathForTests(null);
  for (const [k, v] of Object.entries(envSnapshot)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('a thoughtbase shipping a foreign publish remote (#2556)', () => {
  it('stops for approval before asking gh for a token or touching the network', async () => {
    const id = writeForeignPublishRemoteConfig(tmp.root);
    const res = await publishToGit(tmp.root, id, { version: '1.0.0' });
    expect(res.remoteUnapproved).toEqual({ host: 'git.attacker.example', url: FOREIGN_PUBLISH_REMOTE });
    expect(h.execFileSync).not.toHaveBeenCalled();
    expect(h.clone).not.toHaveBeenCalled();
  });

  it('even once approved, the gh CLI / env token is refused for that host', async () => {
    const id = writeForeignPublishRemoteConfig(tmp.root);
    await expect(publishToGit(tmp.root, id, { version: '1.0.0', approveRemote: FOREIGN_PUBLISH_REMOTE }))
      .rejects.toThrow(/only ever sent to github\.com, not git\.attacker\.example/);
    expect(h.execFileSync).not.toHaveBeenCalled();
    expect(h.clone).not.toHaveBeenCalled();
  });
});
