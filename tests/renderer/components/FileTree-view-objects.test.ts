/**
 * @vitest-environment happy-dom
 *
 * The folder context menu's "View Objects ▸" (#2532): one entry per type under
 * the folder (recursively), parents included, each opening that type's view
 * scoped to the folder — and no submenu for a folder with no objects, or for a
 * note.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import type { NoteFile } from '../../../src/shared/types';

const h = vi.hoisted(() => ({
  api: {
    notebase: { readFile: vi.fn().mockResolvedValue('') },
    shell: { revealFile: vi.fn(), openInDefault: vi.fn(), openInTerminal: vi.fn() },
    types: { list: vi.fn(), noteTypeMap: vi.fn() },
  },
  openTypeView: vi.fn(),
  files: [] as NoteFile[],
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => ({ get files() { return h.files; } }) }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => ({ openTypeView: h.openTypeView }) }));

import FileTree from '../../../src/renderer/lib/components/FileTree.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PLACE = { id: 'place', label: 'Place', classLocalName: 'Place', source: 'user', properties: [] };
const MUSEUM = { id: 'museum', label: 'Museum', classLocalName: 'Museum', source: 'user', properties: [], parent: 'place' };

const dir = (relativePath: string, children: NoteFile[]): NoteFile => ({ name: relativePath.split('/').pop()!, relativePath, isDirectory: true, children });
const note = (relativePath: string): NoteFile => ({ name: relativePath.split('/').pop()!, relativePath, isDirectory: false });

async function setup() {
  h.files = [
    dir('trip', [dir('trip/prague', [note('trip/prague/Kampa.md'), dir('trip/prague/sub', [note('trip/prague/sub/Mucha.md')])])]),
    dir('empty', [note('empty/plain.md')]),
  ];
  h.api.types.list.mockResolvedValue({ types: [PLACE, MUSEUM], errors: [] });
  h.api.types.noteTypeMap.mockResolvedValue({ 'trip/prague/Kampa.md': 'museum', 'trip/prague/sub/Mucha.md': 'museum' });
  await objectTypesStore.refresh();
  return render(FileTree, {
    files: h.files, activeFilePath: null, expanded: { trip: true, 'trip/prague': true }, selection: new Set<string>(), focusedPath: null, canPaste: false,
    onToggleDir: vi.fn(), onItemClick: vi.fn(), onNewNote: vi.fn(), onNewFolder: vi.fn(), onDelete: vi.fn(), onContextMenuTarget: vi.fn(),
    onRename: vi.fn(), onCut: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(), onMove: vi.fn(),
  });
}
const row = (c: HTMLElement, path: string) => c.querySelector<HTMLElement>(`[data-relative-path="${path}"]`)!;

afterEach(() => { cleanup(); h.openTypeView.mockReset(); });

describe('View Objects ▸ on a folder (#2532)', () => {
  it('lists the folder\'s types (recursively), parents after, with counts', async () => {
    const { container } = await setup();
    await fireEvent.contextMenu(row(container, 'trip/prague'));
    const menu = within(container.ownerDocument.body).getByRole('menu', { name: 'View objects in trip/prague' });
    const entries = within(menu).getAllByRole('menuitem').map((b) => `${b.querySelector('.submenu-label')!.textContent} ${b.querySelector('.submenu-count')!.textContent}`);
    expect(entries).toEqual(['Museum 2', 'Place 2']);
  });

  it('opens the chosen type\'s view scoped to the folder', async () => {
    const { container } = await setup();
    await fireEvent.contextMenu(row(container, 'trip/prague'));
    await fireEvent.click(within(container.ownerDocument.body).getByRole('menuitem', { name: /Place/ }));
    expect(h.openTypeView).toHaveBeenCalledWith('place', { folder: 'trip/prague', layout: 'table' });
  });

  it('isn\'t offered for a folder with no objects, or for a note', async () => {
    const { container } = await setup();
    await fireEvent.contextMenu(row(container, 'empty'));
    expect(within(container.ownerDocument.body).queryByText('View Objects')).toBeNull();
    await fireEvent.contextMenu(row(container, 'trip/prague/Kampa.md'));
    expect(within(container.ownerDocument.body).queryByText('View Objects')).toBeNull();
  });
});
