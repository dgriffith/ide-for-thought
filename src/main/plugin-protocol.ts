/**
 * Serve plugin frames at `minerva-plugin://<id>/` (#2824), from the plugin's
 * own folder, under the frame CSP. The scheme is declared privileged with the
 * app's in `registerAppScheme`; this installs its handler once the app is
 * ready. What a request may name, and which plugins have a frame at all, is
 * `plugins/frame-files.ts`.
 */
import { protocol } from 'electron';
import { PLUGIN_SCHEME } from '../shared/plugins/frame';
import { fileResponse } from './app-protocol';
import { pluginFrameCsp, pluginFrameRoot, resolvePluginFrameFile, type PluginFrameRootLookup } from './plugins/frame-files';

/** Install the handler. `embedderOrigins` are who may frame a plugin: the app's origin (and the dev server's). */
export function installPluginProtocol(embedderOrigins: readonly string[], rootFor: PluginFrameRootLookup = pluginFrameRoot): void {
  const csp = pluginFrameCsp(embedderOrigins);
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const file = await resolvePluginFrameFile(request.url, rootFor);
    if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Security-Policy': csp } });
    return fileResponse(file, csp);
  });
}
