/**
 * Encrypted OAuth token storage (#2030) — `userData/mcp-oauth-tokens.json`,
 * keyed by canonical server URL (see `resource-metadata.ts`'s
 * `canonicalServerUri` — the same identity RFC 8707 binds a token to, so
 * this isn't an arbitrary key choice). Per-machine, not per-thoughtbase:
 * `McpServerDescriptor` itself isn't thoughtbase-scoped either (#2029).
 *
 * `accessToken`/`refreshToken`/`clientSecret` are encrypted at rest via
 * `src/main/secret-storage.ts` (`enc:v1:`-prefixed, OS-keychain-backed) —
 * the same mechanism `llm/settings.ts` and `clipper/clipper-config.ts`
 * already use. Reads go through `config-store.ts`'s `loadConfigFile`, so a
 * corrupt file degrades to "no stored tokens" (loud-logged) rather than
 * crashing a connect attempt. No legacy-format migration is needed — this
 * is a brand-new store.
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs/promises';
import { asFiniteNumber, asRecord, asString, loadConfigFile } from '../../config/config-store';
import { decryptSecret, encryptSecret } from '../../secret-storage';
import type { StoredOAuthRecord } from './types';

type StoredOAuthMap = Record<string, StoredOAuthRecord>;

function tokenStorePath(): string {
  return path.join(app.getPath('userData'), 'mcp-oauth-tokens.json');
}

function decodeRecord(raw: unknown, serverUrl: string): StoredOAuthRecord | null {
  const o = asRecord(raw);
  const issuer = asString(o.issuer, '');
  const clientId = asString(o.clientId, '');
  const tokenEndpoint = asString(o.tokenEndpoint, '');
  const encryptedAccessToken = asString(o.accessToken, '');
  // A record missing any of these is useless — drop it rather than hand
  // back a half-formed record a connect attempt can't act on.
  if (!issuer || !clientId || !tokenEndpoint || !encryptedAccessToken) return null;

  const record: StoredOAuthRecord = {
    serverUrl,
    issuer,
    clientId,
    tokenEndpoint,
    resource: asString(o.resource, ''),
    accessToken: decryptSecret(encryptedAccessToken),
    scope: asString(o.scope, ''),
  };
  const encryptedClientSecret = asString(o.clientSecret, '');
  if (encryptedClientSecret) record.clientSecret = decryptSecret(encryptedClientSecret);
  const encryptedRefreshToken = asString(o.refreshToken, '');
  if (encryptedRefreshToken) record.refreshToken = decryptSecret(encryptedRefreshToken);
  const expiresAt = asFiniteNumber(o.expiresAt, Number.NaN);
  if (!Number.isNaN(expiresAt)) record.expiresAt = expiresAt;
  return record;
}

function decode(raw: unknown): StoredOAuthMap {
  const root = asRecord(raw);
  const out: StoredOAuthMap = {};
  for (const [serverUrl, value] of Object.entries(root)) {
    const record = decodeRecord(value, serverUrl);
    if (record) out[serverUrl] = record;
  }
  return out;
}

function readAll(): Promise<StoredOAuthMap> {
  return loadConfigFile(tokenStorePath, decode, {});
}

function encodeRecord(record: StoredOAuthRecord): Record<string, unknown> {
  const onDisk: Record<string, unknown> = {
    issuer: record.issuer,
    clientId: record.clientId,
    tokenEndpoint: record.tokenEndpoint,
    resource: record.resource,
    accessToken: encryptSecret(record.accessToken),
    scope: record.scope,
  };
  if (record.clientSecret) onDisk.clientSecret = encryptSecret(record.clientSecret);
  if (record.refreshToken) onDisk.refreshToken = encryptSecret(record.refreshToken);
  if (record.expiresAt !== undefined) onDisk.expiresAt = record.expiresAt;
  return onDisk;
}

async function writeAll(map: StoredOAuthMap): Promise<void> {
  const onDisk: Record<string, unknown> = {};
  for (const [serverUrl, record] of Object.entries(map)) onDisk[serverUrl] = encodeRecord(record);
  await fs.writeFile(tokenStorePath(), JSON.stringify(onDisk, null, 2), 'utf-8');
}

/** Multiple servers can plausibly finish auth near-simultaneously (e.g. at
 *  app startup) — this in-module chain lock keeps a read-modify-write
 *  sequence from racing and silently dropping one server's token. */
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function getStoredTokens(serverUrl: string): Promise<StoredOAuthRecord | null> {
  const all = await readAll();
  return all[serverUrl] ?? null;
}

export function saveStoredTokens(record: StoredOAuthRecord): Promise<void> {
  return withLock(async () => {
    const all = await readAll();
    all[record.serverUrl] = record;
    await writeAll(all);
  });
}

export function deleteStoredTokens(serverUrl: string): Promise<void> {
  return withLock(async () => {
    const all = await readAll();
    if (!(serverUrl in all)) return;
    delete all[serverUrl];
    await writeAll(all);
  });
}
