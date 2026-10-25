/**
 * What a plugin's logic is handed and returns when it reads a file as a
 * Source (#2647), writes an export (#2648) or runs an inspection (#2831) —
 * the `code` section's input/output types, beside `format.ts` (which
 * re-exports them) so the manifest format stays readable.
 */
import type { PluginQueryResults } from './api';

/**
 * An ingestor a plugin adds (#2647): a file type the Ingest File dialog
 * offers, read by a handler in the plugin's worker host (#2830).
 *
 * ```json
 * "ingestors": [{ "id": "transcript", "label": "Transcript",
 *                 "accepts": { "extensions": [".srt", ".vtt"] },
 *                 "parse": { "handler": "parseTranscript" } }]
 * ```
 *
 * The handler is handed `PluginIngestInput` and returns a
 * `PluginSourceDraft`; Minerva checks the draft and writes the Source. An
 * extension Minerva reads itself (`shared/source-file-types.ts`) can't be
 * taken.
 *
 * Or the parser is a tool on one of the plugin's own MCP servers (#2880),
 * `{ "mcpTool": "<server key>/<tool>" }`, handed the same input as JSON and
 * answering a draft. Reading a web page or an identifier needs the network, so
 * `urlMatch` and `identifierPrefixes` are for an `mcpTool` parser only.
 */
export interface PluginIngestor {
  /** Lowercase letters and digits in dash-separated words, unique in the plugin. */
  id: string;
  /** What it reads, for the file dialog and messages ("Transcript"). */
  label: string;
  accepts: PluginIngestorAccepts;
  parse: { handler: string } | { mcpTool: string };
}

/** `"<server key>/<tool>"`: a tool on one of the plugin's own MCP servers (#2880). */
export const PLUGIN_MCP_TOOL = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,127})$/;

/** What an ingestor takes (#2647, #2880): exactly one of these. */
export type PluginIngestorAccepts =
  /** Files with one of these extensions (lowercase, with the dot). */
  | { extensions: string[] }
  /**
   * Web pages on these hosts: `example.com`, or `*.example.com` for it and
   * every subdomain. A matching URL goes to it before Minerva's own web-page
   * ingestor, though after an identifier (a DOI URL is still a DOI).
   */
  | { urlMatch: string[] }
  /**
   * Identifiers typed with one of these prefixes (`goodreads:`), in any
   * case: prefixes rather than patterns, since a plugin's pattern would run
   * in Minerva on what the user typed.
   */
  | { identifierPrefixes: string[] };

/** What an ingestor claims: its extensions, hosts or prefixes, and which. */
export function ingestorClaims(a: PluginIngestorAccepts): { kind: 'extensions' | 'urlMatch' | 'identifierPrefixes'; values: string[] } {
  if ('extensions' in a) return { kind: 'extensions', values: a.extensions };
  if ('urlMatch' in a) return { kind: 'urlMatch', values: a.urlMatch };
  return { kind: 'identifierPrefixes', values: a.identifierPrefixes };
}

/** The same kind of claim as `a`, with `values`. */
export function withClaims(a: PluginIngestorAccepts, values: string[]): PluginIngestorAccepts {
  if ('extensions' in a) return { extensions: values };
  if ('urlMatch' in a) return { urlMatch: values };
  return { identifierPrefixes: values };
}

/** What an ingestor's handler or tool is handed (#2647, #2880): the file, the URL or the identifier, as data. */
export type PluginIngestInput =
  | {
    ingestor: string;
    /** The file's name, without its folder. */
    filename: string;
    /** The file's bytes, base64. */
    base64: string;
  }
  | { ingestor: string; url: string }
  | { ingestor: string; identifier: string };

/** What a plugin exporter can be run on (#2648): the export dialog's scopes, less a source. */
export const PLUGIN_EXPORT_SCOPES = ['single-note', 'folder', 'project', 'tree'] as const;
export type PluginExportScope = (typeof PLUGIN_EXPORT_SCOPES)[number];

/**
 * An export format a plugin adds (#2648): its own item in the Export menu,
 * written by a handler in the plugin's worker host (#2830).
 *
 * ```json
 * "exporters": [{ "id": "epub", "label": "EPUB", "input": "html",
 *                 "scopes": ["single-note", "folder", "project", "tree"],
 *                 "write": { "handler": "writeEpub" } }]
 * ```
 *
 * The handler is handed a `PluginExportPlan` and returns a
 * `PluginExportResult`; Minerva checks the files and writes them into the
 * folder the user chose.
 */
export interface PluginExporter {
  /** Lowercase letters and digits in dash-separated words, unique in the plugin. */
  id: string;
  /** The format's name: the menu item, and "Export as <label>". */
  label: string;
  /** What each note is handed as: Minerva's rendered HTML, or its Markdown as written. */
  input: 'html' | 'markdown';
  /** What it can be run on, in the dialog's order. */
  scopes: PluginExportScope[];
  /** A handler in its worker, or a tool on one of its MCP servers (#2880), handed the same plan. */
  write: { handler: string } | { mcpTool: string };
}

/** One note, as an exporter's handler is handed it (#2648). */
export interface PluginExportNote {
  path: string;
  title: string;
  frontmatter: Record<string, unknown>;
  /** The note's body as Minerva renders it for export, citations and all — with `input: "html"`. */
  html?: string;
  /** The note's body as written, without its frontmatter — with `input: "markdown"`. */
  markdown?: string;
}

/** What an exporter's handler is handed (#2648): the notes to export, after Minerva's exclusion rules. */
export interface PluginExportPlan {
  exporter: string;
  scope: PluginExportScope;
  /** A name for the whole export: the note's or root note's title, the folder's or thoughtbase's name. */
  title: string;
  notes: PluginExportNote[];
}

/**
 * What an exporter's handler returns (#2648): files, by a path inside the
 * output folder, each `text` or `base64`. Minerva writes them; `summary` is
 * said when it has.
 */
export interface PluginExportResult {
  files: { path: string; text?: string; base64?: string }[];
  summary?: string;
}

/**
 * A health check a plugin runs as code (#2831): one a SHACL shape can't say.
 * It sits in Settings → Inspections beside the built-in and SHACL checks, its
 * type `plugin:<plugin id>/<check id>`, and runs with every sweep.
 *
 * ```json
 * "inspections": [{ "id": "skipped-heading", "label": "Skipped heading levels",
 *                   "description": "Headings that jump a level, like an H1 straight to an H3.",
 *                   "severity": "info", "query": "notes.rq",
 *                   "run": { "handler": "skippedHeadings" } }]
 * ```
 *
 * Minerva runs its `query` (an `.rq` in its folder) and hands the handler the
 * results as `PluginInspectionInput`; the notes they name are what it may
 * read. The call has the read capabilities only — an inspection never writes,
 * whatever else the plugin does. It returns `PluginInspectionResult`.
 */
export interface PluginInspection {
  /** Its type's last part: a letter, then letters, digits, `_` or `-`. */
  id: string;
  label: string;
  /** One line, in the user's terms: what it looks for and why. */
  description: string;
  severity: 'info' | 'warning' | 'concern';
  query?: string;
  run: { handler: string };
}

/** What an inspection's handler is handed (#2831). */
export interface PluginInspectionInput {
  check: string;
  /** Its declared query, as Minerva ran it; null when it declares none. */
  query: PluginQueryResults | null;
}

/**
 * One finding from a plugin's inspection (#2831): about a `note` (its path)
 * or a graph `node` (its IRI), at least one.
 */
export interface PluginInspectionFinding {
  message: string;
  note?: string;
  node?: string;
  /** What the panel calls it; the note's name or the IRI's last part when absent. */
  label?: string;
  suggestedAction?: string;
}

/** What an inspection's handler returns (#2831). */
export interface PluginInspectionResult {
  findings: PluginInspectionFinding[];
}

/** The Source classes a draft may name (`ontology-thought.ttl`). */
export const PLUGIN_SOURCE_TYPES = ['Document', 'Article', 'Book', 'Report', 'WebPage'] as const;
export type PluginSourceType = (typeof PLUGIN_SOURCE_TYPES)[number];

/**
 * What an ingestor's handler returns (#2647): a Source's metadata and body.
 * The body is Markdown and someone else's text: Minerva escapes every `<`
 * in it, so it renders as text, never as HTML (#2558).
 */
export interface PluginSourceDraft {
  title: string;
  body: string;
  /** Default `Document`. */
  type?: PluginSourceType;
  creators?: string[];
  /** An ISO date: `2024`, `2024-05` or `2024-05-17`. */
  issued?: string;
  publisher?: string;
  abstract?: string;
  /** An http(s) URL for the work. */
  uri?: string;
  /** A BCP 47 tag: `en`, `pt-BR`. */
  language?: string;
}
