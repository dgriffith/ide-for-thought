/**
 * The open thoughtbase's remote-image policy (#1332), and the actions that
 * change it. Main owns the policy and enforces it; this store holds the
 * current one for Settings, and a `version` that ticks whenever any window
 * changes it, so every preview re-draws what it may now load.
 */
import { api } from '../ipc/client';
import type { RemoteImageMode, RemoteImagePolicy } from '../../../shared/remote-images';
import { logger } from '../../../shared/logger';

let policy = $state<RemoteImagePolicy>({ mode: 'ask', hosts: [] });
let version = $state(0);

// Optional chaining, as the other stores do: component tests import this with
// only the `api` surface they mock.
api?.images?.onRemotePolicyChanged?.(({ policy: next }) => {
  policy = next;
  version++;
});

function took(next: RemoteImagePolicy): void {
  policy = next;
  version++;
}

export const remoteImagesStore = {
  get policy(): RemoteImagePolicy { return policy; },
  /** Ticks on every change, here or in another window. */
  get version(): number { return version; },
  async load(): Promise<void> {
    try {
      policy = await api.images.remotePolicy();
    } catch (e) {
      logger('preview').warn('reading the remote-image policy failed:', e);
    }
  },
  async allowHost(host: string): Promise<void> { took(await api.images.allowRemoteHost(host)); },
  async setMode(mode: RemoteImageMode): Promise<void> { took(await api.images.setRemoteMode(mode)); },
  async reset(): Promise<void> { took(await api.images.resetRemotePolicy()); },
};
