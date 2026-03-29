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

function parseQueryFile(filePath: string, scope: 'project' | 'global'): SavedQuery {
  const content = fs.readFileSync(filePath, 'utf-8');
  const id = path.basename(filePath, '.rq');

  let name = id;
  let description = '';

  // Parse comment header
  const nameMatch = content.match(/^#\s*@name\s+(.+)$/m);
  if (nameMatch) name = nameMatch[1].trim();
  const descMatch = content.match(/^#\s*@description\s+(.+)$/m);
  if (descMatch) description = descMatch[1].trim();

  // Strip the metadata comments to get the query body
  const query = content
    .split('\n')
    .filter((line) => !line.match(/^#\s*@(name|description)\s/))
    .join('\n')
    .trim();

  return { id, name, description, query, scope, filePath };
}

function serializeQuery(name: string, description: string, query: string): string {
  const lines = [`# @name ${name}`];
  if (description) lines.push(`# @description ${description}`);
  lines.push('', query.trim(), '');
  return lines.join('\n');
}

function sanitizeFilename(name: string): string {
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
