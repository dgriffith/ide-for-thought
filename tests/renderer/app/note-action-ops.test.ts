/**
 * @vitest-environment jsdom
 *
 * The note actions as their own module (#2783): what `createNoteActionOps`
 * takes from its host and hands back to it. The actions' behaviour is pinned
 * through refactor-ops (refactor-ops.test.ts), which composes this module;
 * these cases pin the seam itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  api: { notebase: { readFile: vi.fn(), writeFile: vi.fn() }, tags: { list: vi.fn() }, graph: { frontmatterKeys: vi.fn() } },
  dialog: { showPrompt: vi.fn(), showConfirm: vi.fn(), showAddPropertyDialog: vi.fn() },
  sync: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => ({ meta: { rootPath: '/p', name: 'p' } }) }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));
vi.mock('../../../src/renderer/lib/stores/open-tab-sync', () => ({ syncOpenTabsToDisk: h.sync }));

import { createNoteActionOps, type NoteActionOpsDeps } from '../../../src/renderer/lib/app/note-action-ops.svelte';

let deps: NoteActionOpsDeps & { reportBulkSummary: ReturnType<typeof vi.fn>; refreshTags: ReturnType<typeof vi.fn>; editProperties: ReturnType<typeof vi.fn> };
let ops: ReturnType<typeof createNoteActionOps>;
beforeEach(() => {
  vi.clearAllMocks();
  deps = {
    reportBulkSummary: vi.fn().mockResolvedValue(undefined),
    bulkProperties: { isTypedSelection: vi.fn().mockResolvedValue(false), editProperties: vi.fn().mockResolvedValue(undefined) },
    editProperties: vi.fn().mockResolvedValue(undefined),
    refreshTags: vi.fn(),
  } as typeof deps;
  ops = createNoteActionOps(deps);
  h.api.notebase.writeFile.mockResolvedValue(undefined);
});

describe('createNoteActionOps (#2783)', () => {
  it('a tag write refreshes the host\'s tags, syncs open tabs and reports through the host', async () => {
    h.api.tags.list.mockResolvedValue([]);
    h.dialog.showPrompt.mockResolvedValue('t');
    h.api.notebase.readFile.mockResolvedValue('body');
    await ops.addTagToNotes(['a.md']);
    expect(deps.refreshTags).toHaveBeenCalled();
    expect(h.sync).toHaveBeenCalledWith(['a.md']);
    expect(deps.reportBulkSummary).toHaveBeenCalledWith('tagged 1 of 1 note with "t".', [], expect.any(String), false);
  });

  it('`quiet` reaches the host\'s report', async () => {
    h.api.notebase.readFile.mockResolvedValue('---\ntags: [t]\n---\n');
    await ops.removeTagFromNotes(['a.md'], { tag: 't', quiet: true });
    expect(deps.reportBulkSummary).toHaveBeenCalledWith('untagged 1 of 1 note with "t".', [], expect.any(String), true);
  });

  it('a typed selection is handed to the host\'s bulk panel', async () => {
    deps.bulkProperties.isTypedSelection = vi.fn().mockResolvedValue(true);
    ops = createNoteActionOps(deps);
    await ops.addPropertyToNotes(['a.md']);
    expect(deps.bulkProperties.editProperties).toHaveBeenCalledWith(['a.md']);
    expect(h.dialog.showAddPropertyDialog).not.toHaveBeenCalled();
  });

  it('viewNoteActions runs quietly, and Edit Properties goes to the host', async () => {
    ops.viewNoteActions.editProperties(['a.md'], 'status');
    expect(deps.editProperties).toHaveBeenCalledWith(['a.md'], 'status');
    h.api.notebase.readFile.mockResolvedValue('---\nstatus: x\n---\n');
    ops.viewNoteActions.clearProperty(['a.md'], 'status');
    await vi.waitFor(() => expect(deps.reportBulkSummary).toHaveBeenCalledWith('removed "status" on 1 of 1 note.', [], expect.any(String), true));
  });
});
