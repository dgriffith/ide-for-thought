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
 * already use. Lookups go through `config-store.ts`'s `loadConfigFile`, so a
 * corrupt file degrades to "no stored tokens" (loud-logged) rather than
 * crashing a connect attempt. Saves and deletes read STRICTLY instead (#2416):
 * a write built on that "no stored tokens" would erase every other server's
 * tokens, so a corrupt file makes the write throw and stays as it was. No
 * legacy-format migration is needed — this is a brand-new store.
 */
import { app } from 'electron';
import path from 'node:path';
import { asFiniteNumber, asRecord, asString, loadConfigFile, loadConfigFileStrict, requireRecord } from '../../config/config-store';
import { withFileLock } from '../../config/file-lock';
import { writeJsonFileAtomic, SECRET_FILE_MODE } from '../../config/json-file';
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
  const out: StoredOAuthMap = {};
  for (const [serverUrl, value] of Object.entries(requireRecord(raw, 'mcp-oauth-tokens.json'))) {
    const record = decodeRecord(value, serverUrl);
    if (record) out[serverUrl] = record;
  }
  return out;
}

function readAll(): Promise<StoredOAuthMap> {
  return loadConfigFile(tokenStorePath, decode, {});
}

/**
 * The file as stored, for a write: every OTHER server's entry goes back to disk
 * exactly as it was read, still encrypted. Re-encoding from decoded records
 * would drop any record the decoder rejects, and would write back `''` for any
 * token the keychain failed to decrypt this time (`decryptSecret` answers `''`
 * rather than throwing), so one save could quietly lose other servers' tokens.
 */
function readStoredForWrite(file: string): Promise<Record<string, unknown>> {
  return loadConfigFileStrict(file, (raw) => ({ ...requireRecord(raw, 'mcp-oauth-tokens.json') }), {});
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

/**
 * Read-modify-write under the per-file lock (`config/file-lock.ts`). Several
 * servers can finish auth near-simultaneously (e.g. at app startup), and two
 * unserialized saves would each write back a map missing the other's token.
 */
function mutateStored(fn: (stored: Record<string, unknown>) => boolean): Promise<void> {
  const file = tokenStorePath();
  return withFileLock(file, async () => {
    const stored = await readStoredForWrite(file);
    if (fn(stored)) await writeJsonFileAtomic(file, stored, { mode: SECRET_FILE_MODE });
  });
}

export async function getStoredTokens(serverUrl: string): Promise<StoredOAuthRecord | null> {
  const all = await readAll();
  return all[serverUrl] ?? null;
}

export function saveStoredTokens(record: StoredOAuthRecord): Promise<void> {
  return mutateStored((stored) => {
    stored[record.serverUrl] = encodeRecord(record);
    return true;
  });
}

export function deleteStoredTokens(serverUrl: string): Promise<void> {
  return mutateStored((stored) => {
    if (!(serverUrl in stored)) return false;
    delete stored[serverUrl];
    return true;
  });
}
