import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as templates from '../notebase/templates';
import { rootPathFromEvent } from './helpers';

export function registerTemplates(): void {
  // Templates (#475)
  ipcMain.handle(Channels.TEMPLATES_LIST, async (e) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return [];
    return templates.listTemplates(rootPath);
  });

  ipcMain.handle(Channels.TEMPLATES_GET, async (e, filename: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) return null;
    try {
      return await templates.readTemplate(rootPath, filename);
    } catch {
      return null;
    }
  });

  ipcMain.handle(Channels.TEMPLATES_SAVE_AS, async (e, name: string, content: string) => {
    const rootPath = rootPathFromEvent(e);
    if (!rootPath) throw new Error('No project open');
    return await templates.saveTemplate(rootPath, name, content);
  });
}
