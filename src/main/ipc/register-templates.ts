import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import * as templates from '../notebase/templates';
import type { TemplateInfo } from '../notebase/templates';
import { withRootPath, withRootPathOr } from './helpers';

export function registerTemplates(): void {
  // Templates (#475)
  handle(Channels.TEMPLATES_LIST, withRootPathOr<[], TemplateInfo[] | Promise<TemplateInfo[]>>([], async (rootPath) => {
    return templates.listTemplates(rootPath);
  }));

  // `null` marks exactly one expected absence: the template file is gone (the
  // user deleted it out from under the picker). "No project open" throws, and a
  // genuine read failure — a bad filename, a permissions error — propagates
  // rather than masquerading as a missing template (#1841).
  handle(Channels.TEMPLATES_GET, withRootPath(async (rootPath, filename: string): Promise<string | null> => {
    try {
      return await templates.readTemplate(rootPath, filename);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }));

  handle(Channels.TEMPLATES_SAVE_AS, withRootPath(async (rootPath, name: string, content: string) => {
    return await templates.saveTemplate(rootPath, name, content);
  }));
}
