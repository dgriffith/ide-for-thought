/**
 * One-shot loopback OAuth callback listener (#2030) — tested for real: a
 * real bound port, a real `http.get()`, no mocking needed.
 */
import { describe, it, expect } from 'vitest';
import http from 'node:http';
import { startCallbackListener } from '../../../../src/main/mcp-client/oauth/callback-server';

function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', reject);
  });
}

describe('startCallbackListener', () => {
  it('binds an ephemeral port on 127.0.0.1 and produces a matching redirectUri', async () => {
    const listener = await startCallbackListener();
    expect(listener.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    listener.result.catch(() => undefined); // this test doesn't care about the rejection
    listener.close();
  });

  it('captures code/state from a real GET and resolves result', async () => {
    const listener = await startCallbackListener();
    const url = `${listener.redirectUri}?code=auth-code-1&state=state-1`;
    const [response, params] = await Promise.all([get(url), listener.result]);
    expect(response.status).toBe(200);
    expect(response.body).toContain('close this tab');
    expect(params).toEqual({ code: 'auth-code-1', state: 'state-1' });
  });

  it('captures iss, error, and error_description too', async () => {
    const listener = await startCallbackListener();
    const url = new URL(listener.redirectUri);
    url.searchParams.set('error', 'access_denied');
    url.searchParams.set('error_description', 'user declined');
    url.searchParams.set('iss', 'https://as.example.com');
    const [, params] = await Promise.all([get(url.toString()), listener.result]);
    expect(params).toEqual({ error: 'access_denied', error_description: 'user declined', iss: 'https://as.example.com' });
  });

  it('closes after the one request lands — a second request fails', async () => {
    const listener = await startCallbackListener();
    await Promise.all([get(`${listener.redirectUri}?code=c&state=s`), listener.result]);
    // server.close() stops accepting new connections but needs a beat to take
    // effect at the OS level — a request issued in the very same tick can
    // still land.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await expect(get(listener.redirectUri)).rejects.toThrow();
  });

  it('404s a request to a path other than /callback, and stays open for the real one', async () => {
    const listener = await startCallbackListener();
    const wrongPath = listener.redirectUri.replace('/callback', '/not-callback');
    const wrongResponse = await get(wrongPath);
    expect(wrongResponse.status).toBe(404);

    const [, params] = await Promise.all([get(`${listener.redirectUri}?code=c&state=s`), listener.result]);
    expect(params).toEqual({ code: 'c', state: 's' });
  });

  it('close() before any callback arrives rejects the result promise', async () => {
    const listener = await startCallbackListener();
    // Attach the rejection expectation BEFORE calling close() — close()
    // rejects synchronously, and attaching a handler one microtask later
    // would flag it as an unhandled rejection first.
    const expectation = expect(listener.result).rejects.toThrow(/closed before a callback/);
    listener.close();
    await expectation;
  });

  it('an aborted signal rejects the result promise', async () => {
    const controller = new AbortController();
    const listener = await startCallbackListener(controller.signal);
    const expectation = expect(listener.result).rejects.toThrow(/aborted/);
    controller.abort();
    await expectation;
  });
});
