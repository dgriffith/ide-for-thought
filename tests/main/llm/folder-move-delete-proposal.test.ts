import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { proposeWrite, approveProposal } from '../../../src/main/llm/approval';
import { indexNote, disposeProject as disposeGraph } from '../../../src/main/graph/index';
import { initSearch, indexNote as searchIndex, disposeProject as disposeSearch } from '../../../src/main/search/index';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';

let root: string;
let project: GraphProject;
const ctx = () => project.ctx;
const read = (rel: string) => fsp.readFile(path.join(root, rel), 'utf-8');
const readBytes = (rel: string) => fsp.readFile(path.join(root, rel));
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
  searchIndex(ctx(), rel, body);
}

/** A non-note binary asset inside the folder (an image) — not indexed. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff]);
async function seedBinary(rel: string, bytes: Uint8Array): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, bytes);
}

beforeEach(async () => {
  project = await makeGraphProject('minerva-folder-refactor-');
  root = project.root;
  await initSearch(ctx());
  // A folder with two linked notes + a binary asset, and an outside note that
  // links into the folder.
  await seed('topic/a.md', '# A\n\nSee [[topic/b]]. ![diagram](pic.png)');
  await seed('topic/b.md', '# B\n\nThe B note.');
  await seedBinary('topic/pic.png', PNG_BYTES);
  await seed('outside.md', '# Outside\n\nRefers to [[topic/a]].');
});
afterEach(async () => {
  disposeGraph(ctx());
  disposeSearch(ctx());
  await project.cleanup();
});

describe('folder-refactor proposal (#911 follow-up)', () => {
  function moveFolder(fromPath: string, toPath: string) {
    return proposeWrite(ctx(), {
      operationType: 'note_refactor',
      payloads: [{ kind: 'folder-refactor', fromPath, toPath }],
      note: `Move folder ${fromPath} → ${toPath}`,
      proposedBy: 'unit-test',
    });
  }

  it('files as pending — nothing moves until approval', async () => {
    const p = await moveFolder('topic', 'archive/topic');
    expect(p.status).toBe('pending');
    expect(exists('topic/a.md')).toBe(true);
    expect(exists('archive/topic/a.md')).toBe(false);
  });

  it('on approval moves the whole folder, its asset, and rewrites links', async () => {
    const p = await moveFolder('topic', 'archive/topic');
    expect((await approveProposal(ctx(), p.uri)).ok).toBe(true);

    // Folder + all files relocated.
    expect(exists('topic')).toBe(false);
    expect(exists('archive/topic/a.md')).toBe(true);
    expect(exists('archive/topic/b.md')).toBe(true);
    expect(await readBytes('archive/topic/pic.png')).toEqual(Buffer.from(PNG_BYTES));

    // Inbound wiki-link from outside rewritten; internal link re-pointed.
    expect(await read('outside.md')).toContain('[[archive/topic/a]]');
    expect(await read('outside.md')).not.toContain('[[topic/a]]');
    expect(await read('archive/topic/a.md')).toContain('[[archive/topic/b]]');
  });

  it('rolls back exactly when a later payload fails — folder + asset + links verbatim', async () => {
    const outsideBefore = await read('outside.md');
    const aBefore = await read('topic/a.md');
    const p = await proposeWrite(ctx(), {
      operationType: 'note_refactor',
      payloads: [
        { kind: 'folder-refactor', fromPath: 'topic', toPath: 'archive/topic' },
        { kind: 'graph-triples', turtle: 'this is not valid turtle @@@', affectsNodeUris: [] },
      ],
      note: 'folder move + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), p.uri)).rejects.toThrow();

    // Everything exactly as before: folder back, destination gone, links + asset verbatim.
    expect(exists('archive/topic/a.md')).toBe(false);
    expect(exists('topic/a.md')).toBe(true);
    expect(await read('outside.md')).toBe(outsideBefore);
    expect(await read('topic/a.md')).toBe(aBefore);
    expect(await readBytes('topic/pic.png')).toEqual(Buffer.from(PNG_BYTES));
  });

  it('moves MANY folders from one bundle, and rolls them all back on failure', async () => {
    // The batched `propose_folder_move` path (#1778) files one proposal with a
    // folder-refactor payload per folder. Each payload re-plans at apply time,
    // so the bundle is safe; what this pins is that a mid-bundle failure leaves
    // NO folder half-moved.
    await seed('other/b.md', '# B\n\nbody');

    const ok = await proposeWrite(ctx(), {
      operationType: 'note_refactor',
      payloads: [
        { kind: 'folder-refactor', fromPath: 'topic', toPath: 'archive/topic' },
        { kind: 'folder-refactor', fromPath: 'other', toPath: 'archive/other' },
      ],
      note: 'Move 2 folders',
      proposedBy: 'unit-test',
    });
    await approveProposal(ctx(), ok.uri);
    expect(exists('archive/topic/a.md')).toBe(true);
    expect(exists('archive/other/b.md')).toBe(true);
    expect(exists('topic/a.md')).toBe(false);
    expect(exists('other/b.md')).toBe(false);

    // A broken triples payload after the moves fails the bundle; both folders
    // must go back.
    const bad = await proposeWrite(ctx(), {
      operationType: 'note_refactor',
      payloads: [
        { kind: 'folder-refactor', fromPath: 'archive/topic', toPath: 'topic' },
        { kind: 'folder-refactor', fromPath: 'archive/other', toPath: 'other' },
        { kind: 'graph-triples', turtle: '<https://ex/z> ;;;; .', affectsNodeUris: ['https://ex/z'] },
      ],
      note: 'Move 2 folders back (fails)',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), bad.uri)).rejects.toThrow();
    expect(exists('archive/topic/a.md')).toBe(true);
    expect(exists('archive/other/b.md')).toBe(true);
    expect(exists('topic/a.md')).toBe(false);
    expect(exists('other/b.md')).toBe(false);
  });

  it('rejects a colliding destination at approval time', async () => {
    await fsp.mkdir(path.join(root, 'archive/topic'), { recursive: true });
    const p = await moveFolder('topic', 'archive/topic');
    await expect(approveProposal(ctx(), p.uri)).rejects.toThrow(/already exists/);
    expect(exists('topic/a.md')).toBe(true);
  });
});

describe('folder-delete proposal (#911 follow-up)', () => {
  function deleteFolder(p: string) {
    return proposeWrite(ctx(), {
      operationType: 'note_delete',
      payloads: [{ kind: 'folder-delete', path: p }],
      note: `Delete folder ${p}`,
      proposedBy: 'unit-test',
    });
  }

  it('files as pending — nothing deletes until approval', async () => {
    const p = await deleteFolder('topic');
    expect(p.status).toBe('pending');
    expect(exists('topic/a.md')).toBe(true);
  });

  it('on approval removes the whole folder (notes + assets)', async () => {
    const p = await deleteFolder('topic');
    expect((await approveProposal(ctx(), p.uri)).ok).toBe(true);
    expect(exists('topic')).toBe(false);
    expect(exists('topic/a.md')).toBe(false);
    expect(exists('topic/pic.png')).toBe(false);
    // The outside note survives (its link now dangles — that's expected).
    expect(exists('outside.md')).toBe(true);
  });

  it('deletes many folders in ONE bundle (#1778)', async () => {
    await seed('other/c.md', '# C\n\nAnother folder.');
    await seedBinary('other/pic2.png', PNG_BYTES);
    const p = await proposeWrite(ctx(), {
      operationType: 'note_delete',
      payloads: [
        { kind: 'folder-delete', path: 'topic' },
        { kind: 'folder-delete', path: 'other' },
      ],
      note: 'Delete 2 folders',
      proposedBy: 'unit-test',
    });
    expect(p.status).toBe('pending');
    expect(exists('topic/a.md')).toBe(true);
    expect(exists('other/c.md')).toBe(true);

    expect((await approveProposal(ctx(), p.uri)).ok).toBe(true);
    expect(exists('topic')).toBe(false);
    expect(exists('other')).toBe(false);
    expect(exists('outside.md')).toBe(true);
  });

  it('rolls back BOTH folders when a later payload fails', async () => {
    await seed('other/c.md', '# C\n\nAnother folder.');
    const aBefore = await read('topic/a.md');
    const cBefore = await read('other/c.md');
    const p = await proposeWrite(ctx(), {
      operationType: 'note_delete',
      payloads: [
        { kind: 'folder-delete', path: 'topic' },
        { kind: 'folder-delete', path: 'other' },
        { kind: 'graph-triples', turtle: 'not valid @@@', affectsNodeUris: [] },
      ],
      note: 'two folder deletes + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), p.uri)).rejects.toThrow();

    // All-or-nothing: neither folder is half-deleted.
    expect(await read('topic/a.md')).toBe(aBefore);
    expect(await read('other/c.md')).toBe(cBefore);
    expect(await readBytes('topic/pic.png')).toEqual(Buffer.from(PNG_BYTES));
  });

  it('rolls back exactly — recreates every note and the binary asset', async () => {
    const aBefore = await read('topic/a.md');
    const p = await proposeWrite(ctx(), {
      operationType: 'note_delete',
      payloads: [
        { kind: 'folder-delete', path: 'topic' },
        { kind: 'graph-triples', turtle: 'not valid @@@', affectsNodeUris: [] },
      ],
      note: 'folder delete + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), p.uri)).rejects.toThrow();

    // The whole tree is restored, including the binary asset byte-for-byte.
    expect(await read('topic/a.md')).toBe(aBefore);
    expect(exists('topic/b.md')).toBe(true);
    expect(await readBytes('topic/pic.png')).toEqual(Buffer.from(PNG_BYTES));
  });
});
