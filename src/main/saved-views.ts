/**
 * Saved views (#1072) — a named preset over a type's multi-view (#1070): its
 * mode (list/table/gallery), sort, and visible columns. Persistence mirrors
 * `saved-queries.ts` per the #1061 decision ("a config entry, not a note"):
 * one file per view, project scope under `.minerva/views/` (travels with the
 * thoughtbase) or global under userData. Stored as JSON — a view is structured
 * config, not a query body, so JSON beats a header-comment format.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SavedView, SavedViewInput, ViewLayout, ViewScope } from '../shared/types';

export type { SavedView, SavedViewInput, ViewLayout, ViewScope } from '../shared/types';

function globalViewsDir(): string {
  return path.join(app.getPath('userData'), 'views');
}
function projectViewsDir(rootPath: string): string {
  return path.join(rootPath, '.minerva', 'views');
}
function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function sanitizeFilename(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

/** Project views live under `.minerva/views/`; everything else is global. */
function scopeFromPath(filePath: string): ViewScope {
  return filePath.includes(`${path.sep}.minerva${path.sep}views${path.sep}`) ? 'project' : 'global';
}

const LAYOUTS: ViewLayout[] = ['list', 'table', 'gallery'];

/** Coerce arbitrary JSON into a SavedViewInput, defaulting anything malformed
 *  (house UX: a hand-edited file never crashes the list). */
export function normalizeViewJson(raw: unknown, fallbackName: string): SavedViewInput {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const layout = LAYOUTS.includes(o.layout as ViewLayout) ? (o.layout as ViewLayout) : 'table';
  const columns = Array.isArray(o.columns) ? o.columns.filter((c): c is string => typeof c === 'string') : null;
  return {
    name: typeof o.name === 'string' && o.name.trim() ? o.name : fallbackName,
    typeId: typeof o.typeId === 'string' ? o.typeId : '',
    layout,
    sortColumn: typeof o.sortColumn === 'string' ? o.sortColumn : null,
    sortDir: o.sortDir === 'desc' ? 'desc' : 'asc',
    columns,
    order: typeof o.order === 'number' ? o.order : null,
  };
}

export function serializeView(input: SavedViewInput): string {
  const body: Record<string, unknown> = {
    name: input.name,
    typeId: input.typeId,
    layout: input.layout,
    sortColumn: input.sortColumn,
    sortDir: input.sortDir,
    columns: input.columns,
  };
  if (input.order != null) body.order = input.order;
  return JSON.stringify(body, null, 2) + '\n';
}

function parseViewFile(filePath: string, scope: ViewScope): SavedView {
  const id = path.basename(filePath, '.json');
  let raw: unknown = {};
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    /* malformed → normalized to defaults below */
  }
  const input = normalizeViewJson(raw, id);
  return {
    id,
    name: input.name,
    typeId: input.typeId,
    layout: input.layout,
    sortColumn: input.sortColumn,
    sortDir: input.sortDir,
    columns: input.columns,
    scope,
    filePath,
    order: input.order ?? null,
  };
}

function listDir(dir: string, scope: ViewScope): SavedView[] {
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => parseViewFile(path.join(dir, f), scope));
  } catch {
    return [];
  }
}

/** Explicit `order` first (ascending), then alphabetical by name. */
function compareViews(a: SavedView, b: SavedView): number {
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

export function listSavedViews(rootPath: string | null): SavedView[] {
  const global = listDir(globalViewsDir(), 'global').sort(compareViews);
  const project = rootPath ? listDir(projectViewsDir(rootPath), 'project').sort(compareViews) : [];
  return [...project, ...global];
}

export function saveView(rootPath: string | null, scope: ViewScope, input: SavedViewInput): SavedView {
  const dir = scope === 'project' && rootPath ? projectViewsDir(rootPath) : globalViewsDir();
  ensureDir(dir);
  const id = sanitizeFilename(input.name) || 'view';
  const filePath = path.join(dir, `${id}.json`);
  fs.writeFileSync(filePath, serializeView(input), 'utf-8');
  return {
    id,
    name: input.name,
    typeId: input.typeId,
    layout: input.layout,
    sortColumn: input.sortColumn,
    sortDir: input.sortDir,
    columns: input.columns,
    scope,
    filePath,
    order: input.order ?? null,
  };
}

export function deleteView(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* already gone */
  }
}

export function renameView(filePath: string, newName: string): string {
  const input = normalizeViewJson(JSON.parse(fs.readFileSync(filePath, 'utf-8')), path.basename(filePath, '.json'));
  input.name = newName;
  const newPath = path.join(path.dirname(filePath), `${sanitizeFilename(newName) || 'view'}.json`);
  fs.writeFileSync(newPath, serializeView(input), 'utf-8');
  if (newPath !== filePath) {
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  }
  return newPath;
}

/** Apply a new ordering across many views at once (drag-to-reorder produces one
 *  "here's the new sequence" payload — mirrors setQueryOrder). */
export function setViewOrder(entries: Array<{ filePath: string; order: number | null }>): void {
  for (const { filePath, order } of entries) {
    let parsed: unknown;
    try { parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { continue; }
    const input = normalizeViewJson(parsed, path.basename(filePath, '.json'));
    input.order = order;
    fs.writeFileSync(filePath, serializeView(input), 'utf-8');
  }
}

// Re-exported for tests / callers that need the scope heuristic.
export { scopeFromPath };
