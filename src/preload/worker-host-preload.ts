/**
 * The plugin worker host's preload (#2830). A page with no preload can't be
 * handed a `MessagePort` from main at all, so this forwards exactly one —
 * the plugin's session port — into Minerva's host page
 * (`main/plugins/worker-host-page.ts`), with the logic module to start. It
 * exposes nothing (no `contextBridge`), and plugin code never runs in this
 * page: only in the Web Worker the page starts.
 */
import { ipcRenderer } from 'electron';
import { WORKER_HOST_PORT_CHANNEL, WORKER_HOST_PORT_MESSAGE } from '../shared/plugins/frame';

ipcRenderer.once(WORKER_HOST_PORT_CHANNEL, (e, msg: { entry?: unknown }) => {
  window.postMessage({ type: WORKER_HOST_PORT_MESSAGE, entry: typeof msg?.entry === 'string' ? msg.entry : '' }, window.location.origin, e.ports);
});
