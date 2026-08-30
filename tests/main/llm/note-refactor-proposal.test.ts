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
  project = await makeGraphProject('minerva-note-refactor-');
  root = project.root;
  await initSearch(ctx());
  await seed('raft.md', '# Raft\n\nThe Raft consensus algorithm.');
  await seed('consensus.md', '# Consensus\n\nSee [[raft]] for the protocol.');
});
afterEach(async () => {
  disposeGraph(ctx());
  disposeSearch(ctx());
  await project.cleanup();
});

function refactor(fromPath: string, toPath: string) {
  return proposeWrite(ctx(), {
    operationType: 'note_refactor',
    payloads: [{ kind: 'note-refactor', fromPath, toPath }],
    note: `Move ${fromPath} → ${toPath}`,
    proposedBy: 'unit-test',
  });
}

describe('note-refactor proposal (#911)', () => {
  it('is requires_approval — files as pending, not auto-applied', async () => {
    const proposal = await refactor('raft.md', 'algorithms/raft.md');
    expect(proposal.status).toBe('pending');
    // Nothing moved yet — it's pending review.
    expect(exists('raft.md')).toBe(true);
    expect(exists('algorithms/raft.md')).toBe(false);
  });

  it('on approval moves the note and rewrites inbound links', async () => {
    const proposal = await refactor('raft.md', 'algorithms/raft.md');
    expect((await approveProposal(ctx(), proposal.uri)).ok).toBe(true);

    expect(exists('raft.md')).toBe(false);
    expect(exists('algorithms/raft.md')).toBe(true);
    expect(await read('consensus.md')).toContain('[[algorithms/raft]]');
    expect(await read('consensus.md')).not.toContain('[[raft]]');
  });

  it('rolls back exactly when a later payload fails', async () => {
    const before = await read('consensus.md');
    // Bundle the refactor with a malformed-turtle payload that throws at apply,
    // forcing reverse-order rollback of the already-applied refactor.
    const proposal = await proposeWrite(ctx(), {
      operationType: 'note_refactor',
      payloads: [
        { kind: 'note-refactor', fromPath: 'raft.md', toPath: 'algorithms/raft.md' },
        { kind: 'graph-triples', turtle: 'this is not valid turtle @@@', affectsNodeUris: [] },
      ],
      note: 'refactor + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx(), proposal.uri)).rejects.toThrow();

    // The vault is exactly as it was: note back, destination gone, links verbatim.
    expect(exists('raft.md')).toBe(true);
    expect(exists('algorithms/raft.md')).toBe(false);
    expect(await read('consensus.md')).toBe(before);
    expect(await read('consensus.md')).toContain('[[raft]]');
  });

  it('rejects a colliding destination at approval time', async () => {
    await seed('archive.md', '# Archive\n\nexisting');
    const proposal = await refactor('raft.md', 'archive.md');
    await expect(approveProposal(ctx(), proposal.uri)).rejects.toThrow(/already exists/);
    // Both notes untouched.
    expect(await read('archive.md')).toContain('existing');
    expect(exists('raft.md')).toBe(true);
  });
});
