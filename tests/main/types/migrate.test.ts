/**
 * Type rename/delete safety (#1588): deleting can clear `type:` from instances;
 * renaming migrates instances' `type:` to the new id. Non-stock ids throughout
 * (a user type sharing a stock id is shadowed).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes } from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { deleteTypeSafely, renameType } from '../../../src/main/types/migrate';
import * as notebaseFs from '../../../src/main/notebase/fs';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

function writeType(id: string, fm: string): void {
  const dir = path.join(root, '.minerva', 'types');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), `---\n${fm}\n---\n`, 'utf-8');
}
function writeNote(rel: string, content: string): void {
  fs.writeFileSync(path.join(root, rel), content, 'utf-8');
}
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), 'utf-8');
const typeExists = (id: string): boolean => fs.existsSync(path.join(root, '.minerva', 'types', `${id}.md`));

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-type-migrate-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  writeType('widget', `label: Widget\nproperties:\n  - name: maker\n    type: text`);
  writeNote('W1.md', `---\ntitle: W1\ntype: widget\nmaker: Acme\n---\n# W1\n`);
  writeNote('W2.md', `---\ntitle: W2\ntype: widget\n---\n# W2\n`);
  await indexAllNotes(ctx);
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(root, { recursive: true, force: true }); });

/** Make `notebaseFs.writeFile` throw for one note path; write the rest for real,
 *  so a mid-batch failure can be exercised deterministically (no fs-perm flake). */
function failWriteFor(failPath: string): void {
  vi.spyOn(notebaseFs, 'writeFile').mockImplementation(async (rp: string, rel: string, data: string) => {
    if (rel === failPath) throw new Error('disk full');
    fs.writeFileSync(path.join(rp, rel), data, 'utf-8');
  });
}

describe('deleteTypeSafely (#1588)', () => {
  it('clears `type:` from the instances when asked, and deletes the type', async () => {
    const { cleared } = await deleteTypeSafely(root, 'widget', true);
    expect(cleared.sort()).toEqual(['W1.md', 'W2.md']);
    expect(read('W1.md')).not.toContain('type:');
    expect(read('W1.md')).toContain('maker: Acme'); // other keys + body preserved
    expect(read('W1.md')).toContain('# W1');
    expect(typeExists('widget')).toBe(false);
  });

  it('leaves the instances untouched when not clearing (dangling but reversible)', async () => {
    const { cleared, failed } = await deleteTypeSafely(root, 'widget', false);
    expect(cleared).toEqual([]);
    expect(failed).toEqual([]);
    expect(read('W1.md')).toContain('type: widget'); // kept
    expect(typeExists('widget')).toBe(false);
  });

  it('reports notes it could not clear, still deletes, and does not abort the batch (#1611)', async () => {
    failWriteFor('W2.md');
    const { cleared, failed } = await deleteTypeSafely(root, 'widget', true);
    expect(cleared).toEqual(['W1.md']);                 // W1 cleared despite W2 failing
    expect(failed.map((f) => f.path)).toEqual(['W2.md']);
    expect(failed[0]!.error).toMatch(/disk full/);
    expect(read('W1.md')).not.toContain('type:');        // W1 actually persisted
    expect(read('W2.md')).toContain('type: widget');     // W2 unchanged (write failed)
    expect(typeExists('widget')).toBe(false);            // delete is the user's intent — proceeds
  });
});

describe('renameType (#1588)', () => {
  it('renames the id and migrates every instance', async () => {
    const { newId, migrated } = await renameType(root, 'widget', 'Gadget');
    expect(newId).toBe('gadget');
    expect(migrated.sort()).toEqual(['W1.md', 'W2.md']);
    expect(read('W1.md')).toContain('type: gadget');
    expect(read('W1.md')).not.toContain('type: widget');
    expect(typeExists('gadget')).toBe(true);
    expect(typeExists('widget')).toBe(false);

    const cat = await loadTypeCatalog(root);
    expect(cat.types.find((t) => t.id === 'gadget')?.label).toBe('Gadget');
    expect(cat.types.find((t) => t.id === 'gadget')?.properties.map((p) => p.name)).toEqual(['maker']);
    expect(cat.types.find((t) => t.id === 'widget')).toBeUndefined();
  });

  it('a label-only change (same slug) re-labels in place, no migration', async () => {
    const { newId, migrated, failed } = await renameType(root, 'widget', 'Widget!!');
    expect(newId).toBe('widget'); // slug unchanged
    expect(migrated).toEqual([]);
    expect(failed).toEqual([]);
    expect(read('W1.md')).toContain('type: widget'); // untouched
    expect(typeExists('widget')).toBe(true);
    expect((await loadTypeCatalog(root)).types.find((t) => t.id === 'widget')?.label).toBe('Widget!!');
  });

  it('on a partial migration failure, keeps the old type so nothing is orphaned (#1611)', async () => {
    failWriteFor('W2.md');
    const { newId, migrated, failed } = await renameType(root, 'widget', 'Gadget');
    expect(newId).toBe('gadget');
    expect(migrated).toEqual(['W1.md']);                 // W1 moved
    expect(failed.map((f) => f.path)).toEqual(['W2.md']);
    expect(failed[0]!.error).toMatch(/disk full/);
    expect(read('W1.md')).toContain('type: gadget');     // W1 persisted to the new id
    expect(read('W2.md')).toContain('type: widget');     // W2 still on the old id
    // Both types must exist so every note still resolves — the old type is NOT
    // dropped while an instance still references it.
    expect(typeExists('gadget')).toBe(true);
    expect(typeExists('widget')).toBe(true);
  });

  it('throws for an unknown type', async () => {
    await expect(renameType(root, 'ghost', 'Ghost')).rejects.toThrow(/not found/);
  });
});
