import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as gitOps from '../git/index';
import type { GitStatus } from '../git/index';
import { withRootPath, withRootPathOr } from './helpers';

export function registerGit(): void {
  // Git
  handle(Channels.GIT_STATUS, withRootPathOr<[], GitStatus | Promise<GitStatus>>({ isRepo: false, branch: null, files: [] }, async (rootPath) => {
    return gitOps.getStatus(rootPath);
  }));

  // Any failure throws (CLAUDE.md IPC rule 1), so the only answer is the new
  // commit's sha. A hardcoded `success: true` used to sit beside it (#2364).
  handle(Channels.GIT_COMMIT, withRootPath(async (rootPath, message: string) => {
    const sha = await gitOps.commitAll(rootPath, message);
    return { sha };
  }));
}
