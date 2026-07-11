/**
 * The Minerva CLI (#1149, epic #1145 — Substrate).
 *
 * `runCli` is the whole command surface as one pure async function: it takes an
 * argv slice + a working directory and returns { stdout, stderr, code } without
 * touching `process` or Electron. That keeps it fully testable under vitest and
 * lets the thin executable entry (`./main.ts`) — and, later, the MCP subcommand
 * (#1146) — wrap the same logic.
 *
 * This is the READ half of CLI parity: `query` (SPARQL), `search` (full-text),
 * and `read` (a note's markdown). It reuses the exact `ctx`-based core the app
 * uses — the audit for epic #1145 confirmed that core is Electron-free — by
 * constructing a ProjectContext from a directory and running the same
 * init → index → query path the app runs on project open.
 *
 * Every result is *grounded*: query bindings carry node IRIs, search hits carry
 * the note path, read echoes the path. Output is JSON on stdout so it pipes to
 * jq and can be handed straight to an agent.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import * as graph from '../main/graph/index';
import * as search from '../main/search/index';
import * as tables from '../main/sources/tables';
import * as vectors from '../main/embeddings/vector-store';
import type { ChunkEmbedder } from '../main/embeddings/vector-store';
import { getSharedEmbedder } from '../main/embeddings/shared-embedder';
import { readFile } from '../main/notebase/fs';
import { projectContext, type ProjectContext } from '../main/project-context-types';

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunOptions {
  cwd: string;
  /** Injectable embedder for `semantic`, so tests can run against a fake instead
   *  of loading the real WASM model. Defaults to the shared model embedder. */
  embedder?: ChunkEmbedder;
}

export const HELP = `minerva — headless access to a Minerva thoughtbase (#1149)

Usage:
  minerva <command> [args] [--project <path>]

Commands:
  query <sparql>        Run a SPARQL query against the knowledge graph.
  sql <sql>             Run a DuckDB SQL query over the vault's CSV tables.
  search <text>         Full-text search over notes.        [--limit <n>]
  semantic <text>       Semantic (embeddings) search over notes.  [--limit <n>]
  read <relative-path>  Print a note's raw markdown.

Options:
  --project <path>      Thoughtbase root (default: current directory).
  --limit <n>           Max results for search/semantic (default: 20).
  --help, -h            Show this help.

Results are JSON on stdout, grounded with node IRIs / note paths so the output
pipes into jq or feeds an agent directly. Semantic search covers only content the
app has already embedded.`;

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  project: string | undefined;
  limit: number | undefined;
  help: boolean;
}

/** Hand-rolled parse — no dependency, and the surface is tiny. Recognises the
 *  global `--project`/`--limit` value flags and `--help`; everything else is a
 *  positional (so a SPARQL query with stray dashes survives). */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let project: string | undefined;
  let limit: number | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--project' || arg === '-p') {
      project = argv[++i];
    } else if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length);
    } else if (arg === '--limit') {
      limit = Number(argv[++i]);
    } else if (arg.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length));
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals.shift(), positionals, project, limit, help };
}

// DuckDB returns BigInt for integer columns (SQL command), which JSON.stringify
// can't serialize. Keep safe integers as numbers; stringify larger ids to avoid
// precision loss. See the DuckDB BigInt serialization gotcha.
function bigintSafeReplacer(_key: string, v: unknown): unknown {
  if (typeof v !== 'bigint') return v;
  return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(v)
    : v.toString();
}

function json(value: unknown): string {
  return `${JSON.stringify(value, bigintSafeReplacer, 2)}\n`;
}

/** The app always has a `.minerva/` dir; a headless first run against a fresh
 *  vault may not, and the index-building commands persist there. Derived cache
 *  only, so creating it during a read is safe. */
async function ensureMinervaDir(root: string): Promise<void> {
  await fs.mkdir(path.join(root, '.minerva'), { recursive: true });
}

/** A directory is required and must exist; a missing `.minerva` is fine —
 *  indexing just rebuilds from the `.md` files and an empty tree yields empty
 *  results rather than an error. */
async function resolveProjectRoot(project: string | undefined, cwd: string): Promise<string> {
  const root = path.resolve(cwd, project ?? '.');
  const stat = await fs.stat(root).catch(() => null);
  if (!stat || !stat.isDirectory()) {
    throw new UsageError(`Not a directory: ${root}`);
  }
  return root;
}

/** A CLI-level error whose message is meant for the user (exit code 2), as
 *  opposed to an unexpected throw (exit code 1). */
class UsageError extends Error {}

async function runQuery(ctx: ProjectContext, sparql: string): Promise<CliResult> {
  if (!sparql.trim()) throw new UsageError('query: a SPARQL string is required.');
  await graph.initGraph(ctx);
  await graph.indexAllNotes(ctx);
  const { results, columns, error } = await graph.queryGraph(ctx, sparql);
  if (error) return { stdout: '', stderr: `SPARQL error: ${error}\n`, code: 1 };
  return { stdout: json({ columns, results }), stderr: '', code: 0 };
}

async function runSearch(ctx: ProjectContext, text: string, limit: number | undefined): Promise<CliResult> {
  if (!text.trim()) throw new UsageError('search: a query string is required.');
  // `indexAllNotes` persists the MiniSearch index into `.minerva/`, so the dir
  // must exist first (a headless first run may not have it).
  await ensureMinervaDir(ctx.rootPath);
  await search.initSearch(ctx);
  await search.indexAllNotes(ctx);
  const hits = search.search(ctx, text, limit ? { limit } : undefined);
  return { stdout: json({ query: text, hits }), stderr: '', code: 0 };
}

async function runSql(ctx: ProjectContext, sql: string): Promise<CliResult> {
  if (!sql.trim()) throw new UsageError('sql: a SQL string is required.');
  await ensureMinervaDir(ctx.rootPath);
  await tables.initTablesDb(ctx);
  // Register the vault's CSV tables so they're queryable by their derived names.
  await tables.registerAllCsvs(ctx);
  const result = await tables.runQuery(ctx, sql);
  if (!result.ok) return { stdout: '', stderr: `SQL error: ${result.error}\n`, code: 1 };
  return { stdout: json({ columns: result.columns, rows: result.rows }), stderr: '', code: 0 };
}

async function runSemantic(
  ctx: ProjectContext,
  text: string,
  limit: number | undefined,
  embedder: ChunkEmbedder,
): Promise<CliResult> {
  if (!text.trim()) throw new UsageError('semantic: a query string is required.');
  await ensureMinervaDir(ctx.rootPath);
  await vectors.init(ctx, { embedder });
  const hits = await vectors.searchRelated(ctx, text, limit ? { limit } : {});
  const out: Record<string, unknown> = { query: text, hits };
  if (hits.length === 0) {
    // Semantic search only covers already-embedded content; a vault the app has
    // never opened/embedded yields nothing. Say so rather than look broken.
    out.note =
      'No embedded content matched. Semantic search covers notes already embedded ' +
      'by the app; a vault that has never been embedded returns no hits.';
  }
  return { stdout: json(out), stderr: '', code: 0 };
}

async function runRead(ctx: ProjectContext, relativePath: string): Promise<CliResult> {
  if (!relativePath) throw new UsageError('read: a relative note path is required.');
  const content = await readFile(ctx.rootPath, relativePath);
  return { stdout: json({ path: relativePath, content }), stderr: '', code: 0 };
}

/**
 * Run one CLI invocation. Never throws for expected conditions — usage problems
 * return code 2, core errors code 1, success code 0 — so the executable entry is
 * a thin "write + exit" shell.
 */
export async function runCli(argv: string[], opts: RunOptions): Promise<CliResult> {
  const args = parseArgs(argv);

  if (args.help || !args.command) {
    return { stdout: `${HELP}\n`, stderr: '', code: args.command ? 0 : args.help ? 0 : 2 };
  }

  try {
    const root = await resolveProjectRoot(args.project, opts.cwd);
    const ctx = projectContext(root);

    switch (args.command) {
      case 'query':
        return await runQuery(ctx, args.positionals.join(' '));
      case 'sql':
        return await runSql(ctx, args.positionals.join(' '));
      case 'search':
        return await runSearch(ctx, args.positionals.join(' '), args.limit);
      case 'semantic':
        return await runSemantic(ctx, args.positionals.join(' '), args.limit, opts.embedder ?? getSharedEmbedder());
      case 'read':
        return await runRead(ctx, args.positionals[0] ?? '');
      default:
        return { stdout: '', stderr: `Unknown command: ${args.command}\n\n${HELP}\n`, code: 2 };
    }
  } catch (err) {
    if (err instanceof UsageError) {
      return { stdout: '', stderr: `${err.message}\n`, code: 2 };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: '', stderr: `Error: ${message}\n`, code: 1 };
  }
}
