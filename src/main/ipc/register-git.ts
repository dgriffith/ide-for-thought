import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as gitOps from '../git/index';
import { rootPathFromEvent } from './helpers';

export function registerGit(): void {
  // Git
  ipcMain.handle(Channels.GIT_STATUS, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return { isRepo: false, branch: null, files: [] };
    return gitOps.getStatus(rootPath);
  });

  ipcMain.handle(Channels.GIT_COMMIT, async (e, message: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    const sha = await gitOps.commitAll(rootPath, message);
    return { success: true, sha };
  });
}
