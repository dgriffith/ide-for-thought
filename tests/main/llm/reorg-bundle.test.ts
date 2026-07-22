import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { proposeWrite, approveProposal } from '../../../src/main/llm/approval';
import { initGraph, indexNote, disposeProject as disposeGraph } from '../../../src/main/graph/index';
import { initSearch, indexNote as searchIndex, disposeProject as disposeSearch } from '../../../src/main/search/index';
import { projectContext } from '../../../src/main/project-context-types';
import type { ProposalPayload } from '../../../src/main/llm/approval';

let root: string;
const ctx = () => projectContext(root);
const read = (rel: string) => fsp.readFile(path.join(root, rel), 'utf-8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
  searchIndex(ctx(), rel, body);
}

function bundle(payloads: ProposalPayload[]) {
  return proposeWrite(ctx(), { operationType: 'note_refactor', payloads, note: 'reorg', proposedBy: 'unit-test' });
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-reorg-bundle-'));
  await initGraph(ctx());
  await initSearch(ctx());
  await seed('a.md', '# A\n\nSee [[b]] and [[c]].');
  await seed('b.md', '# B');
  await seed('c.md', '# C');
});
afterEach(async () => {
  disposeGraph(ctx());
  disposeSearch(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('batch note-refactor bundle (#914)', () => {
  it('applies every item in the bundle and rewrites links across them', async () => {
    const p = await bundle([
      { kind: 'note-refactor', fromPath: 'b.md', toPath: 'notes/b.md' },
      { kind: 'note-refactor', fromPath: 'c.md', toPath: 'notes/c.md' },
    ]);
    expect((await approveProposal(ctx(), p.uri)).ok).toBe(true);

    expect(exists('notes/b.md')).toBe(true);
    expect(exists('notes/c.md')).toBe(true);
    expect(exists('b.md')).toBe(false);
    const a = await read('a.md');
    expect(a).toContain('[[notes/b]]');
    expect(a).toContain('[[notes/c]]');
  });

  it('rolls the WHOLE bundle back when a later item fails', async () => {
    const aBefore = await read('a.md');
    // Third item collides with the existing c.md → planRename throws at apply,
    // forcing reverse-order rollback of the two already-applied moves.
    const p = await bundle([
      { kind: 'note-refactor', fromPath: 'b.md', toPath: 'notes/b.md' },
      { kind: 'note-refactor', fromPath: 'a.md', toPath: 'notes/a.md' },
      { kind: 'note-refactor', fromPath: 'b.md', toPath: 'c.md' }, // b.md already moved away → source missing
    ]);
    await expect(approveProposal(ctx(), p.uri)).rejects.toThrow();

    // Vault is exactly as it started — nothing half-applied.
    expect(exists('b.md')).toBe(true);
    expect(exists('a.md')).toBe(true);
    expect(exists('notes/b.md')).toBe(false);
    expect(exists('notes/a.md')).toBe(false);
    expect(await read('a.md')).toBe(aBefore);
  });
});
