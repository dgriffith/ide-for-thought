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
  if (nameMatch) name = nameMatch[1].trim();
  const descMatch = content.match(/^#\s*@description\s+(.+)$/m);
  if (descMatch) description = descMatch[1].trim();
  const groupMatch = content.match(/^#\s*@group\s+(.+)$/m);
  if (groupMatch) {
    const g = groupMatch[1].trim();
    if (g) group = g;
  }
  const orderMatch = content.match(/^#\s*@order\s+(-?\d+)$/m);
  if (orderMatch) order = parseInt(orderMatch[1], 10);

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

// ── Public API ──────────────────────────────────────────────────────────────

export function listSavedQueries(rootPath: string | null): SavedQuery[] {
  const global = listDir(globalQueriesDir(), 'global').sort(compareQueries);
  const project = rootPath ? listDir(projectQueriesDir(rootPath), 'project').sort(compareQueries) : [];
  return [...project, ...global];
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
  const dir = scope === 'project' && rootPath
    ? projectQueriesDir(rootPath)
    : globalQueriesDir();

  ensureDir(dir);
  const filename = sanitizeFilename(name) + extensionFor(language);
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, serializeQuery({ name, description, query, group }), 'utf-8');

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
}

/** Heuristic: project queries live under `.minerva/queries/`, global don't. */
function scopeFromPath(filePath: string): 'project' | 'global' {
  return filePath.includes(`${path.sep}.minerva${path.sep}queries${path.sep}`)
    ? 'project'
    : 'global';
}
