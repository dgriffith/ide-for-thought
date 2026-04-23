import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export interface SavedQuery {
  id: string;       // filename without extension
  name: string;
  description: string;
  query: string;
  scope: 'project' | 'global';
  filePath: string;  // absolute path for deletion
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

/** Parse query content string into metadata + body (pure, no I/O) */
export function parseQueryContent(content: string, id: string, scope: 'project' | 'global'): Omit<SavedQuery, 'filePath'> {
  let name = id;
  let description = '';

  const nameMatch = content.match(/^#\s*@name\s+(.+)$/m);
  if (nameMatch) name = nameMatch[1].trim();
  const descMatch = content.match(/^#\s*@description\s+(.+)$/m);
  if (descMatch) description = descMatch[1].trim();

  const query = content
    .split('\n')
    .filter((line) => !line.match(/^#\s*@(name|description)\s/))
    .join('\n')
    .trim();

  return { id, name, description, query, scope };
}

function parseQueryFile(filePath: string, scope: 'project' | 'global'): SavedQuery {
  const content = fs.readFileSync(filePath, 'utf-8');
  const id = path.basename(filePath, '.rq');
  return { ...parseQueryContent(content, id, scope), filePath };
}

export function serializeQuery(name: string, description: string, query: string): string {
  const lines = [`# @name ${name}`];
  if (description) lines.push(`# @description ${description}`);
  lines.push('', query.trim(), '');
  return lines.join('\n');
}

export function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function listDir(dir: string, scope: 'project' | 'global'): SavedQuery[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.rq'))
      .map((f) => parseQueryFile(path.join(dir, f), scope))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function listSavedQueries(rootPath: string | null): SavedQuery[] {
  const global = listDir(globalQueriesDir(), 'global');
  const project = rootPath ? listDir(projectQueriesDir(rootPath), 'project') : [];
  return [...project, ...global];
}

export function saveQuery(
  rootPath: string | null,
  scope: 'project' | 'global',
  name: string,
  description: string,
  query: string,
): SavedQuery {
  const dir = scope === 'project' && rootPath
    ? projectQueriesDir(rootPath)
    : globalQueriesDir();

  ensureDir(dir);
  const filename = sanitizeFilename(name) + '.rq';
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, serializeQuery(name, description, query), 'utf-8');

  return { id: sanitizeFilename(name), name, description, query, scope, filePath };
}

export function deleteQuery(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch { /* already gone */ }
}

export function renameQuery(filePath: string, newName: string): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  const id = path.basename(filePath, '.rq');
  // We need the description + query body but a fresh name — reuse the parser
  // rather than hand-rolling header edits that miss edge cases like a missing
  // description line.
  const scope: 'project' | 'global' = filePath.includes(`${path.sep}.minerva${path.sep}queries${path.sep}`)
    ? 'project'
    : 'global';
  const parsed = parseQueryContent(content, id, scope);
  const newFilename = sanitizeFilename(newName) + '.rq';
  const newPath = path.join(path.dirname(filePath), newFilename);
  const rewritten = serializeQuery(newName, parsed.description, parsed.query);
  fs.writeFileSync(newPath, rewritten, 'utf-8');
  if (newPath !== filePath) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  return newPath;
}
