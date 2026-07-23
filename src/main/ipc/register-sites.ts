import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import {
  listSites as listPrivilegedSites,
  addSite as addPrivilegedSite,
  removeSite as removePrivilegedSite,
  logoutSite as logoutPrivilegedSite,
  openLoginWindow as openPrivilegedLogin,
} from '../privileged-sites';

export function registerSites(): void {
  // Privileged sites
  handle(Channels.SITES_LIST, () => listPrivilegedSites());
  handle(Channels.SITES_ADD, (_e, domain: string, label?: string) =>
    addPrivilegedSite(domain, label),
  );
  handle(Channels.SITES_REMOVE, (_e, id: string) => removePrivilegedSite(id));
  handle(Channels.SITES_LOGIN, async (_e, id: string) => {
    await openPrivilegedLogin(id);
  });
  handle(Channels.SITES_LOGOUT, (_e, id: string) => logoutPrivilegedSite(id));
}
