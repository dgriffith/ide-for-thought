/**
 * Plugin ingestors (#2647, design `docs/plugin-code.md` → *Ingestors*): a
 * file type a plugin reads as a Source, by a handler in its worker host
 * (#2830). Data in, data out:
 *
 * - main reads the file (`PLUGIN_INGEST_MAX_FILE_BYTES` at most) and hands
 *   the handler its name and bytes — no path, no `fs`, no network, and no
 *   notes in scope;
 * - the handler returns a `PluginSourceDraft`, which is checked here field by
 *   field (anything else, or anything over its limit, is the plugin's error);
 * - `sources/ingest-draft.ts` writes the Source, escaping the body so it is
 *   text, never HTML, with `minerva:ingestedBy` naming the plugin.
 *
 * A file already ingested never reaches the plugin again: the Source's id is
 * a hash of the file, looked up first.
 *
 * The ingestors join `sources/ingestors.ts`'s registry through
 * `setExtraIngestors`, which `installPluginIngestors` wires at startup; the
 * list is read on every ingest, so a plugin turned off is gone at once.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { invokePluginLogic } from './plugin-worker-host';
import { callPluginTool } from './plugin-mcp-tools';
import { activePluginIngestors, codePluginIdentity } from './plugins/code-plugins';
import { PluginCallError } from './plugins/broker';
import { setExtraIngestors, type Ingestor } from './sources/ingestors';
import { draftSourceSlot, writeDraftSource } from './sources/ingest-draft';
import type { IngestResult } from './sources/ingest';
import {
  PLUGIN_SOURCE_TYPES,
  type PluginIngestInput,
  type PluginIngestor,
  type PluginSourceDraft,
} from '../shared/plugins/format';

/**
 * The largest file a plugin's ingestor is handed. Its base64 has to fit in
 * one 1 MiB message to the worker (`PLUGIN_MESSAGE_LIMIT_BYTES`).
 */
export const PLUGIN_INGEST_MAX_FILE_BYTES = 640 * 1024;

/** Limits on a draft's fields, in characters. The body's is the message limit. */
export const DRAFT_LIMITS = { title: 500, creators: 50, creator: 300, publisher: 300, abstract: 5000, uri: 2000, language: 35 } as const;

const DRAFT_KEYS = new Set(['title', 'body', 'type', 'creators', 'issued', 'publisher', 'abstract', 'uri', 'language']);
const ISO_DATE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/;
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

/** What a plugin's ingestor reads (#2647, #2880): a file, a web page, or an identifier. */
export type PluginIngestSubject = { file: string } | { url: string } | { identifier: string };

/** Read `subject` as a Source with plugin `pluginId`'s `ingestor`: its handler, or its MCP tool. */
export async function ingestWithPlugin(rootPath: string, pluginId: string, ingestor: PluginIngestor, subject: PluginIngestSubject): Promise<IngestResult> {
  const identity = codePluginIdentity(pluginId);
  if (!identity) throw new PluginCallError(`"${pluginId}" is not an enabled plugin with code.`);
  let input: PluginIngestInput;
  let filename: string | undefined;
  if ('file' in subject) {
    filename = path.basename(subject.file);
    const { size } = await fs.stat(subject.file);
    if (size > PLUGIN_INGEST_MAX_FILE_BYTES) {
      throw new PluginCallError(`${identity.name} reads files up to ${PLUGIN_INGEST_MAX_FILE_BYTES / 1024} KB; ${filename} is ${Math.ceil(size / 1024)} KB.`);
    }
    input = { ingestor: ingestor.id, filename, base64: (await fs.readFile(subject.file)).toString('base64') };
  } else {
    input = 'url' in subject ? { ingestor: ingestor.id, url: subject.url } : { ingestor: ingestor.id, identifier: subject.identifier };
  }

  // The same file, page or identifier read by the same ingestor is the same Source.
  const seed = 'base64' in input ? input.base64 : 'url' in input ? input.url : input.identifier.toLowerCase();
  const slot = await draftSourceSlot(rootPath, `${pluginId}:${ingestor.id}:${seed}`);
  if (slot.existingTitle !== null) {
    return { sourceId: slot.sourceId, relativePath: slot.relativePath, duplicate: true, title: slot.existingTitle, kind: 'url' in subject ? 'web' : 'text' };
  }

  const answer = 'handler' in ingestor.parse
    ? await invokePluginLogic(pluginId, ingestor.parse.handler, input, { rootPath, scope: [] })
    : await callPluginTool(identity.name, pluginId, ingestor.parse.mcpTool, input);
  const checked = checkedDraft(identity.name, ingestor.label, answer);
  // A page's Source says where it came from, unless the plugin knew better.
  const draft = 'url' in subject && !checked.uri ? { ...checked, uri: subject.url } : checked;
  const written = await writeDraftSource(rootPath, slot, draft, { ...(filename ? { filename } : {}), ingestedBy: `plugin:${identity.id}@${identity.version}` });
  return 'url' in subject ? { ...written, kind: 'web' } : written;
}

/** A handler's answer as a Source draft; anything else is the plugin's error. */
export function checkedDraft(name: string, label: string, answer: unknown): PluginSourceDraft {
  const bad = (why: string) => new PluginCallError(`${name}'s ${label} ingestor returned something that isn't a source: ${why}.`);
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw bad('not an object');
  const a = answer as Record<string, unknown>;
  const unknown = Object.keys(a).filter((k) => !DRAFT_KEYS.has(k));
  if (unknown.length > 0) throw bad(`unknown field ${JSON.stringify(unknown[0])}`);

  const text = (key: keyof typeof DRAFT_LIMITS, required = false): string | undefined => {
    const v = a[key];
    if (v === undefined && !required) return undefined;
    if (typeof v !== 'string' || (required && v.trim() === '')) throw bad(`"${key}" must be ${required ? 'a non-empty string' : 'a string'}`);
    if (v.length > DRAFT_LIMITS[key]) throw bad(`"${key}" is over ${DRAFT_LIMITS[key]} characters`);
    return v.trim() === '' ? undefined : v.trim();
  };
  const title = text('title', true)!;
  if (typeof a.body !== 'string') throw bad('"body" must be a string');
  const type = a.type;
  if (type !== undefined && !(PLUGIN_SOURCE_TYPES as readonly unknown[]).includes(type)) {
    throw bad(`"type" must be one of ${PLUGIN_SOURCE_TYPES.join(', ')}`);
  }
  const creators = a.creators;
  if (creators !== undefined) {
    if (!Array.isArray(creators) || creators.length > DRAFT_LIMITS.creators
      || !creators.every((c) => typeof c === 'string' && c.trim() !== '' && c.length <= DRAFT_LIMITS.creator)) {
      throw bad(`"creators" must be a list of at most ${DRAFT_LIMITS.creators} names`);
    }
  }
  const issued = a.issued;
  if (issued !== undefined && (typeof issued !== 'string' || !ISO_DATE.test(issued))) throw bad('"issued" must be an ISO date like 2024-05-17');
  const uri = text('uri');
  if (uri !== undefined && !/^https?:\/\/[^\s]+$/i.test(uri)) throw bad('"uri" must be an http(s) URL');
  const language = text('language');
  if (language !== undefined && !LANGUAGE_TAG.test(language)) throw bad('"language" must be a language tag like "en"');
  const publisher = text('publisher');
  const abstract = text('abstract');

  return {
    title,
    body: a.body,
    ...(type !== undefined ? { type: type as NonNullable<PluginSourceDraft['type']> } : {}),
    ...(creators !== undefined && creators.length > 0 ? { creators: (creators as string[]).map((c) => c.trim()) } : {}),
    ...(issued !== undefined ? { issued } : {}),
    ...(publisher !== undefined ? { publisher } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    ...(uri !== undefined ? { uri } : {}),
    ...(language !== undefined ? { language } : {}),
  };
}

/** The enabled plugins' ingestors, as the registry runs them. */
export function pluginIngestors(): Ingestor[] {
  return activePluginIngestors().map(({ pluginId, ingestor }): Ingestor => {
    const id = `plugin:${pluginId}/${ingestor.id}`;
    const { accepts } = ingestor;
    if ('extensions' in accepts) {
      return { id, label: ingestor.label, accepts: { extensions: accepts.extensions },
        ingest: async (rootPath, file) => ({ ...(await ingestWithPlugin(rootPath, pluginId, ingestor, { file })), route: 'file' as const }) };
    }
    if ('urlMatch' in accepts) {
      return { id, label: ingestor.label, accepts: { urlHosts: accepts.urlMatch },
        ingest: async (rootPath, url) => ({ ...(await ingestWithPlugin(rootPath, pluginId, ingestor, { url })), route: 'url' as const }) };
    }
    return { id, label: ingestor.label, accepts: { identifierPrefixes: accepts.identifierPrefixes },
      ingest: async (rootPath, identifier) => ({ ...(await ingestWithPlugin(rootPath, pluginId, ingestor, { identifier })), route: 'url' as const }) };
  });
}

/** Put the enabled plugins' ingestors in the registry. At startup. */
export function installPluginIngestors(): void {
  setExtraIngestors(pluginIngestors);
}
