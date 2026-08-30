/**
 * `propose_folder_move` — single and batched (PR #1777).
 *
 * The tool had no coverage of its own: `folder-move-delete-proposal.test.ts`
 * tests the `folder-refactor` payload, not the tool that produces the draft.
 * Batching it is the moment to fix that, because the routing decision — one
 * folder keeps the single refactor card, many route through the reorg draft —
 * is exactly the kind of thing that regresses silently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { indexNote, disposeProject } from '../../../src/main/graph/index';
import type {
  ConversationRefactorDraft,
  ConversationReorgDraft,
} from '../../../src/shared/conversation-refactor-drafts';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';

let root: string;
let project: GraphProject;
const ctx = () => project.ctx;
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}

function capture(): {
  single: ConversationRefactorDraft[];
  batch: ConversationReorgDraft[];
  callbacks: ToolCallbacks;
} {
  const single: ConversationRefactorDraft[] = [];
  const batch: ConversationReorgDraft[] = [];
  return {
    single,
    batch,
    callbacks: { onRefactorDraft: (d) => single.push(d), onReorgDraft: (d) => batch.push(d) },
  };
}

beforeEach(async () => {
  project = await makeGraphProject('minerva-folder-move-tool-');
  root = project.root;
  await seed('topics/raft/raft.md', '# Raft\n\nThe Raft algorithm.');
  await seed('topics/paxos/paxos.md', '# Paxos\n\nThe Paxos algorithm.');
  // An outside referrer using PATH-qualified links — a bare `[[raft]]` resolves
  // by basename and survives a folder move untouched, so it would show no blast
  // radius at all.
  await seed('index.md', '# Index\n\nSee [[topics/raft/raft]] and [[topics/paxos/paxos]].');
});
afterEach(async () => {
  disposeProject(ctx());
  await project.cleanup();
});

describe('propose_folder_move — one folder', () => {
  it('emits a refactor draft flagged isFolder, without moving anything', async () => {
    const { single, batch, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [{ path: 'topics/raft', newPath: 'archive/raft' }],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(batch).toHaveLength(0); // a single folder keeps the single card
    expect(single).toHaveLength(1);
    expect(single[0]).toMatchObject({
      fromPath: 'topics/raft',
      toPath: 'archive/raft',
      isFolder: true,
    });
    // Nothing moved.
    expect(fs.existsSync(path.join(root, 'topics/raft/raft.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'archive/raft/raft.md'))).toBe(false);
  });

  it('errors on an unplannable move (into itself)', async () => {
    const { single, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [{ path: 'topics', newPath: 'topics/nested' }],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(single).toHaveLength(0);
  });
});

describe('propose_folder_move — batched', () => {
  it('routes many folders into ONE reorg draft, not N refactor cards', async () => {
    const { single, batch, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [
        { path: 'topics/raft', newPath: 'archive/raft' },
        { path: 'topics/paxos', newPath: 'archive/paxos' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(single).toHaveLength(0);
    expect(batch).toHaveLength(1);
    expect(batch[0].isFolder).toBe(true);
    expect(batch[0].items.map((i) => [i.fromPath, i.toPath])).toEqual([
      ['topics/raft', 'archive/raft'],
      ['topics/paxos', 'archive/paxos'],
    ]);
    expect(batch[0].note).toBe('Move 2 folders');
    // The blast radius is still notes either way — the ones relocating, plus
    // any referrer whose links need rewriting.
    const affected = batch[0].items.flatMap((i) => i.affectedNotes.map((a) => a.path));
    expect(affected).toContain('topics/raft/raft.md');
    expect(affected).toContain('topics/paxos/paxos.md');
    expect(affected).toContain('index.md');
    // Still nothing moved.
    expect(fs.existsSync(path.join(root, 'topics/raft/raft.md'))).toBe(true);
  });

  it('keeps the plannable folders and warns about the rest', async () => {
    const { batch, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [
        { path: 'topics/raft', newPath: 'archive/raft' },
        { path: 'topics/ghost', newPath: 'archive/ghost' }, // no such folder
        { path: 'topics/paxos', newPath: 'archive/paxos' },
      ],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(batch[0].items.map((i) => i.fromPath)).toEqual(['topics/raft', 'topics/paxos']);
    expect(batch[0].warnings.join(' ')).toMatch(/ghost/);
  });

  it('warns when one move overlaps another, rather than silently mispreviewing', async () => {
    // Moving `topics/raft` while also moving its parent `topics`: each folder is
    // planned against the CURRENT tree, so the previews can't both be right.
    // Apply re-plans and would roll back, but the user should be told.
    const { batch, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [
        { path: 'topics/raft', newPath: 'archive/raft' },
        { path: 'topics', newPath: 'old-topics' },
      ],
    }, callbacks);

    expect(batch[0].warnings.join(' ')).toMatch(/overlaps the move of/i);
  });

  it('errors (no draft) when no folder in the batch can be planned', async () => {
    const { single, batch, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [
        { path: 'ghost-a', newPath: 'archive/a' },
        { path: 'ghost-b', newPath: 'archive/b' },
      ],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(single).toHaveLength(0);
    expect(batch).toHaveLength(0);
  });

  it('validates required input', async () => {
    const { callbacks } = capture();
    const bad: unknown[] = [
      {},
      { moves: [] },
      { moves: [{ newPath: 'archive/x' }] },
      { moves: [{ path: 'topics/raft' }] },
    ];
    for (const input of bad) {
      expect((await executeNotebaseTool(toolCtx(), 'propose_folder_move', input, callbacks)).isError).toBe(true);
    }
  });

  it('requires a conversation context for both the single and batch paths', async () => {
    expect((await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [{ path: 'topics/raft', newPath: 'archive/raft' }],
    }, {})).isError).toBe(true);

    expect((await executeNotebaseTool(toolCtx(), 'propose_folder_move', {
      moves: [
        { path: 'topics/raft', newPath: 'archive/raft' },
        { path: 'topics/paxos', newPath: 'archive/paxos' },
      ],
    }, {})).isError).toBe(true);
  });
});
