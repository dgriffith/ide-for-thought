import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import * as templates from '../notebase/templates';
import type { TemplateInfo } from '../notebase/templates';
import { withRootPath, withRootPathOr } from './helpers';

export function registerTemplates(): void {
  // Templates (#475)
  ipcMain.handle(Channels.TEMPLATES_LIST, withRootPathOr<[], TemplateInfo[] | Promise<TemplateInfo[]>>([], async (rootPath) => {
    return templates.listTemplates(rootPath);
  }));

  ipcMain.handle(Channels.TEMPLATES_GET, withRootPathOr(null, async (rootPath, filename: string) => {
    try {
      return await templates.readTemplate(rootPath, filename);
    } catch {
      return null;
    }
  }));

  ipcMain.handle(Channels.TEMPLATES_SAVE_AS, withRootPath(async (rootPath, name: string, content: string) => {
    return await templates.saveTemplate(rootPath, name, content);
  }));
}
