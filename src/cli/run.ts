/**
 * The Minerva CLI (#1149, epic #1145 — Substrate).
 *
 * `runCli` is the whole command surface as one async function: it takes an argv
 * slice + a working directory and returns { stdout, stderr, code } without
 * touching `process`. That keeps it testable and lets the thin executable entry
 * (`./main.ts`) wrap it. The read work itself lives in the shared `Engine`
 * (`./engine`), which the MCP subcommand (`./mcp`, #1146) drives too.
 *
 * The command surface is the `HELP` block below and the dispatch at the bottom
 * of `runCli` — reads (`query`, `sql`, `search`, `grep`, `semantic`, `read`,
 * `context`), one gated write (`propose-note`), a stdio MCP server exposing
 * those as tools to agent clients (`mcp`), and a development harness for skill
 * prompts (`eval`). It reuses the exact `ctx`-based core the app uses — the
 * audit for epic #1145 confirmed that core is Electron-free. `docs/cli.md`
 * documents it, and `tests/architecture/cli-docs-parity.test.ts` fails when a
 * command reaches the dispatch without reaching `HELP` and the doc.
 *
 * Every result is *grounded*: query bindings carry node IRIs, search hits carry
 * the note path, read echoes the path. Output is JSON on stdout so it pipes to
 * jq and can be handed straight to an agent.
 */
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type { ChunkEmbedder } from '../main/embeddings/vector-store';
import { projectContext } from '../main/project-context-types';
import { type Engine, type ExecResult } from './engine';
import { createRoutedEngine } from './routed-engine';
import { jsonStringify } from './json';
import { runMcpServer } from './mcp';
import { bundledResourcesRoot } from '../main/bundled-resources';
import { runEval } from './eval';
import { isScaffoldKind, isScaffoldRuntime, SCAFFOLD_KINDS, SCAFFOLD_RUNTIMES, ScaffoldRefusal, writeScaffold } from '../main/plugins/scaffold';
import { checkPlugin } from '../main/plugin-check/check';
import { setTagLevel } from '../shared/logger';

/** The app's version, defined at build time (`vite.cli.config.mts`). */
declare const __APP_VERSION__: string;
const BUILD_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

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
  /** The Minerva version `plugin check` checks a plugin's range against. Defaults
   *  to the build's (`__APP_VERSION__`); tests, which have no build, pass it. */
  appVersion?: string | undefined;
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
                        call) unless --live. Diff the output to review
                        prompt/context changes (#1522).        [--all] [--live]
  plugin new <id>       Make a plugin folder <id>/ with one working
                        contribution of a kind (#2653): a skill, type, query,
                        template, CSL style or theme; or with --mcp, a stdio
                        MCP server (a read-only tool, one that asks first), a
                        skill that uses it and a test (#2650).
                        --kind <kind> | --mcp node|python  [--name <name>] [--dir <folder>]
  plugin check <folder> Put a plugin through what Minerva does with it: the
                        manifest, an install, each contribution loaded and run
                        against fixture thoughtbases (a hostile one too), its
                        MCP servers, and a removal that must leave nothing
                        behind (#2654). Exit 1 if anything fails.
                        [--thoughtbase <path>]… [--run-servers]

Options:
  --project <path>      Thoughtbase root (default: current directory).
  --limit <n>           Max results (search/semantic default 20; grep 50, max 200).
  --regex               Treat a grep pattern as a regular expression.
  --case-sensitive      Match case exactly (grep; default: case-insensitive).
  --by <client-id>      Provenance for propose-note (default: cli).
  --all                 eval: run every case under tests/skills-eval/.
  --live                eval: make a real model call, capturing response.md +
                        drafts.json. Opt-in; needs a provider key in the env.
  --kind <kind>         plugin new: skill, type, query, template, csl, theme, inspection or mcp.
  --mcp <runtime>       plugin new: an MCP server, in node or python.
  --name <name>         plugin new: the name Settings shows (default: from the id).
  --dir <folder>        plugin new: where to make it (default: current directory).
  --thoughtbase <path>  plugin check: also check against this thoughtbase (a
                        copy; repeatable).
  --run-servers         plugin check: start its MCP servers and list their
                        tools. This runs the plugin's code.
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
  live: boolean;
  mcp: string | undefined;
  kind: string | undefined;
  name: string | undefined;
  dir: string | undefined;
  thoughtbases: string[];
  runServers: boolean;
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
  let live = false;
  let mcp: string | undefined;
  let kind: string | undefined;
  let name: string | undefined;
  let dir: string | undefined;
  const thoughtbases: string[] = [];
  let runServers = false;
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
    } else if (arg === '--live') {
      live = true;
    } else if (arg === '--thoughtbase') {
      const value = argv[++i];
      if (value !== undefined) thoughtbases.push(value);
    } else if (arg.startsWith('--thoughtbase=')) {
      thoughtbases.push(arg.slice('--thoughtbase='.length));
    } else if (arg === '--run-servers') {
      runServers = true;
    } else if (arg === '--mcp' || arg === '--name' || arg === '--dir' || arg === '--kind') {
      const value = argv[++i];
      if (arg === '--mcp') mcp = value;
      else if (arg === '--kind') kind = value;
      else if (arg === '--name') name = value;
      else dir = value;
    } else if (/^--(mcp|name|dir|kind)=/.test(arg)) {
      const [flag, ...value] = arg.slice(2).split('=');
      if (flag === 'mcp') mcp = value.join('=');
      else if (flag === 'kind') kind = value.join('=');
      else if (flag === 'name') name = value.join('=');
      else dir = value.join('=');
    } else {
      positionals.push(arg);
    }
  }

  return { command: positionals.shift(), positionals, project, limit, by, regex, caseSensitive, all, live, mcp, kind, name, dir, thoughtbases, runServers, help };
}

function json(value: unknown): string {
  return `${jsonStringify(value, true)}\n`;
}

/** Expands a leading `~` or `~/...` to the user's home directory. Callers like
 *  an MCP client's server config invoke this CLI directly (no shell), so `~`
 *  never gets shell-expanded before it reaches us — do it ourselves. */
function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/** A directory is required and must exist; a missing `.minerva` is fine —
 *  indexing just rebuilds from the `.md` files and an empty tree yields empty
 *  results rather than an error. */
async function resolveProjectRoot(project: string | undefined, cwd: string): Promise<string> {
  const root = path.resolve(cwd, expandHome(project ?? '.'));
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

/** `minerva plugin new <id> --kind <kind>` (#2653) or `--mcp node|python` (#2650), `minerva plugin check <folder>` (#2654). */
async function runPluginCommand(args: ParsedArgs, cwd: string, appVersion: string): Promise<CliResult> {
  const [sub, id, ...extra] = args.positionals;
  if (sub === 'check') {
    if (!id || extra.length > 0) throw new UsageError('plugin check: pass one plugin folder, like `minerva plugin check ./my-tools`.');
    // The hostile fixture is built to make Minerva's own seams complain (a
    // corrupt config, a link out of the root): expected, and the report says
    // what matters. The process ends with the check, so nothing is restored.
    for (const tag of ['config', 'graph', 'tables', 'plugins'] as const) setTagLevel(tag, 'silent');
    const report = await checkPlugin(path.resolve(cwd, expandHome(id)), {
      appVersion,
      thoughtbases: args.thoughtbases.map((t) => path.resolve(cwd, expandHome(t))),
      runServers: args.runServers,
    });
    return { stdout: json(report), stderr: '', code: report.ok ? 0 : 1 };
  }
  if (sub !== 'new') throw new UsageError('plugin: the subcommands are `plugin new <id> --kind <kind>` and `plugin check <folder>`.');
  if (!id || extra.length > 0) throw new UsageError('plugin new: pass one plugin id, like `minerva plugin new my-tools --kind skill`.');
  const kind: string = args.kind ?? (args.mcp !== undefined ? 'mcp' : '');
  if (!isScaffoldKind(kind)) {
    throw new UsageError(`plugin new: --kind must be ${SCAFFOLD_KINDS.join(', ')}${args.kind === undefined ? ' (or pass --mcp node|python)' : ''}.`);
  }
  if (kind === 'mcp' && (!args.mcp || !isScaffoldRuntime(args.mcp))) {
    throw new UsageError(`plugin new: --mcp must be ${SCAFFOLD_RUNTIMES.join(' or ')}.`);
  }
  if (kind !== 'mcp' && args.mcp !== undefined) throw new UsageError(`plugin new: --mcp is for --kind mcp, not ${kind}.`);
  const runtime = kind === 'mcp' && args.mcp && isScaffoldRuntime(args.mcp) ? args.mcp : undefined;
  const parent = path.resolve(cwd, expandHome(args.dir ?? '.'));
  let made: { folder: string; files: string[] };
  try {
    made = await writeScaffold(parent, { id, kind: kind, runtime, name: args.name });
  } catch (e) {
    if (e instanceof ScaffoldRefusal) throw new UsageError(`plugin new: ${e.message}`, { cause: e });
    throw e;
  }
  const next = runtime
    ? [`cd ${made.folder} && ${runtime === 'node' ? 'npm test' : 'python3 -m unittest'}`, `minerva plugin check ${made.folder} --run-servers`,
        'Settings → Plugins → Install from folder…, then switch on its server in Settings → MCP Servers.']
    : [`minerva plugin check ${made.folder}`, 'Settings → Plugins → Install from folder…'];
  return {
    stdout: json({ folder: made.folder, files: made.files, next }),
    stderr: '',
    code: 0,
  };
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
      const results = await runEval(caseDirs, { cwd: opts.cwd, live: args.live });
      return {
        stdout: json(
          results.map((r) => ({
            case: r.caseDir,
            skill: r.meta.skill,
            model: r.meta.model ?? null,
            outputMode: r.meta.outputMode,
            ...(r.live
              ? { responseChars: r.live.response.length, drafts: r.live.drafts.length, timingMs: r.live.timingMs }
              : {}),
            ...(r.security ? { security: r.security } : {}),
          })),
        ),
        stderr: '',
        // An injection case whose live run BREACHED (not merely "the model
        // followed it") is a system failure, so it fails the command (#2373).
        code: results.some((r) => (r.security?.breaches.length ?? 0) > 0) ? 1 : 0,
      };
    }

    // `plugin new` makes a folder; it needs no thoughtbase.
    if (args.command === 'plugin') return await runPluginCommand(args, opts.cwd, opts.appVersion ?? BUILD_VERSION);

    const root = await resolveProjectRoot(args.project, opts.cwd);

    // The bundled model lives under `resources/`: `<repo>/resources` in a
    // checkout, `<Resources>/resources` in the packaged app. It used to be
    // `<cli.js>/../../resources`, right in a checkout (#1149) but, once
    // packaged, `Resources/app.asar/resources` — which doesn't exist (#2410).
    const resourcesBase = bundledResourcesRoot();

    // The MCP server is long-lived and owns its own IO; it doesn't fit the
    // request/response shape, so it's handled before the engine dispatch.
    if (args.command === 'mcp') {
      await runMcpServer(root, { embedder: opts.embedder, resourcesBase });
      return { stdout: '', stderr: '', code: 0 };
    }

    // Routed engine (#1524): if a Minerva app is open on this thoughtbase,
    // `propose-note` + `semantic` run inside it (single writer / DuckDB holder);
    // otherwise they run direct, as before.
    const engine: Engine = createRoutedEngine(projectContext(root), {
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
        // `sql`, not `agentSql`, on purpose (#2452): this is SQL the user typed
        // at their own shell, like the Query panel, so it keeps the full
        // root-locked connection (`read_csv` of an in-root file works). The
        // guarded method is for MCP `sql_query`, whose SQL an agent wrote.
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
