import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// electron's `app.getPath('userData')` backs the global-queries dir;
// hand it a per-test temp so `listSavedQueries` / `moveQueryScope` /
// `saveQuery(global)` write somewhere we can clean up without touching
// the real user data.
const { userDataDir } = vi.hoisted(() => ({
  userDataDir: { value: '' },
}));
vi.mock('electron', () => ({
  app: { getPath: (k: string) => k === 'userData' ? userDataDir.value : '' },
}));

import {
  sanitizeFilename,
  parseQueryContent,
  serializeQuery,
  saveQuery,
  listSavedQueries,
  moveQueryScope,
  setQueryGroup,
  setQueryOrder,
  renameQuery,
} from '../../src/main/saved-queries';

describe('sanitizeFilename', () => {
  it('lowercases and replaces special chars with hyphens', () => {
    expect(sanitizeFilename('My Cool Query!')).toBe('my-cool-query');
  });

  it('strips leading/trailing hyphens', () => {
    expect(sanitizeFilename('--test--')).toBe('test');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(60);
  });

  it('handles spaces and mixed chars', () => {
    expect(sanitizeFilename('All Notes & Tags')).toBe('all-notes-tags');
  });
});

describe('parseQueryContent', () => {
  it('extracts @name from comment header', () => {
    const content = '# @name My Query\nSELECT * WHERE {}';
    const result = parseQueryContent(content, 'fallback-id', 'project', 'sparql');
    expect(result.name).toBe('My Query');
  });

  it('extracts @description', () => {
    const content = '# @name Test\n# @description A test query\nSELECT ?x WHERE {}';
    const result = parseQueryContent(content, 'id', 'project', 'sparql');
    expect(result.description).toBe('A test query');
  });

  it('uses id as name when @name is missing', () => {
    const content = 'SELECT * WHERE {}';
    const result = parseQueryContent(content, 'my-fallback', 'global', 'sparql');
    expect(result.name).toBe('my-fallback');
  });

  it('strips metadata comments from query body', () => {
    const content = '# @name Test\n# @description Desc\nSELECT ?x WHERE {}';
    const result = parseQueryContent(content, 'id', 'project', 'sparql');
    expect(result.query).toBe('SELECT ?x WHERE {}');
    expect(result.query).not.toContain('@name');
  });

  it('preserves scope', () => {
    const result = parseQueryContent('query', 'id', 'global', 'sparql');
    expect(result.scope).toBe('global');
  });

  it('captures language passed in by caller (derived from extension)', () => {
    const result = parseQueryContent('SELECT 1', 'id', 'project', 'sql');
    expect(result.language).toBe('sql');
  });
});

describe('serializeQuery', () => {
  it('includes @name header', () => {
    const result = serializeQuery('Test', '', 'SELECT ?x WHERE {}');
    expect(result).toContain('# @name Test');
  });

  it('includes @description when non-empty', () => {
    const result = serializeQuery('Test', 'A description', 'SELECT ?x');
    expect(result).toContain('# @description A description');
  });

  it('omits @description when empty', () => {
    const result = serializeQuery('Test', '', 'SELECT ?x');
    expect(result).not.toContain('@description');
  });

  it('round-trips with parseQueryContent', () => {
    const serialized = serializeQuery('My Query', 'Desc', 'SELECT ?x WHERE { ?x a ?y }');
    const parsed = parseQueryContent(serialized, 'id', 'project', 'sparql');
    expect(parsed.name).toBe('My Query');
    expect(parsed.description).toBe('Desc');
    expect(parsed.query).toBe('SELECT ?x WHERE { ?x a ?y }');
    expect(parsed.language).toBe('sparql');
  });
});

describe('group + order metadata (#315)', () => {
  it('parses # @group from header', () => {
    const content = '# @name Q\n# @group Tags\nSELECT ?x WHERE {}';
    const r = parseQueryContent(content, 'id', 'project', 'sparql');
    expect(r.group).toBe('Tags');
  });

  it('parses # @order as integer (negative allowed)', () => {
    const content = '# @name Q\n# @order -3\nSELECT ?x';
    const r = parseQueryContent(content, 'id', 'project', 'sparql');
    expect(r.order).toBe(-3);
  });

  it('group/order absent → null', () => {
    const r = parseQueryContent('# @name Q\nSELECT 1', 'id', 'global', 'sparql');
    expect(r.group).toBeNull();
    expect(r.order).toBeNull();
  });

  it('strips @group/@order lines from query body', () => {
    const content = '# @name Q\n# @group X\n# @order 2\nSELECT ?x';
    const r = parseQueryContent(content, 'id', 'project', 'sparql');
    expect(r.query).toBe('SELECT ?x');
  });

  it('serializes @group when set, omits when null', () => {
    expect(serializeQuery({ name: 'A', description: '', query: 'q', group: 'G' })).toContain('# @group G');
    expect(serializeQuery({ name: 'A', description: '', query: 'q', group: null })).not.toContain('@group');
  });

  it('serializes @order when set (including 0), omits when null', () => {
    expect(serializeQuery({ name: 'A', description: '', query: 'q', order: 0 })).toContain('# @order 0');
    expect(serializeQuery({ name: 'A', description: '', query: 'q', order: 5 })).toContain('# @order 5');
    expect(serializeQuery({ name: 'A', description: '', query: 'q', order: null })).not.toContain('@order');
  });

  it('round-trips group + order through parse/serialize', () => {
    const ttl = serializeQuery({
      name: 'My Query',
      description: 'Desc',
      query: 'SELECT ?x',
      group: 'Provenance',
      order: 7,
    });
    const r = parseQueryContent(ttl, 'id', 'project', 'sparql');
    expect(r.name).toBe('My Query');
    expect(r.description).toBe('Desc');
    expect(r.group).toBe('Provenance');
    expect(r.order).toBe(7);
    expect(r.query).toBe('SELECT ?x');
  });
});

describe('saved-queries integration (#313/#314/#315)', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-saved-queries-'));
    userDataDir.value = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-userdata-'));
  });

  afterEach(async () => {
    await fsp.rm(projectRoot, { recursive: true, force: true });
    await fsp.rm(userDataDir.value, { recursive: true, force: true });
  });

  it('saveQuery routes to project dir when scope=project + project open', () => {
    const q = saveQuery(projectRoot, 'project', 'P', '', 'SELECT 1', 'sparql');
    expect(q.filePath).toBe(path.join(projectRoot, '.minerva', 'queries', 'p.rq'));
    expect(fs.existsSync(q.filePath)).toBe(true);
  });

  it('saveQuery falls back to global dir when project is null', () => {
    const q = saveQuery(null, 'project', 'P', '', 'SELECT 1', 'sparql');
    expect(q.filePath.startsWith(userDataDir.value)).toBe(true);
  });

  it('saveQuery preserves @group on disk', () => {
    const q = saveQuery(projectRoot, 'project', 'P', '', 'SELECT 1', 'sparql', 'Tags');
    const content = fs.readFileSync(q.filePath, 'utf-8');
    expect(content).toContain('# @group Tags');
  });

  describe('listSavedQueries sort order (#315)', () => {
    it('ungrouped queries come before grouped, sorted by name within bucket', () => {
      saveQuery(projectRoot, 'project', 'Beta', '', 'q', 'sparql');
      saveQuery(projectRoot, 'project', 'Alpha', '', 'q', 'sparql');
      saveQuery(projectRoot, 'project', 'GammaInGroup', '', 'q', 'sparql', 'X');
      saveQuery(projectRoot, 'project', 'AlphaInGroup', '', 'q', 'sparql', 'X');
      const list = listSavedQueries(projectRoot).filter((q) => q.scope === 'project');
      expect(list.map((q) => q.name)).toEqual(['Alpha', 'Beta', 'AlphaInGroup', 'GammaInGroup']);
    });

    it('explicit @order beats alphabetical inside a bucket', () => {
      const a = saveQuery(projectRoot, 'project', 'Apple', '', 'q', 'sparql');
      const b = saveQuery(projectRoot, 'project', 'Banana', '', 'q', 'sparql');
      const c = saveQuery(projectRoot, 'project', 'Cherry', '', 'q', 'sparql');
      // Reverse the alphabetical order via @order.
      setQueryOrder([
        { filePath: c.filePath, order: 0 },
        { filePath: b.filePath, order: 1 },
        { filePath: a.filePath, order: 2 },
      ]);
      const list = listSavedQueries(projectRoot).filter((q) => q.scope === 'project');
      expect(list.map((q) => q.name)).toEqual(['Cherry', 'Banana', 'Apple']);
    });

    it('groups within a scope are sorted alphabetically', () => {
      saveQuery(projectRoot, 'project', 'Q1', '', 'q', 'sparql', 'Zoo');
      saveQuery(projectRoot, 'project', 'Q2', '', 'q', 'sparql', 'Aardvark');
      const list = listSavedQueries(projectRoot).filter((q) => q.scope === 'project');
      expect(list.map((q) => q.group)).toEqual(['Aardvark', 'Zoo']);
    });

    it('project queries come before global queries in the combined listing', () => {
      saveQuery(projectRoot, 'project', 'P', '', 'q', 'sparql');
      saveQuery(null, 'global', 'G', '', 'q', 'sparql');
      const list = listSavedQueries(projectRoot);
      expect(list.map((q) => q.scope)).toEqual(['project', 'global']);
    });
  });

  describe('moveQueryScope (#314)', () => {
    it('project → global moves the file to the global dir', () => {
      const q = saveQuery(projectRoot, 'project', 'Mover', '', 'SELECT 1', 'sparql');
      const newPath = moveQueryScope(q.filePath, 'global', projectRoot);
      expect(newPath.startsWith(userDataDir.value)).toBe(true);
      expect(fs.existsSync(newPath)).toBe(true);
      expect(fs.existsSync(q.filePath)).toBe(false);
    });

    it('global → project moves the file under .minerva/queries/', () => {
      const q = saveQuery(null, 'global', 'Mover', '', 'SELECT 1', 'sparql');
      const newPath = moveQueryScope(q.filePath, 'project', projectRoot);
      expect(newPath).toBe(path.join(projectRoot, '.minerva', 'queries', 'mover.rq'));
      expect(fs.existsSync(q.filePath)).toBe(false);
    });

    it('throws when moving to project but no project is open', () => {
      const q = saveQuery(null, 'global', 'Stuck', '', 'q', 'sparql');
      expect(() => moveQueryScope(q.filePath, 'project', null)).toThrow(/no project open/);
    });

    it('appends -2, -3 on filename collision in destination', () => {
      // Pre-populate the destination with a same-name file.
      saveQuery(null, 'global', 'Dup', '', 'existing-content', 'sparql');
      const src = saveQuery(projectRoot, 'project', 'Dup', '', 'src-content', 'sparql');
      const newPath = moveQueryScope(src.filePath, 'global', projectRoot);
      expect(path.basename(newPath)).toBe('dup-2.rq');
      // Original same-name global file untouched.
      expect(fs.readFileSync(path.join(userDataDir.value, 'queries', 'dup.rq'), 'utf-8'))
        .toContain('existing-content');
    });

    it('preserves @group + @order across the move', () => {
      const src = saveQuery(projectRoot, 'project', 'WithMeta', '', 'q', 'sparql', 'GroupName');
      setQueryOrder([{ filePath: src.filePath, order: 5 }]);
      const newPath = moveQueryScope(src.filePath, 'global', projectRoot);
      const content = fs.readFileSync(newPath, 'utf-8');
      expect(content).toContain('# @group GroupName');
      expect(content).toContain('# @order 5');
    });
  });

  describe('setQueryGroup (#315)', () => {
    it('writes a new @group line', () => {
      const q = saveQuery(projectRoot, 'project', 'NoGroup', '', 'q', 'sparql');
      setQueryGroup(q.filePath, 'NewGroup');
      expect(fs.readFileSync(q.filePath, 'utf-8')).toContain('# @group NewGroup');
    });

    it('clearing the group strips the @group line', () => {
      const q = saveQuery(projectRoot, 'project', 'WasGrouped', '', 'q', 'sparql', 'Old');
      setQueryGroup(q.filePath, null);
      expect(fs.readFileSync(q.filePath, 'utf-8')).not.toContain('@group');
    });

    it('preserves the rest of the metadata + body', () => {
      const q = saveQuery(projectRoot, 'project', 'Keep', 'A description', 'SELECT ?x', 'sparql');
      setQueryGroup(q.filePath, 'G');
      const content = fs.readFileSync(q.filePath, 'utf-8');
      expect(content).toContain('# @name Keep');
      expect(content).toContain('# @description A description');
      expect(content).toContain('SELECT ?x');
    });
  });

  describe('renameQuery preserves group + order', () => {
    it('keeps @group and @order through a rename', () => {
      const q = saveQuery(projectRoot, 'project', 'Old', '', 'q', 'sparql', 'G');
      setQueryOrder([{ filePath: q.filePath, order: 3 }]);
      const newPath = renameQuery(q.filePath, 'New');
      const content = fs.readFileSync(newPath, 'utf-8');
      expect(content).toContain('# @name New');
      expect(content).toContain('# @group G');
      expect(content).toContain('# @order 3');
    });
  });
});
