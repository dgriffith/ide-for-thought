/**
 * Type-registry loader (#1062). Stock types ship bundled via a Vite glob
 * (mirroring skills/loader.ts); user types live in-tree at
 * `<rootPath>/.minerva/types/*.md` so they travel with the library (decision 1
 * in docs/vision/objects.md). Unlike skills, the catalog is PER-PROJECT — the
 * user portion is a property of this thoughtbase's vocabulary, not the machine.
 *
 * Loading is additive, and an in-tree file of the same id OVERRIDES the stock
 * type it shadows — that's how a thoughtbase customizes Book or Meeting
 * (add a property, change the icon) without forking the bundle. The override is
 * a full local copy, marked `overridesStock` so the UI can offer "revert to
 * stock": deleting the in-tree file restores the bundled definition, because
 * the stock set is still loaded underneath. The id is what carries the override,
 * and `classLocalName` derives from the id, so a customized Book keeps its
 * `types:Book` class and every existing instance stays valid.
 *
 * Two ids colliding within the SAME source is still an error (a duplicate stock
 * id, or two user files claiming one id) — those are mistakes, not overrides.
 *
 * Process / test note (#1630): the stock set is a build-time module-global — the
 * `?raw` glob below, one immutable copy per process. Crucially, unlike the tool
 * registry's *mutable* module-global `Map` (`shared/tools/registry.ts`, whose
 * doc explains why tests must reset it), `loadTypeCatalog` returns a FRESH
 * catalog on every call, held on the per-project `GraphState`
 * (`state.typeCatalog`) — there is no shared mutable singleton here. So a test
 * gets isolation just by loading against its own temp `rootPath`; there's no
 * process-global catalog state to clear between tests.
 *
 * ## Parse memoization (#2225)
 *
 * Every call still does the full `readdir` + `readFile` walk — that is the
 * freshness promise `register-types.ts` documents, and it is what lets a type
 * file dropped into `.minerva/types/` by hand (or by a `git pull`) appear on
 * the next list with no reindex. Nothing watches that directory, so a call that
 * skipped the walk would be serving whatever was on disk at project-open time.
 *
 * What IS memoized is the parse, which measurement showed to be roughly half
 * the user-type cost and effectively *all* of the fixed cost. Two caches, and
 * the thing to notice is that **neither can go stale**:
 *
 *  - `stockCache` — `STOCK_RAW` is inlined at build time and is immutable for
 *    the life of the process, so its 10 YAML parses are pure waste on call 2
 *    onward. On a project with no user types they were 100% of the work,
 *    repeated on every `api.types.list()`.
 *  - `userParseCache` — keyed on the file's **content**, not its path or its
 *    mtime. `parseType` is pure, so identical bytes provably yield an identical
 *    result; a cache hit is indistinguishable from a re-parse. An mtime/size
 *    key would be ~4x faster again (it could skip the `readFile` too) and was
 *    rejected for exactly that reason: same-millisecond same-size edits exist,
 *    and "the catalog is always what's on disk" is worth more here than the
 *    remaining microseconds.
 *
 * Measured over 200 steady-state calls, user types → ms/call before → after:
 * 0 → 1.371 → 0.091 (15x); 10 → 2.471 → 0.709 (3.5x); 50 → 6.921 → 3.026;
 * 200 → 23.327 → 12.753. The remainder is the `readFile` walk, kept on purpose.
 * The gate is the parse COUNT in `tests/main/types/loader-parse-cache.test.ts`,
 * not these timings (#2229) — they are here to say what was traded for what.
 *
 * The test-isolation promise above therefore survives intact: content-keying
 * means a temp `rootPath` reusing a previous test's path still parses its own
 * bytes. `_clearTypeParseCachesForTests()` exists only so the cache-behaviour
 * tests can observe a cold process, not because correctness needs it.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  type TypeCatalog,
  type TypeDef,
  type TypeLoadError,
} from '../../shared/objects/type-def';
import { parseType, type ParseTypeResult } from './parse';

// Stock types inlined into the main bundle at build time (query:'?raw').
const STOCK_RAW = import.meta.glob('./stock/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Reserved in-tree home for user-authored types. */
export function userTypesDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'types');
}

/**
 * `loadTypeCatalog` MUTATES the defs it is handed — the parent-validation pass
 * below clears `t.parent` in place on a dangling ref — and callers go on to
 * hold the result on `GraphState.typeCatalog`. A memoized parse must therefore
 * hand out a private copy per call, or one project's bad `parent:` would erase
 * the field for every subsequent caller in the process. `TypeDef` is plain
 * JSON-shaped data (strings, string arrays, a `PropertyDef[]`), so
 * `structuredClone` is both exact and cheap relative to a YAML parse.
 */
function cloneDefs(defs: readonly TypeDef[]): TypeDef[] {
  return defs.map((d) => structuredClone(d));
}

/** Parsed once per process — see the "Parse memoization" note in the header. */
let stockCache: { types: TypeDef[]; errors: TypeLoadError[] } | null = null;

/** `content` → the parse of exactly those bytes. Keyed by content, not path:
 *  `parseType` is pure, so a hit is provably the same answer a re-parse would
 *  give. Bounded at one entry per distinct type file in `.minerva/types/`,
 *  because each `loadUser` call rebuilds its directory's map from the listing
 *  it just read — a deleted or rewritten file's entry drops out with it. */
const userParseCache = new Map<string, Map<string, { content: string; result: ParseTypeResult }>>();

/** Test-only (#1944 convention): drop both memos so a test can observe the
 *  cold-process parse counts. Not needed for correctness — see the header. */
export function _clearTypeParseCachesForTests(): void {
  stockCache = null;
  userParseCache.clear();
}

function loadStock(): { types: TypeDef[]; errors: TypeLoadError[] } {
  if (!stockCache) {
    const types: TypeDef[] = [];
    const errors: TypeLoadError[] = [];
    for (const [key, content] of Object.entries(STOCK_RAW)) {
      const r = parseType(content, 'stock', key);
      if (r.type) types.push(r.type);
      else for (const message of r.errors) errors.push({ source: 'stock', filePath: key, label: r.label, message });
    }
    stockCache = { types, errors };
  }
  return { types: cloneDefs(stockCache.types), errors: stockCache.errors.slice() };
}

async function loadUser(dir: string): Promise<{ types: TypeDef[]; errors: TypeLoadError[] }> {
  const types: TypeDef[] = [];
  const errors: TypeLoadError[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // The whole directory is gone — drop its memo rather than leave entries
      // for files that no longer exist pinned for the life of the process.
      userParseCache.delete(dir);
      return { types, errors };
    }
    throw e;
  }
  const prev = userParseCache.get(dir);
  const next = new Map<string, { content: string; result: ParseTypeResult }>();
  for (const ent of entries) {
    // A flat listing of `.minerva/types/`, not a recursive walk of the
    // thoughtbase root — there's no directory to recurse into here, so the
    // project-tree ignore policy (`shared/ignored-dirs.ts`) doesn't apply.
    if (ent.name.startsWith('.')) continue;
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.md')) continue;
    const fp = path.join(dir, ent.name);
    const content = await fs.readFile(fp, 'utf-8');
    const cached = prev?.get(fp);
    const r = cached?.content === content ? cached.result : parseType(content, 'user', fp);
    next.set(fp, { content, result: r });
    // The cached `ParseTypeResult` is shared across calls, so clone the def out
    // of it for the same reason `loadStock` does — the parent pass mutates.
    if (r.type) types.push(structuredClone(r.type));
    else for (const message of r.errors) errors.push({ source: 'user', filePath: fp, label: r.label, message });
  }
  userParseCache.set(dir, next);
  return { types, errors };
}

/**
 * Build the per-project type catalog. Stock loads first and wins id collisions;
 * a user type colliding with stock (or an earlier user type) is rejected with an
 * error. `rootPath` locates the in-tree user types.
 */
export async function loadTypeCatalog(rootPath: string): Promise<TypeCatalog> {
  const stock = loadStock();
  const user = await loadUser(userTypesDir(rootPath));

  const byId = new Map<string, TypeDef>();
  const errors: TypeLoadError[] = [...stock.errors, ...user.errors];

  for (const t of stock.types) {
    if (byId.has(t.id)) {
      errors.push({ source: 'stock', filePath: t.filePath, label: t.label, message: `duplicate stock type id "${t.id}"` });
      continue;
    }
    byId.set(t.id, t);
  }
  for (const t of user.types) {
    const existing = byId.get(t.id);
    if (existing && existing.source === 'stock') {
      // A local customization of a stock type — the in-tree file wins, and the
      // stock definition stays available underneath to revert to.
      byId.set(t.id, { ...t, overridesStock: true });
      continue;
    }
    if (existing) {
      // Two user files claiming the same id is a genuine mistake: there's no
      // "underneath" to fall back to, so first-loaded wins and we say so.
      errors.push({ source: 'user', filePath: t.filePath, label: t.label, message: `duplicate user type id "${t.id}"` });
      continue;
    }
    byId.set(t.id, t);
  }

  // Validate parent refs now that every type id is known (#1586). An unknown or
  // self parent is soft-flagged and cleared so nothing materializes a dangling
  // `rdfs:subClassOf`. (Cycles are left alone — SPARQL property paths handle
  // them; single inheritance keeps them rare.)
  for (const t of byId.values()) {
    if (!t.parent) continue;
    if (t.parent === t.id) {
      errors.push({ source: t.source, filePath: t.filePath, label: t.label, message: `a type can't be its own parent` });
      t.parent = undefined;
    } else if (!byId.has(t.parent)) {
      errors.push({ source: t.source, filePath: t.filePath, label: t.label, message: `parent type "${t.parent}" does not exist` });
      t.parent = undefined;
    }
  }

  return { types: [...byId.values()], errors };
}
