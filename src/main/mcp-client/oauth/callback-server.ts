/**
 * One-shot loopback HTTP listener for the OAuth redirect (#2030). Binds an
 * ephemeral port — `srv.listen(0, '127.0.0.1', ...)`, mirroring
 * `src/main/substrate/app-server.ts`'s exact bind idiom — accepts exactly
 * one `GET /callback`, responds with a static "you can close this tab"
 * page, then closes immediately. Unlike `app-server.ts` this is single-use:
 * bind right before opening the browser, tear down right after the one
 * request lands (or the flow is aborted).
 */
import http from 'node:http';

const CALLBACK_PATH = '/callback';
const SUCCESS_HTML =
  '<!doctype html><html><body><p>Authorization complete — you can close this tab and return to Minerva.</p></body></html>';

/** The callback's raw query params — `code`/`state` on success,
 *  `error`/`error_description` on a denied/failed authorization. `iss` is
 *  RFC 9207's issuer parameter, validated separately in `issuer-validation.ts`. */
export interface CallbackParams {
  code?: string;
  state?: string;
  iss?: string;
  error?: string;
  error_description?: string;
}

export interface CallbackListener {
  redirectUri: string;
  /** Resolves with the callback's params once the browser redirects back
   *  here. Rejects if `close()` is called (or `signal` aborts) before that
   *  happens, or if the server itself errors. */
  result: Promise<CallbackParams>;
  close(): void;
}

/** Start listening. Resolves once bound (not once a callback lands — that's
 *  what the returned `result` promise is for). */
export function startCallbackListener(signal?: AbortSignal): Promise<CallbackListener> {
  return new Promise((resolveListener, rejectListener) => {
    const server = http.createServer();
    let settled = false;
    let resolveResult!: (params: CallbackParams) => void;
    let rejectResult!: (err: Error) => void;
    const result = new Promise<CallbackParams>((res, rej) => {
      resolveResult = res;
      rejectResult = rej;
    });

    function closeWithRejection(reason: string): void {
      if (!settled) {
        settled = true;
        rejectResult(new Error(reason));
      }
      server.close();
    }

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { Connection: 'close' });
        res.end();
        return;
      }
      const params: CallbackParams = {};
      for (const key of ['code', 'state', 'iss', 'error', 'error_description'] as const) {
        const value = url.searchParams.get(key);
        if (value !== null) params[key] = value;
      }
      // `Connection: close` (not just server.close()) so the socket doesn't
      // linger keep-alive — server.close() alone only stops accepting NEW
      // connections once every existing one closes, which a keep-alive
      // client connection would otherwise delay indefinitely.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(SUCCESS_HTML);
      settled = true;
      resolveResult(params);
      server.close();
    });

    server.once('error', (err) => {
      if (!settled) {
        settled = true;
        rejectListener(err);
      }
    });

    signal?.addEventListener('abort', () => closeWithRejection('OAuth callback listener aborted'), { once: true });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolveListener({
        redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
        result,
        close: () => closeWithRejection('OAuth callback listener closed before a callback arrived'),
      });
    });
  });
}
