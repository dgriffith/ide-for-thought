import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type QueryLanguage = 'sparql' | 'sql';

export interface SavedQuery {
  id: string;       // filename without extension
  name: string;
  description: string;
  query: string;
  language: QueryLanguage;
  scope: 'project' | 'global';
  filePath: string;  // absolute path for deletion
  /** #315 — null = ungrouped. */
  group: string | null;
  /** #315 — null = no explicit position; falls to alphabetical by name. */
  order: number | null;
}

function globalQueriesDir(): string {
  return path.join(app.getPath('userData'), 'queries');
}

function projectQueriesDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'queries');
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Extension is the language signal: `.rq` is the W3C-standard SPARQL
 * extension, `.sql` the de-facto SQL one. Embedding the language in a
 * header comment would be redundant and lets file-manager previews /
 * syntax highlighting work for free.
 */
function extensionFor(language: QueryLanguage): '.rq' | '.sql' {
  return language === 'sql' ? '.sql' : '.rq';
}

function languageFromPath(filePath: string): QueryLanguage {
  return filePath.endsWith('.sql') ? 'sql' : 'sparql';
}

/** Parse query content string into metadata + body (pure, no I/O) */
export function parseQueryContent(
  content: string,
  id: string,
  scope: 'project' | 'global',
  language: QueryLanguage,
): Omit<SavedQuery, 'filePath'> {
  let name = id;
  let description = '';
  let group: string | null = null;
  let order: number | null = null;

  const nameMatch = content.match(/^#\s*@name\s+(.+)$/m);
  if (nameMatch) name = nameMatch[1]!.trim();
  const descMatch = content.match(/^#\s*@description\s+(.+)$/m);
  if (descMatch) description = descMatch[1]!.trim();
  const groupMatch = content.match(/^#\s*@group\s+(.+)$/m);
  if (groupMatch) {
    const g = groupMatch[1]!.trim();
    if (g) group = g;
  }
  const orderMatch = content.match(/^#\s*@order\s+(-?\d+)$/m);
  if (orderMatch) order = parseInt(orderMatch[1]!, 10);

  const query = content
    .split('\n')
    .filter((line) => !line.match(/^#\s*@(name|description|group|order)\s/))
    .join('\n')
    .trim();

  return { id, name, description, query, language, scope, group, order };
}

function parseQueryFile(filePath: string, scope: 'project' | 'global'): SavedQuery {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const id = path.basename(filePath, ext);
  return { ...parseQueryContent(content, id, scope, languageFromPath(filePath)), filePath };
}

export interface SerializeArgs {
  name: string;
  description: string;
  query: string;
  group?: string | null;
  order?: number | null;
}

export function serializeQuery(
  nameOrArgs: string | SerializeArgs,
  description?: string,
  query?: string,
): string {
  // Back-compat overload — older callers passed (name, description, query).
  const args: SerializeArgs = typeof nameOrArgs === 'string'
    ? { name: nameOrArgs, description: description ?? '', query: query ?? '' }
    : nameOrArgs;

  const lines = [`# @name ${args.name}`];
  if (args.description) lines.push(`# @description ${args.description}`);
  if (args.group) lines.push(`# @group ${args.group}`);
  if (args.order != null) lines.push(`# @order ${args.order}`);
  lines.push('', args.query.trim(), '');
  return lines.join('\n');
}

export function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function listDir(dir: string, scope: 'project' | 'global'): SavedQuery[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.rq') || f.endsWith('.sql'))
      .map((f) => parseQueryFile(path.join(dir, f), scope));
  } catch {
    return [];
  }
}

/**
 * Sort comparator for queries inside the same scope.
 * Ungrouped first (group: null), then groups alphabetically.
 * Within a (scope, group) bucket: explicit @order first (ascending),
 * then alphabetical fallback by name.
 */
function compareQueries(a: SavedQuery, b: SavedQuery): number {
  // Ungrouped sorts before any named group.
  if (a.group === null && b.group !== null) return -1;
  if (a.group !== null && b.group === null) return 1;
  if (a.group !== null && b.group !== null) {
    const g = a.group.localeCompare(b.group);
    if (g !== 0) return g;
  }
  // Same bucket — explicit @order beats alphabetical.
  if (a.order != null && b.order != null) {
    if (a.order !== b.order) return a.order - b.order;
  } else if (a.order != null) {
    return -1;
  } else if (b.order != null) {
    return 1;
  }
  return a.name.localeCompare(b.name);
}

// ── Listing cache (#2221) ───────────────────────────────────────────────────
//
// `listSavedQueries` is not a cheap call: two `readdirSync`s plus one
// `readFileSync` per `.rq`/`.sql` file, all synchronous, all on the main
// process's only thread. That was acceptable while the only caller was the
// `QUERIES_LIST` IPC handler — a user action asking for the list. It stopped
// being acceptable once `menu.ts`'s Saved Queries submenu started calling it,
// because `rebuildMenu()` runs on window focus AND on every flip of the
// focused note's `hasSelection` flag (`setMenuEditorState`). Selecting and
// deselecting text is a *continuous* editing gesture, so a user with a dozen
// saved queries was paying ~14 blocking file reads per selection change, and
// the cost grows with however many queries they have saved.
//
// So the listing is memoized. What makes this safe rather than a staleness bug
// waiting to happen is that there are exactly two ways the on-disk set can
// change, and both are covered:
//
//  1. **This app wrote it.** Every mutator below (`saveQuery`, `deleteQuery`,
//     `renameQuery`, `moveQueryScope`, `setQueryGroup`, `setQueryOrder`) calls
//     `invalidateSavedQueriesCache()`. They are the only writers — the
//     `QUERIES_*` registrar goes through this module, and nothing else touches
//     the queries directories.
//  2. **Something outside the app wrote it** — a text editor, a file manager,
//     a sync client. Doing that requires the user to leave Minerva and come
//     back, and `window-manager.ts`'s `focus` handler invalidates on the way
//     back in (see `menu-input-caches.ts`). So an external edit is picked up
//     at exactly the same moment it is today: the first rebuild after focus.
//
// The cache is deliberately ONE entry tagged with its rootPath, not a
// `Map<rootPath, listing>`. Focus invalidates the whole thing anyway, so a map
// would buy nothing but entries for projects that have since been closed —
// which is the shape `tests/architecture/project-state-registered.test.ts`
// (#2240) exists to keep out of `src/main`, and `createProjectStore` isn't
// reachable from here (this module is handed a bare path, not a
// `ProjectContext`). Two windows on two thoughtbases alternate and miss, which
// leaves that configuration exactly where it is today rather than worse.
let listingCache: { key: string; value: SavedQuery[] } | null = null;

/** Drop the memoized `listSavedQueries` result. Called by every mutator in
 *  this module, and on window focus (the only moment an *external* edit can
 *  have landed — see the block comment above). */
export function invalidateSavedQueriesCache(): void {
  listingCache = null;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function listSavedQueries(rootPath: string | null): SavedQuery[] {
  const key = rootPath ?? '';
  // Hand back a copy: callers filter/sort the result (menu.ts does both), and
  // a caller that sorted the cached array in place would silently reorder
  // every later reader's list.
  if (listingCache && listingCache.key === key) return [...listingCache.value];
  const global = listDir(globalQueriesDir(), 'global').sort(compareQueries);
  const project = rootPath ? listDir(projectQueriesDir(rootPath), 'project').sort(compareQueries) : [];
  const value = [...project, ...global];
  listingCache = { key, value };
  return [...value];
}

export function saveQuery(
  rootPath: string | null,
  scope: 'project' | 'global',
  name: string,
  description: string,
  query: string,
  language: QueryLanguage,
  group: string | null = null,
): SavedQuery {
  // Refuse rather than quietly demote (#1877). Falling back to the global
  // directory here wrote the file somewhere the user didn't ask for AND
  // returned `scope: 'project'` below, so the list showed it under Thoughtbase
  // scope while the file followed them into every other thoughtbase.
  // `moveQueryScope` already refuses the identical condition; these two should
  // not disagree about what's possible.
  if (scope === 'project' && !rootPath) {
    throw new Error('Cannot save to Thoughtbase scope: no project open.');
  }

  const dir = rootPath && scope === 'project'
    ? projectQueriesDir(rootPath)
    : globalQueriesDir();

  ensureDir(dir);
  const filename = sanitizeFilename(name) + extensionFor(language);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, serializeQuery({ name, description, query, group }), 'utf-8');
  invalidateSavedQueriesCache();

  return {
    id: sanitizeFilename(name),
    name,
    description,
    query,
    language,
    scope,
    filePath,
    group,
    order: null,
  };
}

export function deleteQuery(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch { /* already gone */ }
  // Outside the try: "already gone" still means the cached listing — which may
  // well still contain it — has to be rebuilt.
  invalidateSavedQueriesCache();
}

export function renameQuery(filePath: string, newName: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const id = path.basename(filePath, ext);
  const scope = scopeFromPath(filePath);
  const parsed = parseQueryContent(content, id, scope, languageFromPath(filePath));
  // Preserve the original extension — language doesn't change on rename.
  const newFilename = sanitizeFilename(newName) + ext;
  const newPath = path.join(path.dirname(filePath), newFilename);
  const rewritten = serializeQuery({
    name: newName,
    description: parsed.description,
    query: parsed.query,
    group: parsed.group,
    order: parsed.order,
  });
  fs.writeFileSync(newPath, rewritten, 'utf-8');
  if (newPath !== filePath) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  invalidateSavedQueriesCache();
  return newPath;
}

/**
 * Move a query between scopes (#314). Source is removed, destination
 * is written. On filename collision in the destination, append `-2`,
 * `-3`, etc. up to `-99` before giving up.
 */
export function moveQueryScope(
  filePath: string,
  newScope: 'project' | 'global',
  rootPath: string | null,
): string {
  const ext = path.extname(filePath);
  const baseName = path.basename(filePath, ext);
  const content = fs.readFileSync(filePath, 'utf-8');

  const destDir = newScope === 'project' && rootPath
    ? projectQueriesDir(rootPath)
    : globalQueriesDir();
  if (newScope === 'project' && !rootPath) {
    throw new Error('Cannot move to Thoughtbase scope: no project open.');
  }
  ensureDir(destDir);

  let newPath = path.join(destDir, baseName + ext);
  let suffix = 2;
  while (fs.existsSync(newPath)) {
    if (suffix > 99) throw new Error(`Move failed: 99 collisions on ${baseName}`);
    newPath = path.join(destDir, `${baseName}-${suffix}${ext}`);
    suffix++;
  }
  fs.writeFileSync(newPath, content, 'utf-8');
  try { fs.unlinkSync(filePath); } catch { /* already gone */ }
  invalidateSavedQueriesCache();
  return newPath;
}

/** Set the @group line on an existing query (#315). null clears it. */
export function setQueryGroup(filePath: string, group: string | null): void {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath);
  const id = path.basename(filePath, ext);
  const parsed = parseQueryContent(content, id, scopeFromPath(filePath), languageFromPath(filePath));
  fs.writeFileSync(filePath, serializeQuery({
    name: parsed.name,
    description: parsed.description,
    query: parsed.query,
    group: group && group.trim() ? group.trim() : null,
    order: parsed.order,
  }), 'utf-8');
  invalidateSavedQueriesCache();
}

/**
 * Apply a new ordering across many queries at once (#315). `entries` is
 * a list of `{ filePath, order }` — we re-write each file with its new
 * @order line. Useful for drag-to-reorder which produces a single
 * "here's the new sequence" payload.
 */
export function setQueryOrder(entries: Array<{ filePath: string; order: number | null }>): void {
  for (const { filePath, order } of entries) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const ext = path.extname(filePath);
    const id = path.basename(filePath, ext);
    const parsed = parseQueryContent(content, id, scopeFromPath(filePath), languageFromPath(filePath));
    fs.writeFileSync(filePath, serializeQuery({
      name: parsed.name,
      description: parsed.description,
      query: parsed.query,
      group: parsed.group,
      order,
    }), 'utf-8');
  }
  invalidateSavedQueriesCache();
}

/** Heuristic: project queries live under `.minerva/queries/`, global don't. */
function scopeFromPath(filePath: string): 'project' | 'global' {
  return filePath.includes(`${path.sep}.minerva${path.sep}queries${path.sep}`)
    ? 'project'
    : 'global';
}
