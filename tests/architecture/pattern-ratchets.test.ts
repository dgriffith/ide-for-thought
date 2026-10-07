/**
 * @vitest-environment node
 *
 * Ratchets on known-bad patterns (#1848, epic #1855).
 *
 * CLAUDE.md documents anti-patterns and carries a "Migration backlog" of the
 * places that still have them. Prose doesn't fail a build, and it shows: the
 * backlog moved by one item in three weeks while brand-new code (#1835)
 * introduced two fresh instances of the very shapes it names.
 *
 * These are budgets, not verdicts. A number checked in that may go DOWN and
 * may not go UP. Nothing here claims every listed site is wrong — several are
 * deliberate and correct. The claim is narrower and more useful: whatever the
 * count is today, adding to it should be a decision someone makes on purpose,
 * in a diff, rather than a thing that happens.
 *
 * Same shape as the coverage floors in `vitest.config.mts`, and it works for
 * the same reason: it turns "we should get around to that" into a line in a
 * diff.
 *
 * ── On lexical scanning ─────────────────────────────────────────────────────
 * These match source text, not a parsed AST. That's a deliberate trade — a
 * ratchet has to be cheap enough to run in the normal suite and simple enough
 * that its failure message points at something real. The cost is known blind
 * spots, stated here rather than discovered later:
 *
 *   - a catch block that does anything before returning empty (a `console.warn`
 *     first, say) is NOT counted;
 *   - a swallow written across an intermediate variable is not counted;
 *   - comments and strings containing the pattern would count (none do today).
 *
 * So these undercount. They cannot be gamed into passing by *reformatting*,
 * only by writing the anti-pattern in a shape the regex misses — at which
 * point you've had to work around a test that told you not to.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `.svelte` matters once a scan includes `src/renderer` (#2100). */
const SCANNED_EXTENSIONS = ['.ts', '.svelte'];

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SCANNED_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
    }
  };
  walk(path.join(ROOT, dir));
  return out;
}

/** Occurrences per repo-relative file, omitting files with none. `dirs` may be one root or several. */
function countPerFile(dirs: string | string[], pattern: RegExp): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const dir of Array.isArray(dirs) ? dirs : [dirs]) {
    for (const file of tsFilesUnder(dir)) {
      const matches = fs.readFileSync(file, 'utf-8').match(pattern);
      if (matches?.length) counts[path.relative(ROOT, file)] = matches.length;
    }
  }
  return counts;
}

/**
 * The three source roots the swallow ratchets scan (#2100 widened past
 * `src/main` — `.catch(() => …)` swallows are just as real in renderer store/
 * component code and in `src/cli`).
 */
const SWALLOW_SCAN_ROOTS = ['src/main', 'src/renderer', 'src/cli'];

/**
 * Compare a measured population against its committed baseline and fail with
 * an instruction, not a diff dump. Which direction it moved changes what the
 * author should do, so the message says which.
 */
function assertRatchet(
  label: string,
  baseline: Record<string, number>,
  actual: Record<string, number>,
  guidance: string,
): void {
  const files = [...new Set([...Object.keys(baseline), ...Object.keys(actual)])].sort();
  const added: string[] = [];
  const removed: string[] = [];
  for (const file of files) {
    const before = baseline[file] ?? 0;
    const now = actual[file] ?? 0;
    if (now > before) added.push(`  + ${file}: ${before} → ${now}`);
    if (now < before) removed.push(`  − ${file}: ${before} → ${now}`);
  }

  if (added.length > 0) {
    expect.fail(
      `${label}: the count went UP.\n\n${added.join('\n')}\n\n${guidance}\n\n` +
      'If this really is the right call, update the baseline in this file and say why in the PR.',
    );
  }
  if (removed.length > 0) {
    expect.fail(
      `${label}: the count went DOWN — nice.\n\n${removed.join('\n')}\n\n` +
      'Lower the baseline in this file so the ratchet holds the new ground.',
    );
  }
}

// ── Ratchet 1: swallowed errors ─────────────────────────────────────────────

/**
 * A catch block whose entire body is `return <empty value>` — the "swallowing"
 * anti-pattern CLAUDE.md names: it discards a real error and reports the
 * result as an ordinary empty answer, so a corrupt file reads as "not written
 * yet" and a permissions error reads as "nothing found".
 *
 * The convention is to catch a SPECIFIC expected condition (ENOENT → sentinel)
 * and let everything else throw — see `readJsonFileOr` in `config/json-file.ts`
 * for the shape.
 */
const SWALLOW = /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:\[\]|null|undefined|''|""|\{\}|false|0)\s*;?\s*\}/g;

/**
 * Baseline as of #1848, widened in #2100 from `src/main`-only to also scan
 * `src/renderer` and `src/cli` (see `SWALLOW_SCAN_ROOTS`) — the try/catch
 * block-statement shape this regex matches isn't a main-process-only habit.
 * Not an approval list — several of these are correct (a JSON.stringify
 * fallback, an ENOENT probe). It is the line we don't cross.
 *
 * When you touch one of these files, it is worth asking whether its catch is
 * hiding something. `history/store.ts` is not on this list any more because
 * that question got asked (#1835).
 */
const SWALLOW_BASELINE: Record<string, number> = {
  'src/main/clipper/clipper-ingest.ts': 1,
  'src/main/compute/audit.ts': 1,
  'src/main/compute/proposal-helpers.ts': 1,
  'src/main/compute/save-cell-output.ts': 1,
  'src/main/config/config-store.ts': 1,
  'src/main/embeddings/backfill.ts': 1,
  'src/main/git/github-repo.ts': 2,
  'src/main/git/index.ts': 1,
  'src/main/git/publish-git.ts': 1,
  'src/main/graph/indexers/excerpt.ts': 1,
  'src/main/graph/indexers/source.ts': 1,
  'src/main/images/remote-image-cache.ts': 2,
  'src/main/llm/conversation.ts': 2,
  'src/main/llm/provider/openai.ts': 1,
  'src/main/llm/settings.ts': 1,
  'src/main/llm/thoughtbase-doc.ts': 1,
  'src/main/main.ts': 1,
  'src/main/notebase/fs.ts': 1,
  'src/main/notebase/templates.ts': 1,
  'src/main/privileged-sites.ts': 1,
  'src/main/publish/csl/user-assets.ts': 2,
  'src/main/publish/exporters/static-site/search-script.ts': 1,
  'src/main/publish/pipeline.ts': 1,
  'src/main/saved-queries.ts': 1,
  'src/main/search/minisearch-provider.ts': 1,
  'src/main/secret-storage.ts': 1,
  'src/main/sources/create-reference-stubs.ts': 1,
  'src/main/sources/csv-schema.ts': 3,
  'src/main/sources/import-zotero-rdf.ts': 1,
  'src/main/sources/source-id.ts': 1,
  'src/main/sources/tables.ts': 1,
  'src/renderer/lib/command-palette/recent.ts': 1,
  'src/renderer/lib/components/ComputeDraftCard.svelte': 1,
  // localStorage can throw (private window, blocked site data); the "hide empty"
  // pref (#2664) then reads as its default, off. Same shape as graph-settings.
  'src/renderer/lib/components/ObjectsPanel.svelte': 1,
  'src/renderer/lib/components/find-excerpt-range.ts': 1,
  'src/renderer/lib/editor/note-preview.ts': 1,
  'src/renderer/lib/preview/typed-link-render.ts': 1,
  'src/renderer/lib/sources/source-actions.ts': 1,
  'src/renderer/lib/stores/graph-settings.svelte.ts': 1,
  'src/renderer/lib/voice/voice-settings.svelte.ts': 1,
};

// ── Ratchet 1b: swallowed errors, expression form ───────────────────────────

/**
 * The promise-chaining sibling of Ratchet 1: `.catch(() => …)` with a
 * zero-arg arrow. Not binding the rejection at all is itself the "swallow"
 * signal CLAUDE.md's IPC error handling section names — contrast
 * `.catch((err) => logger('x').warn('...', err))`, which the caller can see
 * is actually looking at the failure. This deliberately does not try to
 * classify what the arrow body then does (return an empty literal, assign
 * some piece of state, do nothing) — same "lexical scan, not semantic"
 * trade-off documented at the top of this file, and the same reason
 * `grep -rn '\.catch(() =>' src` is the tool that found these 29 sites.
 *
 * `SWALLOW` (Ratchet 1) never covered this shape: it only matches the
 * try/catch block-statement form, never a `.then/.catch` chain.
 */
const SWALLOW_EXPR = /\.catch\(\s*\(\)\s*=>/g;

/**
 * Baseline as of #2100. Named examples from the source report
 * (`register-bibliography.ts`, `publish-git.ts`, `CitationsPanel.svelte`,
 * `Preview.svelte`) sit alongside plenty of legitimate best-effort cleanup
 * (`fs.rm(tmpPath, { force: true }).catch(() => {})`) — this is a ratchet,
 * not a verdict. Fix individual sites as separate follow-up work.
 */
const SWALLOW_EXPR_BASELINE: Record<string, number> = {
  'src/main/compute/python-kernel.ts': 2,
  'src/main/embeddings/vector-store.ts': 1,
  'src/main/git/publish-git.ts': 3,
  'src/main/config/json-file.ts': 1,  // moved from ipc/ in #2283; same file, same count
  'src/main/notebase/asset-references.ts': 2,
  'src/main/publish/exporters/note-pdf/electron-render.ts': 1,
  'src/main/publish/exporters/static-site/index.ts': 1,
  'src/main/sources/api-adapters/pubmed.ts': 1,
  'src/main/sources/ingest.ts': 1,
  'src/main/types/write.ts': 1,
  'src/renderer/lib/components/Preview.svelte': 1,
  'src/renderer/lib/components/right-sidebar/CitationsPanel.svelte': 1,
  'src/renderer/lib/editor/image-upload.ts': 1,
  'src/renderer/lib/editor/link-preview.ts': 1,
  'src/renderer/lib/editor/note-preview.ts': 1,
  'src/renderer/lib/stores/settings-formatter.svelte.ts': 2,
  'src/cli/eval-context.ts': 2,
  'src/cli/eval.ts': 1,
  'src/cli/run.ts': 3,
};

// ── Ratchet 2: no-project answered with null ────────────────────────────────

/**
 * `withRootPathOr(null, …)` — the handler answers `null` when no project is
 * open, and its domain call answers `null` for "not found", so the caller
 * cannot tell the two apart. CLAUDE.md rule 5: a sentinel marks exactly ONE
 * expected absence. Rule 2: a `withRootPathOr` fallback must mean the same
 * thing as a genuinely-empty result, never "error".
 *
 * #1841 cleared four of these. The one that remains is the interesting kind of
 * survivor: for a completion schema, "no project" and "nothing to complete
 * against" arguably ARE the same answer. That's a judgement worth making
 * deliberately, which is what this ratchet forces.
 */
const NO_PROJECT_NULL = /withRootPathOr\s*(?:<[^>]*>)?\s*\(\s*null\b/g;

const NO_PROJECT_NULL_BASELINE: Record<string, number> = {
  'src/main/ipc/register-graph.ts': 1,
};

// ── Ratchet 3: boolean overloads ────────────────────────────────────────────

/**
 * `withRootPathOr(false, …)` or `withRootPathOr(0, …)` or `withRootPathOr(true, …)` —
 * the handler answers a primitive (boolean/number) when no project is open, and its
 * domain call answers the same type for a different reason (operation failed, no
 * results, etc.), so the caller cannot tell them apart. CLAUDE.md rule 5: a sentinel
 * marks exactly ONE expected absence.
 *
 * The pattern to catch: `withRootPathOr(false|true|0|1, ...)` — a primitive fallback
 * that lacks semantic context (unlike { ok: false; error } which is a discriminated
 * union). This regex skips over the optional generic type (which may have nested
 * angle brackets) and finds the fallback value directly. It finds the common case
 * but may miss variants written across multiple lines or using variables.
 */
const BOOLEAN_OVERLOAD = /withRootPathOr[^(]*\(\s*(?:false|true|0|1)\s*[,)]/g;

const BOOLEAN_OVERLOAD_BASELINE: Record<string, number> = {
  'src/main/ipc/register-notebase.ts': 1,
  'src/main/ipc/register-proposals.ts': 1,
};

// ── Ratchet 4: no-project answered with undefined ───────────────────────────

/**
 * `withRootPathOr(undefined, …)` — the handler answers `undefined` when no
 * project is open, indistinguishable from a `void`-returning handler's own
 * SUCCESS return (also `undefined`). Not caught by `NO_PROJECT_NULL` above
 * (that regex matches only the literal `null` fallback). #1894 found this
 * exact shape used on four write handlers, each of which silently reported
 * success — a save that never happened, an export that never ran — instead
 * of surfacing "no project open" as the failure it is.
 *
 * The survivors below are genuinely fine, not overlooked: `shell.*` handlers
 * are the CLAUDE.md-documented "stateless OS side-effect" category —
 * `SHELL_REVEAL_FILE`/`SHELL_OPEN_IN_DEFAULT`/`SHELL_OPEN_IN_TERMINAL` return
 * `undefined` on success too (there's nothing to report either way), so "no
 * project ⇒ nothing to reveal/open" isn't a disguised failure the way a
 * silently-skipped persist is. `TABS_SAVE` was actually converted to
 * `withRootPath` and then reverted — CI's smoke test caught it: the editor
 * store persists its tab layout reactively, including the very first empty
 * layout a project-less window mounts with, so "no project" there means
 * "nothing to persist," not a failed write.
 */
const NO_PROJECT_UNDEFINED = /withRootPathOr\s*(?:<[^>]*>)?\s*\(\s*undefined\b/g;

const NO_PROJECT_UNDEFINED_BASELINE: Record<string, number> = {
  'src/main/ipc/register-bookmarks.ts': 1,
  'src/main/ipc/register-shell.ts': 3,
};

// ── Ratchet 5: in-band error? on an otherwise-normal payload ────────────────

/**
 * A `Promise<{ ... error?: ... }>` return type — an optional `error` field
 * bolted onto what otherwise reads as a plain success payload, instead of the
 * discriminated `{ ok: false; error }` union CLAUDE.md rule 3 asks for. The
 * caller has to remember to check `result.error` even though nothing about
 * the type says a truthy `results`/`columns` might still be garbage.
 *
 * Scoped to the `Promise<{...}>` inline-return-type shape specifically,
 * rather than any `error?:` field anywhere — `error?:` alone also shows up
 * on legitimate shapes this isn't about: a per-item outcome catalog entry
 * (CLAUDE.md rule 4 — `compute/audit.ts`'s audit-record `error?`, not a live
 * call's return value), internal worker/cell bookkeeping
 * (`compute/python-kernel.ts`'s `PendingCell`), and a modeled *external* SDK
 * error shape we don't control (`llm/classify-error.ts`). Narrowing to the
 * inline `Promise<{...}>` shape catches exactly the IPC-return-type instance
 * this anti-pattern is about and skips all four of those without an
 * allowlist — measured directly (#2060).
 */
const IN_BAND_ERROR_ON_PAYLOAD = /Promise<\s*\{[^{}]*\berror\?:[^{}]*\}\s*>/g;

/**
 * Empty since #2363: the one instance CLAUDE.md's backlog named, `GRAPH_QUERY`'s
 * `{ results, columns, error? }`, is now `shared/graph-query.ts`'s
 * `GraphQueryResult` union — the `TABLES_QUERY` `{ ok: false; error }` shape.
 * So this ratchet now holds the line at zero. `attach-evidence.ts`'s
 * `AttachEvidenceResult` is a NAMED interface, not an inline `Promise<{...}>`,
 * so it doesn't match this ratchet's regex — it's a related but distinct
 * half-migrated shape (it already carries an `ok` field, just doesn't use it as
 * a real TS discriminant) worth its own look someday, not conflated with this one.
 */
const IN_BAND_ERROR_ON_PAYLOAD_BASELINE: Record<string, number> = {};

// ── Ratchet 6: non-atomic JSON-store writes ─────────────────────────────────

/**
 * A raw `writeFile`/`writeFileSync` of JSON — the write that a crash (main
 * dies, the machine loses power) can leave truncated on disk. A truncated
 * settings/bookmarks/session file then reads as corrupt: `readJsonFileOr`
 * rightly refuses it, and a lenient loader falls back to defaults — the user's
 * state is gone either way. `writeJsonFileAtomic` / `writeJsonFileAtomicSync`
 * in `config/json-file.ts` write a sibling temp file and `rename` it over the
 * real one, so a reader sees the old file or the new one, never half of one.
 *
 * The heuristic, and why it doesn't flag exports: a call counts when its
 * ARGUMENT LIST serializes JSON inline (`JSON.stringify(` / the CLI's
 * `jsonStringify(`) or names a `'….json'` path literal. The export paths
 * (`publish/run-export.ts`, `register-bibliography.ts`, the CSV/PDF saves)
 * all write contents an exporter already rendered, so they don't match —
 * nothing had to be allowlisted to leave them out. Calls through
 * `notebaseFs.` are skipped: that is the sandboxed note-write API, whose
 * files are the user's documents (history-captured, #1158), not stores.
 *
 * Known blind spots — it undercounts, like every scan in this file:
 *   - JSON serialized into a variable first and written by a later call
 *     (`const text = JSON.stringify(x); fs.writeFile(p, text)`), unless the
 *     path argument is a `.json` literal;
 *   - a serializer helper (`serializeX(input)` written to a `${id}.json`
 *     path built earlier);
 *   - a write through a stream or a library rather than `writeFile*`;
 *   - the argument list is found by balancing parentheses, so a string
 *     literal holding an unbalanced `(` or `)` would cut it short.
 */
const RAW_WRITE_CALL = /(?<!notebaseFs\.)(?<!function )\bwriteFile(?:Sync)?\(/g;
const WRITES_JSON = /JSON\.stringify\(|\bjsonStringify\(|\.json['"`]/;

/** The text between the `(` that ends at `openIdx` and its matching `)`. */
function argumentListFrom(source: string, openIdx: number): string {
  let depth = 1;
  for (let i = openIdx; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')' && --depth === 0) return source.slice(openIdx, i);
  }
  return source.slice(openIdx);
}

function countNonAtomicJsonWrites(source: string): number {
  let count = 0;
  for (const call of source.matchAll(RAW_WRITE_CALL)) {
    if (WRITES_JSON.test(argumentListFrom(source, call.index + call[0].length))) count++;
  }
  return count;
}

/** `config/json-file.ts` is the atomic writer itself — its temp-file write is the point. */
const ATOMIC_WRITER = 'src/main/config/json-file.ts';

function nonAtomicJsonWritesPerFile(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of [...tsFilesUnder('src/main'), ...tsFilesUnder('src/cli')]) {
    const rel = path.relative(ROOT, file);
    if (rel === ATOMIC_WRITER) continue;
    const n = countNonAtomicJsonWrites(fs.readFileSync(file, 'utf-8'));
    if (n > 0) counts[rel] = n;
  }
  return counts;
}

/**
 * Baseline as of #2369, which moved every user-state store onto the atomic
 * writer (settings ×4, session, recent projects, privileged sites, compute consent,
 * `.minerva/config.json` + `secrets.json`, menu config, MCP servers + OAuth
 * tokens, collections, the history index, conversation transcripts). Not one
 * of the survivors is a store the user would lose:
 */
const NON_ATOMIC_JSON_WRITE_BASELINE: Record<string, number> = {
  // Golden-file eval outputs (`request.json`, `meta.json`, `drafts.json`, and
  // an injection case's `security.json`, #2373), regenerated wholesale by
  // `pnpm cli eval` — a torn one is a red diff, re-run the command.
  'src/cli/eval.ts': 4,
  // The derived full-text index. `load` already treats a corrupt file as "start
  // fresh" and it rebuilds from the notes; it is also the one large write here,
  // and deliberately compact.
  'src/main/search/minisearch-provider.ts': 1,
  // (`substrate/app-server.ts`'s runtime.json moved to writeJsonFileAtomic,
  // owner-only, in #2567.)
};

describe('known-bad pattern ratchets (#1848)', () => {
  it('the scanners still find things — a broken regex would pass vacuously', () => {
    // The failure mode that would quietly turn all ratchets into decoration.
    expect(Object.keys(countPerFile(SWALLOW_SCAN_ROOTS, SWALLOW)).length).toBeGreaterThan(20);
    expect(Object.keys(countPerFile(SWALLOW_SCAN_ROOTS, SWALLOW_EXPR)).length).toBeGreaterThan(0);
    expect(Object.keys(countPerFile('src/main', NO_PROJECT_NULL)).length).toBeGreaterThan(0);
    expect(Object.keys(countPerFile('src/main', BOOLEAN_OVERLOAD)).length).toBeGreaterThan(0);
    expect(Object.keys(countPerFile('src/main', NO_PROJECT_UNDEFINED)).length).toBeGreaterThan(0);
    // The in-band ratchet is at ZERO (#2363), so the live tree can no longer
    // prove its regex works — pin it against the shape it exists to catch, and
    // against the union that replaced it, instead.
    expect('Promise<{ results: unknown[]; columns: string[]; error?: string }>'.match(IN_BAND_ERROR_ON_PAYLOAD)).toHaveLength(1);
    expect('Promise<{ ok: true; results: unknown[] } | { ok: false; error: string }>'.match(IN_BAND_ERROR_ON_PAYLOAD)).toBeNull();
  });

  it('the non-atomic JSON-write scanner counts store writes and leaves exports alone', () => {
    // The shapes it exists to catch — sync and async, JSON inline or a `.json`
    // literal path, and an argument list spread over several lines.
    expect(countNonAtomicJsonWrites("fs.writeFileSync(file(), JSON.stringify(data, null, 2), 'utf-8');")).toBe(1);
    expect(countNonAtomicJsonWrites("await fs.writeFile(path.join(dir, 'meta.json'), text, 'utf-8');")).toBe(1);
    expect(countNonAtomicJsonWrites(
      "await fs.writeFile(\n  settingsPath(),\n  JSON.stringify({\n    a: f(x),\n  }, null, 2),\n  'utf-8',\n);",
    )).toBe(1);
    expect(countNonAtomicJsonWrites("await writeFile(p, `${jsonStringify(x, true)}\\n`);")).toBe(1);
    // …and what it must not count: an exporter's pre-rendered contents, a note
    // written through the sandbox, the atomic writer, a local function named
    // `writeFile`, and JSON serialized somewhere other than the write's own call.
    expect(countNonAtomicJsonWrites("await fs.writeFile(destAbs, f.contents, 'utf-8');")).toBe(0);
    expect(countNonAtomicJsonWrites("await notebaseFs.writeFile(rootPath, 'data.json', JSON.stringify(x));")).toBe(0);
    expect(countNonAtomicJsonWrites('await writeJsonFileAtomic(settingsPath(), clean);')).toBe(0);
    expect(countNonAtomicJsonWrites('function writeFile(data: FileShape): void {')).toBe(0);
    expect(countNonAtomicJsonWrites("fs.writeFileSync(a, b); const s = JSON.stringify(x);")).toBe(0);
    // And it still finds the survivors in the live tree.
    expect(Object.keys(nonAtomicJsonWritesPerFile()).length).toBeGreaterThan(0);
  });

  it('swallowed errors: no new ones', () => {
    assertRatchet(
      'Swallowed errors (catch → empty value)',
      SWALLOW_BASELINE,
      countPerFile(SWALLOW_SCAN_ROOTS, SWALLOW),
      'A blanket catch that returns an empty value turns a corrupt file into "not written yet" ' +
      'and a permissions error into "nothing found". Catch the SPECIFIC expected condition ' +
      '(ENOENT → sentinel) and let the rest throw — see `readJsonFileOr` in `config/json-file.ts`, ' +
      'and CLAUDE.md → IPC error handling.',
    );
  });

  it('swallowed errors, expression form: no new ones', () => {
    assertRatchet(
      'Swallowed errors (.catch(() => …), zero-arg)',
      SWALLOW_EXPR_BASELINE,
      countPerFile(SWALLOW_SCAN_ROOTS, SWALLOW_EXPR),
      'A `.catch(() => …)` that never binds the rejection can\'t look at, log, or rethrow it — ' +
      'the same swallow CLAUDE.md → IPC error handling warns about, just spelled as a promise chain ' +
      'instead of a try/catch block. If the failure really is fine to ignore silently (best-effort ' +
      'cleanup, a probe), say so in a comment; otherwise bind the error and handle it.',
    );
  });

  it('no-project answered with null: no new ones', () => {
    assertRatchet(
      'no-project → null (withRootPathOr(null, …))',
      NO_PROJECT_NULL_BASELINE,
      countPerFile('src/main', NO_PROJECT_NULL),
      'Use `withRootPath` so "no project open" throws, leaving `null` to mean only "not found" ' +
      '(CLAUDE.md rules 2 and 5). `withRootPathOr` is for handlers whose project-less answer is a ' +
      'legitimate value — an empty list a UI renders as "nothing yet" — not a way to signal failure.',
    );
  });

  it('boolean overloads: no new ones', () => {
    assertRatchet(
      'Boolean/numeric overloads (withRootPathOr(false|true|0|1, …))',
      BOOLEAN_OVERLOAD_BASELINE,
      countPerFile('src/main', BOOLEAN_OVERLOAD),
      'A primitive fallback (false, true, 0, 1) when no project is open conflates "no project" ' +
      'with operation failure/no results. Use a discriminated union ({ ok: false; error: "..." }) ' +
      'instead, or a unique sentinel. See CLAUDE.md IPC error handling rule 3: discriminated `{ ok, … }` ' +
      'unions for expected multi-outcome paths. Rule 5: a sentinel marks exactly one expected absence.',
    );
  });

  it('no-project answered with undefined: no new ones', () => {
    assertRatchet(
      'no-project → undefined (withRootPathOr(undefined, …))',
      NO_PROJECT_UNDEFINED_BASELINE,
      countPerFile('src/main', NO_PROJECT_UNDEFINED),
      'Use `withRootPath` so "no project open" throws instead of resolving as `undefined` — ' +
      'indistinguishable from a void-returning handler\'s own success (#1894). `withRootPathOr` ' +
      'is for handlers whose project-less answer is a legitimate value, not a way to signal failure.',
    );
  });

  it('in-band error? on an otherwise-normal payload: no new ones', () => {
    assertRatchet(
      'in-band error? (Promise<{ ... error?: ... }>)',
      IN_BAND_ERROR_ON_PAYLOAD_BASELINE,
      countPerFile('src/main', IN_BAND_ERROR_ON_PAYLOAD),
      'An optional `error` field on what otherwise reads as a plain success payload means every ' +
      'caller has to remember to check it even though the type doesn\'t say a truthy payload might ' +
      'still be garbage. Use the discriminated `{ ok: false; error } | { ok: true; ... }` union from ' +
      'CLAUDE.md IPC error handling rule 3 instead — see `TABLES_QUERY`\'s `{ ok, ... }` shape.',
    );
  });

  it('non-atomic JSON-store writes: no new ones', () => {
    assertRatchet(
      'Non-atomic JSON writes (writeFile*(…JSON.stringify… | ….json))',
      NON_ATOMIC_JSON_WRITE_BASELINE,
      nonAtomicJsonWritesPerFile(),
      'A crash mid-`writeFile` leaves a truncated file, which then reads as corrupt and the store ' +
      'falls back to defaults. Write JSON stores through `writeJsonFileAtomic` / ' +
      '`writeJsonFileAtomicSync` (`src/main/config/json-file.ts`), which take `{ indent, trailingNewline }` ' +
      'to keep an existing file format. A file the user asked to export is not a store — if the scan ' +
      'caught one, say why in the baseline comment.',
    );
  });
});
