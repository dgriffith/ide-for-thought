/**
 * Editing a hierarchy of notes from the Mindmap layout (#2966): a child is a
 * new note of the type with its parent set (titled, templated); a reparent
 * writes the one parent property, undone on its own ⌘Z, recorded *Moved by
 * Mindmap*; to the top clears it; a rename renames the file, keeping its
 * extension.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const files = vi.hoisted(() => new Map<string, string>());
const h = vi.hoisted(() => ({
  writes: [] as Array<{ path: string; content: string; opts?: unknown }>,
  renames: [] as Array<[string, string]>,
  prompt: vi.fn(async () => 'Write tests'),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { notebase: {
  readFile: async (p: string) => files.get(p) ?? '',
  writeFile: async (p: string, content: string, opts?: unknown) => { files.set(p, content); h.writes.push({ path: p, content, opts }); },
  fileExists: async (p: string) => files.has(p),
  rename: async (a: string, b: string) => { h.renames.push([a, b]); },
} } }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => ({ showPrompt: h.prompt, showTypePicker: vi.fn() }) }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => ({ refresh: async () => {}, files: [] }) }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: () => {} }));
vi.mock('../../../src/renderer/lib/stores/toast.svelte', () => ({ getToastStore: () => ({ push: () => {} }) }));
import { createChildNote, parentLinkFor, renameNoteTo, reparentNotes, undoReparent } from '../../../src/renderer/lib/app/mindmap-notes';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const TASK: TypeInfo = { id: 'task', label: 'Task', classLocalName: 'Task', source: 'thoughtbase', properties: [{ name: 'parent', type: 'link-to-type', targetType: 'task' }] } as TypeInfo;
beforeEach(() => { files.clear(); h.writes = []; h.renames = []; h.prompt.mockClear(); });

describe('the Mindmap layout\'s edits (#2966)', () => {
  it('a child: a new note of the type, titled, with its parent property naming the parent by path', async () => {
    const path = await createChildNote({ type: TASK, catalog: [TASK], parentProperty: 'parent', parent: { path: 'tasks/Launch.md', title: 'Launch' } });
    expect(path).toBe('Write tests.md');
    expect(h.writes[0]!.content).toMatch(/^---\ntype: task\nparent: "\[\[tasks\/Launch\]\]"\n---/);
    expect(h.writes[0]!.opts).toEqual({ cause: 'Created by Mindmap' });
    expect(parentLinkFor('Top.md')).toBe('[[Top]]');
  });

  it('a child at the top leaves its parent empty; a cancelled title makes nothing', async () => {
    await createChildNote({ type: TASK, catalog: [TASK], parentProperty: 'parent', parent: null });
    expect(h.writes[0]!.content).toBe('---\ntype: task\nparent:\n---\n'); // the type's scaffold, its parent left empty
    h.prompt.mockResolvedValueOnce(null);
    expect(await createChildNote({ type: TASK, catalog: [TASK], parentProperty: 'parent', parent: null })).toBeNull();
    expect(h.writes).toHaveLength(1);
  });

  it('a reparent writes the one property, recorded Moved by Mindmap; ⌘Z puts it back; to the top clears it', async () => {
    const before = '---\ntype: task\nparent: "[[Launch]]"\n---\n# Code\n\nBody stays.\n';
    files.set('Code.md', before);
    expect(await reparentNotes([{ path: 'Code.md', title: 'Code' }], 'parent', { path: 'tasks/Build.md', title: 'Build' })).toEqual(['Code.md']);
    expect(files.get('Code.md')).toBe('---\ntype: task\nparent: "[[tasks/Build]]"\n---\n# Code\n\nBody stays.\n');
    expect(h.writes.at(-1)!.opts).toEqual({ cause: 'Moved by Mindmap' });
    await undoReparent();
    expect(files.get('Code.md')).toBe(before);
    await reparentNotes([{ path: 'Code.md', title: 'Code' }], 'parent', null);
    expect(files.get('Code.md')).toBe('---\ntype: task\n---\n# Code\n\nBody stays.\n');
  });

  it('a rename renames the file in its folder, keeping its extension; the same name does nothing', async () => {
    expect(await renameNoteTo('tasks/Code.md', 'Write code')).toBe('tasks/Write code.md');
    expect(await renameNoteTo('tasks/Code.md', 'Code')).toBeNull();
    expect(h.renames).toEqual([['tasks/Code.md', 'tasks/Write code.md']]);
  });
});
