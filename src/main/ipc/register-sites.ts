import { ipcMain } from 'electron';
import { Channels } from '../../shared/channels';
import {
  listSites as listPrivilegedSites,
  addSite as addPrivilegedSite,
  removeSite as removePrivilegedSite,
  logoutSite as logoutPrivilegedSite,
  openLoginWindow as openPrivilegedLogin,
} from '../privileged-sites';

export function registerSites(): void {
  // Privileged sites
  ipcMain.handle(Channels.SITES_LIST, () => listPrivilegedSites());
  ipcMain.handle(Channels.SITES_ADD, (_e, domain: string, label?: string) =>
    addPrivilegedSite(domain, label),
  );
  ipcMain.handle(Channels.SITES_REMOVE, (_e, id: string) => removePrivilegedSite(id));
  ipcMain.handle(Channels.SITES_LOGIN, async (_e, id: string) => {
    await openPrivilegedLogin(id);
  });
  ipcMain.handle(Channels.SITES_LOGOUT, (_e, id: string) => logoutPrivilegedSite(id));
}
