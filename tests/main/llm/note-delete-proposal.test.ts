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
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
  searchIndex(ctx(), rel, body);
}

beforeEach(async () => {
  project = await makeGraphProject('minerva-note-delete-');
  root = project.root;
  await initSearch(ctx());
  await seed('stale.md', '# Stale\n\nSuperseded content.');
  await seed('keeper.md', '# Keeper\n\nStill links [[stale]].');
});
afterEach(async () => {
  disposeGraph(ctx());
  disposeSearch(ctx());
  await project.cleanup();
});

function del(...paths: string[]) {
  return proposeWrite(ctx(), {
    operationType: 'note_delete',
    payloads: paths.map((p) => ({ kind: 'note-delete' as const, path: p })),
    note: `Delete ${paths.join(', ')}`,
    proposedBy: 'unit-test',
  });
}

describe('note-delete proposal', () => {
  it('is requires_approval — files as pending, deletes nothing yet', async () => {
    const proposal = await del('stale.md');
    expect(proposal.status).toBe('pending');
    expect(exists('stale.md')).toBe(true);
  });

  it('on approval deletes the note (leaving inbound links to dangle)', async () => {
    const proposal = await del('stale.md');
    expect((await approveProposal(ctx(), proposal.uri)).ok).toBe(true);

    expect(exists('stale.md')).toBe(false);
    // Inbound link is intentionally left dangling, matching manual delete.
    expect(await read('keeper.md')).toContain('[[stale]]');
  });

  it('rolls back exactly — restores the deleted note verbatim — when a later payload fails', async () => {
    const before = await read('stale.md');
    const proposal = await proposeWrite(ctx(), {
      operationType: 'note_delete',
      payloads: [
        { kind: 'note-delete', path: 'stale.md' },
        { kind: 'graph-triples', turtle: 'not valid turtle @@@', affectsNodeUris: [] },
      ],
      note: 'delete + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), proposal.uri)).rejects.toThrow();

    // The deleted note is back, content byte-for-byte.
    expect(exists('stale.md')).toBe(true);
    expect(await read('stale.md')).toBe(before);
  });
});
