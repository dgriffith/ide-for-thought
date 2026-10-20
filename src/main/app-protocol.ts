/**
 * The renderer is served from `app://minerva/…`, not `file://` (#2564).
 *
 * Under `file://`, CSP `'self'` meant the whole disk — any `file://` script
 * passed `script-src 'self'`, which is half of what made #2552 exploitable —
 * and the `GrantFileProtocolExtraPrivileges` fuse had to stay on. A privileged
 * custom scheme makes `'self'` mean exactly the renderer bundle: this handler
 * serves files from the bundle directory and nothing else
 * (`resolveAppRequest` refuses anything outside it), so the fuse is off.
 *
 * `registerAppScheme` must run before `app.whenReady()` (Electron's rule for
 * privileged schemes); `installAppProtocol` after. It also declares the
 * plugin frames' `minerva-plugin:` scheme (#2824), since Electron takes one
 * call for all of them.
 */
import { protocol } from 'electron';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { isEnoent } from './config/json-file';
import { APP_SCHEME, appMimeType, resolveAppRequest } from './app-protocol-paths';
import { PLUGIN_SCHEME } from '../shared/plugins/frame';

export function registerAppScheme(): void {
  // Every custom scheme in one call: Electron documents
  // `registerSchemesAsPrivileged` as callable only once.
  protocol.registerSchemesAsPrivileged([{
    scheme: APP_SCHEME,
    privileges: {
      // A real origin (`app://minerva`), relative URLs, storage, workers.
      standard: true,
      // Treated like https: secure context, no mixed-content downgrade.
      secure: true,
      // fetch()/XHR of bundled assets (WASM, OCR traineddata) from page and workers.
      supportFetchAPI: true,
      // Large assets (the 27MB ORT WASM) stream rather than buffer.
      stream: true,
      codeCache: true,
    },
  }, {
    // Plugin frames (#2824): a real origin per plugin (`minerva-plugin://<id>`)
    // in a secure context, and nothing more. No fetch/CORS support, no CSP
    // bypass, no service workers: the frame's own CSP refuses the network.
    scheme: PLUGIN_SCHEME,
    privileges: { standard: true, secure: true, stream: true },
  }]);
}

/** Serve `rendererRoot` at `app://minerva/`, with `csp` on every response. */
export function installAppProtocol(rendererRoot: string, csp: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    const file = resolveAppRequest(request.url, rendererRoot);
    if (!file) return new Response('Not found', { status: 404 });
    return fileResponse(file, csp);
  });
}

/**
 * A streamed 200 for `file` with `csp` set, or a 404 when it isn't a file —
 * shared by the `app:` and `minerva-plugin:` handlers (#2824).
 */
export async function fileResponse(file: string, csp: string): Promise<Response> {
  // Node's fs, not net.fetch(file://…): the bundle lives inside app.asar,
  // which main's fs reads transparently but Chromium's file handler cannot
  // once GrantFileProtocolExtraPrivileges is off — the reason that fuse had
  // to stay on while the renderer was file://.
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch (e) {
    if (isEnoent(e) || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return new Response('Not found', { status: 404 });
    throw e;
  }
  if (!stat.isFile()) return new Response('Not found', { status: 404 });
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': appMimeType(file),
      // Set here as well as by `installCsp`'s onHeadersReceived hook, which
      // a protocol.handle response does pass through (#2824 found it): the
      // hook writes the renderer's CSP, and leaves a plugin frame's alone.
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': String(stat.size),
    },
  });
}
