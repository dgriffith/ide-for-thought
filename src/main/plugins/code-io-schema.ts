/**
 * A plugin's `code.ingestors` (#2647), `code.exporters` (#2648) and
 * `code.inspections` (#2831) in `plugin.json`: what its worker host's
 * handlers read, write and check. Pure, and
 * fail closed like the rest of the manifest (`manifest.ts`): every problem
 * reported at once.
 */
import {
  PLUGIN_EXPORT_SCOPES,
  PLUGIN_HANDLER_NAME,
  type PluginExporter,
  type PluginExportScope,
  type PluginIngestor,
  type PluginIngestorAccepts,
  type PluginInspection,
  PLUGIN_MCP_TOOL,
  ingestorClaims,
} from '../../shared/plugins/format';
import type { PluginCapability } from '../../shared/plugins/capabilities';
import { PLUGIN_INSPECTION_TYPE } from '../../shared/inspections';
import { isBuiltinSourceFileExtension } from '../../shared/source-file-types';

/** What the rest of the `code` section says, as these need it. */
export interface CodeHas {
  /** It declares `code.worker`, where a handler lives. */
  worker: boolean;
  /** Whether `id` is a plugin-style id (`manifest.ts`'s `PLUGIN_ID`). */
  isId: (id: string) => boolean;
  /** Its `mcpServers`' keys, which an `mcpTool` names (#2880). */
  servers: readonly string[];
  /** What the code declares it does. */
  capabilities: readonly PluginCapability[];
  /** `v` as an `.rq` in the plugin's folder, or a problem pushed (`manifest.ts`'s `pluginFilePath`). */
  queryPath: (v: unknown, field: string, problems: string[]) => string | undefined;
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

const INSPECTION_KEYS = new Set(['id', 'label', 'description', 'severity', 'query', 'run']);
/** Most code inspections one plugin may run (#2831). */
export const MAX_PLUGIN_INSPECTIONS = 16;
const SEVERITIES = ['info', 'warning', 'concern'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `code.ingestors` (#2647, #2880): what a plugin reads as a Source — file
 * types, a site's pages (`urlMatch`), or identifiers typed with a prefix —
 * by a handler in its worker or a tool on one of its own MCP servers. A URL
 * or an identifier means the network, so only a tool reads one. A type or
 * prefix Minerva reads itself can't be taken over.
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
    const accepts = ingestorAccepts(g.accepts, `${at}.accepts`, out, problems);
    const parse = handlerOrTool(g.parse, `${at}.parse`, has, problems);
    if (accepts && parse && !('extensions' in accepts) && !('mcpTool' in parse)) {
      problems.push(`"${at}.parse" must be an "mcpTool" for ${'urlMatch' in accepts ? 'a URL' : 'an identifier'}: reading one needs the network, which only an MCP server has.`);
    }
    if (problems.length > before || !accepts || !parse) return;
    out.push({ id: id as string, label: (label as string).trim(), accepts, parse });
  });
  return out;
}

/**
 * What runs a contribution (#2647, #2880): `{ handler }`, a function in the
 * plugin's worker (it needs `code.worker`), or `{ mcpTool: "<key>/<tool>" }`,
 * a tool on one of its own MCP servers.
 */
function handlerOrTool(raw: unknown, at: string, has: CodeHas, problems: string[]): { handler: string } | { mcpTool: string } | undefined {
  const keys = isRecord(raw) ? Object.keys(raw) : [];
  if (!isRecord(raw) || keys.length !== 1 || (keys[0] !== 'handler' && keys[0] !== 'mcpTool')) {
    problems.push(`"${at}" must be { "handler": name } (a function in its logic) or { "mcpTool": "<server>/<tool>" } (a tool on one of its MCP servers).`);
    return undefined;
  }
  if ('handler' in raw) {
    const handler = raw.handler;
    if (typeof handler !== 'string' || !PLUGIN_HANDLER_NAME.test(handler)) {
      problems.push(`"${at}.handler" must be the name a handler registers with minerva.handle().`);
      return undefined;
    }
    if (!has.worker) {
      problems.push(`"${at}.handler" needs "code.worker": a handler is a function in the plugin's logic module.`);
      return undefined;
    }
    return { handler };
  }
  const tool = raw.mcpTool;
  const m = typeof tool === 'string' ? PLUGIN_MCP_TOOL.exec(tool) : null;
  if (!m) {
    problems.push(`"${at}.mcpTool" must be "<server>/<tool>", a tool on one of its "mcpServers".`);
    return undefined;
  }
  if (!has.servers.includes(m[1]!)) {
    problems.push(`"${at}.mcpTool" names the server "${m[1]}", which isn't one of its "mcpServers"${has.servers.length ? ` (${has.servers.join(', ')})` : ''}.`);
    return undefined;
  }
  return { mcpTool: tool as string };
}

/** Host patterns: `example.com`, or `*.example.com` for it and every subdomain. */
const HOST_PATTERN = /^(\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** An identifier's prefix, typed before it: `goodreads:`. */
const IDENTIFIER_PREFIX = /^[a-z][a-z0-9-]{0,30}:$/;
/** Prefixes Minerva reads, or that would read as a URL: no plugin's. */
const RESERVED_PREFIXES = new Set(['doi:', 'arxiv:', 'pmid:', 'pubmed:', 'http:', 'https:', 'file:', 'mailto:']);

function ingestorAccepts(raw: unknown, at: string, earlier: readonly PluginIngestor[], problems: string[]): PluginIngestorAccepts | undefined {
  const keys = isRecord(raw) ? Object.keys(raw) : [];
  const kind = keys[0];
  if (!isRecord(raw) || keys.length !== 1 || (kind !== 'extensions' && kind !== 'urlMatch' && kind !== 'identifierPrefixes')) {
    problems.push(`"${at}" must be exactly one of { "extensions": [".ext", …] }, { "urlMatch": ["example.com", …] } or { "identifierPrefixes": ["name:", …] }.`);
    return undefined;
  }
  const list = raw[kind];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_INGESTOR_EXTENSIONS) {
    problems.push(`"${at}.${kind}" must list 1 to ${MAX_INGESTOR_EXTENSIONS} of them.`);
    return undefined;
  }
  const taken = new Set(earlier.flatMap((g) => ingestorClaims(g.accepts).values));
  const out: string[] = [];
  for (const v of list) {
    const problem = typeof v !== 'string' ? 'isn\'t text'
      : kind === 'extensions' ? (!FILE_EXTENSION.test(v) ? 'isn\'t an extension: lowercase, with the dot, like ".srt"' : isBuiltinSourceFileExtension(v) ? 'is one Minerva reads itself' : null)
        : kind === 'urlMatch' ? (!HOST_PATTERN.test(v) ? 'isn\'t a host, like "example.com" or "*.example.com"' : null)
          : (!IDENTIFIER_PREFIX.test(v) ? 'isn\'t a prefix: lowercase, ending in ":", like "goodreads:"' : RESERVED_PREFIXES.has(v) ? 'is one Minerva reads itself' : null);
    if (problem) problems.push(`"${at}.${kind}" names ${JSON.stringify(v)}, which ${problem}.`);
    else if (out.includes(v as string) || taken.has(v as string)) problems.push(`"code.ingestors" names "${v}" twice.`);
    else out.push(v as string);
  }
  if (out.length !== list.length) return undefined;
  return kind === 'extensions' ? { extensions: out } : kind === 'urlMatch' ? { urlMatch: out } : { identifierPrefixes: out };
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
    const write = handlerOrTool(x.write, `${at}.write`, has, problems);
    if (problems.length > before) return;
    out.push({
      id: id as string, label: (label as string).trim(), input: input as PluginExporter['input'],
      scopes: PLUGIN_EXPORT_SCOPES.filter((sc): sc is PluginExportScope => (scopes as unknown[]).includes(sc)),
      write: write!,
    });
  });
  return out;
}

/**
 * `code.inspections` (#2831): health checks run by one of the plugin's
 * handlers, so each needs `code.worker`; one with a query needs
 * `graph:query`, for what the query reads. The id becomes the type's last
 * part (`plugin:<id>/<check>`), so it is spelled as a shape's name is.
 */
export function validateInspections(raw: unknown, has: CodeHas, problems: string[]): PluginInspection[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"code.inspections" must be a non-empty list of inspections.');
    return undefined;
  }
  if (raw.length > MAX_PLUGIN_INSPECTIONS) problems.push(`"code.inspections" lists ${raw.length} inspections; at most ${MAX_PLUGIN_INSPECTIONS}.`);
  const out: PluginInspection[] = [];
  raw.forEach((x: unknown, i) => {
    const at = `code.inspections[${i}]`;
    if (!isRecord(x)) {
      problems.push(`"${at}" must be an object.`);
      return;
    }
    for (const key of Object.keys(x)) {
      if (!INSPECTION_KEYS.has(key)) problems.push(`Unknown field "${at}.${key}".`);
    }
    const before = problems.length;
    const id = x.id;
    if (typeof id !== 'string' || !PLUGIN_INSPECTION_TYPE.test(`plugin:a/${id}`)) {
      problems.push(`"${at}.id" must be a letter, then letters, digits, "_" or "-" (at most 64), like "skipped-heading".`);
    } else if (out.some((o) => o.id === id)) {
      problems.push(`"code.inspections" has two inspections with the id "${id}".`);
    }
    const label = x.label;
    if (typeof label !== 'string' || label.trim() === '' || label.length > 80) {
      problems.push(`"${at}.label" must be a name of at most 80 characters.`);
    }
    const description = x.description;
    if (typeof description !== 'string' || description.trim() === '' || description.length > 300) {
      problems.push(`"${at}.description" must be one line of at most 300 characters: what it looks for and why.`);
    }
    const severity = x.severity;
    if (!(SEVERITIES as readonly unknown[]).includes(severity)) problems.push(`"${at}.severity" must be one of ${SEVERITIES.join(', ')}; got ${JSON.stringify(severity)}.`);
    const query = x.query === undefined ? undefined : has.queryPath(x.query, `${at}.query`, problems);
    if (x.query !== undefined && !has.capabilities.includes('graph:query')) {
      problems.push(`"${at}.query" needs the "graph:query" capability, for what its query reads.`);
    }
    const handler = isRecord(x.run) && Object.keys(x.run).length === 1 ? x.run.handler : undefined;
    if (typeof handler !== 'string' || !PLUGIN_HANDLER_NAME.test(handler)) {
      problems.push(`"${at}.run" must be { "handler": name }, the name a handler registers with minerva.handle().`);
    } else if (!has.worker) {
      problems.push(`"${at}.run.handler" needs "code.worker": a handler is a function in the plugin's logic module.`);
    }
    if (problems.length > before) return;
    out.push({
      id: id as string, label: (label as string).trim(), description: (description as string).trim(),
      severity: severity as PluginInspection['severity'],
      ...(query !== undefined ? { query } : {}),
      run: { handler: handler as string },
    });
  });
  return out;
}
