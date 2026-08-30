/**
 * `propose_folder_delete` — single and batched (#1778).
 *
 * The tool had no coverage of its own: `folder-move-delete-proposal.test.ts`
 * tests the `folder-delete` payload, not the tool that produces the draft.
 * Batching is the moment to fix that, because the parts most likely to regress
 * silently are the ones this file pins: nothing is deleted at draft time, the
 * blast radius counts only links from OUTSIDE the whole deletion set, and a
 * folder nested inside another folder in the same batch is dropped (its payload
 * would fail on an already-deleted path and roll the bundle back).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { indexNote, disposeProject } from '../../../src/main/graph/index';
import type { ConversationDeleteDraft } from '../../../src/shared/conversation-refactor-drafts';
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

function capture(): { drafts: ConversationDeleteDraft[]; callbacks: ToolCallbacks } {
  const drafts: ConversationDeleteDraft[] = [];
  return { drafts, callbacks: { onDeleteDraft: (d) => drafts.push(d) } };
}

beforeEach(async () => {
  project = await makeGraphProject('minerva-folder-delete-tool-');
  root = project.root;
  await seed('topics/raft/raft.md', '# Raft\n\nThe Raft algorithm.');
  await seed('topics/paxos/paxos.md', '# Paxos\n\nSee [[topics/raft/raft]].');
  // An outside referrer, path-qualified so the link genuinely targets the note
  // being deleted rather than resolving by basename.
  await seed('index.md', '# Index\n\nSee [[topics/raft/raft]].');
  // A non-note asset that gets removed with the folder.
  await fsp.writeFile(path.join(root, 'topics/raft/diagram.png'), Buffer.from([0x89, 0x50]));
});
afterEach(async () => {
  disposeProject(ctx());
  await project.cleanup();
});

describe('propose_folder_delete — one folder', () => {
  it('drafts without deleting, listing the notes inside and their inbound links', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft'],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.folderPaths).toEqual(['topics/raft']);
    expect(d.items.map((i) => i.path)).toEqual(['topics/raft/raft.md']);
    expect(d.items[0]!.folder).toBe('topics/raft');
    // Both `index.md` and `topics/paxos/paxos.md` link in from outside.
    expect(d.items[0]!.inbound.map((b) => b.source).sort()).toEqual(
      ['index.md', 'topics/paxos/paxos.md'],
    );
    expect(d.assetCount).toBe(1);
    // Nothing deleted.
    expect(fs.existsSync(path.join(root, 'topics/raft/raft.md'))).toBe(true);
  });

  it('refuses a note path — that is propose_note_delete\'s job', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft/raft.md'],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(drafts).toHaveLength(0);
  });

  it('refuses the project root', async () => {
    const { callbacks } = capture();
    for (const p of ['', '/', '   ']) {
      expect((await executeNotebaseTool(toolCtx(), 'propose_folder_delete', { paths: [p] }, callbacks)).isError)
        .toBe(true);
    }
  });
});

describe('propose_folder_delete — batched', () => {
  it('drafts many folders as ONE card, tagging each note with its folder', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft', 'topics/paxos'],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.folderPaths).toEqual(['topics/raft', 'topics/paxos']);
    expect(d.note).toBe('Delete 2 folders');
    expect(d.items.map((i) => [i.path, i.folder])).toEqual([
      ['topics/raft/raft.md', 'topics/raft'],
      ['topics/paxos/paxos.md', 'topics/paxos'],
    ]);
    // Nothing deleted.
    expect(fs.existsSync(path.join(root, 'topics/paxos/paxos.md'))).toBe(true);
  });

  it('audits inbound links against the WHOLE batch, not folder by folder', async () => {
    // paxos → raft is a link between two folders both being deleted, so it is
    // NOT a dangling link. Only `index.md` survives to dangle.
    const { drafts, callbacks } = capture();
    await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft', 'topics/paxos'],
    }, callbacks);

    const raft = drafts[0]!.items.find((i) => i.path === 'topics/raft/raft.md')!;
    expect(raft.inbound.map((b) => b.source)).toEqual(['index.md']);
  });

  it('drops a folder already inside another folder in the batch, with a warning', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics', 'topics/raft'],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(drafts[0]!.folderPaths).toEqual(['topics']);
    expect(drafts[0]!.warnings.join(' ')).toMatch(/already inside topics/);
    // The nested folder's notes are still listed — under the parent.
    expect(drafts[0]!.items.map((i) => i.folder)).toEqual(['topics', 'topics']);
  });

  it('keeps the real folders and warns about missing / duplicate entries', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft', 'topics/ghost', 'topics/raft', 'topics/paxos'],
    }, callbacks);

    expect(out.isError).toBe(false);
    expect(drafts[0]!.folderPaths).toEqual(['topics/raft', 'topics/paxos']);
    const warnings = drafts[0]!.warnings.join(' ');
    expect(warnings).toMatch(/ghost/);
    expect(warnings).toMatch(/duplicate/i);
  });

  it('errors (no draft) when no folder in the batch exists', async () => {
    const { drafts, callbacks } = capture();
    const out = await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['ghost-a', 'ghost-b'],
    }, callbacks);
    expect(out.isError).toBe(true);
    expect(drafts).toHaveLength(0);
  });

  it('validates required input', async () => {
    const { callbacks } = capture();
    for (const input of [{}, { paths: [] }, { paths: 'topics/raft' }]) {
      expect((await executeNotebaseTool(toolCtx(), 'propose_folder_delete', input, callbacks)).isError)
        .toBe(true);
    }
  });

  it('requires a conversation context', async () => {
    expect((await executeNotebaseTool(toolCtx(), 'propose_folder_delete', {
      paths: ['topics/raft'],
    }, {})).isError).toBe(true);
  });
});
