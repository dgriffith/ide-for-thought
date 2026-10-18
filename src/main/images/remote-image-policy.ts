/**
 * Which remote images a thoughtbase may load (#1332), per thoughtbase and per
 * machine, in `userData/remote-images.json`:
 *
 *   { "thoughtbases": { "<root>": { "mode": "ask", "hosts": ["images.example"] } } }
 *
 * A thoughtbase with no entry is `ask`: a remote image loads only from a host
 * the user allowed, from a placeholder. One created in the app, into an empty
 * folder, starts as `allow`; everything else (opened, cloned, imported, or
 * created over a folder that already had notes) asks, because its notes may
 * be someone else's.
 *
 * Main enforces it: `IMAGES_CACHE_EXTERNAL` fetches only when this says so,
 * and serves an already-cached image either way (that makes no request). The
 * renderer never puts a remote URL in an `<img>`.
 */
import {
  asRecord,
  asStringArray,
  loadConfigFileStrictSync,
  loadConfigFileSync,
  requireRecord,
} from '../config/config-store';
import { writeJsonFileAtomicSync } from '../config/json-file';
import { remoteImageHost, type RemoteImageMode, type RemoteImagePolicy } from '../../shared/remote-images';

interface PolicyFile {
  thoughtbases: Record<string, RemoteImagePolicy>;
}

let configuredPath: string | null = null;

/** Called once at startup with `userData/remote-images.json`. */
export function configureRemoteImagePolicyPath(absPath: string): void {
  configuredPath = absPath;
}

/** Test-only: point the store at a temp file, or back to unconfigured. */
export function _setRemoteImagePolicyPathForTests(p: string | null): void {
  configuredPath = p;
}

function policyPath(): string {
  if (!configuredPath) throw new Error('The remote-image policy store is not configured in this process.');
  return configuredPath;
}

function decode(raw: unknown): PolicyFile {
  const tbs = asRecord(requireRecord(raw, 'remote-images.json').thoughtbases);
  const thoughtbases: Record<string, RemoteImagePolicy> = {};
  for (const [root, value] of Object.entries(tbs)) {
    const o = asRecord(value);
    thoughtbases[root] = {
      mode: o.mode === 'allow' ? 'allow' : 'ask',
      hosts: asStringArray(o.hosts).map((h) => h.toLowerCase()),
    };
  }
  return { thoughtbases };
}

const ASK: RemoteImagePolicy = { mode: 'ask', hosts: [] };

function readForWrite(): PolicyFile {
  return loadConfigFileStrictSync(policyPath(), decode, { thoughtbases: {} });
}

function update(rootPath: string, change: (p: RemoteImagePolicy) => RemoteImagePolicy): RemoteImagePolicy {
  const data = readForWrite();
  const next = change(data.thoughtbases[rootPath] ?? { ...ASK, hosts: [] });
  data.thoughtbases[rootPath] = { mode: next.mode, hosts: [...new Set(next.hosts)].sort() };
  writeJsonFileAtomicSync(policyPath(), data, { trailingNewline: true });
  return data.thoughtbases[rootPath];
}

/** This thoughtbase's policy; `ask` with no hosts when it has none. */
export function remoteImagePolicy(rootPath: string): RemoteImagePolicy {
  const file = loadConfigFileSync(policyPath, decode, { thoughtbases: {} });
  return file.thoughtbases[rootPath] ?? ASK;
}

/** Whether loading `url` here may make a request. Only https is ever fetched. */
export function mayFetchRemoteImage(rootPath: string, url: string): boolean {
  const host = remoteImageHost(url);
  if (!host) return false;
  const policy = remoteImagePolicy(rootPath);
  return policy.mode === 'allow' || policy.hosts.includes(host);
}

/** Allow one host's images in this thoughtbase. */
export function allowRemoteImageHost(rootPath: string, host: string): RemoteImagePolicy {
  const h = host.trim().toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(h) || h.length > 253) throw new Error(`"${host}" isn't a host name.`);
  return update(rootPath, (p) => ({ ...p, hosts: [...p.hosts, h] }));
}

/** Load every remote image here, or go back to asking (the allowed hosts are kept). */
export function setRemoteImageMode(rootPath: string, mode: RemoteImageMode): RemoteImagePolicy {
  return update(rootPath, (p) => ({ ...p, mode }));
}

/** Forget every host allowed here, and ask again. */
export function resetRemoteImagePolicy(rootPath: string): RemoteImagePolicy {
  return update(rootPath, () => ({ mode: 'ask', hosts: [] }));
}
