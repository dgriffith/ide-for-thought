/**
 * `~/.minerva/plugins.json` (#2634): what this machine knows about each
 * installed plugin beyond its folder — whether it's enabled, and where it was
 * installed from. Per machine, like the plugins themselves.
 *
 * A plugin folder with no record (dropped in by hand, or by an agent) is
 * enabled; disabling one writes a record. Removing a plugin removes its
 * record. A record without a folder is ignored and dropped on the next write.
 *
 * Read leniently to display (a corrupt file reads as "no records", reported),
 * strictly to change (#2416): a mutation on a corrupt file is refused and the
 * file left as it is, and mutations run under the file lock so two at once
 * can't drop each other's change.
 */
import path from 'node:path';
import {
  asBool,
  asRecord,
  asString,
  asStringArray,
  loadConfigFile,
  loadConfigFileStrict,
  loadConfigFileStrictSync,
  loadConfigFileSync,
  requireRecord,
} from '../config/config-store';
import { writeJsonFileAtomic, writeJsonFileAtomicSync } from '../config/json-file';
import { withFileLock } from '../config/file-lock';
import { isPluginCapability, type PluginCapability } from '../../shared/plugins/capabilities';

/** Where a plugin came from, as recorded at install. */
export type PluginSource =
  | { kind: 'folder'; path: string }
  /** Unpacked from an archive: its file name, and its SHA-256. */
  | { kind: 'zip'; name: string; sha256: string }
  /** Fetched from a git URL, at an optional pin; the commit installed. */
  | { kind: 'git'; url: string; ref?: string; commit: string }
  /** No install record — it was put in `~/.minerva/plugins/` by hand. */
  | { kind: 'manual' }
  /** Drafted by the assistant in a conversation, and installed from its card (#2652). */
  | { kind: 'draft' }
  /** Built into Minerva (#2820): only whether it's on is recorded. */
  | { kind: 'core' };

export interface PluginRecord {
  enabled: boolean;
  source: PluginSource;
  /** ISO time of the install, when Minerva installed it. */
  installedAt?: string;
  /**
   * The MCP servers the user approved (#2646): server key → the identity
   * approved (declaration + plugin version). A server runs only while its
   * identity still matches. A reinstall writes a fresh record, so new code is
   * approved again.
   */
  mcpApproved?: Record<string, string>;
  /**
   * Its code, as the user approved it (#2833): the hash of every file it
   * shipped then, and the capabilities it declared — what a changed plugin's
   * new ones are shown against. Its code runs only while the hash still
   * matches; any edit switches the plugin off until it's approved again.
   */
  codeApproved?: { hash: string; capabilities: PluginCapability[] };
  /**
   * The version the user let ask the assistant (#2858, `llm.propose`): asked
   * natively on its first request, and again after an upgrade.
   */
  llmAllowed?: string;
}

export type PluginRecords = Record<string, PluginRecord>;

/** The records file sits beside the plugins folder: `~/.minerva/plugins.json`
 *  for `~/.minerva/plugins/` — so a test's temporary folder brings its own. */
export function pluginsStateFile(pluginsDir: string): string {
  return path.join(path.dirname(pluginsDir), 'plugins.json');
}

function decodeSource(raw: unknown): PluginSource {
  const r = asRecord(raw);
  if (r.kind === 'folder' && typeof r.path === 'string') return { kind: 'folder', path: r.path };
  if (r.kind === 'git' && typeof r.url === 'string' && typeof r.commit === 'string') {
    return { kind: 'git', url: r.url, ...(typeof r.ref === 'string' ? { ref: r.ref } : {}), commit: r.commit };
  }
  if (r.kind === 'zip' && typeof r.name === 'string' && typeof r.sha256 === 'string') return { kind: 'zip', name: r.name, sha256: r.sha256 };
  if (r.kind === 'draft') return { kind: 'draft' };
  if (r.kind === 'core') return { kind: 'core' };
  return { kind: 'manual' };
}

function decodeRecord(raw: unknown): PluginRecord {
  const r = asRecord(raw);
  const installedAt = asString(r.installedAt, '');
  const approved: Record<string, string> = {};
  for (const [key, identity] of Object.entries(asRecord(r.mcpApproved))) {
    if (typeof identity === 'string' && identity) approved[key] = identity;
  }
  const code = asRecord(r.codeApproved);
  const hash = asString(code.hash, '');
  const codeApproved = /^[0-9a-f]{64}$/.test(hash)
    ? { hash, capabilities: asStringArray(code.capabilities).filter(isPluginCapability) }
    : null;
  const llmAllowed = asString(r.llmAllowed, '');
  return {
    enabled: asBool(r.enabled, true),
    source: decodeSource(r.source),
    ...(installedAt ? { installedAt } : {}),
    ...(Object.keys(approved).length > 0 ? { mcpApproved: approved } : {}),
    ...(codeApproved ? { codeApproved } : {}),
    ...(llmAllowed ? { llmAllowed } : {}),
  };
}

function decodeLenient(raw: unknown): PluginRecords {
  const out: PluginRecords = {};
  for (const [id, rec] of Object.entries(asRecord(asRecord(raw).plugins))) out[id] = decodeRecord(rec);
  return out;
}

function decodeStrict(raw: unknown): PluginRecords {
  const top = requireRecord(raw, 'plugins.json');
  const out: PluginRecords = {};
  for (const [id, rec] of Object.entries(requireRecord(top.plugins ?? {}, 'plugins.json "plugins"'))) out[id] = decodeRecord(rec);
  return out;
}

/** The records, for display and for deciding what loads. */
export function loadPluginRecords(pluginsDir: string): Promise<PluginRecords> {
  return loadConfigFile(() => pluginsStateFile(pluginsDir), decodeLenient, {});
}

/**
 * The records, synchronously: for the one reader that runs at startup before
 * any window, deciding which core plugins to wire up (#2820). The file is a
 * few hundred bytes, and an `await` there would stand in front of the window
 * (#2223).
 */
export function loadPluginRecordsSync(pluginsDir: string): PluginRecords {
  return loadConfigFileSync(() => pluginsStateFile(pluginsDir), decodeLenient, {});
}

/** The record for `id`: its own, or the default for a folder with none. */
export function recordFor(records: PluginRecords, id: string): PluginRecord {
  return Object.hasOwn(records, id) ? records[id]! : { enabled: true, source: { kind: 'manual' } };
}

/**
 * Change the records: read strictly, apply `fn`, write atomically, all under
 * the file lock. `keep` is the set of installed ids; a record for anything
 * else is dropped.
 */
export function updatePluginRecords(
  pluginsDir: string,
  fn: (records: PluginRecords) => void,
  keep?: ReadonlySet<string>,
): Promise<PluginRecords> {
  const abs = pluginsStateFile(pluginsDir);
  return withFileLock(abs, async () => {
    const records = await loadConfigFileStrict(abs, decodeStrict, {});
    fn(records);
    if (keep) for (const id of Object.keys(records)) if (!keep.has(id)) delete records[id];
    await writeJsonFileAtomic(abs, { plugins: records }, { trailingNewline: true });
    return records;
  });
}

/**
 * {@link updatePluginRecords}, synchronously: for the one write that runs at
 * startup before any window (a built-in plugin's one-time default, #2822).
 * No lock: nothing else writes the file that early, and a sync
 * read-modify-write can't interleave with itself.
 */
export function updatePluginRecordsSync(pluginsDir: string, fn: (records: PluginRecords) => void): void {
  const abs = pluginsStateFile(pluginsDir);
  const records = loadConfigFileStrictSync(abs, decodeStrict, {});
  fn(records);
  writeJsonFileAtomicSync(abs, { plugins: records }, { trailingNewline: true });
}
