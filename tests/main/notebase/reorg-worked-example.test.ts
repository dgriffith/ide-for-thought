import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { planReorg } from '../../../src/main/notebase/reorg';
import { proposeWrite, approveProposal, type ProposalPayload } from '../../../src/main/llm/approval';
import { initGraph, indexNote, disposeProject as disposeGraph } from '../../../src/main/graph/index';
import { initSearch, indexNote as searchIndex, disposeProject as disposeSearch } from '../../../src/main/search/index';
import { projectContext } from '../../../src/main/project-context-types';

/**
 * The #915 worked example, end to end at the substrate level: a messy flat vault
 * → a reorganization plan → approve → tidy folders with every wiki-link intact.
 * (The skill's LLM clustering is what produces these moves; here we supply a
 * plausible plan and prove the propose → apply machinery delivers the result.)
 */
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

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-reorg-example-'));
  await initGraph(ctx());
  await initSearch(ctx());
  // A messy, flat thoughtbase: two distributed-systems notes that link each
  // other, two cooking notes, all loose at the root.
  await seed('raft.md', '# Raft\n\nA consensus algorithm. Compare with [[paxos]].');
  await seed('paxos.md', '# Paxos\n\nThe classic consensus protocol. See [[raft]].');
  await seed('risotto.md', '# Risotto\n\nStir constantly. Pairs with [[stock]].');
  await seed('stock.md', '# Stock\n\nSimmer bones for hours.');
});
afterEach(async () => {
  disposeGraph(ctx());
  disposeSearch(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('reorg worked example (#915)', () => {
  it('moves loose notes into topic folders with links intact', async () => {
    // The plan a "Reorganize by Topic" run would produce.
    const plan = await planReorg(root, [
      { path: 'raft.md', newPath: 'distributed-systems/raft.md' },
      { path: 'paxos.md', newPath: 'distributed-systems/paxos.md' },
      { path: 'risotto.md', newPath: 'cooking/risotto.md' },
      { path: 'stock.md', newPath: 'cooking/stock.md' },
    ]);
    expect(plan.warnings).toEqual([]);
    expect(plan.items).toHaveLength(4);

    // Approve the whole plan (one atomic bundle).
    const payloads: ProposalPayload[] = plan.items.map((i) => ({
      kind: 'note-refactor', fromPath: i.fromPath, toPath: i.toPath,
    }));
    const proposal = await proposeWrite(ctx(), { operationType: 'note_refactor', payloads, note: 'reorg', proposedBy: 'unit-test' });
    expect((await approveProposal(ctx(), proposal!.uri)).ok).toBe(true);

    // Tidy: every note now lives under its topic folder.
    for (const p of ['distributed-systems/raft.md', 'distributed-systems/paxos.md', 'cooking/risotto.md', 'cooking/stock.md']) {
      expect(exists(p)).toBe(true);
    }
    expect(exists('raft.md')).toBe(false);

    // Links intact: the cross-references were rewritten to the new paths.
    expect(await read('distributed-systems/raft.md')).toContain('[[distributed-systems/paxos]]');
    expect(await read('distributed-systems/paxos.md')).toContain('[[distributed-systems/raft]]');
    expect(await read('cooking/risotto.md')).toContain('[[cooking/stock]]');
  });
});
