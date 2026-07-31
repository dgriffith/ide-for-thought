/**
 * The Minerva CLI (#1149, epic #1145 — Substrate).
 *
 * `runCli` is the whole command surface as one async function: it takes an argv
 * slice + a working directory and returns { stdout, stderr, code } without
 * touching `process`. That keeps it testable and lets the thin executable entry
 * (`./main.ts`) wrap it. The read work itself lives in the shared `Engine`
 * (`./engine`), which the MCP subcommand (`./mcp`, #1146) drives too.
 *
 * READ surface: `query` (SPARQL), `sql` (DuckDB), `search` (full-text),
 * `semantic` (embeddings), `read` (a note's markdown), and `mcp` (a stdio MCP
 * server exposing those as tools to agent clients). It reuses the exact
 * `ctx`-based core the app uses — the audit for epic #1145 confirmed that core
 * is Electron-free.
 *
 * Every result is *grounded*: query bindings carry node IRIs, search hits carry
 * the note path, read echoes the path. Output is JSON on stdout so it pipes to
 * jq and can be handed straight to an agent.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import type { ChunkEmbedder } from '../main/embeddings/vector-store';
import { projectContext } from '../main/project-context-types';
import { createEngine, type Engine, type ExecResult } from './engine';
import { jsonStringify } from './json';
import { runMcpServer } from './mcp';
import { runEval } from './eval';

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
  /** Note content piped on stdin — how `propose-note` receives the body (the
   *  executable entry reads it; kept as data so `runCli` stays process-free). */
  stdin?: string | undefined;
}

export const HELP = `minerva — headless access to a Minerva thoughtbase (#1149)

Usage:
  minerva <command> [args] [--project <path>]

Commands:
  query <sparql>        Run a SPARQL query against the knowledge graph.
  sql <sql>             Run a DuckDB SQL query over the vault's CSV tables.
  search <text>         Full-text search over notes.        [--limit <n>]
  grep <pattern>        Exact literal / regex search over raw note text; matches
                        grounded with path + line.  [--regex] [--case-sensitive] [--limit <n>]
  semantic <text>       Semantic (embeddings) search over notes.  [--limit <n>]
  read <relative-path>  Print a note's raw markdown.
  context <topic>       Assemble a relevant slice — matching notes + their link
                        neighborhood + content — as agent context.  [--limit <n>]
  propose-note <path>   File a NEW note (body on stdin) as a pending proposal
                        for review in Minerva.               [--by <client-id>]
  mcp                   Start a stdio MCP server exposing the read + propose
                        tools to agent clients (Claude Desktop, coding agents…).
  eval <case-dir>…      Package a skill's prompt exactly as Minerva does and
                        overwrite each case's output/. Deterministic (no LLM
                        call). Diff the output to review prompt/context changes
                        (#1522).                                       [--all]

Options:
  --project <path>      Thoughtbase root (default: current directory).
  --limit <n>           Max results for search/semantic/grep (default: 20).
  --regex               Treat a grep pattern as a regular expression.
  --case-sensitive      Match case exactly (grep; default: case-insensitive).
  --by <client-id>      Provenance for propose-note (default: cli).
  --all                 eval: run every case under tests/skills-eval/.
  --help, -h            Show this help.

Results are JSON on stdout, grounded with node IRIs / note paths so the output
pipes into jq or feeds an agent directly. Semantic search covers only content the
app has already embedded.`;

interface ParsedArgs {
  command: string | undefined;
  positionals: string[];
  project: string | undefined;
  limit: number | undefined;
  by: string | undefined;
  regex: boolean;
  caseSensitive: boolean;
  all: boolean;
  help: boolean;
}

/** Hand-rolled parse — no dependency, and the surface is tiny. Recognises the
 *  global `--project`/`--limit` value flags and `--help`; everything else is a
 *  positional (so a SPARQL query with stray dashes survives). */
export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  let project: string | undefined;
  let limit: number | undefined;
  let by: string | undefined;
  let regex = false;
  let caseSensitive = false;
  let all = false;
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
    } else if (arg === '--by') {
      by = argv[++i];
    } else if (arg.startsWith('--by=')) {
      by = arg.slice('--by='.length);
    } else if (arg === '--regex') {
      regex = true;
    } else if (arg === '--case-sensitive') {
      caseSensitive = true;
    } else if (arg === '--all') {
      all = true;
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals.shift(), positionals, project, limit, by, regex, caseSensitive, all, help };
}

function json(value: unknown): string {
  return `${jsonStringify(value, true)}\n`;
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

/** All eval case dirs under `tests/skills-eval/` (each holding an
 *  `input/case.json`), for `eval --all`. Sorted for stable ordering. */
async function discoverEvalCases(cwd: string): Promise<string[]> {
  const base = path.join(cwd, 'tests', 'skills-eval');
  const entries = await fs.readdir(base, { withFileTypes: true }).catch(() => []);
  const cases: string[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const caseDir = path.join(base, ent.name);
    const hasManifest = await fs
      .stat(path.join(caseDir, 'input', 'case.json'))
      .then(() => true)
      .catch(() => false);
    if (hasManifest) cases.push(caseDir);
  }
  return cases.sort();
}

/** Format an Engine result as a CliResult: success → pretty JSON + code 0;
 *  failure → `<prefix>: <error>` on stderr + code 1. */
function format(result: ExecResult, errorPrefix: string): CliResult {
  return result.ok
    ? { stdout: json(result.data), stderr: '', code: 0 }
    : { stdout: '', stderr: `${errorPrefix}: ${result.error}\n`, code: 1 };
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
    // The eval harness (#1522) manages its own per-case thoughtbase roots, so
    // it's dispatched before the single-root resolution below.
    if (args.command === 'eval') {
      const caseDirs = args.all ? await discoverEvalCases(opts.cwd) : args.positionals;
      if (caseDirs.length === 0) {
        throw new UsageError('eval: pass one or more case directories, or --all.');
      }
      const results = await runEval(caseDirs, { cwd: opts.cwd });
      return {
        stdout: json(
          results.map((r) => ({
            case: r.caseDir,
            skill: r.meta.skill,
            model: r.meta.model ?? null,
            outputMode: r.meta.outputMode,
          })),
        ),
        stderr: '',
        code: 0,
      };
    }

    const root = await resolveProjectRoot(args.project, opts.cwd);

    // The bundled model lives at <repo>/resources. Both the built bundle
    // (.vite/build/cli.js) and the TS source (src/cli/run.ts) sit two levels
    // below the repo root, so this resolves the model regardless of the caller's
    // cwd — where the embedder's old cwd-relative fallback broke (#1149).
    const resourcesBase = path.join(__dirname, '..', '..', 'resources');

    // The MCP server is long-lived and owns its own IO; it doesn't fit the
    // request/response shape, so it's handled before the engine dispatch.
    if (args.command === 'mcp') {
      await runMcpServer(root, { embedder: opts.embedder, resourcesBase });
      return { stdout: '', stderr: '', code: 0 };
    }

    const engine: Engine = createEngine(projectContext(root), {
      embedder: opts.embedder,
      resourcesBase,
    });
    const rest = args.positionals.join(' ');

    switch (args.command) {
      case 'query':
        if (!rest.trim()) throw new UsageError('query: a SPARQL string is required.');
        return format(await engine.query(rest), 'SPARQL error');
      case 'sql':
        if (!rest.trim()) throw new UsageError('sql: a SQL string is required.');
        return format(await engine.sql(rest), 'SQL error');
      case 'search':
        if (!rest.trim()) throw new UsageError('search: a query string is required.');
        return format(await engine.search(rest, args.limit), 'Error');
      case 'grep':
        if (!rest.trim()) throw new UsageError('grep: a search pattern is required.');
        return format(
          await engine.grep(rest, { regex: args.regex, caseSensitive: args.caseSensitive, limit: args.limit }),
          'Error',
        );
      case 'semantic':
        if (!rest.trim()) throw new UsageError('semantic: a query string is required.');
        return format(await engine.semantic(rest, args.limit), 'Error');
      case 'read':
        if (!args.positionals[0]) throw new UsageError('read: a relative note path is required.');
        return format(await engine.read(args.positionals[0]), 'Error');
      case 'context':
        if (!rest.trim()) throw new UsageError('context: a topic is required.');
        return format(await engine.context(rest, args.limit), 'Error');
      case 'propose-note': {
        const rel = args.positionals[0];
        if (!rel) throw new UsageError('propose-note: a relative note path is required.');
        const content = opts.stdin ?? '';
        if (!content.trim()) {
          throw new UsageError(
            'propose-note: pipe the note content on stdin, e.g. ' +
              '`cat note.md | minerva propose-note notes/idea.md`.',
          );
        }
        return format(
          await engine.proposeNote({ relativePath: rel, content, proposedBy: args.by ?? 'cli' }),
          'Error',
        );
      }
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
