/**
 * `editor/tab-session.ts` (#1919) — the tab/layout serialization seam
 * extracted from `getEditorStore`. Pure data mapping, tested directly rather
 * than only indirectly through the store's persist/restore integration tests
 * (`editor-store-panes.test.ts`, `editor-store-tabs.test.ts`), which still
 * cover the end-to-end save→load round trip through the real store.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EditorGroup, Tab, NoteTab, QueryTab } from '../../../src/renderer/lib/editor/tab-types';
import type { LayoutSession, TabSession } from '../../../src/shared/types';
import { leaf } from '../../../src/renderer/lib/editor/layout-tree';

const h = vi.hoisted(() => ({
  readFile: vi.fn(async (p: string) => `# ${p}\nbody`),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { notebase: { readFile: h.readFile } },
}));

import {
  toSavedTab, buildSession, reconstructTab, asViewMode, savedTabIdentity,
  normalizeSession, resolveRestoredSession,
} from '../../../src/renderer/lib/editor/tab-session';

beforeEach(() => {
  vi.clearAllMocks();
  h.readFile.mockImplementation(async (p: string) => `# ${p}\nbody`);
});

const noteTab: NoteTab = {
  type: 'note', relativePath: 'a.md', fileName: 'a.md', content: 'x', savedContent: 'x',
};
const queryTab: QueryTab = {
  type: 'query', id: 'query-1', title: 'Query 1', query: 'SELECT *', language: 'sparql',
  results: null, columns: [], error: null, executing: false, executionTime: null,
};

describe('toSavedTab', () => {
  it('drops runtime-only note fields not meant for the saved shape', () => {
    const withHistory: NoteTab = { ...noteTab, historyJson: { fake: true }, cursorOffset: 5 };
    const saved = toSavedTab(withHistory);
    expect(saved).toEqual({ type: 'note', relativePath: 'a.md', cursorOffset: 5 });
    expect(saved).not.toHaveProperty('historyJson');
    expect(saved).not.toHaveProperty('content');
  });

  it('carries a query tab\'s editable fields, not its runtime result state', () => {
    const ran: QueryTab = { ...queryTab, results: [{ a: '1' }], columns: ['a'], executing: true };
    expect(toSavedTab(ran)).toEqual({ type: 'query', title: 'Query 1', query: 'SELECT *', language: 'sparql' });
  });
});

describe('buildSession', () => {
  it('snapshots every group\'s tabs, active index, and view mode, plus the layout', () => {
    const groups: EditorGroup[] = [{ id: 'group-1', tabs: [noteTab], activeIndex: 0, viewMode: 'source' }];
    const session = buildSession(groups, 'group-1', leaf('group-1'));
    expect(session).toEqual({
      version: 2,
      activeGroupId: 'group-1',
      groups: [{ id: 'group-1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] }],
      layout: leaf('group-1'),
    });
  });
});

describe('reconstructTab', () => {
  it('reads a note tab\'s content back from disk', async () => {
    h.readFile.mockResolvedValue('# A\nbody');
    const tab = await reconstructTab({ type: 'note', relativePath: 'a.md' }, () => 'unused') as NoteTab;
    expect(tab).toMatchObject({ type: 'note', relativePath: 'a.md', content: '# A\nbody', savedContent: '# A\nbody' });
  });

  it('drops a note tab whose file was deleted since the last session', async () => {
    h.readFile.mockRejectedValue(new Error('ENOENT'));
    expect(await reconstructTab({ type: 'note', relativePath: 'gone.md' }, () => 'unused')).toBeNull();
  });

  it('mints a query tab id via the shared counter, not a fixed value', async () => {
    const tab = await reconstructTab(
      { type: 'query', title: 'Q', query: 'SELECT *' },
      () => 'query-42-123',
    ) as QueryTab;
    expect(tab.id).toBe('query-42-123');
    expect(tab).toMatchObject({ results: null, executing: false });
  });

  it('rehydrates a pdf tab, defaulting an absent page to 1', async () => {
    const tab = await reconstructTab({ type: 'pdf', sourceId: 's1' }, () => 'unused');
    expect(tab).toEqual({ type: 'pdf', sourceId: 's1', page: 1 });
  });
});

describe('asViewMode', () => {
  it('passes through a recognised mode', () => {
    expect(asViewMode('preview')).toBe('preview');
    expect(asViewMode('editor-preview')).toBe('editor-preview');
  });

  it('falls back to source for anything unrecognised', () => {
    expect(asViewMode('nonsense')).toBe('source');
    expect(asViewMode(undefined)).toBe('source');
  });
});

describe('savedTabIdentity', () => {
  it('identifies note/source/pdf/type-view tabs for forbid-duplicate dedup (#815)', () => {
    expect(savedTabIdentity({ type: 'note', relativePath: 'a.md' })).toBe('note:a.md');
    expect(savedTabIdentity({ type: 'source', sourceId: 's1' })).toBe('source:s1');
    expect(savedTabIdentity({ type: 'pdf', sourceId: 's1' })).toBe('pdf:s1');
    expect(savedTabIdentity({ type: 'type-view', typeId: 'book' })).toBe('type-view:book');
  });

  it('a query tab has no shared-buffer identity — never deduped', () => {
    expect(savedTabIdentity({ type: 'query', title: 'Q', query: 'x' })).toBeNull();
  });
});

describe('normalizeSession', () => {
  it('passes a modern multi-group session through unchanged', () => {
    const session: LayoutSession = {
      version: 2, activeGroupId: 'g1',
      groups: [{ id: 'g1', activeIndex: 0, viewMode: 'source', tabs: [] }],
      layout: leaf('g1'),
    };
    expect(normalizeSession(session, () => 'unused')).toBe(session);
  });

  it('migrates a legacy flat TabSession into a single group (#816)', () => {
    const legacy: TabSession = { tabs: [{ type: 'note', relativePath: 'a.md' }], activeIndex: 0 };
    const migrated = normalizeSession(legacy, () => 'group-9');
    expect(migrated).toEqual({
      version: 2,
      activeGroupId: 'group-9',
      groups: [{ id: 'group-9', activeIndex: 0, viewMode: 'source', tabs: legacy.tabs }],
      layout: { kind: 'leaf', groupId: 'group-9' },
    });
  });

  it('returns null for null, an empty legacy session, or an unrecognised shape', () => {
    expect(normalizeSession(null, () => 'x')).toBeNull();
    expect(normalizeSession({ tabs: [], activeIndex: 0 }, () => 'x')).toBeNull();
    expect(normalizeSession({} as TabSession, () => 'x')).toBeNull();
  });

  it('an empty modern session (groups: []) is treated the same as none', () => {
    expect(normalizeSession({ version: 2, activeGroupId: 'g1', groups: [], layout: leaf('g1') }, () => 'x')).toBeNull();
  });
});

describe('resolveRestoredSession', () => {
  const nextQueryId = () => 'query-1-0';

  it('restores every group with a matching layout, keeping the saved activeGroupId', async () => {
    const session: LayoutSession = {
      version: 2,
      activeGroupId: 'g1',
      groups: [
        { id: 'g1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] },
      ],
      layout: leaf('g1'),
    };
    const resolved = await resolveRestoredSession(session, nextQueryId);
    expect(resolved).not.toBeNull();
    expect(resolved!.groups).toHaveLength(1);
    expect(resolved!.groups[0]!.tabs).toEqual([
      expect.objectContaining({ type: 'note', relativePath: 'a.md' }),
    ]);
    expect(resolved!.layout).toEqual(leaf('g1'));
    expect(resolved!.activeGroupId).toBe('g1');
  });

  it('drops a note whose file vanished, and dedupes a tab restored in an earlier pane (#815)', async () => {
    h.readFile.mockImplementation(async (p: string) => {
      if (p === 'gone.md') throw new Error('ENOENT');
      return `# ${p}`;
    });
    const session: LayoutSession = {
      version: 2,
      activeGroupId: 'g1',
      groups: [
        { id: 'g1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }, { type: 'note', relativePath: 'gone.md' }] },
        { id: 'g2', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] }, // duplicate of g1's tab
      ],
      layout: { kind: 'split', direction: 'horizontal', children: [leaf('g1'), leaf('g2')], sizes: [0.5, 0.5] },
    };
    const resolved = await resolveRestoredSession(session, nextQueryId);
    expect(resolved!.groups[0]!.tabs.map((t: Tab) => (t as NoteTab).relativePath)).toEqual(['a.md']);
    expect(resolved!.groups[1]!.tabs).toEqual([]); // its only tab was a dupe of g1's
  });

  it('falls back to one merged pane when the saved layout does not structurally match the restored groups', async () => {
    const session: LayoutSession = {
      version: 2,
      activeGroupId: 'g1',
      groups: [
        { id: 'g1', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'a.md' }] },
        { id: 'g2', activeIndex: 0, viewMode: 'source', tabs: [{ type: 'note', relativePath: 'b.md' }] },
      ],
      // Corrupt: layout only references g1, not g2 — leaves.length !== ids.size.
      layout: leaf('g1'),
    };
    const resolved = await resolveRestoredSession(session, nextQueryId);
    expect(resolved!.groups).toHaveLength(1);
    expect(resolved!.groups[0]!.tabs.map((t: Tab) => (t as NoteTab).relativePath)).toEqual(['a.md', 'b.md']);
    expect(resolved!.layout).toEqual(leaf(resolved!.groups[0]!.id));
    expect(resolved!.activeGroupId).toBe(resolved!.groups[0]!.id);
  });

  it('falls back to the first restored group when the saved activeGroupId no longer exists', async () => {
    const session: LayoutSession = {
      version: 2,
      activeGroupId: 'ghost',
      groups: [{ id: 'g1', activeIndex: 0, viewMode: 'source', tabs: [] }],
      layout: leaf('g1'),
    };
    const resolved = await resolveRestoredSession(session, nextQueryId);
    expect(resolved!.activeGroupId).toBe('g1');
  });
});
