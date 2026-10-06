/**
 * The Kanban move store (#2603). The IPC client is a tiny in-memory disk; the
 * editor and dialog stores are mocked. Asserted: a move writes one field
 * through `writeFile` (the normal save path) and nothing for a card already in
 * place; open tabs reload, and a dirty one is asked first; the move is
 * announced; failures toast rather than throw; and ⌘Z's undo restores the
 * exact previous text, falls back to the field when the note was edited
 * since, and leaves a note alone whose field moved on.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  writeFile: vi.fn(),
  isPathDirty: vi.fn((_p: string) => false),
  reloadTabFromDisk: vi.fn(),
  showConfirm: vi.fn(),
  announce: vi.fn(),
  push: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    notebase: {
      readFile: (p: string) => (h.disk.has(p) ? Promise.resolve(h.disk.get(p)!) : Promise.reject(new Error(`ENOENT: ${p}`))),
      writeFile: h.writeFile,
    },
  },
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({ isPathDirty: h.isPathDirty, reloadTabFromDisk: h.reloadTabFromDisk }),
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm }),
}));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));
// Mocked rather than `silenceLogTags`: `freshStore` re-imports, which a
// per-tag override on the original logger instance wouldn't reach.
vi.mock('../../../src/shared/logger', () => ({ logger: () => ({ warn: h.warn, error: h.warn, info: vi.fn(), debug: vi.fn() }) }));
vi.mock('../../../src/renderer/lib/stores/toasts.svelte', () => ({ getToastStore: () => ({ push: h.push }) }));

import { CONFIRM_KEYS } from '../../../src/renderer/lib/confirm-keys';
import type { MoveTarget } from '../../../src/shared/objects/kanban-move';

const DONE: MoveTarget = { value: 'done', label: 'done', kind: 'option' };
const NONE: MoveTarget = { value: null, label: 'No value', kind: 'no-value' };
const SHED = '---\ntype: project\nstatus: active # keep\nowner: Ann\n---\n# Garden Shed\n';
const BOAT = '---\ntype: project\n---\n# Someday Boat\n';

/** A fresh store module per test: the undo stack is module state, and the
 *  store deliberately has no reset API (#1944). */
async function freshStore() {
  vi.resetModules();
  return (await import('../../../src/renderer/lib/stores/kanban-moves.svelte')).getKanbanMoveStore();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.disk.clear();
  h.disk.set('shed.md', SHED);
  h.disk.set('boat.md', BOAT);
  h.writeFile.mockImplementation((p: string, c: string) => { h.disk.set(p, c); return Promise.resolve(); });
  h.isPathDirty.mockReturnValue(false);
  h.showConfirm.mockResolvedValue(true);
});

describe('kanban-moves store (#2603)', () => {
  it('writes the one field through writeFile, reloads the open tab, announces, bumps revision', async () => {
    const store = await freshStore();
    const paths = await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);

    expect(paths).toEqual(['shed.md']);
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('shed.md')).toBe(SHED.replace('status: active', 'status: done'));
    expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
    expect(h.showConfirm).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenCalledWith('Moved Garden Shed to done.');
    expect(store.revision).toBe(1);
    expect(store.lastMove).toEqual({ seq: 1, paths: ['shed.md'] });
    expect(store.canUndo).toBe(true);
  });

  it('No value removes the key; a card already there is not written', async () => {
    const store = await freshStore();
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }, { path: 'boat.md', title: 'Someday Boat' }], 'status', NONE);
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('shed.md')).toBe('---\ntype: project\nowner: Ann\n---\n# Garden Shed\n');
    expect(h.disk.get('boat.md')).toBe(BOAT);
    expect(h.announce).toHaveBeenCalledWith('Moved Garden Shed to No value.');
  });

  it('a no-op move writes, announces and records nothing', async () => {
    const store = await freshStore();
    const paths = await store.moveCards([{ path: 'boat.md', title: 'Someday Boat' }], 'status', NONE);
    expect(paths).toEqual([]);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
    expect(store.revision).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it('an open tab with unsaved edits gets the conflict prompt; keeping the edits skips the reload', async () => {
    const store = await freshStore();
    h.isPathDirty.mockReturnValue(true);
    h.showConfirm.mockResolvedValue(false);
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
    expect(h.showConfirm).toHaveBeenCalledWith(expect.stringContaining('"shed.md" is open with unsaved edits'), CONFIRM_KEYS.rewriteConflict, 'Load disk');
    expect(h.reloadTabFromDisk).not.toHaveBeenCalled();

    h.showConfirm.mockResolvedValue(true);
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', NONE);
    expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
  });

  it('reports a failed write with a toast and keeps going', async () => {
    const store = await freshStore();
    h.writeFile.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));
    const paths = await store.moveCards(
      [{ path: 'shed.md', title: 'Garden Shed' }, { path: 'boat.md', title: 'Someday Boat' }], 'status', DONE,
    );
    expect(paths).toEqual(['boat.md']);
    expect(h.push).toHaveBeenCalledWith({ message: 'Couldn’t move Garden Shed: EACCES' });
    expect(h.warn).toHaveBeenCalledWith('kanban move failed for', 'shed.md', expect.any(Error));
    expect(h.announce).toHaveBeenCalledWith('Moved Someday Boat to done.');
  });

  it('refuses a note whose frontmatter does not parse', async () => {
    const store = await freshStore();
    h.disk.set('bad.md', '---\nstatus: [x\n---\n');
    await store.moveCards([{ path: 'bad.md', title: 'Bad' }], 'status', DONE);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith({ message: expect.stringContaining('YAML error') });
  });

  describe('undo', () => {
    it('writes the previous text back byte for byte, announces, and empties the stack', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.reloadTabFromDisk.mockClear();
      const paths = await store.undoLastMove();
      expect(paths).toEqual(['shed.md']);
      expect(h.disk.get('shed.md')).toBe(SHED);
      expect(h.announce).toHaveBeenLastCalledWith('Undid the move: Garden Shed back to active.');
      expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
      expect(store.canUndo).toBe(false);
      expect(store.lastMove?.paths).toEqual(['shed.md']);
    });

    it('walks back moves newest first', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', NONE);
      await store.undoLastMove();
      expect(groupLine()).toBe('status: done # keep');
      await store.undoLastMove();
      expect(h.disk.get('shed.md')).toBe(SHED);
    });

    it('puts only the field back when the note was edited since the move', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.disk.set('shed.md', `${h.disk.get('shed.md')!}\nA new paragraph.\n`);
      await store.undoLastMove();
      expect(h.disk.get('shed.md')).toBe(`${SHED}\nA new paragraph.\n`);
    });

    it('leaves a note alone whose field changed since, and says so', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.disk.set('shed.md', SHED.replace('status: active', 'status: paused'));
      h.writeFile.mockClear();
      expect(await store.undoLastMove()).toEqual([]);
      expect(h.writeFile).not.toHaveBeenCalled();
      expect(h.announce).toHaveBeenLastCalledWith('Nothing undone: Garden Shed changed since the move.');
    });

    it('with nothing to undo, says so and writes nothing', async () => {
      const store = await freshStore();
      expect(await store.undoLastMove()).toEqual([]);
      expect(h.writeFile).not.toHaveBeenCalled();
      expect(h.announce).toHaveBeenCalledWith('Nothing to undo on the board.');
    });
  });
});

function groupLine(): string | undefined {
  return h.disk.get('shed.md')!.split('\n').find((l) => l.startsWith('status:'));
}
