/**
 * Shared read/patch leaf for `.minerva/config.json` (#1891).
 *
 * Both the graph module (`baseUri`) and `project-config.ts` (display name,
 * bibliography, onboarding, excerpt folder, publish targets) persist into the
 * same file. Before this module existed, `graph/index.ts` had its own
 * reader/writer pair and `writeConfig` replaced the WHOLE file with just
 * `{baseUri}`, destroying every other field the moment `resolveBaseUri` ran
 * on a project that already had e.g. a `displayName` or `publishTargets` set.
 * Electron-free, like the rest of `./graph`, so it stays usable outside the
 * Electron main process.
 */
import fs from 'node:fs';
import path from 'node:path';

function configPath(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'config.json');
}

/**
 * Read `.minerva/config.json` as a raw record. A missing file reads as `{}`
 * — a project simply hasn't written config yet, not an error. A corrupt or
 * otherwise unreadable file THROWS instead of silently returning `{}`: a
 * caller that went on to merge-and-write over that `{}` is exactly how
 * #1891 turned "config is corrupt" into "config is gone."
 */
export function readRawProjectConfig(rootPath: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = fs.readFileSync(configPath(rootPath), 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

/**
 * Shallow-merge `patch` into the on-disk config and write the result back.
 * Reads via `readRawProjectConfig`, so a corrupt file throws here too — the
 * patch is never applied on top of a file that couldn't actually be parsed.
 */
export function patchRawProjectConfig(rootPath: string, patch: Record<string, unknown>): void {
  const existing = readRawProjectConfig(rootPath);
  const next = { ...existing, ...patch };
  fs.mkdirSync(path.dirname(configPath(rootPath)), { recursive: true });
  fs.writeFileSync(configPath(rootPath), JSON.stringify(next, null, 2), 'utf-8');
}
