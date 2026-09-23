/**
 * `initGraph` skips parsing `graph.ttl` when a rebuild follows and the
 * snapshot holds no proposals (#2216).
 *
 * At project open, `project-context.ts` calls `initGraph` and then
 * `indexAllNotes`, which swaps in a fresh store and re-derives everything from
 * disk — notes, sources, excerpts, folders, the type catalog — keeping exactly
 * one thing out of the old store: `captureProposalStatements`. So the parse
 * contributed nothing but pending proposals, and for a project with none it
 * contributed nothing at all, at a measured 94ms / 274ms / 573ms for
 * 500 / 1,500 / 3,000 notes, synchronously, before any window paints.
 *
 * ── Why most of this file is about NOT losing proposals ─────────────────────
 * The pending-proposal queue is the trust model (`CLAUDE.md`, The Trust
 * Principle). Skipping a parse that still had proposals in it would delete a
 * user's review queue with no error and no symptom until they went looking.
 *
 * That is not hypothetical. The first version of the marker looked for
 * `thought:Proposal` — the prefix the entire codebase uses — and would have
 * matched NOTHING, because rdflib's serializer chooses its own prefixes and
 * writes this namespace as `tho:`. Every parse would have been skipped and
 * every pending proposal silently dropped. The end-to-end tests below are what
 * caught the shape of that, and they are deliberately written against a real
 * `proposeWrite` → `persistGraph` → reopen cycle rather than against a
 * hand-written fixture, because a hand-written fixture would have encoded the
 * same wrong assumption about how the file looks.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  initGraph,
  indexNote,
  persistGraph,
  indexAllNotes,
  queryGraph,
} from '../../../src/main/graph/index';
import { deleteState } from '../../../src/main/graph/state';
import { proposeWrite } from '../../../src/main/llm/approval';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const PREFIX = 'minerva-snapshot-skip-';

/** Close and reopen exactly as `project-context.ts` does at project open. */
async function reopen(ctx: ProjectContext): Promise<void> {
  deleteState(ctx);
  await initGraph(ctx, { rebuildFollows: true });
  await indexAllNotes(ctx);
}

/**
 * How many notes the store holds after `initGraph` ALONE — i.e. before any
 * rebuild re-derives them from disk.
 *
 * This is the observable consequence of the snapshot being parsed, and it is
 * what these tests assert on rather than spying on `$rdf.parse` (which is a
 * non-configurable ESM export and cannot be redefined anyway). Asserting the
 * consequence is the better test regardless: it keeps holding if the loading
 * is ever restructured, and it fails for a parse that happens but produces
 * nothing.
 */
async function notesLoadedBySnapshot(ctx: ProjectContext): Promise<number> {
  const r = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
  return r.results.length;
}

const aProposal = {
  operationType: 'new_claim' as const,
  payloads: [{
    kind: 'graph-triples' as const,
    turtle: '<https://ex.example/x> a <https://ex.example/Claim> .',
    affectsNodeUris: ['https://ex.example/x'],
  }],
  note: 'survives a reopen',
  proposedBy: 'unit-test',
};

const PENDING = 'https://minerva.dev/ontology/thought#pending';

async function pendingCount(ctx: ProjectContext): Promise<number> {
  const r = await queryGraph(ctx, `
    SELECT ?p WHERE { ?p thought:proposalStatus <${PENDING}> }
  `);
  return r.results.length;
}

describe('a pending proposal survives a reopen — the thing that must not break', () => {
  const project = useGraphProject(PREFIX);
  it('is still pending after close + reopen', async () => {
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/a.md', '---\ntitle: A\n---\n\n# A\n');
    const proposal = await proposeWrite(ctx, aProposal);
    await persistGraph(ctx);
    expect(await pendingCount(ctx)).toBe(1);

    await reopen(ctx);

    expect(await pendingCount(ctx), 'the reopen dropped a pending proposal').toBe(1);
    const still = await queryGraph(ctx, `SELECT ?s WHERE { <${proposal.uri}> thought:proposalNote ?s }`);
    expect(still.results.length, 'the proposal lost its own triples').toBe(1);
  });

  it('the snapshot IS loaded when it holds one', async () => {
    // The other half: the skip must not fire here. Asserted on the snapshot's
    // whole content, not only on the proposal, so it still fails if the
    // proposal happened to survive by some other route.
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/a.md', '---\ntitle: A\n---\n\n# A\n');
    await proposeWrite(ctx, aProposal);
    await persistGraph(ctx);

    deleteState(ctx);
    await initGraph(ctx, { rebuildFollows: true });
    expect(await notesLoadedBySnapshot(ctx), 'a snapshot containing a proposal was skipped')
      .toBe(1);
  });

  it('several proposals all survive', async () => {
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/a.md', '---\ntitle: A\n---\n\n# A\n');
    for (let i = 0; i < 3; i++) await proposeWrite(ctx, { ...aProposal, note: `p${i}` });
    await persistGraph(ctx);
    await reopen(ctx);
    expect(await pendingCount(ctx)).toBe(3);
  });
});

describe('the parse is skipped when it would contribute nothing', () => {
  const project = useGraphProject(PREFIX);
  it('a proposal-free snapshot is not parsed at project open', async () => {
    const ctx = project.ctx;
    for (let i = 0; i < 5; i++) {
      await indexNote(ctx, `notes/n${i}.md`, `---\ntitle: N${i}\n---\n\n# N${i}\n`);
    }
    await persistGraph(ctx);

    deleteState(ctx);
    await initGraph(ctx, { rebuildFollows: true });
    expect(await notesLoadedBySnapshot(ctx), 'the snapshot was loaded although nothing needed it')
      .toBe(0);
  });

  it('and the reopened project still has every note', async () => {
    // The count gate above is satisfied by a project that opens empty. The
    // notes come back from the disk walk, not from the snapshot — that is the
    // whole premise, so it gets asserted rather than assumed.
    const ctx = project.ctx;
    for (let i = 0; i < 5; i++) {
      await indexNote(ctx, `notes/n${i}.md`, `---\ntitle: N${i}\n---\n\n# N${i}\n`);
      fs.mkdirSync(path.join(ctx.rootPath, 'notes'), { recursive: true });
      fs.writeFileSync(path.join(ctx.rootPath, `notes/n${i}.md`), `---\ntitle: N${i}\n---\n\n# N${i}\n`);
    }
    await persistGraph(ctx);
    await reopen(ctx);

    const notes = await queryGraph(ctx, 'SELECT ?s WHERE { ?s a minerva:Note }');
    expect(notes.results.length, 'reopening lost the notes').toBe(5);
  });

  it('a caller that owns a throwaway store still gets the full snapshot', async () => {
    // The CLI path (`Engine.proposeNote`, see `llm/propose-note.ts`) calls
    // `initGraph` and does NOT rebuild — for it the snapshot IS the graph. It
    // passes no options, so the skip must never apply.
    const ctx = project.ctx;
    for (let i = 0; i < 5; i++) {
      await indexNote(ctx, `notes/n${i}.md`, `---\ntitle: N${i}\n---\n\n# N${i}\n`);
    }
    await persistGraph(ctx);

    deleteState(ctx);
    await initGraph(ctx);
    expect(await notesLoadedBySnapshot(ctx), 'the throwaway-store path came up empty').toBe(5);
  });
});

describe('the marker is deliberately over-broad', () => {
  const project = useGraphProject(PREFIX);
  it('a note that merely writes about proposals forces the parse', async () => {
    // Failing this way costs one parse. Failing the other way costs a user
    // their review queue. The test states which trade is intended, so that
    // "tightening" the marker has to argue with it.
    const ctx = project.ctx;
    await indexNote(
      ctx,
      'notes/essay.md',
      '---\ntitle: On Proposals\n---\n\n# On Proposals\n\nA proposal is a suggestion.\n',
    );
    await persistGraph(ctx);

    deleteState(ctx);
    await initGraph(ctx, { rebuildFollows: true });
    expect(await notesLoadedBySnapshot(ctx), 'prose mentioning proposals should fall back to loading')
      .toBe(1);
  });

  it('matches the prefix rdflib actually writes, not the one the code uses', async () => {
    // Pins the near-miss. `graph.ttl` says `a tho:Proposal`, never
    // `thought:Proposal`, because the serializer picks prefixes at write time.
    // If this ever changes, the marker still holds (it is case-insensitive and
    // matches the subject IRI and predicates too) — but the reader should know
    // the file does not look like the rest of the codebase.
    const ctx = project.ctx;
    await indexNote(ctx, 'notes/a.md', '---\ntitle: A\n---\n\n# A\n');
    await proposeWrite(ctx, aProposal);
    await persistGraph(ctx);

    const turtle = fs.readFileSync(path.join(ctx.rootPath, '.minerva', 'graph.ttl'), 'utf-8');
    expect(turtle).not.toContain('thought:Proposal');
    expect(/proposal/i.test(turtle), 'the marker no longer matches a real snapshot').toBe(true);
  });
});
