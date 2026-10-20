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
import { pluginFrameCsp, pluginFrameRoot, resolvePluginFrame, type PluginFrameRootLookup } from './plugins/frame-files';
// The plugin API runtime, generated from shared/plugins/api.ts (#2826) and
// inlined at build time.
import PLUGIN_API_JS from '../../plugin-api/index.js?raw';

/** Install the handler. `embedderOrigins` are who may frame a plugin: the app's origin (and the dev server's). */
export function installPluginProtocol(embedderOrigins: readonly string[], rootFor: PluginFrameRootLookup = pluginFrameRoot): void {
  const csp = pluginFrameCsp(embedderOrigins);
  protocol.handle(PLUGIN_SCHEME, async (request) => {
    const found = await resolvePluginFrame(request.url, rootFor);
    if (!found) return new Response('Not found', { status: 404, headers: { 'Content-Security-Policy': csp } });
    if ('api' in found) {
      return new Response(PLUGIN_API_JS, {
        status: 200,
        headers: {
          'Content-Type': 'text/javascript; charset=utf-8',
          'Content-Security-Policy': csp,
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    return fileResponse(found.file, csp);
  });
}
