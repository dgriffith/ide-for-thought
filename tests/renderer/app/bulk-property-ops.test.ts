/**
 * The bulk "Edit properties…" command (#2431): reads the selection, opens the
 * panel with the type-aware model, writes only the notes the edits change, and
 * reports per-item failures without stopping.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const TASK: TypeInfo = {
  id: 'task', label: 'Task', classLocalName: 'Task', source: 'user',
  properties: [{ name: 'due', type: 'date' }, { name: 'done', type: 'boolean' }],
};

const h = vi.hoisted(() => ({
  files: {},
  types: {},
  api: {
    notebase: { readFile: vi.fn(), writeFile: vi.fn() },
    tags: { list: vi.fn() },
  },
  dialog: { showConfirm: vi.fn(), showBulkPropertiesDialog: vi.fn() },
  refresh: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: {
    get types() { return Object.values(h.types); },
    refresh: h.refresh,
    typeForNote: (p: string) => (h.types[p] ?? null),
  },
}));

import { createBulkPropertyOps } from '../../../src/renderer/lib/app/bulk-property-ops';
import { silenceLogTags } from '../../helpers/quiet-logs';

const deps = { syncOpenTabsToDisk: vi.fn(), reportBulkSummary: vi.fn(), onWritten: vi.fn() };
let ops: ReturnType<typeof createBulkPropertyOps>;

beforeEach(() => {
  vi.clearAllMocks();
  h.files = {
    'a.md': '---\ntype: task\ndue: 2025-01-01\nnote:   keep\n---\nA\n',
    'b.md': '---\ntype: task\ndue: 2026-12-01\ndone: true\n---\nB\n',
    'c.md': '---\ntype: task\n---\nC\n',
  };
  h.types = { 'a.md': TASK, 'b.md': TASK, 'c.md': TASK };
  h.api.notebase.readFile.mockImplementation(async (p: string) => {
    if (!(p in h.files)) throw new Error('ENOENT');
    return h.files[p];
  });
  h.api.notebase.writeFile.mockImplementation(async (p: string, c: string) => { h.files[p] = c; });
  h.api.tags.list.mockResolvedValue([{ tag: 'x', count: 1 }]);
  h.refresh.mockResolvedValue(undefined);
  ops = createBulkPropertyOps(deps);
});

describe('editProperties', () => {
  it('writes the touched fields as typed YAML to every note that needs it, and only those', async () => {
    h.dialog.showBulkPropertiesDialog.mockResolvedValue([
      { op: 'set', key: 'due', value: '2026-12-01' },
      { op: 'set', key: 'done', value: true },
    ]);
    await ops.editProperties(['a.md', 'b.md', 'c.md']);

    const [model, vocab] = h.dialog.showBulkPropertiesDialog.mock.calls[0]!;
    expect(model.sharedType.id).toBe('task');
    expect(model.fields.map((f: { name: string }) => f.name)).toEqual(['due', 'done', 'title', 'aliases', 'tags']);
    expect(vocab).toEqual(['x']);

    expect(h.files['a.md']).toBe('---\ntype: task\ndue: 2026-12-01\nnote:   keep\ndone: true\n---\nA\n');
    expect(h.files['c.md']).toBe('---\ntype: task\ndue: 2026-12-01\ndone: true\n---\nC\n');
    // b already had both values: never rewritten.
    expect(h.api.notebase.writeFile.mock.calls.map((c) => c[0])).toEqual(['a.md', 'c.md']);
    expect(deps.syncOpenTabsToDisk).toHaveBeenCalledWith(['a.md', 'c.md']);
    expect(deps.onWritten).toHaveBeenCalledTimes(1);
    expect(deps.reportBulkSummary).not.toHaveBeenCalled();
  });

  it('reports per-item failures and still writes the rest', async () => {
    h.files['bad.md'] = '---\na: [unclosed\n---\n';
    h.api.notebase.writeFile.mockImplementation(async (p: string, c: string) => {
      if (p === 'c.md') throw new Error('disk full');
      h.files[p] = c;
    });
    h.dialog.showBulkPropertiesDialog.mockResolvedValue([{ op: 'set', key: 'done', value: false }]);
    await ops.editProperties(['a.md', 'bad.md', 'c.md', 'gone.md']);
    expect(h.files['a.md']).toContain('done: false');
    const [primary, failures] = deps.reportBulkSummary.mock.calls[0]!;
    expect(primary).toBe('Updated 1 of 4 notes.');
    expect(failures.map((f: { path: string }) => f.path).sort()).toEqual(['bad.md', 'c.md', 'gone.md']);
  });

  it('cancel writes nothing', async () => {
    h.dialog.showBulkPropertiesDialog.mockResolvedValue(null);
    await ops.editProperties(['a.md']);
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
    expect(deps.onWritten).not.toHaveBeenCalled();
  });

  it('a selection with no markdown says so', async () => {
    await ops.editProperties(['data.csv']);
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.dialog.showBulkPropertiesDialog).not.toHaveBeenCalled();
  });
});

describe('isTypedSelection', () => {
  silenceLogTags('objects');
  it('is true only when every note has a type', async () => {
    expect(await ops.isTypedSelection(['a.md', 'b.md'])).toBe(true);
    expect(await ops.isTypedSelection(['a.md', 'plain.md'])).toBe(false);
    expect(await ops.isTypedSelection([])).toBe(false);
  });

  it('falls back to the cached map when the refresh fails', async () => {
    h.refresh.mockRejectedValue(new Error('no project'));
    expect(await ops.isTypedSelection(['a.md'])).toBe(true);
  });
});
