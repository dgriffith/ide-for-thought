/**
 * Shared parsers for the renderer `api.*` surface, used by the data-flow tests.
 *
 * Two facts about the renderer boundary live in source files rather than in a
 * machine-readable manifest, and more than one test needs them:
 *
 *   1. **Which method names count as mutations** — the `DATAFLOW_MUTATION_METHODS`
 *      denylist in `eslint.config.mjs` (the renderer data-flow rule, #1086/#1626).
 *   2. **Which namespace exposes which methods** — the `contextBridge` object in
 *      `src/preload/preload.ts`.
 *
 * Parsing either one twice is how the copies drift, so both live here:
 * `tests/renderer/dataflow-rule-coverage.test.ts` (#1626) and
 * `tests/architecture/store-ownership.test.ts` (#1852) share them.
 *
 * ── On lexical parsing ──────────────────────────────────────────────────────
 * These read source text, not an AST — same trade as the ratchets in
 * `tests/architecture/pattern-ratchets.test.ts`: cheap enough for the normal
 * suite, simple enough that a failure points at something real. The cost is
 * that both parsers depend on the current *formatting* of the files they read
 * (a one-line `DATAFLOW_MUTATION_METHODS`, two-space namespace keys in the
 * bridge object). Each parser therefore throws rather than returning an empty
 * result when its anchor is missing, and callers assert a non-trivial size —
 * a reformat that defeats the regex must fail loudly, never pass vacuously.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ESLINT_CONFIG = 'eslint.config.mjs';
const PRELOAD = 'src/preload/preload.ts';

/** All files under `dir` (recursively) whose name ends with `ext`. */
export function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full, ext));
    else if (full.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Drop block, line, and HTML comments so a commented example call never counts. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

/** `domain.method` for every `(window.)?api.<domain>.<method>(` call in `files`. */
export function apiCallsIn(files: string[]): Set<string> {
  const calls = new Set<string>();
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const m of src.matchAll(/(?:window\.)?\bapi\.(\w+)\.(\w+)\s*\(/g)) {
      calls.add(`${m[1]!}.${m[2]!}`);
    }
  }
  return calls;
}

/**
 * Mutation / event-subscription method names the eslint data-flow denylist
 * forbids components from calling directly.
 *
 * The names live in the `DATAFLOW_MUTATION_METHODS` const — a `'a|b|' + 'c|d'`
 * series of single-quoted fragments shared by both eslint selectors. Slice the
 * assignment (from `=` to the terminating `;`), pull the quoted contents, and
 * split on `|`; the interleaved `//` section comments carry no quotes, so they
 * drop out.
 */
export function dataflowMutationMethods(): Set<string> {
  const cfg = readFileSync(ESLINT_CONFIG, 'utf8');
  const decl = cfg.indexOf('const DATAFLOW_MUTATION_METHODS');
  if (decl < 0) {
    throw new Error(`DATAFLOW_MUTATION_METHODS not found in ${ESLINT_CONFIG} — did the const get renamed?`);
  }
  const eq = cfg.indexOf('=', decl);
  const semi = cfg.indexOf(';', eq);
  if (semi <= eq) throw new Error(`Could not find the end of the DATAFLOW_MUTATION_METHODS assignment in ${ESLINT_CONFIG}.`);
  const names = new Set<string>();
  for (const m of cfg.slice(eq, semi).matchAll(/'([^']*)'/g)) {
    for (const n of m[1]!.split('|')) if (/^\w+$/.test(n)) names.add(n);
  }
  return names;
}

/**
 * `api.<namespace>` → the method names it exposes, from the preload
 * `contextBridge.exposeInMainWorld('api', { … })` object.
 *
 * The bridge is a flat two-level object (namespace keys at two-space indent,
 * method keys at four), which is what makes the indent-anchored match safe. If
 * a nested sub-namespace is ever introduced, this returns its inner methods
 * under the outer namespace — the `preload-bridge` snapshot test (#676) is what
 * pins the surface shape; this is only a namespace→method index.
 */
export function apiNamespaceMethods(): Record<string, Set<string>> {
  const src = readFileSync(PRELOAD, 'utf8');
  // The `api` object literal is named (#1920 — so its type can be exported and
  // checked against client.ts) rather than passed inline to
  // `exposeInMainWorld`; anchor on its declaration instead.
  const start = src.indexOf('const api = {');
  if (start < 0) throw new Error(`const api = { … } not found in ${PRELOAD}.`);
  const body = src.slice(start);

  const out: Record<string, Set<string>> = {};
  let depth = 0;
  let ns: string | null = null;
  for (const line of body.split('\n')) {
    const nsMatch = line.match(/^ {2}(\w+):\s*\{/);
    if (depth === 1 && nsMatch) {
      ns = nsMatch[1]!;
      out[ns] ??= new Set();
    }
    if (ns && depth >= 2) {
      // `    method: (args) => …` — a bridged function, not a nested object.
      const methodMatch = line.match(/^\s{4}(\w+):\s*\(/);
      if (methodMatch) out[ns]!.add(methodMatch[1]!);
    }
    for (const c of line) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
    }
    if (depth <= 0) break;
  }
  return out;
}
