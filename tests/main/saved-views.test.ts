/**
 * Saved-views store (#1072): CRUD + scope + reorder, and that a saved view
 * round-trips its full projection (mode, sort, columns). Mirrors the
 * saved-queries persistence pattern per #1061.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { userDataDir } = vi.hoisted(() => ({ userDataDir: { value: '' } }));
vi.mock('electron', () => ({
  app: { getPath: (k: string) => (k === 'userData' ? userDataDir.value : '') },
}));

import {
  sanitizeFilename,
  saveView,
  listSavedViews,
  renameView,
  deleteView,
  setViewOrder,
  type SavedViewInput,
} from '../../src/main/saved-views';

let root: string;
let userData: string;

function input(over: Partial<SavedViewInput> = {}): SavedViewInput {
  return {
    name: 'Reading list',
    typeId: 'book',
    layout: 'table',
    sortColumn: 'rating',
    sortDir: 'desc',
    columns: ['author', 'rating'],
    ...over,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-views-root-'));
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-views-ud-'));
  userDataDir.value = userData;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('sanitizeFilename', () => {
  it('lowercases and hyphenates', () => {
    expect(sanitizeFilename('Reading List!')).toBe('reading-list');
  });
});

describe('saved views: persistence (#1072)', () => {
  it('saves a project view under .minerva/views and round-trips every field', () => {
    const saved = saveView(root, 'project', input());
    expect(saved.scope).toBe('project');
    expect(saved.filePath).toContain(path.join('.minerva', 'views'));
    expect(fs.existsSync(saved.filePath)).toBe(true);

    const [got] = listSavedViews(root);
    expect(got).toMatchObject({
      name: 'Reading list',
      typeId: 'book',
      layout: 'table',
      sortColumn: 'rating',
      sortDir: 'desc',
      columns: ['author', 'rating'],
      scope: 'project',
    });
  });

  it('saves a global view under userData and lists project-then-global', () => {
    saveView(root, 'global', input({ name: 'All books' }));
    saveView(root, 'project', input({ name: 'Reading list' }));
    const views = listSavedViews(root);
    expect(views.map((v) => v.scope)).toEqual(['project', 'global']); // project first
    expect(views.find((v) => v.scope === 'global')!.filePath).toContain(userData);
  });

  it('renames a view (and moves its file)', () => {
    const saved = saveView(root, 'project', input({ name: 'Old name' }));
    const newPath = renameView(saved.filePath, 'New name');
    expect(fs.existsSync(saved.filePath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);
    const [got] = listSavedViews(root);
    expect(got!.name).toBe('New name');
    expect(got!.typeId).toBe('book'); // other fields preserved
  });

  it('deletes a view', () => {
    const saved = saveView(root, 'project', input());
    deleteView(saved.filePath);
    expect(listSavedViews(root)).toHaveLength(0);
  });

  it('reorders views by explicit order', () => {
    const a = saveView(root, 'project', input({ name: 'Alpha' }));
    const b = saveView(root, 'project', input({ name: 'Beta' }));
    // Alphabetical by default: Alpha, Beta.
    expect(listSavedViews(root).map((v) => v.name)).toEqual(['Alpha', 'Beta']);
    // Force Beta first.
    setViewOrder([{ filePath: b.filePath, order: 0 }, { filePath: a.filePath, order: 1 }]);
    expect(listSavedViews(root).map((v) => v.name)).toEqual(['Beta', 'Alpha']);
  });

  it('tolerates a malformed view file (defaults, never throws)', () => {
    const dir = path.join(root, '.minerva', 'views');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json', 'utf-8');
    const views = listSavedViews(root);
    expect(views).toHaveLength(1);
    expect(views[0]!.layout).toBe('table'); // default
  });
});
