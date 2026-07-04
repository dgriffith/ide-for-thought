import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as gitOps from '../git/index';
import type { GitStatus } from '../git/index';
import { withRootPath, withRootPathOr } from './helpers';

export function registerGit(): void {
  // Git
  ipcMain.handle(Channels.GIT_STATUS, withRootPathOr<[], GitStatus | Promise<GitStatus>>({ isRepo: false, branch: null, files: [] }, async (rootPath) => {
    return gitOps.getStatus(rootPath);
  }));

  ipcMain.handle(Channels.GIT_COMMIT, withRootPath(async (rootPath, message: string) => {
    const sha = await gitOps.commitAll(rootPath, message);
    return { success: true, sha };
  }));
}
