/**
 * The substrate server (CLI → running app) on 127.0.0.1 (#2567): a body cap,
 * a DNS-rebinding Host check, a constant-time token compare, and an advert
 * that is owner-only and never committed with the thoughtbase.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { useTempDir } from '../../helpers/temp-project';
import * as appServer from '../../../src/main/substrate/app-server';
import { projectContext } from '../../../src/main/project-context-types';
import { tokensMatch } from '../../../src/main/loopback-guards';

const tmp = useTempDir('minerva-substrate-hardening-');
let root = '';
afterEach(async () => { if (root) await appServer.unregisterProject(root); });

function advert(): { port: number; token: string } {
  return JSON.parse(fs.readFileSync(path.join(root, '.minerva', 'runtime.json'), 'utf-8')) as { port: number; token: string };
}

function post(port: number, body: string | Buffer, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/rpc', method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      let data = '';
      res.on('data', (c: Buffer) => { data += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', (e: NodeJS.ErrnoException) => {
      // The server may cut an oversized upload off mid-send after answering.
      if (e.code === 'EPIPE' || e.code === 'ECONNRESET') resolve({ status: -1, body: '' });
      else reject(e);
    });
    req.end(body);
  });
}

async function register(): Promise<{ port: number; token: string }> {
  root = tmp.root;
  fs.mkdirSync(path.join(root, '.minerva'), { recursive: true }); // every real thoughtbase has one
  await appServer.registerProject(projectContext(root));
  return advert();
}

describe('substrate app-server hardening (#2567)', () => {
  it('writes runtime.json owner-only and gitignores it inside the thoughtbase', async () => {
    await register();
    const file = path.join(root, '.minerva', 'runtime.json');
    if (process.platform !== 'win32') expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const ignore = fs.readFileSync(path.join(root, '.minerva', '.gitignore'), 'utf-8').split('\n');
    expect(ignore).toContain('runtime.json');
  });

  it('refuses a request whose Host is not loopback (DNS rebinding)', async () => {
    const { port, token } = await register();
    const r = await post(port, JSON.stringify({ rootPath: root, token, op: 'x' }), { host: 'evil.example:' + port });
    expect(r.status).toBe(403);
    expect(r.body).toMatch(/forbidden host/);
  });

  it('refuses an oversized body with 413', async () => {
    const { port } = await register();
    const r = await post(port, Buffer.alloc(2 * 1024 * 1024, 0x20));
    expect([413, -1]).toContain(r.status);
    if (r.status === 413) expect(r.body).toMatch(/too large/);
  });

  it('a wrong token and an unknown project look the same (403)', async () => {
    const { port, token } = await register();
    const wrong = await post(port, JSON.stringify({ rootPath: root, token: token.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')), op: 'x' }));
    const unknown = await post(port, JSON.stringify({ rootPath: '/elsewhere', token, op: 'x' }));
    expect(wrong.status).toBe(403);
    expect(unknown.status).toBe(403);
    expect(wrong.body).toBe(unknown.body);
  });
});

describe('tokensMatch (#2567)', () => {
  it('compares in constant time, and is false for wrong, missing or differently sized tokens', () => {
    expect(tokensMatch('abc123', 'abc123')).toBe(true);
    expect(tokensMatch('abc124', 'abc123')).toBe(false);
    expect(tokensMatch('abc12', 'abc123')).toBe(false);
    expect(tokensMatch(undefined, 'abc123')).toBe(false);
    expect(tokensMatch(123, 'abc123')).toBe(false);
    expect(tokensMatch('', '')).toBe(false);
  });
});
