import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeNotebaseTool, type ToolCallbacks } from '../../../src/main/llm/tools';
import { initGraph, indexNote, disposeProject } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import type { ConversationRefactorDraft } from '../../../src/shared/conversation-refactor-drafts';

let root: string;
const ctx = () => projectContext(root);
const toolCtx = () => ({ rootPath: root, conversationId: 'conv-1' });

async function seed(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
  await indexNote(ctx(), rel, body);
}

function captureDraft(): { calls: ConversationRefactorDraft[]; callbacks: ToolCallbacks } {
  const calls: ConversationRefactorDraft[] = [];
  return { calls, callbacks: { onRefactorDraft: (d) => calls.push(d) } };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-refactor-tools-'));
  await initGraph(ctx());
  await seed('raft.md', '# Raft\n\nThe Raft algorithm.');
  await seed('consensus.md', '# Consensus\n\nSee [[raft]] here.');
});
afterEach(async () => {
  disposeProject(ctx());
  await fsp.rm(root, { recursive: true, force: true });
});

describe('list_notes (#912)', () => {
  it('lists every note with its path and title, read-only', async () => {
    const out = await executeNotebaseTool(toolCtx(), 'list_notes', {});
    expect(out.isError).toBe(false);
    expect(out.content).toContain('raft.md — Raft');
    expect(out.content).toContain('consensus.md — Consensus');
  });
});

describe('propose_note_rename (#912)', () => {
  it('emits a refactor draft with the new basename + blast radius, without moving', async () => {
    const { calls, callbacks } = captureDraft();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_rename', { path: 'raft.md', newName: 'raft-consensus' }, callbacks);

    expect(out.isError).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ fromPath: 'raft.md', toPath: 'raft-consensus.md' });
    // The referring note's rewrite is captured in the blast radius.
    const consensus = calls[0].affectedNotes.find((a) => a.path === 'consensus.md')!;
    expect(consensus.after).toContain('[[raft-consensus]]');
    // Nothing moved.
    expect(fs.existsSync(path.join(root, 'raft.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'raft-consensus.md'))).toBe(false);
  });

  it('tolerates a newName that already includes .md', async () => {
    const { calls, callbacks } = captureDraft();
    await executeNotebaseTool(toolCtx(), 'propose_note_rename', { path: 'raft.md', newName: 'x.md' }, callbacks);
    expect(calls[0].toPath).toBe('x.md');
  });

  it('returns a tool error (no draft) on a colliding destination', async () => {
    const { calls, callbacks } = captureDraft();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_rename', { path: 'raft.md', newName: 'consensus' }, callbacks);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/already exists/i);
    expect(calls).toHaveLength(0);
  });
});

describe('propose_note_move (#912)', () => {
  it('emits a draft moving the note into the destination folder', async () => {
    const { calls, callbacks } = captureDraft();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_move', { path: 'raft.md', destFolder: 'notes/algorithms' }, callbacks);
    expect(out.isError).toBe(false);
    expect(calls[0]).toMatchObject({ fromPath: 'raft.md', toPath: 'notes/algorithms/raft.md' });
  });

  it('moves to the root when destFolder is empty', async () => {
    await seed('sub/deep.md', '# Deep\n\nbody');
    const { calls, callbacks } = captureDraft();
    await executeNotebaseTool(toolCtx(), 'propose_note_move', { path: 'sub/deep.md', destFolder: '' }, callbacks);
    expect(calls[0].toPath).toBe('deep.md');
  });

  it('rejects a no-op move (already in that folder)', async () => {
    const { calls, callbacks } = captureDraft();
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_move', { path: 'raft.md', destFolder: '' }, callbacks);
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('refactor tools require a conversation context', () => {
  it('errors when no onRefactorDraft callback is wired', async () => {
    const out = await executeNotebaseTool(toolCtx(), 'propose_note_rename', { path: 'raft.md', newName: 'y' }, {});
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/conversation/i);
  });
});
