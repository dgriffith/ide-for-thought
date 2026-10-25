/**
 * A plugin's `code.ingestors` (#2647) and `code.exporters` (#2648) in
 * `plugin.json`: what its worker host's handlers read and write. Pure, and
 * fail closed like the rest of the manifest (`manifest.ts`): every problem
 * reported at once.
 */
import {
  PLUGIN_EXPORT_SCOPES,
  PLUGIN_HANDLER_NAME,
  type PluginExporter,
  type PluginExportScope,
  type PluginIngestor,
} from '../../shared/plugins/format';
import { isBuiltinSourceFileExtension } from '../../shared/source-file-types';

/** What the rest of the `code` section says, as these need it. */
export interface CodeHas {
  /** It declares `code.worker`, where a handler lives. */
  worker: boolean;
  /** Whether `id` is a plugin-style id (`manifest.ts`'s `PLUGIN_ID`). */
  isId: (id: string) => boolean;
}

const INGESTOR_KEYS = new Set(['id', 'label', 'accepts', 'parse']);
/** Most ingestors one plugin may add, and extensions one may take (#2647). */
export const MAX_PLUGIN_INGESTORS = 8;
const MAX_INGESTOR_EXTENSIONS = 8;
/** A file extension as an ingestor names it: lowercase, with the dot. */
const FILE_EXTENSION = /^\.[a-z0-9]{1,10}$/;
const EXPORTER_KEYS = new Set(['id', 'label', 'input', 'scopes', 'write']);
/** Most export formats one plugin may add (#2648). */
export const MAX_PLUGIN_EXPORTERS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `code.ingestors` (#2647): file types read as Sources by one of the plugin's
 * handlers, so each needs `code.worker`. Only `extensions` for now: a URL or
 * an identifier means the network, which is an MCP server's (#2880). A type
 * Minerva reads itself can't be taken over.
 */
export function validateIngestors(raw: unknown, has: CodeHas, problems: string[]): PluginIngestor[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.ingestors" must be a non-empty list of ingestors.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_INGESTORS) problems.push(`"code.ingestors" lists ${raw.length} ingestors; at most ${MAX_PLUGIN_INGESTORS}.`);
  const out: PluginIngestor[] = [];
  raw.forEach((g: unknown, i) => {
    const at = `code.ingestors[${i}]`;
    if (!isRecord(g)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(g)) {
      if (!INGESTOR_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = g.id;
    if (typeof id !== 'string' || !has.isId(id)) {
      problems.push(`"${at}.id" must be lowercase letters and digits in dash-separated words, like "transcript".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.ingestors" has two ingestors with the id "${id}".`);
    }
    const label = g.label;
    if (typeof label !== 'string' || label.trim() === '' || label.length > 40) {
      problems.push(`"${at}.label" must be a name of at most 40 characters, like "Transcript".`);
    }
    const extensions = ingestorExtensions(g.accepts, `${at}.accepts`, out, problems);
    const handler = isRecord(g.parse) && Object.keys(g.parse).length === 1 ? g.parse.handler : undefined;
    if (typeof handler !== 'string' || !PLUGIN_HANDLER_NAME.test(handler)) {
      problems.push(`"${at}.parse" must be { "handler": name }, the name a handler registers with minerva.handle().`);
    } else if (!has.worker) {
      problems.push(`"${at}.parse.handler" needs "code.worker": a handler is a function in the plugin's logic module.`);
    }
    if (problems.length > before || !extensions) return;
    out.push({ id: id as string, label: (label as string).trim(), accepts: { extensions }, parse: { handler: handler as string } });
  });
  return out;
}

function ingestorExtensions(raw: unknown, at: string, earlier: readonly PluginIngestor[], problems: string[]): string[] | undefined {
  const keys = isRecord(raw) ? Object.keys(raw) : [];
  if (!isRecord(raw) || keys.length !== 1 || keys[0] !== 'extensions') {
    const network = keys.some((k) => k === 'urlMatch' || k === 'identifierPattern');
    problems.push(network
      ? `"${at}" can only name "extensions" for now: reading a URL or an identifier needs the network, so it's an MCP server's job.`
      : `"${at}" must be { "extensions": [".ext", …] }.`);
    return undefined;
  }
  const list = raw.extensions;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_INGESTOR_EXTENSIONS) {
    problems.push(`"${at}.extensions" must list 1 to ${MAX_INGESTOR_EXTENSIONS} file extensions, like ".srt".`);
    return undefined;
  }
  const out: string[] = [];
  for (const ext of list) {
    if (typeof ext !== 'string' || !FILE_EXTENSION.test(ext)) {
      problems.push(`"${at}.extensions" names ${JSON.stringify(ext)}; an extension is lowercase, with the dot, like ".srt".`);
    } else if (isBuiltinSourceFileExtension(ext)) {
      problems.push(`"${at}.extensions" names "${ext}", which Minerva reads itself.`);
    } else if (out.includes(ext) || earlier.some((g) => g.accepts.extensions.includes(ext))) {
      problems.push(`"code.ingestors" names "${ext}" twice.`);
    } else {
      out.push(ext);
    }
  }
  return out.length === list.length ? out : undefined;
}

/**
 * `code.exporters` (#2648): export formats written by one of the plugin's
 * handlers, so each needs `code.worker`. A writer returns files; Minerva
 * writes them, so the plugin never touches the disk.
 */
export function validateExporters(raw: unknown, has: CodeHas, problems: string[]): PluginExporter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.exporters" must be a non-empty list of exporters.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_EXPORTERS) problems.push(`"code.exporters" lists ${raw.length} exporters; at most ${MAX_PLUGIN_EXPORTERS}.`);
  const out: PluginExporter[] = [];
  raw.forEach((x: unknown, i) => {
    const at = `code.exporters[${i}]`;
    if (!isRecord(x)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(x)) {
      if (!EXPORTER_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = x.id;
    if (typeof id !== 'string' || !has.isId(id)) {
      problems.push(`"${at}.id" must be lowercase letters and digits in dash-separated words, like "epub".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.exporters" has two exporters with the id "${id}".`);
    }
    const label = x.label;
    if (typeof label !== 'string' || label.trim() === '' || label.length > 40) {
      problems.push(`"${at}.label" must be the format's name, at most 40 characters, like "EPUB".`);
    }
    const input = x.input;
    if (input !== 'html' && input !== 'markdown') problems.push(`"${at}.input" must be "html" or "markdown"; got ${JSON.stringify(input)}.`);
    const scopes = x.scopes;
    const known = PLUGIN_EXPORT_SCOPES as readonly unknown[];
    if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((sc) => known.includes(sc)) || new Set(scopes).size !== scopes.length) {
      problems.push(`"${at}.scopes" must list what it exports, from ${PLUGIN_EXPORT_SCOPES.join(', ')}.`);
    }
    const handler = isRecord(x.write) && Object.keys(x.write).length === 1 ? x.write.handler : undefined;
    if (typeof handler !== 'string' || !PLUGIN_HANDLER_NAME.test(handler)) {
      problems.push(`"${at}.write" must be { "handler": name }, the name a handler registers with minerva.handle().`);
    } else if (!has.worker) {
      problems.push(`"${at}.write.handler" needs "code.worker": a handler is a function in the plugin's logic module.`);
    }
    if (problems.length > before) return;
    out.push({
      id: id as string, label: (label as string).trim(), input: input as PluginExporter['input'],
      scopes: PLUGIN_EXPORT_SCOPES.filter((sc): sc is PluginExportScope => (scopes as unknown[]).includes(sc)),
      write: { handler: handler as string },
    });
  });
  return out;
}
